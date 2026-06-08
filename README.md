# LinkBox

一个为个人知识管理设计的全栈收藏夹应用，支持链接、文本、图片、音频、Office 文件、HTML 网页的统一收集与管理，内置 AI 内容理解能力。

---

## 功能概览

### 内容收集

| 类型 | 说明 |
|------|------|
| 链接 | 保存网页链接，自动抓取标题、描述、封面图 |
| 文本 | 快速记录文字笔记 |
| 图片 | 上传本地图片，支持实时进度显示 |
| 音频 | 网页端录音（HTTPS 环境）或 iOS/Android 原生录音（HTTP 环境自动降级） |
| 文件 | 上传 Office 文档、PDF 等，自动提取正文并生成摘要 |
| 网页 | 上传 HTML 文件，沙箱 iframe 完整渲染，自动提取文本生成摘要 |

### 智能内容处理（AI 自动流水线）

保存链接或上传文件后，后台自动依次执行：

**链接：**
```
保存 → ① 抓取页面元数据（标题/描述/封面图）
      → ② 提取正文并转为 Markdown
      → ③ 本地 AI 生成中文摘要（OpenAI 兼容模型）
```

**Office / PDF / HTML 文件：**
```
上传 → ① 提取正文转为 Markdown（HTML 文件另存原始内容用于渲染）
      → ② 本地 AI 生成中文摘要
```

无需手动触发，上传完成后自动处理，卡片上实时显示进度。

### 文件格式支持

| 格式 | 正文提取 | 图片提取 + AI 视觉描述 | 网页渲染 |
|------|---------|----------------------|---------|
| `.docx` | ✅ | ✅ | — |
| `.pptx` | ✅ | ✅ | — |
| `.xlsx` | ✅（转 Markdown 表格）| — | — |
| `.pdf` | ✅ | — | — |
| `.doc` / `.ppt` / `.xls` | ✅（LibreOffice 转换）| — | — |
| `.txt` / `.md` | ✅ | — | — |
| `.html` / `.htm` | ✅（提取纯文本）| — | ✅ |

`.docx` / `.pptx` 内嵌图片会自动提取，并由视觉 AI 生成一句中文描述嵌入正文。

### 文件卡片样式

- 有图片内容：自动提取首图作为卡片缩略图（与链接卡片风格一致）
- 无图片内容：显示格式专属彩色图标
  - Word → 蓝色文档图标
  - Excel → 绿色表格图标
  - PPT → 橙色演示图标
  - PDF → 红色代码图标
  - HTML → 青色地球图标

### Markdown 正文阅读

- 点击「正文」按钮弹出阅读模态框，完整渲染 Markdown（标题、粗体、列表、代码块、表格）
- 正文内图片通过服务端代理加载，绕过微信公众号等防盗链限制
- 支持「复制 Markdown 原文」一键导出

### HTML 网页预览

- 上传 `.html` / `.htm` 文件后，点击地球图标在弹窗中完整渲染网页
- 使用沙箱 `<iframe>`（`sandbox="allow-same-origin allow-scripts"`），隔离脚本执行

### AI 摘要 / 手动触发

- 链接、文本、文件卡片均支持 AI 摘要
- 每张卡片右上角 ✦ 图标可手动重新生成摘要
- 摘要以紫色卡片样式展示

### AI 学习笔记

- 对已提取正文的链接或文件，可生成结构化学习笔记
- 包含：核心结论 → 关键要点 → 概念解释 → 交互式 SVG 知识导图
- 笔记以 HTML 渲染，可在浏览器中直接阅读

### 标签管理

- 自定义彩色标签，支持多标签批量打标
- 按标签过滤卡片，标签统计页可查看每个标签下的收藏数量

### 搜索与过滤

- 全文搜索：标题、URL、备注、正文内容四字段联合搜索
- 按类型（链接/文本/图片/音频/文件）过滤
- 按日期范围过滤
- 所有过滤条件可组合使用

### 批量导入

- 粘贴多行 URL，批量导入链接
- 每条链接独立在后台异步处理元数据，不阻塞 UI

### 多用户

- JWT 鉴权，各用户数据完全隔离
- 支持注册 / 登录

---

## 技术架构

```
client/          React 18 + TypeScript + Vite + Tailwind CSS
server/          Express + better-sqlite3（单文件 SQLite）
server/utils/
  ├─ fetchMeta.js              网页元数据抓取（title/description/og:image）
  ├─ extractContent.js         网页正文提取（微信公众号 + 通用 Readability）
  ├─ fileToMarkdown.js         Office/PDF/HTML 文件转 Markdown + 图片视觉描述
  ├─ aiSummarize.js            AI 摘要（OpenAI 兼容接口）
  ├─ jobQueue.js               SQLite 持久化后台任务队列
  └─ generateLearningNote.js   AI 学习笔记 + SVG 知识导图生成
server/routes/
  ├─ auth.js                   登录 / 注册
  ├─ links.js                  CRUD + 图片代理 + AI 接口
  └─ tags.js                   标签管理
```

**AI 模型**：默认连接 OpenAI 兼容 API（`/v1/chat/completions`），默认地址 `http://localhost:8000/v1`，默认模型名 `Qwen3.5-4B`。也可在管理员设置页切换 DeepSeek、OpenAI、OpenRouter、Kimi、DashScope、智谱或自定义服务。

**数据库**：SQLite 单文件，路径 `server/linkbox.db`，服务启动时自动初始化表结构和迁移。

**后台任务**：链接抓取、正文提取、文件转换、图片描述和 AI 摘要会写入 SQLite 持久化任务队列；服务重启后会恢复未完成任务。

**HTTPS**：检测到 `server/certs/cert.pem` + `key.pem` 时自动以 HTTPS 模式启动，否则 HTTP 模式，无需修改代码。

---

## 快速开始

### 环境要求

- Node.js 18+
- `unzip`（用于解压 Office 文件）
- `pdftotext`（poppler-utils，用于 PDF 提取）
- `libreoffice`（用于旧格式 .doc/.xls/.ppt 转换，可选）
- （可选）本地或远程 OpenAI 兼容模型服务，默认监听 `http://localhost:8000/v1`

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/wangqioo/LinkBox.git
cd LinkBox

# 安装服务端依赖
cd server && npm install

# 安装客户端依赖并构建
cd ../client && npm install && npm run build

# 启动服务（构建产物由 Express 静态托管）
cd ../server && node index.js
```

访问 `http://localhost:3100`（默认端口，可通过 `PORT` 环境变量修改）。

### 开发模式

```bash
# 终端 1：启动后端
cd server && node --watch index.js

# 终端 2：启动前端开发服务器
cd client && npm run dev
```

前端默认 `http://localhost:5173`，已配置 Vite 代理将 `/api` 转发到后端。

### 启用 HTTPS

```bash
# 在 server/certs/ 目录生成自签名证书（含 IP SAN）
mkdir -p server/certs
openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
  -keyout server/certs/key.pem \
  -out server/certs/cert.pem \
  -subj "/CN=LinkBox" \
  -addext "subjectAltName=IP:127.0.0.1,IP:<your-ip>"
```

服务启动时自动检测 `certs/` 目录并切换到 HTTPS 模式。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3100` | 服务监听端口 |
| `JWT_SECRET` | `linkbox-secret` | JWT 签名密钥，生产环境请修改 |
| `LOCAL_LLM_URL` | `http://localhost:8000/v1` | OpenAI 兼容模型服务地址 |

---

## systemd 服务（Linux 部署参考）

```ini
# /etc/systemd/system/linkbox.service
[Unit]
Description=LinkBox Server
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/LinkBox
Environment=PORT=8443
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

---

## API 接口

所有接口需要在请求头中携带 JWT：`Authorization: Bearer <token>`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 token |
| POST | `/api/auth/register` | 注册 |
| GET | `/api/links` | 获取收藏列表（支持分页、搜索、过滤） |
| POST | `/api/links` | 新增链接（自动触发后台 AI 流水线） |
| POST | `/api/links/text` | 新增文本 |
| POST | `/api/links/image` | 上传图片 |
| POST | `/api/links/audio` | 上传音频 |
| POST | `/api/links/file` | 上传文件（Office/PDF/HTML，自动提取正文和摘要） |
| PUT | `/api/links/:id` | 编辑 |
| DELETE | `/api/links/:id` | 删除 |
| POST | `/api/links/:id/summarize` | 手动重新生成摘要 |
| POST | `/api/links/:id/extract` | 手动重新提取正文 |
| POST | `/api/links/:id/learning-note` | 生成 AI 学习笔记 |
| GET | `/api/links/image-proxy` | 图片代理（无需认证） |
| GET | `/api/tags` | 标签列表 |
| POST | `/api/tags` | 新建标签 |
| DELETE | `/api/tags/:id` | 删除标签 |

---

## 数据库结构

```sql
links (
  id, user_id, type,         -- 基础信息
  url, title, description,   -- 链接元数据
  thumbnail,                 -- 封面图 / 文件首图 URL
  content, content_md,       -- 正文（原始/Markdown）
  summary,                   -- AI 生成摘要
  comment,                   -- 用户备注
  html_note,                 -- AI 学习笔记 HTML / 原始 HTML 文件内容
  file_path, file_name,      -- 上传文件路径
  imported_at                -- 保存时间
)

tags (id, user_id, name, color)

link_tags (link_id, tag_id)

users (id, username, password_hash, created_at)
```

---

## 许可证

MIT
