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
├── src/
├── static/
└── docs/
    └── 总结文档.md
```

Runtime user data is stored in `users.json` and `data/`, and is intentionally excluded from git.
