## 2026-05-11｜Tauri 运行时为什么像有后端

### 原始问题
为什么运行伴随着一个后端，能不能不要

### 答案核心
- `npm run tauri:dev` 会同时启动 Vite dev server 和 Tauri/Rust 桌面壳，所以开发期看起来像“前端 + 后端”。
- 打包后的 `.exe` 不需要 Vite dev server，前端资源会被打进应用包里。
- Tauri 应用本身仍会有一个 Rust 主进程，它是桌面壳和系统 API 桥，不等同于网络后端服务。
- 如果只想测试启动速度和真实用户体验，应优先运行 release `.exe`，不要用 `tauri:dev` 判断最终体验。
- 完全不要 Rust/Tauri 主进程就不是 Tauri 架构，需要换成纯 Web/浏览器应用或其他桌面壳。

### 相关引用
- D_deliverables/ys-writer-desktop/package.json
- D_deliverables/ys-writer-desktop/src-tauri/tauri.conf.json
- D_deliverables/ys-writer-desktop/src-tauri/src/lib.rs

### 备注
- 适用于当前 Tauri 2 + Vite + React 工程。
