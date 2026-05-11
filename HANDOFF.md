## 当前在做什么

正式桌面版 P0 最小闭环已经跑通：`D_deliverables/ys-writer-desktop/` 是 Tauri 2 + React + TypeScript + Milkdown 工程，旧 HTML 原型保留不动。

当前重点在修 Milkdown 编辑体验的小问题，不做 Whiteboard、拖拽、连线、云同步、插件、协作、AI、数据库、文件系统保存、导出。

本轮刚修正式桌面版 P0 真实使用 bug，范围只在 `D_deliverables/ys-writer-desktop/`，没有改旧 HTML 原型 `D_deliverables/ys_typora_app/`。

最近刚修：
- 同一张 Card 内输入/换行不再重建 Milkdown，避免光标消失。
- blockquote 空行按 Enter 退出引用块。
- blockquote 样式高度压低。
- Save 不再只更新时间戳；现在会把 cards 写入 localStorage，启动时优先恢复已保存 cards，读取失败或无数据才 fallback demo。
- Save 按钮现在有点击反馈：成功后短暂显示 `Saved` 并变色，失败时显示 `Failed`。
- 启动卡顿方向修正：`React.lazy` 拆 Milkdown 的方案已撤回，因为用户反馈变得更慢；当前改为移除 React dev `StrictMode`，避免 Milkdown 在开发模式被重复挂载初始化。
- 布局调整：把 Save/New/Export/Undo/Redo/Ink 放到顶部应用菜单栏；移除右侧常驻 Outline/Info 栏；Outline 移到左侧 Cards 下方；移除 P0 之外的 Whiteboards 占位。
- Markdown 第一行存在一级标题 `# xxx` 时，会同步当前 card.title，左侧 Cards 会跟随变化；没有一级标题时保留原标题。
- 左侧 Outline 现在点击会滚动到 Milkdown 中对应的 h1/h2/h3，并补了 hover/focus 可点击反馈。
- 左侧 Cards 的 `+` 已启用，会创建默认“未命名文档”并自动选中；Save 后可持久化。
- WSLg/MESA/EGL warning 只记录，不作为 P0 阻塞。

## 已经试过的方案和结果（含失败的）

- `npm install` 在 WSL Windows 挂载路径上出现 bin-links/chmod 权限问题；当前采用 `npm install --no-bin-links`，并在 `package.json` scripts 里直接调用 `node node_modules/...` 的 JS 入口。
- 默认 Rust target 在 Windows 挂载路径下会遇到 permission manifest 写入问题；当前使用 `CARGO_TARGET_DIR=/tmp/ys-writer-tauri-target` 规避。
- `cargo check` 曾因缺少 `dbus-1.pc` 失败；解决方式是安装 `libdbus-1-dev pkg-config`。
- 安装 dbus 后又遇到 `glib-2.0`、`gio-2.0`、`gobject-2.0` 缺失；需要补齐 Tauri Linux 官方 GTK/WebKitGTK 依赖。
- Tauri 窗口已能启动；启动日志里仍有 WSLg/MESA/EGL warning，暂不处理系统图形配置。
- 曾在仓库根目录运行 `npm run tauri:dev`，失败原因是根目录没有 `package.json`；正确目录是 `D_deliverables/ys-writer-desktop/`。
- 曾遇到 `Port 1420 is already in use`；原因是旧 dev server 占用端口，需结束旧进程后重试。
- `MilkdownEditor` 最初把 `markdown` 放进 `useEditor` 依赖，导致输入后编辑器重建、换行光标消失；已改成挂载时读取初始 Markdown，变化只回写 state。
- blockquote 退出逻辑没有用 DOM hack；当前用 Milkdown `$shortcut` + ProseMirror `lift`，只拦截 blockquote 内空 paragraph 的 Enter。
- 最近验证：`npm run build` 通过，`cargo check` 通过，`tauri:dev` 能启动到桌面二进制运行阶段；`timeout` 退出码 124 是主动结束进程，不是构建失败。
- 本轮验证：在 `D_deliverables/ys-writer-desktop/` 运行 `npm run build` 通过；在 `src-tauri/` 运行 `env CARGO_TARGET_DIR=/tmp/ys-writer-tauri-target /home/slam/.cargo/bin/cargo check` 通过。
- Save 反馈补丁验证：`npm run build` 通过，`cargo check` 通过。
- 启动白屏错误方向：`React.lazy` 曾让主入口 JS 从约 512KB 降到约 150KB，但用户反馈实际更慢，已撤回。
- 当前启动卡顿补丁验证：撤回懒加载并移除 `React.StrictMode` 后，`npm run build` 通过，`cargo check` 通过。
- `npm run build` 重新出现 Milkdown/Vite chunk 超过 500KB 警告，当前为接受的回退结果。
- 本轮布局补丁验证：`npm run build` 通过，`cargo check` 通过。

## 下一步计划（3-5条actionable)

1. 运行桌面版手测：新建 Card，修改 `# 一级标题` 和正文，点击 Save，刷新或重启 dev 后确认内容恢复。
2. 手测顶部菜单栏里的 New/Save/Ink 是否符合桌面应用习惯，Save 是否仍有反馈。
3. 手测左侧 Cards 标题是否随第一行 `# xxx` 变化；删除一级标题后确认保留旧标题。
4. 手测左侧 Outline 点击是否能滚动到对应标题附近，尤其是同名标题和较长文档。
5. 继续验证编辑器核心路径：普通段落、标题、列表、blockquote、代码块的 Enter/Backspace/Tab/Ctrl+Z。

## 关键文件路径（相对路径，一行一个）

C_context/desktop_landing_plan.md
C_context/heptabase_like_data_model.md
C_context/logs.txt
D_deliverables/ys-writer-desktop/package.json
D_deliverables/ys-writer-desktop/src/App.tsx
D_deliverables/ys-writer-desktop/src/components/MilkdownEditor.tsx
D_deliverables/ys-writer-desktop/src/styles.css
D_deliverables/ys-writer-desktop/src/data/demoWorkspace.ts
D_deliverables/ys-writer-desktop/src/domain/model.ts
D_deliverables/ys-writer-desktop/src-tauri/Cargo.toml
D_deliverables/ys-writer-desktop/src-tauri/tauri.conf.json
D_deliverables/ys-writer-desktop/src-tauri/capabilities/default.json
D_deliverables/ys_typora_app/

## 还没搞清楚的问题

- blockquote 退出逻辑已通过构建验证，但还需要用户在真实 Tauri 窗口里手测确认交互是否完全符合 Typora 习惯。
- localStorage 持久化已通过构建验证，但还没在真实 Tauri 窗口里手动刷新/重启验证。
- 保存位置不是项目里的 Markdown 文件；当前写入 Tauri WebView 的 localStorage，key 是 `ys-writer.workspace.v1`。后续如果需要可见文件，需要单独实现文件系统保存。
- 当前 dev 模式启动约 5s 偏慢；懒加载方向已证明体感不对并撤回。当前假设是 React dev `StrictMode` 导致 Milkdown 初始化重复，已移除但还没在真实 Tauri 窗口里验证体感。
- Outline 点击通过 DOM heading 顺序匹配跳转；同名标题理论上可用，但还没做自动化 UI 测试。
- Milkdown 默认快捷键覆盖范围还没系统盘点，尤其是列表缩进、撤销/重做、代码块退出、中文输入法组合态。
- 当前保存方案只做 localStorage，不是文件系统保存；跨设备、导出、数据库、云同步都未做。
- WSL Windows 挂载路径的 npm/bin-links 和 Rust target 权限问题仍是环境风险；长期建议迁移到 WSL ext4 路径。
- Vite build 有 Milkdown chunk 超过 500KB 警告，P0 不处理；后续如启动性能变差再拆包。
- 还没有自动化 UI 测试；当前主要靠 `npm run build`、`cargo check`、`tauri:dev` 和手测。
