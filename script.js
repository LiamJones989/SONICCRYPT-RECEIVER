/*
 * SONICCRYPT RECEIVER
 *
 * MUST MATCH SENDER:
 *
 * 16-FSK
 * 1000-4000 Hz
 *
 * Turbo:
 * 176 samples @ 44.1 kHz
 *
 * Reliable:
 * 264 samples @ 44.1 kHz
 *
 * The receiver uses the actual microphone
 * sample rate and fractional timing so it
 * does not drift.
 */


/*
 * FREQUENCIES
 */

const FREQUENCIES = Array.from(
    { length: 16 },
    (_, i) => 1000 + i * 200
);


/*
 * These are the exact durations created
 * by the sender.
 */

const SYMBOL_DURATIONS = {

    turbo:
        176 / 44100,

    reliable:
        264 / 44100
};


/*
 * PREAMBLE
 *
 * 0, F, 0, F...
 */

const PREAMBLE = [];

for (let i = 0; i < 48; i++) {

    PREAMBLE.push(
        i % 2 === 0
            ? 0
            : 15
    );
}


/*
 * AUDIO STATE
 */

let audioContext = null;

let microphone = null;

let processor = null;

let silentGain = null;

let mediaStream = null;


let sampleBuffer = [];


let listening = false;

let synchronized = false;


/*
 * Timing
 */

let symbolDuration = null;

let detectedMode = null;

let actualSampleRate = 44100;


/*
 * Decoder state
 */

let dataSymbols = [];

let headerParsed = false;

let expectedFileSize = 0;

let expectedCRC = 0;

let fileName = "";

let mimeType = "";

let payloadBits = [];

let receivedBytes = [];


let receiveStartTime = 0;

let lastPreviewUpdate = 0;

let lastUiUpdate = 0;


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
 * START LISTENING
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

                        echoCancellation:
                            false,

                        noiseSuppression:
                            false,

                        autoGainControl:
                            false
                    }
                });


        /*
         * DO NOT force 44100 Hz here.
         *
         * We need the actual microphone
         * sample rate.
         */

        audioContext =
            new AudioContext();


        await audioContext.resume();


        actualSampleRate =
            audioContext.sampleRate;


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


        /*
         * Prevent microphone feedback.
         */

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


        startButton.disabled =
            true;

        stopButton.disabled =
            false;


        log(
            "Microphone activated."
        );


        log(
            `Microphone sample rate: ${actualSampleRate} Hz`
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
            const track
            of mediaStream.getTracks()
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


    startButton.disabled =
        false;

    stopButton.disabled =
        true;


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


    /*
     * Before sync:
     *
     * search for the preamble.
     */

    if (!synchronized) {

        searchForSync();

        updateRawSignal(
            input
        );

        return;
    }


    /*
     * Once synchronized:
     *
     * decode symbols using the exact
     * fractional timing of the sender.
     */

    decodeSynchronizedAudio();
}


/*
 * RAW SIGNAL
 */

function updateRawSignal(samples) {

    let sum = 0;


    for (
        const sample
        of samples
    ) {

        sum +=
            sample * sample;
    }


    const rms =
        Math.sqrt(
            sum /
            samples.length
        );


    /*
     * This is ONLY signal strength.
     */

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
 */

function searchForSync() {

    /*
     * Try BOTH sender modes automatically.
     *
     * Turbo    = 176 samples @ 44.1 kHz
     * Reliable = 264 samples @ 44.1 kHz
     */

    const modes = [
        {
            name: "turbo",
            duration: SYMBOL_DURATIONS.turbo
        },
        {
            name: "reliable",
            duration: SYMBOL_DURATIONS.reliable
        }
    ];


    /*
     * Try each possible transmission speed.
     */

    for (const mode of modes) {

        const samplesPerSymbol =
            mode.duration *
            actualSampleRate;


        const requiredSamples =
            Math.ceil(
                PREAMBLE.length *
                samplesPerSymbol
            );


        /*
         * We need the entire synchronization
         * pattern before we can lock.
         */

        if (
            sampleBuffer.length <
            requiredSamples
        ) {

            continue;
        }


        /*
         * Search the newest audio.
         */

        const maxSearch =
            Math.min(
                sampleBuffer.length -
                requiredSamples,

                Math.floor(
                    actualSampleRate *
                    0.75
                )
            );


        /*
         * Search more carefully than before.
         *
         * 1 sample at a time gives us much
         * better synchronization.
         */

        for (
            let start = 0;
            start <= maxSearch;
            start += 2
        ) {

            const score =
                scoreSyncCandidate(
                    start,
                    samplesPerSymbol
                );


            /*
             * Strong synchronization lock.
             */

            if (
                score >= 0.72
            ) {

                symbolDuration =
                    mode.duration;

                detectedMode =
                    mode.name;


                lockSynchronization(
                    start,
                    samplesPerSymbol
                );


                return;
            }
        }
    }


    /*
     * Don't let the microphone buffer grow
     * forever.
     */

    const maxBuffer =
        Math.floor(
            actualSampleRate *
            1.5
        );


    if (
        sampleBuffer.length >
        maxBuffer
    ) {

        sampleBuffer =
            sampleBuffer.slice(
                -Math.floor(
                    actualSampleRate *
                    0.8
                )
            );
    }
}

    /*
     * Search the newest section.
     *
     * We use a relatively small step
     * because symbol timing can begin
     * between audio samples.
     */

    const maxSearch =
        Math.min(
            sampleBuffer.length -
            requiredSamples,
            Math.floor(
                actualSampleRate *
                0.5
            )
        );


    for (
        let start = 0;
        start <= maxSearch;
        start += 4
    ) {

        const score =
            scoreSyncCandidate(
                start,
                samplesPerSymbol
            );


        /*
         * 0.82 means roughly 82%+
         * of the preamble must match.
         */

        if (score >= 0.82) {

            lockSynchronization(
                start,
                samplesPerSymbol
            );

            return;
        }
    }


    /*
     * Don't allow unlimited memory.
     */

    const maxBuffer =
        Math.floor(
            actualSampleRate *
            0.75
        );


    if (
        sampleBuffer.length >
        maxBuffer
    ) {

        sampleBuffer =
            sampleBuffer.slice(
                -Math.floor(
                    actualSampleRate *
                    0.35
                )
            );
    }
}


/*
 * SCORE SYNC
 */

function scoreSyncCandidate(
    start,
    samplesPerSymbol
) {

    let correct = 0;

    let total = 0;

    let confidenceSum = 0;


    /*
     * We don't need all 48 symbols
     * to establish a very strong lock.
     */

    const checkCount =
        PREAMBLE.length;


    for (
        let i = 0;
        i < checkCount;
        i++
    ) {

        const symbolStart =
            start +
            Math.round(
                i *
                samplesPerSymbol
            );


        const symbolEnd =
            start +
            Math.round(
                (i + 1) *
                samplesPerSymbol
            );


        if (
            symbolEnd >
            sampleBuffer.length
        ) {

            return 0;
        }


        const samples =
            sampleBuffer.slice(
                symbolStart,
                symbolEnd
            );


        const result =
            detectFrequency(
                samples
            );


        if (!result) {
            return 0;
        }


        const expected =
            PREAMBLE[i];


        if (
            result.symbol ===
            expected
        ) {

            correct++;

            confidenceSum +=
                result.confidence;
        }


        total++;
    }


    if (total === 0) {
        return 0;
    }


    const accuracy =
        correct / total;


    const confidence =
        confidenceSum /
        total;


    /*
     * Both frequency accuracy AND
     * tone confidence matter.
     */

    return (
        accuracy *
        0.75 +
        confidence *
        0.25
    );
}


/*
 * LOCK
 */

function lockSynchronization(
    start,
    samplesPerSymbol
) {

    const preambleSamples =
        Math.round(
            PREAMBLE.length *
            samplesPerSymbol
        );


    /*
     * Throw away:
     *
     * everything before sync
     * +
     * the sync itself
     */

    sampleBuffer =
        sampleBuffer.slice(
            start +
            preambleSamples
        );


    synchronized = true;


    statusElement.textContent =
        "SYNCHRONIZED";


    log(
        "SONICCRYPT SYNC LOCKED."
    );


    log(
        `Symbol duration: ${(symbolDuration * 1000).toFixed(3)} ms`
    );


    log(
        `Actual microphone rate: ${actualSampleRate} Hz`
    );


    log(
        "Receiving data..."
    );


    /*
     * Immediately decode anything
     * already sitting in the buffer.
     */

    decodeSynchronizedAudio();
}


/*
 * SYNCHRONIZED DECODING
 */

function decodeSynchronizedAudio() {

    const samplesPerSymbol =
        symbolDuration *
        actualSampleRate;


    /*
     * Use an integer cursor, but calculate
     * each boundary from the original
     * fractional timing.
     *
     * This prevents long-term drift.
     */

    let symbolIndex = 0;


    /*
     * We store decoded symbols here
     * until the header is parsed.
     */

    while (true) {

        const start =
            Math.round(
                symbolIndex *
                samplesPerSymbol
            );


        const end =
            Math.round(
                (symbolIndex + 1) *
                samplesPerSymbol
            );


        if (
            end >
            sampleBuffer.length
        ) {

            break;
        }


        const samples =
            sampleBuffer.slice(
                start,
                end
            );


        const result =
            detectFrequency(
                samples
            );


        if (result) {

            frequencyElement.textContent =
                `${result.frequency} Hz`;


            updateSignal(
                result.confidence *
                100
            );


            dataSymbols.push(
                result.symbol
            );


            decodeDataSymbols();
        }


        symbolIndex++;


        /*
         * Don't keep processing forever.
         *
         * We remove processed samples
         * periodically.
         */

        if (
            symbolIndex >=
            100
        ) {

            const consumed =
                Math.round(
                    symbolIndex *
                    samplesPerSymbol
                );


            sampleBuffer =
                sampleBuffer.slice(
                    consumed
                );


            /*
             * We need to continue from
             * the new beginning.
             */

            symbolIndex = 0;
        }
    }
}


/*
 * 16-FSK DETECTOR
 *
 * Uses direct frequency correlation
 * rather than the old Goertzel bin rounding.
 */

function detectFrequency(
    samples
) {

    if (
        !samples ||
        samples.length < 8
    ) {

        return null;
    }


    /*
     * Calculate total energy.
     */

    let energy = 0;


    for (
        const sample
        of samples
    ) {

        energy +=
            sample * sample;
    }


    if (
        energy <
        0.000001
    ) {

        return null;
    }


    let bestSymbol = 0;

    let bestPower = -Infinity;

    let secondPower = -Infinity;


    for (
        let symbol = 0;
        symbol < 16;
        symbol++
    ) {

        const frequency =
            FREQUENCIES[symbol];


        let cosineSum = 0;

        let sineSum = 0;


        for (
            let i = 0;
            i < samples.length;
            i++
        ) {

            const phase =
                2 *
                Math.PI *
                frequency *
                i /
                actualSampleRate;


            cosineSum +=
                samples[i] *
                Math.cos(phase);


            sineSum +=
                samples[i] *
                Math.sin(phase);
        }


        const power =
            cosineSum *
                cosineSum +
            sineSum *
                sineSum;


        if (
            power >
            bestPower
        ) {

            secondPower =
                bestPower;

            bestPower =
                power;

            bestSymbol =
                symbol;

        } else if (
            power >
            secondPower
        ) {

            secondPower =
                power;
        }
    }


    /*
     * How dominant is the winning tone?
     */

    const dominance =
        bestPower /
        (
            secondPower +
            0.0000001
        );


    /*
     * Convert to 0-1 confidence.
     */

    const confidence =
        Math.min(
            1,
            Math.max(
                0,
                (
                    dominance -
                    1
                ) /
                2
            )
        );


    return {

        symbol:
            bestSymbol,

        frequency:
            FREQUENCIES[
                bestSymbol
            ],

        confidence
    };
}


/*
 * DATA SYMBOL DECODER
 */

function decodeDataSymbols() {

    symbolsReceived.textContent =
        dataSymbols.length
            .toLocaleString();


    /*
     * HEADER FIRST
     */

    if (!headerParsed) {

        tryParseHeader();

        return;
    }


    /*
     * Take symbols after the header.
     */

    while (
        dataSymbols.length > 0
    ) {

        const symbol =
            dataSymbols.shift();


        /*
         * Convert 4-bit symbol
         * into four bits.
         */

        payloadBits.push(
            (symbol >> 3) & 1,
            (symbol >> 2) & 1,
            (symbol >> 1) & 1,
            symbol & 1
        );


        /*
         * Each byte is:
         *
         * 5 random bits
         * 8 real bits
         */

        while (
            payloadBits.length >=
            13
        ) {

            /*
             * Remove random 5 bits.
             */

            payloadBits.splice(
                0,
                5
            );


            let value = 0;


            /*
             * Read actual 8 bits.
             */

            for (
                let i = 0;
                i < 8;
                i++
            ) {

                value =
                    (
                        value << 1
                    ) |
                    payloadBits[i];
            }


            /*
             * Remove data bits.
             */

            payloadBits.splice(
                0,
                8
            );


            receivedBytes.push(
                value
            );


            /*
             * Did we get the complete file?
             */

            if (
                receivedBytes.length >=
                expectedFileSize
            ) {

                finishReception();

                return;
            }
        }
    }


    updateReceiveProgress();

    updateLivePreview();
}


/*
 * HEADER PARSER
 */

function tryParseHeader() {

    /*
     * Two symbols = one byte.
     */

    if (
        dataSymbols.length <
        10
    ) {

        return;
    }


    const bytes =
        symbolsToBytes(
            dataSymbols
        );


    /*
     * Accept SCX2.
     */

    if (
        bytes.length >= 4 &&
        (
            bytes[0] !== 0x53 ||
            bytes[1] !== 0x43 ||
            bytes[2] !== 0x58 ||
            bytes[3] !== 0x32
        )
    ) {

        /*
         * We can also accept the older
         * SCX1 header.
         */

        const oldFormat =
            (
                bytes[0] === 0x53 &&
                bytes[1] === 0x43 &&
                bytes[2] === 0x58 &&
                bytes[3] === 0x31
            );


        if (!oldFormat) {

            /*
             * Something went wrong with
             * synchronization.
             */

            dataSymbols.shift();

            return;
        }
    }


    /*
     * Need version.
     */

    if (
        bytes.length <
        5
    ) {

        return;
    }


    const version =
        bytes[4];


    if (
        version !== 1 &&
        version !== 2
    ) {

        log(
            "Invalid SONICCRYPT version."
        );

        return;
    }


    let position = 5;


    /*
     * NAME LENGTH
     */

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


    /*
     * Wait for full name.
     */

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


    /*
     * MIME LENGTH
     */

    const mimeLength =
        (
            bytes[position] << 8
        ) |
        bytes[position + 1];


    position += 2;


    /*
     * Wait for MIME + size + CRC.
     */

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


    /*
     * FILE SIZE
     */

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


    /*
     * CRC32
     */

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


    position += 4;


    /*
     * Header is now completely received.
     *
     * Every byte = 2 symbols.
     */

    const headerSymbolCount =
        position * 2;


    if (
        dataSymbols.length <
        headerSymbolCount
    ) {

        return;
    }


    /*
     * Remove header.
     */

    dataSymbols =
        dataSymbols.slice(
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
        "RECEIVING";


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
     * Decode any payload symbols
     * that arrived with the header.
     */

    if (
        dataSymbols.length > 0
    ) {

        decodeDataSymbols();
    }
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
 * LIVE PROGRESS
 */

function updateReceiveProgress() {

    const now =
        performance.now();


    if (
        now -
        lastUiUpdate <
        100
    ) {

        return;
    }


    lastUiUpdate =
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
        ) *
        100;


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
        ) /
        1000;


    const speed =
        elapsed > 0
            ? count / elapsed
            : 0;


    receiveSpeed.textContent =
        `${formatBytes(speed)}/s`;
}


/*
 * LIVE IMAGE PREVIEW
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


    if (
        receivedBytes.length <
        32
    ) {

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
                    type:
                        mimeType
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
        /* Continue receiving. */
    }
}


/*
 * FINISH
 */

function finishReception() {

    const data =
        new Uint8Array(
            receivedBytes.slice(
                0,
                expectedFileSize
            )
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
            "Data received, but CRC32 failed.";


        log(
            `CRC ERROR`
        );


        log(
            `Expected: ${expectedCRC
                .toString(16)
                .padStart(8, "0")}`
        );


        log(
            `Received: ${actualCRC
                .toString(16)
                .padStart(8, "0")}`
        );


        return;
    }


    statusElement.textContent =
        "TRANSMISSION COMPLETE";


    receiveFill.style.width =
        "100%";


    receivePercent.textContent =
        "100%";


    receivedBytesElement.textContent =
        formatBytes(
            expectedFileSize
        );


    receivedText.textContent =
        `${formatBytes(
            expectedFileSize
        )} / ${formatBytes(
            expectedFileSize
        )}`;


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

    sampleBuffer = [];

    synchronized = false;

    dataSymbols = [];

    headerParsed = false;

    expectedFileSize = 0;

    expectedCRC = 0;

    fileName = "";

    mimeType = "";

    payloadBits = [];

    receivedBytes = [];

    symbolDuration =
        SYMBOL_DURATIONS.turbo;


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


    frequencyElement.textContent =
        "---";


    symbolsReceived.textContent =
        "0";


    receivedImage.style.display =
        "none";


    receivedImage.removeAttribute(
        "src"
    );


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
 * FORMAT BYTES
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
    "Real microphone sample rate detection enabled."
);

log(
    "Synchronization enabled."
);
