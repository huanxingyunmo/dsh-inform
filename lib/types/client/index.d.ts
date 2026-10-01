/**
 * dsh-inform 浏览器半体：
 * - 轮询宿主 `/dsh-inform/api/state`，按开关弹出三类提醒（shell.overlay 弹窗栈）；
 * - 向设置页注册"任务提醒"分区（settings.section），三类独立开关写入
 *   `dsh-inform` 设置命名空间。
 *
 * import 纯度：除平台种子模块 react/jsx-runtime 外零值导入；
 * 全部 @deepseek-ai/* 依赖均为 type-only（构建期被擦除）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** 必需服务：slot 注册表 + 设置表单（设置域的 base 服务，随 Web 组合提供）。 */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
