/**
 * dsh-inform 的宿主 ↔ 浏览器 wire 契约。
 *
 * 纯类型模块：两侧都以 type-only 方式引用，不产生任何运行时依赖，
 * 避免 host/client 双 tsconfig 的 Context 增强相互污染（skill §5.3 红线）。
 */

/** 三类可提醒事件。 */
export type RemindKind = 'complete' | 'approval' | 'question'

/** 一条提醒条目。 */
export interface RemindItem {
    /** 宿主分配的单调递增 id，客户端以此去重与推进游标。 */
    id: number
    kind: RemindKind
    /** 所属会话 id。 */
    sessionId: string
    /** 会话展示名（折叠的 session/title；缺省回退 cwd 基名或会话 id）。 */
    title: string
    /** 一行人话摘要。 */
    summary: string
    /** 可选补充信息（如审批原因、问题全文截断）。 */
    detail?: string
    /** 事件时间（ISO 字符串）。 */
    at: string
}

/** `GET /dsh-inform/api/state` 的响应体。 */
export interface RemindState {
    /** 服务端当前时间（ISO）。 */
    now: string
    /** 宿主已分配的最大条目 id；客户端下次以 `?since=<cursor>` 增量拉取。 */
    cursor: number
    /** 仍在等待人的条目（审批待批、提问待答），全量返回。 */
    pending: RemindItem[]
    /** 已结束回合的完成提醒，仅返回 id 大于 `since` 的部分。 */
    recent: RemindItem[]
}

/** 运行时校验未知 JSON 是否为一条提醒条目（客户端轮询响应防御）。 */
export function isRemindItem(value: unknown): value is RemindItem {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    return (
        typeof v.id === 'number' && Number.isFinite(v.id) &&
        (v.kind === 'complete' || v.kind === 'approval' || v.kind === 'question') &&
        typeof v.sessionId === 'string' &&
        typeof v.title === 'string' &&
        typeof v.summary === 'string' &&
        typeof v.at === 'string'
    )
}

/** 运行时校验未知 JSON 是否为一份提醒状态快照。 */
export function isRemindState(value: unknown): value is RemindState {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    if (typeof v.now !== 'string' || typeof v.cursor !== 'number' || !Number.isFinite(v.cursor)) return false
    if (!Array.isArray(v.pending) || !v.pending.every(isRemindItem)) return false
    if (!Array.isArray(v.recent) || !v.recent.every(isRemindItem)) return false
    return true
}
