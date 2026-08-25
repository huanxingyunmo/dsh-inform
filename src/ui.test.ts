/**
 * 客户端 UI 的 jsdom 测试面：不依赖官方 SlotTestRuntime，
 * 用最小挂载（react-dom/client + jsdom 全局）验证：
 * - 弹窗栈渲染、关闭按钮、粘性/自动分类；
 * - 设置页三开关与 scope 写入路径；
 * - 卸载后 DOM 清理。
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:3080/',
    pretendToBeVisual: true,
})
const globalAny = globalThis as Record<string, unknown>
globalAny.window = dom.window
globalAny.document = dom.window.document
// navigator 在 Node ≥21 是只读访问器，且 Node 自带实现已够 React 使用——不覆盖。
globalAny.CSSStyleDeclaration = dom.window.CSSStyleDeclaration
globalAny.Element = dom.window.Element
globalAny.HTMLElement = dom.window.HTMLElement
globalAny.Node = dom.window.Node
globalAny.requestAnimationFrame = dom.window.requestAnimationFrame?.bind(dom.window)
globalAny.cancelAnimationFrame = dom.window.cancelAnimationFrame?.bind(dom.window)
;(dom.window as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
globalAny.IS_REACT_ACT_ENVIRONMENT = true

type ReactModule = typeof import('react')
type ReactDOMClient = typeof import('react-dom/client')
let React: ReactModule
let ReactDOM: ReactDOMClient
let storeModule: typeof import('./client/store.js')
let toastModule: typeof import('./client/toasts.js')
let sectionModule: typeof import('./client/section.js')

const roots: Array<{ unmount(): void }> = []

async function flush(ms = 20): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

function mount(element: import('react').ReactNode): { container: HTMLElement; unmount(): void } {
    const container = document.createElement('div')
    document.body.append(container)
    const root = ReactDOM.createRoot(container)
    root.render(element)
    roots.push({ unmount: () => root.unmount() })
    return { container, unmount: () => root.unmount() }
}

afterEach(async () => {
    while (roots.length > 0) {
        const entry = roots.pop()
        entry?.unmount()
    }
    await flush()
    document.body.innerHTML = ''
})

describe('dsh-inform 客户端 UI（jsdom）', () => {
    it('模块加载', async () => {
        React = await import('react')
        ReactDOM = await import('react-dom/client')
        storeModule = await import('./client/store.js')
        toastModule = await import('./client/toasts.js')
        sectionModule = await import('./client/section.js')
        assert.ok(React && ReactDOM && storeModule && toastModule && sectionModule)
    })

    it('弹窗栈渲染卡片，关闭按钮移除对应弹窗', async () => {
        const { RemindStore } = storeModule
        const { ToastStack } = toastModule
        const store = new RemindStore()
        store.absorb({
            now: '2026-01-01T00:00:00.000Z',
            cursor: 2,
            pending: [{
                id: 1,
                kind: 'approval',
                sessionId: 's',
                title: 'demo 项目',
                summary: '需要批准：pwsh',
                detail: '提升权限以重试',
                at: '2026-01-01T00:00:00.000Z',
            }],
            recent: [{ id: 2, kind: 'complete', sessionId: 's', title: 'demo 项目', summary: '任务完成', at: '2026-01-01T00:00:00.000Z' }],
        })
        const { container } = mount(React.createElement(ToastStack, { remind: store }))
        await flush()
        // uiPopup 默认关：有提醒也不渲染浮层。
        assert.equal(container.querySelectorAll('.dsh-inform-card').length, 0)
        store.setUiPopup(true)
        await flush()
        const cards = container.querySelectorAll('.dsh-inform-card')
        assert.equal(cards.length, 2)
        assert.match(container.textContent ?? '', /需要批准/)
        assert.match(container.textContent ?? '', /任务完成/)

        const closeButton = container.querySelector<HTMLButtonElement>('.dsh-inform-close')
        assert.ok(closeButton)
        closeButton.click()
        await flush()
        assert.equal(container.querySelectorAll('.dsh-inform-card').length, 1)
        store.dispose()
    })

    it('无提醒时不渲染任何节点', async () => {
        const { RemindStore } = storeModule
        const { ToastStack } = toastModule
        const store = new RemindStore()
        const { container } = mount(React.createElement(ToastStack, { remind: store }))
        await flush()
        assert.equal(container.querySelectorAll('.dsh-inform-card').length, 0)
        assert.equal(document.querySelector('.dsh-inform-stack'), null)
        store.dispose()
    })

    it('设置页渲染五个开关并经 scope 写入；不可写时禁用', async () => {
        const { RemindStore } = storeModule
        const { RemindSection } = sectionModule
        const store = new RemindStore()
        const writes: Array<[string, unknown]> = []
        // 可变文档：set() 合并字段并触发订阅者，模拟真实 scope 的回读路径。
        let listener: (() => void) | null = null
        let doc: Record<string, unknown> = {
            notifyOnComplete: true, notifyOnApproval: false, notifyOnAnswer: true,
            uiPopup: true, soundEnabled: false,
        }
        const fakeScope = {
            getSnapshot: () => ({
                status: 'ready' as const,
                value: doc,
                base: undefined,
                user: doc,
                revision: 3,
                writable: true,
                mode: 'host' as const,
            }),
            subscribe: (fn: () => void) => {
                listener = fn
                return () => { listener = null }
            },
            set: async (field: string, value: unknown) => {
                writes.push([field, value])
                doc = { ...doc, [field]: value }
                listener?.()
            },
            unset: async (field?: string) => {
                writes.push(['__unset__', field ?? null])
            },
        }
        store.attachSettings(fakeScope as never)

        const { container } = mount(React.createElement(RemindSection, { remind: store }))
        await flush()
        const switches = container.querySelectorAll('[role="switch"]')
        // 三类事件开关 + 启动器 UI 弹窗 + 自定义音频 = 5
        assert.equal(switches.length, 5)
        assert.equal(switches[1]?.getAttribute('aria-checked'), 'false', '第二个开关来自 scope 值 false')
        assert.equal(switches[3]?.getAttribute('aria-checked'), 'true', 'UI 弹窗开关来自 scope 值 true')

        ;(switches[1] as HTMLElement).click()
        await flush(30)
        assert.deepEqual(writes[0], ['notifyOnApproval', true])

        // 音频开关打开后出现编辑器（文件选择 + 试听；无数字输入）。
        assert.equal(container.querySelector('input[type="number"]'), null)
        ;(switches[4] as HTMLElement).click()
        await flush(30)
        assert.ok(container.querySelector('input[type="file"]'), '音频文件选择器应出现')
        assert.equal(container.querySelectorAll('input[type="number"]').length, 0)

        // 只读模式：开关禁用（先留一个 false 态的开关供断言）。
        ;(switches[0] as HTMLElement).click()
        await flush(30)
        store.setSettings('unavailable', false)
        await flush()
        assert.equal(
            container.querySelector('[role="switch"][aria-checked="false"]')?.hasAttribute('disabled'),
            true,
        )
        store.dispose()
    })
})
