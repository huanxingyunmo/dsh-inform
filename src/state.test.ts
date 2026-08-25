/**
 * ReminderTracker 纯折叠逻辑单测：合成会话事件序列 → 快照断言。
 * 毫秒级、零宿主（不 import cordis/服务）。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeTurnEnd, ReminderTracker, summarizeAskUserArguments } from './state.js'
import type { TrackerSessionView } from './state.js'

type AnyEvent = { type: string; data: unknown }

const rootSession: TrackerSessionView = { id: 'session-root', cwd: 'D:\\work\\demo-proj' }
const childSession: TrackerSessionView = { id: 'session-child', delegationDepth: 1 }

function feed(tracker: ReminderTracker, session: TrackerSessionView, event: AnyEvent): void {
    tracker.onSessionEvent(session, event as never)
}

describe('describeTurnEnd', () => {
    it('完成/出错/上限/受阻提醒，取消与崩溃恢复不打扰', () => {
        assert.equal(describeTurnEnd({ kind: 'completed' }).notify, true)
        assert.equal(describeTurnEnd({ kind: 'error' }).notify, true)
        assert.equal(describeTurnEnd({ kind: 'max-tokens' }).notify, true)
        assert.equal(describeTurnEnd({ kind: 'blocked' }).notify, true)
        assert.equal(describeTurnEnd({ kind: 'aborted' }).notify, false)
        assert.equal(describeTurnEnd({ kind: 'interrupted' }).notify, false)
        assert.equal(describeTurnEnd({ kind: 'disposed' }).notify, false)
    })
})

describe('summarizeAskUserArguments', () => {
    it('提取第一个问题为摘要，全文进 detail', () => {
        const { summary, detail } = summarizeAskUserArguments(
            JSON.stringify({
                questions: [
                    { id: 'a', question: '选择部署方式？' },
                    { id: 'b', question: '是否需要回滚方案？' },
                ],
            }),
        )
        assert.equal(summary, '选择部署方式？')
        assert.match(detail ?? '', /是否需要回滚方案？/)
    })

    it('坏 JSON 与空问题安全降级', () => {
        assert.equal(summarizeAskUserArguments('{oops').summary.length > 0, true)
        assert.equal(summarizeAskUserArguments('{"questions":[]}').summary.length > 0, true)
    })
})

describe('ReminderTracker', () => {
    it('turn/end 产生完成提醒并带会话标签；游标推进后 snapshot(since) 不再返回旧条目', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
        let state = tracker.snapshot(0)
        assert.equal(state.recent.length, 1)
        assert.equal(state.recent[0]!.kind, 'complete')
        assert.equal(state.recent[0]!.title, 'demo-proj') // 无 title 时回退 cwd 基名
        state = tracker.snapshot(state.cursor)
        assert.equal(state.recent.length, 0)
    })

    it('用户取消的回合不产生提醒', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
        assert.equal(tracker.snapshot(0).recent.length, 0)
    })

    it('审批 asked→pending，decided→撤下', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, { type: 'approval/asked', data: { id: 'ap-1', toolName: 'pwsh', reason: '需要提升权限' } })
        let state = tracker.snapshot(0)
        assert.equal(state.pending.length, 1)
        assert.equal(state.pending[0]!.kind, 'approval')
        assert.match(state.pending[0]!.summary, /pwsh/)
        assert.equal(state.pending[0]!.detail, '需要提升权限')
        feed(tracker, rootSession, { type: 'approval/decided', data: { id: 'ap-1', outcome: 'allowed-once' } })
        state = tracker.snapshot(0)
        assert.equal(state.pending.length, 0)
    })

    it('ask_user_question 调用产生提问提醒，配对 result 撤下', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, {
            type: 'tool/call',
            data: { turn: 1, step: 1, callId: 'call-9', name: 'ask_user_question', arguments: '{"questions":[{"id":"q","question":"继续执行？"}]}' },
        })
        assert.equal(tracker.snapshot(0).pending.filter((item) => item.kind === 'question').length, 1)
        feed(tracker, rootSession, {
            type: 'tool/result',
            data: { turn: 1, step: 1, message: { role: 'tool', callId: 'call-9', content: 'ok' } },
        })
        assert.equal(tracker.snapshot(0).pending.length, 0)
    })

    it('其他工具调用不产生提问提醒', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, {
            type: 'tool/call',
            data: { turn: 1, step: 1, callId: 'c1', name: 'read_file', arguments: '{}' },
        })
        assert.equal(tracker.snapshot(0).pending.length, 0)
    })

    it('子代理会话的 turn/end 不打扰；其审批仍要报', () => {
        const tracker = new ReminderTracker()
        feed(tracker, childSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
        assert.equal(tracker.snapshot(0).recent.length, 0)
        feed(tracker, childSession, { type: 'approval/asked', data: { id: 'ap-2', toolName: 'write' } })
        assert.equal(tracker.snapshot(0).pending.length, 1)
    })

    it('session/title 折叠进后续条目的标题', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, { type: 'session/title', data: { title: '修复登录 bug', sourceEventSeqs: [], source: 'fallback' } })
        feed(tracker, rootSession, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
        assert.equal(tracker.snapshot(0).recent[0]!.title, '修复登录 bug')
    })

    it('会话销毁撤下该会话未决提问（不影响其他会话）', () => {
        const tracker = new ReminderTracker()
        feed(tracker, rootSession, {
            type: 'tool/call',
            data: { turn: 1, step: 1, callId: 'cx', name: 'ask_user_question', arguments: '{}' },
        })
        const other: TrackerSessionView = { id: 'session-other' }
        feed(tracker, other, {
            type: 'tool/call',
            data: { turn: 1, step: 1, callId: 'cy', name: 'ask_user_question', arguments: '{}' },
        })
        assert.equal(tracker.pendingCount, 2)
        tracker.onSessionDisposed(rootSession)
        assert.equal(tracker.pendingCount, 1)
        assert.equal(tracker.snapshot(0).pending[0]!.sessionId, 'session-other')
    })

    it('重复 asked（同 id）幂等', () => {
        const tracker = new ReminderTracker()
        const ask = { type: 'approval/asked', data: { id: 'dup', toolName: 'bash' } }
        feed(tracker, rootSession, ask)
        feed(tracker, rootSession, ask)
        assert.equal(tracker.pendingCount, 1)
    })
})
