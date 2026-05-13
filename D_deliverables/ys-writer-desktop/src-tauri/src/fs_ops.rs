use std::{fs, path::Path};

use crate::{
    model::MarkdownFile,
    path_security::{ensure_supported_text_path, normalized_extension},
};

pub fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    ensure_supported_text_path(&path)?;

    let content = fs::read_to_string(&path)
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

pub fn write_markdown_file(path: String, content: String) -> Result<MarkdownFile, String> {
    ensure_supported_text_path(&path)?;

    fs::write(&path, content.as_bytes())
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
