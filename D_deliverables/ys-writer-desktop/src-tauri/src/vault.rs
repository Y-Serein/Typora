use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    model::{
        VaultConfig, VaultDirectory, VaultIndexFile, VaultIndexResponse, VaultInitResponse,
        VaultLayoutState, VaultTreeEntry, VaultWorkspaceState,
    },
    path_security::{
        ensure_path_inside_root, ensure_supported_text_path, is_supported_text_path,
        normalized_extension, resolve_vault_path, should_skip_directory, to_slash_path,
    },
};

const SEREIN_DIR: &str = ".serein";
const VAULT_CONFIG: &str = "vault.json";
const WORKSPACE_CONFIG: &str = "workspace.json";
const INDEX_FILE_LIMIT: usize = 2000;
const INDEX_FILE_SIZE_LIMIT: u64 = 1024 * 1024;

pub fn init_vault(root: String) -> Result<VaultInitResponse, String> {
    let root_path = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to resolve vault root: {error}"))?;
    if !root_path.is_dir() {
        return Err("Vault root is not a directory.".to_string());
    }

    let serein_dir = root_path.join(SEREIN_DIR);
    fs::create_dir_all(&serein_dir)
        .map_err(|error| format!("Failed to create .serein metadata directory: {error}"))?;

    let config_path = serein_dir.join(VAULT_CONFIG);
    let workspace_path = serein_dir.join(WORKSPACE_CONFIG);
    let config = read_or_create_vault_config(&root_path, &config_path)?;
    let workspace = read_or_create_workspace_state(&workspace_path)?;

    Ok(VaultInitResponse {
        root: root_path.to_string_lossy().to_string(),
        config,
        workspace,
    })
}

pub fn write_workspace_state(root: String, workspace: VaultWorkspaceState) -> Result<(), String> {
    let root_path = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to resolve vault root: {error}"))?;
    if !root_path.is_dir() {
        return Err("Vault root is not a directory.".to_string());
    }

    let serein_dir = root_path.join(SEREIN_DIR);
    fs::create_dir_all(&serein_dir)
        .map_err(|error| format!("Failed to create .serein metadata directory: {error}"))?;
    write_json(&serein_dir.join(WORKSPACE_CONFIG), &normalize_workspace_state(workspace))
}

pub fn read_vault_directory(root: String, relative_path: String, limit: Option<usize>) -> Result<VaultDirectory, String> {
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    let root_path = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to read vault root: {error}"))?;

    if !root_path.is_dir() {
        return Err("Vault root is not a directory.".to_string());
    }

    let directory = resolve_vault_path(&root, &relative_path, true)?;
    if !directory.is_dir() {
        return Err("Vault path is not a directory.".to_string());
    }

    let relative_path = directory
        .strip_prefix(&root_path)
        .ok()
        .map(to_slash_path)
        .unwrap_or_default();
    let mut children = Vec::new();
    let mut truncated = false;
    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read directory: {error}"))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let entry_path = entry.path();
        let file_type = entry.file_type()
            .map_err(|error| format!("Failed to read directory entry type: {error}"))?;
        let name = entry_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();

        if file_type.is_dir() {
            if should_skip_directory(&name) {
                continue;
            }

            children.push(VaultTreeEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                relative_path: entry_path
                    .strip_prefix(&root_path)
                    .ok()
                    .map(to_slash_path)
                    .unwrap_or_default(),
                kind: "directory".to_string(),
                file_ext: None,
                children: Vec::new(),
            });
        } else if file_type.is_file() && is_supported_text_path(&entry_path) {
            children.push(VaultTreeEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                relative_path: entry_path
                    .strip_prefix(&root_path)
                    .ok()
                    .map(to_slash_path)
                    .unwrap_or_default(),
                kind: "file".to_string(),
                file_ext: normalized_extension(&entry_path),
                children: Vec::new(),
            });
        }

        if children.len() > limit {
            children.truncate(limit);
            truncated = true;
            break;
        }
    }

    children.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(VaultDirectory {
        name: directory
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Vault")
            .to_string(),
        path: directory.to_string_lossy().to_string(),
        relative_path,
        children,
        has_more: truncated,
        truncated,
        error: None,
    })
}

pub fn read_vault_index_files(root: String) -> Result<VaultIndexResponse, String> {
    let root_path = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to read vault root: {error}"))?;

    if !root_path.is_dir() {
        return Err("Vault root is not a directory.".to_string());
    }

    let mut files = Vec::new();
    let mut truncated = false;
    let mut skipped_files = 0;
    collect_vault_index_files(&root_path, &root_path, &mut files, &mut truncated, &mut skipped_files)?;

    files.sort_by(|left, right| left.relative_path.to_lowercase().cmp(&right.relative_path.to_lowercase()));

    Ok(VaultIndexResponse {
        files,
        truncated,
        skipped_files,
    })
}

pub fn create_vault_entry(root: String, relative_path: String, kind: String) -> Result<String, String> {
    let target = resolve_vault_path(&root, &relative_path, false)?;
    if target.exists() {
        return Err("Target already exists.".to_string());
    }

    match kind.as_str() {
        "file" => {
            ensure_supported_text_path(
                target
                    .to_str()
                    .ok_or_else(|| "Target path is not valid UTF-8.".to_string())?,
            )?;
            fs::write(&target, b"").map_err(|error| format!("Failed to create file: {error}"))?;
            Ok(target.to_string_lossy().to_string())
        }
        "directory" => {
            fs::create_dir(&target).map_err(|error| format!("Failed to create folder: {error}"))?;
            Ok(target.to_string_lossy().to_string())
        }
        _ => Err("Unsupported vault entry kind.".to_string()),
    }
}

pub fn rename_vault_entry(root: String, relative_path: String, new_name: String) -> Result<String, String> {
    if new_name.trim().is_empty()
        || new_name.contains('/')
        || new_name.contains('\\')
        || new_name == "."
        || new_name == ".."
    {
        return Err("Invalid name.".to_string());
    }

    let source = resolve_vault_path(&root, &relative_path, true)?;
    let target = source
        .parent()
        .ok_or_else(|| "Cannot rename vault root.".to_string())?
        .join(new_name.trim());

    if source.is_file() {
        ensure_supported_text_path(
            target
                .to_str()
                .ok_or_else(|| "Target path is not valid UTF-8.".to_string())?,
        )?;
    }

    ensure_path_inside_root(&root, &target, false)?;
    if target.exists() {
        return Err("Target already exists.".to_string());
    }

    fs::rename(&source, &target).map_err(|error| format!("Failed to rename entry: {error}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn delete_vault_entry(root: String, relative_path: String) -> Result<(), String> {
    if relative_path.trim().is_empty() {
        return Err("Cannot delete vault root.".to_string());
    }

    let target = resolve_vault_path(&root, &relative_path, true)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|error| format!("Failed to delete folder: {error}"))
    } else {
        fs::remove_file(&target).map_err(|error| format!("Failed to delete file: {error}"))
    }
}

fn collect_vault_index_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<VaultIndexFile>,
    truncated: &mut bool,
    skipped_files: &mut usize,
) -> Result<(), String> {
    if files.len() >= INDEX_FILE_LIMIT {
        *truncated = true;
        return Ok(());
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read vault index directory: {error}"))?;

    for entry in entries {
        if files.len() >= INDEX_FILE_LIMIT {
            *truncated = true;
            break;
        }

        let entry = entry.map_err(|error| format!("Failed to read vault index entry: {error}"))?;
        let entry_path = entry.path();
        let file_type = entry.file_type()
            .map_err(|error| format!("Failed to read vault index entry type: {error}"))?;
        let name = entry_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();

        if file_type.is_dir() {
            if should_skip_directory(&name) {
                continue;
            }

            collect_vault_index_files(root, &entry_path, files, truncated, skipped_files)?;
            continue;
        }

        if !file_type.is_file() || !is_supported_text_path(&entry_path) {
            continue;
        }

        let metadata = entry.metadata()
            .map_err(|error| format!("Failed to read vault index file metadata: {error}"))?;
        if metadata.len() > INDEX_FILE_SIZE_LIMIT {
            *skipped_files += 1;
            continue;
        }

        let content = match fs::read_to_string(&entry_path) {
            Ok(content) => content,
            Err(_) => {
                *skipped_files += 1;
                continue;
            }
        };

        files.push(VaultIndexFile {
            path: entry_path.to_string_lossy().to_string(),
            relative_path: entry_path
                .strip_prefix(root)
                .ok()
                .map(to_slash_path)
                .unwrap_or_else(|| name.clone()),
            file_name: name,
            file_ext: normalized_extension(&entry_path).unwrap_or_else(|| "md".to_string()),
            content,
        });
    }

    Ok(())
}

fn read_or_create_vault_config(root: &Path, path: &Path) -> Result<VaultConfig, String> {
    if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("Failed to read vault config: {error}"))?;
        let mut config: VaultConfig = serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse vault config: {error}"))?;
        config.updated_at = timestamp_string();
        write_json(path, &config)?;
        return Ok(config);
    }

    let now = timestamp_string();
    let config = VaultConfig {
        version: 1,
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Vault")
            .to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    write_json(path, &config)?;
    Ok(config)
}

fn read_or_create_workspace_state(path: &Path) -> Result<VaultWorkspaceState, String> {
    if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("Failed to read vault workspace state: {error}"))?;
        let workspace: VaultWorkspaceState = serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse vault workspace state: {error}"))?;
        let workspace = normalize_workspace_state(workspace);
        write_json(path, &workspace)?;
        return Ok(workspace);
    }

    let workspace = default_workspace_state();
    write_json(path, &workspace)?;
    Ok(workspace)
}

fn default_workspace_state() -> VaultWorkspaceState {
    VaultWorkspaceState {
        version: 1,
        recent_files: Vec::new(),
        last_opened_file: None,
        selected_dir: String::new(),
        expanded_dirs: vec![String::new()],
        layout: VaultLayoutState {
            sidebar_width: 240,
            sidebar_visible: true,
            right_panel_visible: true,
            editor_left_gap: 42,
            ui_scale: 100,
        },
    }
}

fn normalize_workspace_state(mut workspace: VaultWorkspaceState) -> VaultWorkspaceState {
    workspace.version = 1;
    workspace.recent_files.truncate(12);
    if workspace.expanded_dirs.is_empty() {
        workspace.expanded_dirs.push(String::new());
    }
    workspace.layout.sidebar_width = workspace.layout.sidebar_width.clamp(180, 360);
    workspace.layout.editor_left_gap = workspace.layout.editor_left_gap.clamp(16, 140);
    workspace.layout.ui_scale = workspace.layout.ui_scale.clamp(85, 130);
    workspace
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize vault metadata: {error}"))?;
    fs::write(path, serialized.as_bytes())
        .map_err(|error| format!("Failed to write vault metadata: {error}"))
}

fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
