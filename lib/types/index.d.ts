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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "remind";
export interface Config {
    /** 任务完成（回合结束）时弹窗提醒。 */
    notifyOnComplete: boolean;
    /** 需要批准时弹窗提醒。 */
    notifyOnApproval: boolean;
    /** 需要回答（ask_user_question）时弹窗提醒。 */
    notifyOnAnswer: boolean;
    /** 页面内（启动器 UI）浮层弹窗；默认关闭——默认只发系统通知。 */
    uiPopup: boolean;
    /** 自定义提醒音频；默认不启用（提醒静音）。 */
    soundEnabled: boolean;
    /** 音频来源：'@stored'（设置页上传）| 本地路径 | http(s) URL；宿主经 /api/sound 代理。 */
    soundPath: string;
}
export declare const Config: z<Config>;
/** 本插件的设置命名空间（浏览器设置页按此配对）。 */
export declare const INFORM_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export declare function apply(ctx: Context, config: Config): void;
