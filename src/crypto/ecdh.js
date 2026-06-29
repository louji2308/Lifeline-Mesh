export async function deriveSharedKey(myPrivateDhKey, theirPublicDhKey) {
  const sharedBits = await deriveSharedKeyRaw(myPrivateDhKey, theirPublicDhKey);
  return deriveKeyFromRaw(sharedBits);
}

export async function deriveSharedKeyRaw(myPrivateDhKey, theirPublicDhKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: theirPublicDhKey,
    },
    myPrivateDhKey,
    256
  );
  return sharedBits;
}

export async function deriveKeyFromRaw(sharedBits) {
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(16),
      info: new TextEncoder().encode("lifeline-mesh-ecdh-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicDhKey(dhPublicKey) {
  return crypto.subtle.exportKey("jwk", dhPublicKey);
}

export async function importPublicDhKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}
