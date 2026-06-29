# LifeLine Mesh

**Serverless, offline-first emergency communication for when the internet goes down.**

When disasters knock out cell towers or governments shut down the internet, people can't reach help or find their families. LifeLine Mesh turns any phone's browser into a mesh network node — no app store, no server, no internet required after the first load.

## How It Works

Six layers, each mapping to a folder under `src/`:

- Discovery — QR-code-based pairing using a custom QR code generator (GF(256) + Reed-Solomon ECC). Zero signaling server.
- Transport — WebRTC `RTCPeerConnection` + `RTCDataChannel` direct device-to-device links with automatic heartbeats and graceful disconnect handling.
- Routing — Epidemic gossip protocol with TTL flood prevention, Bloom-filter-based deduplication, and a 3-tier priority queue (SOS messages always jump the line).
- Consistency — Operation-based CRDT (G-Set) message log with vector clocks for causal ordering. Conflict-free merge when mesh "islands" reconnect.
- Security — Per-link ECDH (P-256) key exchange, AES-GCM end-to-end encryption, and ECDSA message signing with live tamper detection.
- Storage — IndexedDB for durable message history with batched write optimization and boot-time rehydration.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| P2P Transport | WebRTC (`RTCPeerConnection` / `RTCDataChannel`) |
| Signaling | QR code manual SDP exchange (custom GF(256) encoder) |
| Encryption | WebCrypto `SubtleCrypto` (ECDH + AES-GCM + ECDSA) |
| Local Storage | IndexedDB |
| Offline Shell | Service Worker + Cache API |
| QR Scanning | Native `BarcodeDetector` API |
| Hosting | Static hosting (GitHub Pages / Netlify) |
| Build | None required — vanilla ES modules |

100% native browser APIs. **$0 to build. $0 to run, forever, at any scale.** Zero AI/LLM dependency.

## Live Demo

[Live URL — coming soon]

## Run It Yourself

```bash
# Clone the repo
git clone https://github.com/louji2308/Lifeline-Mesh.git
cd Lifeline-Mesh

# Serve locally (any static file server works)
npx serve .
# Or: python -m http.server 8080
```

Open `http://localhost:3000` (or the port `serve` gives you). WebRTC and camera access require either `localhost` or HTTPS — the app will not work over plain HTTP on a non-localhost address.

To test across multiple devices, deploy to GitHub Pages or use a tunnel like `ngrok`.

### Multi-Device Test

1. Open the app on Device A. Tap **Pair Device** → **Show My QR Code**.
2. On Device B, tap **Pair Device** → **Scan QR Code**. Point at Device A's screen.
3. After scan, Device B shows a QR code. On Device A, tap **Scan Their Response** and scan B's code.
4. Once paired, type a message on either device — it appears on the other.

For three devices, pair A↔B and B↔C. Messages from A reach C via relay through B.

## Project Structure

```
├── index.html                 # Single entry point — loads app.js as ES module
├── manifest.json               # PWA manifest
├── sw.js                       # Service Worker — offline cache-first
├── icons/                      # App icons (SVG)
├── tests/                      # Unit tests (run in browser)
└── src/
    ├── app.js                  # Boot sequence, wires all modules
    ├── schema.js               # Message schema, helpers, validators
    ├── signaling/
    │   ├── qrSignaling.js      # WebRTC offer/answer exchange
    │   ├── qrCodec.js          # QR rendering + compression wrapper
    │   └── qrEncoder.js        # Full QR code generator (GF(256), RS)
    ├── transport/
    │   ├── peerManager.js      # Multi-peer connection lifecycle
    │   └── dataChannel.js      # Message framing over DataChannel
    ├── routing/
    │   ├── bloomFilter.js      # Bloom filter deduplication
    │   ├── priorityQueue.js    # 3-tier (SOS/normal/chat) relay queue
    │   └── gossipRouter.js     # Core relay and forward engine
    ├── crdt/
    │   ├── vectorClock.js      # Causal clock helpers
    │   └── messageLog.js       # G-Set CRDT with merge
    ├── crypto/
    │   ├── keyManager.js       # Device keypair generation and storage
    │   ├── ecdh.js             # Shared secret derivation (P-256)
    │   └── cipher.js           # AES-GCM encrypt/decrypt + ECDSA sign/verify
    ├── storage/
    │   └── db.js               # IndexedDB wrapper with write batching
    └── ui/
        ├── meshStatus.js       # Peer list and connection health
        ├── chatView.js         # Message list and compose box
        └── pairingView.js      # QR display and scanner
```

## What's Next

- LAN/Wi-Fi auto-discovery — instant peer discovery on shared networks
- Multi-frame QR for larger SDP payloads at higher error-correction levels
- Native Bluetooth Low Energy relay for truly off-grid range extension

## Known Limitations

- All messages use a shared mesh group key (AES-GCM 256-bit) — there is no per-recipient E2E encryption. Any mesh member can decrypt all traffic. This is a design tradeoff for the fully-connected mesh model and is accepted for emergency use.
- Message history is stored as ciphertext-only in IndexedDB; plaintext is never written to disk.
- Full Sybil-resistance and group-key rotation are future work.
- QR scanning relies on the native `BarcodeDetector` API (Chromium-based browsers). Firefox and Safari fall back to camera preview without detection — QR remains scannable by the other device's camera.

## License

[MIT](LICENSE)
