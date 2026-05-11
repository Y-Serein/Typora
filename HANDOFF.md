## 当前在做什么

正式桌面版 P0 最小闭环已经跑通：`D_deliverables/ys-writer-desktop/` 是 Tauri 2 + React + TypeScript + Milkdown 工程，旧 HTML 原型保留不动。

当前重点在修 Milkdown 编辑体验的小问题，不做 Whiteboard、拖拽、连线、云同步、插件、协作、AI、数据库、文件系统保存、导出。

当前按 `AGENTS.md` 规则准备创建本地 Git commit；提交范围应包含源码、配置、文档和交接记录，不包含 `node_modules/`、`dist/`、`src-tauri/target/`。

最近刚修：
- 同一张 Card 内输入/换行不再重建 Milkdown，避免光标消失。
- blockquote 空行按 Enter 退出引用块。
- blockquote 样式高度压低。
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

## 下一步计划（3-5条actionable)

1. 运行桌面版并手测编辑器核心路径：普通段落、标题、列表、blockquote、代码块的 Enter/Backspace/Tab/Ctrl+Z。
2. 重点验证 blockquote：输入 `> hello` 后 Enter 继续引用，再在空引用行 Enter 应退出到普通段落。
3. 如果 blockquote 在嵌套引用或列表内引用场景异常，只针对该结构补最小 keymap 规则，不重构编辑器。
4. 梳理 P0 编辑器快捷键缺口，优先处理会影响基础写作的 bug，不做导出/保存/白板。
5. P0 稳定后，再考虑真实本地保存方案：先选文件系统还是嵌入式数据库，不要直接上同步或复杂数据层。

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
- Milkdown 默认快捷键覆盖范围还没系统盘点，尤其是列表缩进、撤销/重做、代码块退出、中文输入法组合态。
- 当前只做内存 state，Card 内容切换不丢，但刷新应用会丢；本地保存方案还没定。
- WSL Windows 挂载路径的 npm/bin-links 和 Rust target 权限问题仍是环境风险；长期建议迁移到 WSL ext4 路径。
- Vite build 有 Milkdown chunk 超过 500KB 警告，P0 不处理；后续如启动性能变差再拆包。
- 还没有自动化 UI 测试；当前主要靠 `npm run build`、`cargo check`、`tauri:dev` 和手测。
