/**
 * shell.overlay 弹窗栈：右上角固定列，容器 click-through、卡片可交互。
 * 颜色走注入的样式表（含 prefers-color-scheme 暗色适配）；
 * 无动画（天然尊重 prefers-reduced-motion）；键盘经关闭按钮可达。
 */
import { useSyncExternalStore } from 'react'
import type { RemindKind } from '../wire.js'
import type { RemindStore, ToastModel } from './store.js'

const KIND_LABEL: Record<RemindKind, string> = {
    complete: '任务完成',
    approval: '需要批准',
    question: '需要回答',
}

const KIND_ICON: Record<RemindKind, string> = {
    complete: '✓',
    approval: '!',
    question: '?',
}

/** 一次性注入本插件全部样式的 <style> 文本；随 client fiber 卸载移除。 */
export const INFORM_STYLE_SHEET = `
.dsh-inform-stack{position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:8px;width:320px;max-width:calc(100vw - 32px);z-index:10000;pointer-events:none}
.dsh-inform-card{pointer-events:auto;background:#ffffff;color:#1f2328;border:1px solid rgba(0,0,0,0.14);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.14);padding:10px 12px}
.dsh-inform-card[data-kind="complete"]{border-left:3px solid #22a06b}
.dsh-inform-card[data-kind="approval"]{border-left:3px solid #d97706}
.dsh-inform-card[data-kind="question"]{border-left:3px solid #3b82f6}
@media (prefers-color-scheme:dark){.dsh-inform-card{background:#22272e;color:#e6edf3;border-color:rgba(255,255,255,0.14)}}
.dsh-inform-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.dsh-inform-badge{flex-shrink:0;font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;color:#fff;white-space:nowrap}
.dsh-inform-badge[data-kind="complete"]{background:#22a06b}
.dsh-inform-badge[data-kind="approval"]{background:#d97706}
.dsh-inform-badge[data-kind="question"]{background:#3b82f6}
.dsh-inform-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dsh-inform-close{flex-shrink:0;border:none;background:transparent;color:inherit;opacity:.55;cursor:pointer;font:inherit;line-height:1;padding:2px}
.dsh-inform-close:hover,.dsh-inform-close:focus-visible{opacity:1}
.dsh-inform-summary{margin:0;word-break:break-word;white-space:pre-wrap}
.dsh-inform-detail{margin:6px 0 0;opacity:.75;white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
`

function ToastCard({ toast, onClose }: { toast: ToastModel; onClose: () => void }) {
    return (
        <div className="dsh-inform-card" data-kind={toast.kind}>
            <div className="dsh-inform-header">
                <span className="dsh-inform-badge" data-kind={toast.kind}>{KIND_ICON[toast.kind]} {KIND_LABEL[toast.kind]}</span>
                <span className="dsh-inform-title" title={toast.title}>{toast.title}</span>
                <button type="button" className="dsh-inform-close" aria-label="关闭提醒" onClick={onClose}>✕</button>
            </div>
            <p className="dsh-inform-summary">{toast.summary}</p>
            {toast.detail ? <p className="dsh-inform-detail" title={toast.detail}>{toast.detail}</p> : null}
        </div>
    )
}

export interface ToastStackProps {
    /** slot inject face 注入的仓库。 */
    remind: RemindStore
}

/** 注册进 `shell.overlay` 的条目组件：uiPopup 关闭（默认）或无提醒时渲染 null，不占布局。 */
export function ToastStack({ remind }: ToastStackProps): React.ReactNode {
    const snapshot = useSyncExternalStore(remind.subscribe, remind.getSnapshot)
    if (!snapshot.uiPopup) return null
    if (snapshot.toasts.length === 0) return null
    return (
        <div className="dsh-inform-stack" role="status" aria-live="polite">
            {snapshot.toasts.map((toast) => (
                <ToastCard key={toast.key} toast={toast} onClose={() => remind.dismiss(toast.key)} />
            ))}
        </div>
    )
}
