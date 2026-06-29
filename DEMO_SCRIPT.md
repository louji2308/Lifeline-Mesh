# LifeLine Mesh — Live Demo Script

**Target length:** 90–120 seconds
**Devices needed:** 3 phones (A, B, C) with LifeLine Mesh open in browser

---

### (0:00–0:15) Hook

> "When disasters knock out cell towers or governments shut down the internet, people can't call for help or reach their families. LifeLine Mesh fixes that with zero infrastructure — every phone becomes part of the network itself."

*(Hold up Device A)*

---

### (0:15–0:40) Pair two devices via QR

> "No app store, no server, no internet required — just a browser. Watch how fast two devices connect."

- Device A: Tap **Pair Device** → **Show My QR Code** → hold screen toward audience
- Device B: Tap **Pair Device** → **Scan QR Code** → point at A's screen
- Device B shows QR → Device A tap **Scan Their Response** → scan B's QR
- *(Wait for "Connected" to appear)*

> "That QR handshake replaces the server that every other WebRTC app needs. We literally send the connection details through the screen and camera."

---

### (0:40–1:00) Airplane mode + SOS relay

> "And the real magic? This works with zero internet at all. Watch."

- Switch all 3 devices to airplane mode on camera *(let the audience see the airplane icon)*
- Show Device A typing an SOS message

> *(Point at Device C, out of range of A)* "Device C is out of range of A — they've never directly connected. But B sits between them."

- Send SOS from A

> "This SOS jumps the priority queue — it gets relayed through B before any normal message waiting in line."

- Show it arriving on C via B's relay

> "That's gossip routing with bloom-filter deduplication, so the network doesn't flood itself."

---

### (1:00–1:30) Split-brain CRDT merge

> "Now watch what happens when the mesh splits and comes back together."

- Move A away from B+C (simulate separation)
- Send a message from A side and from B+C side
- Bring A back
- *(Wait for merge — both sides show the same full message history)*

> "Because every message lives in a conflict-free CRDT log, when the islands reconnect, their message histories merge automatically with zero conflicts, zero lost messages, zero manual intervention. No central server ever existed to reconcile — they just agree by construction."

---

### (1:30–2:00) Close

> "End-to-end encrypted, conflict-free by design, and costs literally nothing to run at any scale. LifeLine Mesh turns the phone in your pocket into a lifeline — no infrastructure required."

---

## Contingency Plan

**If QR scan fails on stage:**
> "Sometimes stage lighting makes QR scanning tricky — here's the backup." *(Pick up pre-paired Device A and show it already connected to B in the mesh status panel)*

**If a device crashes:**
> "Mesh networks degrade gracefully. If one node drops, the others keep working — watch." *(kill Device B mid-demo, show A and C still functional)*
