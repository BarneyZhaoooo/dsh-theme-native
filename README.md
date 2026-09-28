# dsh-theme-codex

DSH Web GUI 的主题插件：10 个主流主题预设 + 强调色/背景/前景自定义，走官方 `ctx.theme.overrideTokens` 通道。

## 为什么改 35 个色阶就够了

DSH 的令牌是两层：99 个 `--dsw-alias-*` 语义令牌全部引用 77 个 `--dsw-static-*` 色阶，而**色阶在明暗两模式下取值相同**——明暗差异只体现在每个 alias 读哪个档位。所以重铺色阶，alias 层（含 hover、选中态、边框、阴影派生）会自动跟着变，不需要逐个改写。

## 管线

```bash
NODE='ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"'
$NODE tools/extract-palette.mjs --out baseline-palette.json   # DSH 安装产物 -> 令牌清单 + 默认值
$NODE tools/build-presets.mjs                                  # Prowl 主题 + Codex config -> presets.json
$NODE tools/emit-plugin.mjs                                    # presets.json + 内联色阶代码 -> plugin/client.js
$NODE tools/verify-runtime.mjs                                 # 验证已打包产物
$NODE tools/verify-manifest.mjs                                # 验证发布契约（patch / icon / locale / exports / 身份一致）
$NODE tools/simulate-client.mjs                                # 在 Node 里跑一遍 apply，验证载荷形状
$NODE tools/release.mjs                                        # 改名 + 重新生成 + 验证（一条命令）
```

`verify-runtime.mjs` 管**形状**（token 是否成对、色阶是否漂移），`simulate-client.mjs` 管**能不能跑起来**（`apply` 会不会抛）。后者挡住的是那个代价很高的失败：插件回调里的异常会被 cordis 接住，不写进崩溃日志的控制台捕获，宿主只报一句 `1 entry did not activate`，然后整个 Web 应用拒绝启动。

`verify-manifest.mjs` 管**能不能装**：patch 是否挂载了这个包、icon 是否合规、`locale` 是否带展示文案、`exports` 是否暴露了官方要求的两项，以及包名 / patch 行 id / `client.js` 里的 loader id 三处身份是否一致——改名最容易漏的正是最后一处。

前两条（`extract-palette.mjs`、`build-presets.mjs`）是作者本机的提取流程：从已安装的 DSH 产物取令牌清单，再从本机的 ghostty 主题库与 Codex 外观配置取配色锚点。它们需要对应文件存在于本机，别人跑不了；`presets.json` 已经入库，所以从 `emit-plugin.mjs` 起的链路任何人都能跑。

`verify-runtime` 的第一项是**新鲜度闸门**：客户端产物是 `emit-plugin.mjs` 里一个大模板字面量，模板里混进一个反引号就会让 `emit` 解析失败、写不出文件，而后续断言会全部跑在**上一版产物**上通过。所以 `emit` 会把「生成器 + presets.json」的哈希写进产物头，`verify` 重新算一遍比对——不一致就当场失败。

`release.mjs` 在 `verify-runtime.mjs` 不通过时会中断，所以验证不过的包不会被改名安装。

**为什么需要 `release.mjs`**：客户端产物带 `cache-control: public, max-age=31536000, immutable`，而 URL 里的 `rev` 是**整批图**的哈希、不随单文件内容变化。所以改了 `client.js` 不换 URL，浏览器一定继续跑旧脚本。改名是本地开发期唯一可用的杠杆。按正式包发布后版本号会自动改变 URL，这个脚本就不需要了。

## 色值来源（零手抄）

| 来源 | 用途 |
|---|---|
| `/Applications/Prowl.app/Contents/Resources/ghostty/themes/`（463 个主题） | 10 个预设的亮/暗配色锚点 |
| `~/.codex/config.toml` `[desktop.appearance*ChromeTheme]` | Flexoki 预设调过的端点、强调色、字体 |
| DSH 安装产物 | 令牌清单与档位（`build-presets` 会断言，DSH 升级改动档位会直接构建失败） |

预设存的是**源锚点**（背景、前景、每族基色），不是冻结色表；`tools/lib/ramp.mjs` 与 `ladder.mjs` 被原样内联进客户端（去掉 `export`），所以运行时重算与构建期共用一份实现。

## 界面结构

设置左侧「主题」进入，页面是一个分组、六行：

| 行 | 控件 | 说明 |
|---|---|---|
| 主题 | 下拉（`Aa` + 当前预设名） | 展开后每项显示浅/深小样 + 名称，当前项打勾 |
| 强调色 | 色块 + 色号 + 来源下拉 | 来源为「跟随主题」时色块只读，选「自定义」才可编辑 |
| 背景 | 浅/深两个色块 + 色号 | 一行同时呈现两种模式，不做模式切换 |
| 前景 | 同上 | |
| 正文字体 | 下拉 | 「默认」= DSH 自带栈，「系统」= 通用系统栈，再加本机实际装了的比例字体（候选池：苹方、冬青黑体、Helvetica Neue、Arial、Georgia、宋体、楷体、Inter、Geist、思源黑体） |
| 代码字体 | 下拉 | 「默认」= DSH 自带栈，「系统等宽」= 通用系统等宽栈，再加本机实际装了的等宽字体（候选池 12 款：JetBrains Mono、Fira Code、Cascadia Code、Hack、IBM Plex Mono、Source Code Pro、Geist Mono、Maple Mono、Victor Mono、霞鹜文楷等宽…） |

底部是正文对比度读数（浅色/深色各一个比值，低于 4.5:1 会标红并写明）和「清除自定义」。后者是文字按钮而不是带边框的按钮：面板每行已经有一个控件，footer 再加一个容器会跟它们抢注意力。它只清除自定义色号，不动已选预设；没有自定义项时显示「未做自定义」且不可点，悬停有说明。明暗模式不在这页，归 DSH 官方「通用设置 → 外观」。

「正文字体」改 `--dsw-font-family`（界面与会话正文），「代码字体」改 `--ds-font-family-code`（代码块与等宽内容）。两行互不影响，等宽字体不会漏进正文。每个选项都带完整降级链。

插件没法随包分发字体文件——DSH 的 bundle 路由只对外提供这个包自己的客户端脚本——所以清单只能来自系统已装字体：启动时用 canvas 实测每个族是否可用，**只列出真的能用的**，不摆一个选了没反应的菜单。这也不是抄 Codex 或 Cindy，两家都没有自带代码字体（Codex 只带 KaTeX 数学字体，Cindy 那批 woff2 是图标子集）。

**能不能自带字体？** 两条路都不通，但第三条通：路由只放行 `client*.js`（`CLIENT_CHUNK` 正则）和它们的 sourcemap，字体文件发不出去；不过应用页面没有 CSP meta，所以把字体以 base64 `data:` URL 内联进客户端脚本、用 `@font-face` 注册是可行的。代价是体积——latin 子集 woff2 大约 20–60KB（内联后 ×1.37），带中文的等宽字体是 5–15MB 量级，会拖慢每次启动。所以现阶段仍以系统字体为主。

字体不走 `overrideTokens`，而是插件自己的一条样式规则。原因是切换字体会重发整个主题快照：presenter 会先删掉 body 上全部 token 再写回去，应用整体重渲染一次——肉眼看就是整页抖一下。现在改一条 `body{--dsw-font-family:…;--ds-font-family-code:…}` 规则只有一次样式重算，而且色阶没变时连 `overrideTokens` 都不再调用。

下拉带完整键盘语义：`aria-haspopup`/`aria-expanded`、方向键移动、Enter 选择、Esc 收起并把焦点还给按钮、Tab 直接离开。

## 已验证 / 未验证

已用实际测量验证：

- 对比度：10 个预设全部满足正文 ≥4.5:1、大字与图形 ≥3.0:1、相邻表面层级 ≥1.1、文字阶梯不反转
- 生成值与真实渲染像素交叉核对：`#f5f3ed`、`#e1e0da` 与截图取样**逐通道差 0**
- 运行时验证：内联块与源模块零漂移，23 个自定义色号用例（含近黑背景、白底白字、反色）保持文档化的下限与单调性
- 真实页面（2026-09-28，DSH Desktop 0.1.7-rc.2）：应用正常启动、设置导航出现「主题」并在「技能」与「Agent 预设」之间渲染；`ctx.slots.inject` 排在 `overrideTokens` 之后，所以分区出现即证明覆盖层成功返回并生效
- 行式界面实测：六行的标签与控件、强调色「跟随主题」时的只读色块、底部对比度徽标与重置按钮均按设计渲染
- 下拉实测：展开后是可读的 listbox（10 个预设 + 当前项选中），Esc 收起后焦点回到触发按钮
- 正文字体 / 代码字体两行下拉实测：只列出本机装了的族，当前项标为「默认」，Esc 收起后焦点回到触发按钮
- 面板渲染纳入 `simulate-client.mjs`：直接调用一次 section 组件，渲染路径里的拼写错误会当场失败
- 只读态实测：「强调色」跟随主题时渲染成静态色块，不再是禁用的取色器（禁用控件看着像坏了）
- 覆盖层实测（Node 模拟 `apply`）：77 个色阶 token 全部是 `{ light, dark }` 对；装好代码字体样式表；切换字体**不**重发主题，只改样式规则；关闭开关会移除样式表并不再推送覆盖层

**未验证**：

- 预设切换后的即时重绘与浅/深两色像素比对
- 关闭开关后回读 DSH 官方原值（代码路径与模拟已验证，真实页面未取回读证据）
- 方向键在展开菜单中的移动

### `overrideTokens` 的取值契约（踩过的坑）

主题服务的每个 token 必须是 `{ light, dark }` 成对值；传裸字符串会被 `validateOverrides` 直接抛错，`apply` 失败后 fiber 永远停在 `loading`，宿主以 `web boot: 1 entry did not activate` 拒绝启动整页。字体这类与配色无关的值也要重复成一对。生成器 `tools/emit-plugin.mjs` 已统一把 `presets.json` 里的字符串字体包成对，改生成器后重新 `emit-plugin` 即可。

## 安装

用工作区里的 bundle 目录安装：

```
plugin_manager  action=install_bundle  target=/path/to/dsh-theme-codex/plugin
```

由管理器完成包安装与 bundle 选择。**不要**手改 profile 的 `package.json`、`cordis.patch.yml`，也不要在 profile 目录跑 pnpm——官方规范明确禁止这三件事。是否真的生效只看返回的 `application` 与 `warnings`，不看日志、进程表或页面 payload。

DSH Desktop（Electron 版）不走 `dsh plugin` CLI：桌面 profile 由宿主进程内的管理器独占，安装与移除在「设置 → 插件」里完成，或交给同一个 `manager.installBundle`。

包发布到 npm 之后，按版本安装：

```
plugin_manager  action=install_bundle  target=@barneyzhaoooo/dsh-theme-codex@0.1.0
```

## 卸载

```
plugin_manager  action=remove_bundle  target=@barneyzhaoooo/dsh-theme-codex
```

覆盖层被 dispose 后界面立即回到 DSH 官方外观。开关与预设存在 localStorage 的 `codex-theme:*` 键，与包名无关，重装或改名都不会丢。

## 发布形态

DSH **没有官方插件市场**；发现渠道是社区的 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录，`dshmarket` 读它的 `plugins.json`。要进市场，向那个仓库提一条 PR 即可，通常一天内收录。

| 项 | 状态 |
|---|---|
| 包名 | `@barneyzhaoooo/dsh-theme-codex` |
| `dsh.bundle.patch`、顶层 `icon`、`locale/{en,zh}.json`、`exports` | 已满足 |
| `peerDependencies` | `@deepseek-ai/dsh >= 0.1.7-rc.2`。社区兼容判据只看这个，`dsh.compatibility` 不是官方字段 |
| `tools/verify-manifest.mjs` | 把上述契约固化成可执行检查，`release.mjs` 改名后自动跑 |
| `npm publish` | 待做 |
| awesome-dsh-plugin PR | 待做 |

本地 link 开发时不要带 `peerDependencies`：pnpm 10+ 默认 `auto-install-peers=true`，可能把宿主包真的拖进 profile。发布用的这份带 peer，是本机开发目录的刻意差异。
