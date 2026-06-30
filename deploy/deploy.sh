#!/usr/bin/env bash
# TaskFlow 一键部署到 VPS（ssh 别名 s2）。
# 前端本地构建后上传 dist；后端源码上传到服务器原生编译；systemd 守护 + Caddy 反代 + sslip.io 自动 HTTPS。
set -euo pipefail

SSH=s2
APP_DIR=/opt/taskflow
WEB_DIR=/var/www/taskflow
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/5] 本地构建前端"
cd "$ROOT/frontend"
npm install
npm run build

echo "==> [2/5] 同步后端源码到服务器（保留 target 以增量编译）"
rsync -az \
  --exclude target --exclude .git --exclude node_modules --exclude frontend \
  -e ssh "$ROOT/" "$SSH:$APP_DIR/"

echo "==> [3/5] 写服务器 .env（PORT=8080）"
grep -vE '^(PORT|BIND_ADDR)=' "$ROOT/.env" > /tmp/taskflow.env
echo 'PORT=8080' >> /tmp/taskflow.env
echo 'BIND_ADDR=127.0.0.1' >> /tmp/taskflow.env   # 只绑本机，由 Caddy 反代
scp /tmp/taskflow.env "$SSH:$APP_DIR/.env"
rm -f /tmp/taskflow.env

echo "==> [4/5] 服务器编译后端 + 安装 systemd"
ssh "$SSH" 'bash -s' <<'REMOTE'
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
cd /opt/taskflow
cargo build --release
install -m 755 target/release/taskflow /opt/taskflow/taskflow
cp deploy/taskflow.service /etc/systemd/system/taskflow.service
systemctl daemon-reload
systemctl enable taskflow
systemctl restart taskflow
sleep 2
systemctl --no-pager status taskflow | head -6
REMOTE

echo "==> [5/5] 部署前端 dist + Caddy 配置"
ssh "$SSH" "mkdir -p $WEB_DIR"
rsync -az --delete -e ssh "$ROOT/frontend/dist/" "$SSH:$WEB_DIR/"
scp "$ROOT/deploy/Caddyfile" "$SSH:/etc/caddy/Caddyfile"
ssh "$SSH" "systemctl reload caddy 2>/dev/null || systemctl restart caddy; sleep 1; systemctl --no-pager status caddy | head -4"

echo ""
echo "✅ 部署完成: https://154.36.158.18.sslip.io"
