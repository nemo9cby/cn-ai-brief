import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const COLLECTION_ID = process.env.ZHIHU_LLM_COLLECTION_ID || '972493246';
const CDP_PORT = process.env.OPENCLAW_CDP_PORT || '41628';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

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
  const res = await fetch(apiUrl, {
    headers: {
      Cookie: cookie,
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.zhihu.com/'
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function contentUrl(c) {
  if (c.url) return c.url;
  if (c.type === 'answer' && c.question?.id && c.id) return `https://www.zhihu.com/question/${c.question.id}/answer/${c.id}`;
  if (c.type === 'article' && c.id) return `https://zhuanlan.zhihu.com/p/${c.id}`;
  return '';
}

function contentTitle(c) {
  return c.question?.title || c.title || c.excerpt_title || '(untitled)';
}

function authorOf(c) {
  const a = c.author || {};
  const token = a.url_token || (a.url || '').split('/').pop();
  return {
    id: a.id || '',
    token,
    name: a.name || '匿名',
    headline: a.headline || a.badge_v2?.title || ''
  };
}

async function fetchCollectionItems(cookie, collectionId = COLLECTION_ID) {
  const items = [];
  let offset = 0;
  const limit = 20;
  while (true) {
    const url = `https://www.zhihu.com/api/v4/collections/${collectionId}/items?limit=${limit}&offset=${offset}`;
    const json = await fetchZhihu(url, cookie);
    for (const row of json.data || []) {
      const c = row.content || row;
      const a = authorOf(c);
      if (!a.token) continue;
      items.push({
        collection_id: collectionId,
        type: c.type,
        id: String(c.id || ''),
        title: contentTitle(c),
        url: contentUrl(c),
        author: a,
        voteup_count: c.voteup_count || c.voting || 0,
        excerpt: (c.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 500),
        created_time: c.created_time || c.created || c.created_at || null,
        updated_time: c.updated_time || c.updated || null,
        favorited_time: row.created_time || null
      });
    }
    if (json.paging?.is_end) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 600));
  }
  return items;
}

function buildWatchlist(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.author.token;
    if (!map.has(key)) {
      map.set(key, {
        token: key,
        name: item.author.name,
        headline: item.author.headline,
        source: 'zhihu_llm_collection',
        saved_count: 0,
        total_saved_votes: 0,
        seed_items: []
      });
    }
    const w = map.get(key);
    w.saved_count += 1;
    w.total_saved_votes += Number(item.voteup_count || 0);
    w.seed_items.push({ title: item.title, url: item.url, type: item.type, votes: item.voteup_count });
  }
  return [...map.values()]
    .sort((a, b) => (b.saved_count - a.saved_count) || (b.total_saved_votes - a.total_saved_votes));
}

async function main() {
  const cookie = await getZhihuCookie();
  const items = await fetchCollectionItems(cookie);
  const watchlist = buildWatchlist(items);
  const out = {
    collection_id: COLLECTION_ID,
    collection_title: 'LLM',
    generated_at: new Date().toISOString(),
    total_items: items.length,
    total_authors: watchlist.length,
    authors: watchlist,
    seed_items: items
  };
  const outPath = path.join(DATA_DIR, 'zhihu-llm-watchlist.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${watchlist.length} authors from ${items.length} saved LLM items -> ${outPath}`);
  for (const a of watchlist.slice(0, 15)) {
    console.log(`${a.name}\t${a.token}\tsaved=${a.saved_count}\tvotes=${a.total_saved_votes}\t${a.headline}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
