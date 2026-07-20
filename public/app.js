// 前端（UI/UX 规范 §3-§6）。仅依赖 Cookie 会话。
// 功能：主题、导航(IA)、Dashboard、列表/看板、拖拽、标签、搜索筛选、日历、统计(自动刷新)、复盘、设置、任务详情 Drawer、消息提醒 Toast。

const $ = (id) => document.getElementById(id);
const msg = (t) => { const el = $("msg"); if (el) el.textContent = t || ""; };

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "请求失败");
  return data;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(d) { return d ? d : "—"; }

// ---------- Toast（规范 §6 消息提醒） ----------
function toast(text, kind = "info") {
  const wrap = $("toast-wrap");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 2600);
}

// ---------- 主题 ----------
function applyTheme(t) {
  if (t === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } else document.documentElement.setAttribute("data-theme", t);
}
function initTheme() {
  const saved = localStorage.getItem("theme") || "system";
  $("theme").value = saved;
  applyTheme(saved);
  $("theme").onchange = () => { localStorage.setItem("theme", $("theme").value); applyTheme($("theme").value); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ($("theme").value === "system") applyTheme("system"); });
}

// ---------- 导航（规范 §2 信息架构） ----------
const VIEWS = ["dashboard", "today", "upcoming", "kanban", "calendar", "statistics", "review", "settings"];
// 列表视图状态（规范 §4 筛选/搜索/标签/优先级）
const taskState = { baseView: "today", mode: "list", search: "", priority: "", tag: "", items: [] };
let statTimer = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let currentDetail = null;

function setActiveNav(view) {
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}
function showView(view) {
  VIEWS.forEach((v) => { const s = $(v); if (s) s.classList.toggle("hidden", v !== view); });
  setActiveNav(view);
  if (statTimer) { clearInterval(statTimer); statTimer = null; } // 离开统计则停自动刷新

  if (view === "dashboard") loadDashboard();
  else if (view === "today" || view === "upcoming") {
    taskState.baseView = view === "today" ? "today" : "week";
    $("tasksTitle").textContent = view === "today" ? "今日任务" : "本周 / Upcoming";
    document.querySelectorAll("#tasksView [data-v]").forEach((b) => b.classList.toggle("active", b.dataset.v === taskState.baseView));
    loadTasksView();
  }
  else if (view === "kanban") loadKanban();
  else if (view === "calendar") { renderCalendar(); }
  else if (view === "statistics") { loadStats(); statTimer = setInterval(loadStats, 30000); }
  else if (view === "review") loadReview("evening");
  else if (view === "settings") loadStatus();
}
document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => showView(b.dataset.view)));

// ---------- 身份 ----------
async function loadMe() {
  try {
    const { data } = await api("/api/auth/me");
    $("who").textContent = data.username + (data.mustChangePassword ? "（请改密）" : "");
    $("login").classList.add("hidden");
    showView("dashboard");
    await loadStatus();
  } catch {
    $("login").classList.remove("hidden");
    VIEWS.forEach((v) => { const s = $(v); if (s) s.classList.add("hidden"); });
  }
}

// ---------- Dashboard（规范 §3 中间 KPI / 快速新增 / 消息提醒） ----------
async function loadDashboard() {
  try {
    const { data: s } = await api("/api/statistics");
    $("kpiGrid").innerHTML = [
      ["总任务", s.total, true], ["进行中", s.pending, false], ["已完成", s.completed, false],
      ["逾期", s.overdue, false], ["高优先级", s.highPriority, false],
    ].map(([l, n, ac]) => `<div class="kpi ${ac ? "accent" : ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
    // 消息提醒：列出逾期任务
    const overdue = await api("/api/tasks?view=overdue");
    const items = overdue.data.items.slice(0, 5);
    $("reminderBox").innerHTML = items.length
      ? items.map((t) => `<div class="task" data-id="${t.id}" onclick="openDetail('${t.id}')">
            <span class="pill high">逾期</span><span class="title">${escapeHtml(t.title)}</span></div>`).join("")
      : '<p class="muted">🎉 没有逾期任务，棒！</p>';
    updateBell(s.overdue);
  } catch (e) { toast(e.message, "err"); }
}
function updateBell(n) {
  const dot = $("bellDot");
  if (n > 0) { dot.textContent = n > 99 ? "99+" : n; dot.classList.remove("hidden"); }
  else dot.classList.add("hidden");
}
$("bellBtn").onclick = () => {
  showView("today");
  document.querySelectorAll("#tasksView [data-v]").forEach((b) => b.classList.toggle("active", b.dataset.v === "overdue"));
  taskState.baseView = "overdue"; loadTasksView();
  toast("已为你筛选逾期任务", "info");
};
$("dashRefresh").onclick = loadDashboard;
$("qAdd").onclick = async () => {
  const title = $("qTitle").value.trim();
  if (!title) return toast("标题不能为空", "err");
  const tags = $("qTags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({
      title, priority: $("qPriority").value,
      dueDate: $("qDue").value || undefined,
      estimatedDurationMinutes: $("qDuration").value ? Number($("qDuration").value) : undefined,
      tags,
    }) });
    $("qTitle").value = ""; $("qDue").value = ""; $("qDuration").value = ""; $("qTags").value = "";
    toast("已添加", "ok"); loadDashboard();
  } catch (e) { toast(e.message, "err"); }
};

// ---------- 任务列表 / 看板（规范 §4） ----------
async function loadTasksView() {
  const body = $("tasksBody");
  body.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const { data } = await api("/api/tasks?view=" + taskState.baseView);
    taskState.items = data.items;
    renderTasksBody();
    await refreshTagOptions();
  } catch (e) { body.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}
function filteredItems() {
  const q = taskState.search.trim().toLowerCase();
  return taskState.items.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q)) return false;
    if (taskState.priority && t.priority !== taskState.priority) return false;
    if (taskState.tag && !(t.tags || []).includes(taskState.tag)) return false;
    return true;
  });
}
function renderTasksBody() {
  const body = $("tasksBody");
  const items = filteredItems();
  if (!items.length) { body.innerHTML = '<p class="muted">暂无任务</p>'; return; }
  if (taskState.mode === "kanban") {
    body.innerHTML = `<div class="board">${kanbanCols(items)}</div>`;
    wireKanbanDnd();
  } else {
    body.innerHTML = items.map(taskRowHtml).join("");
    body.querySelectorAll(".task").forEach((el) =>
      el.querySelector(".checkbox")?.addEventListener("change", (e) => toggleComplete(e.target.dataset.id, e.target.checked))
    );
  }
}
function taskRowHtml(t) {
  const done = t.status === "completed";
  const tags = (t.tags || []).map((x) => `<span class="tag">#${escapeHtml(x)}</span>`).join("");
  const extra = [];
  if (t.dueDate) extra.push("截止 " + escapeHtml(t.dueDate));
  if (t.estimatedDurationMinutes) extra.push("约 " + t.estimatedDurationMinutes + " 分");
  const prioCls = t.priority === "high" ? "high" : t.priority === "medium" ? "medium" : "";
  return `<div class="task ${done ? "done" : ""}" onclick="openDetail('${t.id}')">
    <input type="checkbox" class="checkbox" data-id="${t.id}" ${done ? "checked" : ""} onclick="event.stopPropagation()">
    <div class="meta">
      <span class="title">${escapeHtml(t.title)}</span>
      <div class="sub">
        <span class="pill ${prioCls}">${t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低"}</span>
        ${extra.map((e) => `<span class="muted">${escapeHtml(e)}</span>`).join("")} ${tags}
      </div>
    </div>
  </div>`;
}
async function toggleComplete(id, checked) {
  try {
    if (checked) await api("/api/tasks/" + id + "/complete", { method: "POST" });
    else await api("/api/tasks/" + id, { method: "PATCH", body: JSON.stringify({ status: "pending" }) });
    toast(checked ? "已完成 ✅" : "已重新打开", "ok");
    loadTasksView(); if (!$("dashboard").classList.contains("hidden")) loadDashboard();
  } catch (e) { toast(e.message, "err"); loadTasksView(); }
}
// 工具栏交互
$("search").oninput = (e) => { taskState.search = e.target.value; renderTasksBody(); };
$("fPriority").onchange = (e) => { taskState.priority = e.target.value; renderTasksBody(); };
$("fTag").onchange = (e) => { taskState.tag = e.target.value; renderTasksBody(); };
document.querySelectorAll("#tasksView [data-v]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("#tasksView [data-v]").forEach((x) => x.classList.remove("active"));
  b.classList.add("active"); taskState.baseView = b.dataset.v; loadTasksView();
}));
document.querySelectorAll("#tasksMode [data-mode]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("#tasksMode [data-mode]").forEach((x) => x.classList.remove("active"));
  b.classList.add("active"); taskState.mode = b.dataset.mode; renderTasksBody();
}));
async function refreshTagOptions() {
  const all = new Set();
  taskState.items.forEach((t) => (t.tags || []).forEach((x) => all.add(x)));
  const sel = $("fTag");
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部标签</option>' + [...all].map((x) => `<option value="${escapeHtml(x)}">#${escapeHtml(x)}</option>`).join("");
  sel.value = cur;
}

// ---------- 看板（规范 §2/§4 拖拽排序→状态变更） ----------
function kanbanCols(items) {
  const pending = items.filter((t) => t.status !== "completed");
  const done = items.filter((t) => t.status === "completed");
  const col = (title, arr) => `<div class="col" data-status="${title === "已完成" ? "completed" : "pending"}">
    <h3>${title}<span class="count">${arr.length}</span></h3>
    ${arr.map((t) => `<div class="kanban-card" draggable="true" data-id="${t.id}">
        <div style="font-weight:600">${escapeHtml(t.title)}</div>
        <div class="sub">${t.priority === "high" ? '<span class="pill high">高</span>' : t.priority === "medium" ? '<span class="pill medium">中</span>' : ""}
        ${t.dueDate ? `<span class="muted">${escapeHtml(t.dueDate)}</span>` : ""}</div>
      </div>`).join("")}</div>`;
  return col("待办", pending) + col("已完成", done);
}
async function loadKanban() {
  const board = $("board");
  board.innerHTML = '<p class="muted">加载中…</p>';
  try {
    // 后端无“全部 pending”视图，合并 overdue/today/week/unscheduled 得到完整待办集
    const [o, t, w, u, d] = await Promise.all([
      api("/api/tasks?view=overdue"), api("/api/tasks?view=today"),
      api("/api/tasks?view=week"), api("/api/tasks?view=unscheduled"),
      api("/api/tasks?view=completed"),
    ]);
    const pending = [...o.data.items, ...t.data.items, ...w.data.items, ...u.data.items]
      .filter((x) => x.status === "pending");
    const seen = new Set(); const uniq = pending.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
    const items = [...uniq, ...d.data.items];
    board.innerHTML = `<div class="board">${kanbanCols(items)}</div>`;
    wireKanbanDnd();
  } catch (e) { board.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}
function wireKanbanDnd() {
  let dragId = null;
  document.querySelectorAll("#board .kanban-card").forEach((c) => {
    c.addEventListener("dragstart", () => { dragId = c.dataset.id; c.classList.add("dragging"); });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
  });
  document.querySelectorAll("#board .col").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("drag-over");
      const status = col.dataset.status;
      if (!dragId) return;
      try { await api("/api/tasks/" + dragId, { method: "PATCH", body: JSON.stringify({ status }) }); toast("已更新状态", "ok"); loadKanban(); }
      catch (err) { toast(err.message, "err"); }
      dragId = null;
    });
  });
}

// ---------- 日历（规范 §2 Calendar） ----------
async function loadCalendarTasks() {
  // 聚合多视图以填充月内任务（后端无“全部”视图，故合并 overdue/today/week/completed）
  const [o, t, w, c] = await Promise.all([
    api("/api/tasks?view=overdue"), api("/api/tasks?view=today"),
    api("/api/tasks?view=week"), api("/api/tasks?view=completed"),
  ]);
  const map = {};
  [...o.data.items, ...t.data.items, ...w.data.items, ...c.data.items].forEach((it) => {
    if (it.dueDate) (map[it.dueDate] = map[it.dueDate] || []).push(it);
  });
  return map;
}
let calMap = {};
async function renderCalendar() {
  const grid = $("calGrid");
  calMap = await loadCalendarTasks();
  const first = new Date(calYear, calMonth, 1);
  const startDow = first.getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  $("calLabel").textContent = `${calYear} 年 ${calMonth + 1} 月`;
  let cells = "";
  ["日", "一", "二", "三", "四", "五", "六"].forEach((d) => (cells += `<div class="cal-dow">${d}</div>`));
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell muted"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const arr = calMap[ds] || [];
    const dots = arr.slice(0, 4).map((t) => `<span class="cal-dot ${t.status === "completed" ? "done" : t.dueDate < todayStr ? "over" : ""}"></span>`).join("");
    cells += `<div class="cal-cell ${ds === todayStr ? "today" : ""}" data-date="${ds}">
      <strong>${d}</strong><div>${dots}</div></div>`;
  }
  grid.innerHTML = cells;
  grid.querySelectorAll(".cal-cell[data-date]").forEach((c) => (c.onclick = () => showCalDay(c.dataset.date)));
}
$("calPrev").onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); };
$("calNext").onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); };
function showCalDay(ds) {
  const arr = calMap[ds] || [];
  $("calDayTitle").textContent = `当日任务 · ${ds}`;
  $("calDayTasks").innerHTML = arr.length
    ? arr.map((t) => `<div class="task ${t.status === "completed" ? "done" : ""}" onclick="openDetail('${t.id}')">
        <span class="pill ${t.priority === "high" ? "high" : t.priority === "medium" ? "medium" : ""}">${t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低"}</span>
        <span class="title">${escapeHtml(t.title)}</span></div>`).join("")
    : '<p class="muted">当天没有任务。</p>';
}

// ---------- 统计（规范 §1/§2/§6 自动刷新） ----------
async function loadStats() {
  try {
    const { data: s } = await api("/api/statistics");
    $("statKpi").innerHTML = [
      ["总任务", s.total], ["进行中", s.pending], ["已完成", s.completed], ["逾期", s.overdue], ["高优先级", s.highPriority],
    ].map(([l, n]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
    const maxS = Math.max(1, s.byStatus.pending, s.byStatus.completed);
    $("statStatus").innerHTML = [
      ["待办", s.byStatus.pending, s.byStatus.pending / maxS * 100, ""],
      ["已完成", s.byStatus.completed, s.byStatus.completed / maxS * 100, ""],
    ].map(([l, n, p]) => `<div class="bar-row"><span>${l}</span><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div><span>${n}</span></div>`).join("");
    const maxP = Math.max(1, s.byPriority.high, s.byPriority.medium, s.byPriority.low);
    $("statPriority").innerHTML = [
      ["高", s.byPriority.high, s.byPriority.high / maxP * 100, "high"],
      ["中", s.byPriority.medium, s.byPriority.medium / maxP * 100, "medium"],
      ["低", s.byPriority.low, s.byPriority.low / maxP * 100, "low"],
    ].map(([l, n, p, c]) => `<div class="bar-row"><span>${l}</span><div class="bar-track"><div class="bar-fill ${c}" style="width:${p}%"></div></div><span>${n}</span></div>`).join("");
  } catch (e) { toast(e.message, "err"); }
}
$("statRefresh").onclick = loadStats;

// ---------- 任务详情 Drawer（规范 §3/§5） ----------
function openDetail(id) {
  api("/api/tasks/" + id).then(({ data: t }) => {
    currentDetail = t;
    $("detailBody").innerHTML = `
      <div style="margin-bottom:10px"><label class="muted">标题</label><input id="dTitle" value="${escapeHtml(t.title)}"></div>
      <div style="margin-bottom:10px"><label class="muted">描述</label><textarea id="dDesc" rows="3" style="width:100%">${escapeHtml(t.description || "")}</textarea></div>
      <div class="toolbar" style="margin-bottom:10px">
        <div style="flex:1"><label class="muted">优先级</label><select id="dPriority" style="width:100%">
          <option value="high" ${t.priority === "high" ? "selected" : ""}>高</option>
          <option value="medium" ${t.priority === "medium" ? "selected" : ""}>中</option>
          <option value="low" ${t.priority === "low" ? "selected" : ""}>低</option></select></div>
        <div style="flex:1"><label class="muted">状态</label><select id="dStatus" style="width:100%">
          <option value="pending" ${t.status === "pending" ? "selected" : ""}>进行中</option>
          <option value="completed" ${t.status === "completed" ? "selected" : ""}>已完成</option></select></div>
      </div>
      <div class="toolbar" style="margin-bottom:10px">
        <div style="flex:1"><label class="muted">截止日期</label><input id="dDue" type="date" value="${t.dueDate || ""}" style="width:100%"></div>
        <div style="flex:1"><label class="muted">预计时长(分)</label><input id="dDur" type="number" min="0" value="${t.estimatedDurationMinutes || ""}" style="width:100%"></div>
      </div>
      <div><label class="muted">标签（逗号分隔）</label><input id="dTags" value="${(t.tags || []).map(escapeHtml).join(", ")}" style="width:100%"></div>`;
    $("detail").classList.add("open"); $("drawerBackdrop").classList.add("open");
  }).catch((e) => toast(e.message, "err"));
}
function closeDetail() { $("detail").classList.remove("open"); $("drawerBackdrop").classList.remove("open"); currentDetail = null; }
$("detailClose").onclick = closeDetail;
$("drawerBackdrop").onclick = closeDetail;
$("detailSave").onclick = async () => {
  if (!currentDetail) return;
  const tags = $("dTags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  try {
    await api("/api/tasks/" + currentDetail.id, { method: "PATCH", body: JSON.stringify({
      title: $("dTitle").value.trim(), description: $("dDesc").value,
      priority: $("dPriority").value, status: $("dStatus").value,
      dueDate: $("dDue").value || undefined,
      estimatedDurationMinutes: $("dDur").value ? Number($("dDur").value) : undefined, tags,
    }) });
    toast("已保存", "ok"); closeDetail(); refreshCurrent();
  } catch (e) { toast(e.message, "err"); }
};
$("detailDelete").onclick = async () => {
  if (!currentDetail) return;
  if (!confirm("确认删除该任务？")) return;
  try { await api("/api/tasks/" + currentDetail.id, { method: "DELETE" }); toast("已删除", "ok"); closeDetail(); refreshCurrent(); }
  catch (e) { toast(e.message, "err"); }
};
function refreshCurrent() {
  const v = document.querySelector("[data-view].active")?.dataset.view;
  if (v === "dashboard") loadDashboard();
  else if (v === "today" || v === "upcoming") loadTasksView();
  else if (v === "kanban") loadKanban();
  else if (v === "calendar") renderCalendar();
  else if (v === "statistics") loadStats();
}

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
    const src = r.source === "ai" ? '<span class="badge ai">AI 增强</span>' : '<span class="badge">规则引擎</span>';
    box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px">
        <strong>${type === "morning" ? "早报" : type === "evening" ? "晚报" : "周报"} · ${r.reviewDate}</strong>${src}</div>
      <pre class="review" style="white-space:pre-wrap;word-break:break-word;background:var(--card-2);border-radius:10px;padding:12px;max-height:360px;overflow:auto;margin:0">${escapeHtml(r.content)}</pre>`;
  } catch (e) { $("reviewBox").innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}
document.querySelectorAll("[data-rtype]").forEach((b) => (b.onclick = () => loadReview(b.dataset.rtype)));
$("regenBtn").onclick = async () => {
  try { await api("/api/reviews/generate", { method: "POST", body: JSON.stringify({ type: currentType }) }); await loadReview(currentType); toast("已重新生成", "ok"); }
  catch (e) { toast(e.message, "err"); }
};

// ---------- 设置 ----------
async function loadStatus() {
  try {
    const { data } = await api("/api/settings/status");
    $("statusLine").textContent = `AI：${data.aiStatus} ｜ 今日手动生成：${data.manualGenerationsToday} ｜ 推送通知：${data.notify}`;
  } catch {}
  loadBotConfig();
  loadPushTasks();
}
$("testPushBtn").onclick = async () => {
  $("pushMsg").textContent = "发送中…";
  try { await api("/api/settings/test-push", { method: "POST" }); $("pushMsg").textContent = "已发送 ✅"; toast("测试推送已发送", "ok"); }
  catch (e) { $("pushMsg").textContent = e.message; toast(e.message, "err"); }
};
$("chgPwdBtn").onclick = async () => {
  try {
    await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: $("curPwd").value, newPassword: $("newPwd").value }) });
    $("curPwd").value = ""; $("newPwd").value = ""; toast("密码已更新，请重新登录", "ok"); await loadMe();
  } catch (e) { toast(e.message, "err"); }
};

// ---------- 通知推送：机器人通道 + 定时任务（规范 §推送任务系统） ----------
async function loadBotConfig() {
  try {
    const { data } = await api("/api/bot-config");
    $("botWebhook").value = data.webhookUrl || "";
    if (data.provider) $("botProvider").value = data.provider === "clawbot" ? "clawbot" : data.provider;
    const badge = $("botStatus");
    if (data.status === "configured") {
      badge.textContent = "已配置" + (data.managed ? "（界面托管）" : "（环境变量）");
      badge.className = "badge ai";
    } else {
      badge.textContent = "未配置";
      badge.className = "badge";
    }
  } catch {}
}
$("saveBotBtn").onclick = async () => {
  try {
    await api("/api/bot-config", { method: "PUT", body: JSON.stringify({ webhookUrl: $("botWebhook").value.trim(), provider: $("botProvider").value }) });
    toast("推送通道已保存", "ok");
    await loadBotConfig();
  } catch (e) { toast(e.message, "err"); }
};

function taskStatusBadge(s) {
  if (s === "success") return '<span class="badge ai">成功</span>';
  if (s === "failed") return '<span class="badge" style="color:var(--danger);border-color:rgba(248,113,113,.4)">失败</span>';
  return '<span class="badge">未运行</span>';
}
function pushTaskRowHtml(t) {
  const next = t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—";
  return `<div class="task" style="cursor:default">
    <input type="checkbox" class="checkbox" data-toggle="${t.id}" ${t.enabled ? "checked" : ""} style="width:auto;min-height:auto" title="启用/停用" />
    <div class="meta">
      <div class="title">${escapeHtml(t.name)}</div>
      <div class="sub">
        <span class="tag" style="font-family:monospace">${escapeHtml(t.scheduleCron)}</span>
        ${taskStatusBadge(t.lastStatus)}
        <span class="muted">下次：${escapeHtml(next)}</span>
      </div>
    </div>
    <button class="btn ghost sm" data-edit="${t.id}">编辑</button>
    <button class="btn ghost sm danger" data-del="${t.id}">删除</button>
  </div>`;
}
async function loadPushTasks() {
  try {
    const { data } = await api("/api/push-tasks");
    const box = $("taskList");
    if (!data.items.length) { box.innerHTML = '<p class="muted">暂无定时推送任务。</p>'; return; }
    box.innerHTML = data.items.map(pushTaskRowHtml).join("");
    box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editTask(b.dataset.edit)));
    box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => delTask(b.dataset.del)));
    box.querySelectorAll("[data-toggle]").forEach((c) => (c.onchange = () => toggleTask(c.dataset.toggle, c.checked)));
  } catch (e) {
    $("taskList").innerHTML = '<p style="color:var(--danger)">加载失败：' + escapeHtml(e.message) + "</p>";
  }
}
function resetTaskForm() {
  $("ptId").value = ""; $("ptName").value = ""; $("ptCron").value = ""; $("ptTemplate").value = "";
  $("ptEnabled").checked = true; $("ptMsg").textContent = "";
}
$("saveTaskBtn").onclick = async () => {
  const id = $("ptId").value;
  const body = { name: $("ptName").value.trim(), scheduleCron: $("ptCron").value.trim(), template: $("ptTemplate").value, enabled: $("ptEnabled").checked };
  if (!body.name || !body.scheduleCron) { $("ptMsg").textContent = "名称和 cron 必填"; return; }
  try {
    if (id) await api("/api/push-tasks/" + id, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/push-tasks", { method: "POST", body: JSON.stringify(body) });
    toast(id ? "任务已更新" : "任务已创建", "ok");
    resetTaskForm();
    await loadPushTasks();
  } catch (e) { $("ptMsg").textContent = e.message; toast(e.message, "err"); }
};
$("cancelTaskBtn").onclick = () => resetTaskForm();
$("refreshTasksBtn").onclick = () => loadPushTasks();
async function editTask(id) {
  try {
    const { data } = await api("/api/push-tasks/" + id);
    const t = data.item;
    $("ptId").value = t.id; $("ptName").value = t.name; $("ptCron").value = t.scheduleCron;
    $("ptTemplate").value = t.template || ""; $("ptEnabled").checked = t.enabled;
    $("ptMsg").textContent = "编辑中…";
    $("ptName").focus();
    $("settings").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { toast(e.message, "err"); }
}
async function delTask(id) {
  if (!confirm("确定删除该定时推送任务？")) return;
  try { await api("/api/push-tasks/" + id, { method: "DELETE" }); toast("已删除", "ok"); await loadPushTasks(); }
  catch (e) { toast(e.message, "err"); }
}
async function toggleTask(id, enabled) {
  try { await api("/api/push-tasks/" + id, { method: "PUT", body: JSON.stringify({ enabled }) }); await loadPushTasks(); }
  catch (e) { toast(e.message, "err"); await loadPushTasks(); }
}

// ---------- 登录/退出 ----------
$("loginBtn").onclick = async () => {
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("username").value, password: $("password").value }) });
    $("password").value = ""; await loadMe();
  } catch (e) { toast(e.message, "err"); }
};
$("logoutBtn").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); localStorage.removeItem("theme"); showView("dashboard"); loadMe(); };

initTheme();
loadMe();
