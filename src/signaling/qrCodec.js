let _barcodeDetector = null;

function getBarcodeDetector() {
  if (_barcodeDetector) return _barcodeDetector;
  if ("BarcodeDetector" in globalThis) {
    try {
      _barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
      return _barcodeDetector;
    } catch {
      return null;
    }
  }
  return null;
}

const QR_CODE_MIME = "image/png";

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

function getQRVersion(text) {
  for (let v = 1; v <= 40; v++) {
    try {
      qrcode.generate(v, text, qrcode.ErrorCorrectLevel.M);
      return v;
    } catch {}
  }
  return 40;
}

function qrEncodeToCanvas(text, size = 600) {
  const canvas = document.createElement("canvas");

  let qr;
  let version;
  for (const ecLevel of [qrcode.ErrorCorrectLevel.Q, qrcode.ErrorCorrectLevel.M]) {
    try {
      qr = qrcode.generate(0, text, ecLevel);
      const mc = qr.getModuleCount();
      version = (mc - 17) / 4;
      if (version <= 25) break;
    } catch {
      continue;
    }
  }
  if (!qr) {
    qr = qrcode.generate(0, text, qrcode.ErrorCorrectLevel.L);
    const mc = qr.getModuleCount();
    version = (mc - 17) / 4;
  }

  const moduleCount = qr.getModuleCount();

  const padding = 6;
  const moduleSize = Math.max(2, Math.floor(size / (moduleCount + padding * 2)));
  const canvasSize = moduleSize * (moduleCount + padding * 2);
  const offset = moduleSize * padding;

  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = "#000000";
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(offset + c * moduleSize, offset + r * moduleSize, moduleSize, moduleSize);
      }
    }
  }

  canvas.dataset.qrVersion = version;
  return canvas;
}

function getDataCapacity(version) {
  const text = "A".repeat(5000);
  for (let v = version; v >= 1; v--) {
    try {
      qrcode.generate(v, text.slice(0, 4000), qrcode.ErrorCorrectLevel.M);
    } catch (e) {
      return v + 1 <= 40 ? getDataCapacity(v + 1) : 0;
    }
  }
  return binarySearchCapacity(version, 1, 5000);
}

function binarySearchCapacity(version, low, high) {
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    try {
      qrcode.generate(version, "A".repeat(mid), qrcode.ErrorCorrectLevel.M);
      low = mid;
    } catch {
      high = mid - 1;
    }
  }
  return low;
}

export async function renderQRCode(container, payload, label = "Scan this QR") {
  const strPayload = typeof payload === "string" ? payload : JSON.stringify(payload);
  const canvasEl = qrEncodeToCanvas(strPayload);
  canvasEl.className = "qr-canvas";
  const version = parseInt(canvasEl.dataset.qrVersion, 10);

  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "qr-display";

  const infoEl = document.createElement("div");
  infoEl.className = "qr-version-info";
  const moduleCount = version * 4 + 17;
  const scannable = version <= 15 ? "✅" : version <= 25 ? "⚠️" : "❌";
  infoEl.textContent = `${scannable} QR v${version} (${moduleCount}\u00d7${moduleCount}) \u2022 ${strPayload.length} bytes`;
  wrapper.appendChild(infoEl);

  wrapper.appendChild(canvasEl);

  const labelEl = document.createElement("p");
  labelEl.className = "qr-label";
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  if (version > 25) {
    const warnEl = document.createElement("p");
    warnEl.style.cssText = "color:var(--accent-yellow);font-size:12px;text-align:center;margin-top:4px;";
    warnEl.textContent = "QR code is dense — hold phone closer and ensure good lighting";
    wrapper.appendChild(warnEl);
  }

  container.appendChild(wrapper);

  return strPayload;
}

export async function scanQRCode(videoElement) {
  const detector = getBarcodeDetector();
  if (!detector) return null;
  try {
    const barcodes = await detector.detect(videoElement);
    if (barcodes.length > 0) {
      return barcodes[0].rawValue;
    }
  } catch {
    return null;
  }
  return null;
}

export function startCamera(videoElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("Camera API not available"));
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
      focusMode: "continuous",
    },
    audio: false,
  }).then((stream) => {
    videoElement.srcObject = stream;
    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("autoplay", "");
    videoElement.muted = true;
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
  let candidateCount = 0;
  const result = sdp.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("a=candidate:")) {
      candidateCount++;
      return true;
    }
    if (trimmed.startsWith("a=ice-pwd:")) return true;
    if (trimmed.startsWith("a=ice-ufrag:")) return true;
    if (trimmed.startsWith("a=fingerprint:")) return true;
    if (trimmed.startsWith("m=")) return true;
    if (trimmed.startsWith("c=")) return true;
    if (trimmed.startsWith("v=")) return true;
    if (trimmed.startsWith("a=sendrecv")) return true;
    if (trimmed.startsWith("a=recvonly")) return true;
    if (trimmed.startsWith("a=sendonly")) return true;
    if (trimmed.startsWith("a=mid:")) return true;
    if (trimmed.startsWith("o=")) return true;
    if (trimmed.startsWith("s=")) return true;
    if (trimmed.startsWith("t=")) return true;
    if (trimmed.startsWith("a=setup:")) return true;
    if (trimmed.startsWith("a=end-of-candidates")) return true;
    return false;
  }).join("\n");
  console.log(`[SDP] Stripped SDP: ${result.length} bytes, ${candidateCount} candidates`);
  return result;
}

export function compressSdp(sdp) {
  return compressPayload(stripNonEssentialSdpLines(sdp));
}

export function decompressSdp(payload) {
  return decompressPayload(payload);
}
