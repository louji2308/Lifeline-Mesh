# LifeLine Mesh — Architecture Decision Record

## Overview
Serverless, offline-first P2P emergency mesh communication network.
Every browser becomes a node. Zero infrastructure. Zero cost.

## Six-Layer Architecture

### 1. Discovery Layer — QR-Based Manual Signaling
- **Strategy:** Manual QR-code-based WebRTC offer/answer exchange
- **Why:** Eliminates the single point of failure (signaling server) that every other WebRTC system depends on
- **Tradeoff:** Requires physical proximity for initial pairing — acceptable for disaster/off-grid scenarios

### 2. Transport Layer — WebRTC DataChannels
- **Strategy:** `RTCPeerConnection` + `RTCDataChannel` per peer link
- **Management:** `PeerManager` class — `Map<peerId, {pc, dataChannel, state}>`
- **Lifecycle:** Event-driven state machine (connecting → connected → disconnected → failed)
- **Heartbeat:** 5s interval ping over data channel for silent-failure detection

### 3. Routing Layer — Epidemic Gossip Protocol
- **Strategy:** Flood-based gossip with TTL + Bloom-filter dedup + priority queue
- **TTL:** `MAX_TTL = 8` hops — prevents infinite propagation
- **Dedup:** Bloom filter (8192 bits, 4 hashes) — space-efficient duplicate detection
- **Priority:** 3-tier queue — SOS > normal > chat
- **Rate limit:** 20 relays/second/peer — congestion & battery protection

### 4. Consistency Layer — CRDT G-Set with Vector Clocks
- **Strategy:** Grow-only Set CRDT — merge is set union, conflict-free by construction
- **Clock:** Vector clock per device for causal UI ordering
- **Merge:** Idempotent, commutative, convergent — split-brain reconciliation demo
- **Compaction:** Old messages pruned from active relay set, retained in durable storage

### 5. Security Layer — ECDH + AES-GCM + ECDSA
- **Key Exchange:** ECDH (P-256) per-link, with device-ID verification derived from signing public key
- **Encryption:** AES-GCM 256-bit — group key for all mesh messages (broadcast-only model, no per-recipient E2E)
- **Signing:** ECDSA over ciphertext — tamper detection without trusted third party
- **IV:** Freshly generated per-message — never reused with same key

### 6. Storage Layer — IndexedDB
- **Strategy:** Durable offline storage, boot-time rehydration into in-memory state
- **Object stores:** `messages` (keyed by message ID), `keys` (keyed by name)
- **Batching:** Write buffer with 200ms debounce for high-throughput relay bursts

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Build tooling | None (vanilla ES modules) | Zero build failures at 4am |
| Framework | None (vanilla DOM APIs) | Smaller payload, faster boot, no dependency churn |
| QR library | Native `BarcodeDetector` API + canvas fallback | Zero npm dependencies |
| CRDT type | G-Set over OR-Set/LWW | Simplest correct CRDT — append-only message log |
| Bloom filter vs Set | Real Bloom filter with capped-Set fallback | Genuine distributed-systems engineering at minimal complexity cost |
| Group key for SOS | Yes | Necessary tradeoff for broadcast — documented limitation |

## Security Properties
- **Confidentiality:** All messages encrypted with a shared mesh group key (AES-GCM 256-bit). Any mesh member can decrypt all traffic — this is an accepted tradeoff for the broadcast mesh model.
- **Integrity:** ECDSA signatures detect any tampering in transit. Device identity is cryptographically verified during key exchange (ID derived from signing public key).
- **Forward secrecy:** Not implemented (key rotation is future work — documented limitation)
- **Sybil resistance:** Not implemented (future work — documented limitation)

## Cost Analysis
- **Build cost:** $0 (100% native browser APIs, no paid services)
- **Run cost:** $0 (no backend — every compute/storage/bandwidth cost is borne by end-user's device)
- **Hosting:** Free tier GitHub Pages or Netlify — static files only
