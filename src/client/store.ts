/**
 * 浏览器侧提醒状态仓库 + 轮询器。
 *
 * 纯 TypeScript、无 DOM/React 依赖：快照不可变、整体替换，
 * 既可直接配 useSyncExternalStore，也可放进 slot inject face；
 * 轮询器的取数函数可注入，便于在 Node 测试里驱动确定性序列。
 */
import { isRemindState, type RemindItem, type RemindKind, type RemindState } from '../wire.js'
// 0.2 起客户端设置面由 `settingsScope` 服务改为 `ctx.configForms` 派生的 ConfigForm：
// 读面（getSnapshot/subscribe）与写面（set/unset）与旧 scoped 设置面同形。
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

export interface ToastModel {
    /** 稳定 React key；与来源条目 id 解耦（测试弹窗没有真实 id）。 */
    readonly key: string
    /** 来源条目 id；未决解析按它撤下粘性弹窗，测试弹窗为 null。 */
    readonly itemId: number | null
    readonly kind: RemindKind
    readonly title: string
    readonly summary: string
    readonly detail?: string
    /** 未决类（审批/提问）粘住直到解决；完成类自动消失。 */
    readonly sticky: boolean
}

export interface EnabledFlags {
    readonly complete: boolean
    readonly approval: boolean
    readonly question: boolean
}

export interface RemindSnapshot {
    readonly toasts: readonly ToastModel[]
    readonly connection: 'connecting' | 'ok' | 'error'
    /** 最近一次取数失败的简述（HTTP 状态/异常消息）；连接正常时为 null。 */
    readonly lastError: string | null
    readonly enabled: EnabledFlags
    /** 页面内（启动器 UI）浮层开关；默认关闭——默认只发系统通知。 */
    readonly uiPopup: boolean
    readonly soundEnabled: boolean
    /** 音频来源：'@stored'=设置页上传 / 本地路径 / URL。 */
    readonly soundPath: string
    readonly settingsStatus: 'loading' | 'ready' | 'unavailable'
    /** 设置文档是否接受写入（远程浏览器 memory 模式为只读）。 */
    readonly settingsWritable: boolean
    /** 最近一次快照里仍在等待人的条目数。 */
    readonly pendingCount: number
}

const MAX_TOASTS = 5
const AUTO_DISMISS_MS = 8000

/** `dsh-inform` 设置命名空间的形状（与宿主 Config 一致）。 */
export interface RemindSettings {
    notifyOnComplete: boolean
    notifyOnApproval: boolean
    notifyOnAnswer: boolean
    uiPopup: boolean
    soundEnabled: boolean
    soundPath: string
}

export function flagsForKind(flags: EnabledFlags, kind: RemindKind): boolean {
    return kind === 'complete' ? flags.complete : kind === 'approval' ? flags.approval : flags.question
}

/** 每当一条提醒真正送达（页面内弹窗入栈）时抛出，供系统通知等额外通道路由。 */
export interface DeliverPayload {
    readonly kind: RemindKind
    readonly title: string
    readonly body: string
    /** OS 侧去重键：真实条目用 `item-<id>`，测试弹窗用 `test-<seq>`。 */
    readonly tag: string
}

export class RemindStore {
    private readonly listeners = new Set<() => void>()
    private snapshotCache: RemindSnapshot = {
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
    }
    private toastSeq = 0
    private readonly seenItemIds = new Set<number>()
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
    /** 绑定的设置命名空间表单；ui-settings 未组合时为 null（开关页降级为只读提示）。 */
    private scope: ConfigForm<RemindSettings> | null = null

    /**
     * 送达钩子：页面内弹窗入栈时同步调用（含测试弹窗）。
     * 客户端 apply 把它接到系统通知上；抛异常只影响当前这条，不阻断弹窗栈。
     */
    onDeliver: ((payload: DeliverPayload) => void) | null = null

    getSnapshot = (): RemindSnapshot => this.snapshotCache

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    dispose(): void {
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
        this.listeners.clear()
    }

    // ---- 变更入口（全部整体替换快照） ----

    setConnection(connection: RemindSnapshot['connection']): void {
        if (this.snapshotCache.connection === connection) return
        this.publish({ connection })
    }

    /** 记录取数失败原因（设置页可见）；成功吸收会自动清空。 */
    markConnectionError(reason?: string): void {
        const text = reason ?? 'unknown'
        if (this.snapshotCache.connection === 'error' && this.snapshotCache.lastError === text) return
        this.publish({ connection: 'error', lastError: text })
    }

    setEnabled(enabled: EnabledFlags): void {
        const current = this.snapshotCache.enabled
        if (current.complete === enabled.complete && current.approval === enabled.approval && current.question === enabled.question) return
        this.publish({ enabled })
    }

    setSettings(status: RemindSnapshot['settingsStatus'], writable: boolean): void {
        if (this.snapshotCache.settingsStatus === status && this.snapshotCache.settingsWritable === writable) return
        this.publish({ settingsStatus: status, settingsWritable: writable })
    }

    /** 页面内浮层开关（默认关）。 */
    setUiPopup(uiPopup: boolean): void {
        if (this.snapshotCache.uiPopup === uiPopup) return
        this.publish({ uiPopup })
    }

    /** 自定义音频配置（默认不启用）。 */
    setSound(patch: { enabled: boolean; path: string }): void {
        const s = this.snapshotCache
        if (s.soundEnabled === patch.enabled && s.soundPath === patch.path) return
        this.publish({ soundEnabled: patch.enabled, soundPath: patch.path })
    }

    /** 是否配置了可播放的音频来源。 */
    hasSound(): boolean {
        const s = this.snapshotCache
        return s.soundEnabled && s.soundPath.trim() !== ''
    }

    /** 吸收一份服务端快照：新增未决/完成提醒，撤下已解决的粘性弹窗。 */
    absorb(state: RemindState): void {
        this.publish({ connection: 'ok', lastError: null, pendingCount: state.pending.length })
        const pendingIds = new Set(state.pending.map((item) => item.id))
        for (const item of state.pending) this.toastForItem(item)
        for (const item of state.recent) this.toastForItem(item)
        // 已从 pending 消失的条目视为已解决：撤下对应粘性弹窗。
        const resolved = [...this.snapshotCache.toasts].filter(
            (toast) => toast.sticky && toast.itemId !== null && !pendingIds.has(toast.itemId),
        )
        if (resolved.length > 0) {
            const gone = new Set(resolved.map((toast) => toast.key))
            this.publish({ toasts: this.snapshotCache.toasts.filter((toast) => !gone.has(toast.key)) })
            for (const key of gone) this.clearTimer(key)
        }
    }

    dismiss(key: string): void {
        if (!this.snapshotCache.toasts.some((toast) => toast.key === key)) return
        this.publish({ toasts: this.snapshotCache.toasts.filter((toast) => toast.key !== key) })
        this.clearTimer(key)
    }

    /** 本地测试弹窗：不经过服务端，便于用户在设置页验证外观。 */
    pushTest(kind: RemindKind): void {
        this.addToast({
            itemId: null,
            kind,
            title: '任务提醒',
            summary:
                kind === 'complete'
                    ? '这是一条"任务完成"测试提醒'
                    : kind === 'approval'
                        ? '这是一条"需要批准"测试提醒'
                        : '这是一条"需要回答"测试提醒',
            sticky: kind !== 'complete',
        })
    }

    // ---- 内部 ----

    /**
     * 绑定 `dsh-inform` 命名空间表单（apply 期调用一次），并把它接进快照。
     * 返回解绑函数；表单自身的释放归调用 fiber。
     */
    attachSettings(scope: ConfigForm<RemindSettings>): () => void {
        this.scope = scope
        const sync = (): void => {
            const snap: ConfigFormSnapshot<RemindSettings> = scope.getSnapshot()
            const value = snap.value
            this.setSettings(snap.status, snap.writable)
            this.setEnabled({
                complete: value ? value.notifyOnComplete !== false : true,
                approval: value ? value.notifyOnApproval !== false : true,
                question: value ? value.notifyOnAnswer !== false : true,
            })
            // uiPopup / sound* 默认关：文档缺字段时按 schema 默认（false/''）处理。
            this.setUiPopup(value?.uiPopup === true)
            this.setSound({
                enabled: value?.soundEnabled === true,
                path: typeof value?.soundPath === 'string' ? value.soundPath : '',
            })
        }
        sync()
        const unsubscribe = scope.subscribe(sync)
        return () => {
            unsubscribe()
            if (this.scope === scope) this.scope = null
        }
    }

    /** 写一个开关字段（覆盖用户层）；设置不可写时静默忽略。数值/文本字段同样支持。 */
    async setField(field: keyof RemindSettings, value: boolean | number | string): Promise<void> {
        await this.scope?.set(field, value as never)
    }

    /** 清除全部覆盖：所有字段回到组合 base / schema 默认。 */
    async resetFields(): Promise<void> {
        const scope = this.scope
        if (!scope) return
        for (const field of [
            'notifyOnComplete', 'notifyOnApproval', 'notifyOnAnswer',
            'uiPopup', 'soundEnabled', 'soundPath',
        ] as Array<keyof RemindSettings>) {
            await scope.unset(field)
        }
    }

    private toastForItem(item: RemindItem): void {
        if (this.seenItemIds.has(item.id)) return
        this.seenItemIds.add(item.id)
        if (!flagsForKind(this.snapshotCache.enabled, item.kind)) return
        this.addToast({
            itemId: item.id,
            kind: item.kind,
            title: item.title || '会话',
            summary: item.summary,
            detail: item.detail,
            sticky: item.kind !== 'complete',
        })
    }

    private addToast(model: Omit<ToastModel, 'key'>): void {
        this.toastSeq += 1
        const toast: ToastModel = { ...model, key: `toast-${this.toastSeq}` }
        let toasts = [...this.snapshotCache.toasts, toast]
        while (toasts.length > MAX_TOASTS) toasts = toasts.slice(1)
        this.publish({ toasts })
        if (!toast.sticky) {
            this.timers.set(toast.key, setTimeout(() => this.dismiss(toast.key), AUTO_DISMISS_MS))
        }
        if (this.onDeliver) {
            try {
                this.onDeliver({
                    kind: toast.kind,
                    title: toast.title,
                    body: toast.detail ? `${toast.summary}\n${toast.detail}` : toast.summary,
                    tag: toast.itemId === null ? `test-${this.toastSeq}` : `item-${toast.itemId}`,
                })
            } catch {
                // 通知通道故障不拖垮弹窗栈。
            }
        }
    }

    private clearTimer(key: string): void {
        const timer = this.timers.get(key)
        if (timer !== undefined) {
            clearTimeout(timer)
            this.timers.delete(key)
        }
    }

    private publish(patch: Partial<RemindSnapshot>): void {
        this.snapshotCache = { ...this.snapshotCache, ...patch }
        for (const listener of [...this.listeners]) listener()
    }
}

/** 默认取数：同源轮询本插件的 state 端点，no-store 且响应形状防御校验。
 *  路径挂在 `/plugins/<id>/` 下——加固部署的鉴权栏只放行已知前缀，
 *  该命名空间经模块加载器（script 标签）证实浏览器可达。
 *  401/403 时显式带 include 凭据重试一次，兼容跨站 Cookie 场景。 */
export function defaultFetchState(baseUrl: string): (since: number) => Promise<RemindState> {
    return async (since: number) => {
        const url = `${baseUrl}plugins/dsh-inform/api/state?since=${since}`
        let response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
        if (response.status === 401 || response.status === 403) {
            response = await fetch(url, { cache: 'no-store', credentials: 'include' })
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body: unknown = await response.json()
        if (!isRemindState(body)) throw new Error('unexpected response shape')
        return body
    }
}

export interface PollerOptions {
    store: RemindStore
    /** 可注入取数（测试）；缺省走 defaultFetchState('/')。 */
    fetchState?: (since: number) => Promise<RemindState>
    intervalMs?: number
}

export interface PollerHandle {
    /** 停止轮询并清理计时器（幂等）。 */
    dispose(): void
    /** 立即触发一次拉取（测试用）。 */
    tick(): Promise<void>
}

/** 固定间隔轮询器：in-flight 防重入；失败保留最后成功快照并标记连接异常。 */
export function createPoller(options: PollerOptions): PollerHandle {
    const store = options.store
    const fetchState = options.fetchState ?? defaultFetchState('/')
    const intervalMs = options.intervalMs ?? 2000
    let cursor: number | null = null
    let inFlight = false
    let disposed = false

    async function tick(): Promise<void> {
        if (inFlight || disposed) return
        inFlight = true
        try {
            const isFirstRead = cursor === null
            const state = await fetchState(cursor ?? 0)
            if (disposed) return
            cursor = state.cursor
            // 基线读只吸收当前未决项，历史 recent 不补放（避免刷新页面后旧完成提醒刷屏）。
            const effective = isFirstRead ? { ...state, recent: [] } : state
            store.absorb(effective)
        } catch (error) {
            if (!disposed) store.markConnectionError(error instanceof Error ? error.message : String(error))
        } finally {
            inFlight = false
        }
    }

    const timer = setInterval(() => { void tick() }, intervalMs)
    void tick()

    return {
        tick,
        dispose(): void {
            disposed = true
            clearInterval(timer)
        },
    }
}
