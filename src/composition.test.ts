/**
 * 组合集成测试：真实 cordis Context + 真实 dsh-session 会话事件总线 +
 * 真实 dsh-host-webserver，验证本插件从事件到 HTTP 端点的完整链路，
 * 以及 settings 命名空间在真实 provider 上的注册/解析/写入。
 *
 * 模板对齐 `@dsh-std/adapter-dsh` fixture 的组合方式：new Context →
 * provide 服务 → await 插件 → 断言用户可见表面 → dispose。
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionStore, type Session } from '@deepseek-ai/dsh-session'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply as remindPlugin, Config } from './index.js'
import { SOUND_PATH, SOUND_UPLOAD_PATH, STATE_PATH } from './http.js'

function pathJoin(base: string, rest: string): string {
    return rest.match(/^[A-Za-z]:[\\/]/) ? rest : `${base.replace(/[\\/]+$/, '')}/${rest}`
}

/** 内存版 settings provider：走真实 SettingsProvider 注册/解析/写路径。 */
class MemorySettings extends SettingsProvider {
    override readonly writable = true
    private doc: Record<string, unknown> = {}

    constructor(ctx: Context) {
        super(ctx)
    }

    protected override async load(): Promise<Record<string, unknown>> {
        return this.doc
    }

    protected override async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
        this.doc[String(ns)] = section
    }
}

const fibers: Array<Fiber> = []

async function start(options?: { withSettings?: boolean }): Promise<Context> {
    const ctx = new Context()
    if (options?.withSettings) {
        fibers.push(await ctx.plugin(MemorySettings))
    }
    fibers.push(await ctx.plugin(SessionStore))
    fibers.push(await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
    fibers.push(await ctx.plugin({ name: 'remind', Config, apply: remindPlugin }, {
        notifyOnComplete: true,
        notifyOnApproval: true,
        notifyOnAnswer: true,
        uiPopup: false,
        soundEnabled: false,
        soundPath: '',
    }))
    return ctx
}

afterEach(async () => {
    while (fibers.length > 0) {
        const fiber = fibers.pop()
        if (fiber) await fiber.dispose()
    }
})

function createRootSession(ctx: Context, id: SessionId): Session {
    return ctx.sessions.create(id, { meta: { cwd: process.cwd() } })
}

describe('dsh-inform 真实组合', () => {
    it('回合结束 → HTTP 状态端点出现完成提醒；?since 游标生效', async () => {
        const ctx = await start()
        const port = ctx.webServer.port
        const session = createRootSession(ctx, SessionId('comp-root-1'))
        assert.equal(ctx.get('webServer') != null, true)

        // 回合结束前端点应返回空 recent
        let body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=0`, { cache: 'no-store' })).json() as { cursor: number; pending: unknown[]; recent: unknown[] }
        assert.deepEqual(body.recent, [])

        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

        body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=0`)).json() as typeof body
        assert.equal(body.recent.length, 1)
        const cursor = body.cursor

        const afterCursor = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=${cursor}`)).json() as typeof body
        assert.equal(afterCursor.recent.length, 0)
    })

    it('审批与提问经真实会话日志折叠为未决条目并随决定撤下', async () => {
        const ctx = await start()
        const port = ctx.webServer.port
        const session = createRootSession(ctx, SessionId('comp-root-2'))

        session.append('approval/asked', { id: ApprovalRequestId('ap-x'), toolName: 'pwsh', reason: '需要提升权限重试' })
        let body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json() as { pending: Array<{ kind: string; summary: string }> }
        assert.equal(body.pending.filter((p) => p.kind === 'approval').length, 1)

        session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-9'), name: 'ask_user_question', arguments: '{"questions":[{"id":"q","question":"覆盖现有文件？"}]}' })
        body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json() as typeof body
        const question = body.pending.find((p) => p.kind === 'question')
        assert.ok(question)
        assert.match(question.summary, /覆盖现有文件？/)

        session.append('approval/decided', { id: ApprovalRequestId('ap-x'), outcome: 'allowed-once' })
        session.append('tool/result', { turn: 1, step: 1, message: { role: 'tool', callId: CallId('c-9'), content: 'done' } as never }, { surfaceOp: 'append' })
        body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json() as typeof body
        assert.equal(body.pending.length, 0)
    })

    it('子代理会话的完成不进入提醒流', async () => {
        const ctx = await start()
        const port = ctx.webServer.port
        const child = ctx.sessions.create(SessionId('comp-child'), {
            meta: { cwd: process.cwd(), delegationDepth: 1 },
        })
        child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        const body = await (await fetch(`http://127.0.0.1:${port}${STATE_PATH}`)).json() as { recent: unknown[]; cursor: number }
        assert.equal(body.recent.length, 0)
    })

    it('settings 命名空间注册成功：默认值可解析、写入持久化', async () => {
        const ctx = await start({ withSettings: true })
        const ns = settingsNamespace('dsh-inform')
        const resolved = ctx.settings.get(ns) as { notifyOnComplete: boolean; uiPopup: boolean; soundEnabled: boolean; soundPath: string } | undefined
        assert.ok(resolved, '命名空间应已注册')
        assert.equal(resolved.notifyOnComplete, true)
        // 新字段默认值：UI 弹窗关、自定义音频不启用、无来源。
        assert.equal(resolved.uiPopup, false)
        assert.equal(resolved.soundEnabled, false)
        assert.equal(resolved.soundPath, '')

        await ctx.settings.update(ns, { notifyOnApproval: false })
        const after = ctx.settings.get(ns) as { notifyOnApproval: boolean; notifyOnComplete: boolean }
        assert.equal(after.notifyOnApproval, false)
        assert.equal(after.notifyOnComplete, true)
    })

    it('音频代理端点：未配置 404；配置后按 MIME 喂文件；上传槽与 URL 来源', async () => {
        const ctx = await start({ withSettings: true })
        const port = ctx.webServer.port
        const ns = settingsNamespace('dsh-inform')

        const base = `http://127.0.0.1:${port}${SOUND_PATH}`
        assert.equal((await fetch(base)).status, 404, '默认（未启用）应 404')

        // 写一个最小 WAV 文件到临时目录并配置。
        const { mkdtemp, writeFile } = await import('node:fs/promises')
        const { tmpdir } = await import('node:os')
        const dir = await mkdtemp(pathJoin(tmpdir(), 'dsh-inform-sound-'))
        const wavPath = pathJoin(dir, 'alert.wav')
        const bytes = Buffer.from('RIFF0000WAVEfmt ', 'utf8')
        await writeFile(wavPath, bytes)

        await ctx.settings.update(ns, { soundEnabled: true, soundPath: wavPath })
        let response = await fetch(base)
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type') ?? '', /audio\/wav/)
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes))

        // HEAD 同样可用。
        response = await fetch(base, { method: 'HEAD' })
        assert.equal(response.status, 200)

        // 不存在的文件 → 404。
        await ctx.settings.update(ns, { soundPath: pathJoin(dir, 'missing.wav') })
        assert.equal((await fetch(base)).status, 404)

        // 不支持的扩展名 → 415（本地路径）。
        const txtPath = pathJoin(dir, 'note.txt')
        await writeFile(txtPath, 'x')
        await ctx.settings.update(ns, { soundPath: txtPath })
        assert.equal((await fetch(base)).status, 415)

        // http(s) URL → 302 重定向。
        await ctx.settings.update(ns, { soundPath: 'https://example.com/alert.mp3' })
        response = await fetch(base, { redirect: 'manual' })
        assert.equal(response.status, 302)
        assert.equal(response.headers.get('location'), 'https://example.com/alert.mp3')

        // 关闭开关后回到 404。
        await ctx.settings.update(ns, { soundEnabled: false })
        assert.equal((await fetch(base)).status, 404)
    })

    it('音频上传端点：POST 字节落盘为 @stored 槽，GET 伺服同一内容；非法扩展名 415', async () => {
        // DSH_HOME 指到临时目录，验证落盘位置。
        const { mkdtemp } = await import('node:fs/promises')
        const { tmpdir } = await import('node:os')
        const fakeHome = await mkdtemp(pathJoin(tmpdir(), 'dsh-inform-home-'))
        process.env.DSH_HOME = fakeHome
        try {
            const ctx = await start({ withSettings: true })
            const port = ctx.webServer.port
            const ns = settingsNamespace('dsh-inform')
            const bytes = Buffer.from('ID3', 'utf8')

            // 非法扩展名 → 415。
            let up = await fetch(`http://127.0.0.1:${port}${SOUND_UPLOAD_PATH}?ext=exe`, { method: 'POST', body: bytes })
            assert.equal(up.status, 415)
            // GET 方法不允许 → 405。
            up = await fetch(`http://127.0.0.1:${port}${SOUND_UPLOAD_PATH}`)
            assert.equal(up.status, 405)

            // 正常上传 mp3 → ok。
            up = await fetch(`http://127.0.0.1:${port}${SOUND_UPLOAD_PATH}?ext=mp3`, { method: 'POST', body: bytes })
            assert.equal(up.status, 200)
            const body = await up.json() as { ok: boolean; ext: string }
            assert.equal(body.ok, true)
            assert.equal(body.ext, 'mp3')

            // soundPath 置 @stored 后 GET 伺服上传内容（audio/mpeg）。
            await ctx.settings.update(ns, { soundEnabled: true, soundPath: '@stored' })
            const response = await fetch(`http://127.0.0.1:${port}${SOUND_PATH}`)
            assert.equal(response.status, 200)
            assert.match(response.headers.get('content-type') ?? '', /audio\/mpeg/)
            assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes))
        } finally {
            delete process.env.DSH_HOME
        }
    })

    it('非法 since 参数得到 400', async () => {
        const ctx = await start()
        const port = ctx.webServer.port
        const response = await fetch(`http://127.0.0.1:${port}${STATE_PATH}?since=-3`)
        assert.equal(response.status, 400)
    })
})
