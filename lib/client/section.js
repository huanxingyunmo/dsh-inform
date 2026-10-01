import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 设置页分区：三类提醒的独立开关 + UI 浮层开关 + 自定义音频 + 连接状态。
 *
 * 开关经 `ctx.configForms` 的 `dsh-inform` 表单（= 宿主 Loader 条目 id）写入设置文档，
 * revision 由 ConfigForm 契约 fencing；读取走同一表单的快照，改完即生效。
 */
import { useRef, useState as useReactState, useSyncExternalStore } from 'react';
import { requestNotificationPermission } from './system.js';
import { playReminderSound } from './sound.js';
import { INFORM_STYLE_SHEET } from './toasts.js';
/** 与宿主 http.ts 的 STORED_SENTINEL 一致；本地声明以免值导入破坏 bundle 纯度。 */
const STORED_SENTINEL = '@stored';
const TOGGLES = [
    { field: 'notifyOnComplete', flag: 'complete', label: '任务完成时提醒', description: '一个回合结束（完成、出错或达到上限）时弹窗' },
    { field: 'notifyOnApproval', flag: 'approval', label: '需要批准时提醒', description: '工具执行等待你批准时弹窗' },
    { field: 'notifyOnAnswer', flag: 'question', label: '需要回答时提醒', description: '模型通过 ask_user_question 提问等待回答时弹窗' },
];
const pageStyle = {
    maxWidth: 560,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
};
const introStyle = { margin: 0, opacity: 0.8 };
const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 0',
    borderBottom: '1px solid rgba(127,127,127,0.18)',
};
const rowLabelStyle = { fontWeight: 600 };
const rowDescStyle = { margin: '2px 0 0', opacity: 0.7 };
const editorBoxStyle = {
    margin: '8px 0 4px',
    padding: '10px 12px',
    border: '1px solid rgba(127,127,127,0.25)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
};
function Switch({ checked, disabled, onChange, label }) {
    return (_jsx("button", { type: "button", role: "switch", "aria-checked": checked, "aria-label": label, disabled: disabled, onClick: () => onChange(!checked), style: {
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
        }, children: _jsx("span", { style: {
                position: 'absolute',
                top: 2,
                left: checked ? 20 : 2,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            } }) }));
}
/** 注册进 `settings.section` 的分区页。 */
export function RemindSection({ remind }) {
    const snapshot = useSyncExternalStore(remind.subscribe, remind.getSnapshot);
    const ready = snapshot.settingsStatus === 'ready' && snapshot.settingsWritable;
    const fileInputRef = useRef(null);
    const [soundFileName, setSoundFileName] = useReactState('');
    const [uploadError, setUploadError] = useReactState('');
    /** 选择本地音频文件：读字节上传到宿主存储，成功后来源置为 '@stored'。 */
    const onPickFile = async (file) => {
        const ext = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
        setUploadError('');
        setSoundFileName(`上传中… ${file.name}`);
        try {
            const body = await file.arrayBuffer();
            const response = await fetch(`/plugins/dsh-inform/api/sound/upload?ext=${encodeURIComponent(ext)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
                body,
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => null);
                throw new Error(detail?.error ?? `HTTP ${response.status}`);
            }
            await remind.setField('soundPath', STORED_SENTINEL);
            setSoundFileName(`已保存：${file.name}`);
        }
        catch (error) {
            setSoundFileName('');
            setUploadError(`上传失败：${error instanceof Error ? error.message : String(error)}`);
        }
    };
    return (_jsxs("div", { style: pageStyle, children: [_jsx("style", { children: INFORM_STYLE_SHEET }), _jsx("p", { style: introStyle, children: "\u5F53 DSH \u5B8C\u6210\u4EFB\u52A1\u3001\u9700\u8981\u6279\u51C6\u6216\u9700\u8981\u56DE\u7B54\u65F6\uFF0C\u901A\u8FC7\u64CD\u4F5C\u7CFB\u7EDF\u7EA7\u7CFB\u7EDF\u901A\u77E5\u63D0\u9192\uFF1B \u53EF\u9009\u81EA\u5B9A\u4E49\u97F3\u9891\u4E0E\u9875\u9762\u5185\u6D6E\u5C42\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF09\u3002\u5F00\u5173\u7ACB\u5373\u751F\u6548\u5E76\u6301\u4E45\u4FDD\u5B58\u5230\u7528\u6237\u8BBE\u7F6E\u6587\u6863\u3002" }), _jsxs("div", { children: [TOGGLES.map(({ field, flag, label, description }) => (_jsxs("div", { style: rowStyle, children: [_jsxs("div", { children: [_jsx("div", { style: rowLabelStyle, children: label }), _jsx("p", { style: rowDescStyle, children: description })] }), _jsx(Switch, { label: label, checked: snapshot.enabled[flag], disabled: !ready, onChange: (next) => { void remind.setField(field, next); } })] }, field))), _jsxs("div", { style: rowStyle, children: [_jsxs("div", { children: [_jsx("div", { style: rowLabelStyle, children: "\u542F\u52A8\u5668 UI \u5F39\u7A97" }), _jsx("p", { style: rowDescStyle, children: "\u63D0\u9192\u65F6\u5728\u9875\u9762\u53F3\u4E0A\u89D2\u540C\u65F6\u663E\u793A\u6D6E\u5C42\u5361\u7247\uFF1B\u9ED8\u8BA4\u5173\u95ED\uFF0C\u4EC5\u7CFB\u7EDF\u901A\u77E5" })] }), _jsx(Switch, { label: "\u542F\u52A8\u5668 UI \u5F39\u7A97", checked: snapshot.uiPopup, disabled: !ready, onChange: (next) => { void remind.setField('uiPopup', next); } })] }), _jsxs("div", { style: { ...rowStyle, borderBottom: 'none' }, children: [_jsxs("div", { children: [_jsx("div", { style: rowLabelStyle, children: "\u81EA\u5B9A\u4E49\u63D0\u9192\u97F3\u9891" }), _jsx("p", { style: rowDescStyle, children: "\u63D0\u9192\u65F6\u4ECE\u5934\u64AD\u653E\u6240\u9009\u97F3\u9891\uFF0C\u6700\u957F 5 \u79D2\uFF1B\u9ED8\u8BA4\u4E0D\u542F\u7528\uFF08\u9759\u9ED8\uFF09" })] }), _jsx(Switch, { label: "\u81EA\u5B9A\u4E49\u63D0\u9192\u97F3\u9891", checked: snapshot.soundEnabled, disabled: !ready, onChange: (next) => { void remind.setField('soundEnabled', next); } })] }), snapshot.soundEnabled ? (_jsxs("div", { style: { ...editorBoxStyle, borderBottom: '1px solid rgba(127,127,127,0.18)' }, children: [_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("button", { type: "button", disabled: !ready, onClick: () => fileInputRef.current?.click(), title: "\u9009\u62E9 mp3/wav/ogg/m4a/flac/aac \u97F3\u9891\uFF1B\u6587\u4EF6\u4FDD\u5B58\u5728 DSH \u6570\u636E\u76EE\u5F55\uFF0C\u968F\u8BBE\u7F6E\u6301\u4E45\u751F\u6548", style: { cursor: ready ? 'pointer' : 'not-allowed', font: 'inherit', padding: '4px 10px', borderRadius: 6, opacity: ready ? 1 : 0.5 }, children: "\u9009\u62E9\u672C\u5730\u97F3\u9891\u6587\u4EF6\u2026" }), _jsx("input", { ref: fileInputRef, type: "file", accept: "audio/*,.mp3,.wav,.ogg,.oga,.m4a,.flac,.aac,.webm", style: { display: 'none' }, onChange: (e) => {
                                            const file = e.target.files?.[0];
                                            if (file)
                                                void onPickFile(file);
                                            e.target.value = '';
                                        } }), snapshot.soundPath === STORED_SENTINEL ? (_jsxs("span", { style: { opacity: 0.7 }, children: ["\u5F53\u524D\uFF1A", soundFileName || '已上传的音频'] })) : snapshot.soundPath ? (_jsxs("span", { style: { opacity: 0.7 }, children: ["\u5F53\u524D\uFF1A", snapshot.soundPath] })) : null] }), uploadError ? _jsx("p", { style: { margin: 0, color: '#d97706' }, children: uploadError }) : null, _jsx("button", { type: "button", onClick: () => {
                                    playReminderSound({ url: `/plugins/dsh-inform/api/sound?t=${Date.now()}` });
                                }, title: "\u6309\u5DF2\u4FDD\u5B58\u7684\u97F3\u9891\u8BD5\u542C\uFF08\u4ECE\u5934\u64AD\uFF0C\u6700\u591A 5 \u79D2\uFF09", style: { cursor: 'pointer', font: 'inherit', padding: '4px 10px', borderRadius: 6, alignSelf: 'flex-start' }, children: "\u8BD5\u542C" })] })) : null] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, children: [_jsxs("span", { style: { opacity: 0.75 }, children: ["\u8FDE\u63A5", snapshot.connection === 'ok' ? '正常' : snapshot.connection === 'error' ? '异常' : '中…', "\uFF1B\u5F85\u5904\u7406 ", snapshot.pendingCount, " \u6761"] }), _jsx("button", { type: "button", onClick: () => {
                            // 借这次点击手势顺便申请系统通知权限（首次会弹浏览器授权框，之后静默）。
                            void requestNotificationPermission().then(() => remind.pushTest('complete'));
                        }, disabled: snapshot.connection === 'error', title: snapshot.connection === 'error' ? `取数失败：${snapshot.lastError ?? 'unknown'}` : undefined, style: { cursor: snapshot.connection === 'error' ? 'not-allowed' : 'pointer', font: 'inherit', padding: '4px 10px', borderRadius: 6, opacity: snapshot.connection === 'error' ? 0.5 : 1 }, children: "\u89E6\u53D1\u6D4B\u8BD5\u5F39\u7A97" }), _jsx("button", { type: "button", onClick: () => { void remind.resetFields(); }, disabled: !ready, title: "\u6E05\u9664\u8986\u76D6\uFF0C\u6062\u590D\u90E8\u7F72\u9ED8\u8BA4\u503C", style: { cursor: ready ? 'pointer' : 'not-allowed', font: 'inherit', padding: '4px 10px', borderRadius: 6, opacity: ready ? 1 : 0.5 }, children: "\u6062\u590D\u9ED8\u8BA4" })] }), snapshot.connection === 'error' ? (_jsxs("p", { style: { ...introStyle, color: '#d97706' }, children: ["\u72B6\u6001\u8F6E\u8BE2\u5931\u8D25\uFF1A", snapshot.lastError ?? 'unknown', "\u3002\u82E5\u4E3A HTTP 401/403\uFF0C\u8BF4\u660E\u6B64\u90E8\u7F72\u7684\u9274\u6743\u680F\u672A\u653E\u884C\u672C\u63D2\u4EF6 \u8DEF\u5F84\u2014\u2014\u8BF7\u628A\u8FD9\u6761\u63D0\u793A\u8FDE\u540C F12 Network \u91CC\u8BE5\u8BF7\u6C42\u7684\u54CD\u5E94\u4E00\u8D77\u53CD\u9988\u3002"] })) : null, snapshot.settingsStatus === 'unavailable' ? (_jsx("p", { style: { ...introStyle, color: '#d97706' }, children: "\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u8BBF\u95EE\u8BBE\u7F6E\u6587\u6863\uFF08\u4F8B\u5982\u975E\u672C\u673A\u56DE\u73AF\u8BBF\u95EE\uFF09\uFF0C\u5F00\u5173\u5728\u6B64\u4E0D\u53EF\u7528\uFF1B\u5F39\u7A97\u884C\u4E3A\u6309\u9ED8\u8BA4\u5F00\u542F\u5904\u7406\u3002" })) : null] }));
}
