export const CHANNEL_LABEL = "mesh";

export const CHANNEL_CONFIG = Object.freeze({
  ordered: true,
  negotiated: false,
});

export const MESSAGE_TYPE = Object.freeze({
  HEARTBEAT: "__heartbeat__",
  KEY_EXCHANGE: "__key_exchange__",
  GROUP_KEY_ANNOUNCE: "__group_key__",
  MESH_MESSAGE: "__mesh__",
});

export function configureDataChannel(channel) {
  channel.binaryType = "arraybuffer";
  return channel;
}

export function sendJson(channel, data) {
  if (channel.readyState !== "open") {
    return false;
  }
  try {
    channel.send(JSON.stringify(data));
    return true;
  } catch (error) {
    if (error.name === "NetworkError" || error.name === "InvalidStateError") {
      return false;
    }
    throw error;
  }
}

export function sendRaw(channel, data) {
  if (channel.readyState !== "open") {
    return false;
  }
  try {
    channel.send(data);
    return true;
  } catch (error) {
    if (error.name === "NetworkError" || error.name === "InvalidStateError") {
      return false;
    }
    throw error;
  }
}

export function parseMessage(event) {
  if (typeof event.data === "string") {
    try {
      const obj = JSON.parse(event.data);
      if (obj && typeof obj === "object") {
        return obj;
      }
      return { type: MESSAGE_TYPE.MESH_MESSAGE, plaintext: event.data };
    } catch {
      return { type: MESSAGE_TYPE.MESH_MESSAGE, plaintext: event.data };
    }
  }
  return { type: "binary", data: event.data };
}

export function createControlMessage(type, payload = {}) {
  return {
    type,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...payload,
  };
}

export function isControlMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.type === MESSAGE_TYPE.HEARTBEAT) return true;
  if (msg.type === MESSAGE_TYPE.KEY_EXCHANGE) return true;
  if (msg.type === MESSAGE_TYPE.GROUP_KEY_ANNOUNCE) return true;
  return false;
}
