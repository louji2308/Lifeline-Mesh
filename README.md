# 🛰️ LifeLine Mesh

**Serverless, offline-first emergency mesh communication network.**
When disasters knock out cell towers, LifeLine Mesh lets people send help requests and coordinate — with zero infrastructure, zero servers, and zero cost. Every phone becomes part of the network itself.

## The Problem

When disasters strike — earthquakes, hurricanes, protests, or internet blackouts — cell towers fail, servers go down, and people lose the ability to call for help or coordinate with each other. Existing solutions require infrastructure that's exactly what got knocked out.

## The Solution

LifeLine Mesh turns any phone's browser into a mesh network node. No app store. No server. No internet required after the first load. Messages relay device-to-device via WebRTC, automatically routing around failed connections.

```
Phone A ────→ Phone B ────→ Phone C
  (out of range, but message arrives
   via relay through Phone B)
```

## How It Works

- **📡 Discovery** — QR-code-based pairing. Zero signaling server. Devices exchange WebRTC connection info by showing and scanning QR codes on their screens.
- **🔌 Transport** — WebRTC DataChannels for direct device-to-device communication. Encrypted by default (DTLS).
- **🌐 Routing** — Epidemic gossip protocol with TTL (8 hops), Bloom-filter deduplication (8192 bits, 4 hashes), and a 3-tier priority queue (SOS > normal > chat).
- **🧬 Consistency** — CRDT (Grow-only Set) message log with vector clocks. When mesh "islands" reconnect, message histories merge automatically with zero conflicts and zero data loss.
- **🔐 Security** — End-to-end encryption via ECDH (P-256) key exchange + AES-GCM (256-bit). Every message is ECDSA-signed for tamper detection. Relay nodes mathematically cannot decrypt payloads they forward.
- **📱 App Shell** — Installable PWA with cache-first Service Worker. Fully offline-capable after first load. Zero install friction.

## Tech Stack

| Layer | Technology | Cost |
|---|---|---|
| P2P Transport | WebRTC `RTCPeerConnection` / `RTCDataChannel` | $0 |
| Signaling | Manual QR-code SDP exchange (no server) | $0 |
| Encryption | WebCrypto `SubtleCrypto` (ECDH + AES-GCM + ECDSA) | $0 |
| Storage | IndexedDB | $0 |
| Offline Shell | Service Worker + Cache API | $0 |
| QR Handling | Native `BarcodeDetector` API + canvas fallback | $0 |
| Hosting | GitHub Pages / Netlify (static files only) | $0 |
| Build Tooling | None — vanilla ES modules | $0 |

**There is no backend. There is no bill. Every byte of compute, storage, and bandwidth is donated by the end-user's device, forever, at any scale.**

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer                          │
│  (MeshStatus · ChatView · PairingView)              │
├─────────────────────────────────────────────────────┤
│                  Routing Layer                       │
│  (GossipRouter · BloomFilter · PriorityQueue)        │
├─────────────────────────────────────────────────────┤
│               CRDT Consistency Layer                 │
│  (MessageLog G-Set · VectorClock)                   │
├─────────────────────────────────────────────────────┤
│               Security Layer                         │
│  (KeyManager · ECDH · AES-GCM · ECDSA)              │
├─────────────────────────────────────────────────────┤
│              Transport Layer                         │
│  (PeerManager · RTCDataChannel)                     │
├─────────────────────────────────────────────────────┤
│             Discovery Layer                          │
│  (QR Signaling · QR Codec)                          │
├─────────────────────────────────────────────────────┤
│          Storage Layer (IndexedDB)                   │
│  + PWA Shell (Service Worker)                       │
└─────────────────────────────────────────────────────┘
```

## Live Demo

[Demo URL — deploy to GitHub Pages or Netlify](#)

## Run It Yourself

```bash
# Clone the repo
git clone https://github.com/louji2308/Lifeline-Mesh.git
cd Lifeline-Mesh

# Serve locally (no build step needed)
npx serve .
# Or: python -m http.server 8080
# Or: use VS Code Live Server extension
```

Then open `http://localhost:3000` (or the port serve gives you) in any modern browser. Open it on 2+ devices on the same network, pair via QR codes, and start sending messages.

**Important:** WebRTC camera access (for QR scanning) and Service Workers require HTTPS or `localhost`. For testing on physical devices over the same Wi-Fi, use `localhost` on your dev machine and access the IP directly.

## Tests

Open `tests/index.html` in a browser to run the unit test suite:

- Bloom Filter: dedup correctness, false-negative rate, export/import, optimal param sizing
- Priority Queue: SOS-first ordering, draining, bucket stats
- Vector Clocks: increment, merge, happened-before, concurrency detection
- CRDT G-Set: idempotent add, commutative merge, serialization round-trip, pruning

## What's Next

- **True Bloom filter sizing at scale** — dynamic filter resizing based on measured false-positive rate
- **Map view** — visual mesh topology showing live peer positions and relay paths
- **SOS broadcast mode** — one-tap emergency alert that propagates at maximum priority
- **Group key rotation** — periodic re-keying for broadcast channel forward secrecy
- **Bluetooth Low Energy mesh** — native wrapper for true off-grid communication beyond WebRTC range

## Known Limitations

- QR pairing requires physical proximity (screen-to-camera) — a reasonable constraint for disaster/off-grid scenarios where devices are co-located
- Broadcast SOS uses a shared group key (weaker than per-recipient E2E) — appropriate for "anyone nearby should read this" but documented as a known tradeoff
- Full Sybil-resistance is not yet implemented — malicious devices can join the mesh but cannot forge or read encrypted messages

## License

MIT — see [LICENSE](./LICENSE)
