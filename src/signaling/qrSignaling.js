import { compressSdp, decompressSdp } from "./qrCodec.js";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const RTC_CONFIG = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 0,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

export const PEER_ROLE = Object.freeze({
  INITIATOR: "initiator",
  RESPONDER: "responder",
});

export class SignalingError extends Error {
  constructor(message, code = "SIGNALING_ERROR") {
    super(message);
    this.name = "SignalingError";
    this.code = code;
  }
}

export async function createOffer(deviceId) {
  let pc;
  try {
    pc = new RTCPeerConnection(RTC_CONFIG);
    const dataChannel = pc.createDataChannel("mesh", {
      ordered: true,
      negotiated: false,
    });

    const iceGatheringComplete = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 10000);

      pc.onicecandidate = (event) => {
        if (event.candidate === null) {
          clearTimeout(timeout);
          resolve();
        }
      };
      pc.onicecandidateerror = () => {};

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
      iceRestart: false,
    });

    await pc.setLocalDescription(offer);
    await iceGatheringComplete;

    const qrPayload = await compressSdp(pc.localDescription.sdp);

    return {
      pc,
      dataChannel,
      qrPayload,
      connectionState: "pending",
    };
  } catch (error) {
    if (pc && pc.signalingState !== "closed") {
      try { pc.close(); } catch {}
    }
    throw new SignalingError(
      `Failed to create offer: ${error.message}`,
      "CREATE_OFFER_FAILED"
    );
  }
}

export async function answerOffer(scannedOfferPayload, deviceId) {
  let pc;
  try {
    const offerSdp = await decompressSdp(scannedOfferPayload);
    pc = new RTCPeerConnection(RTC_CONFIG);

    const dataChannelReady = new Promise((resolve) => {
      pc.ondatachannel = (event) => {
        resolve(event.channel);
      };
    });

    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });

    const iceGatheringComplete = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 10000);
      pc.onicecandidate = (event) => {
        if (event.candidate === null) {
          clearTimeout(timeout);
          resolve();
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await iceGatheringComplete;

    const qrPayload = await compressSdp(pc.localDescription.sdp);

    const dataChannel = await dataChannelReady;

    return {
      pc,
      dataChannel,
      qrPayload,
      connectionState: "pending",
    };
  } catch (error) {
    if (pc && pc.signalingState !== "closed") {
      try { pc.close(); } catch {}
    }
    throw new SignalingError(
      `Failed to answer offer: ${error.message}`,
      "ANSWER_OFFER_FAILED"
    );
  }
}

export async function completeHandshake(pc, scannedAnswerPayload) {
  try {
    const answerSdp = await decompressSdp(scannedAnswerPayload);
    if (pc.signalingState !== "have-local-offer") {
      throw new SignalingError(
        `Cannot set answer in state: ${pc.signalingState}`,
        "INVALID_SIGNALING_STATE"
      );
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    return true;
  } catch (error) {
    if (error instanceof SignalingError) throw error;
    throw new SignalingError(
      `Failed to complete handshake: ${error.message}`,
      "HANDSHAKE_FAILED"
    );
  }
}
