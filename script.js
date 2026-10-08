const FREQUENCIES = Array.from(
    { length: 16 },
    (_, i) => 1000 + i * 200
);


/*
 * The sender supports both modes.
 */

const SYMBOL_DURATIONS = [
    0.004,
    0.006
];


const PREAMBLE = [];

for (let i = 0; i < 32; i++) {
    PREAMBLE.push(
        i % 2 === 0 ? 0 : 15
    );
}


/*
 * AUDIO
 */

let audioContext = null;
let microphone = null;
let processor = null;
let silentGain = null;
let mediaStream = null;

let sampleBuffer = [];

let listening = false;
let synchronized = false;

let currentSymbolDuration = 0.004;
let samplesPerSymbol = 0;


/*
 * DECODER
 */

let symbolBuffer = [];

let headerParsed = false;

let expectedFileSize = 0;
let expectedCRC = 0;

let fileName = "";
let mimeType = "";

let payloadBitBuffer = [];

let receivedBytes = [];

let receiveStartTime = 0;

let lastPreviewUpdate = 0;

let lastProgressUpdate = 0;


/*
 * ELEMENTS
 */

const startButton =
    document.getElementById(
        "startButton"
    );

const stopButton =
    document.getElementById(
        "stopButton"
    );

const statusElement =
    document.getElementById(
        "status"
    );

const signalStrength =
    document.getElementById(
        "signalStrength"
    );

const signalFill =
    document.getElementById(
        "signalFill"
    );

const frequencyElement =
    document.getElementById(
        "frequency"
    );

const symbolsReceived =
    document.getElementById(
        "symbolsReceived"
    );

const fileNameElement =
    document.getElementById(
        "fileName"
    );

const receivedText =
    document.getElementById(
        "receivedText"
    );

const receivePercent =
    document.getElementById(
        "receivePercent"
    );

const receiveFill =
    document.getElementById(
        "receiveFill"
    );

const receivedBytesElement =
    document.getElementById(
        "receivedBytes"
    );

const expectedBytesElement =
    document.getElementById(
        "expectedBytes"
    );

const receiveSpeed =
    document.getElementById(
        "receiveSpeed"
    );

const receivedImage =
    document.getElementById(
        "receivedImage"
    );

const previewStatus =
    document.getElementById(
        "previewStatus"
    );

const downloadButton =
    document.getElementById(
        "downloadButton"
    );

const logElement =
    document.getElementById(
        "log"
    );


/*
 * LOG
 */

function log(message) {

    const entry =
        document.createElement(
            "div"
        );

    entry.className =
        "log-entry";

    entry.innerHTML =
        `<span class="log-time">
            [${new Date().toLocaleTimeString()}]
        </span> ${message}`;

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

        mediaStream =
            await navigator
                .mediaDevices
                .getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });


        audioContext =
            new AudioContext();


        await audioContext.resume();


        microphone =
            audioContext
                .createMediaStreamSource(
                    mediaStream
                );


        processor =
            audioContext
                .createScriptProcessor(
                    4096,
                    1,
                    1
                );


        silentGain =
            audioContext
                .createGain();


        silentGain.gain.value = 0;


        microphone.connect(
            processor
        );


        processor.connect(
            silentGain
        );


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


        log(
            `Microphone active.`
        );

        log(
            `Actual sample rate: ${audioContext.sampleRate} Hz`
        );

        log(
            "Searching for SONICCRYPT synchronization..."
        );


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

        processor.onaudioprocess =
            null;

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


    if (mediaStream) {

        for (
            const track of
            mediaStream.getTracks()
        ) {

            track.stop();
        }

        mediaStream = null;
    }


    if (audioContext) {

        audioContext.close();

        audioContext = null;
    }


    statusElement.textContent =
        "MICROPHONE OFF";


    startButton.disabled = false;

    stopButton.disabled = true;


    log(
        "Receiver stopped."
    );
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


    for (
        let i = 0;
        i < input.length;
        i++
    ) {

        sampleBuffer.push(
            input[i]
        );
    }


    updateRawSignal(input);


    /*
     * We don't immediately chop the audio
     * into symbols.
     *
     * First we find the synchronization
     * sequence.
     */

    if (!synchronized) {

        findSynchronization();

        return;
    }


    /*
     * Decode synchronized symbols.
     */

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
            detectFrequency(
                samples
            );


        if (!result) {
            continue;
        }


        symbolBuffer.push(
            result.symbol
        );


        frequencyElement.textContent =
            `${result.frequency} Hz`;


        updateSignal(
            result.strength
        );


        decodeSymbol();
    }
}


/*
 * RAW SIGNAL
 *
 * This is what gives you the
 * "100% signal" indicator.
 */

function updateRawSignal(samples) {

    let sum = 0;

    for (const sample of samples) {

        sum +=
            sample * sample;
    }


    const rms =
        Math.sqrt(
            sum /
            samples.length
        );


    const percent =
        Math.min(
            100,
            rms * 250
        );


    updateSignal(
        percent
    );
}


/*
 * SYNCHRONIZATION
 *
 * Search the raw microphone data for:
 *
 * 0 F 0 F 0 F...
 *
 * This fixes the biggest problem
 * with the previous receiver.
 */

function findSynchronization() {

    if (!audioContext) {
        return;
    }


    for (
        const duration
        of SYMBOL_DURATIONS
    ) {

        const sps =
            Math.round(
                audioContext.sampleRate *
                duration
            );


        const required =
            PREAMBLE.length *
            sps;


        if (
            sampleBuffer.length <
            required
        ) {

            continue;
        }


        /*
         * Only search the most recent
         * section so the array doesn't
         * grow forever.
         */

        const searchLimit =
            Math.min(
                sampleBuffer.length -
                required,
                12000
            );


        /*
         * Check possible starting
         * positions.
         */

        for (
            let start = 0;
            start <= searchLimit;
            start += 8
        ) {

            const score =
                scorePreamble(
                    start,
                    sps
                );


            if (score >= 0.72) {

                synchronized = true;

                currentSymbolDuration =
                    duration;

                samplesPerSymbol =
                    sps;


                const consumed =
                    start +
                    required;


                sampleBuffer =
                    sampleBuffer.slice(
                        consumed
                    );


                statusElement.textContent =
                    "SYNCHRONIZED";


                log(
                    `SYNC LOCKED — ${Math.round(duration * 1000)} ms symbols`
                );


                log(
                    `Symbol rate: ${Math.round(1 / duration)} symbols/sec`
                );


                return;
            }
        }
    }


    /*
     * Prevent unlimited growth.
     */

    if (
        sampleBuffer.length >
        44100
    ) {

        sampleBuffer =
            sampleBuffer.slice(
                -22050
            );
    }
}


/*
 * SCORE PREAMBLE
 */

function scorePreamble(
    start,
    sps
) {

    let totalScore = 0;


    for (
        let i = 0;
        i < PREAMBLE.length;
        i++
    ) {

        const offset =
            start +
            i * sps;


        const samples =
            sampleBuffer.slice(
                offset,
                offset + sps
            );


        const expected =
            PREAMBLE[i];


        const expectedFrequency =
            FREQUENCIES[
                expected
            ];


        const power =
            goertzel(
                samples,
                expectedFrequency,
                audioContext.sampleRate
            );


        let energy = 0;


        for (
            const sample
            of samples
        ) {

            energy +=
                sample * sample;
        }


        if (energy <= 0.0000001) {

            return 0;
        }


        /*
         * Normalize the frequency power.
         */

        const ratio =
            power /
            (
                samples.length *
                energy
            );


        /*
         * Pure tone should produce
         * a much stronger ratio than
         * background noise.
         */

        const normalized =
            Math.min(
                1,
                ratio * 2.0
            );


        totalScore +=
            normalized;
    }


    return (
        totalScore /
        PREAMBLE.length
    );
}


/*
 * 16-FSK DETECTOR
 */

function detectFrequency(samples) {

    let bestSymbol = 0;
    let bestPower = -Infinity;


    for (
        let symbol = 0;
        symbol < 16;
        symbol++
    ) {

        const power =
            goertzel(
                samples,
                FREQUENCIES[symbol],
                audioContext.sampleRate
            );


        if (
            power >
            bestPower
        ) {

            bestPower =
                power;

            bestSymbol =
                symbol;
        }
    }


    let energy = 0;


    for (
        const sample
        of samples
    ) {

        energy +=
            sample * sample;
    }


    const ratio =
        energy > 0
            ? bestPower /
              (
                  samples.length *
                  energy
              )
            : 0;


    const strength =
        Math.min(
            100,
            ratio * 200
        );


    return {

        symbol: bestSymbol,

        frequency:
            FREQUENCIES[
                bestSymbol
            ],

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


    for (
        const sample
        of samples
    ) {

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
        Math.round(
            Math.min(
                100,
                Math.max(
                    0,
                    value
                )
            )
        );


    signalStrength.textContent =
        `${rounded}%`;


    signalFill.style.width =
        `${rounded}%`;
}


/*
 * SYMBOL DECODER
 */

function decodeSymbol() {

    symbolsReceived.textContent =
        symbolBuffer.length
            .toLocaleString();


    /*
     * First decode the header.
     */

    if (!headerParsed) {

        tryParseHeader();

        return;
    }


    /*
     * Everything after the
     * header is payload.
     */

    const symbol =
        symbolBuffer.shift();


    appendPayloadSymbol(
        symbol
    );
}


/*
 * HEADER
 */

function tryParseHeader() {

    /*
     * Need at least:
     *
     * magic 4
     * version 1
     * name length 2
     */

    if (
        symbolBuffer.length <
        14
    ) {

        return;
    }


    const bytes =
        symbolsToBytes(
            symbolBuffer
        );


    if (
        bytes[0] !== 0x53 ||
        bytes[1] !== 0x43 ||
        bytes[2] !== 0x58 ||
        bytes[3] !== 0x32
    ) {

        /*
         * We lost synchronization.
         */

        log(
            "Header mismatch — searching again."
        );


        synchronized = false;

        headerParsed = false;

        symbolBuffer = [];

        sampleBuffer = [];

        return;
    }


    if (bytes[4] !== 2) {

        log(
            "Unsupported SONICCRYPT version."
        );

        return;
    }


    let position = 5;


    if (
        bytes.length <
        position + 2
    ) {

        return;
    }


    const nameLength =
        (
            bytes[position] << 8
        ) |
        bytes[position + 1];


    position += 2;


    if (
        bytes.length <
        position +
        nameLength +
        2
    ) {

        return;
    }


    fileName =
        new TextDecoder()
            .decode(
                new Uint8Array(
                    bytes.slice(
                        position,
                        position +
                        nameLength
                    )
                )
            );


    position +=
        nameLength;


    const mimeLength =
        (
            bytes[position] << 8
        ) |
        bytes[position + 1];


    position += 2;


    if (
        bytes.length <
        position +
        mimeLength +
        8
    ) {

        return;
    }


    mimeType =
        new TextDecoder()
            .decode(
                new Uint8Array(
                    bytes.slice(
                        position,
                        position +
                        mimeLength
                    )
                )
            );


    position +=
        mimeLength;


    expectedFileSize =
        (
            bytes[position] *
                0x1000000 +
            bytes[position + 1] *
                0x10000 +
            bytes[position + 2] *
                0x100 +
            bytes[position + 3]
        ) >>> 0;


    position += 4;


    expectedCRC =
        (
            bytes[position] *
                0x1000000 +
            bytes[position + 1] *
                0x10000 +
            bytes[position + 2] *
                0x100 +
            bytes[position + 3]
        ) >>> 0;


    /*
     * Header is complete.
     */

    const headerByteCount =
        position + 4;


    const headerSymbolCount =
        headerByteCount * 2;


    if (
        symbolBuffer.length <
        headerSymbolCount
    ) {

        return;
    }


    /*
     * Remove header.
     */

    symbolBuffer =
        symbolBuffer.slice(
            headerSymbolCount
        );


    headerParsed = true;


    fileNameElement.textContent =
        fileName;


    expectedBytesElement.textContent =
        formatBytes(
            expectedFileSize
        );


    previewStatus.textContent =
        "RECEIVING...";


    log(
        `Transmission detected: ${fileName}`
    );


    log(
        `Expected size: ${formatBytes(
            expectedFileSize
        )}`
    );


    log(
        `MIME: ${mimeType}`
    );


    log(
        `CRC32: ${expectedCRC
            .toString(16)
            .padStart(8, "0")}`
    );


    /*
     * Decode anything that arrived
     * after the header.
     */

    while (
        symbolBuffer.length > 0
    ) {

        const symbol =
            symbolBuffer.shift();

        appendPayloadSymbol(
            symbol
        );
    }
}


/*
 * APPEND PAYLOAD SYMBOL
 */

function appendPayloadSymbol(
    symbol
) {

    payloadBitBuffer.push(
        (symbol >> 3) & 1,
        (symbol >> 2) & 1,
        (symbol >> 1) & 1,
        symbol & 1
    );


    /*
     * Every original byte is:
     *
     * 5 random bits
     * 8 real bits
     *
     * = 13 bits
     */

    while (
        payloadBitBuffer.length >=
        13
    ) {

        /*
         * Skip random bits.
         */

        payloadBitBuffer.splice(
            0,
            5
        );


        let value = 0;


        for (
            let i = 0;
            i < 8;
            i++
        ) {

            value =
                (
                    value << 1
                ) |
                payloadBitBuffer[i];
        }


        /*
         * Remove the 8 data bits.
         */

        payloadBitBuffer.splice(
            0,
            8
        );


        receivedBytes.push(
            value
        );


        if (
            receivedBytes.length >=
            expectedFileSize
        ) {

            finishReception();

            return;
        }
    }


    updateReceiveProgress();

    updateLivePreview();
}


/*
 * PROGRESS
 */

function updateReceiveProgress() {

    const now =
        performance.now();


    if (
        now -
        lastProgressUpdate <
        100
    ) {

        return;
    }


    lastProgressUpdate =
        now;


    if (
        expectedFileSize <= 0
    ) {

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
        `${formatBytes(count)} / ${formatBytes(
            expectedFileSize
        )}`;


    const elapsed =
        (
            now -
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
 * LIVE PREVIEW
 */

function updateLivePreview() {

    const now =
        performance.now();


    if (
        now -
        lastPreviewUpdate <
        1000
    ) {

        return;
    }


    lastPreviewUpdate =
        now;


    if (
        !mimeType.startsWith(
            "image/"
        )
    ) {

        return;
    }


    /*
     * Browsers generally need a
     * valid image before displaying it.
     *
     * We still attempt a live preview.
     */

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
            URL.createObjectURL(
                blob
            );


        const testImage =
            new Image();


        testImage.onload =
            () => {

                receivedImage.src =
                    url;

                receivedImage.style.display =
                    "block";

                previewStatus.textContent =
                    "LIVE IMAGE PREVIEW";
            };


        testImage.onerror =
            () => {

                URL.revokeObjectURL(
                    url
                );
            };


        testImage.src =
            url;

    } catch {

        /*
         * Continue receiving.
         */
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
        actualCRC !==
        expectedCRC
    ) {

        statusElement.textContent =
            "CHECKSUM ERROR";


        previewStatus.textContent =
            "Transmission finished, but the checksum failed.";


        log(
            `CRC ERROR — expected ${expectedCRC
                .toString(16)}, received ${actualCRC
                .toString(16)}`
        );


        return;
    }


    statusElement.textContent =
        "TRANSMISSION COMPLETE";


    receiveFill.style.width =
        "100%";


    receivePercent.textContent =
        "100%";


    previewStatus.textContent =
        "FILE RECEIVED SUCCESSFULLY";


    log(
        "Transmission complete."
    );


    log(
        "CRC32 verified successfully."
    );


    const blob =
        new Blob(
            [data],
            {
                type:
                    mimeType ||
                    "application/octet-stream"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    if (
        mimeType.startsWith(
            "image/"
        )
    ) {

        receivedImage.src =
            url;

        receivedImage.style.display =
            "block";
    }


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

    headerParsed = false;

    synchronized = false;

    currentSymbolDuration =
        0.004;

    samplesPerSymbol = 0;

    expectedFileSize = 0;

    expectedCRC = 0;

    fileName = "";

    mimeType = "";

    payloadBitBuffer = [];

    receivedBytes = [];

    sampleBuffer = [];

    lastPreviewUpdate = 0;

    lastProgressUpdate = 0;


    fileNameElement.textContent =
        "Searching for SONICCRYPT...";


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


    receivedImage.removeAttribute(
        "src"
    );


    downloadButton.style.display =
        "none";


    previewStatus.textContent =
        "Waiting for transmission...";
}


/*
 * SYMBOLS -> BYTES
 */

function symbolsToBytes(
    symbols
) {

    const bytes = [];


    for (
        let i = 0;
        i + 1 <
        symbols.length;
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
 * CRC32
 */

function crc32(bytes) {

    let crc =
        0xffffffff;


    for (
        const byte
        of bytes
    ) {

        crc ^= byte;


        for (
            let i = 0;
            i < 8;
            i++
        ) {

            crc =
                (
                    crc >>> 1
                ) ^
                (
                    -(
                        crc & 1
                    ) &
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


    const units = [
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
            index === 0
                ? 0
                : 2
        )
        +
        " " +
        units[index]
    );
}


/*
 * INITIAL
 */

stopButton.disabled = true;


log(
    "SONICCRYPT receiver initialized."
);

log(
    "16-FSK decoder ready."
);

log(
    "1000-4000 Hz."
);

log(
    "Synchronization search enabled."
);

log(
    "Waiting for transmission..."
);
