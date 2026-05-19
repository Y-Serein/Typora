use crate::{
    fs_ops,
    model::{MarkdownFile, VaultDirectory, VaultIndexResponse, VaultInitResponse, VaultWorkspaceState},
    vault,
};
use std::process::Command;

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    fs_ops::read_markdown_file(path)
}

#[tauri::command]
pub fn write_markdown_file(
    path: String,
    content: String,
    expected_modified_at_ms: Option<u64>,
    expected_size: Option<u64>,
) -> Result<MarkdownFile, String> {
    fs_ops::write_markdown_file(path, content, expected_modified_at_ms, expected_size)
}

#[tauri::command]
pub fn init_vault(root: String) -> Result<VaultInitResponse, String> {
    vault::init_vault(root)
}

#[tauri::command]
pub fn read_vault_directory(root: String, relative_path: String, limit: Option<usize>) -> Result<VaultDirectory, String> {
    vault::read_vault_directory(root, relative_path, limit)
}

#[tauri::command]
pub fn read_vault_index_files(root: String) -> Result<VaultIndexResponse, String> {
    vault::read_vault_index_files(root)
}

#[tauri::command]
pub fn create_vault_entry(root: String, relative_path: String, kind: String) -> Result<String, String> {
    vault::create_vault_entry(root, relative_path, kind)
}

#[tauri::command]
pub fn rename_vault_entry(root: String, relative_path: String, new_name: String) -> Result<String, String> {
    vault::rename_vault_entry(root, relative_path, new_name)
}

#[tauri::command]
pub fn delete_vault_entry(root: String, relative_path: String) -> Result<(), String> {
    vault::delete_vault_entry(root, relative_path)
}

#[tauri::command]
pub fn write_vault_workspace_state(root: String, workspace: VaultWorkspaceState) -> Result<(), String> {
    vault::write_workspace_state(root, workspace)
}

#[tauri::command]
pub fn open_external_target(target: String) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() || target.contains('\0') {
        return Err("invalid link target".to_string());
    }

    let status = platform_open(target)
        .map_err(|error| format!("failed to open link target: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("open command exited with status {status}"))
    }
}

#[cfg(target_os = "linux")]
fn platform_open(target: &str) -> std::io::Result<std::process::ExitStatus> {
    Command::new("xdg-open").arg(target).status()
}

#[cfg(target_os = "macos")]
fn platform_open(target: &str) -> std::io::Result<std::process::ExitStatus> {
    Command::new("open").arg(target).status()
}

#[cfg(target_os = "windows")]
fn platform_open(target: &str) -> std::io::Result<std::process::ExitStatus> {
    Command::new("powershell")
        .args(["-NoProfile", "-Command", "Start-Process -FilePath $args[0]", target])
        .status()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn platform_open(_target: &str) -> std::io::Result<std::process::ExitStatus> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "opening links is not supported on this platform",
    ))
}
