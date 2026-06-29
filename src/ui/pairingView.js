import { createOffer, answerOffer, completeHandshake, SignalingError } from "../signaling/qrSignaling.js";
import { renderQRCode, startCamera, stopCamera, scanQRCode } from "../signaling/qrCodec.js";
import { generateTempId } from "../transport/peerManager.js";

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
    document.getElementById("btn-cancel-pairing")?.addEventListener("click", () => this._goToMesh());
    document.getElementById("btn-qr-done")?.addEventListener("click", () => this._goToMesh());
    document.getElementById("btn-cancel-scan")?.addEventListener("click", () => this._cancelScan());
    document.getElementById("btn-pairing-done")?.addEventListener("click", () => this._goToMesh());
    document.getElementById("btn-pair-device")?.addEventListener("click", () => this._goToPairing());
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

      this._renderState(PAIRING_STATE.SHOWING_QR);
      const container = document.getElementById("qr-container");
      if (!container) return;

      const qrLabel = this._isInitiator
        ? "Ask the other device to scan this QR, then tap 'Scan Their Response'"
        : "Show this QR to the other device";

      await renderQRCode(container, result.qrPayload, qrLabel);

      const scanResponseBtn = document.getElementById("btn-scan-response");
      if (scanResponseBtn) {
        scanResponseBtn.classList.remove("hidden");
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

      const scanStatus = document.getElementById("scan-status");
      if (scanStatus) scanStatus.textContent = statusText;

      await startCamera(video);

      this._scanInterval = setInterval(async () => {
        try {
          const scanned = await scanQRCode(video);
          if (!scanned) return;

          if (this._scanMode === SCAN_MODE.OFFER) {
            this._handleScannedOffer(scanned);
          } else if (this._scanMode === SCAN_MODE.ANSWER) {
            this._handleScannedAnswer(scanned);
          }
        } catch {
        }
      }, 500);
    } catch (error) {
      console.error("[PairingView] Camera start failed:", error);
      this._renderState(PAIRING_STATE.FAILED);
      this._updateProgress("Camera unavailable", error.message || "Could not access camera");
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

      this._renderState(PAIRING_STATE.SHOWING_QR);
      const container = document.getElementById("qr-container");
      if (!container) return;

      await renderQRCode(container, result.qrPayload, "Show this QR back to the other device to complete pairing");

      const scanResponseBtn = document.getElementById("btn-scan-response");
      if (scanResponseBtn) {
        scanResponseBtn.classList.add("hidden");
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
}
