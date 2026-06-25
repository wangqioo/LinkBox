# LinkBox

LinkBox 是一个面向个人知识管理和小范围协作的收藏与文件系统。它把网页链接、文字笔记、图片、录音、Office/PDF/HTML 文件统一收进一个本地优先的知识库，并通过 OpenAI 兼容模型完成正文提取、摘要、学习笔记和问答检索。

项目包含三部分：

- `client/`：React Web 管理端，用于收藏、搜索、标签、AI 设置、后台任务、好友群聊和用户管理。
- `mobile/`：Vue 移动端文件助手，用于移动设备上的文件浏览、上传、聊天、群聊和分类视图。
- `server/`：Express + SQLite 后端，提供鉴权、文件处理、AI 调用、持久化后台任务和静态托管。

## 核心功能

### 内容收集

LinkBox 支持保存多种内容：

| 类型 | 能力 |
| --- | --- |
| 链接 | 保存 URL，后台抓取标题、描述、封面图，并提取正文 |
| 文章 | 微信公众号、知乎文章会作为可自动处理文章来源进入正文提取流程 |
| 视频 | Bilibili 视频链接会自动提取字幕；无字幕时可下载音频并调用 Whisper 转写 |
| 文本 | 保存文字笔记，支持标签和 AI 摘要 |
| 图片 | 上传图片，后台生成图片描述并索引 |
| 音频 | 上传或录制音频，作为收藏项保存 |
| 文件 | 上传 PDF、Office、Markdown、文本、HTML 等文件 |
| HTML | 保存原始 HTML，可在沙箱 iframe 中预览 |

自动处理规则是白名单式的：

- 微信公众号文章：`mp.weixin.qq.com` / `weixin.qq.com`
- 知乎文章：`zhihu.com/p/...` / `zhuanlan.zhihu.com/p/...`
- Bilibili 视频：`bilibili.com/video/BV...` / `m.bilibili.com/video/BV...` / `b23.tv/...`

移动端和 Web 端都支持从分享文本中提取白名单链接，例如：

```text
【B站】视频标题 https://www.bilibili.com/video/BVxxxxxxxx/?share_source=copy_web
```

普通网页链接不会因为出现在一段文本里就自动处理，会按文本笔记保存，避免误抓取用户只是临时发送的内容。

### AI 处理流水线

链接和文件进入系统后，会进入 SQLite 持久化任务队列。服务重启后，未完成任务会恢复继续处理。

典型流程：

```text
保存链接
  -> 抓取网页元数据
  -> 提取正文 Markdown
  -> 生成中文摘要
  -> 建立检索索引

上传文件
  -> 解析为 Markdown
  -> 提取图片或表格内容
  -> 生成摘要
  -> 建立检索索引

保存 Bilibili 视频
  -> 抓取视频元数据和封面
  -> 优先提取公开字幕
  -> 无字幕时通过 yt-dlp + ffmpeg 准备音频
  -> 调用 Whisper 兼容服务转写
  -> 使用 LLM 补全中文标点
  -> 保存视频原文、生成摘要、建立检索索引
```

后台任务在管理员设置页可查看状态，包括等待、运行、完成、失败任务数，并支持重试失败任务。

处理状态会按内容类型展示，例如 Bilibili 会显示视频处理阶段，而不是泛化成“抓取网页”。

### 类型归一

数据库中仍兼容历史 `links.type` 值，但 UI、筛选、检索和统计使用归一后的展示类型：

| 展示类型 | 来源 |
| --- | --- |
| `link` | 普通链接 |
| `article` | 微信公众号、知乎文章 |
| `video` | Bilibili 视频 |
| `document` | 上传文件，兼容历史 `file` |
| `image` | 图片 |
| `audio` | 音频 |
| `text` | 文本笔记 |

这些类型会统一用于 Web 列表筛选、移动端分类页、管理员用户统计、Assistant 检索 scope、文档索引和 embedding 检索。

### 文件解析

支持的主要格式：

| 格式 | 处理方式 |
| --- | --- |
| `.docx` | 解包 Office XML，提取段落、表格、图片占位 |
| `.pptx` | 提取幻灯片文本和图片占位 |
| `.xlsx` / `.csv` | 转成 Markdown 表格 |
| `.pdf` | 使用 `pdftotext` 提取文本 |
| `.doc` / `.ppt` / `.xls` | 可通过 LibreOffice 转换后处理 |
| `.txt` / `.md` | 直接读取文本 |
| `.html` / `.htm` | 保存原始 HTML，并提取可检索正文 |

### 检索与问答

LinkBox 会把标题、摘要、正文切分为 `link_chunks`，用于 Assistant 问答。检索排序会综合标题、摘要、正文命中情况，支持中英文 token，并对来源做去重，减少同一篇内容重复占满结果。

新的 canonical document 索引会把正文 Markdown 写入 `documents` / `document_chunks`，并可选写入 `document_embeddings`。Assistant 检索优先使用 canonical 文档块和 embedding 候选，legacy `link_chunks` 作为兼容 fallback。`video`、`article`、`document` 等 scope 过滤会走统一类型条件，保证列表、搜索和问答看到的是同一类内容。

个人 Assistant 只检索用户自己的个人资料。群聊里的群 Assistant 使用独立检索范围，只读取当前群共享过的资料、群内上传的 `chat` scope 资料、群资料说明、资料留言和群文字消息，不会混用个人资料库或其他群的内容。

Assistant 对话按会话保存历史。个人会话和群会话分开存储，支持新建对话、打开历史、删除对话，并保存每轮问答的引用 sources。当前历史记录用于恢复聊天界面；不会自动注入下一轮 prompt，避免影响检索范围和群/个人隔离。

### 好友、私聊和群聊

LinkBox 支持轻量协作：

- 通过用户名添加好友，好友通过后可以私聊。
- 私聊和群聊都支持发送文字、上传文件、上传多张图片、发送已有资料、给资料留言和删除自己发出的消息。
- 群主可以创建群聊、邀请已通过好友，并管理群内消息。
- 群聊资料写入 `group_links`，群文字消息写入 `group_messages`，私聊消息写入 `direct_messages`。
- 聊天中上传的资料标记为 `scope = 'chat'`，不会混入个人主页资料列表，但可以在对应私聊或群聊中被打开、留言和被群 Assistant 检索。
- 群聊和私聊的消息方向按当前登录用户判断：自己发出的消息在右侧，其他成员消息在左侧。

### 移动端体验

移动端文件助手支持：

- 粘贴微信、知乎、Bilibili 分享文本后自动识别白名单链接
- 主页输入框显式发送，不会在输入或粘贴时自动发送
- 所有长文本输入框自动按内容增高，并限制最大高度
- 文件、链接、图片、聊天资料卡右上角使用三点菜单执行留言和删除等二级操作
- 文本消息、留言、摘要、文件名、链接等可长按选择复制
- 多张图片一次上传时以叠放相册展示；主页相册留言会作用于这一批图片，详情页可逐张切换并保存单张留言
- Bilibili 视频详情页展示“视频原文”
- 详情页内长内容区域可独立滚动
- 从详情页返回首页时保留原滚动位置
- 刷新首页后滚动到最新上传内容
- 分类页按归一类型展示 `video`、`article`、`document` 等内容
- 好友与群聊页支持私聊、群聊、文件上传、发送已有资料、多图叠放卡片、资料留言和群 Assistant

### 管理能力

- 多用户登录与 JWT 鉴权
- 管理员设置 AI 供应商、模型、API Key、温度等参数
- 管理员查看系统后台任务状态
- 管理员用户管理
- 站点 Cookie 配置，例如知乎等需要登录 Cookie 的内容抓取

## 技术栈

| 模块 | 技术 |
| --- | --- |
| Web 端 | React 18、TypeScript、Vite、Tailwind CSS |
| 移动端 | Vue 3、Vue Router、Vite |
| 后端 | Express、better-sqlite3、JWT、multer |
| 数据库 | SQLite 单文件 |
| AI | OpenAI 兼容 `/v1/chat/completions` 接口 |
| 文件解析 | Office XML、Readability、Turndown、pdftotext、LibreOffice 可选 |
| 部署 | Node.js、Docker、systemd、HTTP/HTTPS 自动切换 |

## 目录结构

```text
LinkBox/
  client/                  React Web 管理端
  mobile/                  Vue 移动端文件助手
  server/
    routes/
      auth.js              登录/注册
      links.js             收藏 API、上传、图片代理、导出
      assistant.js         AI 问答
      social.js            好友、私聊、群聊、群资料
      settings.js          系统和 AI 设置
      admin.js             管理员用户管理
      mobileFiles.js       移动端文件 API
      tags.js              标签管理
    utils/
      jobQueue.js          SQLite 持久化任务队列
      enrichmentJobs.js    链接/图片/文件后台任务注册
      itemKind.js          链接来源和展示类型归一
      itemPresentation.js  统一列表/详情展示契约
      itemMaterial.js      统一正文、摘要、封面和资产读取
      itemEnrichmentPlan.js 后台处理计划
      assistantRetrieval.js 个人/群 Assistant 检索
      videoTranscriptExtractor.js Bilibili 字幕/音频转写
      chunkIndex.js        内容切块、索引、检索排序
      fileToMarkdown.js    文件转 Markdown 入口
      officeXmlUtils.js    Word XML 解析
      spreadsheetXmlUtils.js
      presentationXmlUtils.js
      linkCreateService.js
      linkAiActions.js
      linkMutationService.js
      linkExportService.js
  Dockerfile
  docker-compose.yml
```

当前路线图和规划状态见 [docs/roadmap.md](docs/roadmap.md)，验证矩阵见 [docs/validation.md](docs/validation.md)，项目术语见 [CONTEXT.md](CONTEXT.md)。详细开发说明、当前暂停点和验证命令见 [docs/development.md](docs/development.md)。移动端说明见 [docs/mobile-frontend.md](docs/mobile-frontend.md)。好友、私聊、群聊和群 Assistant 说明见 [docs/social-collaboration.md](docs/social-collaboration.md)。部署流程见 [docs/deployment.md](docs/deployment.md)。Bilibili 视频处理说明见 [docs/bilibili-video-processing.md](docs/bilibili-video-processing.md)。架构重构背景见 [docs/architecture-redesign.md](docs/architecture-redesign.md)。知识库重构背景见 [docs/markdown-knowledge-base-plan.md](docs/markdown-knowledge-base-plan.md)。

## 快速开始

### 环境要求

- Node.js 20 推荐，Node.js 18+ 可运行
- `unzip`：解析 Office 文件
- `pdftotext`：PDF 文本提取，通常来自 `poppler-utils`
- `libreoffice`：旧版 `.doc/.xls/.ppt` 转换，可选
- `ffmpeg`：Bilibili 无字幕转写时提取音频
- `yt-dlp`：Bilibili 无字幕转写时下载音频
- OpenAI 兼容模型服务，可选但推荐
- Whisper 兼容转写服务，可选；仅 Bilibili 无字幕音频转写需要

### 本地构建运行

```bash
git clone https://github.com/wangqioo/LinkBox.git
cd LinkBox

cd server
npm install

cd ../client
npm install
npm run build

cd ../mobile
npm install
npm run build

cd ../server
npm start
```

默认访问：

- Web 管理端：`http://localhost:3100`
- 移动端：`http://localhost:3100/mobile`

### 开发模式

```bash
# 后端
cd server
npm run dev

# Web 端
cd client
npm run dev

# 移动端
cd mobile
npm run dev
```

Web 端默认运行在 `http://localhost:5173`。

## Docker 部署

```bash
docker compose up -d --build
```

默认 `docker-compose.yml` 使用 host 网络，数据目录挂载到：

```text
/home/wq/linkbox-data:/data
```

容器内关键路径：

- 数据库：`/data/linkbox.db`
- 上传文件：`/data/uploads`
- Bilibili cookies（可选）：`/data/cookies/bilibili.txt`

按需修改 `docker-compose.yml` 中的挂载目录、端口和模型地址。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3100` | 服务监听端口 |
| `JWT_SECRET` | `linkbox-secret` | JWT 签名密钥，生产环境必须修改 |
| `DATA_DIR` | 空 | 数据目录，Docker 默认 `/data` |
| `DB_PATH` | `server/linkbox.db` 或 `/data/linkbox.db` | SQLite 文件路径 |
| `UPLOADS_DIR` | `server/uploads` 或 `/data/uploads` | 上传文件目录 |
| `LOCAL_LLM_URL` | `http://localhost:8000/v1` | OpenAI 兼容接口地址 |
| `LOCAL_LLM_MODEL` | `Qwen3.5-4B` | 默认文本模型 |
| `LOCAL_VISION_MODEL` | `Qwen3.5-4B` | 默认视觉模型 |
| `WHISPER_SERVER_URL` | 空 | Whisper 转写接口地址，用于无字幕 Bilibili 视频转文字 |
| `YTDLP_BIN` | `yt-dlp` | `yt-dlp` 命令路径 |
| `FFMPEG_BIN` | `ffmpeg` | `ffmpeg` 命令路径 |
| `BILIBILI_COOKIE_FILE` | 空 | Bilibili cookies 文件路径，Docker 示例为 `/data/cookies/bilibili.txt` |

AI 配置也可以在 Web 管理端的系统设置中修改，支持 DeepSeek、OpenAI、OpenRouter、Kimi、DashScope、智谱和自定义 OpenAI 兼容服务。

## HTTPS

如果存在以下证书文件，服务会自动以 HTTPS 启动：

```text
server/certs/cert.pem
server/certs/key.pem
```

否则默认以 HTTP 启动。生成本地自签名证书示例：

```bash
mkdir -p server/certs
openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
  -keyout server/certs/key.pem \
  -out server/certs/cert.pem \
  -subj "/CN=LinkBox" \
  -addext "subjectAltName=IP:127.0.0.1"
```

## 测试与检查

```bash
# 后端自动化测试
cd server
npm test

# 重点链路测试示例
node --test test/itemKind.test.mjs test/bilibiliVideoSource.test.mjs test/videoTranscriptExtractor.test.mjs

# Web 端生产构建
cd client
npm test
npm run build

# 移动端生产构建
cd mobile
node --test src/utils/linkAutoProcess.test.mjs src/utils/mobileCategoryDisplay.test.mjs
npm run build
```

当前后端测试覆盖了队列、链接创建、上传处理、AI 动作、导出、Bilibili 视频转写、类型归一、检索排序、Office/XML 解析、表格解析和任务重试等核心路径。

## 常用 API

所有非公开接口都需要：

```http
Authorization: Bearer <token>
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/register` | 注册 |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/links` | 收藏列表，支持分页、搜索、类型、标签、日期过滤 |
| `POST` | `/api/links` | 新增链接 |
| `POST` | `/api/links/text` | 新增文本 |
| `POST` | `/api/links/image` | 上传图片 |
| `POST` | `/api/links/audio` | 上传音频 |
| `POST` | `/api/links/file` | 上传文件 |
| `GET` | `/api/links/:id` | 收藏详情 |
| `PUT` | `/api/links/:id` | 更新收藏 |
| `DELETE` | `/api/links/:id` | 删除收藏 |
| `POST` | `/api/links/:id/summarize` | 手动生成摘要 |
| `POST` | `/api/links/:id/extract` | 手动提取正文 |
| `POST` | `/api/links/:id/learning-note` | 生成 AI 学习笔记 |
| `GET` | `/api/assistant/conversations` | 个人 Assistant 会话列表 |
| `POST` | `/api/assistant/conversations` | 新建个人 Assistant 会话 |
| `GET` | `/api/assistant/conversations/:id/messages` | 读取 Assistant 会话消息 |
| `DELETE` | `/api/assistant/conversations/:id` | 删除 Assistant 会话 |
| `POST` | `/api/assistant/chat/stream` | 流式 Assistant 问答，可带 `conversation_id` 和 `groupId` |
| `GET` | `/api/links/export/all` | 导出全部数据 |
| `GET` | `/api/links/export/summaries` | 导出摘要 Markdown |
| `GET` | `/api/tags` | 标签列表 |
| `POST` | `/api/tags` | 新建标签 |
| `GET` | `/api/settings/system/status` | 系统与后台任务状态 |
| `POST` | `/api/settings/system/retry-failed-jobs` | 重试失败任务 |
| `GET` | `/api/admin/users` | 管理员用户列表 |
| `GET` | `/api/mobile/files` | 移动端文件列表 |
| `GET` | `/api/social/friends` | 好友列表和请求 |
| `POST` | `/api/social/friends` | 添加好友 |
| `GET` | `/api/social/friends/:userId/messages` | 私聊消息 |
| `POST` | `/api/social/friends/:userId/messages` | 发送私聊文字 |
| `POST` | `/api/social/friends/:userId/materials` | 发送已有资料到私聊 |
| `POST` | `/api/social/friends/:userId/uploads` | 上传文件到私聊 |
| `GET` | `/api/social/groups` | 当前用户群聊 |
| `POST` | `/api/social/groups` | 创建群聊 |
| `GET` | `/api/social/groups/:groupId/messages` | 群消息 |
| `POST` | `/api/social/groups/:groupId/messages` | 发送群文字 |
| `GET` | `/api/social/groups/:groupId/materials` | 群资料 |
| `POST` | `/api/social/groups/:groupId/materials` | 发送已有资料到群 |
| `POST` | `/api/social/groups/:groupId/uploads` | 上传文件到群 |

`/api/links/image-proxy` 是公开图片代理接口，用于加载微信公众号等防盗链图片。

## systemd 示例

```ini
[Unit]
Description=LinkBox Server
After=network.target

[Service]
Type=simple
User=linkbox
WorkingDirectory=/opt/LinkBox
Environment=PORT=3100
Environment=DATA_DIR=/var/lib/linkbox
Environment=DB_PATH=/var/lib/linkbox/linkbox.db
Environment=UPLOADS_DIR=/var/lib/linkbox/uploads
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now linkbox
sudo systemctl restart linkbox
journalctl -u linkbox -f   # 查看日志
```

## 许可证

MIT
