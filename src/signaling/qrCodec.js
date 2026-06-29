import { renderQRToCanvas } from "./qrEncoder.js";

const QR_CODE_MIME = "image/png";

export class QRFrameScanner {
  constructor() {
    this._frames = {};
    this._total = 0;
  }

  process(rawValue) {
    const match = rawValue.match(/^F(\d+)\/(\d+):/);
    if (match) {
      const total = parseInt(match[1], 10);
      const index = parseInt(match[2], 10);
      const data = rawValue.slice(match[0].length);
      if (total !== this._total && this._total !== 0) {
        this.reset();
      }
      this._total = total;
      this._frames[index] = data;
      const collected = Object.keys(this._frames).length;
      if (collected >= total) {
        const parts = [];
        for (let i = 1; i <= total; i++) {
          if (!this._frames[i]) return { complete: false, progress: `${collected}/${total}`, missing: i };
          parts.push(this._frames[i]);
        }
        const result = parts.join("");
        this.reset();
        return { complete: true, data: result };
      }
      return { complete: false, progress: `${collected}/${total}` };
    }
    return { complete: true, data: rawValue };
  }

  reset() {
    this._frames = {};
    this._total = 0;
  }
}

export function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function compressWithStream(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function decompressWithStream(compressed) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

const supportsCompressionStream = typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";

export async function compressPayload(data) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(typeof data === "string" ? data : JSON.stringify(data));
  try {
    if (supportsCompressionStream) {
      const compressed = await compressWithStream(bytes);
      return toBase64Url(compressed.buffer);
    }
  } catch {}
  return toBase64Url(bytes.buffer);
}

export async function decompressPayload(payloadStr) {
  const raw = new Uint8Array(fromBase64Url(payloadStr));
  try {
    if (supportsCompressionStream) {
      const decompressed = await decompressWithStream(raw);
      return new TextDecoder().decode(decompressed);
    }
  } catch {}
  return new TextDecoder().decode(raw);
}

function qrEncodeToCanvas(text, size = 400) {
  const canvas = document.createElement("canvas");
  renderQRToCanvas(text, canvas, size);
  return canvas;
}

function encodeSegments(strPayload) {
  const qrDataLen = 95;
  const segments = [];
  for (let i = 0; i < strPayload.length; i += qrDataLen) {
    segments.push(strPayload.slice(i, i + qrDataLen));
  }
  if (segments.length === 1) return [{ data: segments[0], canvas: qrEncodeToCanvas(segments[0]) }];
  return segments.map((seg, i) => {
    const framed = `F${segments.length}/${i + 1}:${seg}`;
    return { data: seg, framed, canvas: qrEncodeToCanvas(framed) };
  });
}

export async function renderQRCode(container, payload, label = "Scan this QR") {
  const strPayload = typeof payload === "string" ? payload : JSON.stringify(payload);
  const encoded = encodeSegments(strPayload);

  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "qr-display";

  const frameLabel = document.createElement("div");
  frameLabel.className = "qr-frame-label";

  const canvasEl = encoded[0].canvas;
  canvasEl.className = "qr-canvas";
  wrapper.appendChild(canvasEl);

  if (encoded.length > 1) {
    let currentIndex = 0;
    frameLabel.textContent = `Frame 1/${encoded.length}`;
    wrapper.insertBefore(frameLabel, canvasEl);

    const advanceBtn = document.createElement("button");
    advanceBtn.textContent = "Next →";
    advanceBtn.className = "qr-advance-btn";
    advanceBtn.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % encoded.length;
      const newCanvas = encoded[currentIndex].canvas;
      newCanvas.className = "qr-canvas";
      canvasEl.replaceWith(newCanvas);
      frameLabel.textContent = `Frame ${currentIndex + 1}/${encoded.length}`;
    });
    wrapper.appendChild(advanceBtn);

    const autoInterval = setInterval(() => {
      currentIndex = (currentIndex + 1) % encoded.length;
      const newCanvas = encoded[currentIndex].canvas;
      newCanvas.className = "qr-canvas";
      const oldCanvas = wrapper.querySelector(".qr-canvas");
      if (oldCanvas) oldCanvas.replaceWith(newCanvas);
      frameLabel.textContent = `Frame ${currentIndex + 1}/${encoded.length}`;
    }, 3000);
    wrapper.dataset.autoInterval = autoInterval;
  }

  const labelEl = document.createElement("p");
  labelEl.className = "qr-label";
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);
  container.appendChild(wrapper);

  return strPayload;
}

export async function scanQRCode(videoElement) {
  if ("BarcodeDetector" in globalThis) {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    try {
      const barcodes = await detector.detect(videoElement);
      if (barcodes.length > 0) {
        return barcodes[0].rawValue;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function startCamera(videoElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("Camera API not available"));
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  }).then((stream) => {
    videoElement.srcObject = stream;
    videoElement.setAttribute("playsinline", "");
    return videoElement.play();
  });
}

export function stopCamera(videoElement) {
  if (videoElement.srcObject) {
    const tracks = videoElement.srcObject.getTracks();
    tracks.forEach((t) => t.stop());
    videoElement.srcObject = null;
  }
}

function stripNonEssentialSdpLines(sdp) {
  return sdp.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("a=rtcp:")) return false;
    if (trimmed.startsWith("a=ice-pwd:")) return true;
    if (trimmed.startsWith("a=ice-ufrag:")) return true;
    if (trimmed.startsWith("a=fingerprint:")) return true;
    if (trimmed.startsWith("m=")) return true;
    if (trimmed.startsWith("c=")) return true;
    if (trimmed.startsWith("a=group:")) return false;
    if (trimmed.startsWith("a=msid:")) return false;
    if (trimmed.startsWith("a=ssrc:")) return false;
    if (trimmed.startsWith("a=rtpmap:")) return false;
    if (trimmed.startsWith("a=fmtp:")) return false;
    if (trimmed.startsWith("a=sendrecv")) return true;
    if (trimmed.startsWith("a=mid:")) return true;
    if (trimmed.startsWith("o=")) return true;
    if (trimmed.startsWith("s=")) return true;
    if (trimmed.startsWith("t=")) return true;
    if (trimmed.startsWith("a=setup:")) return true;
    return false;
  }).join("\n");
}

export function compressSdp(sdp) {
  return compressPayload(stripNonEssentialSdpLines(sdp));
}

export function decompressSdp(payload) {
  return decompressPayload(payload);
}
