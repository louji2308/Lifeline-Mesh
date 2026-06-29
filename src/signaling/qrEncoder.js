const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfPolyMul(poly, coeff) {
  const result = new Uint8Array(poly.length);
  for (let i = 0; i < poly.length; i++) result[i] = gfMul(poly[i], coeff);
  return result;
}

function rsEncode(data, eccCount) {
  const gen = new Uint8Array(eccCount);
  gen[0] = 1;
  for (let i = 0; i < eccCount; i++) {
    for (let j = i; j > 0; j--) gen[j] = gen[j - 1] ^ gfMul(gen[j], GF_EXP[i]);
    gen[0] = gfMul(gen[0], GF_EXP[i]);
  }

  const remainder = new Uint8Array(data.length + eccCount);
  remainder.set(data, 0);

  for (let i = 0; i < data.length; i++) {
    if (remainder[i] === 0) continue;
    const factor = GF_LOG[remainder[i]];
    for (let j = 0; j < eccCount; j++) {
      remainder[i + j + 1] ^= gfMul(gen[j], GF_EXP[factor]);
    }
  }

  return remainder.slice(data.length);
}

const VERSION_TABLE = {
  1: { size: 21, totalCodewords: 26, eccCodewords: { L: 7, M: 10, Q: 13, H: 17 }, dataCodewords: { L: 19, M: 16, Q: 13, H: 9 }, alignment: [] },
  2: { size: 25, totalCodewords: 44, eccCodewords: { L: 10, M: 16, Q: 22, H: 28 }, dataCodewords: { L: 34, M: 28, Q: 22, H: 16 }, alignment: [6, 18] },
  3: { size: 29, totalCodewords: 70, eccCodewords: { L: 15, M: 26, Q: 36, H: 44 }, dataCodewords: { L: 55, M: 44, Q: 34, H: 26 }, alignment: [6, 22] },
  4: { size: 33, totalCodewords: 100, eccCodewords: { L: 20, M: 36, Q: 52, H: 64 }, dataCodewords: { L: 80, M: 64, Q: 48, H: 36 }, alignment: [6, 26] },
  5: { size: 37, totalCodewords: 134, eccCodewords: { L: 26, M: 48, Q: 72, H: 88 }, dataCodewords: { L: 108, M: 86, Q: 62, H: 46 }, alignment: [6, 30] },
  6: { size: 41, totalCodewords: 172, eccCodewords: { L: 36, M: 64, Q: 96, H: 112 }, dataCodewords: { L: 136, M: 108, Q: 76, H: 60 }, alignment: [6, 34] },
};

const FORMAT_MASK = 0x5412;

const ECC_FORMAT = {
  M: [0x00, 0x5412, 0x2a24, 0x7e36],
};

const BIT_COUNT_TABLE = {
  byte: { 1: 8, 2: 16, 3: 16, 4: 16, 5: 16, 6: 16 },
};

function getMinVersion(dataLen, eccLevel) {
  for (let v = 1; v <= 6; v++) {
    const info = VERSION_TABLE[v];
    if (dataLen <= info.dataCodewords[eccLevel]) return v;
  }
  return 6;
}

function encodeByteMode(data, version) {
  const bitCount = BIT_COUNT_TABLE.byte[version] || 16;
  const dataBits = [];
  const modeBits = [0, 1, 0, 0];
  dataBits.push(...modeBits);
  const charCount = data.length;
  for (let i = bitCount - 1; i >= 0; i--) {
    dataBits.push((charCount >> i) & 1);
  }
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((byte >> i) & 1);
    }
  }
  return dataBits;
}

function bitsToCodewords(bits, numCodewords) {
  while (bits.length < numCodewords * 8) {
    bits.push(0);
  }
  if (bits.length > numCodewords * 8) {
    bits = bits.slice(0, numCodewords * 8);
  }
  const codewords = new Uint8Array(numCodewords);
  for (let i = 0; i < numCodewords * 8; i++) {
    if (bits[i]) codewords[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  }
  return codewords;
}

function placeFinder(matrix, x, y) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const nx = x + c;
      const ny = y + r;
      if (nx < 0 || ny < 0 || nx >= matrix[0].length || ny >= matrix.length) continue;
      if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
        const border = r === 0 || r === 6 || c === 0 || c === 6;
        const inner = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[ny][nx] = (border || inner) ? 1 : 0;
      } else if ((r === -1 || r === 7 || c === -1 || c === 7) && (nx >= 0 && ny >= 0)) {
        matrix[ny][nx] = 0;
      }
    }
  }
}

function placeTiming(matrix) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0 ? 1 : 0;
    matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }
}

function placeDarkModule(matrix) {
  const size = matrix.length;
  matrix[size - 8][8] = 1;
}

function placeAlignment(matrix, version) {
  const info = VERSION_TABLE[version];
  const centers = info.alignment;
  if (centers.length < 2) return;
  for (const cy of centers) {
    for (const cx of centers) {
      if (cx === 6 && cy === 6) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const nx = cx + c;
          const ny = cy + r;
          if (nx < 0 || ny < 0 || nx >= matrix.length || ny >= matrix.length) continue;
          if (Math.abs(r) === 2 || Math.abs(c) === 2 || (Math.abs(r) === 0 && Math.abs(c) === 0)) {
            matrix[ny][nx] = 1;
          } else {
            matrix[ny][nx] = 0;
          }
        }
      }
    }
  }
}

function placeFormatBits(matrix, formatBits) {
  const size = matrix.length;
  for (let i = 0; i <= 5; i++) {
    matrix[8][i] = formatBits[i];
    matrix[i][8] = formatBits[i < 5 ? (i < 3 ? 7 - i : i + 1) : (7 - i)];
  }
  matrix[8][7] = formatBits[6];
  matrix[8][8] = formatBits[7];
  matrix[7][8] = formatBits[8];
  for (let i = 9; i <= 14; i++) {
    matrix[14 - i][8] = formatBits[i];
  }
  for (let i = 0; i <= 7; i++) {
    matrix[size - 1 - i][8] = formatBits[i < 6 ? i : (i < 7 ? 7 : 8)];
  }
  matrix[8][size - 8] = formatBits[7];
  for (let i = 8; i <= 14; i++) {
    matrix[8][size - 15 + i] = formatBits[i];
  }
}

function calculateFormatBits(eccLevel, maskPattern) {
  const eccCodes = { L: 1, M: 0, Q: 3, H: 2 };
  const data = (eccCodes[eccLevel] << 3) | maskPattern;
  let bch = data << 10;
  const genPoly = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((bch >> i) & 1) bch ^= genPoly << (i - 10);
  }
  const raw = ((data << 10) | bch) ^ FORMAT_MASK;
  const bits = [];
  for (let i = 14; i >= 0; i--) bits.push((raw >> i) & 1);
  return bits;
}

function applyMask(matrix, maskPattern) {
  const size = matrix.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] !== null) continue;
      let invert = false;
      switch (maskPattern) {
        case 0: invert = (r + c) % 2 === 0; break;
        case 1: invert = r % 2 === 0; break;
        case 2: invert = c % 3 === 0; break;
        case 3: invert = (r + c) % 3 === 0; break;
        case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: invert = (r * c) % 2 + (r * c) % 3 === 0; break;
        case 6: invert = ((r * c) % 2 + (r * c) % 3) % 2 === 0; break;
        case 7: invert = ((r + c) % 2 + (r * c) % 3) % 2 === 0; break;
      }
      if (invert) matrix[r][c] = matrix[r][c] === 1 ? 0 : 1;
    }
  }
}

function calculatePenalty(matrix) {
  const size = matrix.length;
  let penalty = 0;

  for (let r = 0; r < size; r++) {
    let run = 0;
    let prev = -1;
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === prev) {
        run++;
      } else {
        if (run >= 5) penalty += run - 2;
        prev = matrix[r][c];
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }

  for (let c = 0; c < size; c++) {
    let run = 0;
    let prev = -1;
    for (let r = 0; r < size; r++) {
      if (matrix[r][c] === prev) {
        run++;
      } else {
        if (run >= 5) penalty += run - 2;
        prev = matrix[r][c];
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

function placeData(matrix, dataBits, eccBits) {
  const allBits = [];
  for (const b of dataBits) allBits.push(b);
  for (const bit of eccBits) allBits.push(bit);

  const size = matrix.length;
  let bitIdx = 0;
  let direction = -1;
  let col = size - 1;

  while (col > 0) {
    if (col === 6) col--;
    for (let row = direction === -1 ? size - 1 : 0; row >= 0 && row < size; row += direction) {
      for (let c = 0; c < 2; c++) {
        const cx = col - c;
        if (cx < 0) continue;
        if (matrix[row][cx] === null && bitIdx < allBits.length) {
          matrix[row][cx] = allBits[bitIdx++];
        }
      }
    }
    col -= 2;
    direction = -direction;
  }
}

export function createQRMatrix(text, eccLevel = "M") {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(text);
  const version = getMinVersion(dataBytes.length, eccLevel);
  const info = VERSION_TABLE[version];
  const eccCount = info.eccCodewords[eccLevel];
  const dataCount = info.dataCodewords[eccLevel];

  const dataBits = encodeByteMode(dataBytes, version);
  const dataCodewords = bitsToCodewords(dataBits, dataCount);

  const paddingBytes = [0xec, 0x11];
  const padded = new Uint8Array(dataCount);
  padded.set(dataCodewords, 0);
  for (let i = dataCodewords.length; i < dataCount; i++) {
    padded[i] = paddingBytes[(i - dataCodewords.length) % 2];
  }

  const eccCodewords = rsEncode(padded, eccCount);

  const size = info.size;
  const matrix = [];
  for (let r = 0; r < size; r++) {
    matrix[r] = new Array(size).fill(null);
  }

  placeFinder(matrix, 0, 0);
  placeFinder(matrix, size - 7, 0);
  placeFinder(matrix, 0, size - 7);
  placeAlignment(matrix, version);
  placeTiming(matrix);
  placeDarkModule(matrix);

  const dataBitArr = [];
  for (const byte of padded) {
    for (let i = 7; i >= 0; i--) dataBitArr.push((byte >> i) & 1);
  }
  const eccBitArr = [];
  for (const byte of eccCodewords) {
    for (let i = 7; i >= 0; i--) eccBitArr.push((byte >> i) & 1);
  }
  placeData(matrix, dataBitArr, eccBitArr);

  let bestMatrix = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = matrix.map(row => row.slice());
    applyMask(trial, mask);
    const formatBits = calculateFormatBits(eccLevel, mask);
    placeFormatBits(trial, formatBits);
    const score = calculatePenalty(trial);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMatrix = trial;
    }
  }

  return bestMatrix;
}

export function renderQRToCanvas(text, canvas, size = 400) {
  const matrix = createQRMatrix(text);
  const matrixSize = matrix.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  const moduleSize = Math.floor(size / (matrixSize + 4));
  const offset = (size - moduleSize * matrixSize) / 2;

  canvas.width = size;
  canvas.height = size;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#000000";
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(offset + c * moduleSize, offset + r * moduleSize, moduleSize, moduleSize);
      }
    }
  }

  return canvas;
}
