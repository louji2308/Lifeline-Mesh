import { createOffer, answerOffer, completeHandshake, SignalingError } from "../signaling/qrSignaling.js";
import { renderQRCode, startCamera, stopCamera, scanQRCode } from "../signaling/qrCodec.js";
import { generateTempId } from "../transport/peerManager.js";
import {
  getLocalIPs, shareConnection, showCopyableLink, createConnectionURL,
  copyToClipboard, renderLANInfo,
} from "../signaling/lanDiscovery.js";

export const PAIRING_STATE = Object.freeze({
  IDLE: "idle",
  SHOWING_QR: "showing-qr",
  SCANNING: "scanning",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
});

const SCAN_MODE = Object.freeze({
  OFFER: "offer",
  ANSWER: "answer",
});

export class PairingView extends EventTarget {
  constructor(peerManager, keyManager) {
    super();
    this.peerManager = peerManager;
    this.keyManager = keyManager;
    this._state = PAIRING_STATE.IDLE;
    this._currentPc = null;
    this._currentDataChannel = null;
    this._pendingPeerId = null;
    this._scanInterval = null;
    this._isInitiator = false;
    this._scanMode = null;
    this._currentQrPayload = null;
    this._scanActive = false;
    this._scanTimer = null;
  }

  mount() {
    this._setupEventListeners();
    this._renderState(PAIRING_STATE.IDLE);
  }

  unmount() {
    this._removeEventListeners();
    this._cleanup();
  }

  _setupEventListeners() {
    document.getElementById("btn-show-qr")?.addEventListener("click", () => this._startOfferFlow());
    document.getElementById("btn-scan-qr")?.addEventListener("click", () => this._startScanFlow());
    document.getElementById("btn-scan-response")?.addEventListener("click", () => this._startAnswerScan());
    document.getElementById("btn-paste-answer")?.addEventListener("click", () => this._showLANInput(true));
    document.getElementById("btn-cancel-pairing")?.addEventListener("click", () => this._goToMesh());
    document.getElementById("btn-qr-done")?.addEventListener("click", () => this._goToMesh());
    document.getElementById("btn-cancel-scan")?.addEventListener("click", () => this._cancelScan());
    document.getElementById("btn-pairing-done")?.addEventListener("click", () => this._goToMesh());
    document.getElementById("btn-pair-device")?.addEventListener("click", () => this._goToPairing());
    document.getElementById("btn-lan-connect")?.addEventListener("click", () => this._showLANInput());
    document.getElementById("btn-lan-connect-cancel")?.addEventListener("click", () => this._hideLANInput());
    document.getElementById("btn-lan-connect-submit")?.addEventListener("click", () => this._handleLANConnect());
    document.getElementById("btn-share-nearby")?.addEventListener("click", () => this._handleShareNearby());
    document.getElementById("btn-copy-link")?.addEventListener("click", () => this._handleCopyLink());
  }

  _removeEventListeners() {
  }

  async _startOfferFlow() {
    try {
      this._isInitiator = true;
      this._renderState(PAIRING_STATE.CONNECTING);
      this._updateProgress("Generating pairing code...", "Creating secure P2P offer");

      const deviceId = this.keyManager.getFingerprint();
      const result = await createOffer(deviceId);
      this._currentPc = result.pc;
      this._currentDataChannel = result.dataChannel;
      this._currentQrPayload = result.qrPayload;

      this._renderState(PAIRING_STATE.SHOWING_QR);
      const container = document.getElementById("qr-container");
      if (!container) return;

      const qrLabel = this._isInitiator
        ? "Ask the other device to scan this QR, then tap 'Scan Their Response'"
        : "Show this QR back to the other device";

      await renderQRCode(container, result.qrPayload, qrLabel);

      this._showLANInfo(result.qrPayload);

      const copyBtn = document.getElementById("btn-copy-link");
      if (copyBtn) copyBtn.classList.remove("hidden");

      const shareBtn = document.getElementById("btn-share-nearby");
      if (shareBtn) shareBtn.classList.remove("hidden");

      const scanResponseBtn = document.getElementById("btn-scan-response");
      if (scanResponseBtn) {
        if (this._isInitiator) {
          scanResponseBtn.classList.remove("hidden");
        } else {
          scanResponseBtn.classList.add("hidden");
        }
      }
      const pasteAnswerBtn = document.getElementById("btn-paste-answer");
      if (pasteAnswerBtn) {
        if (this._isInitiator) {
          pasteAnswerBtn.classList.remove("hidden");
        } else {
          pasteAnswerBtn.classList.add("hidden");
        }
      }

      this._pendingPeerId = null;

      this._currentPc.onconnectionstatechange = () => {
        if (this._currentPc.connectionState === "connected") {
          this._onPeerConnected(this._currentPc, this._currentDataChannel);
        }
      };
    } catch (error) {
      console.error("[PairingView] Offer flow failed:", error);
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Pairing failed", error.message || "Could not create connection offer");
      this._cleanup();
    }
  }

  async _startAnswerScan() {
    if (!this._currentPc) {
      console.error("[PairingView] No pending PC for answer scan");
      return;
    }
    this._scanMode = SCAN_MODE.ANSWER;
    this._startCameraScan("Point camera at the other device's QR code to complete pairing");
  }

  async _startScanFlow() {
    this._isInitiator = false;
    this._scanMode = SCAN_MODE.OFFER;
    this._startCameraScan("Point camera at the other device's QR code");
  }

  async _startCameraScan(statusText) {
    try {
      this._renderState(PAIRING_STATE.SCANNING);
      const video = document.getElementById("scanner-video");
      if (!video) return;

      const scanOverlay = document.getElementById("scan-overlay");
      if (scanOverlay) scanOverlay.classList.add("scanning-active");

      const scanStatus = document.getElementById("scan-status");
      if (scanStatus) scanStatus.textContent = statusText;

      await startCamera(video);

      const barcodeSupport = "BarcodeDetector" in globalThis;
      if (!barcodeSupport) {
        if (scanOverlay) scanOverlay.classList.remove("scanning-active");
        if (scanStatus) {
          scanStatus.innerHTML = 'QR scanning not supported on this browser.<br><b>Copy the Connection Link</b> from the other device and paste it below instead.';
        }
        const lanInput = document.getElementById("lan-connect-input");
        if (lanInput) lanInput.classList.remove("hidden");
        return;
      }

      this._scanActive = true;
      this._scanLoop(video);
    } catch (error) {
      console.error("[PairingView] Camera start failed:", error);
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Camera unavailable", error.message || "Could not access camera");
    }
  }

  async _scanLoop(video) {
    if (!this._scanActive) return;

    try {
      const scanOverlay = document.getElementById("scan-overlay");
      const scanStatus = document.getElementById("scan-status");
      const scanned = await scanQRCode(video);
      if (scanned) {
        if (scanOverlay) {
          scanOverlay.classList.remove("scanning-active");
          scanOverlay.classList.add("scanning-detected");
        }
        this._stopScanning();
        if (this._scanMode === SCAN_MODE.OFFER) {
          this._handleScannedOffer(scanned);
        } else if (this._scanMode === SCAN_MODE.ANSWER) {
          this._handleScannedAnswer(scanned);
        }
        return;
      }

      if (scanStatus) {
        const dots = ".".repeat(((Date.now() / 500) | 0) % 4);
        scanStatus.textContent = `Scanning${dots} — point camera at the QR code`;
      }
    } catch {
    }

    if (this._scanActive) {
      this._scanTimer = setTimeout(() => this._scanLoop(video), 300);
    }
  }

  async _handleScannedOffer(scannedPayload) {
    this._stopScanning();
    this._renderState(PAIRING_STATE.CONNECTING);
    this._updateProgress("Processing pairing code...", "Creating secure P2P connection");

    try {
      const deviceId = this.keyManager.getFingerprint();
      const result = await answerOffer(scannedPayload, deviceId);
      this._currentPc = result.pc;
      this._currentDataChannel = result.dataChannel;
      this._currentQrPayload = result.qrPayload;

      this._renderState(PAIRING_STATE.SHOWING_QR);
      const container = document.getElementById("qr-container");
      if (!container) return;

      await renderQRCode(container, result.qrPayload, "Show this QR back to the other device to complete pairing");

      this._showLANInfo(result.qrPayload);

      const copyBtn = document.getElementById("btn-copy-link");
      if (copyBtn) copyBtn.classList.remove("hidden");

      const shareBtn = document.getElementById("btn-share-nearby");
      if (shareBtn) shareBtn.classList.remove("hidden");

      const scanResponseBtn = document.getElementById("btn-scan-response");
      if (scanResponseBtn) {
        scanResponseBtn.classList.add("hidden");
      }
      const pasteAnswerBtn2 = document.getElementById("btn-paste-answer");
      if (pasteAnswerBtn2) {
        pasteAnswerBtn2.classList.add("hidden");
      }

      this._currentPc.onconnectionstatechange = () => {
        if (this._currentPc.connectionState === "connected") {
          this._onPeerConnected(this._currentPc, this._currentDataChannel);
        }
      };
    } catch (error) {
      console.error("[PairingView] Answer flow failed:", error);
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Pairing failed", error.message || "Could not complete handshake");
      this._cleanup();
    }
  }

  async _handleScannedAnswer(scannedPayload) {
    this._stopScanning();
    this._renderState(PAIRING_STATE.CONNECTING);
    this._updateProgress("Completing handshake...", "Establishing secure P2P connection");

    try {
      await completeHandshake(this._currentPc, scannedPayload);
      this._updateProgress("Handshake complete", "Waiting for connection...");
    } catch (error) {
      console.error("[PairingView] Handshake failed:", error);
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Handshake failed", error.message || "Could not complete connection");
      this._cleanup();
    }
  }

  _onPeerConnected(pc, dataChannel) {
    const tempId = generateTempId();
    this._pendingPeerId = tempId;

    this.dispatchEvent(new CustomEvent("connection-ready", {
      detail: {
        pc,
        dataChannel,
        tempId,
        isInitiator: this._isInitiator,
      },
    }));

    this._renderState(PAIRING_STATE.CONNECTED);
    const displayId = document.getElementById("success-peer-id");
    if (displayId) displayId.textContent = "Exchanging keys...";
  }

  onPeerIdentified(deviceId) {
    const displayId = document.getElementById("success-peer-id");
    if (displayId) displayId.textContent = `Peer: ${deviceId}`;
    this._pendingPeerId = deviceId;
  }

  _stopScanning() {
    this._scanActive = false;
    if (this._scanTimer) {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
    const video = document.getElementById("scanner-video");
    if (video) stopCamera(video);
  }

  _cancelScan() {
    this._stopScanning();
    this._cleanup();
    this._renderState(PAIRING_STATE.IDLE);
  }

  _cleanup() {
    this._stopScanning();
    this._hideLANInput();
    const pasteBtn = document.getElementById("btn-paste-answer");
    if (pasteBtn) pasteBtn.classList.add("hidden");
    if (this._currentPc) {
      try {
        if (this._currentPc.signalingState !== "closed") {
          this._currentPc.close();
        }
      } catch {}
      this._currentPc = null;
    }
    this._currentDataChannel = null;
    this._pendingPeerId = null;
    this._scanMode = null;
    this._scanActive = false;
    this._scanTimer = null;
  }

  _renderState(state) {
    this._state = state;

    const show = (id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("hidden");
    };
    const hide = (id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    };

    hide("pairing-actions");
    hide("qr-output");
    hide("scanner-output");
    hide("pairing-progress");
    hide("pairing-success");

    switch (state) {
      case PAIRING_STATE.IDLE:
        show("pairing-actions");
        this._updateStateDisplay("📡", "Ready to Pair", "Choose to show your QR code or scan another device's QR.");
        break;
      case PAIRING_STATE.SHOWING_QR:
        show("qr-output");
        if (this._isInitiator) {
          this._updateStateDisplay("📤", "Show Your QR Code", "Let the other device scan this, then scan their response.");
        } else {
          this._updateStateDisplay("📤", "Show Your QR Code", "Show this QR back to the other device to complete pairing.");
        }
        break;
      case PAIRING_STATE.SCANNING:
        show("scanner-output");
        this._updateStateDisplay("📥", "Scanning QR Code", "Point camera at the other device's QR code.");
        break;
      case PAIRING_STATE.CONNECTING:
        show("pairing-progress");
        break;
      case PAIRING_STATE.CONNECTED:
        show("pairing-success");
        break;
      case PAIRING_STATE.FAILED:
        show("pairing-actions");
        show("pairing-progress");
        break;
    }
  }

  _updateStateDisplay(icon, label, desc) {
    const iconEl = document.querySelector("#pairing-state .state-icon");
    const labelEl = document.querySelector("#pairing-state .state-label");
    const descEl = document.querySelector("#pairing-state .state-desc");
    if (iconEl) iconEl.textContent = icon;
    if (labelEl) labelEl.textContent = label;
    if (descEl) descEl.textContent = desc;
  }

  _updateProgress(label, detail) {
    const labelEl = document.getElementById("progress-text");
    const detailEl = document.getElementById("progress-detail");
    if (labelEl) labelEl.textContent = label;
    if (detailEl) detailEl.textContent = detail;
  }

  _goToMesh() {
    this._cleanup();
    this._renderState(PAIRING_STATE.IDLE);
    this._switchView("mesh");
  }

  _goToPairing() {
    this._switchView("pair");
  }

  _switchView(viewName) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`)?.classList.add("active");
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelector(`.nav-btn[data-view="${viewName}"]`)?.classList.add("active");
  }

  async _showLANInfo(qrPayload) {
    const container = document.getElementById("lan-info-container");
    const card = document.getElementById("lan-info-card");
    if (!container || !card) return;
    container.classList.remove("hidden");
    card.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;">Detecting network...</div>';
    const ips = await getLocalIPs();
    renderLANInfo(card, ips);
  }

  _showLANInput(fromAnswer) {
    document.getElementById("pairing-actions")?.classList.add("hidden");
    document.getElementById("qr-output")?.classList.add("hidden");
    document.getElementById("lan-connect-input")?.classList.remove("hidden");
    if (fromAnswer) {
      const label = document.querySelector("#lan-connect-input .section-title");
      if (label) label.textContent = "Paste Answer Link";
      const desc = document.querySelector("#lan-connect-input p");
      if (desc) desc.textContent = "Paste the answer link you received from the other device to complete the connection.";
    }
  }

  _hideLANInput() {
    document.getElementById("lan-connect-input")?.classList.add("hidden");
    if (this._state === PAIRING_STATE.SHOWING_QR) {
      document.getElementById("qr-output")?.classList.remove("hidden");
    } else {
      document.getElementById("pairing-actions")?.classList.remove("hidden");
    }
    document.getElementById("lan-connect-text").value = "";
    const label = document.querySelector("#lan-connect-input .section-title");
    if (label) label.textContent = "Enter Connection Code";
    const desc = document.querySelector("#lan-connect-input p");
    if (desc) desc.textContent = "Paste the pairing code or connection link you received from the other device.";
  }

  async _handleLANConnect() {
    const input = document.getElementById("lan-connect-text");
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) {
      this._updateProgress("Empty input", "Paste the connection link from the other device first");
      return;
    }
    let payload = raw;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      try {
        const url = new URL(raw);
        const extracted = url.searchParams.get("connect") || decodeURIComponent(url.hash.slice(9) || "");
        if (extracted) payload = extracted;
      } catch {
        this._updateProgress("Invalid link", "The pasted link is not a valid connection URL");
        return;
      }
    }
    this._hideLANInput();
    try {
      const deviceId = this.keyManager.getFingerprint();
      if (this._currentPc && ["have-local-offer", "stable"].includes(this._currentPc.signalingState)) {
        this._renderState(PAIRING_STATE.CONNECTING);
        this._updateProgress("Completing handshake...", "Establishing secure P2P connection");
        await completeHandshake(this._currentPc, payload);
        this._updateProgress("Handshake complete", "Waiting for connection...");
      } else {
        const result = await answerOffer(payload, deviceId);
        this._currentPc = result.pc;
        this._currentDataChannel = result.dataChannel;
        this._currentQrPayload = result.qrPayload;
        this._currentPc.onconnectionstatechange = () => {
          if (this._currentPc.connectionState === "connected") {
            this._onPeerConnected(this._currentPc, this._currentDataChannel);
          }
        };
        this._renderState(PAIRING_STATE.SHOWING_QR);
        const container = document.getElementById("qr-container");
        if (container) {
          await renderQRCode(container, result.qrPayload, "Show this QR to the other device to complete pairing");
        }
        this._showLANInfo(result.qrPayload);
        const answerUrl = createConnectionURL(result.qrPayload);
        const ok = await copyToClipboard(answerUrl);
        const linkContainer = document.getElementById("lan-info-card");
        if (linkContainer) {
          showCopyableLink(linkContainer, answerUrl);
        }
        const pasteBtn = document.getElementById("btn-paste-answer");
        if (pasteBtn) pasteBtn.classList.add("hidden");
        const scanBtn = document.getElementById("btn-scan-response");
        if (scanBtn) scanBtn.classList.add("hidden");
        const copyBtn = document.getElementById("btn-copy-link");
        if (copyBtn) copyBtn.classList.remove("hidden");
        const shareBtn = document.getElementById("btn-share-nearby");
        if (shareBtn) shareBtn.classList.remove("hidden");
      }
    } catch (error) {
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Connection failed", error.message || "Could not connect using the provided link");
    }
  }

  async _handleShareNearby() {
    if (!this._currentQrPayload) return;
    const result = await shareConnection(this._currentQrPayload);
    if (result === "shared") {
      this._updateProgress("Link shared", "Connection link sent to nearby device");
    } else if (result === "clipboard") {
      this._updateProgress("Link copied", "Connection link copied — share it with the other device");
    }
  }

  async _handleCopyLink() {
    if (!this._currentQrPayload) return;
    const url = createConnectionURL(this._currentQrPayload);
    const ok = await copyToClipboard(url);
    const linkContainer = document.getElementById("lan-info-card");
    if (linkContainer) {
      showCopyableLink(linkContainer, url);
    }
    if (ok) {
      this._updateProgress("Copied!", "Connection link copied to clipboard");
    }
  }

  async handleIncomingConnection(sdpPayload) {
    if (this._state !== PAIRING_STATE.IDLE) {
      console.warn("[PairingView] Busy, ignoring incoming connection");
      return;
    }
    this._isInitiator = false;
    this._renderState(PAIRING_STATE.CONNECTING);
    this._updateProgress("Processing connection link...", "Establishing secure P2P connection");
    try {
      const deviceId = this.keyManager.getFingerprint();
      const result = await answerOffer(sdpPayload, deviceId);
      this._currentPc = result.pc;
      this._currentDataChannel = result.dataChannel;
      this._currentQrPayload = result.qrPayload;

      this._renderState(PAIRING_STATE.SHOWING_QR);
      const container = document.getElementById("qr-container");
      if (!container) return;

      await renderQRCode(container, result.qrPayload, "Show this QR back to the other device to complete pairing");

      this._showLANInfo(result.qrPayload);

      const copyBtn = document.getElementById("btn-copy-link");
      if (copyBtn) copyBtn.classList.remove("hidden");

      const shareBtn = document.getElementById("btn-share-nearby");
      if (shareBtn) shareBtn.classList.remove("hidden");

      const scanResponseBtn = document.getElementById("btn-scan-response");
      if (scanResponseBtn) scanResponseBtn.classList.add("hidden");
      const pasteAnswerBtn3 = document.getElementById("btn-paste-answer");
      if (pasteAnswerBtn3) pasteAnswerBtn3.classList.add("hidden");

      this._currentPc.onconnectionstatechange = () => {
        if (this._currentPc.connectionState === "connected") {
          this._onPeerConnected(this._currentPc, this._currentDataChannel);
        }
      };
    } catch (error) {
      console.error("[PairingView] Incoming connection failed:", error);
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Connection failed", error.message || "Could not process connection link");
      this._cleanup();
    }
  }
}
