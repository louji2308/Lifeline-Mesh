export const CHANNEL_LABEL = "mesh";

export const CHANNEL_CONFIG = Object.freeze({
  ordered: true,
  negotiated: false,
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
    const payload = JSON.stringify(data);
    channel.send(payload);
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
      return JSON.parse(event.data);
    } catch {
      return { type: "raw", data: event.data };
    }
  }
  return { type: "binary", data: event.data };
}
