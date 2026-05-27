# AI 智能助手 - Cloudflare Pages 部署版

基于 Cloudflare Pages + Pages Functions 的 AI 问答系统，支持思考链展示和联网搜索。

**一个 GitHub 仓库 → 一个 Cloudflare Pages 项目 → 前端 + API 全部搞定！**

## 项目结构

```
cloudflare-deploy/
├── frontend/                        # Cloudflare Pages（前端 + API）
│   ├── index.html                   # 主页面
│   ├── style.css                    # 样式
│   ├── app.js                       # 前端逻辑
│   ├── _redirects                   # SPA 路由配置
│   └── functions/                   # Pages Functions（后端 API）
│       └── api/
│           └── [[route]].js         # 处理 /api/chat、/api/search、/api/models
│
├── worker/                          # （可选）独立 Worker 部署方案
│   ├── index.js
│   ├── wrangler.toml
│   └── package.json
│
└── README.md
```

## 🚀 部署步骤（GitHub 一键部署）

### 第一步：推送到 GitHub

```bash
# 在 cloudflare-deploy 目录下
git init
git add .
git commit -m "AI 智能助手 - Cloudflare Pages 部署"
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

### 第二步：在 Cloudflare 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create** → **Pages**
3. 选择 **Connect to Git**
4. 授权并选择你的 GitHub 仓库
5. 构建设置：
   - **Framework preset**：None（纯静态）
   - **Build command**：留空
   - **Build output directory**：`frontend/`
   - **Root directory**：留空（仓库根目录）
6. 点击 **Save and Deploy**

### 第三步：设置环境变量（API 密钥）

部署完成后，在 Pages 项目设置中添加环境变量：

1. 进入你的 Pages 项目 → **Settings** → **Environment variables**
2. 添加变量：
   - **Variable name**：`SILICONFLOW_API_KEY`
   - **Value**：你的硅基流动 API 密钥
3. 点击 **Save**
4. **重要**：设置后需要重新部署才能生效
   - 进入 **Deployments** → 点击最新部署右侧的 **...** → **Retry deployment**

### 第四步：访问你的应用

部署成功后，Cloudflare 会提供一个域名（如 `https://你的项目.pages.dev`），直接访问即可使用！

之后每次 `git push` 到 GitHub，Cloudflare 会自动重新部署。

## 🔧 工作原理

```
用户浏览器
    │
    ├── GET  /              → frontend/index.html（静态页面）
    ├── GET  /style.css     → frontend/style.css
    ├── GET  /app.js        → frontend/app.js
    │
    ├── POST /api/chat      → functions/api/[[route]].js（流式 AI 对话）
    ├── POST /api/search    → functions/api/[[route]].js（联网搜索）
    └── GET  /api/models    → functions/api/[[route]].js（模型信息）
```

- **前端**：Cloudflare Pages 托管静态文件，全球 CDN 加速
- **后端 API**：Cloudflare Pages Functions 自动处理 `/api/*` 路由
- **前端和 API 在同一个域名下**，无需配置跨域，无需配置 API 地址

## 📋 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | 原生 HTML/CSS/JS |
| 后端 | Cloudflare Pages Functions (JavaScript) |
| AI API | 硅基流动 (SiliconFlow) - DeepSeek-R1 |
| 搜索 | DuckDuckGo Instant Answer API |
| 托管 | Cloudflare Pages（全球 CDN） |

## 🔒 安全提醒

- API 密钥通过 Cloudflare 环境变量存储，**不会暴露在代码中**
- 推送 GitHub 前确认代码中不含任何密钥
- 定期在硅基流动后台更换 API 密钥

## 💡 本地开发

```bash
# 进入 frontend 目录
cd frontend

# 使用任意静态服务器
npx serve .
# 或
python -m http.server 8080
```

注意：本地开发时 `/api/*` 路由不可用（需要 Cloudflare Pages Functions 环境），可以先用原项目的 Flask 后端进行本地测试。
