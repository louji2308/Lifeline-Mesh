export async function deriveSharedKey(myPrivateDhKey, theirPublicDhKey) {
  const sharedKey = await crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: theirPublicDhKey,
    },
    myPrivateDhKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
  return sharedKey;
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
  return crypto.subtle.importKey(
    "raw",
    sharedBits,
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
