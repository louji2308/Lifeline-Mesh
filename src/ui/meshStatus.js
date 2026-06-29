import { CONNECTION_STATE } from "../transport/peerManager.js";

export class MeshStatusUI {
  constructor(peerManager, messageLog, gossipRouter) {
    this.peerManager = peerManager;
    this.messageLog = messageLog;
    this.gossipRouter = gossipRouter;
    this._startTime = Date.now();
    this._uptimeInterval = null;
    this._boundUpdate = this._update.bind(this);
    this._boundHandlePeerChange = this._handlePeerChange.bind(this);
  }

  mount() {
    this._startUptimeCounter();

    this.peerManager.addEventListener("peer-connected", this._boundHandlePeerChange);
    this.peerManager.addEventListener("peer-disconnected", this._boundHandlePeerChange);
    this.peerManager.addEventListener("peer-removed", this._boundHandlePeerChange);

    this._update();
  }

  unmount() {
    if (this._uptimeInterval) {
      clearInterval(this._uptimeInterval);
      this._uptimeInterval = null;
    }
    this.peerManager.removeEventListener("peer-connected", this._boundHandlePeerChange);
    this.peerManager.removeEventListener("peer-disconnected", this._boundHandlePeerChange);
    this.peerManager.removeEventListener("peer-removed", this._boundHandlePeerChange);
  }

  _handlePeerChange() {
    this._update();
  }

  _update() {
    this._updateStats();
    this._updatePeerList();
  }

  _updateStats() {
    const directPeers = this.peerManager.getConnectedCount();
    const totalMessages = this.messageLog.getCount();
    const seenCount = this.gossipRouter ? this.gossipRouter.getSeenCount() : 0;
    const uptime = Math.floor((Date.now() - this._startTime) / 1000);

    const el = (id) => document.getElementById(id);
    el("stat-direct-peers").textContent = directPeers;
    el("stat-messages").textContent = totalMessages;
    el("stat-relayed").textContent = seenCount;
    el("stat-uptime").textContent = uptime < 60 ? `${uptime}s` : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
  }

  _updatePeerList() {
    const container = document.getElementById("peer-list");
    if (!container) return;

    const peerIds = this.peerManager.getAllPeerIds();
    if (peerIds.length === 0) {
      container.innerHTML = `<li class="peer-item" style="justify-content:center;color:var(--text-muted);padding:20px 0;">
        No peers connected. Pair a device to start.
      </li>`;
      return;
    }

    container.innerHTML = peerIds.map((peerId) => {
      const state = this.peerManager.getPeerState(peerId);
      const statusClass = state === CONNECTION_STATE.CONNECTED ? "connected"
        : state === CONNECTION_STATE.CONNECTING ? "connecting"
        : state === CONNECTION_STATE.FAILED ? "failed"
        : "disconnected";
      const label = state === CONNECTION_STATE.CONNECTED ? "Connected"
        : state === CONNECTION_STATE.CONNECTING ? "Connecting..."
        : state === CONNECTION_STATE.FAILED ? "Failed"
        : "Disconnected";
      return `<li class="peer-item">
        <span class="peer-id">${this._formatPeerId(peerId)}</span>
        <span class="flex items-center gap-8">
          <span style="font-size:12px;color:var(--text-muted)">${label}</span>
          <span class="peer-status ${statusClass}"></span>
        </span>
      </li>`;
    }).join("");
  }

  _formatPeerId(peerId) {
    if (!peerId) return "???";
    return peerId.length > 12 ? peerId.slice(0, 12) + "…" : peerId;
  }

  _startUptimeCounter() {
    this._uptimeInterval = setInterval(() => {
      this._updateStats();
    }, 1000);
  }
}
