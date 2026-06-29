import { PRIORITY } from "../schema.js";

export class ChatView {
  constructor(messageLog, peerManager, onSendMessage, deviceId = "") {
    this.messageLog = messageLog;
    this.peerManager = peerManager;
    this.onSendMessage = onSendMessage;
    this._deviceId = deviceId;
    this._renderedIds = new Set();
    this._selectedPriority = PRIORITY.SOS;
    this._boundHandleNewMessage = this._handleNewMessage.bind(this);
  }

  setDeviceId(deviceId) {
    this._deviceId = deviceId;
  }

  mount() {
    this._renderExistingMessages();
    this._unsubscribe = this.messageLog.onChange(this._boundHandleNewMessage);
    this._setupEventListeners();
  }

  unmount() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._removeEventListeners();
  }

  _setupEventListeners() {
    this._boundSend = this._send.bind(this);
    this._boundKeydown = this._handleKeydown.bind(this);
    this._boundPriorityClick = this._handlePriorityClick.bind(this);

    document.getElementById("btn-send")?.addEventListener("click", this._boundSend);
    document.getElementById("compose-input")?.addEventListener("keydown", this._boundKeydown);
    document.querySelectorAll(".priority-btn").forEach((btn) => {
      btn.addEventListener("click", this._boundPriorityClick);
    });
  }

  _removeEventListeners() {
    document.getElementById("btn-send")?.removeEventListener("click", this._boundSend);
    document.getElementById("compose-input")?.removeEventListener("keydown", this._boundKeydown);
    document.querySelectorAll(".priority-btn").forEach((btn) => {
      btn.removeEventListener("click", this._boundPriorityClick);
    });
  }

  _handleKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this._send();
    }
  }

  _handlePriorityClick(event) {
    const btn = event.currentTarget;
    document.querySelectorAll(".priority-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    this._selectedPriority = btn.dataset.priority;
  }

  _send() {
    const input = document.getElementById("compose-input");
    const text = input?.value.trim();
    if (!text) return;

    this.onSendMessage(text, this._selectedPriority);
    input.value = "";
    input.style.height = "auto";
  }

  _renderExistingMessages() {
    const container = document.getElementById("message-list");
    if (!container) return;

    const messages = this.messageLog.getSortedForDisplay("asc");
    const deviceId = this._deviceId;

    const empty = container.querySelector(".text-center");
    if (messages.length === 0) {
      if (!empty) {
        container.innerHTML = `<div class="text-center" style="color:var(--text-muted);padding:40px 0;">
          No messages yet. Messages sent or received will appear here.
        </div>`;
      }
      return;
    }

    if (empty) empty.remove();

    const fragment = document.createDocumentFragment();
    for (const msg of messages) {
      if (this._renderedIds.has(msg.id)) continue;

      const el = document.createElement("div");
      const isSelf = msg.senderId === deviceId;
      const isSOS = msg.priority === PRIORITY.SOS;

      el.className = `message message--${isSelf ? "self" : "other"}${isSOS ? " message--sos" : ""}`;

      let content = msg.decryptedText || msg.plaintext || "[encrypted]";
      if (content && typeof content === "object") {
        try { content = JSON.stringify(content); } catch { content = "[data]"; }
      }

      el.innerHTML = `
        <div>${this._escapeHtml(String(content))}</div>
        <div class="message-meta">
          <span>${isSelf ? "You" : this._formatPeerId(msg.senderId)}</span>
          ${isSOS ? '<span class="message-priority-sos">🆘 SOS</span>' : ""}
          <span>${this._formatTime(msg.timestamp)}</span>
        </div>
      `;

      fragment.appendChild(el);
      this._renderedIds.add(msg.id);
    }

    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
  }

  _handleNewMessage(message) {
    requestAnimationFrame(() => {
      this._renderExistingMessages();
    });
  }

  _escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  _formatPeerId(peerId) {
    if (!peerId) return "???";
    return peerId.length > 12 ? peerId.slice(0, 12) + "…" : peerId;
  }

  _formatTime(timestamp) {
    if (!timestamp) return "";
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}
