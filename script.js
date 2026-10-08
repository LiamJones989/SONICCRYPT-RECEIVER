/*
============================================================
SONICCRYPT RECEIVER
============================================================

Compatible with SONICCRYPT 16-FSK sender.

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

TURBO    = 3 ms / symbol
RELIABLE = 6 ms / symbol

HEADER:

SCX1
version
filename
MIME type
file size
CRC32

PAYLOAD:

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

const MAGIC = [
    5, 3,
    4, 3,
    5, 8,
    3, 1
];


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

/*
 * Float32Array chunks are stored here instead of constantly
 * creating enormous arrays.
 */

let sampleBuffer = [];

let decodePosition = 0;


/* =========================================================
   RECEIVER STATE
========================================================= */

let listening = false;
let synchronized = false;

let detectedMode = null;
let symbolDuration = 0;

let synchronizationLocked = false;


/*
 * We do not search every audio callback.
 */

let lastSyncAttempt = 0;


/*
 * Search interval.
 *
 * 120 ms is fast enough to catch a transmission quickly
 * without hammering the CPU.
 */

const SYNC_INTERVAL = 120;


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
   LIVE OBJECT URL
========================================================= */

let livePreviewUrl = null;


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

    if (!logElement) {
        return;
    }


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
     * Keep the log from becoming enormous.
     */

    while (
        logElement.children.length > 100
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

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            throw new Error(
                "This browser does not support microphone access."
            );
        }


        /*
         * Ask for the microphone.
         */

        mediaStream =
            await navigator.mediaDevices.getUserMedia({

                audio: {

                    channelCount: 1,

                    echoCancellation: false,

                    noiseSuppression: false,

                    autoGainControl: false
                }
            });


        /*
         * Let the browser choose the microphone's
         * native/available sample rate.
         */

        audioContext =
            new AudioContext();


        await audioContext.resume();


        actualSampleRate =
            audioContext.sampleRate;


        /*
         * Create microphone source.
         */

        microphone =
            audioContext
                .createMediaStreamSource(
                    mediaStream
                );


        /*
         * ScriptProcessor is used for broad browser
         * compatibility.
         */

        processor =
            audioContext
                .createScriptProcessor(
                    4096,
                    1,
                    1
                );


        /*
         * ZERO gain.
         *
         * This keeps the ScriptProcessor active without
         * playing the microphone through the speakers.
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
            `Microphone sample rate: ${actualSampleRate} Hz`
        );


        log(
            "Receiver is listening for SONICCRYPT."
        );


        log(
            "Searching for SCX1 synchronization..."
        );


    } catch (error) {

        console.error(error);


        statusElement.textContent =
            "MICROPHONE ERROR";


        log(
            "Microphone error: " +
            error.message
        );


        /*
         * Clean up anything that was created
         * before the error.
         */

        cleanupAudio();
    }
}


/* =========================================================
   STOP
========================================================= */

stopButton.onclick =
    stopListening;


function stopListening() {

    if (!listening) {
        return;
    }


    listening = false;


    cleanupAudio();


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
   AUDIO CLEANUP
========================================================= */

function cleanupAudio() {

    if (processor) {

        processor.onaudioprocess =
            null;

        try {
            processor.disconnect();
        } catch {}

        processor = null;
    }


    if (microphone) {

        try {
            microphone.disconnect();
        } catch {}

        microphone = null;
    }


    if (silentGain) {

        try {
            silentGain.disconnect();
        } catch {}

        silentGain = null;
    }


    if (mediaStream) {

        mediaStream
            .getTracks()
            .forEach(
                track => track.stop()
            );

        mediaStream = null;
    }


    if (audioContext) {

        try {
            audioContext.close();
        } catch {}

        audioContext = null;
    }
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
     * Signal meter.
     */

    updateRawSignal(
        input
    );


    /*
     * Copy microphone samples.
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
     * search for SCX1.
     */

    if (!synchronized) {

        trySynchronization();

        return;
    }


    /*
     * Once synchronized:
     * decode complete symbols.
     */

    decodeLockedAudio();
}


/* =========================================================
   SIGNAL METER
========================================================= */

function updateRawSignal(
    samples
) {

    let sum = 0;
    let peak = 0;


    for (
        let i = 0;
        i < samples.length;
        i++
    ) {

        const value =
            samples[i];


        sum +=
            value * value;


        const absolute =
            Math.abs(value);


        if (
            absolute > peak
        ) {

            peak =
                absolute;
        }
    }


    const rms =
        Math.sqrt(
            sum /
            Math.max(
                1,
                samples.length
            )
        );


    /*
     * This is only a visual meter.
     *
     * It is NOT used as the actual decoder
     * threshold.
     */

    let percentage =
        rms * 450;


    percentage =
        Math.max(
            percentage,
            peak * 130
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


    if (
        now - lastSyncAttempt <
        SYNC_INTERVAL
    ) {

        trimSearchBuffer();

        return;
    }


    lastSyncAttempt =
        now;


    /*
     * Need enough audio before searching.
     */

    if (
        sampleBuffer.length <
        Math.floor(
            actualSampleRate * 0.035
        )
    ) {

        return;
    }


    /*
     * Try TURBO first.
     */

    const turbo =
        searchForMagic(
            SYMBOL_DURATIONS.turbo
        );


    if (turbo) {

        lockReceiver(
            turbo,
            "turbo"
        );

        return;
    }


    /*
     * Try RELIABLE.
     */

    const reliable =
        searchForMagic(
            SYMBOL_DURATIONS.reliable
        );


    if (reliable) {

        lockReceiver(
            reliable,
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


    const requiredSamples =
        Math.ceil(
            samplesPerSymbol *
            MAGIC.length
        );


    if (
        sampleBuffer.length <
        requiredSamples
    ) {

        return null;
    }


    /*
     * Only search the most recent
     * 350 milliseconds.
     */

    const maxSearchSamples =
        Math.floor(
            actualSampleRate *
            0.35
        );


    const startSearch =
        Math.max(
            0,
            sampleBuffer.length -
            maxSearchSamples -
            requiredSamples
        );


    const endSearch =
        sampleBuffer.length -
        requiredSamples;


    /*
     * We do not need single-sample
     * precision initially.
     *
     * Search every 4 samples.
     */

    const step = 4;


    let bestResult = null;


    for (
        let offset = startSearch;
        offset <= endSearch;
        offset += step
    ) {

        const result =
            scoreMagicAtOffset(
                offset,
                samplesPerSymbol
            );


        if (!result) {
            continue;
        }


        /*
         * Require a strong match.
         */

        if (
            result.score >= 0.72
        ) {

            /*
             * Keep the best candidate instead
             * of immediately accepting the first.
             */

            if (
                !bestResult ||
                result.score >
                bestResult.score
            ) {

                bestResult = {
                    offset,
                    samplesPerSymbol,
                    score: result.score
                };
            }
        }
    }


    if (!bestResult) {
        return null;
    }


    /*
     * Refine timing around the best position.
     *
     * This fixes the problem where the initial
     * search was a few samples off.
     */

    const refined =
        refineSynchronization(
            bestResult.offset,
            samplesPerSymbol
        );


    if (refined) {

        return {
            offset: refined.offset,
            samplesPerSymbol,
            score: refined.score
        };
    }


    return bestResult;
}


/* =========================================================
   SCORE MAGIC
========================================================= */

function scoreMagicAtOffset(
    offset,
    samplesPerSymbol
) {

    let matches = 0;
    let totalConfidence = 0;


    for (
        let i = 0;
        i < MAGIC.length;
        i++
    ) {

        /*
         * Analyze only the middle
         * 70% of the symbol.
         *
         * This avoids the transition between
         * adjacent frequencies.
         */

        const symbolStart =
            offset +
            Math.round(
                i *
                samplesPerSymbol
            );


        const symbolEnd =
            offset +
            Math.round(
                (i + 1) *
                samplesPerSymbol
            );


        const length =
            symbolEnd -
            symbolStart;


        const innerStart =
            symbolStart +
            Math.round(
                length * 0.15
            );


        const innerEnd =
            symbolEnd -
            Math.round(
                length * 0.15
            );


        if (
            innerEnd <= innerStart ||
            innerEnd > sampleBuffer.length
        ) {

            return null;
        }


        const detected =
            detectFrequencyRange(
                sampleBuffer,
                innerStart,
                innerEnd
            );


        if (!detected) {
            return null;
        }


        if (
            detected.symbol ===
            MAGIC[i]
        ) {

            matches++;
        }


        totalConfidence +=
            detected.confidence;
    }


    const accuracy =
        matches /
        MAGIC.length;


    const confidence =
        totalConfidence /
        MAGIC.length;


    /*
     * Matching symbols are more important
     * than raw confidence.
     */

    const score =
        accuracy * 0.80 +
        confidence * 0.20;


    return {
        score,
        accuracy,
        confidence
    };
}


/* =========================================================
   REFINE SYNCHRONIZATION
========================================================= */

function refineSynchronization(
    centerOffset,
    samplesPerSymbol
) {

    let best = null;


    /*
     * Check +/- 12 samples around
     * the original location.
     */

    for (
        let adjustment = -12;
        adjustment <= 12;
        adjustment++
    ) {

        const offset =
            centerOffset +
            adjustment;


        if (
            offset < 0
        ) {
            continue;
        }


        const result =
            scoreMagicAtOffset(
                offset,
                samplesPerSymbol
            );


        if (!result) {
            continue;
        }


        if (
            !best ||
            result.score >
            best.score
        ) {

            best = {
                offset,
                score: result.score
            };
        }
    }


    if (
        best &&
        best.score >= 0.72
    ) {

        return best;
    }


    return null;
}


/* =========================================================
   LOCK RECEIVER
========================================================= */

function lockReceiver(
    result,
    mode
) {

    synchronized = true;
    synchronizationLocked = true;


    detectedMode =
        mode;


    symbolDuration =
        SYMBOL_DURATIONS[mode];


    const samplesPerSymbol =
        symbolDuration *
        actualSampleRate;


    /*
     * Remove everything through SCX1.
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


    decodePosition = 0;


    /*
     * Reconstruct the SCX1 header
     * so the normal header decoder sees it.
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
        `SYNC CONFIDENCE: ${
            (
                result.score *
                100
            ).toFixed(1)
        }%`
    );


    log(
        "Receiving header..."
    );


    /*
     * Decode any complete symbols already
     * available.
     */

    decodeLockedAudio();
}


/* =========================================================
   TRIM SEARCH BUFFER
========================================================= */

function trimSearchBuffer() {

    /*
     * Keep the newest 400 ms.
     */

    const maximum =
        Math.floor(
            actualSampleRate *
            0.4
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

    if (
        !synchronized ||
        !symbolDuration
    ) {

        return;
    }


    const samplesPerSymbol =
        symbolDuration *
        actualSampleRate;


    /*
     * Decode as many complete symbols
     * as possible.
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


        /*
         * Analyze the middle 70%.
         */

        const innerStart =
            start +
            Math.round(
                (end - start) *
                0.15
            );


        const innerEnd =
            end -
            Math.round(
                (end - start) *
                0.15
            );


        const result =
            detectFrequencyRange(
                sampleBuffer,
                innerStart,
                innerEnd
            );


        if (result) {

            symbolBuffer.push(
                result.symbol
            );


            frequencyElement.textContent =
                `${result.frequency} Hz`;


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
     * Periodically discard consumed samples.
     */

    if (
        decodePosition >
        16384
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
   FREQUENCY DETECTOR
========================================================= */

function detectFrequencyRange(
    buffer,
    start,
    end
) {

    const length =
        end - start;


    if (
        length < 16
    ) {

        return null;
    }


    /*
     * Calculate total signal energy.
     */

    let energy = 0;


    for (
        let i = start;
        i < end;
        i++
    ) {

        const value =
            buffer[i];


        energy +=
            value * value;
    }


    const rms =
        Math.sqrt(
            energy /
            length
        );


    /*
     * Ignore silence / extremely weak
     * microphone noise.
     */

    if (
        rms < 0.0015
    ) {

        return null;
    }


    let bestSymbol = -1;
    let bestPower = -Infinity;

    let secondPower =
        -Infinity;


    /*
     * Test all 16 FSK frequencies.
     */

    for (
        let symbol = 0;
        symbol < 16;
        symbol++
    ) {

        const power =
            goertzelPower(
                buffer,
                start,
                end,
                FREQUENCIES[symbol]
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
     * Compare winning frequency against
     * the runner-up.
     */

    const dominance =
        bestPower /
        (
            secondPower +
            0.0000001
        );


    let confidence =
        (
            dominance -
            1
        ) / 2;


    confidence =
        Math.max(
            0,
            Math.min(
                1,
                confidence
            )
        );


    /*
     * Reject extremely ambiguous signals.
     *
     * During normal decoding we want
     * reasonably clean tones.
     */

    if (
        confidence < 0.08
    ) {

        return null;
    }


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
   GOERTZEL FREQUENCY DETECTION
========================================================= */

function goertzelPower(
    buffer,
    start,
    end,
    frequency
) {

    const length =
        end - start;


    /*
     * Goertzel is significantly cheaper
     * than calculating sine/cosine for
     * every sample and every frequency.
     */

    const k =
        Math.round(
            (
                length *
                frequency
            ) /
            actualSampleRate
        );


    const targetFrequency =
        (
            k *
            actualSampleRate
        ) /
        length;


    const omega =
        (
            2 *
            Math.PI *
            targetFrequency
        ) /
        actualSampleRate;


    const coefficient =
        2 *
        Math.cos(
            omega
        );


    let s1 = 0;
    let s2 = 0;


    for (
        let i = start;
        i < end;
        i++
    ) {

        const sample =
            buffer[i];


        const s =
            sample +
            coefficient *
            s1 -
            s2;


        s2 =
            s1;


        s1 =
            s;
    }


    return (
        s1 * s1 +
        s2 * s2 -
        coefficient *
        s1 *
        s2
    );
}


/* =========================================================
   SIGNAL UI
========================================================= */

function updateSignal(
    value
) {

    if (
        !signalStrength ||
        !signalFill
    ) {

        return;
    }


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

    if (symbolsReceived) {

        symbolsReceived.textContent =
            symbolBuffer.length
                .toLocaleString();
    }


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

    const bytes =
        symbolsToBytes(
            symbolBuffer
        );


    /*
     * Minimum:
     *
     * SCX1
     * version
     * filename length
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
         * Something went wrong after
         * synchronization.
         *
         * Do not crash.
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


    let position = 5;


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
        bytes[position + 1];


    position += 2;


    /*
     * Sanity check.
     */

    if (
        nameLength < 0 ||
        nameLength > 65535
    ) {

        return;
    }


    /*
     * Wait for complete filename.
     */

    if (
        bytes.length <
        position +
        nameLength +
        2
    ) {

        return;
    }


    try {

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

    } catch {

        fileName =
            "soniccrypt-file";
    }


    position +=
        nameLength;


    /*
     * MIME length.
     */

    const mimeLength =
        (
            bytes[position] << 8
        ) |
        bytes[position + 1];


    position += 2;


    /*
     * Need:
     *
     * MIME
     * 4 byte file size
     * 4 byte CRC
     */

    if (
        bytes.length <
        position +
        mimeLength +
        8
    ) {

        return;
    }


    try {

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

    } catch {

        mimeType =
            "application/octet-stream";
    }


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
     * Sanity check.
     */

    if (
        expectedFileSize >
        0x7fffffff
    ) {

        log(
            "Invalid file size in header."
        );

        return;
    }


    /*
     * Header is complete.
     *
     * Every byte uses two 16-FSK symbols.
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
     * Remove header symbols.
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

    if (fileNameElement) {

        fileNameElement.textContent =
            fileName;
    }


    if (expectedBytesElement) {

        expectedBytesElement.textContent =
            formatBytes(
                expectedFileSize
            );
    }


    if (previewStatus) {

        previewStatus.textContent =
            "RECEIVING";
    }


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
     * Immediately decode payload symbols
     * that arrived with the header.
     */

    decodePayload();
}


/* =========================================================
   SYMBOLS TO BYTES
========================================================= */

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


/* =========================================================
   PAYLOAD
========================================================= */

function decodePayload() {

    /*
     * Convert each 16-FSK symbol into
     * four bits.
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
     * These symbols have now been consumed.
     */

    symbolBuffer = [];


    /*
     * Decode complete 13-bit blocks.
     *
     * [5 random bits][8 data bits]
     */

    while (
        payloadBits.length >= 13
    ) {

        let value = 0;


        /*
         * Skip first five random bits.
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
     * Don't update the DOM excessively.
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
        ) * 100;


    if (receiveFill) {

        receiveFill.style.width =
            `${percent}%`;
    }


    if (receivePercent) {

        receivePercent.textContent =
            `${percent.toFixed(1)}%`;
    }


    if (receivedBytesElement) {

        receivedBytesElement.textContent =
            formatBytes(
                count
            );
    }


    if (receivedText) {

        receivedText.textContent =
            `${formatBytes(
                count
            )} / ${formatBytes(
                expectedFileSize
            )}`;
    }


    const elapsed =
        (
            now -
            receiveStartTime
        ) / 1000;


    const speed =
        elapsed > 0
            ? count / elapsed
            : 0;


    if (receiveSpeed) {

        receiveSpeed.textContent =
            `${formatBytes(
                speed
            )}/s`;
    }
}


/* =========================================================
   LIVE IMAGE PREVIEW
========================================================= */

function updateLivePreview() {

    const now =
        performance.now();


    /*
     * Don't rebuild the image constantly.
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
        !mimeType ||
        !mimeType.startsWith(
            "image/"
        )
    ) {

        return;
    }


    /*
     * Very small incomplete images are
     * not useful to decode.
     */

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

                if (
                    livePreviewUrl
                ) {

                    URL.revokeObjectURL(
                        livePreviewUrl
                    );
                }


                livePreviewUrl =
                    url;


                if (receivedImage) {

                    receivedImage.src =
                        url;


                    receivedImage.style.display =
                        "block";
                }


                if (previewStatus) {

                    previewStatus.textContent =
                        "LIVE IMAGE PREVIEW";
                }
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
         * Keep receiving even if the
         * preview cannot be decoded yet.
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


    /*
     * Verify CRC32.
     */

    const actualCRC =
        crc32(
            data
        );


    if (
        actualCRC !==
        expectedCRC
    ) {

        statusElement.textContent =
            "CHECKSUM ERROR";


        if (previewStatus) {

            previewStatus.textContent =
                "Checksum failed.";
        }


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


    if (receiveFill) {

        receiveFill.style.width =
            "100%";
    }


    if (receivePercent) {

        receivePercent.textContent =
            "100%";
    }


    if (receivedBytesElement) {

        receivedBytesElement.textContent =
            formatBytes(
                expectedFileSize
            );
    }


    if (receivedText) {

        receivedText.textContent =
            `${formatBytes(
                expectedFileSize
            )} / ${formatBytes(
                expectedFileSize
            )}`;
    }


    if (previewStatus) {

        previewStatus.textContent =
            "FILE RECEIVED SUCCESSFULLY";
    }


    log(
        "TRANSMISSION COMPLETE."
    );


    log(
        "CRC32 VERIFIED SUCCESSFULLY."
    );


    /*
     * Stop decoding once the file
     * has completely arrived.
     */

    synchronized = false;
    synchronizationLocked = false;


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
     * Show final image.
     */

    if (
        mimeType.startsWith(
            "image/"
        )
    ) {

        if (
            livePreviewUrl
        ) {

            URL.revokeObjectURL(
                livePreviewUrl
            );

            livePreviewUrl =
                null;
        }


        if (receivedImage) {

            receivedImage.src =
                url;


            receivedImage.style.display =
                "block";
        }
    }


    /*
     * Download button.
     */

    if (downloadButton) {

        downloadButton.href =
            url;


        downloadButton.download =
            fileName ||
            "soniccrypt-file";


        downloadButton.style.display =
            "block";
    }
}


/* =========================================================
   RESET
========================================================= */

function resetReceiver() {

    sampleBuffer = [];

    decodePosition = 0;

    symbolBuffer = [];

    payloadBits = [];

    receivedBytes = [];


    synchronized = false;

    synchronizationLocked = false;

    detectedMode = null;

    symbolDuration = 0;


    detectedHeader = false;


    expectedFileSize = 0;

    expectedCRC = 0;


    fileName = "";

    mimeType = "";


    lastSyncAttempt = 0;

    lastPreviewUpdate = 0;

    lastUiUpdate = 0;


    if (livePreviewUrl) {

        URL.revokeObjectURL(
            livePreviewUrl
        );

        livePreviewUrl =
            null;
    }


    if (fileNameElement) {

        fileNameElement.textContent =
            "Waiting for SONICCRYPT...";
    }


    if (receivedText) {

        receivedText.textContent =
            "0 B / 0 B";
    }


    if (receivedBytesElement) {

        receivedBytesElement.textContent =
            "0 B";
    }


    if (expectedBytesElement) {

        expectedBytesElement.textContent =
            "0 B";
    }


    if (receiveSpeed) {

        receiveSpeed.textContent =
            "0 B/s";
    }


    if (receivePercent) {

        receivePercent.textContent =
            "0%";
    }


    if (receiveFill) {

        receiveFill.style.width =
            "0%";
    }


    if (frequencyElement) {

        frequencyElement.textContent =
            "---";
    }


    if (symbolsReceived) {

        symbolsReceived.textContent =
            "0";
    }


    if (previewStatus) {

        previewStatus.textContent =
            "Waiting for data...";
    }


    if (receivedImage) {

        receivedImage.style.display =
            "none";

        receivedImage.removeAttribute(
            "src"
        );
    }


    if (downloadButton) {

        downloadButton.style.display =
            "none";

        downloadButton.removeAttribute(
            "href"
        );
    }
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
        !Number.isFinite(bytes) ||
        bytes <= 0
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
        Math.min(
            units.length - 1,
            Math.floor(
                Math.log(bytes) /
                Math.log(1024)
            )
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
    "Adaptive 44.1/48 kHz microphone timing enabled."
);


log(
    "SCX1 synchronization engine ready."
);


log(
    "Press START LISTENING."
);
