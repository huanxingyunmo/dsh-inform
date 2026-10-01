/**
 * 设置页分区：三类提醒的独立开关 + UI 浮层开关 + 自定义音频 + 连接状态。
 *
 * 开关经 `ctx.configForms` 的 `dsh-inform` 表单（= 宿主 Loader 条目 id）写入设置文档，
 * revision 由 ConfigForm 契约 fencing；读取走同一表单的快照，改完即生效。
 */
import { useRef, useState as useReactState, useSyncExternalStore } from 'react'
import type { EnabledFlags, RemindSettings, RemindStore } from './store.js'
import { requestNotificationPermission } from './system.js'
import { playReminderSound } from './sound.js'
import { INFORM_STYLE_SHEET } from './toasts.js'

/** 与宿主 http.ts 的 STORED_SENTINEL 一致；本地声明以免值导入破坏 bundle 纯度。 */
const STORED_SENTINEL = '@stored'

const TOGGLES: Array<{ field: keyof RemindSettings; flag: keyof EnabledFlags; label: string; description: string }> = [
    { field: 'notifyOnComplete', flag: 'complete', label: '任务完成时提醒', description: '一个回合结束（完成、出错或达到上限）时弹窗' },
    { field: 'notifyOnApproval', flag: 'approval', label: '需要批准时提醒', description: '工具执行等待你批准时弹窗' },
    { field: 'notifyOnAnswer', flag: 'question', label: '需要回答时提醒', description: '模型通过 ask_user_question 提问等待回答时弹窗' },
]

const pageStyle: React.CSSProperties = {
    maxWidth: 560,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
}

const introStyle: React.CSSProperties = { margin: 0, opacity: 0.8 }

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 0',
    borderBottom: '1px solid rgba(127,127,127,0.18)',
}

const rowLabelStyle: React.CSSProperties = { fontWeight: 600 }
const rowDescStyle: React.CSSProperties = { margin: '2px 0 0', opacity: 0.7 }

const editorBoxStyle: React.CSSProperties = {
    margin: '8px 0 4px',
    padding: '10px 12px',
    border: '1px solid rgba(127,127,127,0.25)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
}

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            style={{
                flexShrink: 0,
                width: 40,
                height: 22,
                borderRadius: 999,
                border: '1px solid rgba(127,127,127,0.4)',
                position: 'relative',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: checked ? '#22a06b' : 'rgba(127,127,127,0.35)',
                opacity: disabled ? 0.5 : 1,
                transition: 'none',
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: 2,
                    left: checked ? 20 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                }}
            />
        </button>
    )
}

export interface RemindSectionProps {
    /** 外壳提供的关闭动作（本分区未用到，保留形状兼容）。 */
    close?: () => void
    /** slot inject face 注入的仓库。 */
    remind: RemindStore
}

/** 注册进 `settings.section` 的分区页。 */
export function RemindSection({ remind }: RemindSectionProps): React.ReactNode {
    const snapshot = useSyncExternalStore(remind.subscribe, remind.getSnapshot)
    const ready = snapshot.settingsStatus === 'ready' && snapshot.settingsWritable
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [soundFileName, setSoundFileName] = useReactState<string>('')
    const [uploadError, setUploadError] = useReactState<string>('')

    /** 选择本地音频文件：读字节上传到宿主存储，成功后来源置为 '@stored'。 */
    const onPickFile = async (file: File): Promise<void> => {
        const ext = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : ''
        setUploadError('')
        setSoundFileName(`上传中… ${file.name}`)
        try {
            const body = await file.arrayBuffer()
            const response = await fetch(`/plugins/dsh-inform/api/sound/upload?ext=${encodeURIComponent(ext)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
                body,
            })
            if (!response.ok) {
                const detail = await response.json().catch(() => null) as { error?: string } | null
                throw new Error(detail?.error ?? `HTTP ${response.status}`)
            }
            await remind.setField('soundPath', STORED_SENTINEL)
            setSoundFileName(`已保存：${file.name}`)
        } catch (error) {
            setSoundFileName('')
            setUploadError(`上传失败：${error instanceof Error ? error.message : String(error)}`)
        }
    }

    return (
        <div style={pageStyle}>
            <style>{INFORM_STYLE_SHEET}</style>
            <p style={introStyle}>
                当 DSH 完成任务、需要批准或需要回答时，通过操作系统级系统通知提醒；
                可选自定义音频与页面内浮层（默认关闭）。开关立即生效并持久保存到用户设置文档。
            </p>
            <div>
                {TOGGLES.map(({ field, flag, label, description }) => (
                    <div key={field} style={rowStyle}>
                        <div>
                            <div style={rowLabelStyle}>{label}</div>
                            <p style={rowDescStyle}>{description}</p>
                        </div>
                        <Switch
                            label={label}
                            checked={snapshot.enabled[flag]}
                            disabled={!ready}
                            onChange={(next) => { void remind.setField(field, next) }}
                        />
                    </div>
                ))}
                <div style={rowStyle}>
                    <div>
                        <div style={rowLabelStyle}>启动器 UI 弹窗</div>
                        <p style={rowDescStyle}>提醒时在页面右上角同时显示浮层卡片；默认关闭，仅系统通知</p>
                    </div>
                    <Switch
                        label="启动器 UI 弹窗"
                        checked={snapshot.uiPopup}
                        disabled={!ready}
                        onChange={(next) => { void remind.setField('uiPopup', next) }}
                    />
                </div>
                <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <div>
                        <div style={rowLabelStyle}>自定义提醒音频</div>
                        <p style={rowDescStyle}>提醒时从头播放所选音频，最长 5 秒；默认不启用（静默）</p>
                    </div>
                    <Switch
                        label="自定义提醒音频"
                        checked={snapshot.soundEnabled}
                        disabled={!ready}
                        onChange={(next) => { void remind.setField('soundEnabled', next) }}
                    />
                </div>
                {snapshot.soundEnabled ? (
                    <div style={{ ...editorBoxStyle, borderBottom: '1px solid rgba(127,127,127,0.18)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                disabled={!ready}
                                onClick={() => fileInputRef.current?.click()}
                                title="选择 mp3/wav/ogg/m4a/flac/aac 音频；文件保存在 DSH 数据目录，随设置持久生效"
                                style={{ cursor: ready ? 'pointer' : 'not-allowed', font: 'inherit', padding: '4px 10px', borderRadius: 6, opacity: ready ? 1 : 0.5 }}
                            >
                                选择本地音频文件…
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.flac,.aac,.webm"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    if (file) void onPickFile(file)
                                    e.target.value = ''
                                }}
                            />
                            {snapshot.soundPath === STORED_SENTINEL ? (
                                <span style={{ opacity: 0.7 }}>当前：{soundFileName || '已上传的音频'}</span>
                            ) : snapshot.soundPath ? (
                                <span style={{ opacity: 0.7 }}>当前：{snapshot.soundPath}</span>
                            ) : null}
                        </div>
                        {uploadError ? <p style={{ margin: 0, color: '#d97706' }}>{uploadError}</p> : null}
                        <button
                            type="button"
                            onClick={() => {
                                playReminderSound({ url: `/plugins/dsh-inform/api/sound?t=${Date.now()}` })
                            }}
                            title="按已保存的音频试听（从头播，最多 5 秒）"
                            style={{ cursor: 'pointer', font: 'inherit', padding: '4px 10px', borderRadius: 6, alignSelf: 'flex-start' }}
                        >
                            试听
                        </button>
                    </div>
                ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.75 }}>
                    连接{snapshot.connection === 'ok' ? '正常' : snapshot.connection === 'error' ? '异常' : '中…'}
                    ；待处理 {snapshot.pendingCount} 条
                </span>
                <button
                    type="button"
                    onClick={() => {
                        // 借这次点击手势顺便申请系统通知权限（首次会弹浏览器授权框，之后静默）。
                        void requestNotificationPermission().then(() => remind.pushTest('complete'))
                    }}
                    disabled={snapshot.connection === 'error'}
                    title={snapshot.connection === 'error' ? `取数失败：${snapshot.lastError ?? 'unknown'}` : undefined}
                    style={{ cursor: snapshot.connection === 'error' ? 'not-allowed' : 'pointer', font: 'inherit', padding: '4px 10px', borderRadius: 6, opacity: snapshot.connection === 'error' ? 0.5 : 1 }}
                >
                    触发测试弹窗
                </button>
                <button
                    type="button"
                    onClick={() => { void remind.resetFields() }}
                    disabled={!ready}
                    title="清除覆盖，恢复部署默认值"
                    style={{ cursor: ready ? 'pointer' : 'not-allowed', font: 'inherit', padding: '4px 10px', borderRadius: 6, opacity: ready ? 1 : 0.5 }}
                >
                    恢复默认
                </button>
            </div>
            {snapshot.connection === 'error' ? (
                <p style={{ ...introStyle, color: '#d97706' }}>
                    状态轮询失败：{snapshot.lastError ?? 'unknown'}。若为 HTTP 401/403，说明此部署的鉴权栏未放行本插件
                    路径——请把这条提示连同 F12 Network 里该请求的响应一起反馈。
                </p>
            ) : null}
            {snapshot.settingsStatus === 'unavailable' ? (
                <p style={{ ...introStyle, color: '#d97706' }}>
                    当前浏览器无法访问设置文档（例如非本机回环访问），开关在此不可用；弹窗行为按默认开启处理。
                </p>
            ) : null}
        </div>
    )
}
