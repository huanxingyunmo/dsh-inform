/**
 * 会话事件 → 提醒状态 的纯折叠器。
 *
 * 只依赖 dsh-session 的事件形状，不接触 cordis/服务/IO：
 * 宿主插件在 `session/event` 上喂事件，HTTP 端点拉快照，
 * 单元测试直接喂合成事件序列。
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { RemindItem, RemindKind, RemindState } from './wire.js';
/** 快照入参里需要的最小会话面（真实 Session 的结构子集）。 */
export interface TrackerSessionView {
    readonly id: string;
    readonly cwd?: string;
    /** 委派深度：顶层会话缺失或为 0；子代理 > 0。 */
    readonly delegationDepth?: number;
}
/**
 * turn/end 是否值得提醒：用户主动取消与崩溃恢复回放不打扰；
 * 其余原因都代表"这一轮有结果了"，只是措辞不同。
 */
export declare function describeTurnEnd(reason: {
    kind: string;
}): {
    notify: boolean;
    summary: string;
};
/** 从 ask_user_question 的原始 arguments JSON 里提取问题摘要；坏 JSON 安全降级。 */
export declare function summarizeAskUserArguments(raw: string): {
    summary: string;
    detail?: string;
};
export declare function truncate(text: string, max: number): string;
/** 提醒状态折叠器。一个部署进程一份，覆盖全部会话。 */
export declare class ReminderTracker {
    private nextId;
    private cursor;
    private readonly pending;
    private readonly pendingByKey;
    private readonly recent;
    private readonly titles;
    /** 当前已分配的最大 id。 */
    get cursorNow(): number;
    /** 折叠一条会话事件；`time` 允许注入以便测试确定性。 */
    onSessionEvent(session: TrackerSessionView, event: SessionEvent, time?: Date): void;
    /** 会话离开 store 时撤下其未决条目（提问随会话死亡而失效）。 */
    onSessionDisposed(session: TrackerSessionView): void;
    /**
     * 当前快照。`since` 之前的 recent 条目不再返回（客户端游标推进后）。
     * 顺带按 TTL 与容量修剪 recent，保证长期运行内存有界。
     */
    snapshot(since: number, now?: Date): RemindState;
    /** 测试辅助：未决条目数。 */
    get pendingCount(): number;
    private allocate;
    private addPending;
    private pushRecent;
    private removePending;
    private labelOf;
}
export type { RemindItem, RemindState, RemindKind };
