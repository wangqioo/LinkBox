#!/bin/bash
# 部署 LinkBox 到 Spark2
# 用法：bash deploy.sh

HOST="43.153.150.70"
PORT="6002"
USER="wq"
REMOTE_DIR="~/LinkBox"
BRANCH="main"

set -e

echo "=== 1. 连接服务器，拉取最新代码 ==="
ssh -p $PORT $USER@$HOST "
  set -e
  cd $REMOTE_DIR

  echo '--- git status ---'
  git status

  echo '--- git pull origin $BRANCH ---'
  git pull origin $BRANCH

  echo '--- 安装服务端依赖 ---'
  cd server && npm install --omit=dev
  cd ..

  echo '--- 安装前端依赖并构建 ---'
  cd client && npm install && npm run build
  cd ..
"

echo "=== 2. 重启服务 ==="
ssh -p $PORT $USER@$HOST "
  if systemctl is-active --quiet linkbox 2>/dev/null; then
    sudo systemctl restart linkbox
    echo 'systemd service restarted'
  elif pm2 list 2>/dev/null | grep -q linkbox; then
    pm2 restart linkbox
    echo 'pm2 process restarted'
  else
    echo 'WARNING: 未找到 linkbox 服务，请手动重启'
    echo '可以运行：cd ~/LinkBox/server && node index.js'
  fi
"

echo "=== 部署完成 ==="
