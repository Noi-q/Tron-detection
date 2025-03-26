#!/bin/bash

# 获取脚本所在目录
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 切换到脚本目录
cd "$DIR"

# 检测操作系统类型
OS=$(uname -s)

# 根据操作系统选择正确的可执行文件
if [ "$OS" = "Darwin" ]; then
    EXECUTABLE="./dist/bnb-quick-return-macos"
elif [ "$OS" = "Linux" ]; then
    EXECUTABLE="./dist/bnb-quick-return-linux"
else
    echo "不支持的操作系统: $OS"
    exit 1
fi

# 检查可执行文件是否存在
if [ ! -f "$EXECUTABLE" ]; then
    echo "错误: 找不到可执行文件 $EXECUTABLE"
    echo "请先运行 'npm run build' 进行打包"
    exit 1
fi

# 添加执行权限
chmod +x "$EXECUTABLE"

# 启动程序
"$EXECUTABLE"