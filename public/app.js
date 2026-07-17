// 前端（见开发指南 §10 / ADR-007）。仅依赖 Cookie 会话，不存储 Token 于 JS。
// 功能：主题切换、任务管理、复盘查看与重新生成、设置（状态/测试推送/改密）。

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 主题 ----------
function applyTheme(t) {
  if (t === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", t);
  }
}
function initTheme() {
  const saved = localStorage.getItem("theme") || "system";
  $("theme").value = saved;
  applyTheme(saved);
  $("theme").onchange = () => {
    localStorage.setItem("theme", $("theme").value);
    applyTheme($("theme").value);
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (($("theme").value) === "system") applyTheme("system");
  });
}

// ---------- 导航 ----------
function showTab(tab) {
  ["tasks", "review", "settings"].forEach((t) => $(t).classList.toggle("hidden", t !== tab));
  document.querySelectorAll("nav [data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "review") loadReview("evening");
  if (tab === "settings") loadStatus();
}
document.querySelectorAll("nav [data-tab]").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- 身份 ----------
async function loadMe() {
  try {
    const { data } = await api("/api/auth/me");
    $("who").textContent = data.username + (data.mustChangePassword ? "（请改密）" : "");
    $("login").classList.add("hidden");
    $("tasks").classList.remove("hidden");
    showTab("tasks");
    await loadTasks("today");
    await loadStatus();
  } catch {
    $("login").classList.remove("hidden");
    $("tasks").classList.add("hidden");
    $("review").classList.add("hidden");
    $("settings").classList.add("hidden");
  }
}

// ---------- 任务 ----------
async function loadTasks(view) {
  const list = $("list");
  list.innerHTML = '<p class="muted skel">加载中…</p>';
  const { data } = await api("/api/tasks?view=" + view);
  list.innerHTML = "";
  if (!data.items.length) { list.innerHTML = '<p class="muted">暂无任务</p>'; return; }
  for (const t of data.items) {
    const div = document.createElement("div");
    div.className = "task";
    const pill = t.priority === "high" ? '<span class="pill high">高</span>' : '<span class="pill">' + t.priority + "</span>";
    const extra = [];
    if (t.dueDate) extra.push("截止 " + escapeHtml(t.dueDate));
    if (t.estimatedDurationMinutes) extra.push("约 " + t.estimatedDurationMinutes + " 分");
    const extraHtml = extra.length ? '<span class="muted">' + extra.join(" · ") + "</span>" : "";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = '<span class="title">' + escapeHtml(t.title) + "</span>" + pill + extraHtml;
    div.appendChild(meta);
    if (t.status !== "completed") {
      const btn = document.createElement("button");
      btn.textContent = "完成";
      btn.onclick = async () => { await api("/api/tasks/" + t.id + "/complete", { method: "POST" }); loadTasks(view); };
      div.appendChild(btn);
    }
    list.appendChild(div);
  }
}
$("addBtn").onclick = async () => {
  const title = $("newTitle").value.trim();
  if (!title) return msg("标题不能为空");
  const dueDate = $("newDue").value || undefined;
  const estimatedDurationMinutes = $("newDuration").value ? Number($("newDuration").value) : undefined;
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, priority: $("newPriority").value, dueDate, estimatedDurationMinutes }),
    });
    $("newTitle").value = ""; $("newDue").value = ""; $("newDuration").value = "";
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

// ---------- 复盘 ----------
let currentType = "evening";
async function loadReview(type) {
  currentType = type;
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const { data } = await api(`/api/reviews?type=${type}&from=${from}&to=${to}`);
    const box = $("reviewBox");
    if (!data.length) { box.innerHTML = '<p class="muted">暂无复盘，点击"重新生成"。</p>'; return; }
    const r = data[0];
    const src = r.source === "ai"
      ? '<span class="badge ai">AI 增强</span>'
      : '<span class="badge">规则引擎</span>';
    box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px">
        <strong>${type === "morning" ? "早报" : type === "evening" ? "晚报" : "周报"} · ${r.reviewDate}</strong>
        ${src}</div>
      <pre class="review">${escapeHtml(r.content)}</pre>`;
  } catch (e) { $("reviewBox").innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}
document.querySelectorAll("[data-rtype]").forEach((b) => (b.onclick = () => loadReview(b.dataset.rtype)));
$("regenBtn").onclick = async () => {
  try {
    const { data, meta } = await api("/api/reviews/generate", {
      method: "POST", body: JSON.stringify({ type: currentType }),
    });
    await loadReview(currentType);
    msg(meta?.degraded ? "已使用规则模式生成（AI 暂不可用）" : "");
  } catch (e) { msg(e.message); }
};

// ---------- 设置 ----------
async function loadStatus() {
  try {
    const { data } = await api("/api/settings/status");
    $("statusLine").textContent =
      `AI：${data.aiStatus} ｜ 今日手动生成：${data.manualGenerationsToday} ｜ 企业微信：${data.wecom}`;
  } catch {}
}
$("testPushBtn").onclick = async () => {
  $("pushMsg").textContent = "发送中…";
  try { await api("/api/settings/test-push", { method: "POST" }); $("pushMsg").textContent = "已发送 ✅"; }
  catch (e) { $("pushMsg").textContent = e.message; }
};
$("chgPwdBtn").onclick = async () => {
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: $("curPwd").value, newPassword: $("newPwd").value }),
    });
    $("curPwd").value = ""; $("newPwd").value = "";
    msg("密码已更新，请重新登录");
    await loadMe();
  } catch (e) { msg(e.message); }
};

// ---------- 登录/退出 ----------
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
  localStorage.removeItem("theme");
  showTab("tasks");
  loadMe();
};

initTheme();
loadMe();
