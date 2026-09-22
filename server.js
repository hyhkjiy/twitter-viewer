#!/usr/bin/env node
/**
 * Field Theory 书签可视化服务（零依赖）
 * - 静态托管 public/ 页面
 * - GET  /api/bookmarks  读取 bookmarks.jsonl，合并分类/领域（多标签数组）与媒体信息
 * - GET  /api/config     读取可自定义的分类/领域定义与并发/阈值配置
 * - POST /api/config     保存配置（分类/领域增删改、并发数、多标签阈值）
 * - GET  /api/status     分类进度与任务状态
 * - POST /api/classify   用本地 jev 路由服务对书签多标签分类（后台任务，增量落盘）
 * - POST /api/labels     手动设置某条书签的分类/领域标签
 * - GET  /api/commands   可用命令工具列表（ft CLI 白名单）
 * - POST /api/tasks      入队一个命令任务（串行队列执行，输出增量保留）
 * - GET  /api/tasks      任务列表摘要
 * - GET  /api/tasks/<id> 任务详情 + since 之后的增量输出
 * - POST /api/tasks/<id>/cancel  取消排队中/运行中的任务
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const FT_DIR = process.env.FT_DIR || path.join(os.homedir(), '.fieldtheory');
const BOOKMARKS_FILE = process.env.BOOKMARKS_FILE || path.join(FT_DIR, 'bookmarks', 'bookmarks.jsonl');
const FT_BIN = process.env.FT_BIN || 'ft';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CATEGORY_FILE = process.env.CATEGORY_FILE || path.join(DATA_DIR, 'categories-jev.json');
const DOMAIN_FILE = process.env.DOMAIN_FILE || path.join(DATA_DIR, 'domains-jev.json');
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(DATA_DIR, 'viz-config.json');
const JEV_URL = process.env.JEV_URL || 'http://127.0.0.1:8000/score';
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEFAULT_CONFIG = {
  concurrency: 3,     // 分类并发数（>=1）
  threshold: 0.15,    // 多标签概率阈值：概率 >= 阈值才作为附加标签
  maxLabels: 3,       // 每条书签最多标签数
  categories: [
    { id: 'tool', label: '工具', description: '可直接使用或安装的软件作品：GitHub 仓库、CLI 工具、npm/pip 包、开源项目、SDK。典型信号：链接指向 github.com、『我开源了 X』『做了个工具』。不是：教怎么写的教程（→技巧）、上线公告（→发布）。' },
    { id: 'security', label: '安全', description: '安全相关内容：CVE 漏洞、漏洞利用与攻击手法、供应链安全、数据隐私泄露、安全工具与研究。' },
    { id: 'technique', label: '技巧', description: '教怎么做的方法类内容：教程、演示、代码片段、实现思路、工程复盘、『如何搭建 X』。典型信号：step-by-step、guide、tutorial、讲方法的 thread。不是：直接分享一个现成工具（→工具）、上线公告（→发布）。' },
    { id: 'launch', label: '发布', description: '产品/版本的发布与公告：上线、v2.0、『just shipped』、新功能宣布、里程碑、发布会。典型信号：announcement、launch、『今天上线』。不是：工具本身的介绍（→工具）。' },
    { id: 'research', label: '研究', description: '学术研究内容：arXiv 论文、论文解读、实验与评测结果、学术讨论。典型信号：链接指向 arxiv.org、paper、论文。' },
    { id: 'opinion', label: '观点', description: '作者的个人看法与评论：判断、预测、争论、点评模型/公司/行业、经验与反思。典型信号：『我认为』『说实话』『这很糟糕』『我赌』。不是：分享链接或工具（→工具）、教程（→技巧）、上线公告（→发布）。' },
    { id: 'commerce', label: '商业', description: '消费与商业内容：实物商品、硬件产品、购物优惠、商业模式、融资与公司动态。不是：软件工具（→工具）、软件发布（→发布）。' },
  ],
  domains: [
    { id: 'llm', label: '大模型', description: '大模型 / LLM 技术：模型发布与权重、训练、微调、推理、提示词工程、多模态、上下文工程。典型信号：GPT、Claude、DeepSeek、Qwen、训练、微调、token。' },
    { id: 'agent', label: 'Agent', description: 'AI Agent：智能体框架、多智能体协作、浏览器代理、任务自动化、工具调用与编排。典型信号：agent、browser use、MCP。不是：模型本身（→大模型）。' },
    { id: 'rag', label: 'RAG/知识库', description: 'RAG / 知识库：检索增强、向量库、文档问答、知识管理、embedding。典型信号：RAG、向量、embedding、知识库。' },
    { id: 'ai-coding', label: 'AI 编程', description: 'AI 编程：AI 编程助手、代码生成、代码审查、IDE 插件。典型信号：Claude Code、Cursor、Copilot、补全、code review。' },
    { id: 'ai-tools', label: 'AI 工具', description: '面向用户的 AI 应用产品：AI 网站/镜像站、效率工具、可打开即用的 AI 应用体验。不是：编程类（→AI 编程）、模型技术（→大模型）。' },
    { id: 'frontend', label: '前端', description: '前端 / Web：框架、UI、浏览器、JavaScript/TypeScript、样式与交互。' },
    { id: 'backend', label: '后端', description: '后端 / 服务端：API、数据库、中间件、语言实现、服务端架构。' },
    { id: 'devops', label: '运维/云原生', description: '运维 / 云原生：K8s、部署、CI/CD、基础设施、可观测性、DevOps。' },
    { id: 'security', label: '安全', description: '安全：漏洞、攻防、数据隐私、供应链安全、安全工具。' },
    { id: 'web3', label: 'Web3', description: 'Web3 / 区块链 / 加密货币：链、Token、DeFi、智能合约、NFT。' },
    { id: 'hardware', label: '硬件/机器人', description: '硬件 / 机器人 / 嵌入式：开源硬件、PCB、机械、机器人、嵌入式开发。' },
    { id: 'paper', label: '论文', description: '论文 / 学术：arXiv 论文、论文解读、学术讨论、研究结果。典型信号：arxiv.org、paper。注：以大模型为主体的论文归大模型。' },
    { id: 'career', label: '职业/副业', description: '个人职业与副业：求职、简历、面试、职业成长、副业赚钱、个人效率、学习方法、创业。典型信号：『怎么找工作』『副业』『涨薪』『效率』『方法论』。不是：技术内容本身（→对应技术领域）。' },
    { id: 'other', label: '其他', description: '其他：无法归入以上任何领域的内容（生活、新闻、杂谈等）。仅当其他 13 个领域都不匹配时选择。' },
  ],
};

// ---------- 命令工具（ft CLI 白名单） ----------
const COMMANDS = [
  { name: 'sync', label: '同步书签', cli: ['sync'], desc: 'ft sync：从 X 拉取最新书签与媒体，耗时较长' },
  { name: 'sync-no-media', label: '同步书签（跳过媒体）', cli: ['sync', '--no-media'], desc: 'ft sync --no-media：只同步书签，不下载媒体' },
  { name: 'fetch-media', label: '补下媒体', cli: ['fetch-media'], desc: 'ft fetch-media：为已有书签补下缺失媒体' },
  { name: 'md', label: '导出 Markdown', cli: ['md'], desc: 'ft md：把书签导出为 markdown 文件' },
  { name: 'wiki', label: '构建知识库', cli: ['wiki'], desc: 'ft wiki：编译 Karpathy 风格互联知识库（需 claude/codex）' },
  { name: 'lint', label: '知识库体检', cli: ['lint'], desc: 'ft lint：检查知识库断链与缺失页面' },
  { name: 'stats', label: '统计概览', cli: ['stats'], desc: 'ft stats：Top 作者 / 语言 / 日期范围' },
  { name: 'index', label: '重建搜索索引', cli: ['index'], desc: 'ft index：从 JSONL 缓存重建 SQLite 搜索索引' },
  { name: 'status', label: '同步状态', cli: ['status'], desc: 'ft status：查看同步/分类状态与数据位置' },
  { name: 'categories', label: '分类分布', cli: ['categories'], desc: 'ft categories：分类分布统计' },
  { name: 'domains', label: '领域分布', cli: ['domains'], desc: 'ft domains：领域分布统计' },
  { name: 'path', label: '数据目录', cli: ['path'], desc: 'ft path：打印数据目录路径' },
];

// ---------- 任务队列（串行执行 ft 命令，输出增量保留） ----------
let tasks = [];      // 最近 50 个任务（内存态，服务重启即清空）
let taskSeq = 0;
let queueBusy = false;
const MAX_TASKS = 50;
const MAX_OUT = 400; // 每个任务最多保留的输出行数

function taskSummary(t) {
  return { id: t.id, name: t.name, status: t.status, createdAt: t.createdAt, startedAt: t.startedAt, finishedAt: t.finishedAt, exitCode: t.exitCode, outLen: t.output.length };
}

function pushOut(t, chunk) {
  const lines = String(chunk).split(/\r?\n/);
  if (t.output.length && t.output[t.output.length - 1] !== '' && lines[0] !== '') {
    t.output[t.output.length - 1] += lines.shift(); // 粘到上一行末尾
  }
  t.output.push(...lines);
  if (t.output.length > MAX_OUT) t.output.splice(0, t.output.length - MAX_OUT);
}

function pumpQueue() {
  if (queueBusy) return;
  const next = tasks.find((t) => t.status === 'queued');
  if (!next) return;
  queueBusy = true;
  next.status = 'running';
  next.startedAt = Date.now();
  const cmd = COMMANDS.find((c) => c.name === next.cmdName);
  if (!cmd) { // 白名单外命令（防御）
    next.status = 'error';
    next.exitCode = -1;
    next.finishedAt = Date.now();
    pushOut(next, '[未知命令，已跳过]');
    queueBusy = false;
    pumpQueue();
    return;
  }
  pushOut(next, `$ ft ${cmd.cli.join(' ')}\n`);
  const proc = spawn(FT_BIN, cmd.cli, { env: process.env });
  next.proc = proc;
  proc.stdout.on('data', (d) => pushOut(next, d));
  proc.stderr.on('data', (d) => pushOut(next, d));
  let closed = false;
  function finish(code, signal) {
    if (closed) return;
    closed = true;
    next.proc = null;
    next.exitCode = code;
    next.status = code === 0 ? 'done' : (signal || code === null ? 'cancelled' : 'error');
    if (next.status === 'error' || next.status === 'cancelled') pushOut(next, `[退出码 ${code ?? signal ?? '?'}]`);
    next.finishedAt = Date.now();
    queueBusy = false;
    pumpQueue();
  }
  proc.on('error', (e) => { pushOut(next, `[spawn 失败] ${e.message}`); finish(null, 'spawn-error'); });
  proc.on('close', (code, signal) => finish(code, signal));
}

function createTask(name) {
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) return null;
  const t = { id: 't' + (++taskSeq), name: cmd.label, cmdName: cmd.name, status: 'queued', output: [], createdAt: Date.now(), startedAt: null, finishedAt: null, exitCode: null, proc: null };
  tasks.push(t);
  if (tasks.length > MAX_TASKS) tasks.splice(0, tasks.length - MAX_TASKS);
  pumpQueue();
  return t;
}

function cancelTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if (t.status === 'running' && t.proc) { t.proc.kill('SIGTERM'); return t; }
  if (t.status === 'queued') {
    t.status = 'cancelled';
    t.finishedAt = Date.now();
    pushOut(t, '[已取消（尚未开始）]');
    return t;
  }
  return null;
}

// ---------- 配置 ----------
let config = { ...DEFAULT_CONFIG };
try {
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  config = {
    concurrency: typeof saved.concurrency === 'number' ? saved.concurrency : DEFAULT_CONFIG.concurrency,
    threshold: typeof saved.threshold === 'number' ? saved.threshold : DEFAULT_CONFIG.threshold,
    maxLabels: typeof saved.maxLabels === 'number' ? saved.maxLabels : DEFAULT_CONFIG.maxLabels,
    categories: Array.isArray(saved.categories) && saved.categories.length ? saved.categories : DEFAULT_CONFIG.categories,
    domains: Array.isArray(saved.domains) && saved.domains.length ? saved.domains : DEFAULT_CONFIG.domains,
  };
} catch { /* 首次运行用默认 */ }

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('保存配置失败:', e.message);
  }
}

// 应用新的定义列表（增删改），并清理被删除标签的引用
function applyDefinitions(kind, defs) {
  const oldIds = new Set(config[kind].map((d) => d.id));
  config[kind] = defs
    .map((d) => ({ id: String(d.id || ''), label: String(d.label || d.id || ''), description: String(d.description || '') }))
    .filter((d) => d.id && d.label);
  const nextIds = new Set(config[kind].map((d) => d.id));
  const removed = [...oldIds].filter((id) => !nextIds.has(id));
  if (removed.length) {
    for (const id of Object.keys(maps[kind])) {
      maps[kind][id] = (maps[kind][id] || []).filter((l) => !removed.includes(l));
    }
    saveMap(kind);
  }
}

// ---------- 数据 ----------
let cache = null; // { mtime, bookmarks: Map<id, bookmark> }
// maps: kind -> bookmarkId -> labels[]（多标签）
const maps = { category: {}, domain: {} };
let job = null;

function loadBookmarks() {
  let mtime;
  try { mtime = fs.statSync(BOOKMARKS_FILE).mtimeMs; } catch { mtime = 0; }
  if (cache && cache.mtime === mtime) return cache.bookmarks;
  const map = new Map();
  try {
    const lines = fs.readFileSync(BOOKMARKS_FILE, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const b = JSON.parse(line);
        if (b && b.id) map.set(String(b.id), b);
      } catch { /* 跳过损坏行 */ }
    }
  } catch (e) {
    console.error('读取书签失败:', e.message);
  }
  cache = { mtime, bookmarks: map };
  return map;
}

function loadMaps() {
  for (const [kind, file] of [['category', CATEGORY_FILE], ['domain', DOMAIN_FILE]]) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const m = {};
      for (const [id, v] of Object.entries(raw)) {
        m[id] = Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []);
      }
      maps[kind] = m;
    } catch {
      maps[kind] = {};
    }
  }
}

function saveMap(kind) {
  const file = kind === 'category' ? CATEGORY_FILE : DOMAIN_FILE;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(maps[kind], null, 2));
  } catch (e) {
    console.error(`保存${kind}失败:`, e.message);
  }
}

// ---------- jev 多标签分类 ----------
// 拼装打分输入：正文 + 链接域名（github.com / arxiv.org 等是强信号；作者名经实测是噪声，x.com 指原帖无信息量）
const NOISE_HOSTS = new Set(['x.com', 'twitter.com']);
function buildScoreState(bm) {
  const parts = [];
  if (bm.text) parts.push('内容：' + bm.text);
  const hosts = (bm.links || [])
    .map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } })
    .filter((h) => h && !NOISE_HOSTS.has(h));
  if (hosts.length) parts.push('链接域名：' + [...new Set(hosts)].join(', '));
  return parts.join('\n').slice(0, 3000);
}

async function scoreLabels(text, options) {
  const isDomain = options === config.domains;
  const body = JSON.stringify({
    id: 'bk-' + Math.random().toString(36).slice(2, 10),
    state: (text || '').slice(0, 3000),
    question: isDomain
      ? 'Which subject domain or domains does this bookmark belong to?'
      : 'Which category or categories best describe this bookmark?',
    options: options.map((c) => ({ id: c.id, description: c.description })),
  });
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error('jev status ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data.option_ids) || !Array.isArray(data.probabilities)) {
    throw new Error('jev 响应缺少 option_ids/probabilities');
  }
  const ranked = data.option_ids
    .map((id, i) => ({ id: String(id), p: data.probabilities[i] || 0 }))
    .sort((a, b) => b.p - a.p);
  const { threshold, maxLabels } = config;
  const labels = [];
  for (const r of ranked) {
    if (labels.length >= maxLabels) break;
    if (labels.length === 0 || r.p >= threshold) labels.push(r.id);
    else break;
  }
  return labels.length ? labels : [ranked[0].id];
}

function runJob(ids, kind) {
  const byId = loadBookmarks();
  const todo = ids.filter((id) => byId.has(id));
  const concurrency = Math.max(1, Math.floor(config.concurrency) || 1);
  job = {
    kind,
    running: true,
    total: todo.length,
    done: 0,
    errors: 0,
    current: null,
    startedAt: Date.now(),
  };
  const options = kind === 'domain' ? config.domains : config.categories;
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const id = todo[i++];
      const bm = byId.get(id);
      job.current = id;
      try {
        maps[kind][id] = await scoreLabels(buildScoreState(bm), options);
        if (job.done % 10 === 0) saveMap(kind); // 增量落盘，重启可续
      } catch (e) {
        job.errors++;
        console.error(`分类失败 ${id}:`, e.message);
      }
      job.done++;
    }
  }
  Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)).finally(() => {
    job.running = false;
    job.current = null;
    saveMap(kind);
  });
}

// 压缩媒体字段（去掉大 videoVariants，只留缩略图与跳转链接）
function compactMedia(mediaObjects) {
  if (!Array.isArray(mediaObjects)) return [];
  return mediaObjects.slice(0, 8).map((m) => ({
    type: m.type || 'photo',
    thumb: m.url || '',
    expandedUrl: m.expandedUrl || '',
  }));
}

// ---------- HTTP ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/bookmarks') {
    const byId = loadBookmarks();
    const list = [];
    for (const b of byId.values()) {
      list.push({
        id: b.id,
        url: b.url || '',
        text: b.text || '',
        authorHandle: b.authorHandle || '',
        authorName: b.authorName || '',
        language: b.language || '',
        postedAt: b.postedAt || null,
        links: Array.isArray(b.links) ? b.links.map(String) : [],
        engagement: b.engagement || {},
        media: compactMedia(b.mediaObjects),
        category: maps.category[b.id] || [],
        domain: maps.domain[b.id] || [],
      });
    }
    list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return sendJson(res, 200, { bookmarks: list });
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, config);
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = await readBody(req);
    if (typeof body.concurrency === 'number') config.concurrency = body.concurrency;
    if (typeof body.threshold === 'number') config.threshold = body.threshold;
    if (typeof body.maxLabels === 'number') config.maxLabels = body.maxLabels;
    if (Array.isArray(body.categories)) applyDefinitions('categories', body.categories);
    if (Array.isArray(body.domains)) applyDefinitions('domains', body.domains);
    saveConfig();
    return sendJson(res, 200, config);
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, {
      classified: Object.keys(maps.category).length,
      domainClassified: Object.keys(maps.domain).length,
      total: loadBookmarks().size,
      concurrency: Math.max(1, Math.floor(config.concurrency) || 1),
      job: job ? { kind: job.kind, running: job.running, total: job.total, done: job.done, errors: job.errors, current: job.current, startedAt: job.startedAt } : null,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/classify') {
    const body = await readBody(req);
    if (job && job.running) return sendJson(res, 409, { error: '分类任务已在运行' });
    const kind = body.kind === 'domain' ? 'domain' : 'category';
    const byId = loadBookmarks();
    let ids;
    if (Array.isArray(body.ids) && body.ids.length) {
      ids = body.ids.map(String);
    } else {
      ids = [];
      for (const b of byId.values()) if (!(maps[kind][b.id] || []).length) ids.push(String(b.id));
    }
    if (!ids.length) return sendJson(res, 200, { started: false, total: 0, message: '没有需要分类的书签' });
    runJob(ids, kind);
    return sendJson(res, 202, { started: true, total: ids.length, kind });
  }

  if (req.method === 'POST' && url.pathname === '/api/labels') {
    const body = await readBody(req);
    const id = String(body.id || '');
    if (!id) return sendJson(res, 400, { error: '缺少 id' });
    if (Array.isArray(body.category)) maps.category[id] = body.category.map(String);
    if (Array.isArray(body.domain)) maps.domain[id] = body.domain.map(String);
    saveMap('category');
    saveMap('domain');
    return sendJson(res, 200, { ok: true });
  }

  // ---------- 命令工具 / 任务队列 ----------
  if (req.method === 'GET' && url.pathname === '/api/commands') {
    return sendJson(res, 200, { commands: COMMANDS.map(({ name, label, desc }) => ({ name, label, desc })) });
  }

  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    return sendJson(res, 200, { tasks: tasks.map(taskSummary), busy: queueBusy });
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)(\/cancel)?$/);
  if (taskMatch) {
    const t = tasks.find((x) => x.id === taskMatch[1]);
    if (!t) return sendJson(res, 404, { error: '任务不存在' });

    if (req.method === 'GET') {
      const since = Math.max(0, Math.min(t.output.length, Number(url.searchParams.get('since')) || 0));
      return sendJson(res, 200, { task: taskSummary(t), output: t.output.slice(since), since });
    }

    if (taskMatch[2] && req.method === 'POST') {
      const t0 = cancelTask(t.id);
      return sendJson(res, t0 ? 200 : 409, t0 ? { task: taskSummary(t0) } : { error: '任务不可取消' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await readBody(req);
    const t = createTask(String(body.name || ''));
    if (!t) return sendJson(res, 400, { error: '未知命令' });
    return sendJson(res, 202, { task: taskSummary(t) });
  }

  sendJson(res, 404, { error: 'not found' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url).catch((e) => sendJson(res, 500, { error: e.message }));
    return serveStatic(req, res, url);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

loadMaps();
server.listen(PORT, () => {
  console.log(`Field Theory 书签工作台: http://127.0.0.1:${PORT}`);
  console.log(`书签: ${BOOKMARKS_FILE}`);
  console.log(`配置: ${CONFIG_FILE}`);
  console.log(`jev 服务: ${JEV_URL}`);
});
