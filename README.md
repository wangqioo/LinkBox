# LinkBox

LinkBox 是一个面向个人知识管理的收藏与文件系统。它把网页链接、文字笔记、图片、录音、Office/PDF/HTML 文件统一收进一个本地优先的知识库，并通过 OpenAI 兼容模型完成正文提取、摘要、学习笔记和问答检索。

项目包含三部分：

- `client/`：React Web 管理端，用于收藏、搜索、标签、AI 设置、后台任务和用户管理。
- `mobile/`：Vue 移动端文件助手，用于移动设备上的文件浏览、上传、聊天和分类视图。
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

### 移动端体验

移动端文件助手支持：

- 粘贴微信、知乎、Bilibili 分享文本后自动识别白名单链接
- Bilibili 视频详情页展示“视频原文”
- 详情页内长内容区域可独立滚动
- 从详情页返回首页时保留原滚动位置
- 刷新首页后滚动到最新上传内容
- 分类页按归一类型展示 `video`、`article`、`document` 等内容

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

开发说明和验证命令见 [docs/development.md](docs/development.md)。Bilibili 视频处理说明见 [docs/bilibili-video-processing.md](docs/bilibili-video-processing.md)。部署细节见 [docs/deployment.md](docs/deployment.md)。

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
# 后端重点链路
node --test \
  server/test/jobQueue.test.mjs \
  server/test/documentIndex.test.mjs \
  server/test/imageVisionService.test.mjs \
  server/test/bilibiliVideoSource.test.mjs \
  server/test/videoTranscriptExtractor.test.mjs

# Web 端
cd client
npm test
npm run build

# 移动端
cd ../mobile
node --test src/utils/linkAutoProcess.test.mjs src/utils/mobileItemDisplay.test.mjs src/utils/mobileCategoryDisplay.test.mjs
npm run build
```

当前后端测试覆盖了队列、链接创建、上传处理、AI 动作、导出、Bilibili 视频转写、类型归一、检索排序、Office/XML 解析、表格解析和任务重试等核心路径。

更多测试、E2E、部署和排障命令见 [docs/development.md](docs/development.md)。

## 许可证

MIT
