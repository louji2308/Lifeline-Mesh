import { PeerManager } from "./transport/peerManager.js";
import { GossipRouter } from "./routing/gossipRouter.js";
import { MessageLog } from "./crdt/messageLog.js";
import { KeyManager } from "./crypto/keyManager.js";
import { deriveSharedKey, importPublicDhKey } from "./crypto/ecdh.js";
import { encryptPayload, decryptPayload, signMessage, verifySignature } from "./crypto/cipher.js";
import { openDb, getAllMessages, WriteBuffer } from "./storage/db.js";
import { createMessage, PRIORITY, isBroadcast, isSOS } from "./schema.js";
import { MESSAGE_TYPE } from "./transport/dataChannel.js";
import { extractConnectionFromURL, clearConnectionFromURL } from "./signaling/lanDiscovery.js";
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
    this._peerSigningKeyMap = new Map();
    this._groupKey = null;
    this._initialized = false;
    this._pendingConnections = new Map();
    this._keyExchangeSent = new Set();
    this._peerDeviceIds = new Map();
    this._connectionToPeerId = new Map();
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
      this._initControlMessageHandler();
      this._initConnectionManager();
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

      this._checkConnectionURL();
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

      if (!this.keyManager.hasGroupKey()) {
        await this.keyManager.generateGroupKey();
        if (this.db) {
          await this.keyManager.saveToDb(this.db);
        }
        this._groupKey = this.keyManager.groupKey;
        console.log("[LifeLine] Group key generated");
      } else {
        this._groupKey = this.keyManager.groupKey;
        console.log("[LifeLine] Group key loaded from storage");
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
      const { peerId } = event.detail;
      console.log("[LifeLine] Peer removed:", peerId);
      this._peerKeyMap.delete(peerId);
      this._peerSigningKeyMap.delete(peerId);
      this._keyExchangeSent.delete(peerId);
      this._updateBanner();
    });

    this.peerManager.addEventListener("peer-error", (event) => {
      console.warn("[LifeLine] Peer error:", event.detail.peerId, event.detail.error);
    });

    this.peerManager.addEventListener("peer-reconnected", (event) => {
      const { peerId } = event.detail;
      console.log("[LifeLine] Peer reconnected:", peerId);
      this._updateBanner();
    });
  }

  _initControlMessageHandler() {
    this.peerManager.addEventListener("control-message", (event) => {
      const { peerId, message } = event.detail;
      if (message.type === MESSAGE_TYPE.KEY_EXCHANGE) {
        this._handleKeyExchange(peerId, message).catch((err) => {
          console.error("[LifeLine] Key exchange handler error:", err);
        });
      } else if (message.type === MESSAGE_TYPE.GROUP_KEY_ANNOUNCE) {
        this._handleGroupKeyAnnounce(peerId, message).catch((err) => {
          console.error("[LifeLine] Group key announce handler error:", err);
        });
      }
    });
  }

  _initConnectionManager() {
    this.pairingView.addEventListener("connection-ready", (event) => {
      const { pc, dataChannel, tempId, isInitiator } = event.detail;
      this._establishSecureConnection(tempId, pc, dataChannel, isInitiator);
    });
  }

  async _establishSecureConnection(tempId, pc, dataChannel, isInitiator) {
    console.log("[LifeLine] Establishing secure connection, tempId:", tempId);

    this._pendingConnections.set(tempId, {
      pc,
      dataChannel,
      isInitiator,
      established: false,
    });

    await this._waitForDataChannelOpen(dataChannel);

    dataChannel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && parsed.type === MESSAGE_TYPE.KEY_EXCHANGE) {
          this._completeKeyExchange(tempId, dataChannel, parsed).catch((err) => {
            console.error("[LifeLine] Key exchange completion error:", err);
          });
        }
      } catch {}
    };

    await this._sendKeyExchange(tempId, dataChannel);

    if (!this._pendingConnections.has(tempId)) return;
    this._pendingConnections.get(tempId).keyExchangeSent = true;
  }

  _waitForDataChannelOpen(dataChannel) {
    if (dataChannel.readyState === "open") return Promise.resolve();
    return new Promise((resolve) => {
      const handler = () => {
        dataChannel.removeEventListener("open", handler);
        resolve();
      };
      dataChannel.addEventListener("open", handler);
      setTimeout(() => resolve(), 5000);
    });
  }

  async _sendKeyExchange(tempId, dataChannel) {
    try {
      const myDhPubJwk = await this.keyManager.getPublicKeyJWK("dh");
      const mySignPubJwk = await this.keyManager.getPublicKeyJWK("signing");

      const keyExchangeMsg = {
        type: MESSAGE_TYPE.KEY_EXCHANGE,
        id: crypto.randomUUID(),
        senderId: this.keyManager.getFingerprint(),
        timestamp: Date.now(),
        dhPublicKey: myDhPubJwk,
        signingPublicKey: mySignPubJwk,
      };

      dataChannel.send(JSON.stringify(keyExchangeMsg));
      console.log("[LifeLine] Key exchange sent");
    } catch (error) {
      console.error("[LifeLine] Failed to send key exchange:", error);
    }
  }

  async _completeKeyExchange(tempId, dataChannel, msg) {
    const pending = this._pendingConnections.get(tempId);
    if (!pending) return;
    if (pending.established) return;
    pending.established = true;

    const peerDeviceId = msg.senderId;
    console.log("[LifeLine] Completing key exchange with peer:", peerDeviceId);

    try {
      await this.keyManager.importPeerDhKeyFromJwk(peerDeviceId, msg.dhPublicKey);
      await this.keyManager.importPeerSigningKeyFromJwk(peerDeviceId, msg.signingPublicKey);

      const peerDhKey = this.keyManager.getPeerDhPublicKey(peerDeviceId);
      const sharedKey = await deriveSharedKey(this.keyManager.dhKeyPair.privateKey, peerDhKey);
      this._peerKeyMap.set(peerDeviceId, sharedKey);
      this._peerSigningKeyMap.set(peerDeviceId, this.keyManager.getPeerSigningPublicKey(peerDeviceId));

      this._peerDeviceIds.set(tempId, peerDeviceId);
      this._connectionToPeerId.set(tempId, peerDeviceId);

      if (!this.peerManager.hasPeer(peerDeviceId)) {
        this.peerManager.addPeer(peerDeviceId, pending.pc, dataChannel);
      }

      this.pairingView.onPeerIdentified(peerDeviceId);

      if (this._groupKey && !this._keyExchangeSent.has(peerDeviceId)) {
        this._keyExchangeSent.add(peerDeviceId);
        await this._sendGroupKey(peerDeviceId);
      }

      if (!this._keyExchangeSent.has(peerDeviceId)) {
        this._keyExchangeSent.add(peerDeviceId);
      }

      this._pendingConnections.delete(tempId);
      console.log("[LifeLine] Secure connection established with:", peerDeviceId);
    } catch (error) {
      console.error("[LifeLine] Key exchange failed:", error);
      this.pairingView._renderState("failed");
      this.pairingView._updateProgress("Key exchange failed", error.message);
      this._cleanupPending(tempId);
    }
  }

  async _handleKeyExchange(peerId, msg) {
    const senderId = msg.senderId;
    if (!senderId) return;

    if (this._peerKeyMap.has(senderId)) return;

    try {
      await this.keyManager.importPeerDhKeyFromJwk(senderId, msg.dhPublicKey);
      await this.keyManager.importPeerSigningKeyFromJwk(senderId, msg.signingPublicKey);

      const peerDhKey = this.keyManager.getPeerDhPublicKey(senderId);
      const sharedKey = await deriveSharedKey(this.keyManager.dhKeyPair.privateKey, peerDhKey);
      this._peerKeyMap.set(senderId, sharedKey);
      this._peerSigningKeyMap.set(senderId, this.keyManager.getPeerSigningPublicKey(senderId));

      const actualPeerId = this._connectionToPeerId.get(peerId);
      if (actualPeerId && actualPeerId !== senderId) {
        this.peerManager.updatePeerId(actualPeerId, senderId);
        this._connectionToPeerId.set(peerId, senderId);
      }

      if (this._groupKey && !this._keyExchangeSent.has(senderId)) {
        this._keyExchangeSent.add(senderId);
        await this._sendGroupKey(senderId);
      }

      if (!this._keyExchangeSent.has(senderId)) {
        this._keyExchangeSent.add(senderId);
      }

      console.log("[LifeLine] Key exchange processed for:", senderId);
    } catch (error) {
      console.error("[LifeLine] Key exchange processing failed:", error);
    }
  }

  async _sendGroupKey(targetPeerId) {
    try {
      const sharedKey = this._peerKeyMap.get(targetPeerId);
      if (!sharedKey) {
        console.warn("[LifeLine] No shared key for", targetPeerId);
        return;
      }

      const groupKeyRaw = await this.keyManager.exportGroupKey();
      if (!groupKeyRaw) return;

      const groupKeyArray = Array.from(new Uint8Array(groupKeyRaw));
      const encrypted = await encryptPayload(sharedKey, {
        key: groupKeyArray,
        timestamp: Date.now(),
      });

      const announceMsg = {
        type: MESSAGE_TYPE.GROUP_KEY_ANNOUNCE,
        id: crypto.randomUUID(),
        senderId: this.keyManager.getFingerprint(),
        timestamp: Date.now(),
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
      };

      this.peerManager.send(targetPeerId, announceMsg);
      console.log("[LifeLine] Group key sent to:", targetPeerId);
    } catch (error) {
      console.error("[LifeLine] Failed to send group key:", error);
    }
  }

  async _handleGroupKeyAnnounce(peerId, msg) {
    if (this._groupKey && this._initialized) return;

    try {
      const senderRealId = this._connectionToPeerId.get(peerId) || peerId;
      const sharedKey = this._peerKeyMap.get(senderRealId);
      if (!sharedKey) {
        console.warn("[LifeLine] No shared key for group key decrypt, peer:", senderRealId);
        return;
      }

      const decrypted = await decryptPayload(sharedKey, msg.ciphertext, msg.iv);
      if (decrypted && decrypted.key) {
        const keyBytes = new Uint8Array(decrypted.key);
        await this.keyManager.importGroupKey(keyBytes);
        this._groupKey = this.keyManager.groupKey;

        if (this.db) {
          await this.keyManager.saveToDb(this.db);
        }
        console.log("[LifeLine] Group key received and imported");
      }
    } catch (error) {
      console.warn("[LifeLine] Failed to process group key announcement:", error.message);
    }
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

    if (!message.decryptedText) {
      this._handleAutoDecrypt(message);
    }
  }

  async _verifyMessageSignature(message) {
    if (!message.signature) return null;
    const signingKey = this._peerSigningKeyMap.get(message.senderId);
    if (!signingKey) return null;
    const dataToVerify = message.id + message.senderId + message.ciphertext;
    try {
      return await verifySignature(signingKey, message.signature, dataToVerify);
    } catch {
      return false;
    }
  }

  async _handleAutoDecrypt(message) {
    try {
      if (message.plaintext && (!message.ciphertext || message.ciphertext === "")) {
        message.decryptedText = message.plaintext;
        return;
      }

      const sigValid = await this._verifyMessageSignature(message);
      if (sigValid === false) {
        message.decryptedText = "[⚠️ Tampered — signature invalid]";
        return;
      }

      if (isBroadcast(message) && this._groupKey) {
        const decrypted = await decryptPayload(this._groupKey, message.ciphertext, message.iv);
        message.decryptedText = typeof decrypted === "string" ? decrypted : JSON.stringify(decrypted);
      } else if (!isBroadcast(message) && this._peerKeyMap.has(message.senderId)) {
        const sharedKey = this._peerKeyMap.get(message.senderId);
        const decrypted = await decryptPayload(sharedKey, message.ciphertext, message.iv);
        message.decryptedText = typeof decrypted === "string" ? decrypted : JSON.stringify(decrypted);
      } else if (message.ciphertext && message.ciphertext !== "") {
        message.decryptedText = sigValid === null
          ? "[🔒 Encrypted — sender unknown]"
          : "[🔒 Encrypted]";
      } else {
        message.decryptedText = message.plaintext || "[No content]";
      }
    } catch {
      message.decryptedText = message.ciphertext && message.ciphertext !== ""
        ? "[⚠️ Could not decrypt]"
        : (message.plaintext || "[No content]");
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
        msg.plaintext = "";
        msg.signature = await signMessage(
          this.keyManager.signingKeyPair.privateKey,
          msg.id + msg.senderId + msg.ciphertext
        );
      } else if (!isBroadcast(msg)) {
        for (const [peerId, sharedKey] of this._peerKeyMap) {
          const encrypted = await encryptPayload(sharedKey, text);
          msg.ciphertext = encrypted.ciphertext;
          msg.iv = encrypted.iv;
          msg.plaintext = "";
          msg.signature = await signMessage(
            this.keyManager.signingKeyPair.privateKey,
            msg.id + msg.senderId + msg.ciphertext
          );
          break;
        }
      }

      msg.decryptedText = text;

      this.gossipRouter.sendLocal(msg);

      return msg;
    } catch (error) {
      console.error("[LifeLine] Send message failed:", error);
      return null;
    }
  }

  async sendSOS(text) {
    return this.sendMessage(text, PRIORITY.SOS);
  }

  _initUI() {
    this.meshStatusUI = new MeshStatusUI(this.peerManager, this.messageLog, this.gossipRouter);
    this.meshStatusUI.mount();

    this.chatView = new ChatView(
      this.messageLog,
      this.peerManager,
      (text, priority) => {
        if (priority === PRIORITY.SOS) {
          this._showSOSConfirmDialog(text);
        } else {
          this.sendMessage(text, priority);
        }
      },
      this.keyManager.getFingerprint()
    );
    this.chatView.mount();

    this.pairingView = new PairingView(this.peerManager, this.keyManager);
    this.pairingView.mount();
  }

  _showSOSConfirmDialog(text) {
    const modal = document.getElementById("sos-confirm-modal");
    if (!modal) return;

    modal.classList.remove("hidden");

    const confirmBtn = document.getElementById("btn-sos-confirm");
    const cancelBtn = document.getElementById("btn-sos-cancel");

    const cleanup = () => {
      modal.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
    };

    const onConfirm = () => {
      cleanup();
      this.sendMessage(text, PRIORITY.SOS).then(() => {
        this._showSOSBroadcastBanner();
      });
    };

    const onCancel = () => {
      cleanup();
    };

    confirmBtn.addEventListener("click", onConfirm, { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
  }

  _showSOSBroadcastBanner() {
    const banner = document.getElementById("connectivity-banner");
    const text = document.getElementById("banner-text");
    if (banner && text) {
      banner.className = "offline";
      text.textContent = "🚨 SOS message broadcasting to mesh...";
      setTimeout(() => this._updateBanner(), 3000);
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

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.classList.add("hidden");
      }
    });
  }

  _cleanupPending(tempId) {
    const pending = this._pendingConnections.get(tempId);
    if (pending) {
      try {
        if (pending.pc && pending.pc.signalingState !== "closed") {
          pending.pc.close();
        }
      } catch {}
      this._pendingConnections.delete(tempId);
    }
  }

  _checkConnectionURL() {
    const payload = extractConnectionFromURL();
    if (!payload) return;
    clearConnectionFromURL();
    console.log("[LifeLine] Connection URL detected, initiating pairing...");
    this._switchToView("pair");
    setTimeout(() => {
      this.pairingView.handleIncomingConnection(payload);
    }, 100);
  }

  _switchToView(viewName) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`)?.classList.add("active");
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelector(`.nav-btn[data-view="${viewName}"]`)?.classList.add("active");
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
