#!/bin/bash
# 部署 LinkBox 到 Spark2
# 用法：bash deploy.sh

set -e

HOST="43.153.150.70"
SSH_PORT="6002"
USER="wq"
PASS="152535"
REMOTE_UPLOADS="/home/wq/linkbox-uploads"

echo "=== 1. 构建前端 ==="
cd "$(dirname "$0")/client"
npm install --silent
npm run build

echo "=== 2. 打包（排除 node_modules / uploads / db / certs）==="
cd ..
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='server/linkbox.db' \
    --exclude='server/uploads' \
    --exclude='server/certs' \
    -czf /tmp/linkbox-update.tar.gz .

echo "=== 3. 上传到服务器 ==="
sshpass -p "$PASS" scp -P "$SSH_PORT" -o StrictHostKeyChecking=no \
    /tmp/linkbox-update.tar.gz "$USER@$HOST:/home/wq/linkbox-update.tar.gz"

echo "=== 4. 解压、软链接数据、重启 ==="
sshpass -p "$PASS" ssh -p "$SSH_PORT" -o StrictHostKeyChecking=no "$USER@$HOST" "
set -e

# 解压到临时目录
mkdir -p ~/linkbox-new
tar -xzf ~/linkbox-update.tar.gz -C ~/linkbox-new 2>/dev/null || true

# 保留 node_modules（避免重复安装）
cp -r ~/linkbox/server/node_modules ~/linkbox-new/server/node_modules 2>/dev/null || true

# 保留证书
cp -r ~/linkbox/server/certs ~/linkbox-new/server/certs 2>/dev/null || true

# 软链接 uploads 和 db -> 外部永久目录（永远不会被部署覆盖）
mkdir -p $REMOTE_UPLOADS
ln -sfn $REMOTE_UPLOADS ~/linkbox-new/server/uploads
ln -sfn /home/wq/linkbox-data.db ~/linkbox-new/server/linkbox.db

# 替换旧目录
rm -rf ~/linkbox-old
mv ~/linkbox ~/linkbox-old
mv ~/linkbox-new ~/linkbox

# 重启服务
sudo systemctl restart linkbox
sleep 2
sudo systemctl status linkbox --no-pager | head -5
"

echo "=== 部署完成 ==="
