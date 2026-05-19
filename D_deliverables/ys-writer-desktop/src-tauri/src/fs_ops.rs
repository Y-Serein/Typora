use std::{fs, path::Path};

use crate::{
    model::MarkdownFile,
    path_security::{ensure_supported_text_path, normalized_extension},
    safe_fs::{atomic_write, backup_existing_file, ensure_reasonable_text_size, metadata_modified_time_ms},
};

pub fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    ensure_supported_text_path(&path)?;

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read file. Check that the file exists, is readable, and is not locked by another app: {error}"))?;
    let file_path = Path::new(&path);
    let metadata = fs::metadata(file_path)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;

    Ok(MarkdownFile {
        path: path.clone(),
        file_name: file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_string(),
        file_ext: normalized_extension(file_path).unwrap_or_else(|| "md".to_string()),
        content,
        modified_at_ms: metadata_modified_time_ms(&metadata)?,
        size: metadata.len(),
    })
}

pub fn write_markdown_file(
    path: String,
    content: String,
    expected_modified_at_ms: Option<u64>,
    expected_size: Option<u64>,
) -> Result<MarkdownFile, String> {
    ensure_supported_text_path(&path)?;
    ensure_reasonable_text_size(content.len())?;

    let file_path = Path::new(&path);
    if file_path.exists() {
        let metadata = fs::metadata(file_path)
            .map_err(|error| format!("Failed to read existing file before saving: {error}"))?;
        if !metadata.is_file() {
            return Err("Target path exists but is not a regular file. Choose another save location.".to_string());
        }

        if let (Some(expected_modified_at_ms), Some(expected_size)) = (expected_modified_at_ms, expected_size) {
            let current_modified_at_ms = metadata_modified_time_ms(&metadata)?;
            if current_modified_at_ms != Some(expected_modified_at_ms) || metadata.len() != expected_size {
                return Err("The file changed on disk after it was opened. Serein stopped the save to avoid overwriting external edits. Reopen the file, compare changes, or use Save As.".to_string());
            }
        }

        backup_existing_file(file_path)?;
    }

    atomic_write(file_path, content.as_bytes())?;
    let metadata = fs::metadata(file_path)
        .map_err(|error| format!("Saved file, but failed to read updated metadata: {error}"))?;

    Ok(MarkdownFile {
        path: path.clone(),
        file_name: file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_string(),
        file_ext: normalized_extension(file_path).unwrap_or_else(|| "md".to_string()),
        content,
        modified_at_ms: metadata_modified_time_ms(&metadata)?,
        size: metadata.len(),
    })
}
