const KEY_STORE_NAME = "keys";
const SIGNING_KEY_NAME = "device-signing-key";
const DH_KEY_NAME = "device-dh-key";
const GROUP_KEY_NAME = "mesh-group-key";

export class KeyManager {
  constructor() {
    this.signingKeyPair = null;
    this.dhKeyPair = null;
    this.groupKey = null;
    this.deviceId = null;
    this._publicKeyCache = new Map();
  }

  async generateDeviceKeypair() {
    try {
      this.signingKeyPair = await crypto.subtle.generateKey(
        {
          name: "ECDSA",
          namedCurve: "P-256",
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
      );

      this.dhKeyPair = await crypto.subtle.generateKey(
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        true,
        ["deriveKey", "deriveBits"]
      );

      this.deviceId = await this._deriveDeviceId();
      return { signingKeyPair: this.signingKeyPair, dhKeyPair: this.dhKeyPair, deviceId: this.deviceId };
    } catch (error) {
      throw new Error(`Failed to generate device keypair: ${error.message}`);
    }
  }

  async _deriveDeviceId() {
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", this.signingKeyPair.publicKey);
    const keyData = publicKeyJwk.x + publicKeyJwk.y;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(keyData));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return "LM" + hashHex.slice(0, 16);
  }

  async getPublicKeyJWK(keyType = "signing") {
    if (keyType === "signing" && this.signingKeyPair) {
      return crypto.subtle.exportKey("jwk", this.signingKeyPair.publicKey);
    }
    if (keyType === "dh" && this.dhKeyPair) {
      return crypto.subtle.exportKey("jwk", this.dhKeyPair.publicKey);
    }
    throw new Error(`Key type "${keyType}" not available`);
  }

  async importPeerPublicKey(peerId, jwk, keyType = "dh") {
    const algorithm = keyType === "dh"
      ? { name: "ECDH", namedCurve: "P-256" }
      : { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
    const usages = keyType === "dh" ? [] : ["verify"];

    const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, usages);
    this._publicKeyCache.set(`${peerId}-${keyType}`, key);
    return key;
  }

  importPeerDhKeyFromJwk(peerId, jwk) {
    return this.importPeerPublicKey(peerId, jwk, "dh");
  }

  importPeerSigningKeyFromJwk(peerId, jwk) {
    return this.importPeerPublicKey(peerId, jwk, "signing");
  }

  getCachedPublicKey(peerId, keyType = "dh") {
    return this._publicKeyCache.get(`${peerId}-${keyType}`) || null;
  }

  getPeerDhPublicKey(peerId) {
    return this.getCachedPublicKey(peerId, "dh");
  }

  getPeerSigningPublicKey(peerId) {
    return this.getCachedPublicKey(peerId, "signing");
  }

  async generateGroupKey() {
    try {
      this.groupKey = await crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256,
        },
        true,
        ["encrypt", "decrypt"]
      );
      return this.groupKey;
    } catch (error) {
      throw new Error(`Failed to generate group key: ${error.message}`);
    }
  }

  async exportGroupKey() {
    if (!this.groupKey) return null;
    return crypto.subtle.exportKey("raw", this.groupKey);
  }

  async importGroupKey(rawKeyData) {
    try {
      this.groupKey = await crypto.subtle.importKey(
        "raw",
        rawKeyData,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      return this.groupKey;
    } catch (error) {
      throw new Error(`Failed to import group key: ${error.message}`);
    }
  }

  hasGroupKey() {
    return this.groupKey !== null;
  }

  getFingerprint() {
    if (!this.deviceId) return "UNKNOWN";
    return this.deviceId;
  }

  async saveToDb(db) {
    if (!db) return;
    const tx = db.transaction(KEY_STORE_NAME, "readwrite");
    const store = tx.objectStore(KEY_STORE_NAME);

    if (this.signingKeyPair) {
      const signingPriv = await crypto.subtle.exportKey("pkcs8", this.signingKeyPair.privateKey);
      const signingPub = await crypto.subtle.exportKey("spki", this.signingKeyPair.publicKey);
      store.put({ name: SIGNING_KEY_NAME, privateKey: signingPriv, publicKey: signingPub });
    }

    if (this.dhKeyPair) {
      const dhPriv = await crypto.subtle.exportKey("pkcs8", this.dhKeyPair.privateKey);
      const dhPub = await crypto.subtle.exportKey("spki", this.dhKeyPair.publicKey);
      store.put({ name: DH_KEY_NAME, privateKey: dhPriv, publicKey: dhPub });
    }

    if (this.groupKey) {
      const groupKeyRaw = await crypto.subtle.exportKey("raw", this.groupKey);
      store.put({ name: GROUP_KEY_NAME, keyData: groupKeyRaw });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadFromDb(db) {
    if (!db) return false;
    const tx = db.transaction(KEY_STORE_NAME, "readonly");
    const store = tx.objectStore(KEY_STORE_NAME);

    const loadKey = (name) => new Promise((resolve, reject) => {
      const req = store.get(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    try {
      const signingData = await loadKey(SIGNING_KEY_NAME);
      const dhData = await loadKey(DH_KEY_NAME);
      const groupData = await loadKey(GROUP_KEY_NAME);

      if (signingData) {
        this.signingKeyPair = {
          privateKey: await crypto.subtle.importKey("pkcs8", signingData.privateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
          publicKey: await crypto.subtle.importKey("spki", signingData.publicKey, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]),
        };
      }

      if (dhData) {
        this.dhKeyPair = {
          privateKey: await crypto.subtle.importKey("pkcs8", dhData.privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]),
          publicKey: await crypto.subtle.importKey("spki", dhData.publicKey, { name: "ECDH", namedCurve: "P-256" }, true, []),
        };
      }

      if (groupData) {
        this.groupKey = await crypto.subtle.importKey("raw", groupData.keyData, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      }

      if (this.signingKeyPair) {
        this.deviceId = await this._deriveDeviceId();
      }

      return !!(this.signingKeyPair && this.dhKeyPair);
    } catch {
      return false;
    }
  }

  async clearKeys(db) {
    if (db) {
      const tx = db.transaction(KEY_STORE_NAME, "readwrite");
      const store = tx.objectStore(KEY_STORE_NAME);
      store.clear();
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    this.signingKeyPair = null;
    this.dhKeyPair = null;
    this.groupKey = null;
    this.deviceId = null;
    this._publicKeyCache.clear();
  }
}
