window.__ModuleLoader__.load({
	id: "@mobaixingyao/dsh-inform",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/wire.ts
function isRemindItem(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.id === "number" && Number.isFinite(v.id) && (v.kind === "complete" || v.kind === "approval" || v.kind === "question") && typeof v.sessionId === "string" && typeof v.title === "string" && typeof v.summary === "string" && typeof v.at === "string";
}
function isRemindState(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  if (typeof v.now !== "string" || typeof v.cursor !== "number" || !Number.isFinite(v.cursor)) return false;
  if (!Array.isArray(v.pending) || !v.pending.every(isRemindItem)) return false;
  if (!Array.isArray(v.recent) || !v.recent.every(isRemindItem)) return false;
  return true;
}

// src/client/store.ts
var MAX_TOASTS = 5;
var AUTO_DISMISS_MS = 8e3;
function flagsForKind(flags, kind) {
  return kind === "complete" ? flags.complete : kind === "approval" ? flags.approval : flags.question;
}
var RemindStore = class {
  constructor() {
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
    __publicField(this, "snapshotCache", {
      toasts: [],
      connection: "connecting",
      lastError: null,
      enabled: { complete: true, approval: true, question: true },
      uiPopup: false,
      soundEnabled: false,
      soundPath: "",
      settingsStatus: "loading",
      settingsWritable: true,
      pendingCount: 0
    });
    __publicField(this, "toastSeq", 0);
    __publicField(this, "seenItemIds", /* @__PURE__ */ new Set());
    __publicField(this, "timers", /* @__PURE__ */ new Map());
    /** 绑定的设置命名空间表单；ui-settings 未组合时为 null（开关页降级为只读提示）。 */
    __publicField(this, "scope", null);
    /**
     * 送达钩子：页面内弹窗入栈时同步调用（含测试弹窗）。
     * 客户端 apply 把它接到系统通知上；抛异常只影响当前这条，不阻断弹窗栈。
     */
    __publicField(this, "onDeliver", null);
    __publicField(this, "getSnapshot", () => this.snapshotCache);
    __publicField(this, "subscribe", (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    });
  }
  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }
  // ---- 变更入口（全部整体替换快照） ----
  setConnection(connection) {
    if (this.snapshotCache.connection === connection) return;
    this.publish({ connection });
  }
  /** 记录取数失败原因（设置页可见）；成功吸收会自动清空。 */
  markConnectionError(reason) {
    const text = reason ?? "unknown";
    if (this.snapshotCache.connection === "error" && this.snapshotCache.lastError === text) return;
    this.publish({ connection: "error", lastError: text });
  }
  setEnabled(enabled) {
    const current = this.snapshotCache.enabled;
    if (current.complete === enabled.complete && current.approval === enabled.approval && current.question === enabled.question) return;
    this.publish({ enabled });
  }
  setSettings(status, writable) {
    if (this.snapshotCache.settingsStatus === status && this.snapshotCache.settingsWritable === writable) return;
    this.publish({ settingsStatus: status, settingsWritable: writable });
  }
  /** 页面内浮层开关（默认关）。 */
  setUiPopup(uiPopup) {
    if (this.snapshotCache.uiPopup === uiPopup) return;
    this.publish({ uiPopup });
  }
  /** 自定义音频配置（默认不启用）。 */
  setSound(patch) {
    const s = this.snapshotCache;
    if (s.soundEnabled === patch.enabled && s.soundPath === patch.path) return;
    this.publish({ soundEnabled: patch.enabled, soundPath: patch.path });
  }
  /** 是否配置了可播放的音频来源。 */
  hasSound() {
    const s = this.snapshotCache;
    return s.soundEnabled && s.soundPath.trim() !== "";
  }
  /** 吸收一份服务端快照：新增未决/完成提醒，撤下已解决的粘性弹窗。 */
  absorb(state) {
    this.publish({ connection: "ok", lastError: null, pendingCount: state.pending.length });
    const pendingIds = new Set(state.pending.map((item) => item.id));
    for (const item of state.pending) this.toastForItem(item);
    for (const item of state.recent) this.toastForItem(item);
    const resolved = [...this.snapshotCache.toasts].filter(
      (toast) => toast.sticky && toast.itemId !== null && !pendingIds.has(toast.itemId)
    );
    if (resolved.length > 0) {
      const gone = new Set(resolved.map((toast) => toast.key));
      this.publish({ toasts: this.snapshotCache.toasts.filter((toast) => !gone.has(toast.key)) });
      for (const key of gone) this.clearTimer(key);
    }
  }
  dismiss(key) {
    if (!this.snapshotCache.toasts.some((toast) => toast.key === key)) return;
    this.publish({ toasts: this.snapshotCache.toasts.filter((toast) => toast.key !== key) });
    this.clearTimer(key);
  }
  /** 本地测试弹窗：不经过服务端，便于用户在设置页验证外观。 */
  pushTest(kind) {
    this.addToast({
      itemId: null,
      kind,
      title: "\u4EFB\u52A1\u63D0\u9192",
      summary: kind === "complete" ? '\u8FD9\u662F\u4E00\u6761"\u4EFB\u52A1\u5B8C\u6210"\u6D4B\u8BD5\u63D0\u9192' : kind === "approval" ? '\u8FD9\u662F\u4E00\u6761"\u9700\u8981\u6279\u51C6"\u6D4B\u8BD5\u63D0\u9192' : '\u8FD9\u662F\u4E00\u6761"\u9700\u8981\u56DE\u7B54"\u6D4B\u8BD5\u63D0\u9192',
      sticky: kind !== "complete"
    });
  }
  // ---- 内部 ----
  /**
   * 绑定 `dsh-inform` 命名空间表单（apply 期调用一次），并把它接进快照。
   * 返回解绑函数；表单自身的释放归调用 fiber。
   */
  attachSettings(scope) {
    this.scope = scope;
    const sync = () => {
      const snap = scope.getSnapshot();
      const value = snap.value;
      this.setSettings(snap.status, snap.writable);
      this.setEnabled({
        complete: value ? value.notifyOnComplete !== false : true,
        approval: value ? value.notifyOnApproval !== false : true,
        question: value ? value.notifyOnAnswer !== false : true
      });
      this.setUiPopup(value?.uiPopup === true);
      this.setSound({
        enabled: value?.soundEnabled === true,
        path: typeof value?.soundPath === "string" ? value.soundPath : ""
      });
    };
    sync();
    const unsubscribe = scope.subscribe(sync);
    return () => {
      unsubscribe();
      if (this.scope === scope) this.scope = null;
    };
  }
  /** 写一个开关字段（覆盖用户层）；设置不可写时静默忽略。数值/文本字段同样支持。 */
  async setField(field, value) {
    await this.scope?.set(field, value);
  }
  /** 清除全部覆盖：所有字段回到组合 base / schema 默认。 */
  async resetFields() {
    const scope = this.scope;
    if (!scope) return;
    for (const field of [
      "notifyOnComplete",
      "notifyOnApproval",
      "notifyOnAnswer",
      "uiPopup",
      "soundEnabled",
      "soundPath"
    ]) {
      await scope.unset(field);
    }
  }
  toastForItem(item) {
    if (this.seenItemIds.has(item.id)) return;
    this.seenItemIds.add(item.id);
    if (!flagsForKind(this.snapshotCache.enabled, item.kind)) return;
    this.addToast({
      itemId: item.id,
      kind: item.kind,
      title: item.title || "\u4F1A\u8BDD",
      summary: item.summary,
      detail: item.detail,
      sticky: item.kind !== "complete"
    });
  }
  addToast(model) {
    this.toastSeq += 1;
    const toast = { ...model, key: `toast-${this.toastSeq}` };
    let toasts = [...this.snapshotCache.toasts, toast];
    while (toasts.length > MAX_TOASTS) toasts = toasts.slice(1);
    this.publish({ toasts });
    if (!toast.sticky) {
      this.timers.set(toast.key, setTimeout(() => this.dismiss(toast.key), AUTO_DISMISS_MS));
    }
    if (this.onDeliver) {
      try {
        this.onDeliver({
          kind: toast.kind,
          title: toast.title,
          body: toast.detail ? `${toast.summary}
${toast.detail}` : toast.summary,
          tag: toast.itemId === null ? `test-${this.toastSeq}` : `item-${toast.itemId}`
        });
      } catch {
      }
    }
  }
  clearTimer(key) {
    const timer = this.timers.get(key);
    if (timer !== void 0) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
  publish(patch) {
    this.snapshotCache = { ...this.snapshotCache, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
};
function defaultFetchState(baseUrl) {
  return async (since) => {
    const url = `${baseUrl}plugins/dsh-inform/api/state?since=${since}`;
    let response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      response = await fetch(url, { cache: "no-store", credentials: "include" });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!isRemindState(body)) throw new Error("unexpected response shape");
    return body;
  };
}
function createPoller(options) {
  const store = options.store;
  const fetchState = options.fetchState ?? defaultFetchState("/");
  const intervalMs = options.intervalMs ?? 2e3;
  let cursor = null;
  let inFlight = false;
  let disposed = false;
  async function tick() {
    if (inFlight || disposed) return;
    inFlight = true;
    try {
      const isFirstRead = cursor === null;
      const state = await fetchState(cursor ?? 0);
      if (disposed) return;
      cursor = state.cursor;
      const effective = isFirstRead ? { ...state, recent: [] } : state;
      store.absorb(effective);
    } catch (error) {
      if (!disposed) store.markConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight = false;
    }
  }
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return {
    tick,
    dispose() {
      disposed = true;
      clearInterval(timer);
    }
  };
}

// src/client/system.ts
function notificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}
async function requestNotificationPermission() {
  if (!notificationSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
function fireSystemNotification(payload) {
  if (!notificationSupported() || Notification.permission !== "granted") return false;
  try {
    const native = new Notification(payload.title, { body: payload.body, tag: payload.tag });
    native.onclick = () => {
      try {
        window.focus();
      } catch {
      }
      native.close();
    };
    return true;
  } catch {
    return false;
  }
}

// src/client/sound.ts
var MAX_PLAY_MS = 5e3;
var activeAudios = /* @__PURE__ */ new Set();
var armedReplay = false;
var pendingReplay = null;
function finishAudio(audio) {
  activeAudios.delete(audio);
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {
  }
}
function armGestureReplay() {
  if (armedReplay || typeof window === "undefined") return;
  armedReplay = true;
  window.addEventListener("pointerdown", () => {
    armedReplay = false;
    const spec = pendingReplay;
    pendingReplay = null;
    if (spec) playReminderSound(spec);
  }, { once: true });
}
function stopAllReminderSounds() {
  for (const audio of [...activeAudios]) finishAudio(audio);
}
function playReminderSound(spec) {
  if (!spec.url) return false;
  let audio;
  try {
    audio = new Audio(spec.url);
  } catch {
    return false;
  }
  audio.preload = "auto";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    finishAudio(audio);
  };
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", finish, { once: true });
  setTimeout(finish, MAX_PLAY_MS);
  activeAudios.add(audio);
  const playing = audio.play();
  if (playing !== void 0) {
    playing.then(() => {
      pendingReplay = null;
    }).catch(() => {
      finish();
      pendingReplay = { ...spec };
      armGestureReplay();
    });
  }
  return true;
}

// src/client/toasts.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var KIND_LABEL = {
  complete: "\u4EFB\u52A1\u5B8C\u6210",
  approval: "\u9700\u8981\u6279\u51C6",
  question: "\u9700\u8981\u56DE\u7B54"
};
var KIND_ICON = {
  complete: "\u2713",
  approval: "!",
  question: "?"
};
var INFORM_STYLE_SHEET = `
.dsh-inform-stack{position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:8px;width:320px;max-width:calc(100vw - 32px);z-index:10000;pointer-events:none}
.dsh-inform-card{pointer-events:auto;background:#ffffff;color:#1f2328;border:1px solid rgba(0,0,0,0.14);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.14);padding:10px 12px}
.dsh-inform-card[data-kind="complete"]{border-left:3px solid #22a06b}
.dsh-inform-card[data-kind="approval"]{border-left:3px solid #d97706}
.dsh-inform-card[data-kind="question"]{border-left:3px solid #3b82f6}
@media (prefers-color-scheme:dark){.dsh-inform-card{background:#22272e;color:#e6edf3;border-color:rgba(255,255,255,0.14)}}
.dsh-inform-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.dsh-inform-badge{flex-shrink:0;font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;color:#fff;white-space:nowrap}
.dsh-inform-badge[data-kind="complete"]{background:#22a06b}
.dsh-inform-badge[data-kind="approval"]{background:#d97706}
.dsh-inform-badge[data-kind="question"]{background:#3b82f6}
.dsh-inform-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dsh-inform-close{flex-shrink:0;border:none;background:transparent;color:inherit;opacity:.55;cursor:pointer;font:inherit;line-height:1;padding:2px}
.dsh-inform-close:hover,.dsh-inform-close:focus-visible{opacity:1}
.dsh-inform-summary{margin:0;word-break:break-word;white-space:pre-wrap}
.dsh-inform-detail{margin:6px 0 0;opacity:.75;white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
`;
function ToastCard({ toast, onClose }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-inform-card", "data-kind": toast.kind, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-inform-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-inform-badge", "data-kind": toast.kind, children: [
        KIND_ICON[toast.kind],
        " ",
        KIND_LABEL[toast.kind]
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-inform-title", title: toast.title, children: toast.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-inform-close", "aria-label": "\u5173\u95ED\u63D0\u9192", onClick: onClose, children: "\u2715" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-inform-summary", children: toast.summary }),
    toast.detail ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-inform-detail", title: toast.detail, children: toast.detail }) : null
  ] });
}
function ToastStack({ remind }) {
  const snapshot = (0, import_react.useSyncExternalStore)(remind.subscribe, remind.getSnapshot);
  if (!snapshot.uiPopup) return null;
  if (snapshot.toasts.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-inform-stack", role: "status", "aria-live": "polite", children: snapshot.toasts.map((toast) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToastCard, { toast, onClose: () => remind.dismiss(toast.key) }, toast.key)) });
}

// src/client/section.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var STORED_SENTINEL = "@stored";
var TOGGLES = [
  { field: "notifyOnComplete", flag: "complete", label: "\u4EFB\u52A1\u5B8C\u6210\u65F6\u63D0\u9192", description: "\u4E00\u4E2A\u56DE\u5408\u7ED3\u675F\uFF08\u5B8C\u6210\u3001\u51FA\u9519\u6216\u8FBE\u5230\u4E0A\u9650\uFF09\u65F6\u5F39\u7A97" },
  { field: "notifyOnApproval", flag: "approval", label: "\u9700\u8981\u6279\u51C6\u65F6\u63D0\u9192", description: "\u5DE5\u5177\u6267\u884C\u7B49\u5F85\u4F60\u6279\u51C6\u65F6\u5F39\u7A97" },
  { field: "notifyOnAnswer", flag: "question", label: "\u9700\u8981\u56DE\u7B54\u65F6\u63D0\u9192", description: "\u6A21\u578B\u901A\u8FC7 ask_user_question \u63D0\u95EE\u7B49\u5F85\u56DE\u7B54\u65F6\u5F39\u7A97" }
];
var pageStyle = {
  maxWidth: 560,
  display: "flex",
  flexDirection: "column",
  gap: 16
};
var introStyle = { margin: 0, opacity: 0.8 };
var rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "10px 0",
  borderBottom: "1px solid rgba(127,127,127,0.18)"
};
var rowLabelStyle = { fontWeight: 600 };
var rowDescStyle = { margin: "2px 0 0", opacity: 0.7 };
var editorBoxStyle = {
  margin: "8px 0 4px",
  padding: "10px 12px",
  border: "1px solid rgba(127,127,127,0.25)",
  borderRadius: 8,
  display: "flex",
  flexDirection: "column",
  gap: 10
};
function Switch({ checked, disabled, onChange, label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      disabled,
      onClick: () => onChange(!checked),
      style: {
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid rgba(127,127,127,0.4)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "#22a06b" : "rgba(127,127,127,0.35)",
        opacity: disabled ? 0.5 : 1,
        transition: "none"
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "span",
        {
          style: {
            position: "absolute",
            top: 2,
            left: checked ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)"
          }
        }
      )
    }
  );
}
function RemindSection({ remind }) {
  const snapshot = (0, import_react2.useSyncExternalStore)(remind.subscribe, remind.getSnapshot);
  const ready = snapshot.settingsStatus === "ready" && snapshot.settingsWritable;
  const fileInputRef = (0, import_react2.useRef)(null);
  const [soundFileName, setSoundFileName] = (0, import_react2.useState)("");
  const [uploadError, setUploadError] = (0, import_react2.useState)("");
  const onPickFile = async (file) => {
    const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase() : "";
    setUploadError("");
    setSoundFileName(`\u4E0A\u4F20\u4E2D\u2026 ${file.name}`);
    try {
      const body = await file.arrayBuffer();
      const response = await fetch(`/plugins/dsh-inform/api/sound/upload?ext=${encodeURIComponent(ext)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `HTTP ${response.status}`);
      }
      await remind.setField("soundPath", STORED_SENTINEL);
      setSoundFileName(`\u5DF2\u4FDD\u5B58\uFF1A${file.name}`);
    } catch (error) {
      setSoundFileName("");
      setUploadError(`\u4E0A\u4F20\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: pageStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: INFORM_STYLE_SHEET }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: introStyle, children: "\u5F53 DSH \u5B8C\u6210\u4EFB\u52A1\u3001\u9700\u8981\u6279\u51C6\u6216\u9700\u8981\u56DE\u7B54\u65F6\uFF0C\u901A\u8FC7\u64CD\u4F5C\u7CFB\u7EDF\u7EA7\u7CFB\u7EDF\u901A\u77E5\u63D0\u9192\uFF1B \u53EF\u9009\u81EA\u5B9A\u4E49\u97F3\u9891\u4E0E\u9875\u9762\u5185\u6D6E\u5C42\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF09\u3002\u5F00\u5173\u7ACB\u5373\u751F\u6548\u5E76\u6301\u4E45\u4FDD\u5B58\u5230\u7528\u6237\u8BBE\u7F6E\u6587\u6863\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
      TOGGLES.map(({ field, flag, label, description }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: rowStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: rowLabelStyle, children: label }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: rowDescStyle, children: description })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          Switch,
          {
            label,
            checked: snapshot.enabled[flag],
            disabled: !ready,
            onChange: (next) => {
              void remind.setField(field, next);
            }
          }
        )
      ] }, field)),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: rowStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: rowLabelStyle, children: "\u542F\u52A8\u5668 UI \u5F39\u7A97" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: rowDescStyle, children: "\u63D0\u9192\u65F6\u5728\u9875\u9762\u53F3\u4E0A\u89D2\u540C\u65F6\u663E\u793A\u6D6E\u5C42\u5361\u7247\uFF1B\u9ED8\u8BA4\u5173\u95ED\uFF0C\u4EC5\u7CFB\u7EDF\u901A\u77E5" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          Switch,
          {
            label: "\u542F\u52A8\u5668 UI \u5F39\u7A97",
            checked: snapshot.uiPopup,
            disabled: !ready,
            onChange: (next) => {
              void remind.setField("uiPopup", next);
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...rowStyle, borderBottom: "none" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: rowLabelStyle, children: "\u81EA\u5B9A\u4E49\u63D0\u9192\u97F3\u9891" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: rowDescStyle, children: "\u63D0\u9192\u65F6\u4ECE\u5934\u64AD\u653E\u6240\u9009\u97F3\u9891\uFF0C\u6700\u957F 5 \u79D2\uFF1B\u9ED8\u8BA4\u4E0D\u542F\u7528\uFF08\u9759\u9ED8\uFF09" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          Switch,
          {
            label: "\u81EA\u5B9A\u4E49\u63D0\u9192\u97F3\u9891",
            checked: snapshot.soundEnabled,
            disabled: !ready,
            onChange: (next) => {
              void remind.setField("soundEnabled", next);
            }
          }
        )
      ] }),
      snapshot.soundEnabled ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...editorBoxStyle, borderBottom: "1px solid rgba(127,127,127,0.18)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              disabled: !ready,
              onClick: () => fileInputRef.current?.click(),
              title: "\u9009\u62E9 mp3/wav/ogg/m4a/flac/aac \u97F3\u9891\uFF1B\u6587\u4EF6\u4FDD\u5B58\u5728 DSH \u6570\u636E\u76EE\u5F55\uFF0C\u968F\u8BBE\u7F6E\u6301\u4E45\u751F\u6548",
              style: { cursor: ready ? "pointer" : "not-allowed", font: "inherit", padding: "4px 10px", borderRadius: 6, opacity: ready ? 1 : 0.5 },
              children: "\u9009\u62E9\u672C\u5730\u97F3\u9891\u6587\u4EF6\u2026"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              ref: fileInputRef,
              type: "file",
              accept: "audio/*,.mp3,.wav,.ogg,.oga,.m4a,.flac,.aac,.webm",
              style: { display: "none" },
              onChange: (e) => {
                const file = e.target.files?.[0];
                if (file) void onPickFile(file);
                e.target.value = "";
              }
            }
          ),
          snapshot.soundPath === STORED_SENTINEL ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { opacity: 0.7 }, children: [
            "\u5F53\u524D\uFF1A",
            soundFileName || "\u5DF2\u4E0A\u4F20\u7684\u97F3\u9891"
          ] }) : snapshot.soundPath ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { opacity: 0.7 }, children: [
            "\u5F53\u524D\uFF1A",
            snapshot.soundPath
          ] }) : null
        ] }),
        uploadError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { margin: 0, color: "#d97706" }, children: uploadError }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            onClick: () => {
              playReminderSound({ url: `/plugins/dsh-inform/api/sound?t=${Date.now()}` });
            },
            title: "\u6309\u5DF2\u4FDD\u5B58\u7684\u97F3\u9891\u8BD5\u542C\uFF08\u4ECE\u5934\u64AD\uFF0C\u6700\u591A 5 \u79D2\uFF09",
            style: { cursor: "pointer", font: "inherit", padding: "4px 10px", borderRadius: 6, alignSelf: "flex-start" },
            children: "\u8BD5\u542C"
          }
        )
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { opacity: 0.75 }, children: [
        "\u8FDE\u63A5",
        snapshot.connection === "ok" ? "\u6B63\u5E38" : snapshot.connection === "error" ? "\u5F02\u5E38" : "\u4E2D\u2026",
        "\uFF1B\u5F85\u5904\u7406 ",
        snapshot.pendingCount,
        " \u6761"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "button",
        {
          type: "button",
          onClick: () => {
            void requestNotificationPermission().then(() => remind.pushTest("complete"));
          },
          disabled: snapshot.connection === "error",
          title: snapshot.connection === "error" ? `\u53D6\u6570\u5931\u8D25\uFF1A${snapshot.lastError ?? "unknown"}` : void 0,
          style: { cursor: snapshot.connection === "error" ? "not-allowed" : "pointer", font: "inherit", padding: "4px 10px", borderRadius: 6, opacity: snapshot.connection === "error" ? 0.5 : 1 },
          children: "\u89E6\u53D1\u6D4B\u8BD5\u5F39\u7A97"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "button",
        {
          type: "button",
          onClick: () => {
            void remind.resetFields();
          },
          disabled: !ready,
          title: "\u6E05\u9664\u8986\u76D6\uFF0C\u6062\u590D\u90E8\u7F72\u9ED8\u8BA4\u503C",
          style: { cursor: ready ? "pointer" : "not-allowed", font: "inherit", padding: "4px 10px", borderRadius: 6, opacity: ready ? 1 : 0.5 },
          children: "\u6062\u590D\u9ED8\u8BA4"
        }
      )
    ] }),
    snapshot.connection === "error" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { ...introStyle, color: "#d97706" }, children: [
      "\u72B6\u6001\u8F6E\u8BE2\u5931\u8D25\uFF1A",
      snapshot.lastError ?? "unknown",
      "\u3002\u82E5\u4E3A HTTP 401/403\uFF0C\u8BF4\u660E\u6B64\u90E8\u7F72\u7684\u9274\u6743\u680F\u672A\u653E\u884C\u672C\u63D2\u4EF6 \u8DEF\u5F84\u2014\u2014\u8BF7\u628A\u8FD9\u6761\u63D0\u793A\u8FDE\u540C F12 Network \u91CC\u8BE5\u8BF7\u6C42\u7684\u54CD\u5E94\u4E00\u8D77\u53CD\u9988\u3002"
    ] }) : null,
    snapshot.settingsStatus === "unavailable" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { ...introStyle, color: "#d97706" }, children: "\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u8BBF\u95EE\u8BBE\u7F6E\u6587\u6863\uFF08\u4F8B\u5982\u975E\u672C\u673A\u56DE\u73AF\u8BBF\u95EE\uFF09\uFF0C\u5F00\u5173\u5728\u6B64\u4E0D\u53EF\u7528\uFF1B\u5F39\u7A97\u884C\u4E3A\u6309\u9ED8\u8BA4\u5F00\u542F\u5904\u7406\u3002" }) : null
  ] });
}

// src/client/index.tsx
var INFORM_NAMESPACE = "dsh-inform";
var inject = ["slots", "configForms"];
function apply(ctx) {
  const store = new RemindStore();
  ctx.effect(() => () => store.dispose(), "dsh-inform: store");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = INFORM_STYLE_SHEET;
    style.dataset.plugin = "dsh-inform";
    document.head.append(style);
    return () => {
      style.remove();
    };
  }, "dsh-inform: stylesheet");
  try {
    const scope = ctx.configForms.get(INFORM_NAMESPACE);
    const detach = store.attachSettings(scope);
    ctx.effect(() => detach, "dsh-inform: settings form");
  } catch {
    store.setSettings("unavailable", false);
  }
  ctx.effect(() => {
    const poller = createPoller({ store });
    return () => poller.dispose();
  }, "dsh-inform: poller");
  ctx.effect(() => {
    store.onDeliver = (payload) => {
      fireSystemNotification({
        title: payload.title,
        body: payload.body,
        tag: `dsh-inform:${payload.tag}`
      });
      if (store.hasSound()) {
        playReminderSound({
          // 时间戳防缓存：设置改完下一次提醒立即用新音频。从头播、最多 5 秒。
          url: `/plugins/dsh-inform/api/sound?t=${Date.now()}`
        });
      }
    };
    return () => {
      store.onDeliver = null;
      stopAllReminderSounds();
    };
  }, "dsh-inform: system notifications");
  ctx.slots.inject("shell.overlay", () => {
    const dispose = ctx.slots.register({
      name: "shell.overlay",
      id: "dsh-inform",
      order: 100,
      inject: () => ({ remind: store })
    }, ToastStack);
    return () => {
      dispose();
    };
  });
  ctx.slots.inject("settings.section", () => {
    const dispose = ctx.slots.register({
      name: "settings.section",
      id: "dsh-inform",
      order: 60,
      label: "\u4EFB\u52A1\u63D0\u9192",
      inject: () => ({ remind: store })
    }, RemindSection);
    return () => {
      dispose();
    };
  });
}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
//# sourceMappingURL=client.js.map
