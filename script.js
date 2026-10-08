/*
 * ============================================================
 * SONICCRYPT RECEIVER
 * ============================================================
 *
 * Compatible with the NEW SONICCRYPT transmitter.
 *
 * 16-FSK:
 *
 * 0  = 1000 Hz
 * 1  = 1200 Hz
 * 2  = 1400 Hz
 * ...
 * F  = 4000 Hz
 *
 * Synchronization:
 *
 * 0 F 0 F 0 F 0 F...
 *
 * Header:
 *
 * SCX2
 * VERSION
 * FILE NAME
 * MIME TYPE
 * FILE SIZE
 * CRC32
 *
 * Payload:
 *
 * 5 random bits
 * +
 * 8 actual data bits
 *
 * = 13 bits per original byte
 *
 * ============================================================
 */


/* ============================================================
   FREQUENCIES
   ============================================================ */

const FREQUENCIES =
    Array.from(
        { length: 16 },
        (_, i) => 1000 + i * 200
    );


/*
 * Sender creates:
 *
 * Turbo:
 * 176 samples @ 44100 Hz
 *
 * Reliable:
 * 264 samples @ 44100 Hz
 */

const SYMBOL_DURATIONS = {

    turbo:
        176 / 44100,

    reliable:
        264 / 44100
};


/*
 * Synchronization pattern.
 *
 * 1000 Hz
 * 4000 Hz
 * 1000 Hz
 * 4000 Hz
 *
 * repeated 48 times.
 */

const PREAMBLE = [];

for (
    let i = 0;
    i < 48;
    i++
) {

    PREAMBLE.push(
        i % 2 === 0
            ? 0
            : 15
    );
}


/* ============================================================
   AUDIO
   ============================================================ */

let audioContext = null;

let microphone = null;

let processor = null;

let silentGain = null;

let mediaStream = null;


/*
 * Raw microphone samples.
 */

let sampleBuffer = [];


/*
 * Where the decoder currently is.
 */

let decodePosition = 0;


/*
 * Actual microphone sample rate.
 */

let actualSampleRate = 44100;


/*
 * Listening state.
 */

let listening = false;


/* ============================================================
   SYNCHRONIZATION
   ============================================================ */

let synchronized = false;

let detectedMode = null;

let symbolDuration = null;


/* ============================================================
   DATA
   ============================================================ */

let symbolBuffer = [];

let detectedHeader = false;

let expectedFileSize = 0;

let expectedCRC = 0;

let fileName = "";

let mimeType = "";

let receivedBytes = [];

let payloadBitBuffer = [];


/* ============================================================
   UI STATE
   ============================================================ */

let receiveStartTime = 0;

let lastPreviewUpdate = 0;

let lastUiUpdate = 0;


/* ============================================================
   ELEMENTS
   ============================================================ */

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


/* ============================================================
   LOGGING
   ============================================================ */

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

    logElement.appendChild(
        entry
    );

    logElement.scrollTop =
        logElement.scrollHeight;
}


/* ============================================================
   START LISTENING
   ============================================================ */

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
         * IMPORTANT:
         *
         * We do NOT force 44100 Hz.
         *
         * The browser may use 48000 Hz.
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
         * Zero-volume output prevents
         * microphone feedback.
         */

        silentGain =
            audioContext
                .createGain();

        silentGain.gain.value =
            0;


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


        resetDecoder();


        listening = true;


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


/* ============================================================
   STOP LISTENING
   ============================================================ */

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


/* ============================================================
   AUDIO PROCESSING
   ============================================================ */

function processAudio(event) {

    if (!listening) {
        return;
    }


    const input =
        event.inputBuffer
            .getChannelData(0);


    /*
     * Copy samples out of the browser's
     * temporary audio buffer.
     */

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
     * Before synchronization:
     *
     * look for the preamble.
     */

    if (!synchronized) {

        updateRawSignal(
            input
        );

        searchForSync();

        return;
    }


    /*
     * After synchronization:
     *
     * decode normal data.
     */

    decodeSynchronizedAudio();
}


/* ============================================================
   RAW SIGNAL DISPLAY
   ============================================================ */

function updateRawSignal(
    samples
) {

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


    const percent =
        Math.min(
            100,
            rms * 250
        );


    updateSignal(
        percent
    );
}


/* ============================================================
   SYNCHRONIZATION SEARCH
   ============================================================ */

function searchForSync() {

    /*
     * We automatically try BOTH modes.
     */

    const modes = [

        {
            name:
                "turbo",

            duration:
                SYMBOL_DURATIONS.turbo
        },

        {
            name:
                "reliable",

            duration:
                SYMBOL_DURATIONS.reliable
        }
    ];


    for (
        const mode
        of modes
    ) {

        const samplesPerSymbol =
            mode.duration *
            actualSampleRate;


        const requiredSamples =
            Math.ceil(
                PREAMBLE.length *
                samplesPerSymbol
            );


        /*
         * Not enough audio yet.
         */

        if (
            sampleBuffer.length <
            requiredSamples
        ) {

            continue;
        }


        /*
         * Search the most recent
         * ~1 second of audio.
         */

        const maxSearch =
            Math.min(
                sampleBuffer.length -
                requiredSamples,

                Math.floor(
                    actualSampleRate *
                    1.0
                )
            );


        /*
         * Check every 4 samples.
         *
         * This is much faster than checking
         * every single sample while still
         * giving good synchronization.
         */

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
             * Strong enough = LOCK.
             */

            if (
                score >= 0.72
            ) {

                detectedMode =
                    mode.name;

                symbolDuration =
                    mode.duration;


                lockSynchronization(
                    start,
                    samplesPerSymbol
                );


                return;
            }
        }
    }


    /*
     * Keep memory under control.
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


/* ============================================================
   SCORE SYNCHRONIZATION CANDIDATE
   ============================================================ */

function scoreSyncCandidate(
    start,
    samplesPerSymbol
) {

    let correct =
        0;

    let total =
        0;

    let confidenceTotal =
        0;


    /*
     * We verify the complete 48-symbol
     * synchronization sequence.
     */

    for (
        let i = 0;
        i < PREAMBLE.length;
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
        }


        confidenceTotal +=
            result.confidence;


        total++;
    }


    if (!total) {
        return 0;
    }


    const accuracy =
        correct /
        total;


    const confidence =
        confidenceTotal /
        total;


    return (
        accuracy * 0.80 +
        confidence * 0.20
    );
}


/* ============================================================
   LOCK SYNCHRONIZATION
   ============================================================ */

function lockSynchronization(
    start,
    samplesPerSymbol
) {

    /*
     * Calculate how many samples the
     * preamble occupied.
     */

    const preambleSamples =
        Math.round(
            PREAMBLE.length *
            samplesPerSymbol
        );


    /*
     * Throw away everything through
     * the end of the preamble.
     */

    sampleBuffer =
        sampleBuffer.slice(
            start +
            preambleSamples
        );


    decodePosition = 0;


    synchronized = true;


    statusElement.textContent =
        "SYNCHRONIZED";


    log(
        "SONICCRYPT SYNC LOCKED."
    );


    log(
        `MODE: ${detectedMode.toUpperCase()}`
    );


    log(
        `SYMBOL TIME: ${(symbolDuration * 1000).toFixed(3)} ms`
    );


    log(
        `MIC RATE: ${actualSampleRate} Hz`
    );


    log(
        "Receiving data..."
    );


    /*
     * Immediately process any data
     * already waiting in the buffer.
     */

    decodeSynchronizedAudio();
}


/* ============================================================
   SYNCHRONIZED AUDIO DECODER
   ============================================================ */

function decodeSynchronizedAudio() {

    if (!symbolDuration) {
        return;
    }


    const samplesPerSymbol =
        symbolDuration *
        actualSampleRate;


    /*
     * Process as many complete symbols
     * as are currently available.
     */

    while (
        true
    ) {

        const start =
            Math.round(
                decodePosition
            );


        const end =
            Math.round(
                decodePosition +
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


            symbolBuffer.push(
                result.symbol
            );


            decodeSymbols();
        }


        decodePosition +=
            samplesPerSymbol;


        /*
         * If we have consumed a lot of
         * samples, remove them from the
         * beginning.
         */

        if (
            decodePosition >
            4096
        ) {

            const remove =
                Math.floor(
                    decodePosition
                );


            sampleBuffer =
                sampleBuffer.slice(
                    remove
                );


            decodePosition -=
                remove;
        }
    }
}


/* ============================================================
   16-FSK DETECTOR
   ============================================================ */

function detectFrequency(
    samples
) {

    if (
        !samples ||
        samples.length < 16
    ) {

        return null;
    }


    /*
     * Calculate total signal energy.
     */

    let energy =
        0;


    for (
        const sample
        of samples
    ) {

        energy +=
            sample * sample;
    }


    if (
        energy <
        0.0000005
    ) {

        return null;
    }


    let bestSymbol =
        -1;

    let bestPower =
        -Infinity;

    let secondPower =
        -Infinity;


    /*
     * Test all 16 possible frequencies.
     */

    for (
        let symbol = 0;
        symbol < 16;
        symbol++
    ) {

        const frequency =
            FREQUENCIES[
                symbol
            ];


        const power =
            frequencyPower(
                samples,
                frequency
            );


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


    if (
        bestSymbol < 0
    ) {

        return null;
    }


    /*
     * How much stronger is the winning
     * frequency than the runner-up?
     */

    const dominance =
        bestPower /
        (
            secondPower +
            0.0000001
        );


    /*
     * Convert dominance into 0-1.
     */

    const confidence =
        Math.min(
            1,
            Math.max(
                0,
                (
                    dominance - 1
                ) / 2
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


/* ============================================================
   FREQUENCY POWER
   ============================================================ */

function frequencyPower(
    samples,
    frequency
) {

    let cosineSum =
        0;

    let sineSum =
        0;


    /*
     * Direct correlation.
     *
     * Unlike the old Goertzel implementation,
     * this does NOT round frequencies to FFT bins.
     */

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
            Math.cos(
                phase
            );


        sineSum +=
            samples[i] *
            Math.sin(
                phase
            );
    }


    return (
        cosineSum *
        cosineSum +
        sineSum *
        sineSum
    );
}


/* ============================================================
   SIGNAL UI
   ============================================================ */

function updateSignal(
    value
) {

    const rounded =
        Math.max(
            0,
            Math.min(
                100,
                Math.round(value)
            )
        );


    signalStrength.textContent =
        `${rounded}%`;


    signalFill.style.width =
        `${rounded}%`;
}


/* ============================================================
   SYMBOL DECODER
   ============================================================ */

function decodeSymbols() {

    symbolsReceived.textContent =
        symbolBuffer.length
            .toLocaleString();


    /*
     * Header comes first.
     */

    if (!detectedHeader) {

        tryFindHeader();

        return;
    }


    /*
     * Header already decoded.
     */

    decodePayload();
}


/* ============================================================
   HEADER DETECTION
   ============================================================ */

function tryFindHeader() {

    /*
     * SCX2 is:
     *
     * S = 0x53 = 5,3
     * C = 0x43 = 4,3
     * X = 0x58 = 5,8
     * 2 = 0x32 = 3,2
     *
     * Therefore:
     *
     * 5,3,4,3,5,8,3,2
     */

    const magic = [
        5,
        3,
        4,
        3,
        5,
        8,
        3,
        2
    ];


    /*
     * Need enough symbols to search.
     */

    if (
        symbolBuffer.length <
        magic.length
    ) {

        return;
    }


    /*
     * Search for SCX2.
     */

    for (
        let i = 0;
        i <=
        symbolBuffer.length -
        magic.length;
        i++
    ) {

        let match =
            true;


        for (
            let j = 0;
            j < magic.length;
            j++
        ) {

            if (
                symbolBuffer[
                    i + j
                ] !==
                magic[j]
            ) {

                match =
                    false;

                break;
            }
        }


        if (match) {

            /*
             * Throw away anything before
             * the header.
             */

            symbolBuffer =
                symbolBuffer.slice(
                    i
                );


            parseHeader();

            return;
        }
    }


    /*
     * Prevent unlimited growth.
     */

    if (
        symbolBuffer.length >
        2000
    ) {

        symbolBuffer =
            symbolBuffer.slice(
                -100
            );
    }
}


/* ============================================================
   HEADER
   ============================================================ */

function parseHeader() {

    const bytes =
        symbolsToBytes(
            symbolBuffer
        );


    /*
     * Need:
     *
     * SCX2
     * version
     * name length
     */

    if (
        bytes.length <
        7
    ) {

        return;
    }


    /*
     * Verify SCX2.
     */

    if (
        bytes[0] !== 0x53 ||
        bytes[1] !== 0x43 ||
        bytes[2] !== 0x58 ||
        bytes[3] !== 0x32
    ) {

        return;
    }


    const version =
        bytes[4];


    if (
        version !== 2
    ) {

        log(
            `Unsupported protocol version: ${version}`
        );

        return;
    }


    let position =
        5;


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
        bytes[
            position + 1
        ];


    position += 2;


    /*
     * Wait for complete name.
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
        bytes[
            position + 1
        ];


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


    /*
     * MIME
     */

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
     * Header is now complete.
     *
     * Every byte = 2 symbols.
     */

    const headerSymbolCount =
        position * 2;


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


    detectedHeader =
        true;


    /*
     * UI
     */

    fileNameElement.textContent =
        fileName;


    expectedBytesElement.textContent =
        formatBytes(
            expectedFileSize
        );


    previewStatus.textContent =
        "RECEIVING";


    log(
        `SONICCRYPT transmission detected: ${fileName}`
    );


    log(
        `Expected size: ${formatBytes(
            expectedFileSize
        )}`
    );


    log(
        `MIME type: ${mimeType}`
    );


    log(
        `CRC32: ${expectedCRC
            .toString(16)
            .padStart(8, "0")}`
    );


    /*
     * Decode any payload already waiting.
     */

    decodePayload();
}


/* ============================================================
   SYMBOLS -> BYTES
   ============================================================ */

function symbolsToBytes(
    symbols
) {

    const bytes =
        [];


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
            symbols[
                i + 1
            ]
        );
    }


    return bytes;
}


/* ============================================================
   PAYLOAD DECODER
   ============================================================ */

function decodePayload() {

    /*
     * Convert symbols into bits.
     */

    while (
        symbolBuffer.length > 0
    ) {

        const symbol =
            symbolBuffer.shift();


        payloadBitBuffer.push(

            (symbol >> 3) & 1,

            (symbol >> 2) & 1,

            (symbol >> 1) & 1,

            symbol & 1
        );


        /*
         * Every byte requires exactly
         * 13 bits.
         */

        while (
            payloadBitBuffer.length >=
            13
        ) {

            /*
             * First 5 bits are random.
             */

            let value =
                0;


            /*
             * Last 8 bits are the
             * original byte.
             */

            for (
                let i = 5;
                i < 13;
                i++
            ) {

                value =
                    (
                        value << 1
                    ) |
                    payloadBitBuffer[
                        i
                    ];
            }


            /*
             * Remove the complete
             * 13-bit block.
             */

            payloadBitBuffer.splice(
                0,
                13
            );


            receivedBytes.push(
                value
            );


            /*
             * Complete?
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


/* ============================================================
   RECEIVE PROGRESS
   ============================================================ */

function updateReceiveProgress() {

    if (
        !expectedFileSize
    ) {

        return;
    }


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
        formatBytes(
            count
        );


    receivedText.textContent =
        `${formatBytes(
            count
        )} / ${formatBytes(
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
        `${formatBytes(
            speed
        )}/s`;
}


/* ============================================================
   LIVE IMAGE PREVIEW
   ============================================================ */

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

        previewStatus.textContent =
            `${formatBytes(
                receivedBytes.length
            )} received`;

        return;
    }


    /*
     * Browser may not render an image until
     * enough of the file has arrived.
     */

    if (
        receivedBytes.length <
        64
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
        /* Keep receiving. */
    }
}


/* ============================================================
   FINISH
   ============================================================ */

function finishReception() {

    const data =
        new Uint8Array(
            receivedBytes.slice(
                0,
                expectedFileSize
            )
        );


    const actualCRC =
        crc32(
            data
        );


    updateReceiveProgress();


    /*
     * Verify checksum.
     */

    if (
        actualCRC !==
        expectedCRC
    ) {

        statusElement.textContent =
            "CHECKSUM ERROR";


        previewStatus.textContent =
            "Data received, but CRC32 failed.";


        log(
            "CRC32 CHECKSUM ERROR."
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


    /*
     * Success.
     */

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


    /*
     * Build final file.
     */

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


    /*
     * Display image.
     */

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


    /*
     * Download.
     */

    downloadButton.href =
        url;


    downloadButton.download =
        fileName ||
        "soniccrypt-file";


    downloadButton.style.display =
        "block";
}


/* ============================================================
   RESET
   ============================================================ */

function resetDecoder() {

    sampleBuffer = [];

    decodePosition = 0;


    synchronized =
        false;


    detectedMode =
        null;


    symbolDuration =
        null;


    symbolBuffer = [];


    detectedHeader =
        false;


    expectedFileSize =
        0;


    expectedCRC =
        0;


    fileName =
        "";


    mimeType =
        "";


    receivedBytes =
        [];


    payloadBitBuffer =
        [];


    lastPreviewUpdate =
        0;


    lastUiUpdate =
        0;


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


/* ============================================================
   CRC32
   ============================================================ */

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


/* ============================================================
   FORMAT BYTES
   ============================================================ */

function formatBytes(
    bytes
) {

    if (
        bytes === 0
    ) {

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
        " "
        +
        units[index]
    );
}


/* ============================================================
   INITIALIZATION
   ============================================================ */

stopButton.disabled =
    true;


log(
    "SONICCRYPT receiver initialized."
);


log(
    "16-FSK decoder ready."
);


log(
    "Automatic TURBO / RELIABLE detection enabled."
);


log(
    "Waiting for SONICCRYPT sync signal..."
);
