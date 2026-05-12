@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo Starting measure server and Vite app in separate windows...
echo   Measure: http://127.0.0.1:8765
echo   App:     see the Vite window for the local URL
echo.

start "Measure server (uvicorn 8765)" cmd /k "cd /d ""%ROOT%"" && uvicorn measure_server:app --reload --port 8765"
start "Manim timeline (Vite)" cmd /k "cd /d ""%ROOT%\manim-timeline"" && npm run dev"

endlocal
