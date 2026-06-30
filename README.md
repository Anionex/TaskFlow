> # dev done
>
> 本轮开发完成，移交测试员进行多层测试。测试入口：
> - 网页（生产）: https://taskflowai.asia
> - 桌面安装包: GitHub Releases → `TaskFlow_2.0.0_aarch64.dmg`(macOS arm)、`TaskFlow_2.0.0_x64-setup.exe`(Windows x64)
> - 测试账号: `13800138000` / `taskflow123`（或自行注册手机号+密码）
> - 待测范围: 注册/登录、自然语言建任务(单/多自动判定)、解析确认、大目标拆解、语义检索、早间推荐/晚间总结、模板、回收站、统计、三主题、设置(改密/大模型key/语气/导入导出)

---

# TaskFlow

TaskFlow is a lightweight personal task management system built with Rust, Axum, and a static HTML/CSS/JavaScript frontend.

## Features

- User registration, login, session management, and password changes
- Task creation, editing, completion, search, sorting, and category filtering
- Batch deletion and clear actions
- Recycle bin restore and permanent deletion
- Recurring task templates
- Daily check-in
- Task statistics with pie and bar charts
- Data import and export
- Normal, eye-care, and night themes

## Run Locally

```bash
cargo run --bin task_manager
```

Default address:

```text
http://localhost:8080
```

Use another port when `8080` is occupied:

```bash
PORT=8081 cargo run --bin task_manager
```

## Project Structure

```text
.
├── Cargo.toml
├── Cargo.lock
├── README.md
├── src/
│   ├── main.rs
│   ├── server.rs
│   └── lib.rs
├── static/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── docs/
    └── 总结文档.md
```

Runtime user data is stored in `users.json` and `data/`, and is intentionally excluded from git.

### Key Files

- `Cargo.toml`: Rust package configuration, dependencies, and binary/library targets.
- `src/main.rs`: Desktop-style entry point. It starts the server and opens the browser.
- `src/server.rs`: Main backend implementation with Axum routes, user sessions, task APIs, recycle bin, recurring templates, check-in, stats, and import/export.
- `src/lib.rs`: Library entry point exposing `run_server()`.
- `static/index.html`: Single-page frontend markup.
- `static/style.css`: Frontend styles and themes.
- `static/app.js`: Frontend interaction logic and API calls.
- `docs/总结文档.md`: Project summary document, including requirements, design, API notes, testing, and team work.
