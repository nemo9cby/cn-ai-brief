import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), '..');
const newsroom = path.join(root, 'memory', 'newsroom');
const outDir = path.resolve(process.cwd(), 'content', 'inbox');
fs.mkdirSync(outDir, { recursive: true });

function slugify(s) {
  return s.toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'item';
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function blocks(md) {
  return md.split(/\n(?=##+\s+)/g).slice(1);
}

function field(block, name) {
  const re = new RegExp(`^- ${name}:\\s*(.*)$`, 'm');
  return block.match(re)?.[1]?.trim() || '';
}

function bulletsAfter(block, name) {
  const lines = block.split('\n');
  const start = lines.findIndex(l => l.trim() === `- ${name}:`);
  if (start < 0) return [];
  const arr = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^- \w/.test(line)) break;
    const m = line.match(/^\s+-\s+(.*)$/);
    if (m) arr.push(m[1].trim());
  }
  return arr;
}

function parseZhihu(date, md) {
  return blocks(md).filter(b => /^## Topic/.test(b)).map(b => {
    const title = field(b, 'title');
    return {
      id: `${date}-zhihu-${slugify(title)}`,
      date,
      source: 'Zhihu',
      status: 'draft',
      title,
      original_url: field(b, 'url'),
      heat: field(b, 'heat'),
      original_language: 'zh-CN',
      tags: inferTags(`${title}\n${b}`),
      chinese_notes: {
        core_viewpoints: bulletsAfter(b, 'core_viewpoints'),
        why_it_matters: field(b, 'why_it_matters'),
        priority: field(b, 'priority'),
        fit: field(b, 'fit')
      },
      public_card_todo: 'Write English summary, key ideas, and why English readers should care. Keep public quote short.'
    };
  });
}

function parseQingke(date, md) {
  if (!md.includes('newest_visible_relevant_post')) return [];
  const title = md.match(/newest_visible_relevant_post:\s*`([^`]+)`/)?.[1] || 'Qingke archive update';
  const url = md.match(/`(https:\/\/qingkeai\.online\/archives\/[^`]+)`/)?.[1] || 'https://qingkeai.online/archives';
  return [{
    id: `${date}-qingke-${slugify(title)}`,
    date,
    source: 'Qingke AI',
    status: md.includes('new_post_detected: no') ? 'seen-before' : 'draft',
    title,
    original_url: url,
    original_language: 'zh-CN',
    tags: inferTags(`${title}\n${md}`),
    chinese_notes: { assessment: field(md, 'assessment') },
    public_card_todo: 'If resurfacing this item, summarize the technical idea and connect it to English AI discourse.'
  }];
}

function parsePodwise(date, md) {
  return blocks(md).filter(b => /^### \d+\)/.test(b)).map(b => {
    const first = b.split('\n')[0].replace(/^### \d+\)\s*/, '').trim();
    const source = field(b, '来源') || 'Podcast';
    const episode = field(b, 'Episode');
    return {
      id: `${date}-podwise-${slugify(first)}`,
      date,
      source: `Podwise / ${source}`,
      status: 'draft',
      title: first,
      episode,
      original_url: '',
      original_language: /[\u4e00-\u9fa5]/.test(`${source} ${episode}`) ? 'zh-CN or mixed' : 'en',
      tags: inferTags(`${first}\n${b}`),
      chinese_notes: {
        signal: field(b, '信号'),
        why_it_matters: field(b, '为什么重要')
      },
      public_card_todo: 'Turn this into an English card only if the underlying episode/source is useful for cross-border AI readers.'
    };
  });
}

function inferTags(text) {
  const t = text.toLowerCase();
  const tags = new Set();
  if (/post-training|rlhf|grpo|强化学习|sft|reward|eval/.test(t)) tags.add('post-training');
  if (/agent|coding|claude code|codex|vibe|智能体/.test(t)) tags.add('agents');
  if (/deepseek|mimo|模型|foundation model|benchmark/.test(t)) tags.add('models');
  if (/infra|inference|token|cache|算力|成本|deployment/.test(t)) tags.add('infra');
  if (/startup|founder|product|组织|创业|产品/.test(t)) tags.add('operators');
  if (/投资|capex|nvda|consumer|估值/.test(t)) tags.add('markets');
  return [...tags];
}

const dates = fs.readdirSync(newsroom).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().slice(-14);
let all = [];
for (const date of dates) {
  const dir = path.join(newsroom, date);
  all.push(...parseZhihu(date, read(path.join(dir, 'zhihu.md'))));
  all.push(...parseQingke(date, read(path.join(dir, 'qingke.md'))));
  all.push(...parsePodwise(date, read(path.join(dir, 'podwise.md'))));
}

let wrote = 0;
for (const item of all) {
  const file = path.join(outDir, `${item.id}.json`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(item, null, 2) + '\n');
    wrote++;
  }
}

console.log(`Ingested ${all.length} items from ${dates.length} days. New drafts: ${wrote}. Inbox: ${outDir}`);
