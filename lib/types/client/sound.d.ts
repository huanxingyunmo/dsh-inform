/**
 * 提醒音频播放：经宿主 /api/sound 代理端点（或 http(s) 直链）驱动 <audio>。
 *
 * 规则固定：从头播放，最长 5 秒——到点直接关闭。被浏览器自动播放策略
 * 拒绝时，记下待重放并在下一次用户手势时补一次。
 */
export interface ReminderSoundSpec {
    url: string;
}
/** 停掉全部在响的提醒音频（插件卸载/测试需要）。 */
export declare function stopAllReminderSounds(): void;
/** 播一条提醒音频；被自动播放策略拒绝时安排手势后重放。返回是否已尝试。 */
export declare function playReminderSound(spec: ReminderSoundSpec): boolean;
