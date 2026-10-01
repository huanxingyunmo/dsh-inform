/**
 * dsh-inform 宿主半体：会话事件跟踪 + 提醒状态 HTTP 端点。
 *
 * 职责边界（dsh 0.2.0-rc.2）：
 * - 观测 cordis `session/event` firehose，折叠出三类提醒（完成/待批准/待回答）；
 * - 声明 `Config` schema（字段全部 volatile）——0.2 起设置页由 settings 服务按
 *   **Loader 条目 id** 自动生成，插件不再自行注册设置命名空间；条目 id 见
 *   `cordis.patch.yml`，与下面的 `name` / `INFORM_NAMESPACE` 保持一致；
 * - 惰性挂载到 `webServer`（可选服务），暴露 `GET /plugins/dsh-inform/api/state`。
 *
 * 开关值只在浏览器侧生效（弹窗是浏览器行为），宿主只在代读音频时读自己的实时配置——
 * 这样切换开关立即生效，无需任何宿主参与。
 */
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import nodePath from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { ReminderTracker, type TrackerSessionView } from './state.js'
import { attachWebServer } from './http.js'

/** 插件名：同时是本插件在 profile 中的 Loader 条目 id 与设置命名空间。 */
export const name = 'dsh-inform'

/**
 * 本插件的设置命名空间（= Loader 条目 id）。
 * 浏览器侧按此取 `ctx.configForms.get(INFORM_NAMESPACE)` 的设置表单；
 * 与 `cordis.patch.yml` 里 insert 行的 `id` 必须逐字一致。
 */
export const INFORM_NAMESPACE = 'dsh-inform'

/** volatile 字段的运行时形状：0.2 Loader 把可热改字段包成实时 getter。 */
export interface LiveField<T> {
    get(): T
}

/** `apply` 收到的运行时配置面（与 `Config` schema 的 volatile 字段一一对应）。 */
export interface ConfigView {
    notifyOnComplete: LiveField<boolean>
    notifyOnApproval: LiveField<boolean>
    notifyOnAnswer: LiveField<boolean>
    uiPopup: LiveField<boolean>
    soundEnabled: LiveField<boolean>
    soundPath: LiveField<string>
}

/**
 * 设置页据此生成表单（纯值 schema）。
 * volatile 表示字段改动后无需重启条目即可生效。
 */
export const Config = z.object({
    notifyOnComplete: z.boolean().default(true).description('任务完成时弹窗提醒').volatile(),
    notifyOnApproval: z.boolean().default(true).description('需要批准时弹窗提醒').volatile(),
    notifyOnAnswer: z.boolean().default(true).description('需要回答时弹窗提醒').volatile(),
    uiPopup: z.boolean().default(false).description('页面内（启动器 UI）浮层弹窗；默认关闭，仅系统通知').volatile(),
    soundEnabled: z.boolean().default(false).description('启用自定义提醒音频').volatile(),
    soundPath: z.string().default('').description("音频来源：'@stored'=设置页上传 / 本地路径 / URL").volatile(),
})

function sessionView(session: Session): TrackerSessionView {
    return {
        id: String(session.id),
        cwd: session.header.cwd,
        delegationDepth: session.header.delegationDepth,
    }
}

export function apply(ctx: Context, config: ConfigView): void {
    const tracker = new ReminderTracker()

    // `ctx.on` 把监听登记为当前 fiber 的 effect：卸载即注销（cordis events 契约）。
    // 根上下文监听不受作用域过滤影响，天然覆盖全部会话（含子代理）。
    ctx.on('session/event', (session, event) => {
        tracker.onSessionEvent(sessionView(session), event)
    })
    ctx.on('session/disposed', (session) => {
        tracker.onSessionDisposed(sessionView(session))
    })

    // Web 面可选：headless/TUI 组合里没有 webServer，注入保持挂起即可，无副作用。
    // 音频配置请求时直读 volatile getter：设置页任何写路径都即时生效。
    attachWebServer(ctx, tracker, {
        getSound: () => ({
            enabled: config.soundEnabled.get() === true,
            path: typeof config.soundPath.get() === 'string' ? config.soundPath.get() : '',
        }),
        // 上传音频的数据目录：<DSH_HOME>/dsh-inform/。home 解析与官方 bin 同约定。
        getHome: () => {
            const env = process.env.DSH_HOME?.trim()
            if (env !== undefined && env !== '') {
                if (env === '~') return homedir()
                if (env.startsWith('~/') || env.startsWith('~\\')) return nodePath.join(homedir(), env.slice(2))
                return env
            }
            return nodePath.join(homedir(), '.dsh')
        },
    })
}
