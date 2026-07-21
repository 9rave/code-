// 自然语言任务解析（参考 AlarmRobot 的「一句家常话」理念：把口语化的提醒描述，
// 直接解析成结构化任务，免去繁琐的表单填写）。
// 设计原则：
//   1. 确定性、零外部依赖（不调用 LLM，离线可用、毫秒级、无 token 成本）；
//   2. 中文优先，兼容半角数字/时间；
//   3. 只提取「时间 / 优先级 / 周期 / 标签」等结构化信号，标题保留原意；
//   4. 解析失败（抽不出标题）时仍返回原文，由调用方兜底。
// 与开发指南 §7.2 的密码哈希无关，本模块纯属输入层增强。

export type Priority = "low" | "medium" | "high";
export type Recurrence = "daily" | "weekly" | "monthly" | "hourly";

export interface ParsedTask {
  title: string;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM（24h）
  priority: Priority;
  recurrence: Recurrence | null;
  tags: string[];
  confident: boolean; // 是否至少识别到时间/周期/优先级，或标题非空
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 七: 0,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "0": 0, "7": 0,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
};

// 业务日期（北京时区），与 utils/time.businessDate 保持一致
function businessDate(now: Date = new Date(), tz = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalize(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角→半角
    .replace(/[：:]/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- 优先级 ----------
function parsePriority(text: string): { priority: Priority; rest: string } {
  let priority: Priority = "medium";
  let rest = text;
  const high = /(紧急|加急|高优先级|高优|很急|非常急|urgent|asap)/i;
  const low = /(不急|低优先级|低优|不太急|轻松|不着急)/i;
  if (high.test(rest)) {
    priority = "high";
    rest = rest.replace(high, " ");
  } else if (low.test(rest)) {
    priority = "low";
    rest = rest.replace(low, " ");
  }
  return { priority, rest };
}

// ---------- 周期 ----------
function parseRecurrence(text: string): { recurrence: Recurrence | null; rest: string } {
  let recurrence: Recurrence | null = null;
  let rest = text;
  const rules: [RegExp, Recurrence][] = [
    [/(每\s*小时|每个小时|每小时钟|hourly)/i, "hourly"],
    [/(每\s*天|每一天|天天|每日|每天都?|dayly)/i, "daily"],
    [/(每\s*周|每星期|每个星期|每週|weekly)/i, "weekly"],
    [/(每\s*月|每个月|每個月|monthly)/i, "monthly"],
  ];
  for (const [re, val] of rules) {
    if (re.test(rest)) {
      recurrence = val;
      rest = rest.replace(re, " ");
      break;
    }
  }
  return { recurrence, rest };
}

// ---------- 日期 ----------
function parseDate(text: string, base: string): { dueDate: string | null; rest: string } {
  let dueDate: string | null = null;
  let rest = text;

  // 相对日
  const rel: [RegExp, number][] = [
    [/(今天|今日|今儿|当天)/, 0],
    [/(明天|明日|明儿)/, 1],
    [/(后天)/, 2],
    [/(大后天)/, 3],
    [/(大大后天)/, 4],
  ];
  for (const [re, n] of rel) {
    if (re.test(rest)) {
      dueDate = addDays(base, n);
      rest = rest.replace(re, " ");
      return { dueDate, rest };
    }
  }

  // 星期（周X / 星期X / 礼拜X）+ 可选「下」
  const wd = rest.match(/(下\s*)?(?:周|星期|礼拜)\s*([一二三四五六日天七八0-9]|mon|tue|wed|thu|fri|sat|sun)/i);
  if (wd) {
    const target = WEEKDAY_MAP[wd[2].toLowerCase()];
    if (target !== undefined) {
      const todayDow = new Date(base + "T00:00:00Z").getUTCDay();
      let diff = (target - todayDow + 7) % 7;
      if (wd[1]) diff = diff === 0 ? 7 : diff + 7; // 「下周X」强制下一周
      dueDate = addDays(base, diff);
      rest = rest.replace(wd[0], " ");
      return { dueDate, rest };
    }
  }

  // 绝对：YYYY-MM-DD / YYYY/MM/DD / YYYY年MM月DD日
  const abs = rest.match(/(\d{4})\s*[-/年.\s]\s*(\d{1,2})\s*[-/月.\s]\s*(\d{1,2})\s*日?/);
  if (abs) {
    const y = +abs[1], m = String(abs[2]).padStart(2, "0"), d = String(abs[3]).padStart(2, "0");
    dueDate = `${y}-${m}-${d}`;
    rest = rest.replace(abs[0], " ");
    return { dueDate, rest };
  }

  // 相对月日：M月D日 / M/D
  const md = rest.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (md) {
    const m = String(md[1]).padStart(2, "0");
    const d = String(md[2]).padStart(2, "0");
    let year = new Date().getUTCFullYear();
    const candidate = `${year}-${m}-${d}`;
    if (candidate < base) year += 1; // 今年已过则顺延明年
    dueDate = `${year}-${m}-${d}`;
    rest = rest.replace(md[0], " ");
    return { dueDate, rest };
  }

  return { dueDate, rest };
}

// ---------- 时间 ----------
const PERIOD_WORD = "(凌晨|清晨|早晨|早上|上午|早|中午|正午|下午|午后|晚上|傍晚|夜里|夜晚|夜)";

function applyPeriod(h: number, word?: string): number {
  if (!word) return h;
  if (/(凌晨|清晨|早晨|早上|上午|早)/.test(word)) return h === 12 ? 0 : h;
  if (/(中午|正午)/.test(word)) return 12;
  if (/(下午|午后|晚上|傍晚|夜里|夜晚|夜)/.test(word)) return h < 12 ? h + 12 : h;
  return h;
}

function parseTime(text: string): { dueTime: string | null; rest: string } {
  let rest = text;
  let dueTime: string | null = null;

  // 显式 HH:MM / HH.MM（可带时段词前缀）
  let m = rest.match(new RegExp(`${PERIOD_WORD}?\\s*(\\d{1,2})\\s*[:：.]\\s*(\\d{2})`));
  if (m) {
    let h = applyPeriod(+m[2], m[1]);
    dueTime = `${String(h).padStart(2, "0")}:${String(+m[3]).padStart(2, "0")}`;
    rest = rest.replace(m[0], " ");
    return { dueTime, rest };
  }

  // 中文「X点[半/XX分]」（可带时段词前缀）
  m = rest.match(new RegExp(`${PERIOD_WORD}?\\s*(\\d{1,2})\\s*(?:点|點|时|時|点钟)\\s*(半|(\\d{1,2})\\s*分?)?`));
  if (m) {
    let h = applyPeriod(+m[2], m[1]);
    let min = 0;
    if (m[3] === "半") min = 30;
    else if (m[4]) min = +m[4];
    dueTime = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    rest = rest.replace(m[0], " ");
    return { dueTime, rest };
  }

  // 英文 a.m./p.m.
  m = rest.match(new RegExp(`${PERIOD_WORD}?\\s*(\\d{1,2})(?:\\s*[:：]\\s*(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)`, "i"));
  if (m) {
    let h = +m[2];
    const min = m[3] ? +m[3] : 0;
    const isPm = /p/i.test(m[4]);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    dueTime = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    rest = rest.replace(m[0], " ");
    return { dueTime, rest };
  }

  return { dueTime, rest };
}

// ---------- 标签（关键词派生，保留标题原词） ----------
const TAG_RULES: [RegExp, string][] = [
  [/(会议|开会|例会|周会|晨会|站会)/, "会议"],
  [/(电话|致电|call|联络)/i, "电话"],
  [/(邮件|email|回信|回邮)/i, "邮件"],
  [/(工作|项目|加班|出差|述职)/, "工作"],
  [/(学习|看书|课程|上课|作业|复习|考试)/, "学习"],
  [/(健身|运动|跑步|锻炼|瑜伽|打球|游泳)/, "运动"],
  [/(看病|医院|体检|预约|挂号|牙医)/, "健康"],
  [/(购物|买东西|买菜|超市)/, "购物"],
  [/(家务|清洁|打扫|生活)/, "生活"],
  [/(旅行|旅游|出游)/, "出行"],
  [/(生日|聚会|朋友|社交|饭局|聚餐)/, "社交"],
  [/(缴费|账单|报销|财务)/, "财务"],
  [/(缴费|还信用卡|还贷)/, "财务"],
];
function parseTags(text: string): string[] {
  const tags: string[] = [];
  for (const [re, tag] of TAG_RULES) {
    if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

// ---------- 标题清洗（去除命令前缀/语气词，保留实义） ----------
function cleanTitle(text: string): string {
  // 先折叠/裁剪空白，避免前序解析残留的空格挡住 ^ 前缀匹配（例如「下午3点」被替换为空格后留下「 提醒我开会」）
  let t = text.replace(/\s+/g, " ").trim();
  // 前缀命令词
  t = t.replace(/^(请|帮我|让我|我要|我想|记得|记住|别忘了|别忘|提醒我|通知我|定时|预约|安排|计划|搞|弄|需要|得|要)\s*/i, "");
  // 后缀语气词（注意：保留「一下」等可能具实义的口语词）
  t = t.replace(/(哦|呗|吧|哈|呀|啊|呢|嘛|咯|提醒|remind|notify)\s*$/i, "");
  // 残留的「的」在句首/句尾去掉
  t = t.replace(/^的\s*/, "").replace(/\s*的$/, "");
  t = t.replace(/\s+/g, " ").trim();
  // 去掉孤立标点
  t = t.replace(/^[，,。.、：:；;]+/, "").replace(/[，,。.、：:；;]+$/, "");
  return t;
}

export function parseTaskText(input: string, now: Date = new Date()): ParsedTask {
  const base = businessDate(now);
  let s = normalize(input || "");

  const { priority, rest: r1 } = parsePriority(s);
  const { recurrence, rest: r2 } = parseRecurrence(r1);
  const { dueDate, rest: r3 } = parseDate(r2, base);
  const { dueTime, rest: r4 } = parseTime(r3);
  const tags = parseTags(r4);
  let title = cleanTitle(r4);

  // 兜底：清洗后为空，且原文有内容 → 退回原文（去掉明显命令词）
  if (!title && input && input.trim()) {
    title = input.trim().replace(/^(请|帮我|提醒我|通知我|记得|定时)\s*/i, "");
  }
  // 再兜底
  if (!title) title = "提醒事项";

  const confident =
    !!title && (title !== "提醒事项" || !!dueDate || !!dueTime || !!recurrence || priority !== "medium");

  return { title, dueDate, dueTime, priority, recurrence, tags, confident };
}
