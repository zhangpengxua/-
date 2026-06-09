<#
.SYNOPSIS
DeepSeek AI解题软件 - 一键启动脚本
#>

$ErrorActionPreference = "Stop"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "          DeepSeek AI解题软件 - 一键启动" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# 检查Node.js是否安装
try {
    $nodeVersion = node --version
    Write-Host "Node.js 版本: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "错误: 未找到Node.js，请先安装Node.js" -ForegroundColor Red
    Write-Host "下载地址: https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "按任意键退出..."
    exit 1
}

# 启动后端服务
Write-Host "正在启动后端服务..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd backend && node server.js" -WindowStyle Normal -Title "后端服务"

# 等待后端启动
Start-Sleep -Seconds 3

# 启动前端服务
Write-Host "正在启动前端服务..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd frontend && npm start" -WindowStyle Normal -Title "前端服务"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "服务启动完成！" -ForegroundColor Green
Write-Host ""
Write-Host "前端地址: http://localhost:3000" -ForegroundColor White
Write-Host "后端地址: http://localhost:5000" -ForegroundColor White
Write-Host ""
Read-Host "按任意键关闭此窗口..."
