use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFile {
    pub path: String,
    pub file_name: String,
    pub file_ext: String,
    pub content: String,
    pub modified_at_ms: Option<u64>,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTreeEntry {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub kind: String,
    pub file_ext: Option<String>,
    pub children: Vec<VaultTreeEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDirectory {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub children: Vec<VaultTreeEntry>,
    pub has_more: bool,
    pub truncated: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndexFile {
    pub path: String,
    pub relative_path: String,
    pub file_name: String,
    pub file_ext: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndexResponse {
    pub files: Vec<VaultIndexFile>,
    pub truncated: bool,
    pub skipped_files: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    pub version: u8,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultLayoutState {
    pub sidebar_width: u16,
    pub sidebar_visible: bool,
    pub right_panel_visible: bool,
    pub editor_left_gap: u16,
    pub ui_scale: u16,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWorkspaceState {
    pub version: u8,
    pub recent_files: Vec<String>,
    pub last_opened_file: Option<String>,
    pub selected_dir: String,
    pub expanded_dirs: Vec<String>,
    pub layout: VaultLayoutState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInitResponse {
    pub root: String,
    pub config: VaultConfig,
    pub workspace: VaultWorkspaceState,
}
