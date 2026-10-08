const SAMPLE_RATE = 44100;

/*
 * SONICCRYPT TURBO
 *
 * 16-FSK
 *
 * 0  = 1000 Hz
 * 1  = 1200 Hz
 * ...
 * 15 = 4000 Hz
 */

const FREQUENCIES = Array.from(
    { length: 16 },
    (_, i) => 1000 + i * 200
);


/*
 * TRANSMISSION SPEEDS
 *
 * 4 ms = fast
 * 6 ms = reliable
 */

const MODES = {
    turbo: 0.004,
    reliable: 0.006
};

let currentMode = "turbo";


/*
 * SYNCHRONIZATION
 *
 * Alternating extreme frequencies.
 *
 * 0 = 1000 Hz
 * F = 4000 Hz
 *
 * This lets the receiver find the
 * exact beginning of the transmission.
 */

const PREAMBLE = [];

for (let i = 0; i < 32; i++) {
    PREAMBLE.push(i % 2 === 0 ? 0 : 15);
}


let selectedFile = null;

let transmissionBytes = [];
let transmissionSymbols = [];

let audioBuffer = null;

let audioContext = null;
let sourceNode = null;

let isPlaying = false;
let isPaused = false;

let transmissionStart = 0;
let pausedAt = 0;

let animationFrame = null;


/*
 * ELEMENTS
 */

const fileInput =
    document.getElementById("fileInput");

const fileInfo =
    document.getElementById("fileInfo");

const imagePreview =
    document.getElementById("imagePreview");

const previewContainer =
    document.getElementById("previewContainer");

const statusElement =
    document.getElementById("status");

const elapsedTime =
    document.getElementById("elapsedTime");

const remainingTime =
    document.getElementById("remainingTime");

const totalTime =
    document.getElementById("totalTime");

const progressFill =
    document.getElementById("progressFill");

const progressPercent =
    document.getElementById("progressPercent");

const playButton =
    document.getElementById("playButton");

const pauseButton =
    document.getElementById("pauseButton");

const stopButton =
    document.getElementById("stopButton");

const dataSize =
    document.getElementById("dataSize");

const encodedBits =
    document.getElementById("encodedBits");

const symbolCount =
    document.getElementById("symbolCount");

const symbolSpeed =
    document.getElementById("symbolSpeed");

const canvas =
    document.getElementById("waveformCanvas");

const ctx =
    canvas.getContext("2d");

const logElement =
    document.getElementById("log");

const turboButton =
    document.getElementById("turboMode");

const reliableButton =
    document.getElementById("reliableMode");

const modeInfo =
    document.getElementById("modeInfo");


/*
 * LOG
 */

function log(message) {

    const entry =
        document.createElement("div");

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
 * MODE
 */

turboButton.onclick =
    () => setMode("turbo");

reliableButton.onclick =
    () => setMode("reliable");


function setMode(mode) {

    if (isPlaying || isPaused) {
        return;
    }

    currentMode = mode;

    turboButton.classList.toggle(
        "active",
        mode === "turbo"
    );

    reliableButton.classList.toggle(
        "active",
        mode === "reliable"
    );

    if (mode === "turbo") {

        modeInfo.textContent =
            "TURBO: 4 ms symbols. Faster transmission.";

    } else {

        modeInfo.textContent =
            "RELIABLE: 6 ms symbols. Better for noisy environments.";
    }

    if (selectedFile) {
        prepareTransmission(selectedFile);
    }
}


/*
 * FILE
 */

fileInput.addEventListener(
    "change",
    async () => {

        const file =
            fileInput.files[0];

        if (!file) {
            return;
        }

        stopTransmission();

        selectedFile = file;

        fileInfo.textContent =
            `${file.name} — ${formatBytes(file.size)}`;

        dataSize.textContent =
            formatBytes(file.size);

        if (file.type.startsWith("image/")) {

            const url =
                URL.createObjectURL(file);

            imagePreview.src = url;

            previewContainer.style.display =
                "block";

        } else {

            previewContainer.style.display =
                "none";
        }

        log(`Selected: ${file.name}`);

        await prepareTransmission(file);
    }
);


/*
 * PREPARE
 */

async function prepareTransmission(file) {

    statusElement.textContent =
        "ENCODING";

    const buffer =
        await file.arrayBuffer();

    const bytes =
        new Uint8Array(buffer);


    /*
     * HEADER
     */

    const header =
        buildHeader(
            file.name,
            file.type ||
                "application/octet-stream",
            bytes.length,
            crc32(bytes)
        );


    /*
     * PAYLOAD
     *
     * 5 random bits
     * +
     * 8 data bits
     */

    const payloadBits =
        encodeCustomBits(bytes);


    /*
     * HEADER BITS
     */

    const headerBits =
        bytesToBits(header);


    /*
     * COMPLETE DATA
     */

    const allBits = [
        ...headerBits,
        ...payloadBits
    ];


    /*
     * 4 BITS = 1 FREQUENCY
     */

    const dataSymbols =
        bitsToSymbols(allBits);


    /*
     * ADD SYNC PREAMBLE
     */

    transmissionSymbols = [
        ...PREAMBLE,
        ...dataSymbols
    ];


    transmissionBytes =
        Array.from(bytes);


    const duration =
        transmissionSymbols.length *
        MODES[currentMode];


    encodedBits.textContent =
        allBits.length.toLocaleString();

    symbolCount.textContent =
        transmissionSymbols.length.toLocaleString();

    symbolSpeed.textContent =
        `${Math.round(
            1 / MODES[currentMode]
        )}/sec`;

    totalTime.textContent =
        formatTime(duration);

    remainingTime.textContent =
        formatTime(duration);

    elapsedTime.textContent =
        "00:00";

    progressFill.style.width =
        "0%";

    progressPercent.textContent =
        "0%";


    log(
        `File: ${file.name}`
    );

    log(
        `Original size: ${bytes.length.toLocaleString()} bytes`
    );

    log(
        `Payload bits: ${payloadBits.length.toLocaleString()}`
    );

    log(
        `Header bytes: ${header.length}`
    );

    log(
        `Total symbols: ${transmissionSymbols.length.toLocaleString()}`
    );

    log(
        `Estimated time: ${formatTime(duration)}`
    );


    statusElement.textContent =
        "GENERATING AUDIO";


    audioBuffer =
        createAudioBuffer(
            transmissionSymbols
        );


    drawWaveform(
        audioBuffer
    );


    statusElement.textContent =
        "READY";

    playButton.disabled =
        false;

    pauseButton.disabled =
        true;

    stopButton.disabled =
        true;
}


/*
 * HEADER
 *
 * SCX2
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

function buildHeader(
    name,
    mime,
    fileSize,
    checksum
) {

    const encoder =
        new TextEncoder();

    const nameBytes =
        encoder.encode(name);

    const mimeBytes =
        encoder.encode(mime);

    const result = [];


    result.push(
        0x53,
        0x43,
        0x58,
        0x32
    );


    result.push(2);


    result.push(
        (nameBytes.length >> 8) & 0xff,
        nameBytes.length & 0xff
    );

    result.push(
        ...nameBytes
    );


    result.push(
        (mimeBytes.length >> 8) & 0xff,
        mimeBytes.length & 0xff
    );

    result.push(
        ...mimeBytes
    );


    result.push(
        (fileSize >>> 24) & 0xff,
        (fileSize >>> 16) & 0xff,
        (fileSize >>> 8) & 0xff,
        fileSize & 0xff
    );


    result.push(
        (checksum >>> 24) & 0xff,
        (checksum >>> 16) & 0xff,
        (checksum >>> 8) & 0xff,
        checksum & 0xff
    );


    return new Uint8Array(result);
}


/*
 * CUSTOM PROTOCOL
 *
 * Every byte becomes:
 *
 * RANDOM RANDOM RANDOM RANDOM RANDOM
 * DATA DATA DATA DATA DATA DATA DATA DATA
 *
 * 13 bits total
 */

function encodeCustomBits(bytes) {

    const bits = [];

    for (const byte of bytes) {

        const randomBits =
            new Uint8Array(5);

        crypto.getRandomValues(
            randomBits
        );


        for (let i = 0; i < 5; i++) {

            bits.push(
                randomBits[i] & 1
            );
        }


        for (let i = 7; i >= 0; i--) {

            bits.push(
                (byte >> i) & 1
            );
        }
    }

    return bits;
}


/*
 * BYTES -> BITS
 */

function bytesToBits(bytes) {

    const bits = [];

    for (const byte of bytes) {

        for (let i = 7; i >= 0; i--) {

            bits.push(
                (byte >> i) & 1
            );
        }
    }

    return bits;
}


/*
 * BITS -> 4-BIT SYMBOLS
 */

function bitsToSymbols(bits) {

    const symbols = [];

    for (
        let i = 0;
        i < bits.length;
        i += 4
    ) {

        let value = 0;

        for (let j = 0; j < 4; j++) {

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
 * AUDIO GENERATION
 */

function createAudioBuffer(symbols) {

    const duration =
        MODES[currentMode];

    const samplesPerSymbol =
        Math.round(
            SAMPLE_RATE *
            duration
        );

    const totalSamples =
        samplesPerSymbol *
        symbols.length;


    const buffer =
        new AudioBuffer({
            length: totalSamples,
            numberOfChannels: 1,
            sampleRate: SAMPLE_RATE
        });


    const channel =
        buffer.getChannelData(0);


    let position = 0;

    let phase = 0;


    for (const symbol of symbols) {

        const frequency =
            FREQUENCIES[symbol];

        const phaseStep =
            2 *
            Math.PI *
            frequency /
            SAMPLE_RATE;


        const fadeSamples =
            Math.min(
                16,
                Math.floor(
                    samplesPerSymbol / 5
                )
            );


        for (
            let i = 0;
            i < samplesPerSymbol;
            i++
        ) {

            let envelope = 1;


            if (
                i <
                fadeSamples
            ) {

                envelope =
                    i /
                    fadeSamples;

            } else if (
                i >
                samplesPerSymbol -
                fadeSamples
            ) {

                envelope =
                    (
                        samplesPerSymbol -
                        i
                    ) /
                    fadeSamples;
            }


            channel[position++] =
                Math.sin(phase) *
                0.45 *
                envelope;


            phase +=
                phaseStep;


            if (
                phase >
                Math.PI * 2
            ) {

                phase -=
                    Math.PI * 2;
            }
        }
    }


    return buffer;
}


/*
 * PLAY
 */

playButton.onclick =
    async () => {

        if (!audioBuffer) {
            return;
        }

        if (isPaused) {

            await resumeTransmission();

        } else {

            await startTransmission();
        }
    };


async function startTransmission() {

    stopAudioOnly();


    audioContext =
        new AudioContext({
            sampleRate: SAMPLE_RATE
        });


    await audioContext.resume();


    sourceNode =
        audioContext.createBufferSource();


    sourceNode.buffer =
        audioBuffer;


    sourceNode.connect(
        audioContext.destination
    );


    sourceNode.onended =
        () => {

            if (isPlaying) {
                finishTransmission();
            }
        };


    sourceNode.start();


    transmissionStart =
        audioContext.currentTime;


    pausedAt = 0;

    isPlaying = true;
    isPaused = false;


    statusElement.textContent =
        "TRANSMITTING";


    playButton.disabled = true;
    pauseButton.disabled = false;
    stopButton.disabled = false;


    log(
        "Transmission started."
    );


    updateTimer();
}


/*
 * PAUSE
 */

pauseButton.onclick =
    async () => {

        if (
            !audioContext ||
            !isPlaying
        ) {
            return;
        }


        pausedAt =
            audioContext.currentTime -
            transmissionStart;


        await audioContext.suspend();


        isPlaying = false;
        isPaused = true;


        statusElement.textContent =
            "PAUSED";


        playButton.textContent =
            "RESUME";


        playButton.disabled = false;
        pauseButton.disabled = true;


        log(
            "Transmission paused."
        );
    };


/*
 * RESUME
 */

async function resumeTransmission() {

    await audioContext.resume();


    transmissionStart =
        audioContext.currentTime -
        pausedAt;


    isPlaying = true;
    isPaused = false;


    statusElement.textContent =
        "TRANSMITTING";


    playButton.textContent =
        "PAUSE";


    playButton.disabled = true;
    pauseButton.disabled = false;


    log(
        "Transmission resumed."
    );


    updateTimer();
}


/*
 * STOP
 */

stopButton.onclick =
    () => {

        stopTransmission();
    };


function stopTransmission() {

    stopAudioOnly();


    isPlaying = false;
    isPaused = false;

    pausedAt = 0;


    cancelAnimationFrame(
        animationFrame
    );


    const duration =
        audioBuffer
            ? audioBuffer.duration
            : 0;


    elapsedTime.textContent =
        "00:00";


    remainingTime.textContent =
        formatTime(duration);


    progressFill.style.width =
        "0%";

    progressPercent.textContent =
        "0%";


    statusElement.textContent =
        audioBuffer
            ? "READY"
            : "WAITING FOR FILE";


    playButton.textContent =
        "PLAY";


    playButton.disabled =
        !audioBuffer;

    pauseButton.disabled = true;
    stopButton.disabled = true;


    log(
        "Transmission stopped."
    );
}


/*
 * STOP AUDIO
 */

function stopAudioOnly() {

    if (sourceNode) {

        try {
            sourceNode.stop();
        } catch {}

        sourceNode.disconnect();

        sourceNode = null;
    }


    if (audioContext) {

        audioContext.close();

        audioContext = null;
    }
}


/*
 * FINISH
 */

function finishTransmission() {

    isPlaying = false;
    isPaused = false;


    cancelAnimationFrame(
        animationFrame
    );


    statusElement.textContent =
        "TRANSMISSION COMPLETE";


    playButton.disabled = false;
    pauseButton.disabled = true;
    stopButton.disabled = true;


    progressFill.style.width =
        "100%";

    progressPercent.textContent =
        "100%";


    elapsedTime.textContent =
        formatTime(
            audioBuffer.duration
        );


    remainingTime.textContent =
        "00:00";


    log(
        "Transmission complete."
    );


    if (audioContext) {

        audioContext.close();

        audioContext = null;
    }


    sourceNode = null;
}


/*
 * TIMER
 */

function updateTimer() {

    if (
        !isPlaying ||
        !audioContext
    ) {
        return;
    }


    const elapsed =
        audioContext.currentTime -
        transmissionStart;


    const total =
        audioBuffer.duration;


    const progress =
        Math.min(
            1,
            elapsed / total
        );


    elapsedTime.textContent =
        formatTime(elapsed);


    remainingTime.textContent =
        formatTime(
            Math.max(
                0,
                total - elapsed
            )
        );


    progressFill.style.width =
        `${progress * 100}%`;


    progressPercent.textContent =
        `${Math.floor(
            progress * 100
        )}%`;


    animationFrame =
        requestAnimationFrame(
            updateTimer
        );
}


/*
 * WAVEFORM
 */

function drawWaveform(buffer) {

    canvas.width =
        canvas.clientWidth *
        window.devicePixelRatio;

    canvas.height =
        canvas.clientHeight *
        window.devicePixelRatio;


    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    const data =
        buffer.getChannelData(0);


    const center =
        canvas.height / 2;


    const step =
        Math.max(
            1,
            Math.floor(
                data.length /
                canvas.width
            )
        );


    ctx.beginPath();


    for (
        let x = 0;
        x < canvas.width;
        x++
    ) {

        const value =
            data[x * step] || 0;


        const y =
            center +
            value *
            center *
            0.85;


        if (x === 0) {

            ctx.moveTo(
                x,
                y
            );

        } else {

            ctx.lineTo(
                x,
                y
            );
        }
    }


    ctx.strokeStyle =
        "#4aa8ff";

    ctx.lineWidth = 1;

    ctx.stroke();
}


/*
 * CRC32
 */

function crc32(bytes) {

    let crc =
        0xffffffff;


    for (const byte of bytes) {

        crc ^= byte;


        for (
            let i = 0;
            i < 8;
            i++
        ) {

            crc =
                (crc >>> 1) ^
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
 * FORMAT TIME
 */

function formatTime(seconds) {

    seconds =
        Math.max(
            0,
            Math.floor(seconds)
        );


    const hours =
        Math.floor(
            seconds / 3600
        );


    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );


    const secs =
        seconds % 60;


    if (hours > 0) {

        return (
            String(hours)
                .padStart(2, "0") +
            ":" +
            String(minutes)
                .padStart(2, "0") +
            ":" +
            String(secs)
                .padStart(2, "0")
        );
    }


    return (
        String(minutes)
            .padStart(2, "0") +
        ":" +
        String(secs)
            .padStart(2, "0")
    );
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

playButton.disabled = true;
pauseButton.disabled = true;
stopButton.disabled = true;


turboButton.classList.add(
    "active"
);


log(
    "SONICCRYPT TURBO transmitter initialized."
);

log(
    "16-FSK: 1000-4000 Hz."
);

log(
    "Synchronization preamble enabled."
);
