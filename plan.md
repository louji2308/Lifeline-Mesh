# 🛰️ LifeLine Mesh — Master Hackathon Execution Plan
### Serverless, Offline-First, Zero-Cost Emergency Mesh Communication Network
**Document type:** Strategic phase-by-phase execution plan (the "what to do, in what order, and why")
**Companion document:** `Implement.md` (the "exact code, architecture, and optimization" deep-dive)

---

## 📖 How to use this document

This plan is written as a **timeline of phases**, each broken into **granular steps**. Every step has:
- ✅ A concrete deliverable (something that exists when the step is done — a file, a working demo, a passing test)
- ⏱️ A time-box (so you never rabbit-hole)
- 🎯 A "why this matters to judges" note (so every hour you spend maps directly to points)

Treat this like a flight checklist, not a suggestion. Hackathons are lost in the last 6 hours when teams realize they have no working demo and no story — this plan exists to make that impossible.

---

## ⏳ Duration-Agnostic Scaling Table

You didn't tell me (and I'm not assuming) your exact hackathon length. This plan is written against a **48-hour build window** as the reference timeline, but here's how to compress or stretch it:

| Your hackathon length | How to adapt |
|---|---|
| **24 hours** | Compress Phases 1–7 into the first 16 hours (skip sleep block, cut Stretch Goals entirely, cut Phase 5 CRDT down to "last-write-wins" instead of full vector clocks). Demo prep shrinks to 1 hour. |
| **36 hours** | Use this plan almost as-is, just remove the 6-hour sleep buffer in Phase 8 and compress Phase 9 (perf pass) to 3 hours. |
| **48 hours** (reference) | Use this plan exactly as written below. |
| **72 hours / weekend** | Add a second perf+polish pass, and use the extra time to build the Stretch Goals (map view, SOS broadcast mode) — these become your differentiation layer. |
| **5–7 day / async online hackathon** | Stretch each phase by ~2.5x, add daily "demo to yourself" checkpoints at the end of every day (Phase checkpoints become daily standups with yourself), and use the extra slack for the polish items in Phase 9 + a proper recorded demo video with editing. |

**Rule of thumb:** Whatever your total time `T` is, allocate roughly: `35% architecture+core build, 25% feature layers (routing/CRDT/crypto), 15% UI/PWA shell, 10% testing, 10% performance polish, 5% demo+submission packaging`. This plan already follows that ratio at 48h — just scale the hour numbers.

---

## 🧠 Part 0: Hackathon Meta-Strategy (read this before touching code)

### How judges actually score (the unspoken rubric)
Almost every hackathon — whether they say so explicitly or not — scores on some version of:
1. **Innovation / Originality** — Is this different from the 50 other CRUD-app-with-a-chatbot submissions?
2. **Technical Complexity / Execution** — Did they actually build something hard, or fake it?
3. **Real-World Impact** — Does this solve a problem that matters, for real people?
4. **Completion / Polish** — Does the demo actually work live, or is it "imagine if this worked"?
5. **Presentation** — Can they explain it crisply in the time given?

**Your unfair advantage:** Because AI/LLM API usage is banned in this hackathon, the playing field just collapsed to pure engineering skill. Most competitors' muscle memory is "wrap an API call." You're building distributed systems, cryptography, and conflict-free data structures — categories 1, 2, and 3 are won the moment your architecture is understood, *before* judges even see a UI.

### The "narrative spine" you will repeat constantly
Every phase below ladders up to one sentence you should be able to say in your sleep by Hour 48:

> *"LifeLine Mesh lets people send help requests and coordinate during disasters, protests, or internet blackouts — with zero infrastructure, zero servers, and zero cost, because every phone becomes part of the network itself."*

Write this sentence on a sticky note. Every commit, every feature decision, every minute of demo time either supports this sentence or gets cut.

### Time-allocation law
> **Never let polish-time cannibalize core-function time, and never let core-function time run so long that polish-time disappears.** A working ugly demo beats a broken beautiful one, 100% of the time, in every hackathon ever judged.

---

## 🏗️ PHASE 0 — Pre-Build Prep (Before the Clock Starts)
**Time-box:** Do this in the hours/days before kickoff, on your own time — this is 100% fair game and separates serious builders from people who start from a blank folder at Hour 0.

### Step 0.1 — Environment setup ✅
- [ ] Install Node.js (LTS) + a code editor (VS Code recommended) — for local dev server only, not required at runtime
- [ ] Install `git` and create a **private** GitHub repo named `lifeline-mesh` (keep it private until submission rules allow public, many hackathons require code to be written *during* the event — see Step 0.2)
- [ ] Confirm your browser supports: WebRTC, WebCrypto, Service Workers, IndexedDB (any modern Chrome/Firefox/Edge/Safari does — this is the entire point, zero install for end users)
- [ ] Set up a free GitHub Pages or Netlify free-tier deployment pipeline (test it with a "Hello World" `index.html` *now*, so Hour 47 isn't spent debugging deployment)

### Step 0.2 — ⚠️ Read the rules on pre-work (critical, do not skip)
- [ ] Re-read your hackathon's rules specifically for: "Can I plan/research before the event? Can I write boilerplate before kickoff? Must all code be written during the event window?"
- [ ] **Default safe assumption if unclear:** Architecture diagrams, this plan, learning resources, and environment setup = always fine. Actual feature code = wait until the official start, OR clearly document a "pre-hackathon" vs "during-hackathon" git commit boundary so judges can verify timeline integrity. Integrity here protects you — disqualification for rule violations is the only unrecoverable failure mode in this entire plan.

### Step 0.3 — Pre-learn the 4 unfamiliar APIs (knowledge prep, not code prep)
Spend 30–45 min each skimming docs/examples for, so Hour 2 isn't spent reading documentation instead of building:
- [ ] WebRTC `RTCPeerConnection` + `RTCDataChannel` (manual/offline signaling pattern — this is the one almost nobody knows how to do without a signaling server)
- [ ] WebCrypto `SubtleCrypto` — `generateKey` (ECDH), `deriveKey`, `encrypt`/`decrypt` (AES-GCM)
- [ ] IndexedDB basic CRUD (or a tiny zero-dependency wrapper pattern)
- [ ] Service Worker lifecycle (`install`, `activate`, `fetch` events) + Cache API

### Step 0.4 — Prep your "go-bag" assets (non-code, zero rule risk)
- [ ] Project name + one-line pitch finalized (use the narrative spine sentence above)
- [ ] Logo/icon — even a simple geometric SVG (mesh-node motif: dots connected by lines) takes 10 minutes in any free vector tool and massively boosts perceived polish
- [ ] A README template skeleton (sections only, no content) ready to fill in
- [ ] A blank slide template for the pitch deck (5–7 slides, see Phase 11)
- [ ] Bookmark 2–3 free public STUN servers (e.g. Google's `stun:stun.l.google.com:19302`) for the rare partial-internet ICE negotiation case

### Step 0.5 — Mental model lock-in
- [ ] Sketch (on paper, whiteboard, or in your head) the 6 layers from the architecture: Discovery → Transport → Routing → Consistency (CRDT) → Security → App Shell. Be able to explain why each layer exists and what breaks if you remove it. Judges will ask "why not just use X instead" — Phase 12 preps your answers, but Phase 0 is where you build the intuition.

---

## 🚀 PHASE 1 — Hour 0–2: Kickoff, Repo Scaffolding & Architecture Lock-In
**Goal:** Go from empty repo to a running (even if empty) PWA shell deployed live, before writing a single feature.

### Step 1.1 — Initialize repo structure (15 min)
- [ ] `git init`, push empty repo, set default branch protections off (solo dev, no need for PR ceremony — speed matters more than process right now)
- [ ] Create the folder skeleton (full tree detailed in `Implement.md` Section 2) — having folders before files prevents "where does this go" friction later
- [ ] Add `.gitignore` (node_modules, .env, build artifacts)

### Step 1.2 — Zero-build dev setup (20 min)
- [ ] Decide: **vanilla JS + ES modules, no bundler** (recommended for hackathon speed — zero build step means zero "why won't it build at 4am" disasters) OR a minimal Vite setup if you want hot-reload comfort. Either is $0. This plan assumes vanilla ES modules; `Implement.md` gives both paths.
- [ ] Get a static file server running locally (`npx serve` or Python's `http.server` — note WebRTC/SW need either `localhost` or HTTPS, never plain HTTP on a non-localhost IP)

### Step 1.3 — Deploy a "hello mesh" skeleton immediately (30 min)
- [ ] Push a bare `index.html` + empty `manifest.json` + empty `sw.js` to GitHub Pages/Netlify
- [ ] Confirm it loads on your phone over real mobile data (not just localhost) — this single step prevents a Phase-11 deployment panic
- [ ] 🎯 **Why this matters to judges:** "We had a deployed, installable URL from Hour 1" is a credibility signal that you run engineering like a professional, not a script-kiddie scramble

### Step 1.4 — Lock the architecture decisions (45 min)
Write these decisions down in `ARCHITECTURE.md` (judges and teammates love seeing decision rationale, and future-you at Hour 40 will thank present-you):
- [ ] **Signaling strategy:** Manual QR-code-based WebRTC offer/answer exchange (zero server, this is the centerpiece trick — detailed fully in `Implement.md` Module 1)
- [ ] **Routing strategy:** Epidemic/gossip protocol with TTL + Bloom-filter dedup + priority queue (detailed in Module 3)
- [ ] **Consistency strategy:** Operation-based CRDT log with vector clocks (Module 4)
- [ ] **Security strategy:** Per-link ECDH (P-256) → AES-GCM for payloads (Module 5)
- [ ] **Storage strategy:** IndexedDB for the durable message/CRDT log, in-memory Maps for hot-path routing state (Module 6)
- [ ] **UI strategy:** Minimal, accessible, mobile-first, ships as an installable PWA (Module 8)

### Step 1.5 — Define your message schema (30 min)
This is the single most important artifact in the whole project — get it right now, everything else builds on top:
- [ ] Lock the wire format fields: `id` (UUID), `senderId`, `vectorClock`, `priority` (`SOS` / `normal` / `chat`), `ttl`, `hopCount`, `timestamp`, `encryptedPayload`, `signature`
- [ ] Document it in `Implement.md` Section 1 as the canonical reference

**🏁 Phase 1 Exit Criteria:** Deployed empty PWA shell is live at a real URL, loads on a real phone, architecture decisions are written down, message schema is locked.

---

## 🔌 PHASE 2 — Hour 2–6: Core P2P Transport Layer (The Hardest, Highest-Value Part)
**Goal:** Two browser tabs/devices can exchange a message directly over WebRTC with **zero server involved at any point**, including signaling.

### Step 2.1 — Build the manual signaling exchange (90 min)
This is the trick that makes the entire project serverless. WebRTC normally needs a signaling server to exchange "offer/answer" session descriptions before a direct connection forms — you're replacing that server with **QR codes**.
- [ ] Implement "create offer" flow: Peer A creates an `RTCPeerConnection`, creates a data channel, generates an SDP offer, and serializes it (compress it — raw SDP is verbose, see optimization step 2.4) into a QR code on-screen
- [ ] Implement "scan & answer" flow: Peer B scans A's QR (camera + a free, native browser `BarcodeDetector` API, or a tiny zero-dependency QR decode routine), sets it as the remote description, generates an SDP answer, shows *that* as a QR
- [ ] Implement "complete handshake" flow: Peer A scans B's answer QR, sets it as remote description → ICE negotiation completes → DataChannel opens
- [ ] 🎯 **Why this matters to judges:** This is the single hardest technical flex in the whole build. Most developers have never set up WebRTC without Firebase/a signaling server. Doing it with QR codes is memorable, demoable, and impossible to fake.

### Step 2.2 — Validate raw message passing (30 min)
- [ ] Send a plain text string A → B over the open DataChannel, confirm receipt, log round-trip latency
- [ ] Test on 2 separate physical devices (not 2 tabs on one laptop — Wi-Fi/Bluetooth-proximate signaling quirks only show up cross-device)

### Step 2.3 — Handle connection lifecycle robustly (45 min)
- [ ] Handle `RTCPeerConnection` `connectionstatechange`/`iceconnectionstatechange` events: detect `connected`, `disconnected`, `failed`, `closed`
- [ ] Implement reconnection logic: if a peer drops, don't crash the app — mark that edge as dead, keep functioning with remaining peers (mesh networks must degrade gracefully, this is a judge-visible resilience story)
- [ ] Add a lightweight heartbeat/ping over the data channel every N seconds to detect silent failures (TCP-style connections can look "open" while dead)

### Step 2.4 — Optimize the QR handshake payload (30 min) — *Performance pass embedded early, on purpose*
- [ ] Strip unnecessary SDP fields, or better: only QR-encode the minimal ICE candidate + fingerprint info needed (full detail in `Implement.md` Section 12)
- [ ] Use a denser QR error-correction level only if needed; prefer **multiple smaller QR frames** over one giant unreadable QR if payload is large (test this with you holding a phone at a believable demo distance!)
- [ ] 🎯 **Why this matters:** A QR code that's too dense to scan reliably on stage will sink your demo. Test this now, not at Hour 47.

### Step 2.5 — Multi-peer connection management (45 min)
- [ ] Build a `PeerManager` class that holds a `Map<peerId, RTCPeerConnection>` — this becomes the foundation the routing layer (Phase 4) sits on top of
- [ ] Confirm 3 devices can pair up pairwise (A↔B, B↔C) — you do **not** need A↔C direct; that's exactly what the mesh/relay logic in Phase 4 is for

**🏁 Phase 2 Exit Criteria:** 3 physical devices, zero internet/server, pairwise-connected via QR handshakes, can send raw strings directly peer-to-peer with graceful disconnect handling.

---

## 📡 PHASE 3 — Hour 6–10: Discovery Layer (Making Pairing Effortless)
**Goal:** Reduce friction for getting devices onto the mesh — QR pairing is the universal fallback, but same-network discovery should be near-instant.

### Step 3.1 — LAN/same-hotspot auto-discovery (90 min)
- [ ] When devices share a Wi-Fi network or one device is hosting a local hotspot (very common in disaster scenarios — one phone with battery left becomes the hub), use a lightweight local broadcast: a tiny WebSocket-free trick — actually since there's no server allowed, use **mDNS-style discovery is not available to browser JS directly**, so implement the realistic browser-safe alternative: a local "rendezvous" page served from one peer's own machine (Service-Worker-hosted) that other devices on the same LAN hit via a known local IP/port, *or* simpler and more robust for a demo: keep QR as primary, and add a "Same Wi-Fi Quick Connect" mode using `WebRTC` local ICE candidates only (no STUN needed) once an initial QR-paired bootstrap node exists
- [ ] Document this honestly as a "best-effort convenience layer" — QR pairing is the guaranteed, zero-dependency path and should always be presented first in the demo

### Step 3.2 — Bootstrap node concept (45 min)
- [ ] Implement the idea that any already-paired device can introduce a *new* device into the existing mesh: new device QR-pairs with just **one** existing mesh member, and routing (Phase 4) handles reaching everyone else — this is the "introduce a friend" growth model real mesh networks use
- [ ] Build a tiny on-screen "Mesh Status" panel: number of direct peers, number of mesh members reachable (including via relay), connection health indicator (🟢🟡🔴 per peer)

### Step 3.3 — Reconnection & roaming (45 min)
- [ ] Handle the real-world case: a phone walks out of range, then walks back in range later — it should re-pair (re-scan QR, or auto-reconnect if `RTCPeerConnection` ICE restart succeeds) and have its CRDT log reconcile automatically (this hands off cleanly into Phase 5)

### Step 3.4 — Discovery UX polish (30 min)
- [ ] Big, obvious "Pair a Device" button → opens camera scanner directly (minimize taps, this is a stage-demo-critical interaction)
- [ ] Clear visual state machine on screen: `Idle → Showing My QR → Scanning Their QR → Connecting → Connected ✅`

**🏁 Phase 3 Exit Criteria:** A brand-new 4th device can join an existing 3-device mesh by scanning just ONE existing member's QR, and shows up as reachable (even if not directly connected) to the other two.

---

## 🌐 PHASE 4 — Hour 10–16: Routing Layer (Gossip Protocol — Your Technical Centerpiece)
**Goal:** A message sent by Device A reaches Device C even when A and C have never directly connected, by hopping through B — without flooding the network into chaos.

### Step 4.1 — Implement TTL + hop-count message envelope (30 min)
- [ ] Every message carries `ttl` (max hops remaining, e.g. start at 8) and `hopCount` (incremented each relay)
- [ ] On receipt: if `hopCount >= ttl`, drop silently (prevents infinite propagation in cyclic mesh topologies)

### Step 4.2 — Implement Bloom-filter-based deduplication (90 min) — *the anti-flood mechanism*
- [ ] Each peer maintains a rolling Bloom filter (or simple bounded `Set` with LRU eviction for smaller demo-scale meshes — see `Implement.md` Section 12 for the math on when you need a true Bloom filter vs. when a capped Set is fine) of message IDs it has already seen/forwarded
- [ ] On receiving any message: check filter → if seen, drop (do NOT re-relay) → if new, add to filter, process it, then relay to all *other* connected peers (never echo back to the sender)
- [ ] 🎯 **Why this matters to judges:** This is THE mechanism that separates "toy P2P demo" from "actual distributed systems engineering." Explaining Bloom filters and flood-avoidance unprompted in your pitch is a grandmaster-tier signal.

### Step 4.3 — Implement priority-based relay queue (60 min)
- [ ] Tag every outgoing message with `priority`: `SOS` (highest) > `normal` > `chat` (lowest)
- [ ] Maintain a per-peer outgoing priority queue (simple 3-bucket array is enough — no need for a heap at hackathon scale) so that if bandwidth/CPU is constrained, SOS messages always drain first
- [ ] 🎯 **Why this matters:** This single feature *is* your "real-world impact" story made concrete — in an actual disaster, a "send help now" message must never sit behind 40 chat messages.

### Step 4.4 — Implement the relay/forward engine (60 min)
- [ ] Core loop: `onMessageReceived(msg, fromPeerId) → dedup check → local delivery (if for me or broadcast) → forward to all connected peers except fromPeerId, respecting priority queue and TTL`
- [ ] Add basic congestion control: cap relay fan-out rate per peer (e.g., max N forwards/second) to avoid saturating a low-power device's radio/CPU — note this in `Implement.md` Section 12 as a battery-life optimization too

### Step 4.5 — Multi-hop integration test (45 min)
- [ ] Physically set up A↔B↔C (A and C NOT directly connected), send a normal message and an SOS message from A, confirm both arrive at C, confirm SOS doesn't get stuck behind queued chat traffic
- [ ] Kill B mid-relay, confirm the system doesn't crash (graceful degradation messaging in the UI: "Peer lost, mesh partially reachable")

**🏁 Phase 4 Exit Criteria:** 3+ devices in a line topology (no full mesh), messages successfully multi-hop, duplicate relay storms don't happen, SOS messages provably jump the queue.

---

## 🧬 PHASE 5 — Hour 16–22: CRDT Consistency Layer (Conflict-Free Reconciliation)
**Goal:** When two "islands" of the mesh (each operating independently, possibly offline from each other for a while) reconnect, their message histories merge with **zero conflicts and zero data loss** — no central source of truth ever existed.

### Step 5.1 — Implement vector clocks (60 min)
- [ ] Each device maintains a vector clock: `{ deviceA: 3, deviceB: 1, deviceC: 0 }` — incremented on every local event
- [ ] Attach the sender's current vector clock snapshot to every message

### Step 5.2 — Implement the operation-based CRDT log (90 min)
- [ ] Model the message history as a **Grow-only Set (G-Set) CRDT** of operations (simplest CRDT that's still genuinely correct and impressive — `Implement.md` Section 1 covers why G-Set is the right choice over OR-Set/LWW-Register for this use case, plus how to upgrade later)
- [ ] Merge rule: union of two G-Sets is trivially conflict-free (this is the "boring but correct" superpower of CRDTs — no merge conflicts are even possible by construction)
- [ ] Use vector clocks for **causal ordering in the UI** (so messages render in a sensible chronological/causal order) even though the underlying storage merge needs no ordering logic at all

### Step 5.3 — Implement log compaction/pruning (45 min)
- [ ] Old, fully-propagated, low-priority messages (e.g., chat older than 24h that every known peer has acknowledged) get pruned from the *active relay set* to bound memory — but stay in durable IndexedDB storage for history. This is a real performance concern in long-running mesh networks and shows you've thought past the demo.

### Step 5.4 — Reconciliation test (45 min)
- [ ] Split your 3-device mesh into two physically separated islands (A alone, B+C together) for a few minutes, generate messages on both sides, then bring A back into range of B
- [ ] Confirm: after reconnection, all 3 devices converge to the exact same merged message set, with zero duplicates, zero loss, zero manual conflict resolution
- [ ] 🎯 **Why this matters to judges:** This is the demo moment that gets an audible reaction. "Split-brain reconciliation" is a phrase senior distributed-systems engineers use — say it in your pitch.

### Step 5.5 — Persist CRDT state across reloads (30 min)
- [ ] Wire the CRDT log to IndexedDB (Module 6) so a page refresh/app relaunch doesn't lose history — re-hydrate vector clock + G-Set on boot

**🏁 Phase 5 Exit Criteria:** Two independently-operating mesh islands, after being separated and generating divergent message histories, reconnect and converge to an identical, lossless, conflict-free merged state automatically.

---

## 🔐 PHASE 6 — Hour 22–28: Security Layer (End-to-End Encryption Over Untrusted Relays)
**Goal:** Relay peers can forward messages they cannot read. Only the intended recipient(s) can decrypt. This matters enormously for the "censorship resistance" and "protest coordination" use case.

### Step 6.1 — Per-link key exchange (60 min)
- [ ] On every new direct WebRTC connection, perform an ECDH key exchange (WebCrypto `generateKey({ name: "ECDH", namedCurve: "P-256" })`) to derive a shared symmetric key for that *link* (used to optionally encrypt hop-by-hop metadata, separate from the end-to-end payload encryption below)

### Step 6.2 — End-to-end payload encryption (90 min)
- [ ] For direct messages: sender encrypts payload with a key derived from a ECDH exchange with the *recipient* (not just the next hop) using AES-GCM — relays only ever see ciphertext + routing metadata (sender/recipient IDs, priority, TTL), never plaintext
- [ ] For broadcast/SOS messages (no single recipient): use a pre-shared "mesh group key" established at first pairing, so any mesh member can decrypt but external eavesdroppers on the radio layer cannot — document this tradeoff honestly (group key = weaker guarantee than per-recipient E2E, appropriate for "broadcast SOS to anyone nearby" use case)

### Step 6.3 — Message signing & integrity (45 min)
- [ ] Sign every message with the sender's private key (ECDSA) so relays/recipients can verify it wasn't tampered with in transit, and so you can demo "tamper detection" live (modify a byte, show the receiving device flags it as invalid)

### Step 6.4 — Key management UX (30 min)
- [ ] On first app load, generate and store a device keypair in IndexedDB (never transmitted)
- [ ] Show a short, human-readable key fingerprint (like Signal's safety numbers) so paired users could, in theory, verify identity out-of-band — mention this as a "future work" talking point even if you don't fully build a verification UI

**🏁 Phase 6 Exit Criteria:** Relay device, when inspected (e.g., via browser dev tools / console.log of what it actually forwards), is provably unable to read message contents it relays, while final recipient successfully decrypts. Tamper detection demo works.

---

## 📱 PHASE 7 — Hour 28–34: PWA Shell, Offline Caching & UI Layer
**Goal:** This stops being "a developer's local demo" and becomes a real installable app that works fully offline after first load.

### Step 7.1 — Service Worker offline caching (60 min)
- [ ] Cache-first strategy for the app shell (HTML/CSS/JS) on `install` — once loaded once, the app boots with **zero network at all**, ever again
- [ ] Cache-bust correctly on redeploy (versioned cache names) so you can push fixes during the hackathon without users being stuck on stale code

### Step 7.2 — Web App Manifest (20 min)
- [ ] `manifest.json` with icons, theme color, `display: standalone` — this is what makes "Add to Home Screen" turn it into a real-looking app icon, a small detail that reads as polish to judges

### Step 7.3 — Core UI screens (90 min)
- [ ] **Mesh Status screen:** peer list, connection health, "Pair Device" button
- [ ] **Message/Chat screen:** message list (rendered from the CRDT log, sorted causally), compose box with a priority selector (🆘 SOS / 💬 normal)
- [ ] **Pairing screen:** QR display + scanner, clear step indicator
- [ ] Keep it minimal and mobile-first — a clean, fast, ugly-but-functional UI beats a half-finished beautiful one (revisit the Time-Allocation Law from Part 0)

### Step 7.4 — Accessibility & resilience polish (30 min)
- [ ] Large tap targets, high-contrast SOS button (red, unmistakable — this is an emergency tool, design it like one)
- [ ] Visible offline indicator that's *proud*, not apologetic — reframe "No internet connection" as "🟢 Mesh Mode Active" — this single copywriting choice changes how judges perceive the whole product

**🏁 Phase 7 Exit Criteria:** App is installable on a real phone home screen, fully functional with Wi-Fi and mobile data both switched off, looks and feels like a real product, not a prototype.

---

## 😴 PHASE 8 — Hour 34–40: Buffer, Sleep & Integration Hardening
**Goal:** This block exists deliberately. Sleep-deprived debugging produces more bugs than it fixes. This is also your safety margin if any earlier phase ran long.

### Step 8.1 — Mandatory rest block (flexible length)
- [ ] Sleep. Seriously. A tired brain at Hour 45 writing demo-critical code is your single biggest risk factor, statistically, in any hackathon.

### Step 8.2 — Full integration regression pass (90 min, post-rest)
- [ ] Re-run every exit-criteria test from Phases 1–7 in sequence, on real devices, back to back, without "it worked yesterday" assumptions
- [ ] Specifically retest the multi-hop + reconnect + CRDT-merge scenario together as one combined flow (this combo is the most likely place latent bugs hide, since each phase tested its piece in isolation)

### Step 8.3 — Bug triage with MoSCoW prioritization (30 min)
- [ ] Any bugs found get sorted: **Must-fix** (breaks the core demo) / **Should-fix** (visible but workaroundable live) / **Could-fix** (cosmetic) / **Won't-fix** (note as "known limitation / future work" — judges respect honesty about scope far more than they penalize it)

**🏁 Phase 8 Exit Criteria:** Every core flow (pair → multi-hop relay → SOS priority → offline reconnection → CRDT merge → E2E encryption) has been re-verified end-to-end on rested eyes, with a triaged bug list.

---

## ⚡ PHASE 9 — Hour 40–46: Performance Optimization Pass
**Goal:** Make the demo *feel* instant and rock-solid. Judges notice lag, jank, and battery-drain warnings far more than they notice algorithmic elegance — this phase converts your good architecture into a good *experience*.

### Step 9.1 — Profile before you optimize (30 min)
- [ ] Open Chrome DevTools Performance tab during a multi-hop relay burst — find the actual bottleneck (almost always: excessive re-renders, not the networking/crypto code itself)
- [ ] Check IndexedDB read/write frequency — batching writes is almost always the highest-leverage fix (full detail in `Implement.md` Section 12)

### Step 9.2 — Rendering performance (45 min)
- [ ] Avoid full message-list re-renders on every new message — append-only DOM updates or a minimal virtual-list pattern if message count grows large
- [ ] Debounce the "Mesh Status" peer-health UI updates (no need to repaint 10x/second for a heartbeat that ticks every 2s)

### Step 9.3 — Network/CPU efficiency (45 min)
- [ ] Confirm Bloom filter / dedup Set sizing won't balloon memory on long-running demos (cap + periodic reset window)
- [ ] Confirm relay fan-out rate limiting (Step 4.4) actually prevents CPU spikes under a simulated "everyone sends at once" burst test

### Step 9.4 — Battery & mobile-specific tuning (30 min)
- [ ] Reduce discovery/heartbeat frequency when the tab is backgrounded (`document.visibilitychange`) or battery is low (`navigator.getBattery()` where available) — this is a small code addition with an outsized "they thought about real deployment" impression on judges
- [ ] Verify the Service Worker doesn't keep needlessly waking the device

### Step 9.5 — Cold-start time (20 min)
- [ ] Measure time from "tap icon" to "interactive" — this should be near-instant after first load (cache-first SW strategy from Phase 7 is what makes this possible) — a slow boot on stage kills demo momentum

**🏁 Phase 9 Exit Criteria:** App boots in well under a second on repeat launches, UI stays smooth under simulated multi-peer message bursts, no visible memory growth over a 10-minute soak test.

---

## 🎬 PHASE 10 — Hour 46–50: Demo Scripting & Rehearsal
**Goal:** A great build with a fumbled demo loses to a good build with a flawless demo. This phase is non-negotiable.

### Step 10.1 — Write the literal demo script (45 min)
- [ ] Script every sentence and every action, second by second, for a tight **90–120 second** live/recorded demo (most online hackathons cap demo videos at 2–3 minutes — assume the tighter constraint and trim later if you have room):
  1. (0:00–0:15) Hook: state the problem in one sentence ("When disasters knock out cell towers, people can't call for help or find their family — LifeLine Mesh fixes that with zero infrastructure.")
  2. (0:15–0:35) Show 3 phones, pair two via QR live, point out "no server, no internet, no app store install needed — just a URL"
  3. (0:35–0:55) **Switch all 3 phones to airplane mode on camera** — this is your signature moment, don't rush it, let the audience register that data/Wi-Fi are visibly off
  4. (0:55–1:20) Send an SOS message from Phone A, physically out of range of Phone C, show it arrive at C via relay through B — narrate the gossip-routing concept in one sentence while it happens
  5. (1:20–1:40) Separate A from the group for a moment, send messages on both sides, reunite, show CRDT merge happen live with zero conflicts
  6. (1:40–2:00) Close with the impact statement + one technical flex line ("end-to-end encrypted, conflict-free by construction, costs literally nothing to run at any scale") + call to action / what's next

### Step 10.2 — Rehearse until boring (60+ min, repeat as needed)
- [ ] Run the full script at least 5 times back to back, on the actual devices you'll demo with (battery levels, QR scan reliability, and Wi-Fi-off airplane-mode toggling all have real-world flakiness — find it now, not live)
- [ ] Time yourself every run — cut ruthlessly if you're over

### Step 10.3 — Record a backup video (45 min)
- [ ] Even if your hackathon allows live demos, record a clean backup take — live demos fail for reasons that have nothing to do with your code (bad venue Wi-Fi for the *judges'* screen-share, a dead webcam, etc.) Always have the recorded fallback ready to play instantly.

### Step 10.4 — Prepare the "if something breaks" contingency (15 min)
- [ ] Identify the single most fragile step (usually QR scanning under stage lighting) and have a pre-paired fallback state ready to jump to if live pairing fails, so you're never standing there debugging in front of judges

**🏁 Phase 10 Exit Criteria:** A rehearsed, timed, sub-2-minute demo script executed flawlessly at least twice in a row, plus a recorded backup video in hand.

---

## 📦 PHASE 11 — Hour 50–54: Submission Packaging
**Goal:** The README and pitch materials are often skimmed by judges *before* they ever open your app — first impressions here are disproportionately powerful.

### Step 11.1 — Write the README (45 min) — structure to follow:
- [ ] **Title + one-line pitch** (the narrative spine sentence)
- [ ] **The Problem** (2–3 sentences, concrete, human)
- [ ] **The Solution** (what it does, who it's for)
- [ ] **How It Works** (the 6-layer architecture, in plain language with the emoji-layer breakdown from your original pitch)
- [ ] **Tech Stack** (explicitly call out: "$0 cost, zero servers, zero AI/LLM dependency — pure browser-native APIs")
- [ ] **Live Demo Link** + **Demo Video Link**
- [ ] **Setup/Run Instructions** (judges sometimes do try to run it — make this copy-pasteable and tested)
- [ ] **Architecture Diagram** (text-based layer breakdown is fine and matches your style — no image diagram required)
- [ ] **What's Next** (2–3 stretch goals, shows vision beyond the 48 hours)
- [ ] **Known Limitations** (1–2 honest lines — this builds more credibility than it costs)

### Step 11.2 — Build the pitch deck (60 min) — 6–7 slides max:
- [ ] Slide 1: Title + tagline
- [ ] Slide 2: The Problem (make it visceral — a real disaster/blackout scenario)
- [ ] Slide 3: The Solution + live demo screenshot
- [ ] Slide 4: Architecture (the 6 layers, text/icon based, no need for a complex diagram tool)
- [ ] Slide 5: What makes this technically hard (Bloom filters, CRDTs, manual WebRTC signaling — name-drop the concepts explicitly, judges scan for exactly these signal words)
- [ ] Slide 6: Real-world impact + who needs this (disaster relief orgs, rural communities, protest/censorship-resistance use cases)
- [ ] Slide 7: What's next + thank you/links

### Step 11.3 — Final submission checklist (30 min)
- [ ] Live URL works on a fresh device with no cache (test in true incognito mode)
- [ ] Repo is public (if required) with clean commit history (no secrets committed, ever — even though there are no API keys here, double-check)
- [ ] Demo video uploaded and the link works from an incognito/logged-out browser
- [ ] All required submission form fields filled (project name, tagline, description, tech stack, team info, links) — copy-paste from your README so wording is consistent everywhere
- [ ] Submit with time to spare — never submit in the final 5 minutes, platform upload failures under last-minute load are a real and common failure mode

**🏁 Phase 11 Exit Criteria:** Submission fully filed, all links independently verified working from a clean/incognito session, with time buffer remaining before the deadline.

---

## 🎤 PHASE 12 — Final Hours: Judging Q&A Preparation
**Goal:** Live or async judges often ask 1–3 pointed questions. Walking in with crisp, confident, *technically specific* answers is what separates the project that "sounds impressive" from the one that visibly *is* impressive.

### Anticipated Question Bank (rehearse your answers out loud)

| Likely Question | Your Strong Answer Direction |
|---|---|
| "Why not just use a signaling server, it'd be simpler?" | "A signaling server is a single point of failure and requires internet to even bootstrap — which defeats the entire premise. QR-code manual signaling means the system has zero infrastructure dependency, by design, not by accident." |
| "How does this scale beyond 3–4 devices?" | "Gossip routing with TTL and Bloom-filter dedup is the same class of algorithm used in real delay-tolerant and ad-hoc mesh networks — it scales sub-linearly in redundant traffic because duplicates get dropped at the first hop that's already seen them. The honest limitation is dense urban mesh topologies need smarter TTL tuning, which is exactly the kind of thing I'd tackle next." |
| "What happens if a malicious device joins the mesh?" | "Every message is signed, so tampering is detectable. A malicious relay can drop or delay messages it can't read (since it can't decrypt E2E payloads) but can't forge or silently alter them. Full Sybil-resistance is future work — worth being upfront about." |
| "Why CRDTs instead of just timestamps?" | "Device clocks drift and can't be trusted for ordering in a fully decentralized system with no shared clock source. CRDTs guarantee convergence by construction — it's not 'probably fine,' it's mathematically conflict-free." |
| "Could this just be a native app instead of a PWA?" | "PWA was a deliberate choice for zero-install, zero-app-store-friction distribution — critical in an actual emergency where someone just needs a URL, not a 200MB App Store download over a struggling connection." |
| "What was the hardest part to build?" | Be honest — usually it's the manual WebRTC signaling or the CRDT merge logic. Specificity here reads as authenticity, vague answers read as someone who didn't build it themselves. |
| "Is this actually $0 to run at scale, forever?" | "Yes — there is no backend. Every cost in this system (compute, storage, bandwidth) is borne by the end-user's own device, which is the whole architectural point. The only ongoing cost is the static hosting for the initial PWA download, which is free-tier forever on GitHub Pages." |

### Step 12.1 — Rehearse the Q&A bank out loud (30 min)
- [ ] Say each answer aloud at least once — written confidence and spoken confidence are different muscles

### Step 12.2 — Prepare your "if asked to extend it live" fallback (15 min)
- [ ] Some judges ask you to add a tiny feature on the spot. Identify one genuinely trivial, safe extension you could demo live if asked (e.g., toggling a peer's connection off to show graceful degradation) so you have something ready rather than freezing

**🏁 Phase 12 Exit Criteria:** You can answer every question in the bank above confidently, from memory, with specific technical vocabulary, without looking at notes.

---

## 🛑 Risk Register & Contingency Plan

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| QR scanning unreliable under demo lighting | Medium | High | Test Step 2.4 early; have pre-paired fallback state ready (Step 10.4) |
| WebRTC NAT/ICE issues on unfamiliar demo network | Low (no STUN needed for local pairing) | Medium | Always demo airplane-mode/local scenario first — it's both your strongest story AND your most reliable path technically |
| Running out of time before CRDT layer is built | Medium | High | If behind schedule by Hour 20, cut Phase 5 down to Last-Write-Wins instead of full CRDT — still functionally correct, just less impressive; document the simplification honestly |
| Browser camera permission denied mid-demo | Low | High | Request camera permission proactively on app load, not at the moment of scanning, and test the permission flow on the actual demo device beforehand |
| Battery dies on a demo device mid-presentation | Low | Medium | Keep all demo devices charged to 100% right before going on, bring a power bank |
| Bug discovered hours before deadline | Medium | High | Phase 8's regression pass exists specifically to surface this *before* the final hours, not during them |
| Scope creep (stretch goals eating core-feature time) | High (the most common hackathon failure) | High | Hard rule: stretch goals (map view, SOS broadcast mode) are ONLY touched after Phase 9 Exit Criteria are met, no exceptions |

---

## 📊 Scoring Rubric Alignment Matrix

Use this to sanity-check, at any point in the build, "is what I'm doing right now actually scoring points?"

| Typical Judging Criterion | What in this project satisfies it |
|---|---|
| **Innovation/Originality** | Serverless mesh networking via QR-based WebRTC signaling — a near-zero-competition category in a typical hackathon field |
| **Technical Complexity** | Gossip routing, Bloom-filter dedup, vector-clock CRDTs, ECDH/AES-GCM E2E encryption — four genuinely hard CS topics, implemented from scratch, with zero AI assistance at runtime |
| **Real-World Impact** | Disaster relief, rural connectivity, censorship-resistant protest coordination — concrete, named beneficiaries, not abstract |
| **Completion/Functionality** | Phases 1–9 produce a fully working, installable, offline-functional PWA — not a slide deck pretending to be a product |
| **Presentation** | Phase 10's scripted, rehearsed, sub-2-minute demo with a clear visual "wow" moment (live airplane-mode relay) |
| **Cost/Sustainability** | Explicitly $0 to build and $0 to run forever — no cloud bill ever, a genuinely rare and judge-pleasing property |

---

## 🌱 Post-Hackathon (Bonus Credibility, Costs Nothing)

- [ ] Open-source the repo publicly with a clear `LICENSE` (MIT is the friendly default) right after submission rules allow it
- [ ] Write a short post-mortem blog post / Devpost write-up reflecting on what you'd do differently — judges and future opportunities (recruiters, accelerators) read these
- [ ] If asked "what's next" in judging, you now have a real answer beyond vague hand-waving: true Bloom filters at scale, Sybil-resistant routing, a native wrapper for background radio access (Bluetooth Low Energy mesh as a true off-grid layer beyond WebRTC's range limits)

---

## ✅ Final Pre-Submission Self-Check
- [ ] Does the project solve the exact problem in the narrative spine sentence, demonstrably, live?
- [ ] Does every phase's exit criteria check out, verified today, not "should still work from 2 days ago"?
- [ ] Is the cost genuinely $0 — no paid API, no paid hosting tier, no AI/LLM dependency anywhere in the runtime path?
- [ ] Can you explain every one of the 6 architecture layers, unscripted, to a stranger, in under 30 seconds each?
- [ ] Is your demo rehearsed enough that nervousness can't break it?

**Now go build it. 🛰️**


