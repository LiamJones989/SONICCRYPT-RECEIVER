/*
    SONICCRYPT RECEIVER

    Compatible with the current SONICCRYPT transmitter.

    TRANSMITTER:

        byte
          ↓
        8 bits
          ↓
        5 random bits + 8 data bits
          ↓
        13 bits
          ↓
        FSK
          ↓
        1200 Hz / 2200 Hz

    RECEIVER:

        microphone
          ↓
        audio samples
          ↓
        FSK detection
          ↓
        binary stream
          ↓
        remove 5 random bits
          ↓
        original bytes
          ↓
        image
*/


/* =========================================
   DOM
========================================= */

const startButton =
    document.getElementById(
        "startButton"
    );

const stopButton =
    document.getElementById(
        "stopButton"
    );

const connectionStatus =
    document.getElementById(
        "connectionStatus"
    );

const receiverState =
    document.getElementById(
        "receiverState"
    );

const signalText =
    document.getElementById(
        "signalText"
    );

const signalBar =
    document.getElementById(
        "signalBar"
    );

const signalPercent =
    document.getElementById(
        "signalPercent"
    );

const frequencyDisplay =
    document.getElementById(
        "frequency"
    );

const currentBit =
    document.getElementById(
        "currentBit"
    );

const bitsReceived =
    document.getElementById(
        "bitsReceived"
    );

const decodeStatus =
    document.getElementById(
        "decodeStatus"
    );

const decoderLog =
    document.getElementById(
        "decoderLog"
    );

const result =
    document.getElementById(
        "result"
    );

const receivedImage =
    document.getElementById(
        "receivedImage"
    );

const resultType =
    document.getElementById(
        "resultType"
    );

const resultSize =
    document.getElementById(
        "resultSize"
    );



/* =========================================
   SONICCRYPT SETTINGS
========================================= */

const FREQUENCY_0 = 1200;

const FREQUENCY_1 = 2200;

/*
    Must match the transmitter.
*/

const BIT_DURATION = 0.025;


/*
    How sensitive the signal detector is.
*/

const SIGNAL_THRESHOLD = 0.008;



/* =========================================
   AUDIO STATE
========================================= */

let audioContext = null;

let microphoneStream = null;

let microphoneSource = null;

let processor = null;

let recordedSamples = [];

let isListening = false;



/* =========================================
   START LISTENING
========================================= */

startButton.addEventListener(
    "click",
    startListening
);


async function startListening() {

    try {

        /*
            Request microphone permission.
        */

        microphoneStream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: {
                        channelCount: 1,

                        echoCancellation: false,

                        noiseSuppression: false,

                        autoGainControl: false
                    }
                });


        /*
            Create audio context.
        */

        audioContext =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();


        await audioContext.resume();


        /*
            Connect microphone.
        */

        microphoneSource =
            audioContext.createMediaStreamSource(
                microphoneStream
            );


        /*
            ScriptProcessorNode allows us
            to collect raw audio samples.
        */

        processor =
            audioContext.createScriptProcessor(
                4096,
                1,
                1
            );


        processor.onaudioprocess =
            handleAudio;


        microphoneSource.connect(
            processor
        );


        /*
            We do NOT connect the microphone
            to the speakers.

            This prevents feedback.
        */

        processor.connect(
            audioContext.destination
        );


        recordedSamples = [];

        isListening = true;


        startButton.disabled = true;

        stopButton.disabled = false;


        connectionStatus.classList.add(
            "active"
        );

        connectionStatus.innerHTML =
            "<span></span> MICROPHONE ACTIVE";


        receiverState.textContent =
            "LISTENING";

        decodeStatus.textContent =
            "CAPTURING";

        signalText.textContent =
            "LISTENING";


        writeLog(
            "Microphone initialized.\n" +
            "Waiting for SONICCRYPT signal..."
        );


    }
    catch (error) {

        console.error(error);

        alert(
            "Microphone access was denied or unavailable."
        );

    }
}



/* =========================================
   CAPTURE AUDIO
========================================= */

function handleAudio(event) {

    if (!isListening) {
        return;
    }


    const input =
        event.inputBuffer
            .getChannelData(0);


    /*
        Copy the samples.

        The browser reuses the original
        AudioBuffer, so we MUST copy them.
    */

    const copy =
        new Float32Array(
            input.length
        );

    copy.set(input);

    recordedSamples.push(copy);


    /*
        Calculate live signal level.
    */

    let sum = 0;

    for (let i = 0; i < input.length; i++) {

        sum +=
            input[i] *
            input[i];
    }


    const rms =
        Math.sqrt(
            sum / input.length
        );


    const percent =
        Math.min(
            100,
            Math.round(
                rms * 1000
            )
        );


    signalBar.style.width =
        percent + "%";

    signalPercent.textContent =
        percent + "%";


    if (
        rms >
        SIGNAL_THRESHOLD
    ) {

        signalText.textContent =
            "SIGNAL";

        receiverState.textContent =
            "SIGNAL DETECTED";

    }
}



/* =========================================
   STOP LISTENING
========================================= */

stopButton.addEventListener(
    "click",
    stopListening
);


async function stopListening() {

    if (!isListening) {
        return;
    }


    isListening = false;


    startButton.disabled = false;

    stopButton.disabled = true;


    receiverState.textContent =
        "PROCESSING";

    decodeStatus.textContent =
        "DECODING";

    signalText.textContent =
        "PROCESSING";


    /*
        Stop microphone.
    */

    if (processor) {

        processor.disconnect();

        processor.onaudioprocess =
            null;
    }


    if (microphoneSource) {

        microphoneSource.disconnect();
    }


    if (microphoneStream) {

        microphoneStream
            .getTracks()
            .forEach(
                track => track.stop()
            );
    }


    connectionStatus.classList.remove(
        "active"
    );

    connectionStatus.innerHTML =
        "<span></span> MICROPHONE OFF";


    /*
        Combine all captured chunks.
    */

    const audio =
        combineSamples(
            recordedSamples
        );


    writeLog(
        "Capture complete.\n" +
        "Samples: " +
        audio.length +
        "\n" +
        "Sample rate: " +
        audioContext.sampleRate +
        "\n\n" +
        "Searching for SONICCRYPT signal..."
    );


    /*
        Decode.
    */

    try {

        const decoded =
            decodeTransmission(
                audio,
                audioContext.sampleRate
            );


        if (!decoded) {

            throw new Error(
                "No valid image transmission found."
            );
        }


        displayResult(decoded);


    }
    catch (error) {

        console.error(error);

        receiverState.textContent =
            "FAILED";

        decodeStatus.textContent =
            "NO DATA";

        signalText.textContent =
            "FAILED";


        writeLog(
            "DECODING FAILED\n\n" +
            error.message +
            "\n\n" +
            "Make sure the transmitting speaker is\n" +
            "close enough to the microphone and\n" +
            "the volume is high enough."
        );

    }
}



/* =========================================
   COMBINE AUDIO CHUNKS
========================================= */

function combineSamples(chunks) {

    let totalLength = 0;


    for (const chunk of chunks) {

        totalLength +=
            chunk.length;
    }


    const combined =
        new Float32Array(
            totalLength
        );


    let offset = 0;


    for (const chunk of chunks) {

        combined.set(
            chunk,
            offset
        );

        offset +=
            chunk.length;
    }


    return combined;
}



/* =========================================
   MAIN DECODER
========================================= */

function decodeTransmission(
    samples,
    sampleRate
) {

    /*
        Remove silence surrounding
        the transmission.
    */

    const trimmed =
        trimSilence(samples);


    if (trimmed.length < 1000) {

        throw new Error(
            "Audio signal was too short."
        );
    }


    const samplesPerBit =
        Math.round(
            sampleRate *
            BIT_DURATION
        );


    writeLog(
        "Signal found.\n" +
        "Analyzing FSK data...\n" +
        "Samples per bit: " +
        samplesPerBit
    );


    /*
        Try several starting offsets.

        The microphone does not necessarily
        begin capturing exactly on a bit
        boundary.
    */

    const maximumOffset =
        Math.min(
            samplesPerBit,
            300
        );


    let bestResult = null;


    for (
        let offset = 0;
        offset < maximumOffset;
        offset += 4
    ) {

        const bits =
            demodulateFSK(
                trimmed,
                sampleRate,
                samplesPerBit,
                offset
            );


        if (
            bits.length <
            13 * 10
        ) {

            continue;
        }


        /*
            Try all 13 possible positions.

            One of these should correspond
            to the start of:

                [5 random][8 data]
        */

        for (
            let alignment = 0;
            alignment < 13;
            alignment++
        ) {

            const bytes =
                removePadding(
                    bits,
                    alignment
                );


            const detected =
                detectImage(
                    bytes
                );


            if (detected) {

                bestResult =
                    detected;

                break;
            }
        }


        if (bestResult) {
            break;
        }
    }


    if (!bestResult) {

        throw new Error(
            "Could not identify a valid image."
        );
    }


    return bestResult;
}



/* =========================================
   TRIM SILENCE
========================================= */

function trimSilence(samples) {

    const windowSize = 400;

    let start = 0;

    let end =
        samples.length - 1;


    /*
        Find beginning.
    */

    for (
        let i = 0;
        i < samples.length - windowSize;
        i += windowSize
    ) {

        let energy = 0;

        for (
            let j = 0;
            j < windowSize;
            j++
        ) {

            energy +=
                samples[i + j] *
                samples[i + j];
        }


        const rms =
            Math.sqrt(
                energy / windowSize
            );


        if (
            rms >
            SIGNAL_THRESHOLD
        ) {

            start = i;

            break;
        }
    }


    /*
        Find end.
    */

    for (
        let i = samples.length - windowSize;
        i > 0;
        i -= windowSize
    ) {

        let energy = 0;

        for (
            let j = 0;
            j < windowSize;
            j++
        ) {

            energy +=
                samples[i + j] *
                samples[i + j];
        }


        const rms =
            Math.sqrt(
                energy / windowSize
            );


        if (
            rms >
            SIGNAL_THRESHOLD
        ) {

            end =
                Math.min(
                    samples.length,
                    i + windowSize
                );

            break;
        }
    }


    return samples.slice(
        start,
        end
    );
}



/* =========================================
   FSK DEMODULATION
========================================= */

function demodulateFSK(
    samples,
    sampleRate,
    samplesPerBit,
    offset
) {

    const bits = [];


    for (
        let position = offset;

        position +
        samplesPerBit <=
        samples.length;

        position +=
            samplesPerBit
    ) {

        const bitSamples =
            samples.slice(
                position,
                position +
                samplesPerBit
            );


        const power0 =
            goertzel(
                bitSamples,
                sampleRate,
                FREQUENCY_0
            );


        const power1 =
            goertzel(
                bitSamples,
                sampleRate,
                FREQUENCY_1
            );


        const total =
            power0 +
            power1;


        /*
            Ignore extremely weak
            signal sections.
        */

        if (total < 0.000001) {

            bits.push(0);

            continue;
        }


        const bit =
            power1 > power0
                ? 1
                : 0;


        bits.push(bit);


        currentBit.textContent =
            bit;

        bitsReceived.textContent =
            bits.length;


        frequencyDisplay.textContent =
            bit === 1
                ? FREQUENCY_1 + " Hz"
                : FREQUENCY_0 + " Hz";
    }


    return bits;
}



/* =========================================
   GOERTZEL FREQUENCY DETECTOR
========================================= */

function goertzel(
    samples,
    sampleRate,
    targetFrequency
) {

    const k =
        Math.round(
            (
                samples.length *
                targetFrequency
            ) /
            sampleRate
        );


    const omega =
        (
            2 *
            Math.PI *
            k
        ) /
        samples.length;


    const cosine =
        Math.cos(omega);

    const coefficient =
        2 * cosine;


    let q0 = 0;

    let q1 = 0;

    let q2 = 0;


    for (
        let i = 0;
        i < samples.length;
        i++
    ) {

        q0 =
            coefficient *
            q1 -
            q2 +
            samples[i];

        q2 = q1;

        q1 = q0;
    }


    return (
        q1 * q1 +
        q2 * q2 -
        coefficient *
        q1 *
        q2
    );
}



/* =========================================
   REMOVE 5-BIT RANDOM PADDING
========================================= */

function removePadding(
    bits,
    alignment
) {

    const bytes = [];


    /*
        Protocol:

        5 random bits
        +
        8 actual data bits

        = 13 bits
    */


    for (
        let position =
            alignment;

        position + 13 <=
        bits.length;

        position += 13
    ) {

        /*
            Skip random 5 bits.
        */

        const dataStart =
            position + 5;


        let value = 0;


        /*
            Read 8 real data bits.
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
                bits[
                    dataStart + i
                ];
        }


        bytes.push(value);
    }


    return new Uint8Array(bytes);
}



/* =========================================
   IMAGE DETECTION
========================================= */

function detectImage(bytes) {

    /*
        PNG
    */

    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4E &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0D &&
        bytes[5] === 0x0A &&
        bytes[6] === 0x1A &&
        bytes[7] === 0x0A
    ) {

        const end =
            findPNGEnd(bytes);


        return {

            bytes:
                bytes.slice(
                    0,
                    end
                ),

            type:
                "image/png",

            name:
                "soniccrypt.png"
        };
    }


    /*
        JPEG
    */

    if (
        bytes.length >= 3 &&
        bytes[0] === 0xFF &&
        bytes[1] === 0xD8 &&
        bytes[2] === 0xFF
    ) {

        const end =
            findJPEGEnd(bytes);


        return {

            bytes:
                bytes.slice(
                    0,
                    end
                ),

            type:
                "image/jpeg",

            name:
                "soniccrypt.jpg"
        };
    }


    /*
        GIF
    */

    if (
        bytes.length >= 6 &&

        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&

        (
            bytes[3] === 0x38
        )
    ) {

        const end =
            findGIFEnd(bytes);


        return {

            bytes:
                bytes.slice(
                    0,
                    end
                ),

            type:
                "image/gif",

            name:
                "soniccrypt.gif"
        };
    }


    /*
        WEBP

        RIFF....WEBP
    */

    if (
        bytes.length >= 12 &&

        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&

        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {

        return {

            bytes,

            type:
                "image/webp",

            name:
                "soniccrypt.webp"
        };
    }


    return null;
}



/* =========================================
   PNG END
========================================= */

function findPNGEnd(bytes) {

    /*
        PNG ends with:

        49 45 4E 44
        CRC
    */

    for (
        let i = 8;
        i < bytes.length - 8;
        i++
    ) {

        if (
            bytes[i] === 0x49 &&
            bytes[i + 1] === 0x45 &&
            bytes[i + 2] === 0x4E &&
            bytes[i + 3] === 0x44
        ) {

            return Math.min(
                bytes.length,
                i + 12
            );
        }
    }


    return bytes.length;
}



/* =========================================
   JPEG END
========================================= */

function findJPEGEnd(bytes) {

    for (
        let i = 2;
        i < bytes.length - 1;
        i++
    ) {

        if (
            bytes[i] === 0xFF &&
            bytes[i + 1] === 0xD9
        ) {

            return i + 2;
        }
    }


    return bytes.length;
}



/* =========================================
   GIF END
========================================= */

function findGIFEnd(bytes) {

    for (
        let i = 6;
        i < bytes.length;
        i++
    ) {

        if (
            bytes[i] === 0x3B
        ) {

            return i + 1;
        }
    }


    return bytes.length;
}



/* =========================================
   DISPLAY IMAGE
========================================= */

function displayResult(decoded) {

    const blob =
        new Blob(
            [decoded.bytes],
            {
                type: decoded.type
            }
        );


    const imageURL =
        URL.createObjectURL(blob);


    receivedImage.src =
        imageURL;


    resultType.textContent =
        decoded.type;


    resultSize.textContent =
        formatBytes(
            decoded.bytes.length
        );


    result.hidden = false;


    receiverState.textContent =
        "COMPLETE";

    decodeStatus.textContent =
        "SUCCESS";

    signalText.textContent =
        "DECODED";


    writeLog(
        "TRANSMISSION SUCCESSFUL\n\n" +
        "File: " +
        decoded.name +
        "\n" +
        "Type: " +
        decoded.type +
        "\n" +
        "Size: " +
        formatBytes(
            decoded.bytes.length
        ) +
        "\n\n" +
        "Image reconstructed successfully."
    );
}



/* =========================================
   LOG
========================================= */

function writeLog(message) {

    decoderLog.textContent =
        message;
}



/* =========================================
   FORMAT BYTES
========================================= */

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
        ).toFixed(2)
        +
        " "
        +
        units[index]
    );
}
