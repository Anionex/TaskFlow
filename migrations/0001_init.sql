-- TaskFlow V2.0 初始 schema (PostgreSQL / Supabase)
-- 对应设计文档 2.3。全新建库，不迁移 V1.0 JSON 数据。

-- 用户表
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         VARCHAR(11) UNIQUE NOT NULL,                  -- 登录账号(11位)
    password_hash TEXT NOT NULL,                                -- Argon2 加盐哈希
    summary_tone  VARCHAR(20) NOT NULL DEFAULT '温暖鼓励型',     -- 推荐/总结语气偏好
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会话表（持久化，服务重启不失效）
CREATE TABLE sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- 即 session_id
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 任务表（含一级子任务；软删除回收站）
CREATE TABLE tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,   -- NULL=顶层/任务组头；非空=子任务(仅一级)
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    completed    BOOLEAN NOT NULL DEFAULT false,
    category     VARCHAR(10) NOT NULL DEFAULT '其他',            -- 学习/工作/生活/家庭/其他
    star_rating  SMALLINT NOT NULL DEFAULT 0 CHECK (star_rating BETWEEN 0 AND 5),
    sort_order   INT NOT NULL DEFAULT 0,                         -- 同组内建议执行顺序
    start_date   TIMESTAMPTZ,
    deadline     TIMESTAMPTZ,
    deleted_at   TIMESTAMPTZ,                                    -- 非空=在回收站(软删除)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_tasks_user    ON tasks(user_id);
CREATE INDEX idx_tasks_parent  ON tasks(parent_id);
CREATE INDEX idx_tasks_deleted ON tasks(deleted_at);

-- 仅一级子任务的 DB 级保护：父任务自身不能再有父
CREATE OR REPLACE FUNCTION enforce_single_level_subtask()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM tasks WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
            RAISE EXCEPTION '不允许多级子任务：父任务本身已是子任务';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_level_subtask
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION enforce_single_level_subtask();

-- 任务模板表
CREATE TABLE task_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    category       VARCHAR(10) NOT NULL DEFAULT '其他',
    star_rating    SMALLINT NOT NULL DEFAULT 0 CHECK (star_rating BETWEEN 0 AND 5),
    frequency      VARCHAR(10) NOT NULL,                         -- daily/weekly/monthly
    generate_day   SMALLINT NOT NULL DEFAULT 0,
    generate_time  VARCHAR(5)  NOT NULL DEFAULT '09:00',
    deadline_day   SMALLINT NOT NULL DEFAULT 0,
    deadline_time  VARCHAR(5)  NOT NULL DEFAULT '18:00',
    last_generated DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_templates_user ON task_templates(user_id);

-- 打卡表（每用户一行状态）
CREATE TABLE checkins (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_checkin_date DATE,
    current_streak    INT NOT NULL DEFAULT 0,
    max_streak        INT NOT NULL DEFAULT 0
);
