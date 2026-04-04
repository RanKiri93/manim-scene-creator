#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
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
