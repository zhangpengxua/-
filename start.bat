@echo off
chcp 65001 >nul
echo ===============================================
echo          DeepSeek AI解题软件 - 一键启动
echo ===============================================
echo.

:: 检查Node.js是否安装
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到Node.js，请先安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo 正在启动后端服务...
start "后端服务" cmd /k "cd backend && node server.js"

:: 等待后端启动
timeout /t 3 /nobreak >nul

echo 正在启动前端服务...
start "前端服务" cmd /k "cd frontend && npm start"

echo.
echo ===============================================
echo 服务启动完成！
echo.
echo 前端地址: http://localhost:3000
echo 后端地址: http://localhost:5000
echo.
echo 按任意键关闭此窗口...
pause >nul
