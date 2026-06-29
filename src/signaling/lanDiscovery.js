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
  try {
    await navigator.clipboard.writeText(url);
    return "clipboard";
  } catch {
    return "fallback";
  }
}

export async function copyShareText(sdpPayload) {
  const url = createConnectionURL(sdpPayload);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    return false;
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

function toBase62(num) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  if (num === 0) return "0";
  let result = "";
  while (num > 0) {
    result = chars[num % 62] + result;
    num = Math.floor(num / 62);
  }
  return result;
}

export function generatePairingCode(sdpPayload) {
  let hash = 5381;
  const str = typeof sdpPayload === "string" ? sdpPayload : JSON.stringify(sdpPayload);
  for (let i = 0; i < Math.min(str.length, 64); i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  const code = toBase62(Math.abs(hash)).slice(0, 6).toUpperCase().padStart(6, "0");
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function renderLANInfo(container, localIPs, pairingCode) {
  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
      Same Wi-Fi Quick Connect
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:center;">
      <div style="font-size:12px;color:var(--text-secondary);">Your LAN IP</div>
      <div style="font-family:monospace;font-size:14px;color:var(--text-primary);background:var(--bg-secondary);padding:4px 12px;border-radius:4px;">
        ${localIPs.length > 0 ? localIPs.join(", ") : "Detecting..."}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">Pairing Code</div>
      <div style="font-family:monospace;font-size:24px;font-weight:700;color:var(--accent-green);letter-spacing:4px;background:var(--bg-secondary);padding:6px 16px;border-radius:6px;">
        ${pairingCode}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
        Other device: enter this code on the "Enter Code" tab
      </div>
    </div>
  `;
}
