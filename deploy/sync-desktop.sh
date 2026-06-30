#!/usr/bin/env bash
# 把桌面客户端二进制同步到官网下载目录。
# 用法: bash deploy/sync-desktop.sh [release-tag]   # 默认 desktop-v2.0.0
#
# 机制：从 GitHub Release 拉产物 → rsync 到 s2:/var/www/taskflow-dl/。
# 该目录在前端 WEB_DIR 之外，不会被 deploy.sh 的 rsync --delete 清掉，
# 由 Caddy 的 handle_path /downloads/* 对外提供下载（见 deploy/Caddyfile）。
#
# 注意：发新版本时，记得同步更新 frontend/src/pages/DownloadPage.tsx 顶部的 VERSION 常量。
set -euo pipefail

SSH=s2
DL_DIR=/var/www/taskflow-dl
TAG="${1:-desktop-v2.0.0}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> [1/3] 从 GitHub Release 拉取产物（$TAG）"
gh release download "$TAG" --dir "$TMP" --clobber
ls -la "$TMP"

echo "==> [2/3] 同步到服务器 $SSH:$DL_DIR"
ssh "$SSH" "mkdir -p $DL_DIR"
rsync -az -e ssh "$TMP"/ "$SSH:$DL_DIR/"

echo "==> [3/3] 服务器现有下载产物"
ssh "$SSH" "ls -la $DL_DIR"

echo ""
echo "✅ 同步完成。下载地址例如: https://taskflowai.asia/downloads/<文件名>"
echo "⚠️  若版本号有变，记得改 frontend/src/pages/DownloadPage.tsx 的 VERSION 并重新部署前端。"
