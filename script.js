"use strict";

/*
    ============================================================
    SONICCRYPT
    STAGE 1 — ACOUSTIC RECEIVER
    ============================================================

    2-FSK:

        1200 Hz = 0
        2400 Hz = 1

    Symbol duration:

        100 ms

    Packet:

        24-bit alternating preamble
        8-bit message length
        message bytes
        8-bit end marker

    IMPORTANT:

    This is intentionally a simple prototype.

    We are proving the acoustic connection first.
*/


const ZERO_FREQUENCY = 1200;

const ONE_FREQUENCY = 2400;

const SYMBOL_DURATION = 0.100;

const PREAMBLE_BITS = 24;


const END_MARKER = [
    1, 1, 1, 1,
    0, 0, 0, 0
];


let audioContext = null;

let microphoneStream = null;

let sourceNode = null;

let processorNode = null;

let silentGain = null;

let analyserNode = null;


let isListening = false;

let processingScheduled = false;


let sampleBuffer =
    new Float32Array(0);


let searchPosition = 0;

let decodePosition = 0;


let preambleFound = false;

let expectedMessageLength = null;

let receivedBits = [];

let receivedBytes = [];


let monitorRunning = false;


const startButton =
    document.getElementById("startButton");


const stopButton =
    document.getElementById("stopButton");


const statusBox =
    document.getElementById("status");


const frequencyBox =
    document.getElementById("frequency");


const signalBar =
    document.getElementById("signalBar");


const receivedMessageBox =
    document.getElementById("receivedMessage");


const logBox =
    document.getElementById("log");


/*
    ============================================================
    LOG
    ============================================================
*/

function log(message) {

    const time =
        new Date().toLocaleTimeString();


    const line =
        document.createElement("div");


    line.className =
        "log-line";


    line.textContent =
        `[${time}] ${message}`;


    logBox.appendChild(line);


    logBox.scrollTop =
        logBox.scrollHeight;
}


/*
    ============================================================
    APPEND AUDIO
    ============================================================
*/

function appendSamples(samples) {

    const combined =
        new Float32Array(
            sampleBuffer.length +
            samples.length
        );


    combined.set(
        sampleBuffer,
        0
    );


    combined.set(
        samples,
        sampleBuffer.length
    );


    sampleBuffer =
        combined;


    /*
        Keep roughly 20 seconds.
    */

    const maximum =
        audioContext.sampleRate * 20;


    if (
        sampleBuffer.length >
        maximum
    ) {

        const amountToRemove =
            sampleBuffer.length -
            maximum;


        sampleBuffer =
            sampleBuffer.slice(
                amountToRemove
            );


        searchPosition =
            Math.max(
                0,
                searchPosition -
                amountToRemove
            );


        decodePosition =
            Math.max(
                0,
                decodePosition -
                amountToRemove
            );
    }
}


/*
    ============================================================
    RMS
    ============================================================
*/

function calculateRMS(
    samples,
    start,
    length
) {

    const end =
        Math.min(
            samples.length,
            start + length
        );


    if (end <= start) {
        return 0;
    }


    let sum = 0;


    for (
        let i = start;
        i < end;
        i++
    ) {

        const value =
            samples[i];


        sum +=
            value * value;
    }


    return Math.sqrt(
        sum /
        (end - start)
    );
}


/*
    ============================================================
    GOERTZEL
    ============================================================

    Directly measures the frequency we care about.

    This is better for this test than relying
    on an FFT bin.
*/

function goertzelPower(
    samples,
    start,
    length,
    frequency
) {

    const sampleRate =
        audioContext.sampleRate;


    const omega =
        2 *
        Math.PI *
        frequency /
        sampleRate;


    const coefficient =
        2 *
        Math.cos(omega);


    let q1 = 0;

    let q2 = 0;


    const end =
        Math.min(
            samples.length,
            start + length
        );


    for (
        let i = start;
        i < end;
        i++
    ) {

        const q0 =
            coefficient * q1 -
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


/*
    ============================================================
    DETECT ONE SYMBOL
    ============================================================
*/

function detectSymbol(
    start,
    length
) {

    if (
        start < 0 ||
        start + length >
        sampleBuffer.length
    ) {

        return null;
    }


    /*
        Only use the center 60%.

        This avoids transitions.
    */

    const offset =
        Math.floor(
            length * 0.20
        );


    const usableLength =
        Math.floor(
            length * 0.60
        );


    const zeroPower =
        goertzelPower(
            sampleBuffer,
            start + offset,
            usableLength,
            ZERO_FREQUENCY
        );


    const onePower =
        goertzelPower(
            sampleBuffer,
            start + offset,
            usableLength,
            ONE_FREQUENCY
        );


    const rms =
        calculateRMS(
            sampleBuffer,
            start + offset,
            usableLength
        );


    /*
        Silence.
    */

    if (
        rms < 0.004
    ) {

        return null;
    }


    const stronger =
        Math.max(
            zeroPower,
            onePower
        );


    const weaker =
        Math.min(
            zeroPower,
            onePower
        );


    /*
        Frequency confidence.

        The stronger tone should be at least
        15% stronger than the weaker tone.
    */

    const ratio =
        stronger /
        Math.max(
            weaker,
            1
        );


    if (
        ratio < 1.15
    ) {

        return null;
    }


    if (
        zeroPower >
        onePower
    ) {

        return 0;
    }


    return 1;
}


/*
    ============================================================
    PREAMBLE
    ============================================================
*/

function checkPreamble(
    start
) {

    const samplesPerSymbol =
        Math.round(
            audioContext.sampleRate *
            SYMBOL_DURATION
        );


    for (
        let i = 0;
        i < PREAMBLE_BITS;
        i++
    ) {

        const expected =
            i % 2;


        const detected =
            detectSymbol(
                start +
                i *
                samplesPerSymbol,
                samplesPerSymbol
            );


        if (
            detected === null
        ) {

            return false;
        }


        if (
            detected !==
            expected
        ) {

            return false;
        }
    }


    return true;
}


/*
    ============================================================
    SEARCH FOR PREAMBLE
    ============================================================
*/

function searchForPreamble() {

    if (
        preambleFound
    ) {

        return false;
    }


    const samplesPerSymbol =
        Math.round(
            audioContext.sampleRate *
            SYMBOL_DURATION
        );


    const preambleSamples =
        PREAMBLE_BITS *
        samplesPerSymbol;


    const maximumSearchPosition =
        sampleBuffer.length -
        preambleSamples;


    if (
        maximumSearchPosition <=
        searchPosition
    ) {

        return false;
    }


    /*
        Search every 10 ms.

        Because our symbols are 100 ms,
        we have plenty of tolerance.
    */

    const searchStep =
        Math.max(
            1,
            Math.floor(
                audioContext.sampleRate *
                0.010
            )
        );


    let position =
        searchPosition;


    while (
        position <=
        maximumSearchPosition
    ) {

        if (
            checkPreamble(
                position
            )
        ) {

            preambleFound =
                true;


            decodePosition =
                position +
                preambleSamples;


            log(
                "PREAMBLE DETECTED"
            );


            statusBox.textContent =
                "PREAMBLE DETECTED";


            return true;
        }


        position +=
            searchStep;
    }


    /*
        Don't repeatedly scan old audio.
    */

    searchPosition =
        Math.max(
            0,
            maximumSearchPosition -
            Math.floor(
                audioContext.sampleRate *
                0.5
            )
        );


    return false;
}


/*
    ============================================================
    BITS → BYTE
    ============================================================
*/

function bitsToByte(
    bits
) {

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
            bits[i];
    }


    return value;
}


/*
    ============================================================
    DECODE MESSAGE
    ============================================================
*/

function decodeMessage() {

    if (
        !preambleFound
    ) {

        return;
    }


    const samplesPerSymbol =
        Math.round(
            audioContext.sampleRate *
            SYMBOL_DURATION
        );


    /*
        --------------------------------------------------------
        MESSAGE LENGTH
        --------------------------------------------------------
    */

    if (
        expectedMessageLength ===
        null
    ) {

        const requiredSamples =
            decodePosition +
            8 *
            samplesPerSymbol;


        if (
            sampleBuffer.length <
            requiredSamples
        ) {

            return;
        }


        const lengthBits = [];


        for (
            let i = 0;
            i < 8;
            i++
        ) {

            const bit =
                detectSymbol(
                    decodePosition +
                    i *
                    samplesPerSymbol,
                    samplesPerSymbol
                );


            if (
                bit === null
            ) {

                return;
            }


            lengthBits.push(
                bit
            );
        }


        expectedMessageLength =
            bitsToByte(
                lengthBits
            );


        decodePosition +=
            8 *
            samplesPerSymbol;


        receivedBits = [];

        receivedBytes = [];


        log(
            `MESSAGE LENGTH: ${expectedMessageLength} BYTES`
        );


        /*
            Prevent obviously broken lengths
            from running forever.
        */

        if (
            expectedMessageLength >
            255
        ) {

            log(
                "INVALID MESSAGE LENGTH"
            );


            resetDecoder();

            return;
        }
    }


    /*
        --------------------------------------------------------
        MESSAGE BYTES
        --------------------------------------------------------
    */

    const totalBits =
        expectedMessageLength *
        8;


    while (
        receivedBits.length <
        totalBits
    ) {

        if (
            decodePosition +
            samplesPerSymbol >
            sampleBuffer.length
        ) {

            return;
        }


        const bit =
            detectSymbol(
                decodePosition,
                samplesPerSymbol
            );


        if (
            bit === null
        ) {

            return;
        }


        receivedBits.push(
            bit
        );


        decodePosition +=
            samplesPerSymbol;


        /*
            Every 8 bits = one byte.
        */

        if (
            receivedBits.length %
            8 ===
            0
        ) {

            const byteStart =
                receivedBits.length -
                8;


            const byte =
                bitsToByte(
                    receivedBits.slice(
                        byteStart
                    )
                );


            receivedBytes.push(
                byte
            );


            /*
                Show partial text.
            */

            try {

                const text =
                    new TextDecoder().decode(
                        new Uint8Array(
                            receivedBytes
                        )
                    );


                receivedMessageBox.textContent =
                    text;

            } catch {

                /*
                    UTF-8 character may not be
                    complete yet.
                */
            }
        }
    }


    /*
        --------------------------------------------------------
        COMPLETE
        --------------------------------------------------------
    */

    try {

        const finalText =
            new TextDecoder().decode(
                new Uint8Array(
                    receivedBytes
                )
            );


        receivedMessageBox.textContent =
            finalText;


        statusBox.textContent =
            "MESSAGE RECEIVED";


        log(
            `SUCCESS: ${finalText}`
        );


    } catch {

        statusBox.textContent =
            "MESSAGE RECEIVED";


        log(
            "Message received but UTF-8 decoding failed."
        );
    }


    /*
        Reset so another transmission
        can be received.
    */

    resetDecoder();
}


/*
    ============================================================
    RESET DECODER
    ============================================================
*/

function resetDecoder() {

    preambleFound =
        false;


    expectedMessageLength =
        null;


    receivedBits =
        [];


    receivedBytes =
        [];


    /*
        Continue searching slightly before
        the current position.
    */

    searchPosition =
        Math.max(
            0,
            decodePosition -
            Math.floor(
                audioContext.sampleRate *
                0.5
            )
        );
}


/*
    ============================================================
    PROCESS MICROPHONE AUDIO
    ============================================================
*/

function processAudio(
    event
) {

    if (
        !isListening
    ) {

        return;
    }


    const input =
        event.inputBuffer
        .getChannelData(0);


    /*
        Copy because Web Audio reuses
        the AudioBuffer.
    */

    const copy =
        new Float32Array(
            input.length
        );


    copy.set(
        input
    );


    appendSamples(
        copy
    );


    /*
        Schedule decoder once per animation frame.

        This prevents multiple decoder runs
        from piling up.
    */

    if (
        processingScheduled
    ) {

        return;
    }


    processingScheduled =
        true;


    requestAnimationFrame(() => {

        try {

            if (
                !preambleFound
            ) {

                searchForPreamble();

            } else {

                decodeMessage();
            }

        } catch (error) {

            console.error(error);


            log(
                `DECODER ERROR: ${error.message}`
            );
        }


        processingScheduled =
            false;
    });
}


/*
    ============================================================
    LIVE FREQUENCY MONITOR
    ============================================================
*/

function startFrequencyMonitor() {

    if (
        monitorRunning
    ) {

        return;
    }


    monitorRunning =
        true;


    function monitor() {

        if (
            !isListening
        ) {

            monitorRunning =
                false;

            return;
        }


        if (
            sampleBuffer.length >
            audioContext.sampleRate *
            0.05
        ) {

            const length =
                Math.min(
                    Math.floor(
                        audioContext.sampleRate *
                        0.05
                    ),
                    sampleBuffer.length
                );


            const start =
                sampleBuffer.length -
                length;


            const zeroPower =
                goertzelPower(
                    sampleBuffer,
                    start,
                    length,
                    ZERO_FREQUENCY
                );


            const onePower =
                goertzelPower(
                    sampleBuffer,
                    start,
                    length,
                    ONE_FREQUENCY
                );


            const rms =
                calculateRMS(
                    sampleBuffer,
                    start,
                    length
                );


            /*
                Signal meter.
            */

            const meter =
                Math.min(
                    100,
                    rms * 500
                );


            signalBar.style.width =
                `${meter}%`;


            if (
                rms < 0.004
            ) {

                frequencyBox.textContent =
                    "SILENCE";

            } else if (
                zeroPower >
                onePower
            ) {

                frequencyBox.textContent =
                    "1200 Hz";

            } else {

                frequencyBox.textContent =
                    "2400 Hz";
            }
        }


        requestAnimationFrame(
            monitor
        );
    }


    monitor();
}


/*
    ============================================================
    START LISTENING
    ============================================================
*/

async function startListening() {

    if (
        isListening
    ) {

        return;
    }


    try {

        statusBox.textContent =
            "REQUESTING MICROPHONE";


        /*
            Request raw microphone audio.

            We disable browser processing because
            FSK depends on the actual frequencies.
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
            Use the browser's actual sample rate.
        */

        audioContext =
            new AudioContext();


        await audioContext.resume();


        log(
            `MICROPHONE SAMPLE RATE: ${audioContext.sampleRate} Hz`
        );


        sourceNode =
            audioContext
            .createMediaStreamSource(
                microphoneStream
            );


        processorNode =
            audioContext
            .createScriptProcessor(
                4096,
                1,
                1
            );


        analyserNode =
            audioContext
            .createAnalyser();


        analyserNode.fftSize =
            2048;


        silentGain =
            audioContext
            .createGain();


        silentGain.gain.value =
            0;


        /*
            Audio path:

            Microphone
                ↓
            Processor
                ↓
            Analyser
                ↓
            Gain 0
                ↓
            Speakers

            Because gain = 0,
            the microphone won't feed back.
        */

        sourceNode.connect(
            processorNode
        );


        processorNode.connect(
            analyserNode
        );


        analyserNode.connect(
            silentGain
        );


        silentGain.connect(
            audioContext.destination
        );


        processorNode.onaudioprocess =
            processAudio;


        /*
            Reset everything.
        */

        sampleBuffer =
            new Float32Array(0);


        searchPosition =
            0;


        decodePosition =
            0;


        preambleFound =
            false;


        expectedMessageLength =
            null;


        receivedBits =
            [];


        receivedBytes =
            [];


        isListening =
            true;


        startButton.disabled =
            true;


        stopButton.disabled =
            false;


        statusBox.textContent =
            "LISTENING FOR SONICCRYPT";


        frequencyBox.textContent =
            "LISTENING";


        receivedMessageBox.textContent =
            "Waiting for transmission...";


        log(
            "--------------------------------"
        );


        log(
            "RECEIVER STARTED"
        );


        log(
            "Protocol: 2-FSK"
        );


        log(
            "1200 Hz = 0"
        );


        log(
            "2400 Hz = 1"
        );


        log(
            "Symbol duration: 100 ms"
        );


        log(
            "Searching for preamble..."
        );


        startFrequencyMonitor();


    } catch (error) {

        console.error(error);


        statusBox.textContent =
            "MICROPHONE ERROR";


        log(
            `ERROR: ${error.message}`
        );


        /*
            Clean up if something partially
            initialized.
        */

        stopListening();
    }
}


/*
    ============================================================
    STOP LISTENING
    ============================================================
*/

function stopListening() {

    isListening =
        false;


    if (
        processorNode
    ) {

        processorNode.onaudioprocess =
            null;


        try {
            processorNode.disconnect();
        } catch {}
        

        processorNode =
            null;
    }


    if (
        sourceNode
    ) {

        try {
            sourceNode.disconnect();
        } catch {}


        sourceNode =
            null;
    }


    if (
        analyserNode
    ) {

        try {
            analyserNode.disconnect();
        } catch {}


        analyserNode =
            null;
    }


    if (
        silentGain
    ) {

        try {
            silentGain.disconnect();
        } catch {}


        silentGain =
            null;
    }


    if (
        microphoneStream
    ) {

        microphoneStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );


        microphoneStream =
            null;
    }


    if (
        audioContext
    ) {

        try {
            audioContext.close();
        } catch {}


        audioContext =
            null;
    }


    sampleBuffer =
        new Float32Array(0);


    searchPosition =
        0;


    decodePosition =
        0;


    preambleFound =
        false;


    expectedMessageLength =
        null;


    receivedBits =
        [];


    receivedBytes =
        [];


    startButton.disabled =
        false;


    stopButton.disabled =
        true;


    frequencyBox.textContent =
        "WAITING";


    signalBar.style.width =
        "0%";


    statusBox.textContent =
        "MICROPHONE OFF";


    log(
        "Receiver stopped."
    );
}


/*
    ============================================================
    BUTTONS
    ============================================================
*/

startButton.addEventListener(
    "click",
    startListening
);


stopButton.addEventListener(
    "click",
    stopListening
);


/*
    ============================================================
    INITIALIZATION
    ============================================================
*/

log(
    "SONICCRYPT receiver initialized."
);


log(
    "2-FSK acoustic test ready."
);


log(
    "Waiting for microphone."
);
