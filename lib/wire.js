/**
 * dsh-inform 的宿主 ↔ 浏览器 wire 契约。
 *
 * 纯类型模块：两侧都以 type-only 方式引用，不产生任何运行时依赖，
 * 避免 host/client 双 tsconfig 的 Context 增强相互污染（skill §5.3 红线）。
 */
/** 运行时校验未知 JSON 是否为一条提醒条目（客户端轮询响应防御）。 */
export function isRemindItem(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return (typeof v.id === 'number' && Number.isFinite(v.id) &&
        (v.kind === 'complete' || v.kind === 'approval' || v.kind === 'question') &&
        typeof v.sessionId === 'string' &&
        typeof v.title === 'string' &&
        typeof v.summary === 'string' &&
        typeof v.at === 'string');
}
/** 运行时校验未知 JSON 是否为一份提醒状态快照。 */
export function isRemindState(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    if (typeof v.now !== 'string' || typeof v.cursor !== 'number' || !Number.isFinite(v.cursor))
        return false;
    if (!Array.isArray(v.pending) || !v.pending.every(isRemindItem))
        return false;
    if (!Array.isArray(v.recent) || !v.recent.every(isRemindItem))
        return false;
    return true;
}
