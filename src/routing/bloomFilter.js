const DEFAULT_SIZE = 8192;
const DEFAULT_HASHES = 4;
const FNUV1A_OFFSET_BASIS = 2166136261;
const FNUV1A_PRIME = 16777619;

export class BloomFilter {
  constructor(sizeInBits = DEFAULT_SIZE, numHashes = DEFAULT_HASHES) {
    if (sizeInBits < 1) throw new Error("BloomFilter size must be positive");
    if (numHashes < 1) throw new Error("BloomFilter numHashes must be positive");
    this.size = sizeInBits;
    this.numHashes = numHashes;
    this.numBytes = Math.ceil(sizeInBits / 8);
    this.bits = new Uint8Array(this.numBytes);
    this.count = 0;
  }

  _hash(value, seed) {
    let hash = FNUV1A_OFFSET_BASIS ^ seed;
    const str = String(value);
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, FNUV1A_PRIME);
    }
    return (hash >>> 0) % this.size;
  }

  _getBitIndices(value) {
    const indices = new Array(this.numHashes);
    for (let i = 0; i < this.numHashes; i++) {
      indices[i] = this._hash(value, i);
    }
    return indices;
  }

  add(value) {
    if (value === undefined || value === null) return;
    const indices = this._getBitIndices(value);
    for (const bitIndex of indices) {
      const byteIndex = bitIndex >> 3;
      const mask = 1 << (bitIndex & 7);
      if (!(this.bits[byteIndex] & mask)) {
        this.bits[byteIndex] |= mask;
        this.count++;
      }
    }
  }

  mightContain(value) {
    if (value === undefined || value === null) return false;
    const indices = this._getBitIndices(value);
    for (const bitIndex of indices) {
      const byteIndex = bitIndex >> 3;
      const mask = 1 << (bitIndex & 7);
      if ((this.bits[byteIndex] & mask) === 0) return false;
    }
    return true;
  }

  clear() {
    this.bits.fill(0);
    this.count = 0;
  }

  getLoadFactor() {
    return this.count / this.size;
  }

  getEstimatedFalsePositiveRate() {
    const k = this.numHashes;
    const m = this.size;
    const n = this.count;
    if (n === 0) return 0;
    return Math.pow(1 - Math.exp(-k * n / m), k);
  }

  export() {
    return {
      bits: Array.from(this.bits),
      size: this.size,
      numHashes: this.numHashes,
      count: this.count,
    };
  }

  static import(data) {
    const filter = new BloomFilter(data.size, data.numHashes);
    filter.bits = new Uint8Array(data.bits);
    filter.count = data.count || 0;
    return filter;
  }

  clone() {
    const cloned = new BloomFilter(this.size, this.numHashes);
    cloned.bits = new Uint8Array(this.bits);
    cloned.count = this.count;
    return cloned;
  }

  static optimalSize(expectedItems, falsePositiveRate = 0.01) {
    if (expectedItems <= 0) return DEFAULT_SIZE;
    const ln2 = Math.LN2;
    const ln2Sq = ln2 * ln2;
    const bits = Math.ceil(-(expectedItems * Math.log(falsePositiveRate)) / ln2Sq);
    return Math.max(bits, 8);
  }

  static optimalHashes(expectedItems, sizeInBits) {
    if (expectedItems <= 0 || sizeInBits <= 0) return DEFAULT_HASHES;
    const hashes = Math.round((sizeInBits / expectedItems) * Math.LN2);
    return Math.max(hashes, 1);
  }
}
