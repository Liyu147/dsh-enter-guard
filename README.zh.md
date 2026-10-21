# dsh-enter-guard

DeepSeek Harness 的**回车二次确认**插件：第一次按 `Enter` 只是"上膛"，不发送；再按一次才真正发出；中间按任何其他键就撤销。

专治"写了一半手滑回车，消息直接飞出去"。

[English →](README.md)

```
打字 ──▶ Enter ──▶ ✗ 不发送，输入框描边，提示"再按一次 Enter 发送"
                │
                ├── 再按 Enter ──▶ ✓ 发送
                └── 按任何其他键 ──▶ 状态撤销，恢复原样
```

## 补的是什么空白

DSH 原生 `Enter` 即发，没有确认环节。唯一的设置项（设置 → 通用 → Enter 行为）只管 agent **忙碌时**回车是排队还是插话，对空闲时的误发毫无办法。

社区 6084 个插件里没有这个品类。接近的几个都只覆盖一半：`dsh-prompt-stash` 是手动暂存、`dsh-composer-plus` 增强自带队列、`dsh-sleep-send` 是定时发送、`prompt-refine` 那一族是在发送前改写草稿——**没有一个是在拦回车键本身**。

## 行为

| 场景 | 结果 |
|---|---|
| 第一次 `Enter`（无修饰键、非输入法组字、非长按重复） | **拦下**，输入框描边 + 提示 |
| 已上膛时再按 `Enter` | 放行，交回 DSH 原生发送 |
| 上膛后按**任何**其他键（字母/数字/退格/方向/Shift/Ctrl/Alt/Win/CapsLock） | 立即撤销 |
| 内容变化、输入法开始组字、失焦、点击输入框外 | 立即撤销 |
| `Ctrl`/`Cmd`+`Enter`、点发送按钮 | **直接发送**，不走确认（逃生口） |
| `/` 命令菜单或 `@` 文件菜单打开中 | 放行（此时 Enter 是选候选项） |
| 按住 `Enter` 不放（键盘重复） | 忽略，不会自己发出去 |
| 空草稿（无文字、无附件） | 不拦截 |
| 上膛后 2 秒 | 提示变淡，**状态保持**，之后按 `Enter` 仍可发送 |

## 安装

暂未发布到 npm，从源码装：

```bash
git clone https://github.com/Liyu147/dsh-enter-guard.git
dsh plugin --profile web add ./dsh-enter-guard
```

然后**重启 `dsh web`**（刷新页面不够——客户端 bundle 是启动时解析的）。

本地已有的目录一样可用，直接指向该目录：

```bash
dsh plugin --profile web add <本包路径>
```

卸载：

```bash
dsh plugin --profile web remove dsh-enter-guard
```

确认已生效——DevTools 控制台执行：

```js
__dshEnterGuard.instance.inspect()
// => { version, mounted: true, armed: false, hasCard: true, everBlocked: false, ... }
```

`hasCard: false` 表示没找到输入框锚点，见下节。
`everBlocked` 在你第一次真的被拦下回车后变成 `true`——这个字段才证明"按键链路端到端通了"。

## 兼容性

锚点来自 DSH 网页客户端（`dsh-client-ui-conversation`）：

| 选择器 | 用途 |
|---|---|
| `[data-composer-card]` | 输入框卡片（描边与提示定位） |
| `[data-composer-input]` | 编辑区（判断焦点与空草稿） |
| `[data-trigger-menu]` | 命令/文件候选菜单（放行判断） |
| `[data-composer-chip]` | 附件/引用胶囊（算作有内容） |

如果将来的 DSH 版本改了这些属性名，本插件会**安全失效**：变成空操作、回车恢复原生行为，**绝不会吞消息**。启动 5 秒后若找不到锚点，会在控制台告警。

测试环境：DSH **0.1.5-rc.3** / Windows / Chrome。

## 已知限制

1. **只管 Enter。** 发送按钮与 `Ctrl`/`Cmd`+`Enter` 始终直发——这是设计上的逃生口。
2. **拦不住直接调 `submit()` 的插件。** 语音输入类插件"识别完自动发送"绕开键盘，本插件无能为力。
3. **依赖 DOM 锚点**（见上）。
4. **移动端虚拟键盘未验证**，可能不触发 `keydown`。
5. 只认第一个匹配到的输入框卡片；正常单会话界面无影响。

## 设计说明

本插件**刻意不清空草稿、不调 `setDraft`、不碰附件管线**。文字一直留在输入框里，只是"晚一点发"。所以整个功能可以用一个只读的 DOM 监听实现，也所以随时移除都安全。

## 测试

两个零依赖的 Node 测试（假 DOM，不需要浏览器、不碰 DSH）：

```bash
node test_guard_enter_send_v1.js    # 核心状态机，17 条
node test_client_bundle_v1.js       # 打包后的 bundle，12 条
```

这两个文件在包目录的上级（开发工作区里），不随 npm 包发布。

装上后请手动过六条：

1. `/` 打开命令菜单 → `Enter` 应**选中**候选项
2. `@` 打开文件菜单 → `Enter` 应**插入**引用
3. `Shift`+`Enter` → 应**换行**，不出现描边
4. `Ctrl`+`Enter` → 应**直接发送**
5. agent 忙碌时 `Enter` → 照常排队/插话
6. 粘贴图片后 `Enter` → 附件应**随消息发出**

## 安全

只读 DOM。一组挂在 `document` 上的 `keydown`/`input`/`compositionstart`/`focusout`/`click` 监听，一个注入的 `<style>`，一个浮动提示 `<div>`。

- 没有 `fetch`、`XMLHttpRequest`、`WebSocket`
- 没有 `localStorage`、`sessionStorage`、cookie
- 不读会话数据、不写设置、宿主侧是空壳
- 判定逻辑全部包在 `try/catch` 里，**故障即放行**——内部出错时恢复原生行为，而不是把按键吃掉

## 许可

MIT，见 [LICENSE](LICENSE)。
