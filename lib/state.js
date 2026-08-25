const RECENT_TTL_MS = 15 * 60 * 1000;
const RECENT_MAX = 200;
function basename(path) {
    if (!path)
        return undefined;
    const normalized = path.replace(/[\\/]+$/, '');
    const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
    return index >= 0 ? normalized.slice(index + 1) : normalized;
}
/**
 * turn/end 是否值得提醒：用户主动取消与崩溃恢复回放不打扰；
 * 其余原因都代表"这一轮有结果了"，只是措辞不同。
 */
export function describeTurnEnd(reason) {
    switch (reason.kind) {
        case 'completed':
            return { notify: true, summary: '任务完成' };
        case 'error':
            return { notify: true, summary: '任务出错，回合已结束' };
        case 'max-tokens':
            return { notify: true, summary: '达到输出上限，回合结束' };
        case 'blocked':
            return { notify: true, summary: '任务受阻，回合已结束' };
        default:
            // aborted（用户取消）、interrupted（崩溃恢复）、disposed、未知扩展值
            return { notify: false, summary: '' };
    }
}
/** 从 ask_user_question 的原始 arguments JSON 里提取问题摘要；坏 JSON 安全降级。 */
export function summarizeAskUserArguments(raw) {
    let questions = [];
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.questions)) {
            questions = parsed.questions;
        }
    }
    catch {
        // 模型产出的 arguments 原样落日志，可能不是合法 JSON —— 保持空摘要即可
    }
    const texts = questions
        .map((q) => (typeof q.question === 'string' ? q.question.trim() : ''))
        .filter((text) => text.length > 0);
    if (texts.length === 0)
        return { summary: '模型提出了问题，等待回答' };
    const first = texts[0] ?? '';
    return { summary: truncate(first, 80), detail: truncate(texts.join('\n'), 400) };
}
export function truncate(text, max) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
/** 提醒状态折叠器。一个部署进程一份，覆盖全部会话。 */
export class ReminderTracker {
    nextId = 1;
    cursor = 0;
    pending = new Map();
    pendingByKey = new Map();
    recent = [];
    titles = new Map();
    /** 当前已分配的最大 id。 */
    get cursorNow() {
        return this.cursor;
    }
    /** 折叠一条会话事件；`time` 允许注入以便测试确定性。 */
    onSessionEvent(session, event, time = new Date()) {
        if (event.type === 'session/title') {
            const data = event.data;
            if (typeof data?.title === 'string' && data.title.length > 0)
                this.titles.set(session.id, data.title);
            return;
        }
        // 子代理会话的完成不打扰人：它们由父会话收集汇报；
        // 但审批仍要报（审批是对"人"的操作，fail-closed 下用户是唯一回答者）。
        const isApproval = event.type === 'approval/asked' || event.type === 'approval/decided';
        if ((session.delegationDepth ?? 0) > 0 && !isApproval) {
            return;
        }
        switch (event.type) {
            case 'turn/end': {
                const data = event.data;
                const verdict = describeTurnEnd(data.reason);
                if (!verdict.notify)
                    return;
                this.pushRecent({
                    id: this.allocate(),
                    kind: 'complete',
                    sessionId: session.id,
                    title: this.labelOf(session),
                    summary: verdict.summary,
                    at: time.toISOString(),
                });
                return;
            }
            case 'approval/asked': {
                const data = event.data;
                const key = `approval:${String(data.id)}`;
                if (this.pendingByKey.has(key))
                    return;
                this.addPending(key, {
                    id: this.allocate(),
                    kind: 'approval',
                    sessionId: session.id,
                    title: this.labelOf(session),
                    summary: truncate(`需要批准：${data.toolName}`, 120),
                    detail: typeof data.reason === 'string' && data.reason.length > 0 ? truncate(data.reason, 400) : undefined,
                    at: time.toISOString(),
                });
                return;
            }
            case 'approval/decided': {
                const data = event.data;
                this.removePending(`approval:${String(data.id)}`);
                return;
            }
            case 'tool/call': {
                const data = event.data;
                if (data.name !== 'ask_user_question')
                    return;
                const key = `question:${session.id}:${String(data.callId)}`;
                if (this.pendingByKey.has(key))
                    return;
                const { summary, detail } = summarizeAskUserArguments(data.arguments);
                this.addPending(key, {
                    id: this.allocate(),
                    kind: 'question',
                    sessionId: session.id,
                    title: this.labelOf(session),
                    summary,
                    detail,
                    at: time.toISOString(),
                });
                return;
            }
            case 'tool/result': {
                const data = event.data;
                this.removePending(`question:${session.id}:${String(data.message.callId ?? '')}`);
                return;
            }
            default:
                return;
        }
    }
    /** 会话离开 store 时撤下其未决条目（提问随会话死亡而失效）。 */
    onSessionDisposed(session) {
        for (const [itemId, entry] of [...this.pending]) {
            if (entry.item.sessionId === session.id && entry.key.startsWith('question:')) {
                this.pending.delete(itemId);
                this.pendingByKey.delete(entry.key);
            }
        }
    }
    /**
     * 当前快照。`since` 之前的 recent 条目不再返回（客户端游标推进后）。
     * 顺带按 TTL 与容量修剪 recent，保证长期运行内存有界。
     */
    snapshot(since, now = new Date()) {
        const cutoff = now.getTime() - RECENT_TTL_MS;
        for (let i = this.recent.length - 1; i >= 0; i -= 1) {
            const entry = this.recent[i];
            if (entry && Date.parse(entry.at) < cutoff)
                this.recent.splice(i, 1);
        }
        while (this.recent.length > RECENT_MAX)
            this.recent.shift();
        const fresh = this.recent.filter((item) => item.id > since);
        return {
            now: now.toISOString(),
            cursor: this.cursor,
            pending: [...this.pending.values()].map((entry) => entry.item),
            recent: fresh,
        };
    }
    /** 测试辅助：未决条目数。 */
    get pendingCount() {
        return this.pending.size;
    }
    allocate() {
        const id = this.nextId;
        this.nextId += 1;
        this.cursor = id;
        return id;
    }
    addPending(key, item) {
        this.pending.set(item.id, { item, key });
        this.pendingByKey.set(key, item.id);
    }
    pushRecent(item) {
        this.recent.push(item);
    }
    removePending(key) {
        const itemId = this.pendingByKey.get(key);
        if (itemId === undefined)
            return;
        this.pendingByKey.delete(key);
        this.pending.delete(itemId);
    }
    labelOf(session) {
        return this.titles.get(session.id) ?? basename(session.cwd) ?? session.id;
    }
}
