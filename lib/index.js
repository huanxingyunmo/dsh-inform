/**
 * dsh-inform 宿主半体：会话事件跟踪 + 提醒状态 HTTP 端点。
 *
 * 职责边界：
 * - 观测 cordis `session/event` firehose，折叠出三类提醒（完成/待批准/待回答）；
 * - 经 `installSettingsSection` 注册 `dsh-inform` 设置命名空间（开关的持久层，
 *   浏览器设置页与 `$DSH_HOME/settings.yaml` 共用这一份文档）；
 * - 惰性挂载到 `webServer`（可选服务），暴露 `GET /dsh-inform/api/state`。
 *
 * 开关值只在浏览器侧生效（弹窗是浏览器行为），宿主不读它们——
 * 这样切换开关立即生效，无需任何宿主参与。
 */
import z from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import nodePath from 'node:path';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { ReminderTracker } from './state.js';
import { attachWebServer } from './http.js';
export const name = 'remind';
export const Config = z.object({
    notifyOnComplete: z.boolean().default(true).description('任务完成时弹窗提醒'),
    notifyOnApproval: z.boolean().default(true).description('需要批准时弹窗提醒'),
    notifyOnAnswer: z.boolean().default(true).description('需要回答时弹窗提醒'),
    uiPopup: z.boolean().default(false).description('页面内（启动器 UI）浮层弹窗；默认关闭，仅系统通知'),
    soundEnabled: z.boolean().default(false).description('启用自定义提醒音频'),
    soundPath: z.string().default('').description("音频来源：'@stored'=设置页上传 / 本地路径 / URL"),
});
/** 本插件的设置命名空间（浏览器设置页按此配对）。 */
export const INFORM_NAMESPACE = settingsNamespace('dsh-inform');
function sessionView(session) {
    return {
        id: String(session.id),
        cwd: session.header.cwd,
        delegationDepth: session.header.delegationDepth,
    };
}
export function apply(ctx, config) {
    const tracker = new ReminderTracker();
    // `ctx.on` 把监听登记为当前 fiber 的 effect：卸载即注销（cordis events 契约）。
    // 根上下文监听不受作用域过滤影响，天然覆盖全部会话（含子代理）。
    ctx.on('session/event', (session, event) => {
        tracker.onSessionEvent(sessionView(session), event);
    });
    ctx.on('session/disposed', (session) => {
        tracker.onSessionDisposed(sessionView(session));
    });
    // 开关命名空间：entry 配置作为 base 层；settings 服务缺席时自动退回 entry 配置。
    installSettingsSection(ctx, INFORM_NAMESPACE, Config, config, {
        setSource: () => { },
        onChange: () => { },
    });
    // 音频配置：请求时直读 settings 文档（任何写路径都即时生效）。
    // cordis 契约要求服务访问必须经 inject 声明——这里用动态注入绑定读取器：
    // settings 服务缺席（headless 组合）时注入保持挂起，getSound 走 entry 配置兜底。
    let readSoundDoc = null;
    ctx.inject(['settings'], (scoped) => {
        const settings = scoped.settings;
        readSoundDoc = () => {
            const value = settings.get(INFORM_NAMESPACE);
            if (!value || typeof value !== 'object')
                return null;
            return {
                enabled: value.soundEnabled === true,
                path: typeof value.soundPath === 'string' ? value.soundPath : '',
            };
        };
    });
    // Web 面可选：headless/TUI 组合里没有 webServer，注入保持挂起即可，无副作用。
    attachWebServer(ctx, tracker, {
        getSound: () => {
            const fromDoc = readSoundDoc?.();
            if (fromDoc)
                return fromDoc;
            return { enabled: config.soundEnabled, path: config.soundPath };
        },
        // 上传音频的数据目录：<DSH_HOME>/dsh-inform/。home 解析与官方 bin 同约定。
        getHome: () => {
            const env = process.env.DSH_HOME?.trim();
            if (env !== undefined && env !== '') {
                if (env === '~')
                    return homedir();
                if (env.startsWith('~/') || env.startsWith('~\\'))
                    return nodePath.join(homedir(), env.slice(2));
                return env;
            }
            return nodePath.join(homedir(), '.dsh');
        },
    });
}
