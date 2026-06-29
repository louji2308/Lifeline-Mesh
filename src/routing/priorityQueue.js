import { PRIORITY_ORDER } from "../schema.js";

export class PriorityQueue {
  constructor() {
    this.buckets = {
      sos: [],
      normal: [],
      chat: [],
    };
    this._totalSize = 0;
  }

  enqueue(message) {
    const priority = message.priority || "normal";
    if (!this.buckets.hasOwnProperty(priority)) {
      this.buckets[priority] = [];
    }
    this.buckets[priority].push(message);
    this._totalSize++;
    return this._totalSize;
  }

  dequeue() {
    for (const tier of PRIORITY_ORDER) {
      const bucket = this.buckets[tier];
      if (bucket.length > 0) {
        this._totalSize--;
        return bucket.shift();
      }
    }
    return null;
  }

  peek() {
    for (const tier of PRIORITY_ORDER) {
      const bucket = this.buckets[tier];
      if (bucket.length > 0) {
        return bucket[0];
      }
    }
    return null;
  }

  get size() {
    return this._totalSize;
  }

  getBucketSizes() {
    return {
      sos: this.buckets.sos.length,
      normal: this.buckets.normal.length,
      chat: this.buckets.chat.length,
    };
  }

  drain(limit = Infinity) {
    const messages = [];
    let msg;
    while (messages.length < limit && (msg = this.dequeue()) !== null) {
      messages.push(msg);
    }
    return messages;
  }

  clear() {
    this.buckets.sos = [];
    this.buckets.normal = [];
    this.buckets.chat = [];
    this._totalSize = 0;
  }
}
