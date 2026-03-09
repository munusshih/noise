import { getAudioNodes } from "./audio";

const oscCanvas = document.getElementById("osc-canvas") as HTMLCanvasElement;
const freqCanvas = document.getElementById("freq-canvas") as HTMLCanvasElement;
const oscCtx = oscCanvas.getContext("2d")!;
const freqCtx = freqCanvas.getContext("2d")!;

function clearCanvas(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
): void {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function draw(): void {
    requestAnimationFrame(draw);

    const n = getAudioNodes();
    if (!n) {
        clearCanvas(oscCtx, oscCanvas);
        clearCanvas(freqCtx, freqCanvas);
        return;
    }

    const bufLen = n.analyser.frequencyBinCount;
    const timeData = new Float32Array(bufLen);
    const freqData = new Uint8Array(bufLen);
    n.analyser.getFloatTimeDomainData(timeData);
    n.analyser.getByteFrequencyData(freqData);

    // ── Oscilloscope
    const w1 = oscCanvas.width;
    const h1 = oscCanvas.height;
    oscCtx.fillStyle = "#050505";
    oscCtx.fillRect(0, 0, w1, h1);
    oscCtx.strokeStyle = "#ff3c1f";
    oscCtx.lineWidth = 1.5;
    oscCtx.shadowColor = "#ff3c1f";
    oscCtx.shadowBlur = 4;
    oscCtx.beginPath();
    const sliceW = w1 / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
        const y = ((timeData[i] + 1) / 2) * h1;
        i === 0 ? oscCtx.moveTo(x, y) : oscCtx.lineTo(x, y);
        x += sliceW;
    }
    oscCtx.stroke();
    oscCtx.shadowBlur = 0;

    // ── Sub-bass frequency bars (0–300 Hz only)
    const w2 = freqCanvas.width;
    const h2 = freqCanvas.height;
    freqCtx.fillStyle = "#050505";
    freqCtx.fillRect(0, 0, w2, h2);

    const nyquist = n.ctx.sampleRate / 2;
    const maxBin = Math.floor((300 / nyquist) * bufLen);
    const barW = w2 / maxBin;

    for (let i = 0; i < maxBin; i++) {
        const bh = (freqData[i] / 255) * h2;
        freqCtx.fillStyle = `hsl(${15 + (i / maxBin) * 25}, 100%, 55%)`;
        freqCtx.fillRect(i * barW, h2 - bh, barW - 1, bh);
    }
}

export function startVisualizer(): void {
    draw();
}
