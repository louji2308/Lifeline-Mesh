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

function compressFallback(bytes) {
  let result = [];
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 128) {
      result.push(byte);
    } else {
      result.push((byte >> 6) | 192, (byte & 63) | 128);
    }
  }
  return new Uint8Array(result);
}

function decompressFallback(compressed) {
  const result = [];
  for (let i = 0; i < compressed.length; i++) {
    const byte = compressed[i];
    if (byte < 128) {
      result.push(byte);
    } else if (byte < 192) {
      continue;
    } else {
      if (i + 1 < compressed.length) {
        const byte2 = compressed[++i];
        result.push(((byte & 31) << 6) | (byte2 & 63));
      }
    }
  }
  return new Uint8Array(result);
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
  const fallback = compressFallback(bytes);
  const prefix = new Uint8Array([0x46, 0x42]); // "FB" marker for fallback
  const combined = new Uint8Array(prefix.length + fallback.length);
  combined.set(prefix, 0);
  combined.set(fallback, prefix.length);
  return toBase64Url(combined.buffer);
}

export async function decompressPayload(payloadStr) {
  const raw = new Uint8Array(fromBase64Url(payloadStr));
  try {
    if (supportsCompressionStream) {
      const decompressed = await decompressWithStream(raw);
      return new TextDecoder().decode(decompressed);
    }
  } catch {}
  if (raw[0] === 0x46 && raw[1] === 0x42) {
    const extracted = raw.slice(2);
    const decompressed = decompressFallback(extracted);
    return new TextDecoder().decode(decompressed);
  }
  return new TextDecoder().decode(raw);
}

function canvasQrEncode(text, size = 400) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const moduleCount = text.length * 8 + 32;
  const modulesPerSide = Math.ceil(Math.sqrt(moduleCount));
  const moduleSize = Math.floor(size / (modulesPerSide + 4));
  const offset = (size - moduleSize * modulesPerSide) / 2;

  ctx.fillStyle = "#000000";
  for (let row = 0; row < modulesPerSide; row++) {
    for (let col = 0; col < modulesPerSide; col++) {
      const idx = row * modulesPerSide + col;
      const byteIdx = Math.floor(idx / 8);
      const bitIdx = idx % 8;
      if (byteIdx < text.length) {
        if ((text.charCodeAt(byteIdx) >> bitIdx) & 1) {
          ctx.fillRect(offset + col * moduleSize, offset + row * moduleSize, moduleSize, moduleSize);
        }
      }
    }
  }

  const positions = [
    { row: 0, col: 0 },
    { row: 0, col: modulesPerSide - 7 },
    { row: modulesPerSide - 7, col: 0 },
  ];
  ctx.fillStyle = "#000000";
  for (const pos of positions) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          ctx.fillRect(offset + (pos.col + c) * moduleSize, offset + (pos.row + r) * moduleSize, moduleSize, moduleSize);
        }
      }
    }
  }

  return canvas;
}

export async function renderQRCode(container, payload, label = "Scan this QR") {
  const strPayload = typeof payload === "string" ? payload : JSON.stringify(payload);
  const compressed = await compressPayload(strPayload);
  const maxSegmentLength = 120;
  const segments = [];
  for (let i = 0; i < compressed.length; i += maxSegmentLength) {
    segments.push(compressed.slice(i, i + maxSegmentLength));
  }

  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "qr-display";

  if (segments.length === 1) {
    const canvas = canvasQrEncode(compressed);
    canvas.className = "qr-canvas";
    wrapper.appendChild(canvas);
  } else {
    let currentIndex = 0;
    const frameLabel = document.createElement("div");
    frameLabel.className = "qr-frame-label";
    const canvas = canvasQrEncode(segments[0]);
    canvas.className = "qr-canvas";
    const advanceBtn = document.createElement("button");
    advanceBtn.textContent = "Next →";
    advanceBtn.className = "qr-advance-btn";
    advanceBtn.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % segments.length;
      const newCanvas = canvasQrEncode(segments[currentIndex]);
      newCanvas.className = "qr-canvas";
      canvas.replaceWith(newCanvas);
      frameLabel.textContent = `Frame ${currentIndex + 1}/${segments.length}`;
    });
    frameLabel.textContent = `Frame 1/${segments.length}`;
    wrapper.appendChild(frameLabel);
    wrapper.appendChild(canvas);
    wrapper.appendChild(advanceBtn);
    if (segments.length > 1) {
      const autoInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % segments.length;
        const newCanvas = canvasQrEncode(segments[currentIndex]);
        newCanvas.className = "qr-canvas";
        const oldCanvas = wrapper.querySelector(".qr-canvas");
        if (oldCanvas) oldCanvas.replaceWith(newCanvas);
        frameLabel.textContent = `Frame ${currentIndex + 1}/${segments.length}`;
      }, 3000);
      wrapper.dataset.autoInterval = autoInterval;
    }
  }

  const labelEl = document.createElement("p");
  labelEl.className = "qr-label";
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);
  container.appendChild(wrapper);

  return compressed;
}

export async function scanQRCode(videoElement) {
  if ("BarcodeDetector" in globalThis) {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    try {
      const barcodes = await detector.detect(videoElement);
      if (barcodes.length > 0) {
        const rawValue = barcodes[0].rawValue;
        const decompressed = await decompressPayload(rawValue);
        return JSON.parse(decompressed);
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
