export const PRIORITY = Object.freeze({
  SOS: "sos",
  NORMAL: "normal",
  CHAT: "chat",
});

export const PRIORITY_ORDER = [PRIORITY.SOS, PRIORITY.NORMAL, PRIORITY.CHAT];

export const MESSAGE_FLAGS = Object.freeze({
  HEARTBEAT: "__heartbeat__",
  KEY_EXCHANGE: "__key_exchange__",
  GROUP_KEY_ANNOUNCE: "__group_key__",
});

export const MAX_TTL = 8;

export function generateId() {
  return crypto.randomUUID();
}

export function createMessage({ senderId, recipientId = null, priority = PRIORITY.NORMAL, vectorClock = {}, payload }) {
  return {
    id: generateId(),
    senderId,
    recipientId,
    priority,
    vectorClock: { ...vectorClock },
    ttl: MAX_TTL,
    hopCount: 0,
    timestamp: Date.now(),
    ciphertext: "",
    iv: "",
    signature: "",
    plaintext: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

export function isBroadcast(message) {
  return message.recipientId === null;
}

export function isSOS(message) {
  return message.priority === PRIORITY.SOS;
}

export function isHeartbeat(message) {
  return message.plaintext === MESSAGE_FLAGS.HEARTBEAT;
}

export function isKeyExchange(message) {
  return message.plaintext === MESSAGE_FLAGS.KEY_EXCHANGE;
}

export function hasExpired(message) {
  return message.hopCount >= message.ttl;
}

export function validateMessageShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  const required = ["id", "senderId", "priority", "vectorClock", "ttl", "hopCount", "timestamp", "ciphertext", "iv", "signature"];
  for (const field of required) {
    if (!(field in obj)) return false;
  }
  if (!PRIORITY_ORDER.includes(obj.priority)) return false;
  if (typeof obj.ttl !== "number" || obj.ttl < 1) return false;
  if (typeof obj.hopCount !== "number" || obj.hopCount < 0) return false;
  return true;
}

export function cloneMessage(message) {
  return {
    ...message,
    vectorClock: { ...message.vectorClock },
  };
}
