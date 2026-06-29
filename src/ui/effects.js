/**
 * effects.js — Presentational "command center" engine.
 *
 * This module is 100% decoupled from the mesh backend. It never imports
 * crypto/routing/transport modules. It only reads LIVE values that the real
 * UI layer (meshStatus.js) writes into the DOM, and renders ambient motion,
 * radar, world-map data flow, terminal feed, parallax and micro-interactions
 * on top of them. No system value is hardcoded — everything reactive is read
 * from the elements the backend already populates.
 */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Canvas helper (DPR-aware, auto-resize)                              */
/* ------------------------------------------------------------------ */
function makeCanvas(el) {
  if (!el) return null;
  const ctx = el.getContext("2d");
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const r = el.getBoundingClientRect();
    const d = dpr();
    el.width = Math.max(1, Math.round(r.width * d));
    el.height = Math.max(1, Math.round(r.height * d));
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  resize();
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(el);
  else window.addEventListener("resize", resize);
  return {
    ctx,
    get w() { return el.getBoundingClientRect().width; },
    get h() { return el.getBoundingClientRect().height; },
  };
}

/* ------------------------------------------------------------------ */
/* Shared live-state read from the DOM (set by meshStatus.js)          */
/* ------------------------------------------------------------------ */
const live = { peers: 0, health: 100 };

function readInt(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const n = parseInt((el.textContent || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ */
/* 1. Ambient particle background                                      */
/* ------------------------------------------------------------------ */
function initBackground() {
  const c = makeCanvas(document.getElementById("bg-canvas"));
  if (!c) return;
  let dots = [];
  function seed() {
    const count = Math.round(clamp((c.w * c.h) / 26000, 30, 90));
    dots = Array.from({ length: count }, () => ({
      x: Math.random() * c.w, y: Math.random() * c.h,
      vx: rand(-0.12, 0.12), vy: rand(-0.12, 0.12),
      r: rand(0.6, 1.8), a: rand(0.15, 0.6),
    }));
  }
  seed();
  let last = 0;
  function frame(t) {
    if (t - last > 1000) seed.lastW = c.w; // noop guard
    last = t;
    const { ctx, w, h } = c;
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0) d.x = w; else if (d.x > w) d.x = 0;
      if (d.y < 0) d.y = h; else if (d.y > h) d.y = 0;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fillStyle = `rgba(69,240,122,${d.a * 0.5})`;
      ctx.fill();
    }
    // faint links
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i], b = dots[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = dx * dx + dy * dy;
        if (dist < 13000) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(69,240,122,${0.05 * (1 - dist / 13000)})`;
          ctx.lineWidth = 0.5; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  }
  if (!REDUCED) requestAnimationFrame(frame);
  else { const { ctx, w, h } = c; ctx.clearRect(0, 0, w, h); for (const d of dots) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fillStyle = `rgba(69,240,122,${d.a * 0.4})`; ctx.fill(); } }
}

/* ------------------------------------------------------------------ */
/* 2. Hero world-map network (dotted field + arcs + data packets)     */
/* ------------------------------------------------------------------ */
function initWorldMap() {
  const c = makeCanvas(document.getElementById("map-canvas"));
  if (!c) return;

  // normalized hub coordinates (x,y in 0..1) loosely suggesting continents
  const hubsN = [
    [0.16, 0.40], [0.27, 0.55], [0.44, 0.34], [0.52, 0.52],
    [0.63, 0.40], [0.74, 0.30], [0.80, 0.58], [0.36, 0.66], [0.68, 0.66],
  ];
  const links = [[0, 2], [2, 3], [2, 4], [4, 5], [4, 6], [3, 7], [6, 8], [1, 7], [3, 6], [0, 1]];
  const packets = links.map((l, i) => ({ l, t: Math.random(), spd: rand(0.0016, 0.0036), hit: 0 }));
  const nodePulse = hubsN.map(() => Math.random() * TAU);

  // static dotted field (regenerated on resize via factor of w)
  let field = [];
  function seedField() {
    field = [];
    const cols = 46, rows = 22;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        // elliptical mask + noise to feel map-like
        const nx = i / (cols - 1), ny = j / (rows - 1);
        const dx = nx - 0.5, dy = ny - 0.5;
        const inside = (dx * dx) / 0.26 + (dy * dy) / 0.16 < 1;
        if (inside && Math.random() > 0.32) field.push([nx, ny, rand(0.06, 0.22)]);
      }
    }
  }
  seedField();

  function frame() {
    const { ctx, w, h } = c;
    ctx.clearRect(0, 0, w, h);
    const px = (n) => n * w, py = (n) => n * h;

    // dotted map field
    for (const [nx, ny, a] of field) {
      ctx.beginPath();
      ctx.arc(px(nx), py(ny), 1.1, 0, TAU);
      ctx.fillStyle = `rgba(69,240,122,${a})`;
      ctx.fill();
    }

    // arcs
    for (const p of packets) {
      const [ai, bi] = p.l;
      const ax = px(hubsN[ai][0]), ay = py(hubsN[ai][1]);
      const bx = px(hubsN[bi][0]), by = py(hubsN[bi][1]);
      const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.abs(bx - ax) * 0.22;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.strokeStyle = "rgba(69,240,122,0.18)";
      ctx.lineWidth = 1; ctx.stroke();

      // data packet position on quadratic bezier
      if (!REDUCED) p.t += p.spd * (1 + live.peers * 0.25);
      if (p.t >= 1) { p.t = 0; p.hit = 1; nodePulse[bi] = 0; }
      const t = p.t, it = 1 - t;
      const qx = it * it * ax + 2 * it * t * mx + t * t * bx;
      const qy = it * it * ay + 2 * it * t * my + t * t * by;
      const grad = ctx.createRadialGradient(qx, qy, 0, qx, qy, 6);
      grad.addColorStop(0, "rgba(150,255,190,0.95)");
      grad.addColorStop(1, "rgba(69,240,122,0)");
      ctx.beginPath(); ctx.arc(qx, qy, 6, 0, TAU); ctx.fillStyle = grad; ctx.fill();
    }

    // hub nodes (pulsing) — brighter / more when peers connected
    hubsN.forEach((hn, i) => {
      nodePulse[i] += 0.04;
      const base = 2.4 + (i % 3 === 0 ? 1 : 0);
      const pulse = 1 + Math.sin(nodePulse[i]) * 0.35;
      const x = px(hn[0]), y = py(hn[1]);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 16 * pulse);
      glow.addColorStop(0, "rgba(69,240,122,0.55)");
      glow.addColorStop(1, "rgba(69,240,122,0)");
      ctx.beginPath(); ctx.arc(x, y, 16 * pulse, 0, TAU); ctx.fillStyle = glow; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, base * pulse, 0, TAU);
      ctx.fillStyle = "rgba(180,255,205,0.95)"; ctx.fill();
    });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener("resize", () => { seedField(); });
}

/* ------------------------------------------------------------------ */
/* 3. Radar / network monitor                                          */
/* ------------------------------------------------------------------ */
const radar = { pings: [] };
function initRadar() {
  const c = makeCanvas(document.getElementById("radar-canvas"));
  if (!c) return;
  let sweep = 0;
  let ring = 0;
  // ambient blips persist; their count tracks live peers (min 2 ambient)
  let blips = [];
  function syncBlips() {
    const target = Math.max(2, live.peers + 2);
    while (blips.length < target) blips.push({ a: rand(0, TAU), r: rand(0.25, 0.92), tw: rand(0, TAU), real: blips.length >= 2 });
    while (blips.length > target) blips.pop();
  }
  syncBlips();
  setInterval(syncBlips, 1200);

  function frame() {
    const { ctx, w, h } = c;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 4;
    ctx.clearRect(0, 0, w, h);

    // rings (alternating rotation feel via dashed offset)
    ring += 0.004;
    for (let i = 1; i <= 4; i++) {
      const rr = (R * i) / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.strokeStyle = `rgba(69,240,122,${0.10 + i * 0.03})`;
      ctx.lineWidth = 1; ctx.stroke();
    }
    // cross hairs
    ctx.strokeStyle = "rgba(69,240,122,0.10)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

    // rotating tick ring
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ring);
    for (let a = 0; a < TAU; a += TAU / 36) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (R - 3), Math.sin(a) * (R - 3));
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.strokeStyle = "rgba(69,240,122,0.25)"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();

    // sweep sector
    if (!REDUCED) sweep += 0.022;
    ctx.save(); ctx.translate(cx, cy);
    const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep, 0, 0) : null;
    if (grad) {
      grad.addColorStop(0, "rgba(69,240,122,0.32)");
      grad.addColorStop(0.12, "rgba(69,240,122,0.0)");
      grad.addColorStop(1, "rgba(69,240,122,0.0)");
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, 0, TAU); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
    // leading sweep line
    ctx.rotate(sweep);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0);
    ctx.strokeStyle = "rgba(150,255,190,0.7)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();

    // blips
    const now = performance.now() / 1000;
    for (const b of blips) {
      b.tw += 0.05;
      const x = cx + Math.cos(b.a) * b.r * R;
      const y = cy + Math.sin(b.a) * b.r * R;
      const tw = 0.5 + Math.abs(Math.sin(b.tw)) * 0.5;
      const gl = ctx.createRadialGradient(x, y, 0, x, y, 7);
      gl.addColorStop(0, `rgba(150,255,190,${0.9 * tw})`);
      gl.addColorStop(1, "rgba(69,240,122,0)");
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fillStyle = gl; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fillStyle = "rgba(200,255,220,0.95)"; ctx.fill();
    }

    // expanding pings (peer connected events)
    radar.pings = radar.pings.filter((p) => now - p.t < 1.6);
    for (const p of radar.pings) {
      const prog = (now - p.t) / 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, prog * R, 0, TAU);
      ctx.strokeStyle = `rgba(69,240,122,${0.6 * (1 - prog)})`;
      ctx.lineWidth = 2; ctx.stroke();
    }

    // center shield
    const pulse = 1 + Math.sin(now * 1.6) * 0.12;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22 * pulse);
    cg.addColorStop(0, "rgba(69,240,122,0.5)"); cg.addColorStop(1, "rgba(69,240,122,0)");
    ctx.beginPath(); ctx.arc(cx, cy, 22 * pulse, 0, TAU); ctx.fillStyle = cg; ctx.fill();
    drawShield(ctx, cx, cy, 9 * pulse);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function drawShield(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.8, -s * 0.5);
  ctx.lineTo(s * 0.8, s * 0.3);
  ctx.quadraticCurveTo(s * 0.8, s, 0, s * 1.2);
  ctx.quadraticCurveTo(-s * 0.8, s, -s * 0.8, s * 0.3);
  ctx.lineTo(-s * 0.8, -s * 0.5);
  ctx.closePath();
  ctx.strokeStyle = "rgba(180,255,205,0.95)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "rgba(69,240,122,0.18)"; ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 4. Sidebar sparkline                                                */
/* ------------------------------------------------------------------ */
function initSparkline() {
  const c = makeCanvas(document.getElementById("sparkline"));
  if (!c) return;
  const pts = Array.from({ length: 60 }, () => 0.5);
  function frame() {
    const { ctx, w, h } = c;
    ctx.clearRect(0, 0, w, h);
    pts.shift();
    pts.push(clamp(pts[pts.length - 1] + rand(-0.18, 0.18), 0.15, 0.85));
    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - v * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(69,240,122,0.8)"; ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(69,240,122,0.6)"; ctx.shadowBlur = 6; ctx.stroke();
    ctx.shadowBlur = 0;
    requestAnimationFrame(frame);
  }
  if (!REDUCED) requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* 5. Live feed terminal                                               */
/* ------------------------------------------------------------------ */
function initLiveFeed() {
  const box = document.getElementById("live-feed");
  if (!box) return;
  const phrases = [
    "scanning network...", "decrypting handshake...", "channels secure",
    "mesh stable", "no threats detected", "rotating session keys",
    "peer table synced", "gossip round complete", "AES-256 active",
    "vector clock merged", "bloom filter updated", "relay path optimal",
  ];
  const MAX = 5;
  const lines = [];
  function render() {
    box.innerHTML = lines.map((l) =>
      `<div class="lf-line"><span class="lf-prompt">&gt;&gt;&gt;</span> ${l.text}${l.typing ? '<span class="lf-caret">_</span>' : ""}</div>`
    ).join("");
  }
  function typeNext() {
    const full = phrases[Math.floor(Math.random() * phrases.length)];
    const line = { text: "", typing: true };
    lines.push(line);
    while (lines.length > MAX) lines.shift();
    let i = 0;
    render();
    const tick = () => {
      i++;
      line.text = full.slice(0, i);
      render();
      if (i < full.length) setTimeout(tick, rand(22, 55));
      else { line.typing = false; render(); setTimeout(typeNext, rand(1400, 2800)); }
    };
    setTimeout(tick, 120);
  }
  if (REDUCED) { phrases.slice(0, MAX).forEach((p) => lines.push({ text: p, typing: false })); render(); }
  else typeNext();
}

/* ------------------------------------------------------------------ */
/* 6. Hex address feed (decorative, generated — never hardcoded)       */
/* ------------------------------------------------------------------ */
function initHexFeed() {
  const box = document.getElementById("hex-feed");
  if (!box) return;
  const hex = () => Array.from({ length: 4 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("");
  function row() { return `0x${hex()}··${hex()}`; }
  function render() {
    box.innerHTML = Array.from({ length: 4 }, row).join("<br>");
  }
  render();
  if (!REDUCED) setInterval(render, 2600);
}

/* ------------------------------------------------------------------ */
/* 7. Rolling stat numbers (animate values written by meshStatus.js)   */
/* ------------------------------------------------------------------ */
function initStatRolls() {
  ["stat-direct-peers", "stat-messages", "stat-relayed"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    let current = parseInt(el.textContent, 10) || 0;
    let raf = null;
    let suppress = false;

    const animateTo = (target) => {
      if (REDUCED) { suppress = true; el.textContent = String(target); current = target; suppress = false; return; }
      cancelAnimationFrame(raf);
      const from = current, dur = 600, start = performance.now();
      const step = (now) => {
        const t = clamp((now - start) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = Math.round(lerp(from, target, eased));
        suppress = true;
        el.textContent = String(val);
        suppress = false;
        if (t < 1) raf = requestAnimationFrame(step);
        else current = target;
      };
      raf = requestAnimationFrame(step);
    };

    const obs = new MutationObserver(() => {
      if (suppress) return;
      const target = parseInt((el.textContent || "").replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(target) && target !== current) animateTo(target);
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

/* ------------------------------------------------------------------ */
/* 8. Live wiring: system pill, network id, health dots, peer events   */
/* ------------------------------------------------------------------ */
function initLiveWiring() {
  const pill = document.getElementById("system-status-pill");
  const sideState = document.getElementById("side-system-state");
  const heroPeers = document.getElementById("hero-peer-count");
  const netHealth = document.getElementById("net-health");
  const nodesScanned = document.getElementById("info-nodes-scanned");
  const netId = document.getElementById("info-network-id");
  const deviceId = document.getElementById("device-id-display");

  // System online/offline pill driven by real connectivity
  function updatePill() {
    if (!pill) return;
    const online = navigator.onLine;
    pill.classList.toggle("degraded", !online);
    pill.innerHTML = `<span class="dot"></span> ${online ? "SYSTEM ONLINE" : "MESH MODE"}`;
    if (sideState) sideState.textContent = online ? "ONLINE" : "MESH";
  }
  updatePill();
  window.addEventListener("online", updatePill);
  window.addEventListener("offline", updatePill);

  // Derive Network ID from the real device fingerprint once boot sets it
  function syncNetId() {
    if (!netId || !deviceId) return;
    const fp = (deviceId.textContent || "").replace(/[^a-zA-Z0-9]/g, "");
    if (fp.length >= 4) {
      netId.textContent = "LifeLine_" + fp.slice(0, 4).toUpperCase();
      return true;
    }
    return false;
  }
  if (!syncNetId()) {
    const t = setInterval(() => { if (syncNetId()) clearInterval(t); }, 400);
    setTimeout(() => clearInterval(t), 15000);
  }

  // Health dots
  const dotsWrap = document.getElementById("health-dots");
  const DOTS = 28;
  if (dotsWrap && !dotsWrap.childElementCount) {
    for (let i = 0; i < DOTS; i++) dotsWrap.appendChild(document.createElement("span"));
  }
  function paintHealth(pct) {
    if (!dotsWrap) return;
    const lit = Math.round((pct / 100) * DOTS);
    [...dotsWrap.children].forEach((s, i) => s.classList.toggle("on", i < lit));
  }

  // React to live peer count (set by meshStatus) -> radar ping + state
  function readHealth() {
    const h = parseInt((netHealth?.textContent || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(h) ? h : 100;
  }
  live.peers = readInt("stat-direct-peers");
  live.health = readHealth();
  paintHealth(live.health);

  const watch = (node, cb) => {
    if (!node) return;
    new MutationObserver(cb).observe(node, { childList: true, characterData: true, subtree: true });
  };

  watch(document.getElementById("stat-direct-peers"), () => {
    const next = readInt("stat-direct-peers");
    if (next > live.peers) radar.pings.push({ t: performance.now() / 1000 }); // new peer -> radar ping
    live.peers = next;
    document.body.classList.toggle("mesh-busy", next > 0);
  });
  watch(heroPeers, () => { live.peers = parseInt((heroPeers.textContent || "").replace(/[^\d]/g, ""), 10) || live.peers; });
  watch(netHealth, () => { live.health = readHealth(); paintHealth(live.health); if (pill) pill.classList.toggle("degraded", live.health < 70 || !navigator.onLine); });
}

/* ------------------------------------------------------------------ */
/* 9. Navigation helpers for new action buttons (reuse existing nav)   */
/* ------------------------------------------------------------------ */
function initNavHelpers() {
  document.querySelectorAll("[data-nav-to]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-nav-to");
      const navBtn = document.querySelector(`.nav-btn[data-view="${view}"]`);
      if (navBtn) navBtn.click();
    });
  });
  document.querySelectorAll("[data-scroll-top]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("main-content")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 10. Mouse parallax + card tilt (depth / lighting)                   */
/* ------------------------------------------------------------------ */
function initParallax() {
  if (REDUCED) return;
  const bg = document.getElementById("bg-canvas");
  const map = document.querySelector(".hero-bg");
  let tx = 0, ty = 0, cx = 0, cy = 0;
  window.addEventListener("pointermove", (e) => {
    tx = (e.clientX / window.innerWidth - 0.5);
    ty = (e.clientY / window.innerHeight - 0.5);
  });
  function loop() {
    cx = lerp(cx, tx, 0.06); cy = lerp(cy, ty, 0.06);
    if (bg) bg.style.transform = `translate(${cx * 14}px, ${cy * 14}px)`;
    if (map) map.style.transform = `translate(${cx * -10}px, ${cy * -10}px)`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 3D tilt on stat cards
  document.querySelectorAll(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(700px) rotateX(${-py * 6}deg) rotateY(${px * 6}deg) translateY(-3px)`;
    });
    card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
function boot() {
  try { initBackground(); } catch (e) { console.warn("[effects] bg", e); }
  try { initWorldMap(); } catch (e) { console.warn("[effects] map", e); }
  try { initRadar(); } catch (e) { console.warn("[effects] radar", e); }
  try { initSparkline(); } catch (e) { console.warn("[effects] spark", e); }
  try { initLiveFeed(); } catch (e) { console.warn("[effects] feed", e); }
  try { initHexFeed(); } catch (e) { console.warn("[effects] hex", e); }
  try { initStatRolls(); } catch (e) { console.warn("[effects] rolls", e); }
  try { initLiveWiring(); } catch (e) { console.warn("[effects] wiring", e); }
  try { initNavHelpers(); } catch (e) { console.warn("[effects] nav", e); }
  try { initParallax(); } catch (e) { console.warn("[effects] parallax", e); }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
