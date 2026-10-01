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
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
/** 插件名：同时是本插件在 profile 中的 Loader 条目 id 与设置命名空间。 */
export declare const name = "dsh-inform";
/**
 * 本插件的设置命名空间（= Loader 条目 id）。
 * 浏览器侧按此取 `ctx.configForms.get(INFORM_NAMESPACE)` 的设置表单；
 * 与 `cordis.patch.yml` 里 insert 行的 `id` 必须逐字一致。
 */
export declare const INFORM_NAMESPACE = "dsh-inform";
/** volatile 字段的运行时形状：0.2 Loader 把可热改字段包成实时 getter。 */
export interface LiveField<T> {
    get(): T;
}
/** `apply` 收到的运行时配置面（与 `Config` schema 的 volatile 字段一一对应）。 */
export interface ConfigView {
    notifyOnComplete: LiveField<boolean>;
    notifyOnApproval: LiveField<boolean>;
    notifyOnAnswer: LiveField<boolean>;
    uiPopup: LiveField<boolean>;
    soundEnabled: LiveField<boolean>;
    soundPath: LiveField<string>;
}
/**
 * 设置页据此生成表单（纯值 schema）。
 * volatile 表示字段改动后无需重启条目即可生效。
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    notifyOnComplete: z<boolean, boolean, "volatile-defined">;
    notifyOnApproval: z<boolean, boolean, "volatile-defined">;
    notifyOnAnswer: z<boolean, boolean, "volatile-defined">;
    uiPopup: z<boolean, boolean, "volatile-defined">;
    soundEnabled: z<boolean, boolean, "volatile-defined">;
    soundPath: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    notifyOnComplete: z<boolean, boolean, "volatile-defined">;
    notifyOnApproval: z<boolean, boolean, "volatile-defined">;
    notifyOnAnswer: z<boolean, boolean, "volatile-defined">;
    uiPopup: z<boolean, boolean, "volatile-defined">;
    soundEnabled: z<boolean, boolean, "volatile-defined">;
    soundPath: z<string, string, "volatile-defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config: ConfigView): void;
