/**
 * 浏览器 Notification API 的薄封装：OS 级系统通知。
 *
 * 全部函数防御性探测支持情况（jsdom/老浏览器无 Notification），
 * 权限状态在每次触发时即时读取——用户随时可在站点设置里收回授权。
 */

export type SystemPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): SystemPermission {
    if (!notificationSupported()) return 'unsupported'
    return Notification.permission as SystemPermission
}

/** 必须在用户手势（点击）处理器里调用，否则浏览器直接拒绝。 */
export async function requestNotificationPermission(): Promise<SystemPermission> {
    if (!notificationSupported()) return 'unsupported'
    try {
        return (await Notification.requestPermission()) as SystemPermission
    } catch {
        return 'denied'
    }
}

/** 发一条系统通知；未授权或不支持时返回 false（页面内弹窗栈仍在，互不影响）。 */
export function fireSystemNotification(payload: { title: string; body: string; tag: string }): boolean {
    if (!notificationSupported() || Notification.permission !== 'granted') return false
    try {
        const native = new Notification(payload.title, { body: payload.body, tag: payload.tag })
        native.onclick = () => {
            try {
                window.focus()
            } catch {
                // 聚焦被浏览器策略拒绝时忽略——通知仍可手动点开。
            }
            native.close()
        }
        return true
    } catch {
        return false
    }
}
