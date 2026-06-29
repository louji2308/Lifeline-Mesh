const DB_NAME = "lifeline-mesh";
const DB_VERSION = 1;
const MESSAGE_STORE = "messages";
const KEY_STORE = "keys";

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
        const store = db.createObjectStore(MESSAGE_STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("senderId", "senderId", { unique: false });
        store.createIndex("priority", "priority", { unique: false });
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: "name" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`IndexedDB open failed: ${request.error?.message || "unknown error"}`));
    request.onblocked = () => {
      console.warn("[DB] IndexedDB open blocked. Close other tabs.");
    };
  });
}

export function closeDb(db) {
  if (db) db.close();
}

export function putMessage(db, message) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readwrite");
    const store = tx.objectStore(MESSAGE_STORE);
    store.put(message);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error("Transaction aborted"));
  });
}

export function putMessagesBatch(db, messages) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readwrite");
    const store = tx.objectStore(MESSAGE_STORE);
    for (const message of messages) {
      store.put(message);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getAllMessages(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readonly");
    const store = tx.objectStore(MESSAGE_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getMessagesBySender(db, senderId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readonly");
    const store = tx.objectStore(MESSAGE_STORE);
    const index = store.index("senderId");
    const request = index.getAll(senderId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getMessagesByPriority(db, priority) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readonly");
    const store = tx.objectStore(MESSAGE_STORE);
    const index = store.index("priority");
    const request = index.getAll(priority);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getMessageCount(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readonly");
    const store = tx.objectStore(MESSAGE_STORE);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function deleteMessage(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readwrite");
    const store = tx.objectStore(MESSAGE_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function clearMessages(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGE_STORE, "readwrite");
    const store = tx.objectStore(MESSAGE_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export class WriteBuffer {
  constructor(db, flushIntervalMs = 200, maxBatchSize = 10) {
    this.db = db;
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
    this._buffer = [];
    this._timer = null;
    this._flushPromise = null;
  }

  add(message) {
    this._buffer.push(message);
    if (this._buffer.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this._timer) {
      this._timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._buffer.length === 0) return;
    const batch = this._buffer.splice(0);
    if (this._flushPromise) {
      await this._flushPromise;
    }
    this._flushPromise = putMessagesBatch(this.db, batch)
      .catch((err) => {
        console.error("[WriteBuffer] Batch write failed:", err);
        this._buffer.unshift(...batch);
      });
    await this._flushPromise;
    this._flushPromise = null;
  }

  destroy() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._buffer = [];
  }
}
