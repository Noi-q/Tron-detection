@echo off
cd /d "%~dp0"

if not exist "dist\bnb-quick-return-win.exe" (
    echo 错误: 找不到可执行文件 dist\bnb-quick-return-win.exe
    echo 请先运行 'npm run build' 进行打包
    exit /b 1
)

start "" "dist\bnb-quick-return-win.exe" 