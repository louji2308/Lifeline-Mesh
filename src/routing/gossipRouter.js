import { BloomFilter } from "./bloomFilter.js";
import { PriorityQueue } from "./priorityQueue.js";
import { MAX_TTL, PRIORITY_ORDER, hasExpired, validateMessageShape, isBroadcast } from "../schema.js";
import { MESSAGE_TYPE } from "../transport/dataChannel.js";

const MAX_RELAYS_PER_SECOND_PER_PEER = 20;
const RELAY_WINDOW_MS = 1000;
const IDLE_DRAIN_INTERVAL_MS = 200;
const SEEN_RESET_THRESHOLD = 500;

export class GossipRouter {
  constructor(peerManager, onLocalDeliver) {
    this.peerManager = peerManager;
    this.onLocalDeliver = onLocalDeliver;
    const filterSize = BloomFilter.optimalSize(SEEN_RESET_THRESHOLD, 0.01);
    this.seen = new BloomFilter(filterSize, BloomFilter.optimalHashes(SEEN_RESET_THRESHOLD, filterSize));
    this.outboxQueues = new Map();
    this.relayTimestamps = new Map();
    this._idleDrainTimer = null;
    this._startIdleDrain();

    this._boundHandleMessage = this._handleIncoming.bind(this);
    peerManager.addEventListener("message-received", this._boundHandleMessage);
  }

  sendLocal(message) {
    if (!validateMessageShape(message)) {
      console.warn("[GossipRouter] Invalid message shape, dropping local send");
      return false;
    }
    this.seen.add(message.id);
    this._relayToAll(cloneMessageForRelay(message), null);
    try {
      this.onLocalDeliver(message);
    } catch (err) {
      console.error("[GossipRouter] Local delivery callback failed:", err);
    }
    return true;
  }

  _handleIncoming(event) {
    try {
      const message = event.detail.raw;
      if (!message || !message.id) return;
      if (message.type === MESSAGE_TYPE.KEY_EXCHANGE ||
          message.type === MESSAGE_TYPE.GROUP_KEY_ANNOUNCE ||
          message.type === MESSAGE_TYPE.HEARTBEAT) {
        return;
      }

      if (!validateMessageShape(message)) {
        console.warn("[GossipRouter] Invalid message shape from peer, dropping");
        return;
      }

      if (this.seen.mightContain(message.id)) return;
      this.seen.add(message.id);

      if (this.seen.count >= SEEN_RESET_THRESHOLD) {
        this.seen.clear();
      }

      if (hasExpired(message)) return;

      if (isBroadcast(message) || message.recipientId === this.myDeviceId) {
        try {
          this.onLocalDeliver(message);
        } catch (err) {
          console.error("[GossipRouter] Local delivery callback failed:", err);
        }
      }

      message.hopCount += 1;

      if (hasExpired(message)) return;

      this._relayToAll(message, event.detail.peerId);
    } catch (err) {
      console.error("[GossipRouter] Error handling incoming message:", err);
    }
  }

  _relayToAll(message, excludePeerId) {
    const connectedPeers = this.peerManager.getConnectedPeerIds();
    let enqueued = false;

    for (const peerId of connectedPeers) {
      if (peerId === excludePeerId) continue;
      if (!this._withinRateLimit(peerId)) continue;

      if (!this.outboxQueues.has(peerId)) {
        this.outboxQueues.set(peerId, new PriorityQueue());
      }
      this.outboxQueues.get(peerId).enqueue(message);
      enqueued = true;
    }

    if (enqueued) {
      this._drainQueues();
    }
  }

  _drainQueues() {
    for (const [peerId, queue] of this.outboxQueues) {
      let drained = 0;
      while (queue.size > 0 && drained < MAX_RELAYS_PER_SECOND_PER_PEER) {
        const msg = queue.dequeue();
        const sent = this.peerManager.send(peerId, msg);
        if (sent) {
          drained++;
          this._recordRelay(peerId);
        } else {
          break;
        }
      }

      if (queue.size === 0) {
        this.outboxQueues.delete(peerId);
      }
    }
  }

  _withinRateLimit(peerId) {
    const now = Date.now();
    const timestamps = this.relayTimestamps.get(peerId) || [];
    const recent = timestamps.filter((t) => now - t < RELAY_WINDOW_MS);
    this.relayTimestamps.set(peerId, recent);
    return recent.length < MAX_RELAYS_PER_SECOND_PER_PEER;
  }

  _recordRelay(peerId) {
    let timestamps = this.relayTimestamps.get(peerId);
    if (!timestamps) {
      timestamps = [];
      this.relayTimestamps.set(peerId, timestamps);
    }
    timestamps.push(Date.now());
  }

  _startIdleDrain() {
    this._idleDrainTimer = setInterval(() => {
      this._drainQueues();
    }, IDLE_DRAIN_INTERVAL_MS);
  }

  setMyDeviceId(deviceId) {
    this.myDeviceId = deviceId;
  }

  getSeenCount() {
    return this.seen.count;
  }

  getQueueStats() {
    const stats = {};
    for (const [peerId, queue] of this.outboxQueues) {
      stats[peerId] = queue.getBucketSizes();
    }
    return stats;
  }

  destroy() {
    if (this._idleDrainTimer) {
      clearInterval(this._idleDrainTimer);
      this._idleDrainTimer = null;
    }
    this.peerManager.removeEventListener("message-received", this._boundHandleMessage);
    this.outboxQueues.clear();
    this.relayTimestamps.clear();
  }
}

function cloneMessageForRelay(message) {
  return {
    ...message,
    vectorClock: message.vectorClock ? { ...message.vectorClock } : {},
  };
}
