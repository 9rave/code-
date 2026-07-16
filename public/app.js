// 极简前端起步版（见开发指南 §10）。仅依赖 Cookie 会话，不存储 Token 于 JS。
// 功能：登录、今日/逾期/本周/已完成切换、新建任务、完成任务、退出。

const $ = (id) => document.getElementById(id);
const msg = (t) => { $("msg").textContent = t || ""; };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "请求失败");
  return data;
}

function show(view) {
  $("login").classList.toggle("hidden", view !== "login");
  $("main").classList.toggle("hidden", view !== "main");
}

async function loadMe() {
  try {
    const { data } = await api("/api/auth/me");
    $("who").textContent = data.username + (data.mustChangePassword ? "（请改密）" : "");
    show("main");
    await loadTasks("today");
    await loadStatus();
  } catch {
    show("login");
  }
}

async function loadTasks(view) {
  const { data } = await api("/api/tasks?view=" + view);
  const list = $("list");
  list.innerHTML = "";
  if (!data.items.length) {
    list.innerHTML = '<p class="muted">暂无任务</p>';
    return;
  }
  for (const t of data.items) {
    const div = document.createElement("div");
    div.className = "task";
    const pill = t.priority === "high" ? '<span class="pill high">高</span>' : '<span class="pill">' + t.priority + "</span>";
    div.innerHTML = `<span>${escapeHtml(t.title)} ${pill}</span>`;
    if (t.status !== "completed") {
      const btn = document.createElement("button");
      btn.textContent = "完成";
      btn.onclick = async () => { await api("/api/tasks/" + t.id + "/complete", { method: "POST" }); loadTasks(view); };
      div.appendChild(btn);
    }
    list.appendChild(div);
  }
}

async function loadStatus() {
  try {
    const { data } = await api("/api/settings/status");
    $("mode").textContent =
      "AI 状态：" + data.aiStatus + " ｜ 今日手动生成：" + data.manualGenerationsToday +
      " ｜ 企业微信：" + data.wecom;
  } catch {}
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 事件
$("loginBtn").onclick = async () => {
  msg("");
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("username").value, password: $("password").value }),
    });
    $("password").value = "";
    await loadMe();
  } catch (e) { msg(e.message); }
};

$("logoutBtn").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" });
  show("login");
};

$("addBtn").onclick = async () => {
  const title = $("newTitle").value.trim();
  if (!title) return msg("标题不能为空");
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title, priority: $("newPriority").value }) });
    $("newTitle").value = "";
    const active = document.querySelector("[data-view].active")?.dataset.view || "today";
    loadTasks(active);
  } catch (e) { msg(e.message); }
};

document.querySelectorAll("[data-view]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("[data-view]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    loadTasks(b.dataset.view);
  };
});

loadMe();
