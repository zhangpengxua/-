@echo off
title AI-Start

echo ===============================================
echo          DeepSeek AI Solver - Start
echo ===============================================
echo.

:: Go to script folder
set ROOT=%~dp0
cd /d "%ROOT%"

:: Check Node.js
echo [1/5] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo Install: https://nodejs.org/
    pause
    exit /b 1
)
echo        Node.js OK
echo.

:: Check npm
echo [2/5] Checking npm...
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found, reinstall Node.js
    pause
    exit /b 1
)
echo        npm OK
echo.

:: Check backend deps
echo [3/5] Checking backend dependencies...
if not exist "%ROOT%backend\node_modules" (
    echo        Installing backend deps...
    cd /d "%ROOT%backend"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Backend install failed
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
    echo        Done.
) else (
    echo        Backend deps OK
)
echo.

:: Check frontend deps
if not exist "%ROOT%frontend\node_modules" (
    echo        Installing frontend deps...
    cd /d "%ROOT%frontend"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Frontend install failed
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
    echo        Done.
) else (
    echo        Frontend deps OK
)
echo.

:: Start backend
echo [4/5] Starting backend (port 5000)...
start "AI-Backend" cmd /k "cd /d %ROOT%backend && node server.js"
echo        Waiting for backend...
timeout /t 4 /nobreak >nul
echo        Backend launched.
echo.

:: Start frontend
echo [5/5] Starting frontend (port 3000)...
start "AI-Frontend" cmd /k "cd /d %ROOT%frontend && npx react-scripts start"
echo        Frontend launched.
echo.

echo ===============================================
echo   All services started!
echo.
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:5000
echo.
echo   Keep the two popup windows open.
echo   Press any key to close this window...
echo ===============================================
pause >nul
