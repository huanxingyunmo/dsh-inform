/**
 * 浏览器侧提醒状态仓库 + 轮询器。
 *
 * 纯 TypeScript、无 DOM/React 依赖：快照不可变、整体替换，
 * 既可直接配 useSyncExternalStore，也可放进 slot inject face；
 * 轮询器的取数函数可注入，便于在 Node 测试里驱动确定性序列。
 */
import { type RemindKind, type RemindState } from '../wire.js';
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
export interface ToastModel {
    /** 稳定 React key；与来源条目 id 解耦（测试弹窗没有真实 id）。 */
    readonly key: string;
    /** 来源条目 id；未决解析按它撤下粘性弹窗，测试弹窗为 null。 */
    readonly itemId: number | null;
    readonly kind: RemindKind;
    readonly title: string;
    readonly summary: string;
    readonly detail?: string;
    /** 未决类（审批/提问）粘住直到解决；完成类自动消失。 */
    readonly sticky: boolean;
}
export interface EnabledFlags {
    readonly complete: boolean;
    readonly approval: boolean;
    readonly question: boolean;
}
export interface RemindSnapshot {
    readonly toasts: readonly ToastModel[];
    readonly connection: 'connecting' | 'ok' | 'error';
    /** 最近一次取数失败的简述（HTTP 状态/异常消息）；连接正常时为 null。 */
    readonly lastError: string | null;
    readonly enabled: EnabledFlags;
    /** 页面内（启动器 UI）浮层开关；默认关闭——默认只发系统通知。 */
    readonly uiPopup: boolean;
    readonly soundEnabled: boolean;
    /** 音频来源：'@stored'=设置页上传 / 本地路径 / URL。 */
    readonly soundPath: string;
    readonly settingsStatus: 'loading' | 'ready' | 'unavailable';
    /** 设置文档是否接受写入（远程浏览器 memory 模式为只读）。 */
    readonly settingsWritable: boolean;
    /** 最近一次快照里仍在等待人的条目数。 */
    readonly pendingCount: number;
}
/** `dsh-inform` 设置命名空间的形状（与宿主 Config 一致）。 */
export interface RemindSettings {
    notifyOnComplete: boolean;
    notifyOnApproval: boolean;
    notifyOnAnswer: boolean;
    uiPopup: boolean;
    soundEnabled: boolean;
    soundPath: string;
}
export declare function flagsForKind(flags: EnabledFlags, kind: RemindKind): boolean;
/** 每当一条提醒真正送达（页面内弹窗入栈）时抛出，供系统通知等额外通道路由。 */
export interface DeliverPayload {
    readonly kind: RemindKind;
    readonly title: string;
    readonly body: string;
    /** OS 侧去重键：真实条目用 `item-<id>`，测试弹窗用 `test-<seq>`。 */
    readonly tag: string;
}
export declare class RemindStore {
    private readonly listeners;
    private snapshotCache;
    private toastSeq;
    private readonly seenItemIds;
    private readonly timers;
    /** 绑定的设置命名空间 scope；ui-settings 未组合时为 null（开关页降级为只读提示）。 */
    private scope;
    /**
     * 送达钩子：页面内弹窗入栈时同步调用（含测试弹窗）。
     * 客户端 apply 把它接到系统通知上；抛异常只影响当前这条，不阻断弹窗栈。
     */
    onDeliver: ((payload: DeliverPayload) => void) | null;
    getSnapshot: () => RemindSnapshot;
    subscribe: (listener: () => void) => (() => void);
    dispose(): void;
    setConnection(connection: RemindSnapshot['connection']): void;
    /** 记录取数失败原因（设置页可见）；成功吸收会自动清空。 */
    markConnectionError(reason?: string): void;
    setEnabled(enabled: EnabledFlags): void;
    setSettings(status: RemindSnapshot['settingsStatus'], writable: boolean): void;
    /** 页面内浮层开关（默认关）。 */
    setUiPopup(uiPopup: boolean): void;
    /** 自定义音频配置（默认不启用）。 */
    setSound(patch: {
        enabled: boolean;
        path: string;
    }): void;
    /** 是否配置了可播放的音频来源。 */
    hasSound(): boolean;
    /** 吸收一份服务端快照：新增未决/完成提醒，撤下已解决的粘性弹窗。 */
    absorb(state: RemindState): void;
    dismiss(key: string): void;
    /** 本地测试弹窗：不经过服务端，便于用户在设置页验证外观。 */
    pushTest(kind: RemindKind): void;
    /**
     * 绑定 `dsh-inform` 命名空间 scope（apply 期调用一次），并把它接进快照。
     * 返回解绑函数；scope 自身的释放归调用 fiber。
     */
    attachSettings(scope: SettingsScope<RemindSettings>): () => void;
    /** 写一个开关字段（覆盖用户层）；设置不可写时静默忽略。数值/文本字段同样支持。 */
    setField(field: keyof RemindSettings, value: boolean | number | string): Promise<void>;
    /** 清除全部覆盖：所有字段回到组合 base / schema 默认。 */
    resetFields(): Promise<void>;
    private toastForItem;
    private addToast;
    private clearTimer;
    private publish;
}
/** 默认取数：同源轮询本插件的 state 端点，no-store 且响应形状防御校验。
 *  路径挂在 `/plugins/<id>/` 下——加固部署的鉴权栏只放行已知前缀，
 *  该命名空间经模块加载器（script 标签）证实浏览器可达。
 *  401/403 时显式带 include 凭据重试一次，兼容跨站 Cookie 场景。 */
export declare function defaultFetchState(baseUrl: string): (since: number) => Promise<RemindState>;
export interface PollerOptions {
    store: RemindStore;
    /** 可注入取数（测试）；缺省走 defaultFetchState('/')。 */
    fetchState?: (since: number) => Promise<RemindState>;
    intervalMs?: number;
}
export interface PollerHandle {
    /** 停止轮询并清理计时器（幂等）。 */
    dispose(): void;
    /** 立即触发一次拉取（测试用）。 */
    tick(): Promise<void>;
}
/** 固定间隔轮询器：in-flight 防重入；失败保留最后成功快照并标记连接异常。 */
export declare function createPoller(options: PollerOptions): PollerHandle;
