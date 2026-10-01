/**
 * dsh-inform 浏览器半体：
 * - 轮询宿主 `/dsh-inform/api/state`，按开关弹出三类提醒（shell.overlay 弹窗栈）；
 * - 向设置页注册"任务提醒"分区（settings.section），三类独立开关写入
 *   `dsh-inform` 设置命名空间。
 *
 * import 纯度：除平台种子模块 react/jsx-runtime 外零值导入；
 * 全部 @deepseek-ai/* 依赖均为 type-only（构建期被擦除）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 0.2 起设置面由 `ctx.configForms` 提供（ConfigForm 契约）；SettingsScopeBinder 已随
// dsh-client-runtime 一并下线。`ctx.slots` 的类型贡献改由 ui-renderer 的 client 面提供。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// SlotMap 类型贡献：type-only 拉入 'shell.overlay' 与 'settings.section' 的声明合并。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createPoller, RemindStore, type RemindSettings } from './store.js'
import { fireSystemNotification } from './system.js'
import { playReminderSound, stopAllReminderSounds } from './sound.js'
import { INFORM_STYLE_SHEET, ToastStack } from './toasts.js'
import { RemindSection } from './section.js'

/**
 * 本插件的设置命名空间（= 宿主 Loader 条目 id）。
 * 字面书写而不从宿主半体 import：客户端产物有纯度门，不得依赖宿主包。
 * 与 `src/index.ts` 的 `INFORM_NAMESPACE`、`cordis.patch.yml` 的 insert `id` 必须逐字一致。
 */
const INFORM_NAMESPACE = 'dsh-inform'

/** 必需服务：slot 注册表 + 设置表单（设置域的 base 服务，随 Web 组合提供）。 */
export const inject = ['slots', 'configForms']

export function apply(ctx: ClientContext): void {
    const store = new RemindStore()
    ctx.effect(() => () => store.dispose(), 'dsh-inform: store')

    // 样式注入：随 fiber 卸载移除。
    ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = INFORM_STYLE_SHEET
        style.dataset.plugin = 'dsh-inform'
        document.head.append(style)
        return () => {
            style.remove()
        }
    }, 'dsh-inform: stylesheet')

    // 设置表单：按宿主 Loader 条目 id 取共享 ConfigForm（provider 持有，本插件不解绑）。
    // 命名空间未被伺服或连接为 memory 模式时，表单快照自身报 'unavailable'，开关页降级为只读提示。
    try {
        const scope = ctx.configForms.get<RemindSettings>(INFORM_NAMESPACE)
        const detach = store.attachSettings(scope)
        ctx.effect(() => detach, 'dsh-inform: settings form')
    } catch {
        store.setSettings('unavailable', false)
    }

    // 状态轮询：in-flight 防重入、失败保留最后成功快照、dispose 停表。
    ctx.effect(() => {
        const poller = createPoller({ store })
        return () => poller.dispose()
    }, 'dsh-inform: poller')

    // 系统通知 + 自定义音频：每条送达的提醒同步触发。
    // 系统通知未授权时静默跳过；uiPopup 关闭（默认）时页面内浮层不出卡片。
    ctx.effect(() => {
        store.onDeliver = (payload) => {
            fireSystemNotification({
                title: payload.title,
                body: payload.body,
                tag: `dsh-inform:${payload.tag}`,
            })
            if (store.hasSound()) {
                playReminderSound({
                    // 时间戳防缓存：设置改完下一次提醒立即用新音频。从头播、最多 5 秒。
                    url: `/plugins/dsh-inform/api/sound?t=${Date.now()}`,
                })
            }
        }
        return () => {
            store.onDeliver = null
            stopAllReminderSounds()
        }
    }, 'dsh-inform: system notifications')

    // 浮层弹窗栈：等待 ui-layout 声明 shell.overlay 后注册。
    ctx.slots.inject('shell.overlay', () => {
        const dispose = ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-inform',
            order: 100,
            inject: () => ({ remind: store }),
        }, ToastStack)
        return () => {
            dispose()
        }
    })

    // 设置页分区：等待设置外壳声明 settings.section 后注册。
    ctx.slots.inject('settings.section', () => {
        const dispose = ctx.slots.register({
            name: 'settings.section',
            id: 'dsh-inform',
            order: 60,
            label: '任务提醒',
            inject: () => ({ remind: store }),
        }, RemindSection)
        return () => {
            dispose()
        }
    })
}
