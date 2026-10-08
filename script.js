/*
============================================================
SONICCRYPT RECEIVER
============================================================

MATCHES THE CURRENT SONICCRYPT TRANSMITTER

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

CURRENT SENDER SPEEDS:

Turbo:
3 ms / symbol

Reliable:
6 ms / symbol

HEADER:

SCX1
version
filename
MIME type
file size
CRC32

PAYLOAD:

5 random bits
+
8 data bits

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


const MODES = {

    turbo: 0.003,

    reliable: 0.006
};


/*
 * SCX1 in hexadecimal:
 *
 * S = 0x53 = 5,3
 * C = 0x43 = 4,3
 * X = 0x58 = 5,8
 * 1 = 0x31 = 3,1
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

let symbolDuration = null;


/* =========================================================
   SYMBOL DATA
========================================================= */

let symbolBuffer = [];


/* =========================================================
   FILE DATA
========================================================= */

let detectedHeader = false;

let expectedFileSize = 0;

let expectedCRC = 0;

let fileName = "";

let mimeType = "";

let receivedBytes = [];

let payloadBits = [];


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


    logElement.scrollTop =
        logElement.scrollHeight;
}


/* =========================================================
   START
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
         * Keep ScriptProcessor alive without
         * playing microphone audio through
         * the speakers.
         */

        silentGain =
            audioContext.createGain();


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
            "Searching for SONICCRYPT SCX1 header..."
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
     * Always update the signal meter.
     *
     * This is separate from decoding.
     */

    updateRawSignal(
        input
    );


    /*
     * Copy samples.
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
     * search for SCX1.
     */

    if (!synchronized) {

        searchForHeader();

        return;
    }


    /*
     * Once synchronized,
     * decode symbols.
     */

    decodeIncomingSymbols();
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
        const sample
        of samples
    ) {

        const absolute =
            Math.abs(sample);


        sum +=
            sample * sample;


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
     * Logarithmic-ish microphone
     * signal meter.
     *
     * This makes normal microphone
     * levels visible instead of
     * showing 0%.
     */

    let percent =
        20 *
        Math.log10(
            1 +
            rms * 100
        );


    percent =
        Math.max(
            percent,
            peak * 80
        );


    percent =
        Math.min(
            100,
            percent
        );


    updateSignal(
        percent
    );
}


/* =========================================================
   SEARCH FOR SCX1
========================================================= */

function searchForHeader() {

    /*
     * We try both sender speeds.
     */

    const modes = [

        {
            name:
                "turbo",

            duration:
                MODES.turbo
        },

        {
            name:
                "reliable",

            duration:
                MODES.reliable
        }
    ];


    for (
        const mode
        of modes
    ) {

        const samplesPerSymbol =
            mode.duration *
            actualSampleRate;


        /*
         * We need at least the
         * 8-symbol SCX1 sequence.
         */

        const needed =
            Math.ceil(
                MAGIC.length *
                samplesPerSymbol
            );


        if (
            sampleBuffer.length <
            needed
        ) {

            continue;
        }


        /*
         * Search possible alignment.
         *
         * We don't assume the first microphone
         * sample is the beginning of a symbol.
         */

        const maxOffset =
            Math.min(
                Math.floor(
                    samplesPerSymbol
                ),

                1000
            );


        for (
            let offset = 0;
            offset < maxOffset;
            offset += 2
        ) {

            const result =
                testMagicAt(
                    offset,
                    samplesPerSymbol
                );


            if (
                result.score >=
                0.70
            ) {

                lockHeader(
                    offset,
                    samplesPerSymbol,
                    mode.name,
                    result
                );


                return;
            }
        }
    }


    /*
     * Keep only recent audio.
     */

    const maximum =
        Math.floor(
            actualSampleRate *
            0.5
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
   TEST MAGIC
========================================================= */

function testMagicAt(
    offset,
    samplesPerSymbol
) {

    let correct =
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

            return {
                score: 0
            };
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

            continue;
        }


        if (
            detected.symbol ===
            MAGIC[i]
        ) {

            correct++;
        }


        confidence +=
            detected.confidence;
    }


    const accuracy =
        correct /
        MAGIC.length;


    const averageConfidence =
        confidence /
        MAGIC.length;


    return {

        score:
            accuracy * 0.85 +
            averageConfidence * 0.15,

        accuracy
    };
}


/* =========================================================
   LOCK
========================================================= */

function lockHeader(
    offset,
    samplesPerSymbol,
    mode,
    result
) {

    synchronized =
        true;


    detectedMode =
        mode;


    symbolDuration =
        samplesPerSymbol /
        actualSampleRate;


    /*
     * Remove everything through SCX1.
     */

    const headerLength =
        Math.round(
            MAGIC.length *
            samplesPerSymbol
        );


    sampleBuffer =
        sampleBuffer.slice(
            offset +
            headerLength
        );


    decodePosition =
        0;


    /*
     * Put SCX1 into symbolBuffer
     * so the existing header parser
     * can use it.
     */

    symbolBuffer =
        [...MAGIC];


    statusElement.textContent =
        "SYNCHRONIZED";


    frequencyElement.textContent =
        "LOCKED";


    log(
        "SONICCRYPT SCX1 HEADER DETECTED."
    );


    log(
        `MODE: ${mode.toUpperCase()}`
    );


    log(
        `SYMBOL TIME: ${(symbolDuration * 1000).toFixed(2)} ms`
    );


    log(
        "Receiving header..."
    );


    /*
     * Continue decoding.
     */

    decodeIncomingSymbols();
}


/* =========================================================
   DECODE INCOMING SYMBOLS
========================================================= */

function decodeIncomingSymbols() {

    if (
        !symbolDuration
    ) {

        return;
    }


    const samplesPerSymbol =
        symbolDuration *
        actualSampleRate;


    while (true) {

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


        /*
         * Keep buffer small.
         */

        if (
            decodePosition >
            8192
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


    let bestSymbol =
        -1;


    let bestPower =
        -Infinity;


    let secondPower =
        -Infinity;


    /*
     * Check every possible frequency.
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
        bestSymbol <
        0
    ) {

        return null;
    }


    /*
     * Frequency confidence.
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
                    dominance - 1
                ) / 1.5
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
   FREQUENCY CORRELATION
========================================================= */

function frequencyPower(
    samples,
    frequency
) {

    let cosine =
        0;


    let sine =
        0;


    for (
        let i = 0;
        i < samples.length;
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

    const rounded =
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
        `${rounded}%`;


    signalFill.style.width =
        `${rounded}%`;
}


/* =========================================================
   SYMBOL DECODER
========================================================= */

function decodeSymbols() {

    symbolsReceived.textContent =
        symbolBuffer.length
            .toLocaleString();


    /*
     * Find SCX1/header.
     */

    if (
        !detectedHeader
    ) {

        parseHeader();

        return;
    }


    /*
     * Decode payload.
     */

    decodePayload();
}


/* =========================================================
   HEADER
========================================================= */

function parseHeader() {

    const bytes =
        symbolsToBytes(
            symbolBuffer
        );


    /*
     * Need enough data to start
     * reading the header.
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

        return;
    }


    /*
     * Version.
     */

    if (
        bytes[4] !== 1
    ) {

        log(
            "Unsupported SONICCRYPT version."
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
     * Need complete filename.
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
     * Each byte is represented by
     * TWO 16-FSK symbols.
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
     * Remove header from symbol buffer.
     */

    symbolBuffer =
        symbolBuffer.slice(
            headerSymbolCount
        );


    detectedHeader =
        true;


    /*
     * UI.
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
        `File size: ${formatBytes(
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
                symbols[i]
                << 4
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
     * Convert symbols to bits.
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
     * We consumed the symbols.
     */

    symbolBuffer =
        [];


    /*
     * Each original byte is:
     *
     * 5 random bits
     * +
     * 8 real bits
     *
     * = 13 bits
     */

    while (
        payloadBits.length >=
        13
    ) {

        let value =
            0;


        /*
         * Skip first 5 bits.
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


/* =========================================================
   LIVE IMAGE
========================================================= */

function updateLivePreview() {

    const now =
        performance.now();


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

        previewStatus.textContent =
            `${formatBytes(
                receivedBytes.length
            )} received`;

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


    updateReceiveProgress();


    /*
     * Verify CRC.
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


    previewStatus.textContent =
        "FILE RECEIVED SUCCESSFULLY";


    log(
        "TRANSMISSION COMPLETE."
    );


    log(
        "CRC32 VERIFIED."
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


/* =========================================================
   RESET
========================================================= */

function resetReceiver() {

    sampleBuffer = [];

    decodePosition = 0;


    synchronized =
        false;


    detectedMode =
        null;


    symbolDuration =
        null;


    symbolBuffer =
        [];


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


    payloadBits =
        [];


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
    "Waiting for SONICCRYPT SCX1 header..."
);
