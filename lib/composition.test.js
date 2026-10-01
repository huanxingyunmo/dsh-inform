/**
 * 组合集成测试：真实 cordis Context + 真实 dsh-session 会话事件总线 +
 * 真实 dsh-host-webserver，验证本插件从事件到 HTTP 端点的完整链路。
 *
 * 0.2 起 settings 面被重写：插件不再注册设置命名空间（settings 服务按 Loader
 * 条目 id 自动投影），因此这里不再挂内存版 settings provider，而是把**受控的
 * volatile 配置面**直接喂给 `apply` —— 其形状与 cordis 交给 `apply` 的一致
 * （volatile 字段是 `{ get() }` 只读引用），并可在测试内改值以验证"改动即时生效"。
 *
 * 模板对齐真实组合方式：new Context → provide 服务 → await 插件 →
 * 断言用户可见表面 → dispose。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval';
import { WebServer } from '@deepseek-ai/dsh-host-webserver';
import { apply as remindPlugin, Config } from './index.js';
import { SOUND_PATH, SOUND_UPLOAD_PATH, STATE_PATH } from './http.js';
function pathJoin(base, rest) {
    return rest.match(/^[A-Za-z]:[\\/]/) ? rest : `${base.replace(/[\\/]+$/, '')}/${rest}`;
}
const DEFAULTS = {
    notifyOnComplete: true,
    notifyOnApproval: true,
    notifyOnAnswer: true,
    uiPopup: false,
    soundEnabled: false,
    soundPath: '',
};
/**
 * 受控 volatile 配置面：字段是只读 `get()` 引用（与 Loader 交给 `apply` 的同形），
 * `set` 只供测试改写——真实部署里改写来自设置页写入设置文档。
 */
function liveConfig(initial = {}) {
    const values = { ...DEFAULTS, ...initial };
    const field = (name) => ({
        get: () => values[name],
    });
    return {
        view: {
            notifyOnComplete: field('notifyOnComplete'),
            notifyOnApproval: field('notifyOnApproval'),
            notifyOnAnswer: field('notifyOnAnswer'),
            uiPopup: field('uiPopup'),
            soundEnabled: field('soundEnabled'),
            soundPath: field('soundPath'),
        },
        set(name, value) {
            values[name] = value;
        },
    };
}
const fibers = [];
async function start(live = liveConfig()) {
    const ctx = new Context();
    fibers.push(await ctx.plugin(SessionStore));
    fibers.push(await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }));
    // 不传 Config：这里要喂受控的 volatile 面；schema 形状由下面的独立用例断言。
    fibers.push(await ctx.plugin({
        name: 'dsh-inform',
        apply: (scoped) => {
            remindPlugin(scoped, live.view);
        },
    }));
    return { ctx, live };
}
afterEach(async () => {
    while (fibers.length > 0) {
        const fiber = fibers.pop();
        if (fiber)
            await fiber.dispose();
    }
});
function createRootSession(ctx, id) {
    return ctx.sessions.create(id, { meta: { cwd: process.cwd() } });
}
describe('dsh-inform 真实组合', () => {
    it('Config schema 暴露六个字段（设置页按 Loader 条目 id 投影这张 schema）', () => {
        const fields = Object.keys(Config.dict ?? {}).sort();
        assert.deepEqual(fields, ['notifyOnAnswer', 'notifyOnApproval', 'notifyOnComplete', 'soundEnabled', 'soundPath', 'uiPopup']);
    });
    it('回合结束 → HTTP 状态端点出现完成提醒；?since 游标生效', async () => {
        const { ctx } = await start();
        const port = ctx.webServer.port;
        const session = createRootSession(ctx, SessionId('comp-root-1'));
        assert.equal(ctx.get('webServer') != null, true);
        // 回合结束前端点应返回空 recent
        let body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=0`, { cache: 'no-store' })).json();
        assert.deepEqual(body.recent, []);
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
        body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=0`)).json();
        assert.equal(body.recent.length, 1);
        const cursor = body.cursor;
        const afterCursor = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=${cursor}`)).json();
        assert.equal(afterCursor.recent.length, 0);
    });
    it('审批与提问经真实会话日志折叠为未决条目并随决定撤下', async () => {
        const { ctx } = await start();
        const port = ctx.webServer.port;
        const session = createRootSession(ctx, SessionId('comp-root-2'));
        session.append('approval/asked', { id: ApprovalRequestId('ap-x'), toolName: 'pwsh', reason: '需要提升权限重试' });
        let body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json();
        assert.equal(body.pending.filter((p) => p.kind === 'approval').length, 1);
        session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('c-9'), name: 'ask_user_question', arguments: '{"questions":[{"id":"q","question":"覆盖现有文件？"}]}' });
        body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json();
        const question = body.pending.find((p) => p.kind === 'question');
        assert.ok(question);
        assert.match(question.summary, /覆盖现有文件？/);
        session.append('approval/decided', { id: ApprovalRequestId('ap-x'), outcome: 'allowed-once' });
        session.append('tool/result', { turn: 1, step: 1, message: { role: 'tool', callId: ToolCallId('c-9'), content: 'done' } }, { surfaceOp: 'append' });
        body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json();
        assert.equal(body.pending.length, 0);
    });
    it('子代理会话的完成不进入提醒流', async () => {
        const { ctx } = await start();
        const port = ctx.webServer.port;
        const child = ctx.sessions.create(SessionId('comp-child'), {
            meta: { cwd: process.cwd(), delegationDepth: 1 },
        });
        child.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
        const body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json();
        assert.equal(body.recent.length, 0);
    });
    it('音频代理端点：未配置 404；改配置后按 MIME 喂文件；上传槽与 URL 来源', async () => {
        const { ctx, live } = await start();
        const port = ctx.webServer.port;
        const base = `http://127.0.0.1:${port}${SOUND_PATH}`;
        assert.equal((await fetch(base)).status, 404, '默认（未启用）应 404');
        // 写一个最小 WAV 文件到临时目录并配置。
        const { mkdtemp, writeFile } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const dir = await mkdtemp(pathJoin(tmpdir(), 'dsh-inform-sound-'));
        const wavPath = pathJoin(dir, 'alert.wav');
        const bytes = Buffer.from('RIFF0000WAVEfmt ', 'utf8');
        await writeFile(wavPath, bytes);
        // 只改配置、不重启条目：端点必须立刻看到新值（volatile getter 契约）。
        live.set('soundEnabled', true);
        live.set('soundPath', wavPath);
        let response = await fetch(base);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /audio\/wav/);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes));
        // HEAD 同样可用。
        response = await fetch(base, { method: 'HEAD' });
        assert.equal(response.status, 200);
        // 不存在的文件 → 404。
        live.set('soundPath', pathJoin(dir, 'missing.wav'));
        assert.equal((await fetch(base)).status, 404);
        // 不支持的扩展名 → 415（本地路径）。
        const txtPath = pathJoin(dir, 'note.txt');
        await writeFile(txtPath, 'x');
        live.set('soundPath', txtPath);
        assert.equal((await fetch(base)).status, 415);
        // http(s) URL → 302 重定向。
        live.set('soundPath', 'https://example.com/alert.mp3');
        response = await fetch(base, { redirect: 'manual' });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), 'https://example.com/alert.mp3');
        // 关闭开关后回到 404。
        live.set('soundEnabled', false);
        assert.equal((await fetch(base)).status, 404);
    });
    it('音频上传端点：POST 字节落盘为 @stored 槽，GET 伺服同一内容；非法扩展名 415', async () => {
        // DSH_HOME 指到临时目录，验证落盘位置。
        const { mkdtemp } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const fakeHome = await mkdtemp(pathJoin(tmpdir(), 'dsh-inform-home-'));
        process.env.DSH_HOME = fakeHome;
        try {
            const { ctx, live } = await start();
            const port = ctx.webServer.port;
            const bytes = Buffer.from('ID3', 'utf8');
            // 非法扩展名 → 415。
            let up = await fetch(`http://127.0.0.1:${port}${SOUND_UPLOAD_PATH}?ext=exe`, { method: 'POST', body: bytes });
            assert.equal(up.status, 415);
            // GET 方法不允许 → 405。
            up = await fetch(`http://127.0.0.1:${port}${SOUND_UPLOAD_PATH}`);
            assert.equal(up.status, 405);
            // 正常上传 mp3 → ok。
            up = await fetch(`http://127.0.0.1:${port}${SOUND_UPLOAD_PATH}?ext=mp3`, { method: 'POST', body: bytes });
            assert.equal(up.status, 200);
            const body = await up.json();
            assert.equal(body.ok, true);
            assert.equal(body.ext, 'mp3');
            // soundPath 置 @stored 后 GET 伺服上传内容（audio/mpeg）。
            live.set('soundEnabled', true);
            live.set('soundPath', '@stored');
            const response = await fetch(`http://127.0.0.1:${port}${SOUND_PATH}`);
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type') ?? '', /audio\/mpeg/);
            assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes));
        }
        finally {
            delete process.env.DSH_HOME;
        }
    });
    it('非法 since 参数得到 400', async () => {
        const { ctx } = await start();
        const port = ctx.webServer.port;
        const response = await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=-3`);
        assert.equal(response.status, 400);
    });
});
