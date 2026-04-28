import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const ROOT = process.cwd();
const WORKSPACE = path.resolve(ROOT, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_DIR = path.join(ROOT, 'state');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

const CDP_PORT = process.env.OPENCLAW_CDP_PORT || '41628';
const AUTHOR_LIMIT = Number(process.env.ZHIHU_AUTHOR_LIMIT || 25);
const PER_AUTHOR_LIMIT = Number(process.env.ZHIHU_PER_AUTHOR_LIMIT || 8);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const KEYWORDS = [
  '大模型','LLM','语言模型','多模态','DeepSeek','Claude','OpenAI','GPT','Gemini','Qwen','千问','GLM','Kimi','豆包','MiMo',
  '强化学习','RLHF','GRPO','SFT','后训练','微调','预训练','reward','奖励模型','评测','benchmark','agent','智能体','coding agent','AI 编程','vibe coding',
  '推理','上下文','token','MCP','RAG','向量','MoE','inference','训练','模型'
];

function torontoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function cdp(wsUrl, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === id) {
        clearTimeout(timer);
        ws.close();
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
    ws.on('error', reject);
  });
}

async function getZhihuCookie() {
  const version = await httpJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const result = await cdp(version.webSocketDebuggerUrl, 'Storage.getCookies', {});
  const cookies = (result.cookies || []).filter(c => c.domain.includes('zhihu.com'));
  const byName = new Map();
  for (const c of cookies) byName.set(c.name, c.value);
  if (!byName.has('z_c0')) throw new Error('No Zhihu login cookie found in OpenClaw browser profile.');
  return [...byName].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchZhihu(apiUrl, cookie) {
  const res = await fetch(apiUrl, { headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.zhihu.com/' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function stripHtml(s = '') { return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function contentTitle(c) { return c.question?.title || c.title || c.excerpt_title || '(untitled)'; }
function contentUrl(c, type) {
  if (c.url) return c.url.replace('api/v4/', '');
  if (type === 'answer' && c.question?.id && c.id) return `https://www.zhihu.com/question/${c.question.id}/answer/${c.id}`;
  if (type === 'article' && c.id) return `https://zhuanlan.zhihu.com/p/${c.id}`;
  return '';
}
function isRelevant(item) {
  const text = `${item.title}\n${item.excerpt}`;
  return KEYWORDS.some(k => text.toLowerCase().includes(k.toLowerCase()));
}
function itemId(item) { return `${item.type}:${item.id}`; }

async function fetchAuthorItems(cookie, author) {
  const all = [];
  const answerUrl = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(author.token)}/answers?limit=${PER_AUTHOR_LIMIT}&offset=0&sort_by=created`;
  const articleUrl = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(author.token)}/articles?limit=${PER_AUTHOR_LIMIT}&offset=0`;
  for (const [type, url] of [['answer', answerUrl], ['article', articleUrl]]) {
    try {
      const json = await fetchZhihu(url, cookie);
      for (const c of json.data || []) {
        all.push({
          type,
          id: String(c.id || ''),
          title: contentTitle(c),
          url: contentUrl(c, type),
          author: { name: author.name, token: author.token, headline: author.headline },
          voteup_count: c.voteup_count || c.voting || c.reaction?.statistics?.like_count || 0,
          comment_count: c.comment_count || 0,
          excerpt: stripHtml(c.excerpt || c.content || '').slice(0, 700),
          created_time: c.created_time || c.created || c.created_at || null,
          updated_time: c.updated_time || c.updated || null
        });
      }
    } catch (e) {
      all.push({ type: 'error', author, error: e.message, title: `Failed to fetch ${type}` });
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return all.filter(x => x.type === 'error' || isRelevant(x));
}

function loadWatchlist() {
  const p = path.join(DATA_DIR, 'zhihu-llm-watchlist.json');
  if (!fs.existsSync(p)) throw new Error('Missing data/zhihu-llm-watchlist.json. Run npm run zhihu:authors first.');
  return JSON.parse(fs.readFileSync(p, 'utf8')).authors || [];
}

function loadState() {
  const p = path.join(STATE_DIR, 'zhihu-author-monitor-state.json');
  if (!fs.existsSync(p)) return { seen: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function saveState(state) {
  fs.writeFileSync(path.join(STATE_DIR, 'zhihu-author-monitor-state.json'), JSON.stringify(state, null, 2) + '\n');
}

function writeNewsroom(date, items, authors) {
  const dir = path.join(WORKSPACE, 'memory', 'newsroom', date);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  lines.push(`# Source: Zhihu LLM Authors`);
  lines.push(`Date: ${date}`);
  lines.push('');
  lines.push(`Seed: Nemo's Zhihu LLM collection -> ${authors.length} watched authors`);
  lines.push(`Captured relevant items: ${items.length}`);
  lines.push('');
  let i = 1;
  for (const item of items) {
    lines.push(`## Item ${i++}`);
    lines.push(`- title: ${item.title}`);
    lines.push(`- author: ${item.author.name} (@${item.author.token})`);
    lines.push(`- type: ${item.type}`);
    lines.push(`- url: ${item.url}`);
    lines.push(`- created_time: ${item.created_time || ''}`);
    lines.push(`- voteup_count: ${item.voteup_count || 0}`);
    lines.push(`- summary_seed: ${item.excerpt}`);
    lines.push(`- fit: en`);
    lines.push(`- priority: medium`);
    lines.push('');
  }
  fs.writeFileSync(path.join(dir, 'zhihu-authors.md'), lines.join('\n'));
}

function writeInbox(date, items) {
  const inboxDir = path.join(ROOT, 'content', 'inbox');
  fs.mkdirSync(inboxDir, { recursive: true });
  for (const item of items) {
    const safe = `${date}-zhihu-author-${item.author.token}-${item.type}-${item.id}`.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 160);
    const draft = {
      id: safe,
      date,
      source: `Zhihu / ${item.author.name}`,
      status: 'draft',
      title: item.title,
      original_url: item.url,
      original_language: 'zh-CN',
      tags: ['models'],
      author: item.author,
      chinese_notes: {
        type: item.type,
        voteup_count: item.voteup_count,
        excerpt: item.excerpt,
        created_time: item.created_time
      },
      public_card_todo: 'Write English source card if this is a high-signal LLM/post-training/agent item. Do not publish full translation without rights.'
    };
    fs.writeFileSync(path.join(inboxDir, `${safe}.json`), JSON.stringify(draft, null, 2) + '\n');
  }
}

async function main() {
  const date = torontoDate();
  const watchlist = loadWatchlist().slice(0, AUTHOR_LIMIT);
  const cookie = await getZhihuCookie();
  const state = loadState();
  const captured = [];
  for (const author of watchlist) {
    const items = await fetchAuthorItems(cookie, author);
    for (const item of items) {
      if (item.type === 'error') continue;
      const id = itemId(item);
      if (state.seen[id]) continue;
      state.seen[id] = { first_seen: new Date().toISOString(), title: item.title, author: item.author.name, url: item.url };
      captured.push(item);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  captured.sort((a, b) => (b.created_time || 0) - (a.created_time || 0));
  writeNewsroom(date, captured, watchlist);
  writeInbox(date, captured);
  saveState(state);
  const outPath = path.join(DATA_DIR, `zhihu-author-capture-${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ date, watched_authors: watchlist.length, captured_count: captured.length, items: captured }, null, 2) + '\n');
  console.log(`Watched ${watchlist.length} authors, captured ${captured.length} new relevant items.`);
  console.log(`Wrote memory/newsroom/${date}/zhihu-authors.md and ${outPath}`);
  for (const item of captured.slice(0, 12)) console.log(`- ${item.author.name}: ${item.title} (${item.type})`);
}

main().catch(err => { console.error(err); process.exit(1); });
