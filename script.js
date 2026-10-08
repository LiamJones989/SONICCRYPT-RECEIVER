/*
============================================================
SONICCRYPT RECEIVER
============================================================

Compatible with the current SONICCRYPT sender.

16-FSK:

0  = 1000 Hz
1  = 1200 Hz
2  = 1400 Hz
3  = 1600 Hz
4  = 1800 Hz
5  = 2000 Hz
6  = 2200 Hz
7  = 2400 Hz
8  = 2600 Hz
9  = 2800 Hz
A  = 3000 Hz
B  = 3200 Hz
C  = 3400 Hz
D  = 3600 Hz
E  = 3800 Hz
F  = 4000 Hz

Sender modes:

TURBO    = 3 ms / symbol
RELIABLE = 6 ms / symbol

Header:

SCX1
version
filename
MIME type
file size
CRC32

Payload:

5 random bits + 8 data bits

============================================================
*/


/* =========================================================
   PROTOCOL
========================================================= */

const FREQUENCIES =
    Array.from(
        { length: 16 },
        (_, i) => 1000 + i * 200
    );


const SYMBOL_DURATIONS = {

    turbo: 0.003,

    reliable: 0.006
};


/*
 * SCX1 converted to 16-FSK symbols.
 *
 * S = 0x53 -> 5,3
 * C = 0x43 -> 4,3
 * X = 0x58 -> 5,8
 * 1 = 0x31 -> 3,1
 */

const MAGIC =
    [5, 3, 4, 3, 5, 8, 3, 1];


/* =========================================================
   AUDIO
========================================================= */

let audioContext = null;

let microphone = null;

let processor = null;

let silentGain = null;

let mediaStream = null;

let actualSampleRate = 48000;


/* =========================================================
   AUDIO BUFFER
========================================================= */

let sampleBuffer = [];

let decodePosition = 0;


/* =========================================================
   RECEIVER STATE
========================================================= */

let listening = false;

let synchronized = false;

let detectedMode = null;

let symbolDuration = 0;


/*
 * We only attempt synchronization periodically.
 *
 * This prevents the browser from constantly
 * performing expensive searches.
 */

let lastSyncAttempt = 0;


/* =========================================================
   SYMBOL DATA
========================================================= */

let symbolBuffer = [];


/* =========================================================
   PAYLOAD BIT BUFFER
========================================================= */

let payloadBits = [];


/* =========================================================
   FILE DATA
========================================================= */

let detectedHeader = false;

let expectedFileSize = 0;

let expectedCRC = 0;

let fileName = "";

let mimeType = "";

let receivedBytes = [];


/* =========================================================
   TIMING
========================================================= */

let receiveStartTime = 0;

let lastPreviewUpdate = 0;

let lastUiUpdate = 0;


/* =========================================================
   ELEMENTS
========================================================= */

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


/* =========================================================
   LOG
========================================================= */

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


    /*
     * Don't constantly force scrolling
     * while decoding.
     */

    if (
        logElement.children.length >
        100
    ) {

        logElement.removeChild(
            logElement.firstChild
        );
    }


    logElement.scrollTop =
        logElement.scrollHeight;
}


/* =========================================================
   START LISTENING
========================================================= */

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
         * Do NOT force a sample rate.
         *
         * The browser decides what the
         * microphone actually uses.
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


        /*
         * 4096 is intentionally kept here.
         *
         * The actual decoder does NOT analyze
         * all 4096 samples repeatedly.
         */

        processor =
            audioContext
                .createScriptProcessor(
                    4096,
                    1,
                    1
                );


        /*
         * Zero-gain output.
         *
         * This keeps ScriptProcessor alive
         * without feeding the microphone into
         * the speakers.
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


        resetReceiver();


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
            `Microphone rate: ${actualSampleRate} Hz`
        );


        log(
            "Waiting for SONICCRYPT SCX1..."
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


/* =========================================================
   STOP
========================================================= */

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

        mediaStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );

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


/* =========================================================
   AUDIO PROCESSING
========================================================= */

function processAudio(event) {

    if (!listening) {
        return;
    }


    const input =
        event.inputBuffer
            .getChannelData(0);


    /*
     * Update signal meter cheaply.
     */

    updateRawSignal(
        input
    );


    /*
     * Copy the new samples.
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
     * BEFORE LOCK
     *
     * Try to find SCX1.
     */

    if (!synchronized) {

        trySynchronization();

        return;
    }


    /*
     * AFTER LOCK
     *
     * Decode one symbol at a time.
     */

    decodeLockedAudio();
}


/* =========================================================
   SIGNAL METER
========================================================= */

function updateRawSignal(
    samples
) {

    let sum =
        0;


    let peak =
        0;


    for (
        let i = 0;
        i < samples.length;
        i++
    ) {

        const value =
            samples[i];


        sum +=
            value *
            value;


        const absolute =
            Math.abs(value);


        if (
            absolute >
            peak
        ) {

            peak =
                absolute;
        }
    }


    const rms =
        Math.sqrt(
            sum /
            samples.length
        );


    /*
     * Convert microphone level to
     * a readable percentage.
     */

    let percentage =
        rms * 300;


    /*
     * Peak helps quiet signals show up.
     */

    percentage =
        Math.max(
            percentage,
            peak * 100
        );


    percentage =
        Math.min(
            100,
            percentage
        );


    updateSignal(
        percentage
    );
}


/* =========================================================
   SYNCHRONIZATION
========================================================= */

function trySynchronization() {

    const now =
        performance.now();


    /*
     * Don't run synchronization every
     * microphone callback.
     */

    if (
        now -
        lastSyncAttempt <
        300
    ) {

        trimSearchBuffer();

        return;
    }


    lastSyncAttempt =
        now;


    /*
     * Try both sender modes.
     */

    const turboFound =
        searchForMagic(
            SYMBOL_DURATIONS.turbo
        );


    if (turboFound) {

        lockReceiver(
            turboFound,
            "turbo"
        );

        return;
    }


    const reliableFound =
        searchForMagic(
            SYMBOL_DURATIONS.reliable
        );


    if (reliableFound) {

        lockReceiver(
            reliableFound,
            "reliable"
        );

        return;
    }


    trimSearchBuffer();
}


/* =========================================================
   SEARCH FOR SCX1
========================================================= */

function searchForMagic(
    duration
) {

    const samplesPerSymbol =
        duration *
        actualSampleRate;


    const required =
        Math.ceil(
            samplesPerSymbol *
            MAGIC.length
        );


    /*
     * Need a complete SCX1 sequence.
     */

    if (
        sampleBuffer.length <
        required
    ) {

        return null;
    }


    /*
     * Only search the newest portion
     * of the buffer.
     */

    const searchLimit =
        Math.min(
            sampleBuffer.length -
            required,

            Math.floor(
                actualSampleRate *
                0.25
            )
        );


    /*
     * Instead of checking every sample,
     * check every 2 samples.
     *
     * This dramatically reduces CPU use.
     */

    for (
        let offset = 0;
        offset <= searchLimit;
        offset += 2
    ) {

        const score =
            scoreMagic(
                offset,
                samplesPerSymbol
            );


        if (
            score >=
            0.78
        ) {

            return {
                offset,
                samplesPerSymbol,
                score
            };
        }
    }


    return null;
}


/* =========================================================
   SCORE SCX1
========================================================= */

function scoreMagic(
    offset,
    samplesPerSymbol
) {

    let matches =
        0;


    let confidence =
        0;


    for (
        let i = 0;
        i < MAGIC.length;
        i++
    ) {

        const start =
            offset +
            Math.round(
                i *
                samplesPerSymbol
            );


        const end =
            offset +
            Math.round(
                (i + 1) *
                samplesPerSymbol
            );


        if (
            end >
            sampleBuffer.length
        ) {

            return 0;
        }


        const samples =
            sampleBuffer.slice(
                start,
                end
            );


        const detected =
            detectFrequency(
                samples
            );


        if (!detected) {

            return 0;
        }


        if (
            detected.symbol ===
            MAGIC[i]
        ) {

            matches++;
        }


        confidence +=
            detected.confidence;
    }


    const accuracy =
        matches /
        MAGIC.length;


    const averageConfidence =
        confidence /
        MAGIC.length;


    return (
        accuracy * 0.9 +
        averageConfidence * 0.1
    );
}


/* =========================================================
   LOCK RECEIVER
========================================================= */

function lockReceiver(
    result,
    mode
) {

    synchronized =
        true;


    detectedMode =
        mode;


    symbolDuration =
        mode === "turbo"
            ? SYMBOL_DURATIONS.turbo
            : SYMBOL_DURATIONS.reliable;


    const samplesPerSymbol =
        result.samplesPerSymbol;


    /*
     * Remove audio before and including
     * the SCX1 sequence.
     */

    const removeCount =
        Math.round(
            result.offset +
            samplesPerSymbol *
            MAGIC.length
        );


    sampleBuffer =
        sampleBuffer.slice(
            removeCount
        );


    decodePosition =
        0;


    /*
     * Reconstruct SCX1 in symbol form.
     */

    symbolBuffer =
        [...MAGIC];


    statusElement.textContent =
        "SYNCHRONIZED";


    log(
        "SONICCRYPT SCX1 DETECTED."
    );


    log(
        `MODE: ${mode.toUpperCase()}`
    );


    log(
        `SYMBOL TIME: ${
            (
                symbolDuration *
                1000
            ).toFixed(2)
        } ms`
    );


    log(
        "Receiving header..."
    );


    /*
     * Decode anything already
     * sitting in the buffer.
     */

    decodeLockedAudio();
}


/* =========================================================
   TRIM SEARCH BUFFER
========================================================= */

function trimSearchBuffer() {

    /*
     * Keep only the most recent
     * 300 milliseconds.
     */

    const maximum =
        Math.floor(
            actualSampleRate *
            0.3
        );


    if (
        sampleBuffer.length >
        maximum
    ) {

        sampleBuffer =
            sampleBuffer.slice(
                -maximum
            );
    }
}


/* =========================================================
   LOCKED AUDIO DECODER
========================================================= */

function decodeLockedAudio() {

    const samplesPerSymbol =
        symbolDuration *
        actualSampleRate;


    /*
     * Don't decode partial symbols.
     */

    while (
        sampleBuffer.length -
        decodePosition >=
        samplesPerSymbol
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

            symbolBuffer.push(
                result.symbol
            );


            frequencyElement.textContent =
                `${result.frequency} Hz`;


            /*
             * Only show confidence when
             * actually decoding a tone.
             */

            updateSignal(
                result.confidence *
                100
            );


            decodeSymbols();
        }


        decodePosition +=
            samplesPerSymbol;
    }


    /*
     * Periodically remove consumed samples.
     */

    if (
        decodePosition >
        8192
    ) {

        const consumed =
            Math.floor(
                decodePosition
            );


        sampleBuffer =
            sampleBuffer.slice(
                consumed
            );


        decodePosition -=
            consumed;
    }
}


/* =========================================================
   16-FSK DETECTOR
========================================================= */

function detectFrequency(
    samples
) {

    if (
        samples.length <
        16
    ) {

        return null;
    }


    /*
     * Calculate signal energy first.
     */

    let energy =
        0;


    for (
        let i = 0;
        i < samples.length;
        i++
    ) {

        energy +=
            samples[i] *
            samples[i];
    }


    if (
        energy <
        0.00001
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
     * Test the 16 possible frequencies.
     *
     * This is performed ONLY ONCE per
     * decoded symbol after synchronization.
     */

    for (
        let symbol = 0;
        symbol < 16;
        symbol++
    ) {

        const power =
            frequencyPower(
                samples,
                FREQUENCIES[
                    symbol
                ]
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
        bestSymbol ===
        -1
    ) {

        return null;
    }


    /*
     * How much stronger is the winning
     * frequency than the second-best?
     */

    const dominance =
        bestPower /
        (
            secondPower +
            0.000001
        );


    const confidence =
        Math.max(
            0,
            Math.min(
                1,
                (
                    dominance -
                    1
                ) /
                1.5
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


/* =========================================================
   FREQUENCY POWER
========================================================= */

function frequencyPower(
    samples,
    frequency
) {

    let cosine =
        0;


    let sine =
        0;


    const length =
        samples.length;


    /*
     * Direct correlation.
     *
     * Much simpler than repeatedly running
     * large searches over the entire buffer.
     */

    for (
        let i = 0;
        i < length;
        i++
    ) {

        const phase =
            (
                2 *
                Math.PI *
                frequency *
                i
            ) /
            actualSampleRate;


        cosine +=
            samples[i] *
            Math.cos(
                phase
            );


        sine +=
            samples[i] *
            Math.sin(
                phase
            );
    }


    return (
        cosine *
        cosine +
        sine *
        sine
    );
}


/* =========================================================
   SIGNAL UI
========================================================= */

function updateSignal(
    value
) {

    const percentage =
        Math.round(
            Math.max(
                0,
                Math.min(
                    100,
                    value
                )
            )
        );


    signalStrength.textContent =
        `${percentage}%`;


    signalFill.style.width =
        `${percentage}%`;
}


/* =========================================================
   SYMBOL DECODER
========================================================= */

function decodeSymbols() {

    symbolsReceived.textContent =
        symbolBuffer.length
            .toLocaleString();


    /*
     * Header not decoded yet.
     */

    if (
        !detectedHeader
    ) {

        parseHeader();

        return;
    }


    /*
     * Header is complete.
     */

    decodePayload();
}


/* =========================================================
   HEADER PARSER
========================================================= */

function parseHeader() {

    /*
     * Convert the symbols currently
     * available into bytes.
     */

    const bytes =
        symbolsToBytes(
            symbolBuffer
        );


    /*
     * Minimum:
     *
     * SCX1
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
     * Verify SCX1.
     */

    if (
        bytes[0] !== 0x53 ||
        bytes[1] !== 0x43 ||
        bytes[2] !== 0x58 ||
        bytes[3] !== 0x31
    ) {

        /*
         * This should never happen after
         * synchronization, but if it does,
         * don't crash the receiver.
         */

        return;
    }


    /*
     * Version.
     */

    if (
        bytes[4] !== 1
    ) {

        log(
            `Unsupported SONICCRYPT version: ${bytes[4]}`
        );

        return;
    }


    let position =
        5;


    /*
     * Filename length.
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


    position +=
        2;


    /*
     * Wait until the complete filename
     * has arrived.
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
     * MIME length.
     */

    const mimeLength =
        (
            bytes[position] << 8
        ) |
        bytes[
            position + 1
        ];


    position +=
        2;


    /*
     * Need MIME + size + CRC.
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
     * MIME type.
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


    position +=
        4;


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


    position +=
        4;


    /*
     * Header is complete.
     *
     * Every byte = two 16-FSK symbols.
     */

    const headerSymbols =
        position * 2;


    if (
        symbolBuffer.length <
        headerSymbols
    ) {

        return;
    }


    /*
     * Remove the header.
     */

    symbolBuffer =
        symbolBuffer.slice(
            headerSymbols
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
        `File detected: ${fileName}`
    );


    log(
        `Size: ${formatBytes(
            expectedFileSize
        )}`
    );


    log(
        `Type: ${mimeType}`
    );


    log(
        `Expected CRC32: ${
            expectedCRC
                .toString(16)
                .padStart(
                    8,
                    "0"
                )
        }`
    );


    log(
        "Receiving file data..."
    );


    /*
     * Immediately process payload
     * symbols that are already available.
     */

    decodePayload();
}


/* =========================================================
   SYMBOLS TO BYTES
========================================================= */

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


/* =========================================================
   PAYLOAD
========================================================= */

function decodePayload() {

    /*
     * IMPORTANT:
     *
     * Do NOT create a new bit array here.
     *
     * The previous receiver lost partial
     * 13-bit blocks between audio callbacks.
     *
     * We keep payloadBits globally.
     */

    for (
        const symbol
        of symbolBuffer
    ) {

        payloadBits.push(

            (symbol >> 3) & 1,

            (symbol >> 2) & 1,

            (symbol >> 1) & 1,

            symbol & 1
        );
    }


    /*
     * Those symbols have now been converted.
     */

    symbolBuffer =
        [];


    /*
     * Decode complete 13-bit blocks.
     */

    while (
        payloadBits.length >=
        13
    ) {

        let value =
            0;


        /*
         * Skip the first 5 random bits.
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
                payloadBits[i];
        }


        receivedBytes.push(
            value
        );


        /*
         * Remove exactly one
         * 13-bit block.
         */

        payloadBits.splice(
            0,
            13
        );


        /*
         * Complete file?
         */

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


/* =========================================================
   PROGRESS
========================================================= */

function updateReceiveProgress() {

    if (
        expectedFileSize <= 0
    ) {

        return;
    }


    const now =
        performance.now();


    /*
     * Don't update the DOM hundreds
     * of times per second.
     */

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


/* =========================================================
   LIVE IMAGE PREVIEW
========================================================= */

function updateLivePreview() {

    const now =
        performance.now();


    /*
     * Only try to update the image
     * once every 750 ms.
     */

    if (
        now -
        lastPreviewUpdate <
        750
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
        100
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


        const image =
            new Image();


        image.onload =
            () => {

                receivedImage.src =
                    url;


                receivedImage.style.display =
                    "block";


                previewStatus.textContent =
                    "LIVE IMAGE PREVIEW";
            };


        image.onerror =
            () => {

                URL.revokeObjectURL(
                    url
                );
            };


        image.src =
            url;


    } catch {
        /*
         * Keep receiving.
         */
    }
}


/* =========================================================
   FINISH
========================================================= */

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


    /*
     * Verify data.
     */

    if (
        actualCRC !==
        expectedCRC
    ) {

        statusElement.textContent =
            "CHECKSUM ERROR";


        previewStatus.textContent =
            "Checksum failed.";


        log(
            "CRC32 CHECKSUM ERROR."
        );


        log(
            `Expected: ${
                expectedCRC
                    .toString(16)
                    .padStart(
                        8,
                        "0"
                    )
            }`
        );


        log(
            `Received: ${
                actualCRC
                    .toString(16)
                    .padStart(
                        8,
                        "0"
                    )
            }`
        );


        return;
    }


    /*
     * SUCCESS
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
        "TRANSMISSION COMPLETE."
    );


    log(
        "CRC32 VERIFIED SUCCESSFULLY."
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


    /*
     * Show image.
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


/* =========================================================
   RESET
========================================================= */

function resetReceiver() {

    sampleBuffer =
        [];


    decodePosition =
        0;


    symbolBuffer =
        [];


    payloadBits =
        [];


    receivedBytes =
        [];


    synchronized =
        false;


    detectedMode =
        null;


    symbolDuration =
        0;


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


    lastSyncAttempt =
        0;


    lastPreviewUpdate =
        0;


    lastUiUpdate =
        0;


    fileNameElement.textContent =
        "Waiting for SONICCRYPT...";


    receivedText.textContent =
        "0 B / 0 B";


    receivedBytesElement.textContent =
        "0 B";


    expectedBytesElement.textContent =
        "0 B";


    receiveSpeed.textContent =
        "0 B/s";


    receivePercent.textContent =
        "0%";


    receiveFill.style.width =
        "0%";


    frequencyElement.textContent =
        "---";


    symbolsReceived.textContent =
        "0";


    previewStatus.textContent =
        "Waiting for data...";


    receivedImage.style.display =
        "none";


    receivedImage.removeAttribute(
        "src"
    );


    downloadButton.style.display =
        "none";
}


/* =========================================================
   CRC32
========================================================= */

function crc32(
    bytes
) {

    let crc =
        0xffffffff;


    for (
        const byte
        of bytes
    ) {

        crc ^=
            byte;


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


/* =========================================================
   FORMAT BYTES
========================================================= */

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


/* =========================================================
   INITIALIZATION
========================================================= */

stopButton.disabled =
    true;


log(
    "SONICCRYPT receiver initialized."
);


log(
    "16-FSK decoder ready."
);


log(
    "Turbo / Reliable automatic detection enabled."
);


log(
    "Receiver optimized for low CPU usage."
);


log(
    "Press START LISTENING."
);
