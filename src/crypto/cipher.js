const IV_LENGTH = 12;
const TAG_LENGTH = 128;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encryptPayload(sharedKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const data = typeof plaintext === "string"
    ? encoder.encode(plaintext)
    : encoder.encode(JSON.stringify(plaintext));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: undefined,
      tagLength: TAG_LENGTH,
    },
    sharedKey,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

export async function decryptPayload(sharedKey, ciphertextB64, ivB64) {
  const ciphertext = base64ToArrayBuffer(ciphertextB64);
  const iv = base64ToArrayBuffer(ivB64);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: undefined,
        tagLength: TAG_LENGTH,
      },
      sharedKey,
      ciphertext
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

export async function decryptPayloadToString(sharedKey, ciphertextB64, ivB64) {
  const ciphertext = base64ToArrayBuffer(ciphertextB64);
  const iv = base64ToArrayBuffer(ivB64);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: undefined,
        tagLength: TAG_LENGTH,
      },
      sharedKey,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

export async function signMessage(privateKey, dataToSign) {
  const encoder = new TextEncoder();
  const data = typeof dataToSign === "string"
    ? encoder.encode(dataToSign)
    : dataToSign;

  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    privateKey,
    data
  );

  return arrayBufferToBase64(signature);
}

export async function verifySignature(publicKey, signatureB64, dataToVerify) {
  const signature = base64ToArrayBuffer(signatureB64);
  const encoder = new TextEncoder();
  const data = typeof dataToVerify === "string"
    ? encoder.encode(dataToVerify)
    : dataToVerify;

  try {
    return await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-256",
      },
      publicKey,
      signature,
      data
    );
  } catch {
    return false;
  }
}

export function toBase64(buffer) {
  return arrayBufferToBase64(buffer);
}

export function fromBase64(b64) {
  return base64ToArrayBuffer(b64);
}
