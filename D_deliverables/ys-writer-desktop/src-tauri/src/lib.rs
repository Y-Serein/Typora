use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFile {
    path: String,
    file_name: String,
    file_ext: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTreeEntry {
    name: String,
    path: String,
    relative_path: String,
    kind: String,
    file_ext: Option<String>,
    children: Vec<WorkspaceTreeEntry>,
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    ensure_supported_text_path(&path)?;

    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read file: {error}"))?;
    let file_path = Path::new(&path);

    Ok(MarkdownFile {
        path: path.clone(),
        file_name: file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_string(),
        file_ext: normalized_extension(file_path).unwrap_or_else(|| "md".to_string()),
        content,
    })
}

#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<MarkdownFile, String> {
    ensure_supported_text_path(&path)?;

    std::fs::write(&path, content.as_bytes())
        .map_err(|error| format!("Failed to write file: {error}"))?;

    let file_path = Path::new(&path);
    Ok(MarkdownFile {
        path: path.clone(),
        file_name: file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_string(),
        file_ext: normalized_extension(file_path).unwrap_or_else(|| "md".to_string()),
        content,
    })
}

#[tauri::command]
fn read_workspace_tree(root: String) -> Result<WorkspaceTreeEntry, String> {
    let root_path = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to read workspace root: {error}"))?;

    if !root_path.is_dir() {
        return Err("Workspace root is not a directory.".to_string());
    }

    build_workspace_tree(&root_path, &root_path)
}

#[tauri::command]
fn create_workspace_entry(root: String, relative_path: String, kind: String) -> Result<String, String> {
    let target = resolve_workspace_path(&root, &relative_path, false)?;
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
        _ => Err("Unsupported workspace entry kind.".to_string()),
    }
}

#[tauri::command]
fn rename_workspace_entry(root: String, relative_path: String, new_name: String) -> Result<String, String> {
    if new_name.trim().is_empty()
        || new_name.contains('/')
        || new_name.contains('\\')
        || new_name == "."
        || new_name == ".."
    {
        return Err("Invalid name.".to_string());
    }

    let source = resolve_workspace_path(&root, &relative_path, true)?;
    let target = source
        .parent()
        .ok_or_else(|| "Cannot rename workspace root.".to_string())?
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

#[tauri::command]
fn delete_workspace_entry(root: String, relative_path: String) -> Result<(), String> {
    if relative_path.trim().is_empty() {
        return Err("Cannot delete workspace root.".to_string());
    }

    let target = resolve_workspace_path(&root, &relative_path, true)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|error| format!("Failed to delete folder: {error}"))
    } else {
        fs::remove_file(&target).map_err(|error| format!("Failed to delete file: {error}"))
    }
}

fn ensure_supported_text_path(path: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    let Some(extension) = normalized_extension(file_path) else {
        return Err("Only .md, .markdown and .txt files are supported.".to_string());
    };

    match extension.as_str() {
        "md" | "markdown" | "txt" => Ok(()),
        _ => Err("Only .md, .markdown and .txt files are supported.".to_string()),
    }
}

fn build_workspace_tree(root: &Path, path: &Path) -> Result<WorkspaceTreeEntry, String> {
    let name = if path == root {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Workspace")
            .to_string()
    } else {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string()
    };
    let relative_path = path
        .strip_prefix(root)
        .ok()
        .map(to_slash_path)
        .unwrap_or_default();
    let mut children = Vec::new();

    if path.is_dir() {
        let entries = fs::read_dir(path)
            .map_err(|error| format!("Failed to read directory: {error}"))?;

        for entry in entries {
            let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
            let entry_path = entry.path();

            if entry_path.is_dir() {
                children.push(build_workspace_tree(root, &entry_path)?);
            } else if is_supported_text_path(&entry_path) {
                children.push(WorkspaceTreeEntry {
                    name: entry_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("")
                        .to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                    relative_path: entry_path
                        .strip_prefix(root)
                        .ok()
                        .map(to_slash_path)
                        .unwrap_or_default(),
                    kind: "file".to_string(),
                    file_ext: normalized_extension(&entry_path),
                    children: Vec::new(),
                });
            }
        }
    }

    children.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(WorkspaceTreeEntry {
        name,
        path: path.to_string_lossy().to_string(),
        relative_path,
        kind: "directory".to_string(),
        file_ext: None,
        children,
    })
}

fn resolve_workspace_path(root: &str, relative_path: &str, must_exist: bool) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("Absolute paths are not allowed inside workspace operations.".to_string());
    }

    let mut clean_relative = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => clean_relative.push(part),
            Component::CurDir => {}
            _ => return Err("Path traversal is not allowed.".to_string()),
        }
    }

    let root_path = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let target = root_path.join(clean_relative);
    ensure_path_inside_root(root, &target, must_exist)?;
    Ok(target)
}

fn ensure_path_inside_root(root: &str, target: &Path, must_exist: bool) -> Result<(), String> {
    let root_path = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let comparable = if must_exist {
        fs::canonicalize(target).map_err(|error| format!("Failed to resolve target path: {error}"))?
    } else {
        let parent = target
            .parent()
            .ok_or_else(|| "Target path has no parent.".to_string())?;
        fs::canonicalize(parent)
            .map_err(|error| format!("Failed to resolve target parent: {error}"))?
    };

    if comparable.starts_with(root_path) {
        Ok(())
    } else {
        Err("Target path is outside the workspace.".to_string())
    }
}

fn is_supported_text_path(path: &Path) -> bool {
    normalized_extension(path)
        .map(|extension| matches!(extension.as_str(), "md" | "markdown" | "txt"))
        .unwrap_or(false)
}

fn to_slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalized_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_linux_webview_environment();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            write_markdown_file,
            read_workspace_tree,
            create_workspace_entry,
            rename_workspace_entry,
            delete_workspace_entry,
        ])
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
