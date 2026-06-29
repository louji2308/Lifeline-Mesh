import { mergeClock } from "./vectorClock.js";

export class MessageLog {
  constructor() {
    this.messages = new Map();
    this.localClock = {};
    this._listeners = new Set();
  }

  add(message) {
    if (!message || !message.id) return false;
    if (this.messages.has(message.id)) {
      this.localClock = mergeClock(this.localClock, message.vectorClock);
      return false;
    }
    this.messages.set(message.id, message);
    this.localClock = mergeClock(this.localClock, message.vectorClock);
    this._notifyListeners(message);
    return true;
  }

  addBatch(messages) {
    let addedCount = 0;
    for (const message of messages) {
      if (this.add(message)) addedCount++;
    }
    return addedCount;
  }

  has(id) {
    return this.messages.has(id);
  }

  get(id) {
    return this.messages.get(id) || null;
  }

  getCount() {
    return this.messages.size;
  }

  getAllMessages() {
    return [...this.messages.values()];
  }

  getMessagesForDevice(deviceId) {
    return [...this.messages.values()].filter(
      (m) => m.recipientId === null || m.recipientId === deviceId
    );
  }

  getSOSMessages() {
    return [...this.messages.values()].filter((m) => m.priority === "sos");
  }

  mergeWith(otherLog) {
    if (!otherLog || !otherLog.messages) return 0;
    let newCount = 0;
    for (const [id, message] of otherLog.messages) {
      if (this.add({ ...message, vectorClock: { ...message.vectorClock } })) {
        newCount++;
      }
    }
    return newCount;
  }

  getSortedForDisplay(order = "asc") {
    const sorted = [...this.messages.values()].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return order === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
      }
      return a.id.localeCompare(b.id);
    });
    return sorted;
  }

  getCausallySorted() {
    const messages = [...this.messages.values()];
    const visited = new Set();
    const result = [];

    function visit(message, log) {
      if (visited.has(message.id)) return;
      visited.add(message.id);

      for (const other of messages) {
        if (other.id === message.id) continue;
        if (other.vectorClock && message.vectorClock &&
            happenedBefore(other.vectorClock, message.vectorClock)) {
          visit(other, log);
        }
      }
      result.push(message);
    }

    for (const msg of messages) {
      visit(msg, this);
    }
    return result;
  }

  pruneBeforeTimestamp(timestamp) {
    let pruned = 0;
    for (const [id, message] of this.messages) {
      if (message.timestamp < timestamp) {
        this.messages.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  pruneRelaySet(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const active = new Map();
    for (const [id, message] of this.messages) {
      if (message.timestamp >= cutoff || message.priority === "sos") {
        active.set(id, message);
      }
    }
    const pruned = this.messages.size - active.size;
    this.messages = active;
    return pruned;
  }

  toJSON() {
    return {
      messages: Array.from(this.messages.entries()),
      localClock: this.localClock,
    };
  }

  static fromJSON(data) {
    const log = new MessageLog();
    if (data && data.messages) {
      for (const [id, message] of data.messages) {
        log.messages.set(id, message);
      }
    }
    if (data && data.localClock) {
      log.localClock = { ...data.localClock };
    }
    return log;
  }

  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notifyListeners(message) {
    for (const listener of this._listeners) {
      try {
        listener(message);
      } catch (err) {
        console.error("[MessageLog] Listener error:", err);
      }
    }
  }
}

function happenedBefore(clockA, clockB) {
  let strictlyLess = false;
  const devices = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  for (const d of devices) {
    const a = clockA[d] || 0;
    const b = clockB[d] || 0;
    if (a > b) return false;
    if (a < b) strictlyLess = true;
  }
  return strictlyLess;
}
