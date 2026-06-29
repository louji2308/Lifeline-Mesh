# 🛠️ LifeLine Mesh — Full Technical Implementation Guide
### The exact code, data structures, and optimization techniques behind every module
**Companion document:** `plan.md` (the phase-by-phase timeline — read that first for *when*; this document is the *how*)

---

## 📐 Section 1: Canonical Message Schema (read this before anything else)

Every single layer in this system — routing, CRDT, encryption, UI — operates on one shared object shape. Lock this first; changing it later cascades into every module.

```typescript
interface MeshMessage {
  id: string;              // UUID v4, globally unique, generated once at creation
  senderId: string;         // sender's persistent device ID (derived from their public key)
  recipientId: string | null; // null = broadcast/SOS to entire mesh, set = E2E targeted message
  priority: "sos" | "normal" | "chat"; // drives relay queue ordering
  vectorClock: Record<string, number>; // sender's causal clock snapshot at send-time, e.g. { "deviceA": 4, "deviceB": 1 }
  ttl: number;              // max remaining hops, decremented... actually tracked via hopCount below
  hopCount: number;         // incremented by 1 at every relay, message dropped if hopCount >= maxTtl
  timestamp: number;        // local sender clock, used ONLY for UI display ordering, never for correctness
  ciphertext: string;       // base64 AES-GCM encrypted payload (recipientId-targeted key, or group key if broadcast)
  iv: string;               // base64 initialization vector for this AES-GCM encryption
  signature: string;        // base64 ECDSA signature over (id + senderId + ciphertext), for tamper detection
}
```

**Why every field exists (you will be asked this in Q&A — know it cold):**
- `id` → the unit of dedup in the Bloom filter / seen-set (Module 3)
- `vectorClock` → causal ordering + the basis of CRDT merge correctness (Module 4)
- `ttl`/`hopCount` → flood prevention (Module 3)
- `priority` → the real-world-impact feature: SOS jumps every queue (Module 3)
- `ciphertext`/`iv` → relays never see plaintext (Module 5)
- `signature` → tamper detection without needing a trusted third party (Module 5)

---

## 🌳 Section 2: Repository Structure (full file tree)

```
lifeline-mesh/
├── index.html                  # single entry point, loads app.js as ES module
├── manifest.json                # PWA manifest (icons, name, display: standalone)
├── sw.js                         # service worker — offline cache-first strategy
├── ARCHITECTURE.md              # decision log from Phase 1, Step 1.4
├── README.md                    # submission-facing documentation
├── LICENSE                       # MIT
├── icons/
│   ├── icon-192.svg
│   └── icon-512.svg
└── src/
    ├── app.js                    # boot sequence, wires all modules together
    ├── schema.js                 # MeshMessage type helpers, validators, factory functions
    ├── signaling/
    │   ├── qrSignaling.js        # offer/answer QR encode+decode flow (Module 1)
    │   └── qrCodec.js            # QR generation + scanning wrapper (zero-dependency)
    ├── transport/
    │   ├── peerManager.js        # RTCPeerConnection lifecycle, Map<peerId, connection> (Module 2)
    │   └── dataChannel.js        # thin wrapper: send/receive framing over RTCDataChannel
    ├── routing/
    │   ├── bloomFilter.js        # dedup structure (Module 3)
    │   ├── priorityQueue.js      # 3-bucket SOS/normal/chat relay queue (Module 3)
    │   └── gossipRouter.js       # the core relay/forward engine (Module 3)
    ├── crdt/
    │   ├── vectorClock.js        # clock increment/compare/merge helpers (Module 4)
    │   └── messageLog.js         # G-Set CRDT log + merge + compaction (Module 4)
    ├── crypto/
    │   ├── keyManager.js         # device keypair generation/storage (Module 5)
    │   ├── ecdh.js                # per-link + per-recipient shared secret derivation (Module 5)
    │   └── cipher.js              # AES-GCM encrypt/decrypt, ECDSA sign/verify (Module 5)
    ├── storage/
    │   └── db.js                  # IndexedDB wrapper, zero dependencies (Module 6)
    └── ui/
        ├── meshStatus.js         # peer list + health indicators screen (Module 8)
        ├── chatView.js            # message list + compose box (Module 8)
        └── pairingView.js         # QR display/scan screen (Module 8)
```

**Design principle behind this structure:** every folder under `src/` maps 1:1 to an architecture layer from the original pitch. This isn't accidental — when a judge opens your repo, the folder names alone should narrate the architecture before they read a single line of code.

---

## 🧰 Section 3: Tech Stack — Verified Zero-Cost

| Layer | Technology | Cost | Why this, not an alternative |
|---|---|---|---|
| P2P transport | WebRTC `RTCPeerConnection`/`RTCDataChannel` (native browser API) | $0 | No install, works on every modern browser, encrypted by default (DTLS) |
| Signaling | Manual QR-code SDP exchange | $0 | Eliminates the one piece every other WebRTC tutorial assumes you'll pay for (a signaling server) |
| Encryption | WebCrypto `SubtleCrypto` (ECDH + AES-GCM + ECDSA) | $0 | Native, audited, no crypto library dependency to vet or bundle |
| Local storage | IndexedDB (native) | $0 | Durable, async, large capacity, survives app close |
| Offline shell | Service Worker + Cache API (native) | $0 | True offline-after-first-load, no CDN dependency at runtime |
| QR generation/scan | Native `BarcodeDetector` API where available, lightweight zero-dependency canvas-based fallback otherwise | $0 | Avoids pulling in a heavy npm QR library just for a hackathon demo |
| Hosting | GitHub Pages or Netlify free tier | $0 | Static files only — there is no backend to host, ever |
| Build tooling | None required (vanilla ES modules) — optional Vite if preferred | $0 | Removes an entire category of "why won't it build" failure modes under time pressure |

**The one-sentence cost story for your pitch:** *"There is no backend, so there is no bill — every byte of compute, storage, and bandwidth this system ever uses is donated by the end-user's own device, forever, at any scale."*

---

## 📡 Module 1: Signaling & Discovery — QR-Based Manual WebRTC Handshake

This is the architectural centerpiece. Standard WebRTC tutorials assume a signaling server (Firebase, a WebSocket relay) to exchange the SDP offer/answer before peers can connect directly. We replace that server with a **physical, visual channel**: the screens and cameras of the devices themselves.

### 1.1 — The three-step handshake, conceptually
```
Peer A (Initiator)                          Peer B (Joiner)
──────────────────                          ───────────────
1. createOffer()
   → generates local SDP offer
   → encodes offer as QR, shows on screen
                                              2. scans A's QR
                                                 → setRemoteDescription(offer)
                                                 → createAnswer()
                                                 → encodes answer as QR, shows on screen
3. scans B's QR
   → setRemoteDescription(answer)
   → ICE negotiation begins automatically
   → RTCDataChannel opens on both sides ✅
```

### 1.2 — Core code: creating the offer (Peer A)
```javascript
// src/signaling/qrSignaling.js
export async function createOfferFlow() {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }] // free public STUN, only matters if NAT traversal is needed
  });

  const dataChannel = pc.createDataChannel("mesh", { ordered: true });

  // Gather all ICE candidates before generating the QR — avoids a second QR round-trip for trickle ICE
  const iceGatheringComplete = new Promise((resolve) => {
    pc.onicecandidate = (event) => {
      if (event.candidate === null) resolve(); // null candidate signals gathering is done
    };
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await iceGatheringComplete;

  // pc.localDescription now contains the FULL offer with all ICE candidates embedded
  const payload = compressSdp(pc.localDescription.sdp); // see 1.4 for compression
  return { pc, dataChannel, qrPayload: payload };
}
```

### 1.3 — Core code: answering (Peer B), then completing (Peer A)
```javascript
export async function answerOfferFlow(scannedOfferPayload) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  let dataChannel;
  pc.ondatachannel = (event) => { dataChannel = event.channel; };

  const offerSdp = decompressSdp(scannedOfferPayload);
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });

  const iceGatheringComplete = new Promise((resolve) => {
    pc.onicecandidate = (event) => { if (event.candidate === null) resolve(); };
  });

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await iceGatheringComplete;

  const payload = compressSdp(pc.localDescription.sdp);
  return { pc, qrPayload: payload }; // Peer A scans this QR to complete the handshake
}

export async function completeHandshake(pc, scannedAnswerPayload) {
  const answerSdp = decompressSdp(scannedAnswerPayload);
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  // connectionstatechange will fire "connected" shortly after this resolves
}
```

### 1.4 — Performance optimization: SDP compression for scannable QR codes
Raw SDP is verbose (often 1–2KB of text) — dense enough that QR codes become unreliable to scan at demo distance. Two complementary techniques:
```javascript
// src/signaling/qrSignaling.js (compression helpers)
function compressSdp(sdp) {
  // Strip fields irrelevant to a same-room/local demo (e.g. unused codec lines),
  // then run through a basic deflate (CompressionStream API, native, zero deps),
  // then base64url-encode for QR safety.
  return toBase64Url(deflate(stripNonEssentialSdpLines(sdp)));
}
function decompressSdp(payload) {
  return inflate(fromBase64Url(payload));
}
```
- [ ] **Rule of thumb learned from testing:** if a single QR still exceeds a comfortable scan size (~900 bytes of payload at a reasonable error-correction level), split into 2–3 sequential QR frames with a tiny header (`frame 1/2`) and have the scanner auto-advance — far more reliable on stage than one dense, unreadable code.

### 1.5 — Bootstrap-node introduction flow (Phase 3)
A new device only ever needs to QR-pair with **one** existing mesh member. Once that single `RTCDataChannel` is open, the gossip router (Module 3) handles reaching every other mesh member transitively — the new device never needs N pairing ceremonies for N existing peers.

---

## 🔌 Module 2: Transport Layer — Multi-Peer Connection Management

### 2.1 — The `PeerManager` class
This is the foundation every higher layer (routing, CRDT, crypto) builds on. Its only job: track connection lifecycle and expose a clean send/receive API, hiding all WebRTC plumbing from the rest of the app.

```javascript
// src/transport/peerManager.js
export class PeerManager extends EventTarget {
  constructor() {
    super();
    this.peers = new Map(); // peerId -> { pc, dataChannel, state }
  }

  addPeer(peerId, pc, dataChannel) {
    const record = { pc, dataChannel, state: "connecting" };
    this.peers.set(peerId, record);

    dataChannel.onopen = () => {
      record.state = "connected";
      this.dispatchEvent(new CustomEvent("peer-connected", { detail: { peerId } }));
      this._startHeartbeat(peerId);
    };

    dataChannel.onclose = () => this._handleDisconnect(peerId);
    dataChannel.onerror = () => this._handleDisconnect(peerId);

    dataChannel.onmessage = (event) => {
      this.dispatchEvent(new CustomEvent("message-received", {
        detail: { peerId, raw: event.data }
      }));
    };

    pc.oniceconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
        this._handleDisconnect(peerId);
      }
    };
  }

  send(peerId, payload) {
    const record = this.peers.get(peerId);
    if (record?.state === "connected" && record.dataChannel.readyState === "open") {
      record.dataChannel.send(payload);
      return true;
    }
    return false; // caller (gossip router) should treat this as "edge unavailable"
  }

  broadcast(payload, excludePeerId = null) {
    for (const [peerId] of this.peers) {
      if (peerId !== excludePeerId) this.send(peerId, payload);
    }
  }

  getConnectedPeerIds() {
    return [...this.peers.entries()]
      .filter(([, r]) => r.state === "connected")
      .map(([id]) => id);
  }

  _handleDisconnect(peerId) {
    const record = this.peers.get(peerId);
    if (record) record.state = "disconnected";
    this.dispatchEvent(new CustomEvent("peer-disconnected", { detail: { peerId } }));
    // Deliberately NOT deleting from the map immediately — UI shows "lost" state,
    // and a reconnect (Step 3.3) can revive the same peerId entry cleanly.
  }

  _startHeartbeat(peerId) {
    const interval = setInterval(() => {
      const record = this.peers.get(peerId);
      if (!record || record.state !== "connected") { clearInterval(interval); return; }
      this.send(peerId, JSON.stringify({ type: "heartbeat" }));
    }, 5000);
  }
}
```

### 2.2 — Why `EventTarget` and not a custom pub/sub
Using the native `EventTarget` base class instead of hand-rolling an event emitter is a tiny but real performance + code-size win — zero dependency, browser-optimized, and instantly familiar to any reviewer of your code.

### 2.3 — Graceful degradation contract
Every higher layer must treat `send()` returning `false` as a normal, expected condition — **not** an error to throw on. A mesh network's entire value proposition is "keeps working when links go down," so the code has to model that as the common case, not the exception.

---

## 🌐 Module 3: Routing Layer — Gossip Protocol, Bloom Filter Dedup, Priority Queues

This module is your single biggest technical-depth talking point. Three sub-components work together: TTL/hop-count, a seen-set (Bloom filter or capped Set), and a 3-tier priority queue.

### 3.1 — When you actually need a true Bloom filter vs. a capped `Set` (the honest math)
A Bloom filter trades a small false-positive rate for O(1) space-efficient membership testing — invaluable at **thousands of messages across dozens of peers**. At hackathon demo scale (tens of messages, a handful of devices), a simple `Set<string>` with an LRU-style eviction cap is **functionally identical in behavior** and far simpler to verify is bug-free live.

**Recommendation:** Implement the real Bloom filter (it's ~30 lines and a genuine "wow" in code review), but keep a capped-`Set` fallback path documented — this honesty about scale tradeoffs is itself a signal of seniority.

```javascript
// src/routing/bloomFilter.js
export class BloomFilter {
  constructor(sizeInBits = 8192, numHashes = 4) {
    this.size = sizeInBits;
    this.numHashes = numHashes;
    this.bits = new Uint8Array(Math.ceil(sizeInBits / 8));
  }

  _hash(value, seed) {
    // FNV-1a variant, seeded — fast, dependency-free, good distribution for short strings like UUIDs
    let hash = 2166136261 ^ seed;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % this.size;
  }

  add(value) {
    for (let i = 0; i < this.numHashes; i++) {
      const bitIndex = this._hash(value, i);
      this.bits[bitIndex >> 3] |= 1 << (bitIndex & 7);
    }
  }

  mightContain(value) {
    for (let i = 0; i < this.numHashes; i++) {
      const bitIndex = this._hash(value, i);
      if ((this.bits[bitIndex >> 3] & (1 << (bitIndex & 7))) === 0) return false;
    }
    return true; // possibly a false positive, never a false negative — exactly the guarantee dedup needs
  }
}
```

**Sizing math (know this number, judges love when you can justify a constant):** for a target false-positive rate of ~1%, with `n` expected messages, optimal bits `m ≈ -(n·ln(p)) / (ln2)²`. At `n=1000` messages and `p=0.01`, that's roughly 9600 bits (~1.2KB) — trivial memory cost even on the cheapest phone, which is exactly the point: this technique scales to real disaster-scale traffic for almost no resource cost.

### 3.2 — Priority queue (3-bucket relay queue)
```javascript
// src/routing/priorityQueue.js
const PRIORITY_ORDER = ["sos", "normal", "chat"];

export class PriorityQueue {
  constructor() {
    this.buckets = { sos: [], normal: [], chat: [] };
  }

  enqueue(message) {
    this.buckets[message.priority].push(message);
  }

  dequeue() {
    for (const tier of PRIORITY_ORDER) {
      if (this.buckets[tier].length > 0) return this.buckets[tier].shift();
    }
    return null;
  }

  get size() {
    return this.buckets.sos.length + this.buckets.normal.length + this.buckets.chat.length;
  }
}
```
This is deliberately a flat 3-bucket array structure, not a binary heap — at hackathon message volumes a heap's `O(log n)` advantage over this `O(1)` bucket-shift is not just unnecessary, it's *wrong* to reach for: simpler, more obviously-correct code that's trivial to demo live (you can literally console.log the bucket sizes mid-demo) beats premature optimization.

### 3.3 — The gossip router core loop
```javascript
// src/routing/gossipRouter.js
import { BloomFilter } from "./bloomFilter.js";
import { PriorityQueue } from "./priorityQueue.js";

const MAX_TTL = 8;
const MAX_RELAYS_PER_SECOND_PER_PEER = 20; // congestion control / battery protection

export class GossipRouter {
  constructor(peerManager, onLocalDeliver) {
    this.peerManager = peerManager;
    this.onLocalDeliver = onLocalDeliver; // callback for messages addressed to me, or broadcast
    this.seen = new BloomFilter();
    this.outboxQueues = new Map(); // peerId -> PriorityQueue
    this.relayTimestamps = new Map(); // peerId -> array of recent send timestamps, for rate limiting

    peerManager.addEventListener("message-received", (e) => {
      this._handleIncoming(JSON.parse(e.detail.raw), e.detail.peerId);
    });
  }

  // Called by the UI layer when the local user composes a new message
  sendLocal(message) {
    this.seen.add(message.id); // I authored it, I've definitely "seen" it
    this._relayToAll(message, /* excludePeerId */ null);
    this.onLocalDeliver(message); // also render it in my own UI immediately
  }

  _handleIncoming(message, fromPeerId) {
    if (this.seen.mightContain(message.id)) return; // dedup — drop silently, do NOT re-relay
    this.seen.add(message.id);

    if (message.hopCount >= MAX_TTL) return; // flood prevention — drop silently

    // Deliver locally if it's a broadcast or addressed to me (recipientId check happens post-decrypt, Module 5)
    if (message.recipientId === null || message.recipientId === this.myDeviceId) {
      this.onLocalDeliver(message);
    }

    message.hopCount += 1;
    this._relayToAll(message, fromPeerId); // never echo back to the sender
  }

  _relayToAll(message, excludePeerId) {
    for (const peerId of this.peerManager.getConnectedPeerIds()) {
      if (peerId === excludePeerId) continue;
      if (!this._withinRateLimit(peerId)) continue; // congestion/battery protection, drop low-priority overflow

      if (!this.outboxQueues.has(peerId)) this.outboxQueues.set(peerId, new PriorityQueue());
      this.outboxQueues.get(peerId).enqueue(message);
    }
    this._drainQueues();
  }

  _drainQueues() {
    for (const [peerId, queue] of this.outboxQueues) {
      while (queue.size > 0) {
        const msg = queue.dequeue();
        const sent = this.peerManager.send(peerId, JSON.stringify(msg));
        if (!sent) break; // link down — message stays conceptually "pending," will be retried on next relay event
        this._recordRelay(peerId);
      }
    }
  }

  _withinRateLimit(peerId) {
    const now = Date.now();
    const timestamps = (this.relayTimestamps.get(peerId) || []).filter(t => now - t < 1000);
    this.relayTimestamps.set(peerId, timestamps);
    return timestamps.length < MAX_RELAYS_PER_SECOND_PER_PEER;
  }

  _recordRelay(peerId) {
    const timestamps = this.relayTimestamps.get(peerId) || [];
    timestamps.push(Date.now());
    this.relayTimestamps.set(peerId, timestamps);
  }
}
```

### 3.4 — Why "never echo back to the sender" matters
Without the `excludePeerId` check in `_relayToAll`, A→B→A would create an immediate, pointless round-trip. It's a one-line guard, but explaining *why* it's there unprompted is exactly the kind of detail-mastery that separates a grandmaster submission from one that merely works.

---

## 🧬 Module 4: CRDT Consistency Layer — Vector Clocks + G-Set Merge

### 4.1 — Vector clock helpers
```javascript
// src/crdt/vectorClock.js
export function incrementClock(clock, deviceId) {
  return { ...clock, [deviceId]: (clock[deviceId] || 0) + 1 };
}

export function mergeClock(clockA, clockB) {
  const merged = { ...clockA };
  for (const [device, count] of Object.entries(clockB)) {
    merged[device] = Math.max(merged[device] || 0, count);
  }
  return merged;
}

// "Happened-before" check — useful for causal UI ordering, never for merge correctness
export function happenedBefore(clockA, clockB) {
  const devices = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  let strictlyLess = false;
  for (const d of devices) {
    const a = clockA[d] || 0, b = clockB[d] || 0;
    if (a > b) return false;
    if (a < b) strictlyLess = true;
  }
  return strictlyLess;
}
```

### 4.2 — The G-Set message log
A Grow-only Set is the simplest CRDT that's still genuinely, provably conflict-free: **the merge operation is just set union.** No "last write wins," no timestamp tie-breaking, no manual conflict UI ever required — because two sets unioned together can never disagree about whether an element exists.

```javascript
// src/crdt/messageLog.js
import { mergeClock } from "./vectorClock.js";

export class MessageLog {
  constructor() {
    this.messages = new Map(); // id -> MeshMessage, the actual G-Set storage
    this.localClock = {};
  }

  add(message) {
    if (this.messages.has(message.id)) return false; // idempotent — re-adding is always safe, by design
    this.messages.set(message.id, message);
    this.localClock = mergeClock(this.localClock, message.vectorClock);
    return true;
  }

  // The entire "split-brain reconciliation" demo moment is this one function:
  mergeWith(otherLog) {
    let newCount = 0;
    for (const [id, message] of otherLog.messages) {
      if (this.add(message)) newCount++;
    }
    return newCount; // how many previously-unknown messages this merge introduced
  }

  getSortedForDisplay() {
    // Causal-then-temporal ordering for the UI only — storage itself needs no ordering at all
    return [...this.messages.values()].sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

### 4.3 — Why G-Set, not OR-Set or LWW-Register (the answer to "why not X" in Q&A)
- **LWW-Register (Last-Write-Wins)** requires trusting timestamps for tie-breaking — but in a mesh with no shared clock source and real clock drift across cheap devices, "last" is not even a well-defined concept. It would *look* fine in a quick demo and be subtly wrong in exactly the partition-then-reconnect scenario this whole project is built to handle.
- **OR-Set (Observed-Remove Set)** adds the ability to *delete* elements conflict-free — genuinely useful future work (e.g., letting a user retract a message) but unnecessary complexity for a message log that's fundamentally append-only at hackathon scope. Mention this as a deliberate, scoped trade-off, not an oversight.
- **G-Set** is the right tool because the actual requirement is "messages accumulate and must never be lost or duplicated on merge" — which is *exactly* what a grow-only set guarantees, with the simplest possible implementation and the strongest possible correctness guarantee for this specific requirement.

### 4.4 — Log compaction (bounding memory on long-running meshes)
```javascript
// Pruning the ACTIVE RELAY working set (Bloom filter + outbox queues) ≠ deleting from durable storage.
// Old, fully-acknowledged, low-priority messages stop being actively re-gossiped,
// but remain in IndexedDB (Module 6) for local history/search.
export function pruneActiveRelaySet(bloomFilter, ageThresholdMs = 24 * 60 * 60 * 1000) {
  // In practice: periodically reconstruct a fresh, smaller Bloom filter containing only
  // message IDs younger than the threshold, and swap it in — bounding the filter's
  // false-positive growth over very long uptimes without touching durable history at all.
}
```

---

## 🔐 Module 5: Security Layer — ECDH + AES-GCM + ECDSA, All Native WebCrypto

### 5.1 — Device keypair generation & storage
```javascript
// src/crypto/keyManager.js
export async function generateDeviceKeypair() {
  const signingKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const dhKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]
  );
  return { signingKeyPair, dhKeyPair };
}
// Private keys are generated with extractable:true ONLY so they can be cached in IndexedDB
// across reloads (Module 6) — they are NEVER sent over any RTCDataChannel, ever.
```

### 5.2 — Deriving a shared secret (per-recipient, for true E2E)
```javascript
// src/crypto/ecdh.js
export async function deriveSharedKey(myPrivateDhKey, theirPublicDhKeyJwk) {
  const theirPublicKey = await crypto.subtle.importKey(
    "jwk", theirPublicDhKeyJwk, { name: "ECDH", namedCurve: "P-256" }, [], []
  );
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPublicKey },
    myPrivateDhKey,
    { name: "AES-GCM", length: 256 },
    false, ["encrypt", "decrypt"]
  );
}
```
**Critical architectural point:** this derivation happens **per recipient**, not per relay-link. A message destined for Device C, relayed through Device B, is encrypted with a key derived from A and C's keys *only*. Device B forwards ciphertext it mathematically cannot decrypt. This is what makes the "untrusted relay" security story true rather than aspirational.

### 5.3 — Encrypt / decrypt / sign / verify
```javascript
// src/crypto/cipher.js
export async function encryptPayload(sharedKey, plaintextObj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plaintextObj));
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
  return { ciphertext: toBase64(ciphertextBuf), iv: toBase64(iv) };
}

export async function decryptPayload(sharedKey, ciphertextB64, ivB64) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) }, sharedKey, fromBase64(ciphertextB64)
  );
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

export async function signMessage(privateSigningKey, dataToSign) {
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateSigningKey, new TextEncoder().encode(dataToSign)
  );
  return toBase64(sigBuf);
}

export async function verifySignature(publicSigningKeyJwk, signatureB64, dataToVerify) {
  const publicKey = await crypto.subtle.importKey(
    "jwk", publicSigningKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, [], ["verify"]
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey, fromBase64(signatureB64), new TextEncoder().encode(dataToVerify)
  );
}
```

### 5.4 — Broadcast/SOS group-key tradeoff (be ready to explain this honestly)
A targeted message can be encrypted per-recipient. A *broadcast* SOS, by definition, has no single recipient — so it uses a shared "mesh group key" agreed at first pairing. Any mesh member can decrypt it (that's the point — anyone nearby should be able to read an SOS), but it's a deliberately weaker guarantee than per-recipient E2E, since a compromised mesh member who once had the group key could theoretically read future broadcasts even after being kicked out. **State this limitation proactively in your README and pitch** — it reads as engineering maturity, not weakness.

### 5.5 — Live tamper-detection demo trick
Because every message is ECDSA-signed over its ciphertext, you can demo integrity guarantees live: open DevTools, manually flip one character in a relayed message's `ciphertext` field mid-transit (e.g., via a breakpoint), and show the receiving device's `verifySignature` call return `false` and the UI flag it as "⚠️ Tampered — message rejected" instead of silently displaying corrupted content.

---

## 💾 Module 6: Storage Layer — Zero-Dependency IndexedDB Wrapper

### 6.1 — Minimal async wrapper (no library needed)
```javascript
// src/storage/db.js
const DB_NAME = "lifeline-mesh";
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("messages")) {
        db.createObjectStore("messages", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("keys")) {
        db.createObjectStore("keys", { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMessage(db, message) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    tx.objectStore("messages").put(message);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMessages(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readonly");
    const req = tx.objectStore("messages").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

### 6.2 — Batched writes (the single highest-leverage perf fix, see Section 12.2)
Never call `putMessage` once per message synchronously inside a tight relay loop — batch writes into a single transaction:
```javascript
export async function putMessagesBatch(db, messages) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    for (const m of messages) store.put(m);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

### 6.3 — Boot-time rehydration
On app launch: load all messages from IndexedDB into the in-memory `MessageLog` (Module 4) and rebuild the Bloom filter (Module 3) from those IDs, so a refreshed page resumes exactly where it left off — durable history with fast in-memory routing, the best of both.

---

## 📲 Module 7: Service Worker & PWA Shell — True Offline-After-First-Load

### 7.1 — Cache-first install strategy
```javascript
// sw.js
const CACHE_NAME = "lifeline-mesh-v1"; // bump this string on every deploy to bust stale caches
const ASSETS = [
  "/", "/index.html", "/manifest.json",
  "/src/app.js", "/src/schema.js",
  "/src/signaling/qrSignaling.js", "/src/signaling/qrCodec.js",
  "/src/transport/peerManager.js", "/src/transport/dataChannel.js",
  "/src/routing/bloomFilter.js", "/src/routing/priorityQueue.js", "/src/routing/gossipRouter.js",
  "/src/crdt/vectorClock.js", "/src/crdt/messageLog.js",
  "/src/crypto/keyManager.js", "/src/crypto/ecdh.js", "/src/crypto/cipher.js",
  "/src/storage/db.js",
  "/src/ui/meshStatus.js", "/src/ui/chatView.js", "/src/ui/pairingView.js",
  "/icons/icon-192.svg", "/icons/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
```
**Why cache-first, not network-first:** network-first would mean the app tries (and fails) to hit the network every load before falling back to cache — adding latency and, worse, conceptually contradicting the entire "this works with zero internet" pitch. Cache-first means the very first paint after initial install never touches the network again.

### 7.2 — Manifest for true installability
```json
{
  "name": "LifeLine Mesh",
  "short_name": "LifeLine",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0f14",
  "theme_color": "#e53935",
  "icons": [
    { "src": "/icons/icon-192.svg", "sizes": "192x192", "type": "image/svg+xml" },
    { "src": "/icons/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml" }
  ]
}
```
The `theme_color` matches the SOS-red accent — small detail, reinforces "this is an emergency tool" the instant it's installed on a home screen.

### 7.3 — Registering the service worker
```javascript
// src/app.js (top of boot sequence)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
```

---

## 🖥️ Module 8: UI Layer — Minimal, Mobile-First, Demo-Optimized

### 8.1 — Component breakdown (no framework needed — vanilla DOM is faster to ship and zero-dependency)
- **`pairingView.js`** — renders the QR display canvas + camera scanner view, drives the state machine: `idle → showing-offer → scanning-answer → connected`
- **`meshStatus.js`** — peer list with 🟢🟡🔴 health dots (derived from `PeerManager`'s connection states), live-updating reachable-peer count (direct + via relay, computed from the routing layer's known-device set)
- **`chatView.js`** — message list rendered from `MessageLog.getSortedForDisplay()`, compose box with an SOS/normal/chat priority toggle

### 8.2 — Render-efficient message list (ties into Section 12 performance work)
```javascript
// src/ui/chatView.js — append-only rendering, not full re-render per message
const renderedIds = new Set();

export function renderNewMessages(container, messages) {
  for (const msg of messages) {
    if (renderedIds.has(msg.id)) continue;
    const el = document.createElement("div");
    el.className = `message message--${msg.priority}`;
    el.textContent = msg.decryptedText; // set after Module 5 decrypt step
    container.appendChild(el);
    renderedIds.add(msg.id);
  }
}
```
This avoids the classic hackathon-demo performance trap: re-rendering the *entire* message list (and re-running decrypt on already-decrypted messages) on every single incoming gossip relay, which would visibly stutter under a multi-hop burst.

### 8.3 — The SOS button — designed like an actual emergency tool
- Full-width, high-contrast red, requires a deliberate long-press or confirm step (prevents accidental triggers, a real UX consideration for a genuinely deployed safety tool — mentioning this thoughtfulness unprompted in your pitch signals product maturity beyond "just code that works")
- On send, immediately shows a clear local confirmation ("🆘 SOS broadcasting to mesh...") even before delivery confirmation — in an emergency, the sender needs instant feedback that the action registered

### 8.4 — Reframing offline state as a feature, not an apology
```javascript
function renderConnectivityBanner(isOnline) {
  return isOnline
    ? "🌐 Internet available (bonus — mesh works without it)"
    : "🟢 Mesh Mode Active — fully operational, zero internet required";
}
```
This one copywriting choice — covered in `plan.md` Phase 7.4 — is implemented here as the literal default-rendered string. Never let the UI imply something is broken when "no internet" is, for this product, the *expected and celebrated* state.

---

## ⚡ Section 12: Performance Optimization Deep-Dive

### 12.1 — Profiling methodology (do this before changing any code)
- Use Chrome DevTools **Performance** tab, record during a simulated multi-hop burst (have one device send 20 messages rapidly while 2+ relays are active)
- Use the **Memory** tab to take heap snapshots before/after a 10-minute soak test — look specifically for `Map`/`Set`/`Array` objects that should have been bounded (Bloom filter, outbox queues, relay-timestamp arrays) but are growing unbounded — this is the #1 real bug class in gossip-protocol code written under time pressure

### 12.2 — IndexedDB write batching (highest-leverage fix, expand on Module 6.2)
**The trap:** calling `putMessage()` (one transaction per call) inside the gossip router's per-message relay loop. Each `IndexedDB` transaction has real overhead — under a burst of 20 simultaneously-relayed messages, that's 20 separate transaction commits, which is measurably slower and can visibly jank the UI thread.
**The fix:** accumulate incoming messages into a small buffer, flush to IndexedDB via `putMessagesBatch()` on a short debounce (e.g., every 200ms or every 10 messages, whichever comes first) — collapses N transactions into 1 without meaningfully delaying durability.

### 12.3 — Bloom filter sizing under real constraints
Revisit Module 3.1's math: for `p=0.01` false-positive rate, bits `m ≈ -(n·ln p)/(ln2)²`. Pre-compute a small table so you can justify your chosen constant to a judge instantly:

| Expected messages (n) | Bits needed (m) | Bytes |
|---|---|---|
| 100 | ~960 | 120 B |
| 1,000 | ~9,600 | 1.2 KB |
| 10,000 | ~96,000 | 12 KB |

Even at 10,000 messages — far beyond any realistic hackathon demo — the entire dedup structure costs 12KB of memory. This number, stated confidently, kills the "but does this actually scale" question dead.

### 12.4 — Rendering performance: avoid layout thrashing
- Append-only DOM updates (Module 8.2) instead of `innerHTML = ...` re-renders, which force a full reflow/repaint of the entire message list on every new message — the difference is visually obvious under a fast multi-hop burst demo
- Batch DOM writes inside a single `requestAnimationFrame` callback if multiple messages arrive within the same tick, rather than triggering N separate reflows

### 12.5 — Debouncing non-critical UI updates
The Mesh Status panel's peer-health dots only need to repaint on actual state *changes* (connect/disconnect events), never on a fixed interval poll — wire it to the `PeerManager`'s `peer-connected`/`peer-disconnected` events directly rather than `setInterval`-based polling, which both saves CPU and is architecturally more correct (event-driven, not poll-driven).

### 12.6 — Congestion control & battery-aware duty cycling
- The `MAX_RELAYS_PER_SECOND_PER_PEER` rate limit (Module 3.3) is your primary defense against a CPU/battery spike if many peers send bursts simultaneously — tune this constant empirically during Phase 9 testing, don't guess
- Reduce heartbeat frequency (Module 2's `_startHeartbeat`) when `document.hidden` is true (tab backgrounded) — use the `visibilitychange` event to switch from a 5s to a 30s heartbeat interval, cutting needless wake-ups roughly 6x while backgrounded
- Where `navigator.getBattery()` is available (note: deprecated in some browsers, treat as a progressive enhancement, not a dependency), reduce discovery/heartbeat frequency further below a battery threshold (e.g. 20%) — small code addition, large "we thought about real deployment" impression

### 12.7 — Memory leak prevention checklist
- [ ] Every `setInterval` (heartbeats) has a matching `clearInterval` on disconnect — verified in Module 2.1's `_startHeartbeat`
- [ ] Disconnected peers are eventually pruned from `PeerManager.peers` (after a grace period for potential reconnection — don't prune instantly, but don't keep forever either)
- [ ] `relayTimestamps` map entries for permanently-gone peers get cleaned up periodically, not just filtered-on-read forever
- [ ] Old `RTCPeerConnection` objects from failed/abandoned handshake attempts are explicitly `.close()`'d, not just dereferenced (browsers don't always GC these aggressively otherwise)

### 12.8 — Cold-start optimization (ties to Module 7)
- Keep the ES module graph shallow — every extra `import` chain adds parse/eval time before first paint. At hackathon scale this is a non-issue, but explicitly avoiding a bundler/heavy framework (Module-by-module vanilla ES modules) means there is fundamentally less JS to parse than a typical SPA framework boot, and you can say so explicitly as a deliberate performance choice, not just a "no time to set up Webpack" default.

---

## 🧪 Section 13: Testing Strategy

### 13.1 — Unit tests worth writing (highest ROI for time spent)
Even without a full test framework, a few `console.assert`-based or minimal-test-runner checks pay for themselves by catching regressions during the Phase 8 integration pass:
- [ ] **CRDT merge idempotency:** `log.add(msg); log.add(msg);` → size increases by exactly 1, not 2 (tests the `messages.has()` guard in Module 4.2)
- [ ] **CRDT merge commutativity:** `logA.mergeWith(logB)` then compare to `logB.mergeWith(logA)` (on copies) → identical final message sets, in either merge order — this is the actual mathematical property that makes CRDTs trustworthy, and testing it explicitly is a strong signal in a code review
- [ ] **Bloom filter no false negatives:** add 500 random UUIDs, assert every single one returns `true` from `mightContain` — a false negative would silently break dedup correctness, which is far worse than the acceptable false-positive case
- [ ] **TTL enforcement:** craft a message with `hopCount = MAX_TTL`, assert the router drops it without relaying
- [ ] **Priority ordering:** enqueue chat, then normal, then SOS into a `PriorityQueue` — assert `dequeue()` returns SOS first despite being enqueued last

### 13.2 — Simulated multi-peer test harness (no physical devices needed for this layer)
Because `RTCPeerConnection` objects can be created and connected within a single browser tab (two `RTCPeerConnection`s can negotiate with each other purely in-memory, without ever needing two physical devices, by manually exchanging their SDP/ICE objects in JS instead of via QR), you can write an **automated 5-node mesh simulation** that runs in a single test page — invaluable for testing the gossip/CRDT logic at higher fidelity than manual physical-device testing allows, and a genuinely impressive thing to show a technical judge who asks "how did you test this."

### 13.3 — Manual QA checklist (physical-device-required scenarios)
- [ ] QR pairing succeeds 10/10 times under demo lighting conditions, at demo distance
- [ ] Full airplane-mode test on 3 real devices, multi-hop message delivery confirmed
- [ ] Mesh-island split + reconnect + CRDT convergence confirmed visually on all 3 screens simultaneously
- [ ] Kill a relay device mid-transmission — confirm no crash, confirm UI reflects degraded-but-functional state
- [ ] Tamper-detection demo (Module 5.5) triggers the expected rejection UI

### 13.4 — Chaos testing (stretch, do if time allows post-Phase-9)
- [ ] Randomly drop/reconnect peers programmatically over a 5-minute automated run, assert the system never throws an unhandled exception and message logs still converge once stable
- [ ] Simulate a "Sybil" peer that relays messages but never originates any, confirm the rest of the mesh still functions correctly around it (informs your honest answer to the malicious-peer Q&A question)

---

## 🛡️ Section 14: Security Hardening Checklist (defense-in-depth review pass)
- [ ] Private keys (`dhKeyPair.privateKey`, `signingKeyPair.privateKey`) are **never** serialized into any object that touches `RTCDataChannel.send()` — audit every `JSON.stringify` call site against the schema in Section 1
- [ ] IV (`iv`) is freshly randomly generated per-message, never reused across encryptions with the same key (reusing an IV with AES-GCM catastrophically breaks confidentiality — this is worth stating explicitly in code comments, it shows you understand *why*, not just *that*)
- [ ] Signature verification (Module 5.3) happens **before** the decrypted payload is ever rendered to the UI — reject-then-render-error, never render-then-warn
- [ ] Relay/forward logic (Module 3.3) never attempts to decrypt payloads it's merely forwarding — verify by code-reading the relay path and confirming no `decryptPayload` call exists outside the local-delivery branch
- [ ] Group key (broadcast/SOS) rotation is at minimum documented as a known limitation if not implemented — don't let a judge discover this gap themselves in Q&A
- [ ] No secrets, keys, or `.env` values are ever committed to the repo (trivially true here since there are zero API keys in this architecture at all — but state this explicitly, it's a genuine differentiator versus the AI-wrapper submissions that often *do* leak keys)

---

## 🚀 Section 15: Deployment (Free, Static, Zero-Config)

### 15.1 — GitHub Pages (recommended primary path)
```bash
# from repo root, assuming main branch
git add .
git commit -m "deploy: lifeline mesh v1"
git push origin main
# then in GitHub repo settings → Pages → set source to "main" branch, root folder
```
HTTPS is automatic on GitHub Pages — required for both WebRTC's `getUserMedia`/camera access (QR scanning) and Service Worker registration, neither of which will work over plain HTTP on a non-localhost domain.

### 15.2 — Netlify (alternative, equally free, slightly faster iteration via drag-and-drop deploy)
- Drag the project folder onto Netlify's deploy UI, or connect the GitHub repo for auto-deploy-on-push — either path is genuinely $0 on the free tier for a static site this size

### 15.3 — Pre-flight deployment checklist
- [ ] Test the live URL in an actual incognito/private window (catches stale-cache and permission-prompt issues that a logged-in dev session masks)
- [ ] Test camera permission prompt flow on the actual demo device, not just your dev laptop
- [ ] Confirm Service Worker registers and the app loads with devtools' Network tab set to "Offline" — this is your literal "does the offline-first claim actually hold" final check

---

## 📋 Section 16: README & Submission Templates

### 16.1 — Copy-paste README skeleton
```markdown
# 🛰️ LifeLine Mesh
**Serverless, offline-first emergency communication for when the internet goes down.**

## The Problem
[2-3 concrete, human sentences — disaster knocks out cell towers, people can't reach family/help]

## The Solution
LifeLine Mesh turns any phone's browser into a mesh network node — no app store, no server,
no internet required after the first load. Messages relay device-to-device via WebRTC.

## How It Works
- 📡 Discovery — QR-code-based pairing, zero signaling server
- 🔌 Transport — WebRTC DataChannels, direct device-to-device
- 🌐 Routing — gossip protocol with TTL + Bloom-filter dedup + priority queues (SOS jumps the line)
- 🧬 Consistency — CRDT message log, conflict-free merge when mesh "islands" reconnect
- 🔐 Security — end-to-end ECDH/AES-GCM encryption, ECDSA tamper detection
- 📱 App Shell — installable PWA, fully offline-capable after first load

## Tech Stack
100% native browser APIs. $0 to build. $0 to run, forever, at any scale. Zero AI/LLM dependency.

## Live Demo
[URL] · [Demo video link]

## Run It Yourself
[clone/serve instructions]

## What's Next
[2-3 stretch goals]

## Known Limitations
[1-2 honest lines]
```

### 16.2 — Devpost-style submission description template
Use the exact narrative spine sentence as your opening line, then structure the long-form description using the same section order as the README above — consistency across every surface (README, pitch deck, submission form, live pitch) compounds into a much stronger overall impression than five slightly-different stories.

---

## 📐 Section 17: Appendix — Algorithmic Complexity Reference

| Operation | Complexity | Notes |
|---|---|---|
| Bloom filter `add`/`mightContain` | O(k) where k = numHashes (constant, k=4) | Effectively O(1) |
| Priority queue `enqueue`/`dequeue` | O(1) | 3-bucket array, no heap needed at this scale |
| Gossip relay fan-out per message | O(p) where p = connected peer count | Bounded by realistic mesh size, not message count |
| CRDT G-Set `add` | O(1) amortized (Map insertion) | Idempotency check is also O(1) |
| CRDT G-Set `mergeWith` | O(m) where m = size of the *other* log being merged in | Unavoidable, but trivially parallelizable if ever needed |
| Vector clock `mergeClock` | O(d) where d = number of known devices | d stays small in realistic mesh sizes |
| AES-GCM encrypt/decrypt | O(n) in message length, hardware-accelerated in virtually all modern devices | Negligible overhead in practice |

**Closing note for your own confidence:** every number in this table is something you can recite, justify, and defend live. That, more than any single feature, is what "elite/grandmaster-level" actually looks like to a judge who's seen a hundred submissions — not flashier UI, but visible command of *why* every decision was made.


