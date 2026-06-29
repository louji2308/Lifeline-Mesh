import { PeerManager } from "./transport/peerManager.js";
import { GossipRouter } from "./routing/gossipRouter.js";
import { MessageLog } from "./crdt/messageLog.js";
import { KeyManager } from "./crypto/keyManager.js";
import { deriveSharedKey } from "./crypto/ecdh.js";
import { encryptPayload, decryptPayload, signMessage, verifySignature } from "./crypto/cipher.js";
import { openDb, getAllMessages, WriteBuffer } from "./storage/db.js";
import { createMessage, PRIORITY, isBroadcast, isSOS } from "./schema.js";
import { MeshStatusUI } from "./ui/meshStatus.js";
import { ChatView } from "./ui/chatView.js";
import { PairingView } from "./ui/pairingView.js";

class LifeLineMeshApp {
  constructor() {
    this.db = null;
    this.peerManager = null;
    this.messageLog = null;
    this.keyManager = null;
    this.gossipRouter = null;
    this.writeBuffer = null;
    this.meshStatusUI = null;
    this.chatView = null;
    this.pairingView = null;
    this._peerKeyMap = new Map();
    this._groupKey = null;
    this._initialized = false;
    this._bootstrapPhase = null;
  }

  async boot() {
    try {
      console.log("[LifeLine] Booting LifeLine Mesh...");

      this.peerManager = new PeerManager();
      this.messageLog = new MessageLog();
      this.keyManager = new KeyManager();

      await this._initStorage();
      await this._initCrypto();
      this._initPeerManagerEvents();
      await this._rehydrateState();
      this._initRouter();
      this._initUI();
      this._initNavigation();
      this._initConnectivityBanner();
      this._initBatteryMonitoring();
      this._initSOSConfirmModal();

      document.getElementById("device-id-display")?.classList.remove("hidden");
      document.getElementById("device-id-display").textContent = this.keyManager.getFingerprint();

      this._initialized = true;
      console.log("[LifeLine] Boot complete. Device ID:", this.keyManager.getFingerprint());
    } catch (error) {
      console.error("[LifeLine] Boot failed:", error);
      this._showFatalError(error);
    }
  }

  async _initStorage() {
    try {
      this.db = await openDb();
      this.writeBuffer = new WriteBuffer(this.db);
      console.log("[LifeLine] Storage initialized");
    } catch (error) {
      console.warn("[LifeLine] Storage init failed (may be in private browsing mode):", error.message);
      this.db = null;
      this.writeBuffer = null;
    }
  }

  async _initCrypto() {
    try {
      let loaded = false;
      if (this.db) {
        loaded = await this.keyManager.loadFromDb(this.db);
      }
      if (!loaded) {
        console.log("[LifeLine] Generating new device keypair...");
        await this.keyManager.generateDeviceKeypair();
        if (this.db) {
          await this.keyManager.saveToDb(this.db);
        }
        console.log("[LifeLine] New device identity created:", this.keyManager.getFingerprint());
      } else {
        console.log("[LifeLine] Device identity loaded:", this.keyManager.getFingerprint());
      }
    } catch (error) {
      throw new Error(`Crypto init failed: ${error.message}`);
    }
  }

  async _rehydrateState() {
    if (!this.db) return;
    try {
      const storedMessages = await getAllMessages(this.db);
      if (storedMessages && storedMessages.length > 0) {
        let restored = 0;
        for (const msg of storedMessages) {
          if (this.messageLog.add(msg)) restored++;
        }
        console.log(`[LifeLine] Rehydrated ${restored} messages from storage`);
      }
    } catch (error) {
      console.warn("[LifeLine] State rehydration failed:", error.message);
    }
  }

  _initPeerManagerEvents() {
    this.peerManager.addEventListener("peer-connected", (event) => {
      const { peerId } = event.detail;
      console.log("[LifeLine] Peer connected:", peerId);
      this._updateBanner();
    });

    this.peerManager.addEventListener("peer-disconnected", (event) => {
      const { peerId, state } = event.detail;
      console.log("[LifeLine] Peer disconnected:", peerId, state);
      this._updateBanner();
    });

    this.peerManager.addEventListener("peer-removed", (event) => {
      console.log("[LifeLine] Peer removed:", event.detail.peerId);
      this._peerKeyMap.delete(event.detail.peerId);
      this._updateBanner();
    });

    this.peerManager.addEventListener("peer-error", (event) => {
      console.warn("[LifeLine] Peer error:", event.detail.peerId, event.detail.error);
    });
  }

  _initRouter() {
    this.gossipRouter = new GossipRouter(this.peerManager, (message) => {
      this._handleLocalDelivery(message);
    });
    const deviceId = this.keyManager.getFingerprint();
    this.gossipRouter.setMyDeviceId(deviceId);
  }

  _handleLocalDelivery(message) {
    if (this.messageLog.add(message)) {
      this._persistMessage(message);
    }

    this._handleAutoDecrypt(message);

    this.peerManager.deviceId = this.keyManager.getFingerprint();
  }

  async _handleAutoDecrypt(message) {
    try {
      if (message.plaintext) {
        message.decryptedText = message.plaintext;
        return;
      }

      if (isBroadcast(message) && this._groupKey) {
        const decrypted = await decryptPayload(this._groupKey, message.ciphertext, message.iv);
        message.decryptedText = typeof decrypted === "string" ? decrypted : JSON.stringify(decrypted);
      } else if (!isBroadcast(message) && this._peerKeyMap.has(message.senderId)) {
        const sharedKey = this._peerKeyMap.get(message.senderId);
        const decrypted = await decryptPayload(sharedKey, message.ciphertext, message.iv);
        message.decryptedText = typeof decrypted === "string" ? decrypted : JSON.stringify(decrypted);
      } else {
        message.decryptedText = "[Encrypted message]";
      }
    } catch {
      message.decryptedText = "[Could not decrypt]";
    }
  }

  async _persistMessage(message) {
    if (this.writeBuffer) {
      this.writeBuffer.add(message);
    }
  }

  async sendMessage(text, priority = PRIORITY.NORMAL) {
    try {
      const deviceId = this.keyManager.getFingerprint();
      const msg = createMessage({
        senderId: deviceId,
        recipientId: null,
        priority,
        vectorClock: this.messageLog.localClock,
        payload: text,
      });

      if (isBroadcast(msg) && this._groupKey) {
        const encrypted = await encryptPayload(this._groupKey, text);
        msg.ciphertext = encrypted.ciphertext;
        msg.iv = encrypted.iv;
        msg.signature = await signMessage(this.keyManager.signingKeyPair.privateKey, msg.id + msg.senderId + msg.ciphertext);
        msg.plaintext = "";
      } else if (!isBroadcast(msg)) {
        const targetId = msg.recipientId;
        if (this._peerKeyMap.has(targetId)) {
          const sharedKey = this._peerKeyMap.get(targetId);
          const encrypted = await encryptPayload(sharedKey, text);
          msg.ciphertext = encrypted.ciphertext;
          msg.iv = encrypted.iv;
          msg.signature = await signMessage(this.keyManager.signingKeyPair.privateKey, msg.id + msg.senderId + msg.ciphertext);
          msg.plaintext = "";
        }
      }

      msg.decryptedText = text;

      this.gossipRouter.sendLocal(msg);

      if (isSOS(msg)) {
        this._showSOSConfirmation();
      }

      return msg;
    } catch (error) {
      console.error("[LifeLine] Send message failed:", error);
      return null;
    }
  }

  _initUI() {
    this.meshStatusUI = new MeshStatusUI(this.peerManager, this.messageLog, this.gossipRouter);
    this.meshStatusUI.mount();

    this.chatView = new ChatView(this.messageLog, this.peerManager, (text, priority) => {
      this.sendMessage(text, priority);
    });
    this.chatView.mount();

    this.pairingView = new PairingView(this.peerManager, this.keyManager);
    this.pairingView.setOnPeerConnected(async (peerId) => {
      await this._exchangeKeys(peerId);
    });
    this.pairingView.mount();
  }

  async _exchangeKeys(peerId) {
    try {
      const myDhPubJwk = await this.keyManager.getPublicKeyJWK("dh");
      const mySignPubJwk = await this.keyManager.getPublicKeyJWK("signing");

      const keyExchangeMsg = {
        type: "key_exchange",
        senderId: this.keyManager.getFingerprint(),
        dhPublicKey: myDhPubJwk,
        signingPublicKey: mySignPubJwk,
      };

      this.peerManager.send(peerId, keyExchangeMsg);

      if (!this._groupKey) {
        await this.keyManager.generateGroupKey();
        this._groupKey = this.keyManager.groupKey;

        const groupKeyRaw = await this.keyManager.exportGroupKey();
        const encryptedGroupKey = await encryptPayload(this._groupKey, {
          key: Array.from(new Uint8Array(groupKeyRaw)),
          timestamp: Date.now(),
        });

        const groupKeyMsg = {
          type: "group_key_announce",
          senderId: this.keyManager.getFingerprint(),
          encryptedKey: encryptedGroupKey.ciphertext,
          iv: encryptedGroupKey.iv,
        };

        setTimeout(() => {
          this.peerManager.send(peerId, groupKeyMsg);
        }, 500);
      }
    } catch (error) {
      console.warn("[LifeLine] Key exchange failed:", error.message);
    }
  }

  _initNavigation() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const viewName = btn.dataset.view;
        if (!viewName) return;

        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        const targetView = document.getElementById(`view-${viewName}`);
        if (targetView) targetView.classList.add("active");
      });
    });

    document.getElementById("btn-pair-device")?.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelector('.nav-btn[data-view="pair"]')?.classList.add("active");
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      document.getElementById("view-pair")?.classList.add("active");
    });
  }

  _initConnectivityBanner() {
    this._updateBanner();
    window.addEventListener("online", () => this._updateBanner());
    window.addEventListener("offline", () => this._updateBanner());
  }

  _updateBanner() {
    const banner = document.getElementById("connectivity-banner");
    const text = document.getElementById("banner-text");
    if (!banner || !text) return;

    const peerCount = this.peerManager ? this.peerManager.getConnectedCount() : 0;
    const isOnline = navigator.onLine;

    if (isOnline) {
      banner.className = "online";
      text.textContent = `🌐 Online (mesh active — ${peerCount} peer${peerCount !== 1 ? "s" : ""})`;
    } else {
      banner.className = "offline";
      text.textContent = `🟢 Mesh Mode Active — ${peerCount} peer${peerCount !== 1 ? "s" : ""}, zero internet required`;
    }
    banner.classList.remove("hidden");
  }

  _initBatteryMonitoring() {
    if ("getBattery" in navigator) {
      navigator.getBattery().then((battery) => {
        this._onBatteryChange(battery);
        battery.addEventListener("levelchange", () => this._onBatteryChange(battery));
      }).catch(() => {});
    }
  }

  _onBatteryChange(battery) {
    const level = battery.level;
    if (this.peerManager) {
      this.peerManager.updateBatteryLevel(level);
    }
    if (level < 0.2) {
      console.log("[LifeLine] Battery low — reducing heartbeat frequency");
    }
  }

  _initSOSConfirmModal() {
    const modal = document.getElementById("sos-confirm-modal");
    const cancelBtn = document.getElementById("btn-sos-cancel");
    const confirmBtn = document.getElementById("btn-sos-confirm");

    if (!modal || !cancelBtn || !confirmBtn) return;

    cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));
    confirmBtn.addEventListener("click", () => modal.classList.add("hidden"));

    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.classList.add("hidden");
    });
  }

  _showSOSConfirmation() {
    const modal = document.getElementById("sos-confirm-modal");
    if (modal) modal.classList.remove("hidden");
    const banner = document.getElementById("connectivity-banner");
    const text = document.getElementById("banner-text");
    if (banner && text) {
      banner.className = "offline";
      text.textContent = "🚨 SOS message broadcasting to mesh...";
      setTimeout(() => this._updateBanner(), 3000);
    }
  }

  _showFatalError(error) {
    const main = document.getElementById("main-content");
    if (main) {
      main.innerHTML = `
        <div class="card" style="text-align:center;padding:40px 20px;">
          <div style="font-size:48px;margin-bottom:16px;">❌</div>
          <h2 style="margin-bottom:12px;">Failed to Initialize</h2>
          <p style="color:var(--text-secondary);margin-bottom:16px;">
            LifeLine Mesh could not start. This may be due to browser compatibility or storage issues.
          </p>
          <p style="color:var(--text-muted);font-size:12px;font-family:monospace;word-break:break-all;">
            ${this._escapeHtml(error.message)}
          </p>
          <button class="btn btn-primary" style="margin-top:16px;" onclick="location.reload()">
            Retry
          </button>
        </div>
      `;
    }
  }

  _escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}

const app = new LifeLineMeshApp();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      console.log("[LifeLine] ServiceWorker registered:", reg.scope);
    }).catch((err) => {
      console.warn("[LifeLine] ServiceWorker registration failed:", err.message);
    });
  });
}

app.boot().catch((err) => {
  console.error("[LifeLine] Fatal boot error:", err);
});

export default app;
