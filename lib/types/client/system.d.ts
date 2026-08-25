/**
 * 浏览器 Notification API 的薄封装：OS 级系统通知。
 *
 * 全部函数防御性探测支持情况（jsdom/老浏览器无 Notification），
 * 权限状态在每次触发时即时读取——用户随时可在站点设置里收回授权。
 */
export type SystemPermission = 'granted' | 'denied' | 'default' | 'unsupported';
export declare function notificationSupported(): boolean;
export declare function notificationPermission(): SystemPermission;
/** 必须在用户手势（点击）处理器里调用，否则浏览器直接拒绝。 */
export declare function requestNotificationPermission(): Promise<SystemPermission>;
/** 发一条系统通知；未授权或不支持时返回 false（页面内弹窗栈仍在，互不影响）。 */
export declare function fireSystemNotification(payload: {
    title: string;
    body: string;
    tag: string;
}): boolean;
