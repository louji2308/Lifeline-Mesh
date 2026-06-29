import { configureDataChannel, sendJson, parseMessage } from "./dataChannel.js";
import { MESSAGE_FLAGS } from "../schema.js";

export const CONNECTION_STATE = Object.freeze({
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
  CLOSED: "closed",
});

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_BACKGROUND_MS = 30000;
const DISCONNECT_GRACE_PERIOD_MS = 30000;
const STALE_PEER_CLEANUP_INTERVAL_MS = 120000;

export class PeerManager extends EventTarget {
  constructor() {
    super();
    this.peers = new Map();
    this.heartbeatIntervals = new Map();
    this.disconnectTimers = new Map();
    this._cleanupInterval = null;
    this._batteryLevel = null;
    this._isBackgrounded = false;
    this._startCleanupInterval();
    this._monitorVisibility();
  }

  addPeer(peerId, pc, dataChannel) {
    if (this.peers.has(peerId)) {
      this.removePeer(peerId);
    }

    configureDataChannel(dataChannel);

    const record = {
      pc,
      dataChannel,
      state: CONNECTION_STATE.CONNECTING,
      connectedAt: null,
      lastHeartbeatAt: Date.now(),
      missedHeartbeats: 0,
      bytesSent: 0,
      bytesReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
    };
    this.peers.set(peerId, record);

    dataChannel.onopen = () => {
      record.state = CONNECTION_STATE.CONNECTED;
      record.connectedAt = Date.now();
      this._clearDisconnectTimer(peerId);
      this.dispatchEvent(new CustomEvent("peer-connected", {
        detail: { peerId, timestamp: Date.now() },
      }));
      this._startHeartbeat(peerId);
    };

    dataChannel.onclose = () => {
      this._handleDisconnect(peerId, CONNECTION_STATE.CLOSED);
    };

    dataChannel.onerror = (event) => {
      this.dispatchEvent(new CustomEvent("peer-error", {
        detail: { peerId, error: event.error || "Unknown data channel error" },
      }));
      this._handleDisconnect(peerId, CONNECTION_STATE.FAILED);
    };

    dataChannel.onmessage = (event) => {
      record.messagesReceived++;
      record.bytesReceived += typeof event.data === "string"
        ? event.data.length * 2
        : event.data.byteLength;

      const parsed = parseMessage(event);
      if (parsed.plaintext === MESSAGE_FLAGS.HEARTBEAT || parsed.type === "heartbeat") {
        record.lastHeartbeatAt = Date.now();
        record.missedHeartbeats = 0;
        return;
      }

      this.dispatchEvent(new CustomEvent("message-received", {
        detail: { peerId, raw: parsed, timestamp: Date.now() },
      }));
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === "failed") {
        this._handleDisconnect(peerId, CONNECTION_STATE.FAILED);
      } else if (state === "disconnected") {
        this._handleDisconnect(peerId, CONNECTION_STATE.DISCONNECTED);
      } else if (state === "connected") {
        if (record.state !== CONNECTION_STATE.CONNECTED) {
          record.state = CONNECTION_STATE.CONNECTED;
          record.connectedAt = Date.now();
          this._clearDisconnectTimer(peerId);
          this.dispatchEvent(new CustomEvent("peer-connected", {
            detail: { peerId, timestamp: Date.now() },
          }));
          this._startHeartbeat(peerId);
        }
      } else if (state === "closed") {
        this._handleDisconnect(peerId, CONNECTION_STATE.CLOSED);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "disconnected") {
        this._handleDisconnect(peerId, CONNECTION_STATE.FAILED);
      }
    };

    return record;
  }

  send(peerId, payload) {
    const record = this.peers.get(peerId);
    if (!record || record.state !== CONNECTION_STATE.CONNECTED) {
      return false;
    }
    if (record.dataChannel.readyState !== "open") {
      this._handleDisconnect(peerId, CONNECTION_STATE.DISCONNECTED);
      return false;
    }
    const serialized = JSON.stringify(payload);
    const success = sendJson(record.dataChannel, payload);
    if (success) {
      record.messagesSent++;
      record.bytesSent += serialized.length * 2;
    }
    return success;
  }

  broadcast(payload, excludePeerId = null) {
    const results = [];
    for (const [peerId] of this.peers) {
      if (peerId === excludePeerId) continue;
      results.push({ peerId, sent: this.send(peerId, payload) });
    }
    return results;
  }

  removePeer(peerId) {
    const record = this.peers.get(peerId);
    if (!record) return;
    this._stopHeartbeat(peerId);
    this._clearDisconnectTimer(peerId);
    try {
      if (record.dataChannel.readyState !== "closed") {
        record.dataChannel.close();
      }
    } catch {}
    try {
      if (record.pc.signalingState !== "closed") {
        record.pc.close();
      }
    } catch {}
    this.peers.delete(peerId);
    this.dispatchEvent(new CustomEvent("peer-removed", {
      detail: { peerId },
    }));
  }

  getPeer(peerId) {
    return this.peers.get(peerId) || null;
  }

  getPeerState(peerId) {
    const record = this.peers.get(peerId);
    return record ? record.state : null;
  }

  getConnectedPeerIds() {
    const ids = [];
    for (const [peerId, record] of this.peers) {
      if (record.state === CONNECTION_STATE.CONNECTED) {
        ids.push(peerId);
      }
    }
    return ids;
  }

  getAllPeerIds() {
    return [...this.peers.keys()];
  }

  getConnectedCount() {
    let count = 0;
    for (const record of this.peers.values()) {
      if (record.state === CONNECTION_STATE.CONNECTED) count++;
    }
    return count;
  }

  getPeerStats(peerId) {
    const record = this.peers.get(peerId);
    if (!record) return null;
    return {
      state: record.state,
      connectedAt: record.connectedAt,
      lastHeartbeatAt: record.lastHeartbeatAt,
      missedHeartbeats: record.missedHeartbeats,
      bytesSent: record.bytesSent,
      bytesReceived: record.bytesReceived,
      messagesSent: record.messagesSent,
      messagesReceived: record.messagesReceived,
    };
  }

  updateBatteryLevel(level) {
    this._batteryLevel = level;
  }

  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    for (const peerId of this.getAllPeerIds()) {
      this.removePeer(peerId);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
    }
  }

  _startHeartbeat(peerId) {
    this._stopHeartbeat(peerId);
    const interval = setInterval(() => {
      const record = this.peers.get(peerId);
      if (!record || record.state !== CONNECTION_STATE.CONNECTED) {
        this._stopHeartbeat(peerId);
        return;
      }
      const sent = this.send(peerId, {
        type: "heartbeat",
        timestamp: Date.now(),
      });
      if (!sent) {
        record.missedHeartbeats++;
        if (record.missedHeartbeats >= 3) {
          this._handleDisconnect(peerId, CONNECTION_STATE.FAILED);
        }
      }
    }, this._getHeartbeatInterval());
    this.heartbeatIntervals.set(peerId, interval);
  }

  _stopHeartbeat(peerId) {
    const interval = this.heartbeatIntervals.get(peerId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(peerId);
    }
  }

  _getHeartbeatInterval() {
    if (this._isBackgrounded) return HEARTBEAT_BACKGROUND_MS;
    if (this._batteryLevel !== null && this._batteryLevel < 0.2) {
      return HEARTBEAT_BACKGROUND_MS;
    }
    return HEARTBEAT_INTERVAL_MS;
  }

  _handleDisconnect(peerId, newState) {
    const record = this.peers.get(peerId);
    if (!record) return;
    if (record.state === CONNECTION_STATE.DISCONNECTED ||
        record.state === CONNECTION_STATE.FAILED ||
        record.state === CONNECTION_STATE.CLOSED) {
      return;
    }

    record.state = newState;
    this._stopHeartbeat(peerId);
    this.dispatchEvent(new CustomEvent("peer-disconnected", {
      detail: { peerId, state: newState, timestamp: Date.now() },
    }));

    this._startDisconnectTimer(peerId);
  }

  _startDisconnectTimer(peerId) {
    this._clearDisconnectTimer(peerId);
    const timer = setTimeout(() => {
      const record = this.peers.get(peerId);
      if (record && record.state !== CONNECTION_STATE.CONNECTED) {
        this.removePeer(peerId);
      }
    }, DISCONNECT_GRACE_PERIOD_MS);
    this.disconnectTimers.set(peerId, timer);
  }

  _clearDisconnectTimer(peerId) {
    const timer = this.disconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(peerId);
    }
  }

  _startCleanupInterval() {
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [peerId, timer] of this.disconnectTimers) {
        if (now >= timer._idleStart + DISCONNECT_GRACE_PERIOD_MS) {
          this.removePeer(peerId);
        }
      }
    }, STALE_PEER_CLEANUP_INTERVAL_MS);
  }

  _monitorVisibility() {
    if (typeof document === "undefined") return;
    this._visibilityHandler = () => {
      this._isBackgrounded = document.hidden;
      for (const peerId of this.getAllPeerIds()) {
        if (this.getPeerState(peerId) === CONNECTION_STATE.CONNECTED) {
          this._startHeartbeat(peerId);
        }
      }
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
  }
}
