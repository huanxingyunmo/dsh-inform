import type { RemindStore } from './store.js';
export interface RemindSectionProps {
    /** 外壳提供的关闭动作（本分区未用到，保留形状兼容）。 */
    close?: () => void;
    /** slot inject face 注入的仓库。 */
    remind: RemindStore;
}
/** 注册进 `settings.section` 的分区页。 */
export declare function RemindSection({ remind }: RemindSectionProps): React.ReactNode;
