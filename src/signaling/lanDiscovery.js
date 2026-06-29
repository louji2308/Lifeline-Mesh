export function getLocalIPs() {
  return new Promise((resolve) => {
    const ips = [];
    let timeout;
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("lan-probe");
    pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {});
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const match = event.candidate.candidate.match(
          /(?:candidate:\S+ \d+ \S+ \d+ ([\d.]+) \d+ typ)/);
        if (match && !ips.includes(match[1]) && !match[1].startsWith("127.")) {
          ips.push(match[1]);
        }
      } else {
        clearTimeout(timeout);
        pc.close();
        resolve(ips);
      }
    };
    timeout = setTimeout(() => {
      pc.close();
      resolve(ips.length > 0 ? ips : []);
    }, 2000);
  });
}

export function createConnectionURL(sdpPayload) {
  const data = typeof sdpPayload === "string" ? sdpPayload : JSON.stringify(sdpPayload);
  const base = window.location.href.split("?")[0].split("#")[0];
  return `${base}?connect=${encodeURIComponent(data)}`;
}

export async function shareConnection(sdpPayload) {
  const url = createConnectionURL(sdpPayload);
  if (navigator.share) {
    try {
      await navigator.share({
        title: "LifeLine Mesh — Pair with me",
        text: "Open this link to connect to my mesh network:",
        url: url,
      });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
    }
  }
  return "fallback";
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

export function showCopyableLink(container, url) {
  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">
      Connection Link — Copy and send to the other device
    </div>
    <input id="connection-link-input" type="text" readonly
      value="${url.replace(/"/g, "&quot;")}"
      style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;font-family:monospace;word-break:break-all;">
    <button id="connection-copy-btn" class="btn btn-primary w-full mt-8" style="padding:10px;">
      Copy to Clipboard
    </button>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
      Tap Copy above, then paste into the other device's "Connect via Code" input.
    </div>
  `;
  const input = document.getElementById("connection-link-input");
  const copyBtn = document.getElementById("connection-copy-btn");
  if (input && copyBtn) {
    const doCopy = async () => {
      input.select();
      const ok = await copyToClipboard(url);
      if (ok) {
        const orig = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        copyBtn.style.background = "var(--accent-green)";
        setTimeout(() => {
          copyBtn.textContent = orig;
          copyBtn.style.background = "";
        }, 2000);
      }
    };
    copyBtn.addEventListener("click", doCopy);
  }
}

export function extractConnectionFromURL() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("connect");
  if (fromQuery) return fromQuery;
  if (window.location.hash.startsWith("#connect=")) {
    return decodeURIComponent(window.location.hash.slice(9));
  }
  return null;
}

export function clearConnectionFromURL() {
  const url = new URL(window.location.href);
  url.searchParams.delete("connect");
  window.history.replaceState(null, "", url.toString());
}

export function renderLANInfo(container, localIPs) {
  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin:0;">
      Same Wi-Fi — Your LAN IP: 
      <span style="font-family:monospace;color:var(--text-primary);font-weight:600;">${localIPs.length > 0 ? localIPs.join(", ") : "detecting..."}</span>
    </div>
  `;
}
