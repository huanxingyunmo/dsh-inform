import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { ReminderTracker } from './state.js';
export declare const STATE_PATH = "/plugins/dsh-inform/api/state";
/** 自定义提醒音频代理端点：浏览器无法直接读盘，由宿主按当前设置代读。 */
export declare const SOUND_PATH = "/plugins/dsh-inform/api/sound";
/** 音频上传端点：设置页「选择本地文件」的字节落点。 */
export declare const SOUND_UPLOAD_PATH = "/plugins/dsh-inform/api/sound/upload";
/** 音频伺服读取的当前配置（apply 期注入 getter，请求时取最新值）。 */
export interface SoundConfigView {
    enabled: boolean;
    path: string;
}
export declare function handleStateRequest(tracker: ReminderTracker, req: IncomingMessage, res: ServerResponse): void;
/** `soundPath` 的保留哨兵值：使用设置页上传的音频文件。 */
export declare const STORED_SENTINEL = "@stored";
/** 插件在 DSH home 下的数据目录（存上传的音频）。 */
export declare function soundStoreDir(home: string): string;
/** 音频代理：按当前设置把本地音频文件（或重定向 http(s) URL）喂给 <audio>。
 *  只在 soundEnabled 且配置了来源时服务；扩展名白名单 + 大小上限，防误当任意文件网关。 */
export declare function handleSoundRequest(getSound: () => SoundConfigView, req: IncomingMessage, res: ServerResponse, getHome?: () => string): Promise<void>;
/** 音频上传：设置页「选择本地文件」后，前端读字节 POST 到这里，
 *  宿主存进 <DSH_HOME>/dsh-inform/sound.<ext>（单槽覆盖），随后 soundPath 置 '@stored'。 */
export declare function handleSoundUpload(req: IncomingMessage, res: ServerResponse, getHome: () => string): Promise<void>;
/** 把 HTTP 面挂到可选的 webServer 上；没有 webServer 的组合里保持等待。 */
export declare function attachWebServer(ctx: Context, tracker: ReminderTracker, options?: {
    getSound?: () => SoundConfigView;
    getHome?: () => string;
}): void;
