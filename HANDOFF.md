## 当前在做什么

正式桌面版 P0 继续收敛，范围限定在 `D_deliverables/ys-writer-desktop/`，旧 HTML 原型 `D_deliverables/ys_typora_app/` 未修改。

本轮只做了两个目标：
- 工作区目录模式：打开一个真实文件夹作为 workspace，左侧显示真实目录树，只展示文件夹和 `.md/.markdown/.txt`；点击文件后在当前编辑器打开，Ctrl+S 写回真实文件，Save As 保存纯文本 Markdown。
- Rich Edit 的 Markdown 嵌套退出规则：用 Milkdown/ProseMirror command 处理空引用、空列表项、嵌套列表退出，不使用 DOM hack。

当前实现状态：
- 文件菜单已有“打开工作区”，通过 Tauri dialog 选择目录。
- `workspaceRoot`、`lastOpenedFile`、UI 状态写入 localStorage 的 `ys-writer.settings.v1`。
- workspaceRoot 模式下不再把真实文件内容长期写入 localStorage 的 cards；进入工作区后会清理 `ys-writer.workspace.v1` 草稿 cards。
- Rust command 支持读取目录树、读写 `.md/.markdown/.txt`、新建文件/文件夹、重命名、删除。
- 删除前确认在前端 `window.confirm`；删除调用 Rust `remove_file/remove_dir_all`，是真实文件系统删除。
- Milkdown Enter 规则已收紧：空 blockquote 先 `lift` 出引用；空 list item 用 `liftListItem` 只退一层；非空 list item 内的空段落用 `splitListItem` 进入下一项。

用户下一步要生成 Windows `.exe`，正确入口是仓库根目录下的 `T_tools/build_windows.ps1`，不是在 WSL 里跑 `cargo check`。

Windows PowerShell 编译命令（首选，已在 PowerShell 里时直接运行）：

```powershell
cd C:\path\to\Typora
.\T_tools\build_windows.ps1
```

如果 Windows 侧已经安装过依赖、只想跳过 npm 安装：

```powershell
cd C:\path\to\Typora
.\T_tools\build_windows.ps1 -SkipInstall
```

只有当 PowerShell 报脚本执行策略拦截时，再用备用写法：

```powershell
powershell -ExecutionPolicy Bypass -File .\T_tools\build_windows.ps1 -SkipInstall
```

预期产物位置：

```text
D_deliverables\ys-writer-desktop\src-tauri\target\release\bundle\nsis\YS Writer_0.1.0_x64-setup.exe
D_deliverables\ys-writer-desktop\src-tauri\target\release\ys-writer-desktop.exe
```

## 已经试过的方案和结果（含失败的）

- 读取了当前 `HANDOFF.md` 和 `D_deliverables/ys-writer-desktop/` 代码，确认旧 HTML 原型未触碰。
- `src/App.tsx` 原本已有目录树雏形，但还保留 recentFiles 持久化和 workspace 模式 autosave cards 的风险；本轮已移除 recentFiles 持久化，并在 workspaceRoot 模式清理草稿 cards。
- `src-tauri/src/lib.rs` 原本新建/重命名返回 `()`；本轮改为返回真实路径，前端新建文件/重命名当前文件后按真实路径打开。
- `rename_workspace_entry` 原本没有显式拒绝目标已存在；本轮已加 `target.exists()` 检查。
- `src/components/MilkdownEditor.tsx` 原本已用 `$shortcut`，本轮把 Enter 处理收紧为：blockquote 优先 lift，只有当前段落直接处在 list_item 时才处理列表退出/拆分。
- 已运行 `node node_modules/typescript/lib/tsc.js --noEmit`，结果通过。
- 已运行 `env CARGO_TARGET_DIR=/tmp/ys-writer-tauri-target /home/slam/.cargo/bin/cargo check`，结果通过。
- 未启动 Tauri GUI，未做系统文件对话框和 Rich Edit 键盘交互手测；用户说这轮由用户编译。
- 以前 Windows 打包脚本已经成功生成过 NSIS 安装包和 release exe；本轮代码变更后需要用户在 Windows PowerShell 重新运行 `T_tools/build_windows.ps1`。

## 下一步计划（3-5条actionable)

1. 在 Windows PowerShell 进入 Typora 仓库根目录，运行 `.\T_tools\build_windows.ps1 -SkipInstall` 生成 `.exe`；如果缺依赖则去掉 `-SkipInstall` 重新跑。
2. 如果脚本提示 `node_modules exists; skipping npm ci` 且依赖异常，删除 `D_deliverables\ys-writer-desktop\node_modules` 后重新运行脚本；不要在 WSL 和 Windows 之间来回重装同一个 `node_modules`。
3. 安装或直接运行生成的 `ys-writer-desktop.exe`，手测“文件 -> 打开工作区”，确认左侧显示真实目录树且只显示文件夹、`.md/.markdown/.txt`。
4. 手测点击 `.md` 和 `.txt`、Ctrl+S 写回、新建/重命名/删除文件和文件夹、重启恢复 workspaceRoot/lastOpenedFile。
5. Rich Edit 手测普通 `>` 空行、列表里的 `>` 空行、空 `-`、空 `1.`、嵌套列表空行 Enter，确认退出层级符合预期。

## 关键文件路径（相对路径，一行一个）

T_tools/build_windows.ps1
D_deliverables/ys-writer-desktop/src/App.tsx
D_deliverables/ys-writer-desktop/src/components/MilkdownEditor.tsx
D_deliverables/ys-writer-desktop/src-tauri/src/lib.rs
D_deliverables/ys-writer-desktop/src-tauri/Cargo.toml
D_deliverables/ys-writer-desktop/src-tauri/capabilities/default.json
D_deliverables/ys-writer-desktop/src/domain/model.ts
D_deliverables/ys-writer-desktop/src/styles.css
D_deliverables/ys-writer-desktop/package.json
HANDOFF.md

## 还没搞清楚的问题

- 本轮没有重新跑 Windows 打包；`.exe` 需要用户在 Windows PowerShell 运行 `T_tools/build_windows.ps1` 后确认。
- 系统文件夹选择、文件选择、Save As 对话框必须在真实 Tauri 窗口或 Windows release 包里手测；命令行无法验证对话框交互。
- Rich Edit 的嵌套 Enter 规则已通过类型检查，但还没有自动化编辑器交互测试，仍需 GUI 手测确认 ProseMirror 实际文档变换符合预期。
- 当前菜单里段落/格式/导出/查找/关于仍是 disabled 的历史占位；本轮按要求没有继续扩展灰色菜单。
- 工作区目录树当前全部展开，没有折叠状态；本轮需求未要求折叠，所以未做。
- 工作区删除文件夹使用真实 `remove_dir_all`，确认框是唯一前端保护；误删无法从应用内恢复。
