// ─── 全局状态 ─────────────────────────────────────────────

let sessionId = localStorage.getItem("session_id") || null;
let currentPhone = localStorage.getItem("phone") || null;
let deleteTargetId = null;
let deleteTargetType = "task"; // "task" 或 "template"

// 存储所有任务数据（用于全选功能）
let allPendingTasks = [];
let allDoneTasks = [];
let allExpiredTasks = [];

// 主题状态：normal, eyecare, night, eyecare+night
let currentTheme = localStorage.getItem("theme") || "normal";
let eyecareEnabled = localStorage.getItem("eyecare") === "true";
let nightEnabled = localStorage.getItem("night") === "true";

// 励志名言
const quotes = [
    "天行健，君子以自强不息。",
    "不积跬步，无以至千里；不积小流，无以成江海。",
    "宝剑锋从磨砺出，梅花香自苦寒来。",
    "千磨万击还坚劲，任尔东西南北风。",
    "路漫漫其修远兮，吾将上下而求索。",
    "长风破浪会有时，直挂云帆济沧海。",
    "博观而约取，厚积而薄发。",
    "古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。",
    "志不强者智不达，言不信者行不果。",
    "锲而舍之，朽木不折；锲而不舍，金石可镂。",
    "故不积跬步，无以至千里；不积小流，无以成江海。",
    "业精于勤，荒于嬉；行成于思，毁于随。",
    "黑发不知勤学早，白首方悔读书迟。",
    "书山有路勤为径，学海无涯苦作舟。",
    "少年易老学难成，一寸光阴不可轻。",
    "纸上得来终觉浅，绝知此事要躬行。",
    "生当作人杰，死亦为鬼雄。",
    "会当凌绝顶，一览众山小。",
    "欲穷千里目，更上一层楼。",
    "海纳百川，有容乃大；壁立千仞，无欲则刚。"
];

// 分页状态：待办、已过期和已完成各自独立
let pendingPage = 1;
let expiredPage = 1;
let donePage = 1;
let pendingTotalPages = 1;
let expiredTotalPages = 1;
let doneTotalPages = 1;
let perPage = 3;

// 当前排序和筛选
let currentSort = "created";
let currentCategory = "全部";
let currentSearch = "";

// 统计（全量数据）
let totalCount = 0;
let pendingCount = 0;
let expiredCount = 0;
let doneCount = 0;

const $ = (sel) => document.querySelector(sel);
const viewLogin = $("#view-login");
const viewRegister = $("#view-register");
const viewMain = $("#view-main");
const viewQuote = $("#view-quote");
const viewUserCenter = $("#view-user-center");

// 图表实例
let pieChart = null;
let barChart = null;

// ─── 初始化 ───────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    bindNavigation();
    bindForms();
    bindLogout();
    bindModal();
    bindSearch();
    bindSortTabs();
    bindCategoryFilter();
    bindAdvancedToggle();
    bindStarRating();
    bindThemeSwitcher();
    bindGenerator();
    bindCheckin();
    bindExportImport();
    bindRecycleBin();
    bindUserCenter();
    bindBatchOperations();

    // 应用保存的主题
    applyTheme();
    updateThemeButtons();

    if (sessionId) {
        checkSession();
    } else {
        showView("login");
    }
});

// ─── 页面切换 ─────────────────────────────────────────────

function showView(name) {
    viewLogin.classList.toggle("hidden", name !== "login");
    viewRegister.classList.toggle("hidden", name !== "register");
    viewMain.classList.toggle("hidden", name !== "main");
    viewQuote.classList.toggle("hidden", name !== "quote");
    viewUserCenter.classList.toggle("hidden", name !== "user-center");
}

function bindNavigation() {
    $("#go-register").addEventListener("click", (e) => { e.preventDefault(); showView("register"); });
    $("#go-login").addEventListener("click", (e) => { e.preventDefault(); showView("login"); });
}

// ─── API 请求 ─────────────────────────────────────────────

async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (sessionId) headers["X-Session-Id"] = sessionId;
    try {
        const resp = await fetch(`/api${path}`, { ...options, headers });
        const data = await resp.json();
        if (resp.status === 401) {
            // session 失效，清除本地状态，跳转登录页
            sessionId = null;
            currentPhone = null;
            localStorage.removeItem("session_id");
            localStorage.removeItem("phone");
            showView("login");
            return { success: false, message: data.message || "登录已过期，请重新登录" };
        }
        return data;
    } catch (e) {
        console.error("API 请求失败:", path, e);
        return { success: false, message: "网络请求失败" };
    }
}

// ─── Toast ────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = "info") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${type}`;
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ─── 表单绑定 ─────────────────────────────────────────────

function bindForms() {
    // 登录
    $("#form-login").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const phone = $("#login-phone").value.trim();
            const password = $("#login-password").value.trim();
            const data = await api("/login", { method: "POST", body: JSON.stringify({ phone, password }) });
            if (data.success) {
                sessionId = data.data;
                currentPhone = phone;
                localStorage.setItem("session_id", sessionId);
                localStorage.setItem("phone", phone);
                showToast("登录成功，欢迎回来！", "success");
                // 显示励志名言，3秒后进入主界面
                showRandomQuote();
            } else {
                showToast(data.message, "error");
            }
        } catch (err) {
            showToast("登录请求失败", "error");
        }
    });

    // 注册
    $("#form-register").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const phone = $("#reg-phone").value.trim();
            const password = $("#reg-password").value.trim();
            const password2 = $("#reg-password2").value.trim();
            if (password !== password2) { showToast("两次密码输入不一致", "error"); return; }
            const data = await api("/register", { method: "POST", body: JSON.stringify({ phone, password }) });
            if (data.success) {
                showToast("注册成功，请登录！", "success");
                showView("login");
                $("#login-phone").value = phone;
            } else {
                showToast(data.message, "error");
            }
        } catch (err) {
            showToast("注册请求失败", "error");
        }
    });

    // 添加任务
    $("#form-add-task").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const title = $("#task-title").value.trim();
            if (!title) return;

            const startDate = $("#task-start-date").value || "";
            const deadline = $("#task-deadline").value || "";

            if (startDate && deadline && new Date(startDate) > new Date(deadline)) {
                showToast("开始日期不能晚于截止日期", "error");
                return;
            }

            const body = {
                title,
                description: $("#task-desc").value.trim(),
                category: $("#task-category").value,
                star_rating: parseInt($("#task-star-rating").value) || 0,
                start_date: startDate,
                deadline: deadline,
            };

            const data = await api("/tasks", { method: "POST", body: JSON.stringify(body) });
            if (data.success) {
                $("#task-title").value = "";
                $("#task-desc").value = "";
                $("#task-category").value = "其他";
                $("#task-star-rating").value = "0";
                $("#task-start-date").value = "";
                $("#task-deadline").value = "";
                resetStarRating("star-rating-create");
                showToast("任务添加成功！", "success");
                pendingPage = 1;
                loadAllData();
            } else {
                showToast(data.message, "error");
            }
        } catch (err) {
            showToast("添加任务失败", "error");
        }
    });
}

// ─── 退出登录 ─────────────────────────────────────────────

function bindLogout() {
    $("#btn-logout").addEventListener("click", async () => {
        try {
            await api("/logout", { method: "POST" });
        } catch (e) { /* 忽略登出请求失败 */ }
        sessionId = null; currentPhone = null;
        localStorage.removeItem("session_id"); localStorage.removeItem("phone");
        showView("login");
        showToast("已退出登录");
    });
}

// ─── 删除弹窗 ─────────────────────────────────────────────

function bindModal() {
    $("#modal-cancel").addEventListener("click", () => {
        $("#modal-overlay").classList.add("hidden");
        deleteTargetId = null;
    });
    $("#modal-confirm").addEventListener("click", async () => {
        if (!deleteTargetId) return;
        $("#modal-overlay").classList.add("hidden");

        try {
            if (deleteTargetType === "template") {
                const data = await api(`/templates/${deleteTargetId}`, { method: "DELETE" });
                if (data.success) {
                    showToast("模板已删除", "success");
                    loadTemplates();
                } else {
                    showToast(data.message, "error");
                }
            } else {
                const data = await api(`/tasks/${deleteTargetId}`, { method: "DELETE" });
                if (data.success) {
                    showToast("任务已移到回收站", "success");
                    loadAllData();
                    loadRecycleBin();
                } else {
                    showToast(data.message, "error");
                }
            }
        } catch (err) {
            showToast("删除失败", "error");
        }
        deleteTargetId = null;
    });
}

// ─── 搜索 ─────────────────────────────────────────────────

function bindSearch() {
    let timer = null;
    $("#search-input").addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            currentSearch = $("#search-input").value.trim();
            pendingPage = 1; donePage = 1;
            loadAllData();
        }, 300);
    });
}

// ─── 分类筛选 ─────────────────────────────────────────────

function bindCategoryFilter() {
    $("#filter-category").addEventListener("change", () => {
        currentCategory = $("#filter-category").value;
        pendingPage = 1; donePage = 1;
        loadAllData();
    });
}

// ─── 排序标签 ─────────────────────────────────────────────

function bindSortTabs() {
    document.querySelectorAll(".sort-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".sort-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentSort = tab.dataset.sort;
            pendingPage = 1; donePage = 1;
            loadAllData();
        });
    });
}

// ─── 高级选项展开 ─────────────────────────────────────────

function bindAdvancedToggle() {
    $("#btn-toggle-advanced").addEventListener("click", () => {
        const panel = $("#advanced-panel");
        const chevron = $("#chevron-adv");
        panel.classList.toggle("hidden");
        chevron.classList.toggle("rotated");
    });
}

// ─── 星级评分 ─────────────────────────────────────────────

function bindStarRating() {
    setupStarGroup("star-rating-create", "task-star-rating");
}

function setupStarGroup(containerId, inputId) {
    const container = $(`#${containerId}`);
    if (!container) return;
    const stars = container.querySelectorAll(".star");
    stars.forEach(star => {
        star.addEventListener("click", () => {
            const val = parseInt(star.dataset.val);
            const input = $(`#${inputId}`);
            const currentVal = parseInt(input.value);
            // 点击相同星级取消选择
            if (currentVal === val) {
                input.value = "0";
                resetStarRating(containerId);
            } else {
                input.value = val;
                updateStarDisplay(containerId, val);
            }
        });
    });
}

function updateStarDisplay(containerId, val) {
    const container = $(`#${containerId}`);
    container.querySelectorAll(".star").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.val) <= val);
    });
}

function resetStarRating(containerId) {
    const container = $(`#${containerId}`);
    if (!container) return;
    container.querySelectorAll(".star").forEach(s => s.classList.remove("active"));
}

// ─── 会话检查 ─────────────────────────────────────────────

async function checkSession() {
    try {
        const data = await api("/session");
        if (data.success) {
            currentPhone = data.data;
            enterMainView();
        } else {
            sessionId = null;
            localStorage.removeItem("session_id");
            showView("login");
        }
    } catch (e) {
        console.error("会话检查失败:", e);
        sessionId = null;
        localStorage.removeItem("session_id");
        showView("login");
    }
}

function enterMainView() {
    showView("main");
    const phoneEl = $("#display-phone");
    if (phoneEl) phoneEl.textContent = currentPhone;
    // 先生成任务，再加载数据
    generateTasks().then(() => {
        loadAllData();
        loadTemplates();
        loadCheckinStatus();
        loadRecycleBin();
    });
}

// ─── 加载数据 ─────────────────────────────────────────────

async function loadAllData() {
    try {
    const params = new URLSearchParams({
        sort_by: currentSort,
        category: currentCategory,
        search: currentSearch,
        page: 1,
        per_page: 9999,
    });

    const data = await api(`/tasks?${params}`);
    if (!data.success) {
        return;
    }

    const allTasks = data.data.items || [];
    const expiredTasks = allTasks.filter(t => isTaskExpired(t));
    const pendingTasks = allTasks.filter(t => !t.completed && !isTaskExpired(t));
    const doneTasks = allTasks.filter(t => t.completed);

    // 存储所有任务到全局变量（用于全选功能）
    allPendingTasks = pendingTasks;
    allDoneTasks = doneTasks;
    allExpiredTasks = expiredTasks;

    totalCount = allTasks.length;
    pendingCount = pendingTasks.length;
    expiredCount = expiredTasks.length;
    doneCount = doneTasks.length;

    // 更新统计
    $("#stat-total").textContent = totalCount;
    $("#stat-pending").textContent = pendingCount;
    $("#stat-done").textContent = doneCount;
    $("#badge-pending").textContent = pendingCount;
    $("#badge-expired").textContent = expiredCount;
    $("#badge-done").textContent = doneCount;

    // 分页切片
    pendingTotalPages = Math.max(1, Math.ceil(pendingCount / perPage));
    expiredTotalPages = Math.max(1, Math.ceil(expiredCount / perPage));
    doneTotalPages = Math.max(1, Math.ceil(doneCount / perPage));

    if (pendingPage > pendingTotalPages) pendingPage = pendingTotalPages;
    if (expiredPage > expiredTotalPages) expiredPage = expiredTotalPages;
    if (donePage > doneTotalPages) donePage = doneTotalPages;

    const pendingSlice = paginate(pendingTasks, pendingPage, perPage);
    const expiredSlice = paginate(expiredTasks, expiredPage, perPage);
    const doneSlice = paginate(doneTasks, donePage, perPage);

    renderTaskList("list-pending", "empty-pending", pendingSlice, false, pendingCount);
    renderExpiredList("list-expired", expiredSlice, expiredCount);
    renderTaskList("list-done", "empty-done", doneSlice, true, doneCount);

    renderPagination("pagination-pending", pendingPage, pendingTotalPages, "pending");
    renderPagination("pagination-expired", expiredPage, expiredTotalPages, "expired");
    renderPagination("pagination-done", donePage, doneTotalPages, "done");

    } catch (e) {
        console.error("加载数据失败:", e);
    }
}

function paginate(items, page, perPage) {
    const start = (page - 1) * perPage;
    return items.slice(start, start + perPage);
}

function isTaskExpired(task) {
    if (task.completed || !task.deadline) return false;
    try {
        return new Date(task.deadline) < new Date();
    } catch {
        return false;
    }
}

// ─── 渲染任务列表 ─────────────────────────────────────────

function renderTaskList(listId, emptyId, tasks, isDoneList, totalForSection) {
    const listEl = $(`#${listId}`);
    const emptyEl = $(`#${emptyId}`);

    if (totalForSection === 0) {
        listEl.innerHTML = "";
        emptyEl.classList.remove("hidden");
        updateEmptyText(emptyId, isDoneList);
        return;
    }

    emptyEl.classList.add("hidden");

    if (tasks.length === 0) {
        listEl.innerHTML = `<div class="no-results"><div class="no-results-emoji">&#128269;</div><p>当前页没有任务</p></div>`;
        return;
    }

    listEl.innerHTML = tasks.map(t => {
        const stars = t.star_rating > 0 ? "★".repeat(t.star_rating) + "☆".repeat(5 - t.star_rating) : "";
        const dlDisplay = formatDeadline(t.deadline);
        const dlUrgent = isDeadlineUrgent(t.deadline);

        return `
        <div class="task-item ${t.completed ? "done" : ""} star-${t.star_rating || 0}" data-id="${t.id}">
            <label class="task-checkbox ${batchMode ? "visible" : ""}">
                <input type="checkbox" onchange="toggleTaskSelection('${t.id}', this)" ${selectedTasks.has(t.id) ? "checked" : ""}>
            </label>
            <button class="task-check ${t.completed ? "checked" : ""}" onclick="toggleTask('${t.id}')" title="切换状态"></button>
            <div class="task-body">
                <div class="task-title-text">${esc(t.title)}</div>
                ${t.description ? `<div class="task-desc-text">${esc(t.description)}</div>` : ""}
                <div class="task-meta">
                    <span class="task-time">${t.created_at}</span>
                    <span class="category-tag">${esc(t.category || "其他")}</span>
                    ${stars ? `<span class="star-display">${stars}</span>` : ""}
                    ${dlDisplay ? `<span class="deadline-tag ${dlUrgent ? "urgent" : ""}">${dlDisplay}</span>` : ""}
                </div>
            </div>
            <div class="task-actions">
                <button class="btn btn-outline btn-sm" onclick="startEdit('${t.id}')" title="编辑">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
                </button>
                <button class="btn btn-outline btn-sm" onclick="promptDelete('${t.id}')" title="删除">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                </button>
            </div>
        </div>`;
    }).join("");
}

function updateEmptyText(emptyId, isDoneList) {
    const el = $(`#${emptyId}`);
    if (!isDoneList) {
        if (doneCount > 0 && pendingCount === 0) {
            el.innerHTML = `<div class="empty-emoji">&#127942;</div><p class="empty-text">你好棒！你居然完成了所有任务！</p><p class="empty-sub">你简直是超人，休息一下吧~</p>`;
        } else {
            el.innerHTML = `<div class="empty-emoji">&#127919;</div><p class="empty-text">快来创建第一项任务吧！</p><p class="empty-sub">你的高效之旅从这里开始</p>`;
        }
    } else {
        if (pendingCount > 0 && doneCount === 0) {
            el.innerHTML = `<div class="empty-emoji">&#128170;</div><p class="empty-text">我已经迫不及待看你完成第一项任务了</p><p class="empty-sub">加油，你是最棒的！</p>`;
        } else {
            el.innerHTML = `<div class="empty-emoji">&#128170;</div><p class="empty-text">完成任务后会在这里显示</p><p class="empty-sub">加油，你是最棒的！</p>`;
        }
    }
}

// ─── 渲染已过期列表 ───────────────────────────────────────

function renderExpiredList(listId, tasks, totalForSection) {
    const listEl = $(`#${listId}`);
    const emptyEl = $("#empty-expired");
    const emptyHasEl = $("#empty-expired-has");

    if (totalForSection === 0) {
        listEl.innerHTML = "";
        emptyEl.classList.remove("hidden");
        emptyHasEl.classList.add("hidden");
        return;
    }

    emptyEl.classList.add("hidden");
    emptyHasEl.classList.remove("hidden");

    if (tasks.length === 0) {
        listEl.innerHTML = `<div class="no-results"><div class="no-results-emoji">&#128269;</div><p>当前页没有任务</p></div>`;
        return;
    }

    listEl.innerHTML = tasks.map(t => {
        const stars = t.star_rating > 0 ? "★".repeat(t.star_rating) + "☆".repeat(5 - t.star_rating) : "";
        const dlDisplay = formatDeadline(t.deadline);

        return `
        <div class="task-item expired star-${t.star_rating || 0}" data-id="${t.id}">
            <label class="task-checkbox ${batchMode ? "visible" : ""}">
                <input type="checkbox" onchange="toggleTaskSelection('${t.id}', this)" ${selectedTasks.has(t.id) ? "checked" : ""}>
            </label>
            <button class="task-check" onclick="toggleTask('${t.id}')" title="标记完成"></button>
            <div class="task-body">
                <div class="task-title-text">${esc(t.title)}</div>
                ${t.description ? `<div class="task-desc-text">${esc(t.description)}</div>` : ""}
                <div class="task-meta">
                    <span class="task-time">${t.created_at}</span>
                    <span class="category-tag">${esc(t.category || "其他")}</span>
                    ${stars ? `<span class="star-display">${stars}</span>` : ""}
                    ${dlDisplay ? `<span class="deadline-tag urgent">${dlDisplay}</span>` : ""}
                </div>
            </div>
            <div class="task-actions">
                <button class="btn btn-outline btn-sm" onclick="promptDelete('${t.id}')" title="删除">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                </button>
            </div>
        </div>`;
    }).join("");
}

// ─── 分页渲染 ─────────────────────────────────────────────

function renderPagination(containerId, currentPage, totalPages, listType) {
    const el = $(`#${containerId}`);
    if (totalPages <= 1) { el.innerHTML = ""; return; }

    let html = "";
    html += `<button class="page-btn" ${currentPage <= 1 ? "disabled" : ""} onclick="goPage('${listType}', ${currentPage - 1})">&lsaquo;</button>`;
    html += `<span class="page-info">${currentPage} / ${totalPages}</span>`;
    html += `<button class="page-btn" ${currentPage >= totalPages ? "disabled" : ""} onclick="goPage('${listType}', ${currentPage + 1})">&rsaquo;</button>`;
    el.innerHTML = html;
}

function goPage(listType, page) {
    if (listType === "pending") {
        pendingPage = page;
    } else if (listType === "expired") {
        expiredPage = page;
    } else {
        donePage = page;
    }
    loadAllData();
}

// ─── 任务操作 ─────────────────────────────────────────────

async function toggleTask(id) {
    try {
        const data = await api(`/tasks/${id}/toggle`, { method: "POST" });
        if (data.success) {
            showToast(data.message, "success");
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("操作失败", "error");
    }
}

function promptDelete(id) {
    deleteTargetId = id;
    deleteTargetType = "task";
    // 恢复弹窗文本
    $(".modal-text").textContent = "确定要删除这个任务吗？";
    $(".modal-sub").textContent = "删除后无法恢复";
    $("#modal-overlay").classList.remove("hidden");
}

// ─── 内联编辑 ─────────────────────────────────────────────

function startEdit(id) {
    // 先从API获取最新数据
    const params = new URLSearchParams({ sort_by: "created", category: "全部", search: "", page: 1, per_page: 9999 });
    api(`/tasks?${params}`).then(data => {
        if (!data || !data.success) return;
        const task = data.data.items.find(t => t.id === id);
        if (!task) return;
        startEditWithTask(task);
    }).catch(() => {});
}

function startEditWithTask(task) {
    const itemEl = document.querySelector(`.task-item[data-id="${task.id}"]`);
    if (!itemEl) return;

    itemEl.classList.add("editing");
    const bodyEl = itemEl.querySelector(".task-body");

    bodyEl.innerHTML = `
        <input class="edit-input" id="edit-title-${task.id}" value="${escAttr(task.title)}" placeholder="任务标题" maxlength="100">
        <input class="edit-input" id="edit-desc-${task.id}" value="${escAttr(task.description)}" placeholder="任务描述（可选）" maxlength="500">
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <select class="edit-input select-edit" id="edit-category-${task.id}" style="flex:1;min-width:80px;">
                <option value="工作" ${task.category === "工作" ? "selected" : ""}>工作</option>
                <option value="学习" ${task.category === "学习" ? "selected" : ""}>学习</option>
                <option value="生活" ${task.category === "生活" ? "selected" : ""}>生活</option>
                <option value="家庭" ${task.category === "家庭" ? "selected" : ""}>家庭</option>
                <option value="其他" ${task.category === "其他" ? "selected" : ""}>其他</option>
            </select>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px;">
            <div style="flex:1;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">星级</div>
                <div class="star-rating" id="star-edit-${task.id}" style="padding:0;">
                    ${[1,2,3,4,5].map(v => `<span class="star ${v <= task.star_rating ? "active" : ""}" data-val="${v}" onclick="clickEditStar('${task.id}', ${v})">&#9733;</span>`).join("")}
                </div>
                <input type="hidden" id="edit-star-${task.id}" value="${task.star_rating}">
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <div style="flex:1;min-width:120px;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">开始日期</div>
                <input class="edit-input" type="datetime-local" id="edit-start-${task.id}" value="${task.start_date || ""}">
            </div>
            <div style="flex:1;min-width:120px;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">截止日期</div>
                <input class="edit-input" type="datetime-local" id="edit-deadline-${task.id}" value="${task.deadline || ""}">
            </div>
        </div>
        <div class="edit-actions">
            <button class="btn btn-primary btn-sm" onclick="saveEdit('${task.id}')">保存</button>
            <button class="btn btn-outline btn-sm" onclick="loadAllData()">取消</button>
        </div>`;

    const actionsEl = itemEl.querySelector(".task-actions");
    if (actionsEl) actionsEl.style.display = "none";

    const titleInput = $(`#edit-title-${task.id}`);
    titleInput.focus();
    titleInput.select();
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveEdit(task.id); });
}

function clickEditStar(taskId, val) {
    const input = $(`#edit-star-${taskId}`);
    const current = parseInt(input.value);
    if (current === val) {
        input.value = "0";
        val = 0;
    } else {
        input.value = val;
    }
    $(`#star-edit-${taskId}`).querySelectorAll(".star").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.val) <= val);
    });
}

async function saveEdit(id) {
    try {
        const title = $(`#edit-title-${id}`).value.trim();
        if (!title) { showToast("任务标题不能为空", "error"); return; }

        const startDate = $(`#edit-start-${id}`).value || "";
        const deadline = $(`#edit-deadline-${id}`).value || "";

        if (startDate && deadline && new Date(startDate) > new Date(deadline)) {
            showToast("开始日期不能晚于截止日期", "error");
            return;
        }

        const body = {
            title,
            description: $(`#edit-desc-${id}`).value.trim(),
            category: $(`#edit-category-${id}`).value,
            star_rating: parseInt($(`#edit-star-${id}`).value) || 0,
            start_date: startDate,
            deadline: deadline,
        };

        const data = await api(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
        if (data.success) {
            showToast("任务已更新", "success");
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("保存失败", "error");
    }
}

// ─── 工具函数 ─────────────────────────────────────────────

function esc(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function escAttr(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDeadline(deadline) {
    if (!deadline) return "";
    try {
        const d = new Date(deadline);
        if (isNaN(d.getTime())) return deadline;
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const hour = d.getHours().toString().padStart(2, "0");
        const min = d.getMinutes().toString().padStart(2, "0");
        return `${month}/${day} ${hour}:${min}`;
    } catch {
        return deadline;
    }
}

function isDeadlineUrgent(deadline) {
    if (!deadline) return false;
    try {
        const d = new Date(deadline);
        const now = new Date();
        const diff = d.getTime() - now.getTime();
        return diff > 0 && diff < 24 * 60 * 60 * 1000; // 24小时内
    } catch {
        return false;
    }
}

// ─── 主题切换 ─────────────────────────────────────────────

function bindThemeSwitcher() {
    document.querySelectorAll(".theme-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const theme = btn.dataset.theme;
            toggleTheme(theme);
        });
    });
}

function toggleTheme(theme) {
    if (theme === "normal") {
        // 普通模式：关闭护眼和夜间
        eyecareEnabled = false;
        nightEnabled = false;
    } else if (theme === "eyecare") {
        // 护眼模式：切换护眼
        eyecareEnabled = !eyecareEnabled;
    } else if (theme === "night") {
        // 夜间模式：切换夜间（如果护眼开启则切换为护眼+夜间）
        nightEnabled = !nightEnabled;
    }

    // 保存状态
    localStorage.setItem("eyecare", eyecareEnabled);
    localStorage.setItem("night", nightEnabled);

    applyTheme();
    updateThemeButtons();
}

function applyTheme() {
    const body = document.body;
    body.classList.remove("eyecare", "night");

    if (eyecareEnabled && nightEnabled) {
        body.classList.add("eyecare", "night");
        currentTheme = "eyecare-night";
    } else if (eyecareEnabled) {
        body.classList.add("eyecare");
        currentTheme = "eyecare";
    } else if (nightEnabled) {
        body.classList.add("night");
        currentTheme = "night";
    } else {
        currentTheme = "normal";
    }

    localStorage.setItem("theme", currentTheme);
}

function updateThemeButtons() {
    document.querySelectorAll(".theme-btn").forEach(btn => {
        const theme = btn.dataset.theme;
        btn.classList.remove("active");

        if (theme === "normal" && !eyecareEnabled && !nightEnabled) {
            btn.classList.add("active");
        } else if (theme === "eyecare" && eyecareEnabled) {
            btn.classList.add("active");
        } else if (theme === "night" && nightEnabled) {
            btn.classList.add("active");
        }
    });
}

// ─── 励志名言展示 ─────────────────────────────────────────

function showRandomQuote() {
    const quoteText = $("#quote-text");
    const randomIndex = Math.floor(Math.random() * quotes.length);
    quoteText.textContent = quotes[randomIndex];

    showView("quote");

    // 3秒后进入主界面
    setTimeout(() => {
        enterMainView();
    }, 3000);
}

// ─── 自动生成器 ───────────────────────────────────────────

function bindGenerator() {
    // 打开弹窗
    $("#btn-generator").addEventListener("click", () => {
        $("#generator-overlay").classList.remove("hidden");
    });

    // 关闭弹窗
    $("#generator-cancel").addEventListener("click", () => {
        $("#generator-overlay").classList.add("hidden");
        resetGeneratorForm();
    });

    // 频率标签切换
    document.querySelectorAll(".gen-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".gen-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const freq = tab.dataset.freq;
            document.querySelectorAll(".gen-freq-panel").forEach(p => p.classList.add("hidden"));
            $(`#gen-${freq}-panel`).classList.remove("hidden");
        });
    });

    // 生成器星级评分
    setupStarGroup("star-rating-gen", "gen-star-rating");

    // 提交表单
    $("#form-generator").addEventListener("submit", async (e) => {
        e.preventDefault();
        await createTemplate();
    });
}

function resetGeneratorForm() {
    $("#form-generator").reset();
    $("#gen-star-rating").value = "0";
    resetStarRating("star-rating-gen");
    // 重置为按日标签
    document.querySelectorAll(".gen-tab").forEach(t => t.classList.remove("active"));
    document.querySelector('.gen-tab[data-freq="daily"]').classList.add("active");
    document.querySelectorAll(".gen-freq-panel").forEach(p => p.classList.add("hidden"));
    $("#gen-daily-panel").classList.remove("hidden");
}

async function createTemplate() {
    const title = $("#gen-title").value.trim();
    if (!title) { showToast("任务标题不能为空", "error"); return; }

    const activeTab = document.querySelector(".gen-tab.active");
    const freq = activeTab.dataset.freq;

    let body = {
        title,
        description: $("#gen-desc").value.trim(),
        category: $("#gen-category").value,
        star_rating: parseInt($("#gen-star-rating").value) || 0,
        frequency: freq,
    };

    if (freq === "daily") {
        body.generate_day = 0;
        body.generate_time = $("#gen-daily-time").value || "09:00";
        body.deadline_day = 0;
        body.deadline_time = $("#gen-daily-deadline").value || "18:00";
    } else if (freq === "weekly") {
        body.generate_day = parseInt($("#gen-weekly-day").value);
        body.generate_time = $("#gen-weekly-time").value || "09:00";
        body.deadline_day = parseInt($("#gen-weekly-deadline-day").value);
        body.deadline_time = $("#gen-weekly-deadline-time").value || "18:00";
    } else {
        body.generate_day = parseInt($("#gen-monthly-day").value);
        body.generate_time = $("#gen-monthly-time").value || "09:00";
        body.deadline_day = parseInt($("#gen-monthly-deadline-day").value);
        body.deadline_time = $("#gen-monthly-deadline-time").value || "18:00";
    }

    try {
        const data = await api("/templates", { method: "POST", body: JSON.stringify(body) });
        if (data.success) {
            showToast("模板创建成功！任务将按规则自动生成", "success");
            $("#generator-overlay").classList.add("hidden");
            resetGeneratorForm();
            loadTemplates();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("创建失败", "error");
    }
}

async function loadTemplates() {
    try {
        const data = await api("/templates");
        if (!data.success) return;

        const templates = data.data || [];
        const listEl = $("#list-templates");
        const emptyEl = $("#empty-templates");
        const badgeEl = $("#badge-templates");

        badgeEl.textContent = templates.length;

        if (templates.length === 0) {
            listEl.innerHTML = "";
            emptyEl.classList.remove("hidden");
            return;
        }

        emptyEl.classList.add("hidden");

        const freqLabels = { daily: "按日", weekly: "按周", monthly: "按月" };
        const dayLabels = { 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日" };

        listEl.innerHTML = templates.map(t => {
            let freqDetail = "";
            if (t.frequency === "daily") {
                freqDetail = `每天 ${t.generate_time}`;
            } else if (t.frequency === "weekly") {
                freqDetail = `每${dayLabels[t.generate_day] || ""} ${t.generate_time}`;
            } else {
                freqDetail = `每月${t.generate_day}号 ${t.generate_time}`;
            }

            return `
            <div class="template-item" data-id="${t.id}">
                <div class="template-body">
                    <div class="template-title">${esc(t.title)}</div>
                    <div class="template-meta">
                        <span class="template-freq">${freqLabels[t.frequency] || t.frequency}</span>
                        <span>${freqDetail}</span>
                        <span>分类: ${esc(t.category)}</span>
                        ${t.star_rating > 0 ? `<span>重要: ${"★".repeat(t.star_rating)}</span>` : ""}
                    </div>
                </div>
                <div class="template-actions">
                    <button class="btn btn-outline btn-sm edit-btn" onclick="startEditTemplate('${t.id}')" title="编辑模板">
                        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
                    </button>
                    <button class="btn btn-outline btn-sm delete-btn" onclick="deleteTemplate('${t.id}')" title="删除模板">
                        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                    </button>
                </div>
            </div>`;
        }).join("");
    } catch (err) {
        console.error("加载模板失败:", err);
    }
}

function deleteTemplate(id) {
    deleteTargetId = id;
    deleteTargetType = "template";
    // 更新弹窗文本
    $(".modal-text").textContent = "确定要删除这个自动生成模板吗？";
    $(".modal-sub").textContent = "删除后将停止自动生成任务";
    $("#modal-overlay").classList.remove("hidden");
}

function startEditTemplate(id) {
    // 获取模板数据
    api("/templates").then(data => {
        if (!data || !data.success) return;
        const template = data.data.find(t => t.id === id);
        if (!template) return;
        startEditTemplateWithTemplate(template);
    }).catch(() => {});
}

function startEditTemplateWithTemplate(template) {
    const itemEl = document.querySelector(`.template-item[data-id="${template.id}"]`);
    if (!itemEl) return;

    itemEl.classList.add("editing");
    const bodyEl = itemEl.querySelector(".template-body");

    const freqLabels = { daily: "按日", weekly: "按周", monthly: "按月" };
    const dayLabels = { 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日" };

    let freqDetail = "";
    if (template.frequency === "daily") {
        freqDetail = `每天 ${template.generate_time}`;
    } else if (template.frequency === "weekly") {
        freqDetail = `每${dayLabels[template.generate_day] || ""} ${template.generate_time}`;
    } else {
        freqDetail = `每月${template.generate_day}号 ${template.generate_time}`;
    }

    bodyEl.innerHTML = `
        <input class="edit-input" id="edit-tmpl-title-${template.id}" value="${escAttr(template.title)}" placeholder="模板标题" maxlength="100">
        <input class="edit-input" id="edit-tmpl-desc-${template.id}" value="${escAttr(template.description)}" placeholder="模板描述（可选）" maxlength="500">
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <select class="edit-input select-edit" id="edit-tmpl-category-${template.id}" style="flex:1;min-width:80px;">
                <option value="工作" ${template.category === "工作" ? "selected" : ""}>工作</option>
                <option value="学习" ${template.category === "学习" ? "selected" : ""}>学习</option>
                <option value="生活" ${template.category === "生活" ? "selected" : ""}>生活</option>
                <option value="家庭" ${template.category === "家庭" ? "selected" : ""}>家庭</option>
                <option value="其他" ${template.category === "其他" ? "selected" : ""}>其他</option>
            </select>
            <select class="edit-input select-edit" id="edit-tmpl-freq-${template.id}" style="flex:1;min-width:80px;">
                <option value="daily" ${template.frequency === "daily" ? "selected" : ""}>按日</option>
                <option value="weekly" ${template.frequency === "weekly" ? "selected" : ""}>按周</option>
                <option value="monthly" ${template.frequency === "monthly" ? "selected" : ""}>按月</option>
            </select>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px;">
            <div style="flex:1;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">星级</div>
                <div class="star-rating" id="star-edit-tmpl-${template.id}" style="padding:0;">
                    ${[1,2,3,4,5].map(v => `<span class="star ${v <= template.star_rating ? "active" : ""}" data-val="${v}" onclick="clickEditStarTmpl('${template.id}', ${v})">&#9733;</span>`).join("")}
                </div>
                <input type="hidden" id="edit-tmpl-star-${template.id}" value="${template.star_rating}">
            </div>
        </div>
        <div class="edit-actions">
            <button class="btn btn-primary btn-sm" onclick="saveEditTemplate('${template.id}')">保存</button>
            <button class="btn btn-outline btn-sm" onclick="loadTemplates()">取消</button>
        </div>`;

    const actionsEl = itemEl.querySelector(".template-actions");
    if (actionsEl) actionsEl.style.display = "none";

    const titleInput = $(`#edit-tmpl-title-${template.id}`);
    titleInput.focus();
    titleInput.select();
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveEditTemplate(template.id); });
}

function clickEditStarTmpl(templateId, val) {
    const input = $(`#edit-tmpl-star-${templateId}`);
    const current = parseInt(input.value);
    if (current === val) {
        input.value = "0";
        val = 0;
    } else {
        input.value = val;
    }
    $(`#star-edit-tmpl-${templateId}`).querySelectorAll(".star").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.val) <= val);
    });
}

async function saveEditTemplate(id) {
    try {
        const title = $(`#edit-tmpl-title-${id}`).value.trim();
        if (!title) { showToast("模板标题不能为空", "error"); return; }

        const body = {
            title,
            description: $(`#edit-tmpl-desc-${id}`).value.trim(),
            category: $(`#edit-tmpl-category-${id}`).value,
            star_rating: parseInt($(`#edit-tmpl-star-${id}`).value) || 0,
        };

        const data = await api(`/templates/${id}`, { method: "PUT", body: JSON.stringify(body) });
        if (data.success) {
            showToast("模板已更新", "success");
            loadTemplates();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("保存失败", "error");
    }
}

async function generateTasks() {
    try {
        await api("/templates/generate", { method: "POST" });
    } catch (err) {
        console.error("生成任务失败:", err);
    }
}

// ─── 每日打卡 ─────────────────────────────────────────────

function bindCheckin() {
    $("#btn-checkin").addEventListener("click", async () => {
        await doCheckin();
    });
}

async function loadCheckinStatus() {
    try {
        const data = await api("/checkin/status");
        if (!data.success) return;

        const { current_streak, max_streak, checked_in_today } = data.data;
        $("#checkin-current").textContent = `当前连续: ${current_streak}天`;
        $("#checkin-max").textContent = `最长连续: ${max_streak}天`;

        const btn = $("#btn-checkin");
        if (checked_in_today) {
            btn.classList.add("checked");
            btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> 已签到`;
            btn.disabled = true;
        } else {
            btn.classList.remove("checked");
            btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> 签到`;
            btn.disabled = false;
        }

        // 显示激励语句
        updateCheckinQuote(current_streak);
    } catch (err) {
        console.error("获取签到状态失败:", err);
    }
}

function updateCheckinQuote(streak) {
    const quoteEl = $("#checkin-quote");
    if (!quoteEl) return;

    if (streak === 0) {
        quoteEl.classList.add("hidden");
        return;
    }

    quoteEl.classList.remove("hidden");
    quoteEl.classList.remove("milestone");

    // 100的整数倍优先显示
    if (streak > 0 && streak % 100 === 0) {
        quoteEl.textContent = `恭喜你已经坚持了${streak}天，回头看，轻舟已过万重山；向前看，长路漫漫亦灿灿。带着百日的底气，奔赴下一个山海。`;
        quoteEl.classList.add("milestone");
    } else if (streak >= 31) {
        quoteEl.textContent = "不再是痛苦的自律，而是自然的流淌。恭喜你，已经把优秀内化成了身体的本能。";
    } else if (streak >= 8) {
        quoteEl.textContent = "不是因为看到希望才坚持，而是因为坚持了才看到希望。中间的这段路最黑，但也离黎明最近。";
    } else if (streak >= 1) {
        quoteEl.textContent = "不要高估一天的改变，但绝不要低估一周的积累。你正在为万里长城垒下第一块真正的基石。";
    }
}

async function doCheckin() {
    try {
        const data = await api("/checkin", { method: "POST" });
        if (data.success) {
            const { current_streak, max_streak } = data.data;
            showToast(`签到成功！连续${current_streak}天`, "success");
            loadCheckinStatus();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("签到失败", "error");
    }
}

// ─── 数据导出/导入 ─────────────────────────────────────────

function bindExportImport() {
    // 导出
    $("#btn-export").addEventListener("click", async () => {
        try {
            const headers = { "X-Session-Id": sessionId };
            const resp = await fetch("/api/export", { headers });
            if (resp.status === 401) {
                showToast("请先登录", "error");
                return;
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `taskflow_backup_${new Date().toISOString().slice(0,10)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("数据导出成功！", "success");
        } catch (err) {
            showToast("导出失败", "error");
        }
    });

    // 导入
    $("#import-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.endsWith(".zip")) {
            showToast("请选择.zip文件", "error");
            return;
        }

        try {
            const formData = new FormData();
            formData.append("file", file);

            const resp = await fetch("/api/import", {
                method: "POST",
                headers: { "X-Session-Id": sessionId },
                body: formData,
            });

            const data = await resp.json();
            if (data.success) {
                showToast(data.message, "success");
                loadAllData();
                loadTemplates();
                loadCheckinStatus();
            } else {
                showToast(data.message, "error");
            }
        } catch (err) {
            showToast("导入失败", "error");
        }

        // 清空input，允许重复选择同一文件
        e.target.value = "";
    });
}

// ─── 回收站 ─────────────────────────────────────────────

function bindRecycleBin() {
    // 清空回收站
    $("#btn-clear-recycle").addEventListener("click", async () => {
        if (!confirm("确定要清空回收站吗？清空后无法恢复。")) return;
        try {
            const data = await api("/recycle", { method: "DELETE" });
            if (data.success) {
                showToast("回收站已清空", "success");
                loadRecycleBin();
            } else {
                showToast(data.message, "error");
            }
        } catch (err) {
            showToast("清空失败", "error");
        }
    });
}

async function loadRecycleBin() {
    try {
        const data = await api("/recycle");
        if (!data.success) return;

        const items = data.data || [];
        const listEl = $("#list-recycle");
        const emptyEl = $("#empty-recycle");
        const badgeEl = $("#badge-recycle");

        badgeEl.textContent = items.length;

        if (items.length === 0) {
            listEl.innerHTML = "";
            emptyEl.classList.remove("hidden");
            return;
        }

        emptyEl.classList.add("hidden");

        listEl.innerHTML = items.map(item => {
            const task = item.task;
            const stars = task.star_rating > 0 ? "★".repeat(task.star_rating) + "☆".repeat(5 - task.star_rating) : "";

            return `
            <div class="recycle-item" data-id="${task.id}">
                <div class="task-body">
                    <div class="task-title-text">${esc(task.title)}</div>
                    ${task.description ? `<div class="task-desc-text">${esc(task.description)}</div>` : ""}
                    <div class="task-meta">
                        <span class="category-tag">${esc(task.category || "其他")}</span>
                        ${stars ? `<span class="star-display">${stars}</span>` : ""}
                        <span class="deleted-time">删除于: ${item.deleted_at}</span>
                    </div>
                </div>
                <div class="recycle-actions">
                    <button class="btn btn-outline btn-sm recycle-restore-btn" onclick="restoreTask('${task.id}')" title="恢复任务">
                        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
                        恢复
                    </button>
                    <button class="btn btn-outline btn-sm recycle-delete-btn" onclick="permanentDelete('${task.id}')" title="永久删除">
                        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                        删除
                    </button>
                </div>
            </div>`;
        }).join("");
    } catch (err) {
        console.error("加载回收站失败:", err);
    }
}

async function restoreTask(id) {
    try {
        const data = await api(`/recycle/${id}/restore`, { method: "POST" });
        if (data.success) {
            showToast("任务已恢复", "success");
            loadRecycleBin();
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("恢复失败", "error");
    }
}

async function permanentDelete(id) {
    if (!confirm("确定要永久删除这个任务吗？此操作无法撤销。")) return;
    try {
        const data = await api(`/recycle/${id}`, { method: "DELETE" });
        if (data.success) {
            showToast("任务已永久删除", "success");
            loadRecycleBin();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("删除失败", "error");
    }
}

// ─── 用户中心 ─────────────────────────────────────────────

function bindUserCenter() {
    // 打开用户中心
    $("#btn-user-center").addEventListener("click", () => {
        showView("user-center");
        loadUserProfile();
        loadUserStats();
    });

    // 返回主页
    $("#btn-back-main").addEventListener("click", () => {
        showView("main");
    });

    // 修改密码表单
    $("#form-change-password").addEventListener("submit", async (e) => {
        e.preventDefault();
        const oldPassword = $("#old-password").value.trim();
        const newPassword = $("#new-password").value.trim();
        const confirmPassword = $("#confirm-password").value.trim();

        if (newPassword !== confirmPassword) {
            showToast("两次输入的新密码不一致", "error");
            return;
        }

        if (newPassword.length < 6) {
            showToast("新密码长度不能低于6位", "error");
            return;
        }

        try {
            const data = await api("/user/password", {
                method: "PUT",
                body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
            });
            if (data.success) {
                showToast("密码修改成功", "success");
                $("#form-change-password").reset();
            } else {
                showToast(data.message, "error");
            }
        } catch (err) {
            showToast("修改失败", "error");
        }
    });
}

async function loadUserProfile() {
    try {
        const data = await api("/user/profile");
        if (data.success) {
            $("#user-phone").textContent = data.data.phone;
        }
    } catch (err) {
        console.error("加载用户信息失败:", err);
    }
}

async function loadUserStats() {
    try {
        const data = await api("/user/stats");
        if (data.success) {
            renderPieChart(data.data);
            renderBarChart(data.data.monthly_completed);
        }
    } catch (err) {
        console.error("加载统计数据失败:", err);
    }
}

function renderPieChart(stats) {
    const ctx = document.getElementById("pie-chart").getContext("2d");

    // 销毁旧图表
    if (pieChart) {
        pieChart.destroy();
    }

    const labels = ["已完成", "待做中", "已过期"];
    const values = [stats.completed, stats.pending, stats.expired];
    const colors = ["#27ae60", "#667eea", "#e74c3c"];

    pieChart = new Chart(ctx, {
        type: "pie",
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const value = context.parsed;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${context.label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });

    // 渲染自定义图例
    const legendEl = document.getElementById("pie-legend");
    const total = values.reduce((a, b) => a + b, 0);
    legendEl.innerHTML = labels.map((label, i) => {
        const percentage = total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0;
        return `
            <div class="chart-legend-item">
                <span class="chart-legend-color" style="background: ${colors[i]}"></span>
                <span>${label}: ${values[i]} (${percentage}%)</span>
            </div>
        `;
    }).join("");
}

function renderBarChart(monthlyData) {
    const ctx = document.getElementById("bar-chart").getContext("2d");

    // 销毁旧图表
    if (barChart) {
        barChart.destroy();
    }

    const labels = monthlyData.map(item => item[0]);
    const values = monthlyData.map(item => item[1]);

    barChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{
                label: "完成任务数",
                data: values,
                backgroundColor: "#667eea",
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `完成: ${context.parsed.y} 个任务`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// ─── 批量操作 ─────────────────────────────────────────────

let batchMode = false;
let selectedTasks = new Set();
let currentBatchStatus = null;

function bindBatchOperations() {
    // 批量按钮点击事件
    document.querySelectorAll(".batch-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const status = btn.dataset.status;
            toggleBatchMode(status);
        });
    });

    // 清空按钮点击事件
    document.querySelectorAll(".clear-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const status = btn.dataset.status;
            promptClearTasks(status);
        });
    });

    // 批量操作确认对话框
    $("#batch-modal-cancel").addEventListener("click", hideBatchModal);
    $("#batch-modal-confirm").addEventListener("click", confirmBatchAction);
}

function toggleBatchMode(status) {
    if (batchMode && currentBatchStatus === status) {
        // 退出批量模式
        batchMode = false;
        selectedTasks.clear();
        currentBatchStatus = null;
        updateBatchUI();
    } else {
        // 进入批量模式
        batchMode = true;
        selectedTasks.clear();
        currentBatchStatus = status;
        updateBatchUI();
    }
}

function updateBatchUI() {
    // 更新所有复选框的可见性
    document.querySelectorAll(".task-checkbox").forEach(cb => {
        cb.classList.toggle("visible", batchMode);
        if (!batchMode) {
            cb.querySelector("input").checked = false;
        }
    });

    // 更新批量操作栏
    document.querySelectorAll(".batch-actions").forEach(bar => {
        bar.classList.toggle("visible", batchMode);
    });

    // 退出批量模式时重置全选复选框
    if (!batchMode) {
        document.querySelectorAll(".batch-select-all input[type='checkbox']").forEach(cb => {
            cb.checked = false;
        });
    }

    // 更新选中计数
    updateBatchCount();

    // 更新批量按钮状态
    document.querySelectorAll(".batch-btn").forEach(btn => {
        const isActive = batchMode && btn.dataset.status === currentBatchStatus;
        btn.classList.toggle("btn-primary", isActive);
        btn.classList.toggle("btn-outline", !isActive);
    });
}

function updateBatchCount() {
    document.querySelectorAll(".batch-count").forEach(el => {
        el.textContent = `已选择 ${selectedTasks.size} 项`;
    });
}

function toggleTaskSelection(taskId, checkbox) {
    if (checkbox.checked) {
        selectedTasks.add(taskId);
    } else {
        selectedTasks.delete(taskId);
    }
    updateBatchCount();
}

function selectAllTasks(status) {
    // 获取该栏目的所有任务
    const allTasks = status === "pending" ? allPendingTasks :
                     status === "completed" ? allDoneTasks : allExpiredTasks;

    // 检查是否已经全选
    const allTaskIds = allTasks.map(t => t.id);
    const isAllSelected = allTaskIds.every(id => selectedTasks.has(id));

    if (isAllSelected) {
        // 取消全选：清空该栏目的所有任务
        allTaskIds.forEach(id => selectedTasks.delete(id));
    } else {
        // 全选：添加该栏目的所有任务
        allTaskIds.forEach(id => selectedTasks.add(id));
    }

    // 更新当前页的复选框状态
    const listId = status === "pending" ? "list-pending" :
                   status === "completed" ? "list-done" : "list-expired";
    const listEl = $(`#${listId}`);
    const checkboxes = listEl.querySelectorAll(".task-checkbox input");

    checkboxes.forEach(cb => {
        const taskId = cb.closest(".task-item").dataset.id;
        cb.checked = selectedTasks.has(taskId);
    });

    updateBatchCount();
}

function promptClearTasks(status) {
    const statusNames = {
        "pending": "待办事项",
        "completed": "已完成",
        "expired": "已过期"
    };

    const statusName = statusNames[status] || status;
    $("#batch-modal-text").textContent = `确定要清空所有${statusName}吗？`;
    $("#batch-modal-sub").textContent = "此操作无法撤销";
    $("#batch-modal-confirm").dataset.action = "clear";
    $("#batch-modal-confirm").dataset.status = status;
    showBatchModal();
}

function promptBatchDelete() {
    if (selectedTasks.size === 0) {
        showToast("请先选择要删除的任务", "error");
        return;
    }

    $("#batch-modal-text").textContent = `确定要删除选中的 ${selectedTasks.size} 个任务吗？`;
    $("#batch-modal-sub").textContent = "删除后将移至回收站";
    $("#batch-modal-confirm").dataset.action = "batch-delete";
    showBatchModal();
}

function showBatchModal() {
    $("#batch-modal-overlay").classList.remove("hidden");
}

function hideBatchModal() {
    $("#batch-modal-overlay").classList.add("hidden");
}

async function confirmBatchAction() {
    const action = $("#batch-modal-confirm").dataset.action;
    const status = $("#batch-modal-confirm").dataset.status;

    hideBatchModal();

    if (action === "batch-delete") {
        await executeBatchDelete();
    } else if (action === "clear") {
        await executeClearTasks(status);
    }
}

async function executeBatchDelete() {
    const taskIds = Array.from(selectedTasks);

    try {
        const data = await api("/tasks/batch-delete", {
            method: "POST",
            body: JSON.stringify({ task_ids: taskIds })
        });

        if (data.success) {
            showToast(data.message, "success");
            // 重置批量模式状态
            batchMode = false;
            selectedTasks.clear();
            currentBatchStatus = null;
            // 重置全选复选框
            resetSelectAllCheckboxes();
            updateBatchUI();
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("批量删除失败", "error");
    }
}

async function executeClearTasks(status) {
    try {
        const data = await api(`/tasks/clear?status=${status}`, {
            method: "DELETE"
        });

        if (data.success) {
            showToast(data.message, "success");
            // 重置批量模式状态
            batchMode = false;
            selectedTasks.clear();
            currentBatchStatus = null;
            // 重置全选复选框
            resetSelectAllCheckboxes();
            updateBatchUI();
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
    } catch (err) {
        showToast("清空失败", "error");
    }
}

function resetSelectAllCheckboxes() {
    // 重置所有全选复选框
    document.querySelectorAll(".batch-select-all input[type='checkbox']").forEach(cb => {
        cb.checked = false;
    });
    // 重置所有任务复选框
    document.querySelectorAll(".task-checkbox input[type='checkbox']").forEach(cb => {
        cb.checked = false;
    });
}
