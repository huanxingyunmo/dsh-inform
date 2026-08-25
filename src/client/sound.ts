/**
 * 提醒音频播放：经宿主 /api/sound 代理端点（或 http(s) 直链）驱动 <audio>。
 *
 * 规则固定：从头播放，最长 5 秒——到点直接关闭。被浏览器自动播放策略
 * 拒绝时，记下待重放并在下一次用户手势时补一次。
 */

export interface ReminderSoundSpec {
    url: string
}

const MAX_PLAY_MS = 5000

const activeAudios = new Set<HTMLAudioElement>()
let armedReplay = false
let pendingReplay: ReminderSoundSpec | null = null

function finishAudio(audio: HTMLAudioElement): void {
    activeAudios.delete(audio)
    try {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
    } catch {
        // 已释放的元素再清理会抛错，忽略。
    }
}

function armGestureReplay(): void {
    if (armedReplay || typeof window === 'undefined') return
    armedReplay = true
    window.addEventListener('pointerdown', () => {
        armedReplay = false
        const spec = pendingReplay
        pendingReplay = null
        if (spec) playReminderSound(spec)
    }, { once: true })
}

/** 停掉全部在响的提醒音频（插件卸载/测试需要）。 */
export function stopAllReminderSounds(): void {
    for (const audio of [...activeAudios]) finishAudio(audio)
}

/** 播一条提醒音频；被自动播放策略拒绝时安排手势后重放。返回是否已尝试。 */
export function playReminderSound(spec: ReminderSoundSpec): boolean {
    if (!spec.url) return false
    let audio: HTMLAudioElement
    try {
        audio = new Audio(spec.url)
    } catch {
        return false
    }
    audio.preload = 'auto'
    let finished = false
    const finish = (): void => {
        if (finished) return
        finished = true
        finishAudio(audio)
    }
    audio.addEventListener('ended', finish, { once: true })
    audio.addEventListener('error', finish, { once: true })
    // 硬上限：最多 5 秒，到点直接关闭。
    setTimeout(finish, MAX_PLAY_MS)

    activeAudios.add(audio)
    const playing = audio.play()
    if (playing !== undefined) {
        playing.then(() => {
            // 播起来了：手势重放队列作废。
            pendingReplay = null
        }).catch(() => {
            finish()
            pendingReplay = { ...spec }
            armGestureReplay()
        })
    }
    return true
}
