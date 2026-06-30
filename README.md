# TaskFlow

TaskFlow 是一个**智能化 GTD（个人任务管理）系统**：用自然语言说出想做的事，系统用大模型自动解析成结构化、可执行、可推进的任务。核心理念是「用户少操作，系统多理解」。

- **在线使用（网页版）**：https://taskflowai.asia
- **桌面版下载**：见 [GitHub Releases](../../releases) —— `TaskFlow_2.0.0_aarch64.dmg`（macOS Apple Silicon）、`TaskFlow_2.0.0_x64-setup.exe`（Windows x64）

技术栈：**Rust + Axum**（部署式后端）· **React + TypeScript + Vite**（网页/桌面共用前端）· **Tauri v2**（桌面外壳）· **Supabase / PostgreSQL**（中央数据库）· **OpenAI 兼容大模型**（默认经 aihubmix）。

## 功能

- **智能任务录入**：自然语言一句话或一段话建任务，模型自动判定单条/多条，解析出标题、分类、星级、起止时间，并以**可编辑草稿**确认后才入库（不静默写入）
- **大任务拆解**：识别「完成课程设计」等大目标，拆成带顺序的子任务，确认后生成「任务组」（父任务 + 一级子任务，含完成进度）
- **语义检索**：自然语言查询任务（如「快到期但还没做的」）
- **智能推进**：早间推荐今天最该做的 3-5 件事 + 晚间今日总结，语气可设（温暖鼓励 / 冷静督促 / 简短效率）
- **基础管理**：任务 CRUD、分类筛选、排序、搜索、分页、批量删除、清空
- **循环模板**：按日/周/月**自动生成**任务（后台调度器），也可手动一键生成
- **回收站**：软删除、恢复、永久删除、清空
- **每日打卡**：连续/最长连续天数
- **任务统计**：完成/待办/过期饼图 + 近 12 个月完成量柱状图
- **数据导入导出**（JSON）
- **三套主题**：普通 / 护眼 / 夜间

## 桌面版安装说明

桌面安装包当前为**未签名**版本，首次打开需手动放行：

- **macOS**：双击 dmg 把 TaskFlow 拖入「应用程序」后，首次启动**右键点击 App → 打开**（而非双击），在弹窗中再次点「打开」。
- **Windows**：运行 setup.exe 时若出现 SmartScreen 蓝色提示，点「更多信息 → 仍要运行」。

桌面版打包时已内置生产后端地址 `https://taskflowai.asia/api`，安装即用，无需本地后端。

## 本地开发

### 前置

- Rust（edition 2024，建议 1.85+）、Node.js 18+
- 一个 PostgreSQL 数据库（推荐 Supabase）

### 1. 配置环境变量

在项目根目录放置 `.env`：

```bash
DATABASE_URL=postgres://user:pass@host:5432/postgres   # 或 DATABASE_URL_POOLER（IPv4 Session Pooler，优先）
PORT=8090                                              # 本地后端端口（与前端 dev 代理一致）
LLM_BASE_URL=https://aihubmix.com/v1                   # OpenAI 兼容端点
LLM_API_KEY=sk-...                                     # 默认大模型 key（用户也可在设置里自带 key）
LLM_MODEL=deepseek-v4-flash
LLM_MODEL_STRONG=deepseek-v4-pro
```

> 说明：`LLM_MODEL` 的取值取决于 `LLM_BASE_URL` 所指服务。默认经 aihubmix 用 `deepseek-v4-flash`；若用户在「设置」里填官方 DeepSeek 的 key，模型名应填 `deepseek-chat`。

### 2. 初始化数据库

把 `migrations/0001_init.sql` 应用到你的 PostgreSQL（Supabase 可在 SQL Editor 执行，或用 psql）：

```bash
psql "$DATABASE_URL" -f migrations/0001_init.sql
```

### 3. 启动后端（Axum，提供 /api）

```bash
PORT=8090 cargo run
```

后端默认监听 `0.0.0.0:8090`（不设 PORT 时为 8080），仅提供 `/api/*`；前端静态资源在生产由反向代理（Caddy）托管。

### 4. 启动前端（Vite dev，:5173）

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173 ，/api 自动代理到 http://localhost:8090
```

### 5. 构建产物

```bash
cd frontend
npm run build               # 产出网页静态资源 dist/
npm run tauri build         # 产出桌面安装包（macOS .dmg / Windows .exe）
```

## 测试

集成测试连接 `.env` 中的数据库，AI 链路用本地 Mock LLM，按官方建议串行执行：

```bash
cargo test -- --test-threads=1
```

## 项目结构

```text
.
├── Cargo.toml
├── migrations/
│   └── 0001_init.sql        # 建库脚本（users/sessions/tasks/task_templates/checkins + 仅一级子任务触发器）
├── src/                     # Rust 后端（Axum）
│   ├── main.rs              # 入口：连接池、启动调度器、启动 Axum
│   ├── lib.rs               # build_app：路由汇总（网页/测试共用）
│   ├── config.rs state.rs response.rs models.rs util.rs
│   ├── auth.rs              # 注册/登录/会话(Argon2)/改密
│   ├── tasks.rs             # 任务/子任务 CRUD、批量、任务组、排序、分页
│   ├── recycle.rs templates.rs checkin.rs user.rs data.rs
│   ├── ai.rs                # 解析/批量/改写/拆解/检索/早晚推荐（OpenAI 兼容）
│   └── scheduler.rs         # 模板自动生成后台调度
├── frontend/                # React + TS + Vite（网页与 Tauri 桌面共用）
│   ├── src/                 # pages / sections / components / api / store / styles
│   └── src-tauri/           # Tauri v2 桌面外壳
├── tests/integration_tests.rs
└── docs/                    # 需求/设计/API 总结文档
```

## 文档

详见 [`docs/总结文档.md`](docs/总结文档.md)：需求、设计、数据模型、API、测试与项目说明。
