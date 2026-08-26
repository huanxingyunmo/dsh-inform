# dsh-inform

DSH 任务提醒插件：当 DSH **完成任务**、**需要批准**、**需要回答** 时发出提醒。
默认仅发 **操作系统级系统通知**（浏览器 Notification API，设置页一键授权）；
页面内（启动器 UI）浮层与自定义提醒音频默认关闭，均可在 **设置 → 任务提醒** 页面开启。
所有开关持久化到用户设置文档（`$DSH_HOME/settings.yaml` 的 `dsh-inform:` 段）。

## 运行面

原生双面插件（host + client）：

- **host**：监听 cordis `session/event` 事件总线，折叠三类提醒——
  - `turn/end`（回合结束；用户主动取消与崩溃恢复不打扰）→ *任务完成*
  - `approval/asked` / `approval/decided` 审计事件对 → *需要批准*
  - `tool/call`/`tool/result` 中名为 `ask_user_question` 的调用对 → *需要回答*（子代理会话的完成默认不打扰，其审批仍提醒）

  并暴露两个 HTTP 端点（挂在 `/plugins/<id>/` 命名空间下——加固部署的鉴权栏只放行模块加载器使用的已知前缀）：
  - `GET /plugins/dsh-inform/api/state?since=<cursor>` — 增量状态快照
  - `GET /plugins/dsh-inform/api/sound` — 自定义音频代理：按当前设置把本地音频文件喂给 `<audio>`（扩展名白名单 + 30MB 上限；http(s) URL 来源直接 302）
- **client**：轮询状态端点（`no-store`，in-flight 防重入，失败保留最后成功快照并把原因透出到设置页）；每条送达的提醒同步触发 **OS 系统通知** 与 **自定义音频**；可选经 `shell.overlay` 渲染页面内浮层（默认关）；经 `settings.section` 注册"任务提醒"设置页。

## 设置项

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 任务完成/需要批准/需要回答 | 开 | 三类事件的独立开关 |
| 启动器 UI 弹窗 | **关** | 提醒时在页面右上角同时显示浮层卡片 |
| 自定义提醒音频 | **不启用** | 点「选择本地音频文件…」上传（存入 DSH 数据目录）；提醒时**从头播放、最长 5 秒**；支持试听 |

系统通知权限不单独占一行：首次点「触发测试弹窗」时借点击手势向浏览器申请，授权一次后长期有效（被拒绝需到站点设置恢复）。

音频播放规则固定：从第 0 秒开始，最多 5 秒后自动关闭。上传的文件由宿主代理伺服（浏览器不能直接读盘），扩展名白名单 mp3/wav/ogg/m4a/flac/aac/webm、30MB 上限；也接受 http(s) URL 或本地路径作为来源。自动播放被浏览器策略拒绝时，会在下一次页面点击后自动补播一次。

开关只在浏览器侧生效：切换立即生效，无需宿主参与。宿主通过 `installSettingsSection` 注册命名空间（entry 配置作为 base 层），settings 服务缺席的组合自动回退 entry 配置。

## 从源码构建

```sh
npm install --ignore-scripts   # esbuild 平台二进制由 optionalDependencies 提供
npm run verify                 # typecheck(双 program) + build(host tsc + client 工厂包装/纯度门) + test
```

测试矩阵：纯折叠逻辑单测（毫秒级零宿主）+ **真实组合集成测试**（真 cordis Context + 真 dsh-session 会话总线 + 真 dsh-host-webserver + 内存版 settings provider，覆盖状态与音频两个端点）+ jsdom 客户端 UI 挂载测试。

## 安装

```sh
# 从 npm 安装（推荐）
dsh plugin --profile web add @mobaixingyao/dsh-inform

# 或从 GitHub 安装
dsh plugin --profile web add github:mobaixingyao/dsh-inform

# 或本地目录安装（开发迭代）
dsh plugin --profile web add <本仓库克隆目录>
```

安装后重启该 profile。验证：

1. `dsh --profile web --dump-config` 末尾出现 `# == dsh-inform` 层与 `inform` 行；
2. 打开 GUI，首页 boot 花名册包含 `/plugins/@mobaixingyao%2Fdsh-inform/client.js?rev=…`（scope 包名 URL 编码后出现在加载地址里）；
3. 设置页出现"任务提醒"分区（三类开关 + UI 弹窗 + 自定义音频）；首次点「触发测试弹窗」会顺带申请系统通知权限，随后系统通知应弹出。

浏览器半体的构建复刻了官方 `packages/client/tsdown.client.ts` 的 lazy-CJS 工厂格式，并带纯度门：产物只允许 `require('react' | 'react/jsx-runtime')`。

## 设计边界与已知限制

- 系统通知依赖标签页存活（浏览器 Notification API 特性）；完全关闭 GUI 时不会推送。
- 远程（非回环）浏览器上设置 RPC 不可用，开关页降级为提示文案，行为按默认值处理。
- 提醒状态（含游标去重）保存在进程内存：宿主重启后未决审批/提问会重新提醒，已完成的提醒不会重放。
- 音频代理只读单个来源（上传槽 / 配置路径），无目录遍历面；扩展名白名单外返回 415。
- `ask_user_question` 的识别基于工具名常量 `ask_user_question`（来自官方 `dsh-tool-ask-user`）。

## 许可

MIT
