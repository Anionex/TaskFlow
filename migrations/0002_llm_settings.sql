-- 将用户的大模型设置（API Key / 模型名 / Base URL）持久化到账户，
-- 实现跨设备同步：在 A 设备保存后，B 设备登录同一账户即可直接使用，
-- 不再依赖浏览器 localStorage。空字符串表示"走服务端默认"。
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS llm_api_key  TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_model    TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_base_url TEXT NOT NULL DEFAULT '';
