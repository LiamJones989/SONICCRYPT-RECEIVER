const SAMPLE_RATE = 44100;

/*
 * MUST MATCH THE TRANSMITTER
 */

const FREQUENCIES = Array.from(
    { length: 16 },
    (_, i) => 1000 + i * 200
);

const SYMBOL_DURATIONS = {
    turbo: 0.003,
    reliable: 0.006
};

const SYMBOL_DURATION =
    SYMBOL_DURATIONS.turbo;


/*
 * AUDIO
 */

let audioContext = null;
let microphone = null;
let processor = null;
let silentGain = null;

let sampleBuffer = [];

let listening = false;


/*
 * DECODER STATE
 */

let symbolBuffer = [];

let detectedHeader = false;

let expectedFileSize = 0;
let expectedCRC = 0;

let fileName = "";
let mimeType = "";

let payloadBits = [];

let receivedBytes = [];

let receiveStartTime = 0;

let lastPreviewUpdate = 0;


/*
 * ELEMENTS
 */

const startButton =
    document.getElementById("startButton");

const stopButton =
    document.getElementById("stopButton");

const statusElement =
    document.getElementById("status");

const signalStrength =
    document.getElementById("signalStrength");

const signalFill =
    document.getElementById("signalFill");

const frequencyElement =
    document.getElementById("frequency");

const symbolsReceived =
    document.getElementById("symbolsReceived");

const fileNameElement =
    document.getElementById("fileName");

const receivedText =
    document.getElementById("receivedText");

const receivePercent =
    document.getElementById("receivePercent");

const receiveFill =
    document.getElementById("receiveFill");

const receivedBytesElement =
    document.getElementById("receivedBytes");

const expectedBytesElement =
    document.getElementById("expectedBytes");

const receiveSpeed =
    document.getElementById("receiveSpeed");

const receivedImage =
    document.getElementById("receivedImage");

const previewStatus =
    document.getElementById("previewStatus");

const downloadButton =
    document.getElementById("downloadButton");

const logElement =
    document.getElementById("log");


/*
 * LOG
 */

function log(message) {

    const entry =
        document.createElement("div");

    entry.className =
        "log-entry";

    entry.innerHTML =
        `<span class="log-time">[${new Date().toLocaleTimeString()}]</span> ${message}`;

    logElement.appendChild(entry);

    logElement.scrollTop =
        logElement.scrollHeight;
}


/*
 * START
 */

startButton.onclick =
    startListening;


async function startListening() {

    if (listening) {
        return;
    }

    try {

        const stream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });

        audioContext =
            new AudioContext({
                sampleRate: SAMPLE_RATE
            });

        await audioContext.resume();

        microphone =
            audioContext.createMediaStreamSource(
                stream
            );

        /*
         * ScriptProcessor is used here because it
         * works directly in a normal GitHub Pages
         * project without another JS file.
         */

        processor =
            audioContext.createScriptProcessor(
                4096,
                1,
                1
            );

        /*
         * Prevent microphone audio from being
         * played back through the speakers.
         */

        silentGain =
            audioContext.createGain();

        silentGain.gain.value = 0;

        microphone.connect(processor);

        processor.connect(silentGain);

        silentGain.connect(
            audioContext.destination
        );

        processor.onaudioprocess =
            processAudio;

        listening = true;

        resetDecoder();

        receiveStartTime =
            performance.now();

        statusElement.textContent =
            "LISTENING";

        startButton.disabled = true;
        stopButton.disabled = false;

        log("Microphone activated.");
        log("Waiting for SONICCRYPT sync signal...");

    } catch (error) {

        console.error(error);

        statusElement.textContent =
            "MICROPHONE ERROR";

        log(
            "Microphone error: " +
            error.message
        );
    }
}


/*
 * STOP
 */

stopButton.onclick =
    stopListening;


function stopListening() {

    listening = false;

    if (processor) {
        processor.disconnect();
        processor = null;
    }

    if (microphone) {
        microphone.disconnect();
        microphone = null;
    }

    if (silentGain) {
        silentGain.disconnect();
        silentGain = null;
    }

    if (audioContext) {

        audioContext.close();

        audioContext = null;
    }

    statusElement.textContent =
        "MICROPHONE OFF";

    startButton.disabled = false;
    stopButton.disabled = true;

    log("Receiver stopped.");
}


/*
 * AUDIO PROCESSING
 */

function processAudio(event) {

    if (!listening) {
        return;
    }

    const input =
        event.inputBuffer
            .getChannelData(0);

    /*
     * Copy microphone samples.
     */

    for (let i = 0; i < input.length; i++) {

        sampleBuffer.push(input[i]);
    }

    /*
     * Process one symbol at a time.
     */

    const samplesPerSymbol =
        Math.floor(
            SAMPLE_RATE *
            SYMBOL_DURATION
        );

    while (
        sampleBuffer.length >=
        samplesPerSymbol
    ) {

        const samples =
            sampleBuffer.splice(
                0,
                samplesPerSymbol
            );

        const result =
            detectFrequency(samples);

        if (result) {

            symbolBuffer.push(
                result.symbol
            );

            frequencyElement.textContent =
                `${result.frequency} Hz`;

            updateSignal(
                result.strength
            );

            decodeSymbols();
        }
    }
}


/*
 * 16-FSK DETECTOR
 */

function detectFrequency(samples) {

    let bestSymbol = -1;
    let bestPower = 0;

    /*
     * Goertzel-style frequency measurement.
     */

    for (
        let symbol = 0;
        symbol < FREQUENCIES.length;
        symbol++
    ) {

        const frequency =
            FREQUENCIES[symbol];

        const power =
            goertzel(
                samples,
                frequency,
                SAMPLE_RATE
            );

        if (power > bestPower) {

            bestPower = power;
            bestSymbol = symbol;
        }
    }

    const strength =
        Math.min(
            100,
            bestPower * 100000
        );

    if (bestSymbol < 0) {
        return null;
    }

    return {
        symbol: bestSymbol,
        frequency:
            FREQUENCIES[bestSymbol],
        strength
    };
}


/*
 * GOERTZEL
 */

function goertzel(
    samples,
    frequency,
    sampleRate
) {

    const k =
        Math.round(
            0.5 +
            (
                samples.length *
                frequency /
                sampleRate
            )
        );

    const omega =
        2 *
        Math.PI *
        k /
        samples.length;

    const cosine =
        Math.cos(omega);

    const sine =
        Math.sin(omega);

    const coefficient =
        2 * cosine;

    let q0 = 0;
    let q1 = 0;
    let q2 = 0;

    for (const sample of samples) {

        q0 =
            coefficient * q1 -
            q2 +
            sample;

        q2 = q1;
        q1 = q0;
    }

    const real =
        q1 -
        q2 * cosine;

    const imag =
        q2 * sine;

    return (
        real * real +
        imag * imag
    );
}


/*
 * SIGNAL UI
 */

function updateSignal(value) {

    const rounded =
        Math.round(value);

    signalStrength.textContent =
        `${rounded}%`;

    signalFill.style.width =
        `${rounded}%`;
}


/*
 * SYMBOL DECODER
 *
 * We first look for the magic:
 *
 * SCX1
 */

function decodeSymbols() {

    symbolsReceived.textContent =
        symbolBuffer.length.toLocaleString();

    /*
     * Need at least 8 symbols for 4 bytes.
     */

    if (!detectedHeader) {

        if (
            findMagicSequence()
        ) {

            detectedHeader = true;

            parseHeader();

        } else {

            /*
             * Don't allow unlimited memory growth.
             */

            if (symbolBuffer.length > 2000) {

                symbolBuffer =
                    symbolBuffer.slice(-500);
            }
        }

        return;
    }

    /*
     * Header has told us where payload begins.
     */

    decodePayload();
}


/*
 * MAGIC SEARCH
 */

function findMagicSequence() {

    const magic =
        [5, 3, 8, 1];

    for (
        let i = 0;
        i <= symbolBuffer.length - magic.length;
        i++
    ) {

        let match = true;

        for (let j = 0; j < magic.length; j++) {

            if (
                symbolBuffer[i + j] !==
                magic[j]
            ) {

                match = false;
                break;
            }
        }

        if (match) {

            /*
             * Keep only data from MAGIC onward.
             */

            symbolBuffer =
                symbolBuffer.slice(i);

            return true;
        }
    }

    return false;
}


/*
 * HEADER FORMAT
 *
 * 4 magic bytes
 * 1 version
 * 2 name length
 * name
 * 2 MIME length
 * MIME
 * 4 file size
 * 4 CRC32
 */

function parseHeader() {

    const bytes =
        symbolsToBytes(symbolBuffer);

    if (bytes.length < 7) {
        return;
    }

    if (
        bytes[0] !== 0x53 ||
        bytes[1] !== 0x43 ||
        bytes[2] !== 0x58 ||
        bytes[3] !== 0x31
    ) {

        detectedHeader = false;
        return;
    }

    const version =
        bytes[4];

    if (version !== 1) {

        log("Unsupported SONICCRYPT version.");

        detectedHeader = false;

        return;
    }

    let position = 5;

    if (bytes.length < position + 2) {
        return;
    }

    const nameLength =
        (bytes[position] << 8) |
        bytes[position + 1];

    position += 2;

    if (
        bytes.length <
        position + nameLength + 2
    ) {
        return;
    }

    fileName =
        new TextDecoder().decode(
            new Uint8Array(
                bytes.slice(
                    position,
                    position + nameLength
                )
            )
        );

    position += nameLength;

    const mimeLength =
        (bytes[position] << 8) |
        bytes[position + 1];

    position += 2;

    if (
        bytes.length <
        position + mimeLength + 8
    ) {
        return;
    }

    mimeType =
        new TextDecoder().decode(
            new Uint8Array(
                bytes.slice(
                    position,
                    position + mimeLength
                )
            )
        );

    position += mimeLength;

    expectedFileSize =
        (
            bytes[position] * 0x1000000 +
            bytes[position + 1] * 0x10000 +
            bytes[position + 2] * 0x100 +
            bytes[position + 3]
        ) >>> 0;

    position += 4;

    expectedCRC =
        (
            bytes[position] * 0x1000000 +
            bytes[position + 1] * 0x10000 +
            bytes[position + 2] * 0x100 +
            bytes[position + 3]
        ) >>> 0;

    /*
     * Remove header symbols.
     */

    const headerBytes =
        position;

    const headerSymbols =
        headerBytes * 2;

    symbolBuffer =
        symbolBuffer.slice(
            headerSymbols
        );

    fileNameElement.textContent =
        fileName;

    expectedBytesElement.textContent =
        formatBytes(expectedFileSize);

    previewStatus.textContent =
        "Receiving...";

    log(
        `SONICCRYPT transmission detected: ${fileName}`
    );

    log(
        `Expected size: ${formatBytes(expectedFileSize)}`
    );

    log(
        `MIME type: ${mimeType}`
    );

    log(
        `CRC32: ${expectedCRC.toString(16).padStart(8, "0")}`
    );
}


/*
 * SYMBOLS -> BYTES
 */

function symbolsToBytes(symbols) {

    const bytes = [];

    for (
        let i = 0;
        i + 1 < symbols.length;
        i += 2
    ) {

        bytes.push(
            (
                symbols[i] << 4
            ) |
            symbols[i + 1]
        );
    }

    return bytes;
}


/*
 * PAYLOAD
 *
 * Every original byte is:
 *
 * 5 random bits
 * 8 data bits
 *
 * = 13 bits
 */

function decodePayload() {

    /*
     * Convert incoming symbols into bits.
     */

    const bits = [];

    for (const symbol of symbolBuffer) {

        bits.push(
            (symbol >> 3) & 1,
            (symbol >> 2) & 1,
            (symbol >> 1) & 1,
            symbol & 1
        );
    }

    /*
     * We need complete 13-bit blocks.
     */

    while (bits.length >= 13) {

        /*
         * Ignore the first five random bits.
         */

        let value = 0;

        for (let i = 5; i < 13; i++) {

            value =
                (value << 1) |
                bits[i];
        }

        receivedBytes.push(value);

        bits.splice(0, 13);

        /*
         * We only need enough bytes for
         * the actual file.
         */

        if (
            receivedBytes.length >=
            expectedFileSize
        ) {

            finishReception();

            return;
        }
    }

    /*
     * Keep incomplete bits.
     *
     * Convert remaining bits back into
     * symbol form for the next pass.
     */

    symbolBuffer =
        bitsToSymbols(bits);

    updateReceiveProgress();

    updateLivePreview();
}


/*
 * BITS -> SYMBOLS
 */

function bitsToSymbols(bits) {

    const symbols = [];

    for (
        let i = 0;
        i < bits.length;
        i += 4
    ) {

        let value = 0;

        for (
            let j = 0;
            j < 4;
            j++
        ) {

            value <<= 1;

            if (
                i + j <
                bits.length
            ) {

                value |=
                    bits[i + j];
            }
        }

        symbols.push(value);
    }

    return symbols;
}


/*
 * LIVE PROGRESS
 */

function updateReceiveProgress() {

    if (!expectedFileSize) {
        return;
    }

    const count =
        Math.min(
            receivedBytes.length,
            expectedFileSize
        );

    const percent =
        (
            count /
            expectedFileSize
        ) * 100;

    receiveFill.style.width =
        `${percent}%`;

    receivePercent.textContent =
        `${percent.toFixed(1)}%`;

    receivedBytesElement.textContent =
        formatBytes(count);

    receivedText.textContent =
        `${formatBytes(count)} / ${formatBytes(expectedFileSize)}`;

    const elapsed =
        (
            performance.now() -
            receiveStartTime
        ) / 1000;

    const speed =
        elapsed > 0
            ? count / elapsed
            : 0;

    receiveSpeed.textContent =
        `${formatBytes(speed)}/s`;
}


/*
 * LIVE IMAGE
 *
 * Browsers normally require a complete valid
 * image before displaying JPEG/PNG.
 *
 * We still attempt a preview periodically.
 */

function updateLivePreview() {

    const now =
        performance.now();

    if (
        now -
        lastPreviewUpdate <
        500
    ) {

        return;
    }

    lastPreviewUpdate = now;

    if (
        !mimeType.startsWith("image/")
    ) {

        previewStatus.textContent =
            `${formatBytes(receivedBytes.length)} received`;

        return;
    }

    try {

        const blob =
            new Blob(
                [
                    new Uint8Array(
                        receivedBytes
                    )
                ],
                {
                    type: mimeType
                }
            );

        const url =
            URL.createObjectURL(blob);

        const testImage =
            new Image();

        testImage.onload = () => {

            receivedImage.src =
                url;

            receivedImage.style.display =
                "block";

            previewStatus.textContent =
                "LIVE IMAGE PREVIEW";

        };

        testImage.onerror = () => {

            URL.revokeObjectURL(url);
        };

        testImage.src = url;

    } catch {

        // Continue receiving.
    }
}


/*
 * FINISH
 */

function finishReception() {

    const data =
        new Uint8Array(
            receivedBytes
        );

    const actualCRC =
        crc32(data);

    updateReceiveProgress();

    if (
        actualCRC !== expectedCRC
    ) {

        statusElement.textContent =
            "CHECKSUM ERROR";

        previewStatus.textContent =
            "Transmission completed, but the checksum failed.";

        log(
            `CRC ERROR. Expected ${expectedCRC.toString(16)}, got ${actualCRC.toString(16)}`
        );

        return;
    }

    statusElement.textContent =
        "TRANSMISSION COMPLETE";

    receiveFill.style.width = "100%";
    receivePercent.textContent = "100%";

    previewStatus.textContent =
        "FILE RECEIVED SUCCESSFULLY";

    log("Transmission complete.");
    log("CRC32 verified successfully.");

    /*
     * Build final file.
     */

    const blob =
        new Blob(
            [data],
            {
                type: mimeType ||
                    "application/octet-stream"
            }
        );

    const url =
        URL.createObjectURL(blob);

    /*
     * Final image.
     */

    if (
        mimeType.startsWith("image/")
    ) {

        receivedImage.src =
            url;

        receivedImage.style.display =
            "block";
    }

    /*
     * Download button.
     */

    downloadButton.href =
        url;

    downloadButton.download =
        fileName ||
        "soniccrypt-file";

    downloadButton.style.display =
        "block";
}


/*
 * RESET
 */

function resetDecoder() {

    symbolBuffer = [];

    detectedHeader = false;

    expectedFileSize = 0;
    expectedCRC = 0;

    fileName = "";
    mimeType = "";

    payloadBits = [];

    receivedBytes = [];

    sampleBuffer = [];

    lastPreviewUpdate = 0;

    fileNameElement.textContent =
        "Waiting for SONICCRYPT...";

    receivedBytesElement.textContent =
        "0 B";

    expectedBytesElement.textContent =
        "0 B";

    receiveSpeed.textContent =
        "0 B/s";

    receivedText.textContent =
        "0 B / 0 B";

    receivePercent.textContent =
        "0%";

    receiveFill.style.width =
        "0%";

    receivedImage.style.display =
        "none";

    receivedImage.removeAttribute("src");

    downloadButton.style.display =
        "none";

    previewStatus.textContent =
        "Waiting for data...";
}


/*
 * CRC32
 */

function crc32(bytes) {

    let crc =
        0xffffffff;

    for (const byte of bytes) {

        crc ^= byte;

        for (let i = 0; i < 8; i++) {

            crc =
                (
                    crc >>> 1
                ) ^
                (
                    -(crc & 1) &
                    0xedb88320
                );
        }
    }

    return (
        crc ^
        0xffffffff
    ) >>> 0;
}


/*
 * FORMAT
 */

function formatBytes(bytes) {

    if (bytes === 0) {
        return "0 B";
    }

    const units =
        [
            "B",
            "KB",
            "MB",
            "GB"
        ];

    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );

    return (
        (
            bytes /
            Math.pow(
                1024,
                index
            )
        ).toFixed(
            index === 0 ? 0 : 2
        )
        + " "
        + units[index]
    );
}


/*
 * INITIAL
 */

log(
    "SONICCRYPT receiver initialized."
);

log(
    "16-FSK decoder ready."
);

log(
    "Press START LISTENING."
);
