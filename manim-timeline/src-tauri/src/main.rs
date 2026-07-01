#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Holds the PyInstaller measure-server child so we can kill it on exit.
struct MeasureSidecar(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn kill_sidecar<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(cell) = app.try_state::<MeasureSidecar>() {
        if let Ok(mut g) = cell.0.lock() {
            if let Some(child) = g.take() {
                let _ = child.kill();
            }
        }
    }
}

fn measure_server_is_healthy() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], 8765));
    let timeout = Duration::from_millis(250);
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:8765\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    response.starts_with("HTTP/1.1 200") && response.contains("\"status\":\"ok\"")
}

#[tauri::command]
fn read_project_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_project_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, data).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![read_project_bytes, write_project_bytes])
        .setup(|app| {
            // Create the main window in Rust so we can attach a navigation guard.
            // WebView2 may navigate the top-level document to `blob:`/`data:` URLs
            // (e.g. an anchor-download fallback), which strands the SPA on a dead
            // page ("Page not found") and loses unsaved in-memory state. Cancelling
            // those navigations keeps the app alive.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Manim Timeline")
                .inner_size(1280.0, 800.0)
                .on_navigation(|url| {
                    let scheme = url.scheme();
                    scheme != "blob" && scheme != "data"
                })
                .build()?;

            if measure_server_is_healthy() {
                println!("measure-server: reusing existing healthy server at http://127.0.0.1:8765");
                return Ok(());
            }

            let handle = app.handle().clone();
            match handle.shell().sidecar("measure-server") {
                Ok(cmd) => match cmd.spawn() {
                    Ok((rx, child)) => {
                        app.manage(MeasureSidecar(Mutex::new(Some(child))));
                        tauri::async_runtime::spawn(async move {
                            let mut rx = rx;
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        println!(
                                            "[measure-server][stdout] {}",
                                            String::from_utf8_lossy(&line)
                                        );
                                    }
                                    CommandEvent::Stderr(line) => {
                                        eprintln!(
                                            "[measure-server][stderr] {}",
                                            String::from_utf8_lossy(&line)
                                        );
                                    }
                                    CommandEvent::Error(err) => {
                                        eprintln!("[measure-server][error] {}", err);
                                    }
                                    CommandEvent::Terminated(status) => {
                                        eprintln!("[measure-server] terminated: {:?}", status);
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!(
                            "measure-server: spawn failed ({}). Place PyInstaller output in src-tauri/binaries/ — see scripts/README-sidecar.md",
                            e
                        );
                    }
                },
                Err(e) => {
                    eprintln!(
                        "measure-server: sidecar not found ({}). Build with scripts/build-measure-sidecar.ps1",
                        e
                    );
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                kill_sidecar(&window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                kill_sidecar(&app_handle);
            }
        });
}
