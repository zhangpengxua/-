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

:: 检查npm是否安装
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到npm，请先安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查并安装后端依赖
echo 正在检查后端依赖...
if not exist "backend\node_modules" (
    echo 后端依赖未安装，正在安装...
    cd backend
    npm install
    if %errorlevel% neq 0 (
        echo 错误: 后端依赖安装失败
        pause
        exit /b 1
    )
    cd ..
    echo 后端依赖安装完成
)

:: 检查并安装前端依赖
echo 正在检查前端依赖...
if not exist "frontend\node_modules" (
    echo 前端依赖未安装，正在安装...
    cd frontend
    npm install
    if %errorlevel% neq 0 (
        echo 错误: 前端依赖安装失败
        pause
        exit /b 1
    )
    cd ..
    echo 前端依赖安装完成
)

echo.
echo 正在启动后端服务...
start "后端服务" cmd /k "cd backend && npm start"

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
