use crate::{
    fs_ops,
    model::{MarkdownFile, VaultDirectory, VaultIndexResponse, VaultInitResponse, VaultWorkspaceState},
    vault,
};

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    fs_ops::read_markdown_file(path)
}

#[tauri::command]
pub fn write_markdown_file(path: String, content: String) -> Result<MarkdownFile, String> {
    fs_ops::write_markdown_file(path, content)
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
