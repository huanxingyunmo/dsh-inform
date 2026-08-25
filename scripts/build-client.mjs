/**
 * 浏览器半体构建：复刻官方 `packages/client/tsdown.client.ts` 的产物形状
 * （lazy-CJS 工厂 + window.__ModuleLoader__.load 包装），因为该 preset
 * 不随包发布，仓库外插件需要自行复现。
 *
 * 产物契约（对照官方 lib/client.js 取证）：
 *   window.__ModuleLoader__.load({
 *     id: "<npm 包名>",
 *     factory: (require) => { var module = {exports:{}}; var exports = module.exports;
 *       ...bundle...; exports.apply = apply; exports.inject = inject; return module.exports; }
 *   })
 *
 * 纯度门：打包后扫描全部 require("X") 调用点，允许清单之外一律失败——
 * 平台种子模块之外的跨包值导入在运行时同样会被 require 拒绝。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** 允许出现在产物里的运行时 require 目标（平台种子模块）。 */
const ALLOWED_REQUIRE = new Set(['react', 'react/jsx-runtime'])

function esbuildBinary() {
    const candidates = [
        '@esbuild/win32-x64/esbuild.exe',
        '@esbuild/darwin-arm64/bin/esbuild',
        '@esbuild/darwin-x64/bin/esbuild',
        '@esbuild/linux-x64/bin/esbuild',
    ]
    for (const candidate of candidates) {
        try {
            return require.resolve(candidate)
        } catch {
            // 换下一个平台候选
        }
    }
    throw new Error('esbuild 平台二进制未安装（--ignore-scripts 安装时依赖 optionalDependencies 提供）')
}

const BANNER = [
    'window.__ModuleLoader__.load({',
    '\tid: "dsh-inform",',
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
].join('\n')

const FOOTER_BODY = [
    '\t\texports.apply = apply;',
    '\t\texports.inject = inject;',
    '\t\treturn module.exports;',
    '\t}',
    '});',
].join('\n')

// 1) 先出裸 CJS 包（不经 CLI 传 banner，避免跨平台参数转义问题）。
// 只清理本脚本的产物，不动 tsc 先行写入的 host 输出。
rmSync(join(root, 'lib/client.js'), { force: true })
rmSync(join(root, 'lib/client.js.map'), { force: true })
mkdirSync(join(root, 'lib'), { recursive: true })

const result = spawnSync(esbuildBinary(), [
    join(root, 'src/client/index.tsx'),
    `--outfile=${join(root, 'lib/client.js')}`,
    '--bundle',
    '--format=cjs',
    '--platform=browser',
    '--target=es2020',
    '--jsx=automatic',
    '--jsx-import-source=react',
    '--external:react',
    '--external:react/jsx-runtime',
    '--sourcemap=external',
    '--log-level=info',
], { stdio: 'inherit', cwd: root })

if (result.status !== 0) {
    throw new Error(`client bundle 构建失败（exit ${result.status}）`)
}

// 2) 包装成 lazy-CJS 工厂；sourceMappingURL 挪到最末（官方产物同形）。
const bundlePath = join(root, 'lib/client.js')
if (!existsSync(bundlePath)) throw new Error('未找到构建产物 lib/client.js')
const raw = readFileSync(bundlePath, 'utf8')
const withoutMapComment = raw.replace(/\n?\/\/# sourceMappingURL=client\.js\.map\s*$/, '')
const wrapped = `${BANNER}\n${withoutMapComment}\n${FOOTER_BODY}\n//# sourceMappingURL=client.js.map\n`
writeFileSync(bundlePath, wrapped)

// ---- 纯度门 ----
const specifiers = new Set()
for (const match of wrapped.matchAll(/\brequire\((["'])([^"']+)\1\)/g)) {
    specifiers.add(match[2])
}
const violations = [...specifiers].filter((spec) => !ALLOWED_REQUIRE.has(spec))
if (violations.length > 0) {
    console.error(`[purity] 产物引用了非平台模块：${violations.join(', ')}`)
    console.error('[purity] 客户端只允许 import react / react/jsx-runtime 的值；其余依赖必须 type-only。')
    process.exit(1)
}

for (const marker of ['__ModuleLoader__', 'factory: (require) => {']) {
    if (!wrapped.includes(marker)) {
        console.error(`[shape] 产物缺少包装标记：${marker}`)
        process.exit(1)
    }
}

console.log(`[ok] lib/client.js 构建完成；require 白名单校验通过：${[...specifiers].sort().join(', ') || '(无)'}`)
