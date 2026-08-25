/**
 * 浏览器侧提醒状态仓库 + 轮询器。
 *
 * 纯 TypeScript、无 DOM/React 依赖：快照不可变、整体替换，
 * 既可直接配 useSyncExternalStore，也可放进 slot inject face；
 * 轮询器的取数函数可注入，便于在 Node 测试里驱动确定性序列。
 */
import { isRemindState } from '../wire.js';
const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 8000;
export function flagsForKind(flags, kind) {
    return kind === 'complete' ? flags.complete : kind === 'approval' ? flags.approval : flags.question;
}
export class RemindStore {
    listeners = new Set();
    snapshotCache = {
        toasts: [],
        connection: 'connecting',
        lastError: null,
        enabled: { complete: true, approval: true, question: true },
        uiPopup: false,
        soundEnabled: false,
        soundPath: '',
        settingsStatus: 'loading',
        settingsWritable: true,
        pendingCount: 0,
    };
    toastSeq = 0;
    seenItemIds = new Set();
    timers = new Map();
    /** 绑定的设置命名空间 scope；ui-settings 未组合时为 null（开关页降级为只读提示）。 */
    scope = null;
    /**
     * 送达钩子：页面内弹窗入栈时同步调用（含测试弹窗）。
     * 客户端 apply 把它接到系统通知上；抛异常只影响当前这条，不阻断弹窗栈。
     */
    onDeliver = null;
    getSnapshot = () => this.snapshotCache;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
    dispose() {
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        this.listeners.clear();
    }
    // ---- 变更入口（全部整体替换快照） ----
    setConnection(connection) {
        if (this.snapshotCache.connection === connection)
            return;
        this.publish({ connection });
    }
    /** 记录取数失败原因（设置页可见）；成功吸收会自动清空。 */
    markConnectionError(reason) {
        const text = reason ?? 'unknown';
        if (this.snapshotCache.connection === 'error' && this.snapshotCache.lastError === text)
            return;
        this.publish({ connection: 'error', lastError: text });
    }
    setEnabled(enabled) {
        const current = this.snapshotCache.enabled;
        if (current.complete === enabled.complete && current.approval === enabled.approval && current.question === enabled.question)
            return;
        this.publish({ enabled });
    }
    setSettings(status, writable) {
        if (this.snapshotCache.settingsStatus === status && this.snapshotCache.settingsWritable === writable)
            return;
        this.publish({ settingsStatus: status, settingsWritable: writable });
    }
    /** 页面内浮层开关（默认关）。 */
    setUiPopup(uiPopup) {
        if (this.snapshotCache.uiPopup === uiPopup)
            return;
        this.publish({ uiPopup });
    }
    /** 自定义音频配置（默认不启用）。 */
    setSound(patch) {
        const s = this.snapshotCache;
        if (s.soundEnabled === patch.enabled && s.soundPath === patch.path)
            return;
        this.publish({ soundEnabled: patch.enabled, soundPath: patch.path });
    }
    /** 是否配置了可播放的音频来源。 */
    hasSound() {
        const s = this.snapshotCache;
        return s.soundEnabled && s.soundPath.trim() !== '';
    }
    /** 吸收一份服务端快照：新增未决/完成提醒，撤下已解决的粘性弹窗。 */
    absorb(state) {
        this.publish({ connection: 'ok', lastError: null, pendingCount: state.pending.length });
        const pendingIds = new Set(state.pending.map((item) => item.id));
        for (const item of state.pending)
            this.toastForItem(item);
        for (const item of state.recent)
            this.toastForItem(item);
        // 已从 pending 消失的条目视为已解决：撤下对应粘性弹窗。
        const resolved = [...this.snapshotCache.toasts].filter((toast) => toast.sticky && toast.itemId !== null && !pendingIds.has(toast.itemId));
        if (resolved.length > 0) {
            const gone = new Set(resolved.map((toast) => toast.key));
            this.publish({ toasts: this.snapshotCache.toasts.filter((toast) => !gone.has(toast.key)) });
            for (const key of gone)
                this.clearTimer(key);
        }
    }
    dismiss(key) {
        if (!this.snapshotCache.toasts.some((toast) => toast.key === key))
            return;
        this.publish({ toasts: this.snapshotCache.toasts.filter((toast) => toast.key !== key) });
        this.clearTimer(key);
    }
    /** 本地测试弹窗：不经过服务端，便于用户在设置页验证外观。 */
    pushTest(kind) {
        this.addToast({
            itemId: null,
            kind,
            title: '任务提醒',
            summary: kind === 'complete'
                ? '这是一条"任务完成"测试提醒'
                : kind === 'approval'
                    ? '这是一条"需要批准"测试提醒'
                    : '这是一条"需要回答"测试提醒',
            sticky: kind !== 'complete',
        });
    }
    // ---- 内部 ----
    /**
     * 绑定 `dsh-inform` 命名空间 scope（apply 期调用一次），并把它接进快照。
     * 返回解绑函数；scope 自身的释放归调用 fiber。
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
                question: value ? value.notifyOnAnswer !== false : true,
            });
            // uiPopup / sound* 默认关：文档缺字段时按 schema 默认（false/''）处理。
            this.setUiPopup(value?.uiPopup === true);
            this.setSound({
                enabled: value?.soundEnabled === true,
                path: typeof value?.soundPath === 'string' ? value.soundPath : '',
            });
        };
        sync();
        const unsubscribe = scope.subscribe(sync);
        return () => {
            unsubscribe();
            if (this.scope === scope)
                this.scope = null;
        };
    }
    /** 写一个开关字段（覆盖用户层）；设置不可写时静默忽略。数值/文本字段同样支持。 */
    async setField(field, value) {
        await this.scope?.set(field, value);
    }
    /** 清除全部覆盖：所有字段回到组合 base / schema 默认。 */
    async resetFields() {
        const scope = this.scope;
        if (!scope)
            return;
        for (const field of [
            'notifyOnComplete', 'notifyOnApproval', 'notifyOnAnswer',
            'uiPopup', 'soundEnabled', 'soundPath',
        ]) {
            await scope.unset(field);
        }
    }
    toastForItem(item) {
        if (this.seenItemIds.has(item.id))
            return;
        this.seenItemIds.add(item.id);
        if (!flagsForKind(this.snapshotCache.enabled, item.kind))
            return;
        this.addToast({
            itemId: item.id,
            kind: item.kind,
            title: item.title || '会话',
            summary: item.summary,
            detail: item.detail,
            sticky: item.kind !== 'complete',
        });
    }
    addToast(model) {
        this.toastSeq += 1;
        const toast = { ...model, key: `toast-${this.toastSeq}` };
        let toasts = [...this.snapshotCache.toasts, toast];
        while (toasts.length > MAX_TOASTS)
            toasts = toasts.slice(1);
        this.publish({ toasts });
        if (!toast.sticky) {
            this.timers.set(toast.key, setTimeout(() => this.dismiss(toast.key), AUTO_DISMISS_MS));
        }
        if (this.onDeliver) {
            try {
                this.onDeliver({
                    kind: toast.kind,
                    title: toast.title,
                    body: toast.detail ? `${toast.summary}\n${toast.detail}` : toast.summary,
                    tag: toast.itemId === null ? `test-${this.toastSeq}` : `item-${toast.itemId}`,
                });
            }
            catch {
                // 通知通道故障不拖垮弹窗栈。
            }
        }
    }
    clearTimer(key) {
        const timer = this.timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
    }
    publish(patch) {
        this.snapshotCache = { ...this.snapshotCache, ...patch };
        for (const listener of [...this.listeners])
            listener();
    }
}
/** 默认取数：同源轮询本插件的 state 端点，no-store 且响应形状防御校验。
 *  路径挂在 `/plugins/<id>/` 下——加固部署的鉴权栏只放行已知前缀，
 *  该命名空间经模块加载器（script 标签）证实浏览器可达。
 *  401/403 时显式带 include 凭据重试一次，兼容跨站 Cookie 场景。 */
export function defaultFetchState(baseUrl) {
    return async (since) => {
        const url = `${baseUrl}plugins/dsh-inform/api/state?since=${since}`;
        let response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
        if (response.status === 401 || response.status === 403) {
            response = await fetch(url, { cache: 'no-store', credentials: 'include' });
        }
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!isRemindState(body))
            throw new Error('unexpected response shape');
        return body;
    };
}
/** 固定间隔轮询器：in-flight 防重入；失败保留最后成功快照并标记连接异常。 */
export function createPoller(options) {
    const store = options.store;
    const fetchState = options.fetchState ?? defaultFetchState('/');
    const intervalMs = options.intervalMs ?? 2000;
    let cursor = null;
    let inFlight = false;
    let disposed = false;
    async function tick() {
        if (inFlight || disposed)
            return;
        inFlight = true;
        try {
            const isFirstRead = cursor === null;
            const state = await fetchState(cursor ?? 0);
            if (disposed)
                return;
            cursor = state.cursor;
            // 基线读只吸收当前未决项，历史 recent 不补放（避免刷新页面后旧完成提醒刷屏）。
            const effective = isFirstRead ? { ...state, recent: [] } : state;
            store.absorb(effective);
        }
        catch (error) {
            if (!disposed)
                store.markConnectionError(error instanceof Error ? error.message : String(error));
        }
        finally {
            inFlight = false;
        }
    }
    const timer = setInterval(() => { void tick(); }, intervalMs);
    void tick();
    return {
        tick,
        dispose() {
            disposed = true;
            clearInterval(timer);
        },
    };
}
