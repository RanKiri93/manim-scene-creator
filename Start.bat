@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo Starting measure server and Manim Timeline (Tauri desktop)...
echo   Measure: http://127.0.0.1:8765
echo   App:     a desktop window should open - saves go to disk ^(not browser downloads^)
echo           Requires Rust and MSVC on Windows; see manim-timeline\TAURI.md if build fails.
echo.

start "Measure server (uvicorn 8765)" cmd /k "cd /d ""%ROOT%"" && uvicorn measure_server:app --reload --port 8765"
start "Manim Timeline (Tauri)" cmd /k "cd /d ""%ROOT%\manim-timeline"" && npm run tauri:dev"

endlocal
