//! 素笺的 Rust 侧只做薄薄一层本地文件访问。
//! 所有 Markdown 解析、编辑交互都在前端完成，尽量把依赖和权限压到最小。

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::Path;

/// 文件树中一个条目的最小信息。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
}

/// 以原始字节读取文件，编码判断交给前端，避免后端猜测编码。
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("读取文件失败：{}", e))
}

/// 以 UTF-8 写入文件。调用方需保证内容已是合法 UTF-8 字符串。
#[tauri::command]
fn write_file_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| format!("写入文件失败：{}", e))
}

/// 读取文件夹的直接子项；前端负责过滤类型与隐藏文件。
#[tauri::command]
fn read_dir_entries(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("读取文件夹失败：{}", e))?;
    let mut result = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取文件夹条目失败：{}", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path().to_string_lossy().into_owned();
        let is_dir = entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);
        result.push(DirEntryInfo {
            name,
            path,
            is_dir,
        });
    }

    // 目录在前，同类按名称排序，大小写不敏感。
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

/// 新建子文件夹；不递归创建，父目录必须已存在。
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.exists() {
        return Err("同名文件夹已存在".to_string());
    }
    fs::create_dir(path).map_err(|e| format!("新建文件夹失败：{}", e))
}

/// 在当前文件夹新建空 md 文件；create_new 保证不覆盖已有文件。
#[tauri::command]
fn create_empty_file(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.exists() {
        return Err("同名文件已存在".to_string());
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
        .map_err(|e| format!("新建文件失败：{}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_cli::init())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file_bytes,
            write_file_text,
            read_dir_entries,
            create_empty_file,
            create_dir
        ])
        .run(tauri::generate_context!())
        .expect("启动素笺失败");
}
