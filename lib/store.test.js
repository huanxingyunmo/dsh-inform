/**
 * RemindStore 逻辑单测：吸收快照、开关门控、粘性解析、去重、容量上限。
 * 轮询器用注入的 fetchState 驱动确定性序列。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPoller, flagsForKind, RemindStore } from './client/store.js';
let seq = 0;
function item(kind, id) {
    return {
        id: id ?? (seq += 1),
        kind,
        sessionId: 's1',
        title: 'demo',
        summary: `summary-${kind}`,
        at: '2026-01-01T00:00:00.000Z',
    };
}
function stateOf(pending, recent, cursor = Math.max(0, ...[...pending, ...recent].map((i) => i.id))) {
    return { now: '2026-01-01T00:00:00.000Z', cursor, pending, recent };
}
async function waitFor(predicate, message) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error(`timeout: ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
describe('RemindStore', () => {
    it('absorb 吸收未决与完成条目；同一 id 不重复弹出', () => {
        const store = new RemindStore();
        store.absorb(stateOf([item('approval', 1)], [], 1));
        assert.equal(store.getSnapshot().toasts.length, 1);
        assert.equal(store.getSnapshot().toasts[0].sticky, true);
        store.absorb(stateOf([item('approval', 1)], [item('complete', 2)], 2));
        // approval(1) 已见过不重复；complete(2) 新增
        assert.equal(store.getSnapshot().toasts.length, 2);
        store.dispose();
    });
    it('pending 条目消失时撤下对应粘性弹窗', () => {
        const store = new RemindStore();
        store.absorb(stateOf([item('approval', 1)], [], 1));
        assert.equal(store.getSnapshot().toasts.length, 1);
        store.absorb(stateOf([], [], 1));
        assert.equal(store.getSnapshot().toasts.length, 0);
        store.dispose();
    });
    it('开关关闭时仍消费 id（推进游标）但不弹窗；恢复开启后新事件照常', () => {
        const store = new RemindStore();
        store.setEnabled({ complete: false, approval: true, question: true });
        store.absorb(stateOf([], [item('complete', 10)], 10));
        assert.equal(store.getSnapshot().toasts.length, 0);
        store.setEnabled({ complete: true, approval: true, question: true });
        store.absorb(stateOf([], [item('complete', 11)], 11));
        assert.equal(store.getSnapshot().toasts.length, 1);
        store.dispose();
    });
    it('首次基线读由轮询器吞掉 recent，只显示当前未决', async () => {
        const store = new RemindStore();
        let calls = 0;
        const baseline = stateOf([], [item('complete', 100), item('complete', 101)], 101);
        const increment = stateOf([], [item('complete', 102)], 102);
        const poller = createPoller({
            store,
            intervalMs: 5,
            fetchState: async () => {
                calls += 1;
                return calls === 1 ? baseline : increment;
            },
        });
        try {
            await waitFor(() => calls >= 2 && store.getSnapshot().toasts.some((t) => t.itemId === 102), '第二次拉取到达');
            assert.equal(store.getSnapshot().toasts.some((t) => t.itemId === 100), false, '基线读不应补放历史完成');
            assert.equal(store.getSnapshot().toasts.some((t) => t.itemId === 102), true, '增量读应弹出新的完成');
        }
        finally {
            poller.dispose();
            store.dispose();
        }
    });
    it('取数失败标记连接异常并保留最后成功快照', async () => {
        const store = new RemindStore();
        let calls = 0;
        const poller = createPoller({
            store,
            intervalMs: 5,
            fetchState: async () => {
                calls += 1;
                if (calls === 1)
                    return stateOf([], [item('complete', 5)], 5);
                throw new Error('boom');
            },
        });
        try {
            await waitFor(() => store.getSnapshot().connection === 'error' && calls >= 2, '进入错误态');
            assert.equal(store.getSnapshot().connection, 'error');
        }
        finally {
            poller.dispose();
            store.dispose();
        }
    });
    it('测试弹窗直接入栈并可手动关闭', () => {
        const store = new RemindStore();
        store.pushTest('question');
        assert.equal(store.getSnapshot().toasts.length, 1);
        const key = store.getSnapshot().toasts[0].key;
        store.dismiss(key);
        assert.equal(store.getSnapshot().toasts.length, 0);
        store.dispose();
    });
    it('容量上限：最多保留 MAX_TOASTS 张卡片', () => {
        const store = new RemindStore();
        for (let i = 0; i < 9; i += 1)
            store.pushTest('question');
        assert.ok(store.getSnapshot().toasts.length <= 5);
        store.dispose();
    });
    it('flagsForKind 映射三类开关', () => {
        const flags = { complete: true, approval: false, question: false };
        assert.equal(flagsForKind(flags, 'complete'), true);
        assert.equal(flagsForKind(flags, 'approval'), false);
        assert.equal(flagsForKind(flags, 'question'), false);
    });
    it('uiPopup 与音频字段默认关闭；hasSound 要求启用且配置来源', () => {
        const store = new RemindStore();
        assert.equal(store.getSnapshot().uiPopup, false);
        assert.equal(store.getSnapshot().soundEnabled, false);
        assert.equal(store.hasSound(), false, '未配置音频时应为 false');
        store.setUiPopup(true);
        assert.equal(store.getSnapshot().uiPopup, true);
        store.setSound({ enabled: true, path: '' });
        assert.equal(store.hasSound(), false, '没填来源不播');
        store.setSound({ enabled: true, path: '@stored' });
        assert.equal(store.hasSound(), true);
        // scope 值缺省时按默认（关）处理。
        store.attachSettings({
            getSnapshot: () => ({
                status: 'ready',
                value: undefined,
                base: undefined,
                user: undefined,
                revision: 1,
                writable: true,
                mode: 'host',
            }),
            subscribe: () => () => { },
            set: async () => { },
            unset: async () => { },
        });
        assert.equal(store.getSnapshot().uiPopup, false, '文档无值 → 默认关');
        assert.equal(store.hasSound(), false);
        store.dispose();
    });
    it('onDeliver 钩子随每条真实弹窗触发；开关关闭的条目不投递', () => {
        const store = new RemindStore();
        const delivered = [];
        store.onDeliver = (payload) => { delivered.push({ kind: payload.kind, tag: payload.tag }); };
        store.absorb(stateOf([item('approval', 1)], [item('complete', 2)], 2));
        store.pushTest('question');
        assert.equal(delivered.length, 3);
        assert.deepEqual(delivered.map((d) => d.tag), ['item-1', 'item-2', 'test-3']);
        // 关闭 approval 后新审批只推进游标、不投递。
        store.setEnabled({ complete: true, approval: false, question: true });
        store.absorb(stateOf([item('approval', 9)], [], 9));
        assert.equal(delivered.length, 3, '被开关挡下的条目不应触发 onDeliver');
        store.dispose();
    });
});
