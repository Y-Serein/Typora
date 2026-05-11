#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_linux_webview_environment();

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running YS Writer Desktop");
}

#[cfg(target_os = "linux")]
fn configure_linux_webview_environment() {
    // WSLg can spend several seconds probing EGL/Zink before WebKit renders.
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webview_environment() {}
