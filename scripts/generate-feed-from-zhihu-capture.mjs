import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const FEED_DIR = path.join(ROOT, 'content', 'feed');
fs.mkdirSync(FEED_DIR, { recursive: true });

function torontoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const date = process.env.FEED_DATE || torontoDate();
const capturePath = path.join(DATA_DIR, `zhihu-author-capture-${date}.json`);
const scoredPath = path.join(DATA_DIR, 'zhihu-llm-watchlist-scored.json');

if (!fs.existsSync(capturePath)) {
  console.error(`Missing ${capturePath}. Run npm run zhihu:monitor first.`);
  process.exit(1);
}

const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
const scored = fs.existsSync(scoredPath) ? JSON.parse(fs.readFileSync(scoredPath, 'utf8')).authors || [] : [];
const scoreByToken = new Map(scored.map(a => [a.token, a]));

const topicRules = [
  ['post-training', /后训练|RLHF|GRPO|SFT|DPO|reward|奖励|强化学习|RL训练|RL4LLM/i, 'post-training and RL'],
  ['agents', /agent|智能体|Claude Code|Codex|MCP|Skill|vibe|AI 编程|北向agent/i, 'AI agents and coding workflows'],
  ['inference', /推理|vLLM|Tensor Core|CUDA|显卡|部署|投机采样|EAGLE|ModelRunner|算子|显存|Token/i, 'inference and AI systems'],
  ['models', /DeepSeek|Kimi|Qwen|千问|GLM|GPT|Claude|Gemini|模型架构|大模型|LLM|多模态/i, 'frontier and open model development'],
  ['evals', /评测|benchmark|跑分|体验|幻觉|泛化|Reward Hacking/i, 'evaluation and reliability'],
  ['research', /论文|ACL|CVPR|ICLR|ICML|arxiv|技术报告/i, 'research signals']
];

const phraseTranslations = [
  [/手撕/g, 'deep dive into'],
  [/技术报告解读/g, 'technical report notes'],
  [/模型架构/g, 'model architecture'],
  [/快速部署/g, 'fast deployment'],
  [/开源大模型/g, 'open-source LLMs'],
  [/强化学习/g, 'reinforcement learning'],
  [/奖励/g, 'reward'],
  [/评测/g, 'evaluation'],
  [/推理/g, 'inference'],
  [/大模型/g, 'LLMs'],
  [/智能体|Agent|agent/g, 'agents'],
  [/编程/g, 'coding'],
  [/多模态/g, 'multimodal'],
  [/训练/g, 'training'],
  [/部署/g, 'deployment'],
  [/架构/g, 'architecture'],
  [/干货/g, 'technical notes'],
  [/复盘/g, 'retrospective'],
  [/如何评价/g, 'How to read'],
  [/为什么/g, 'Why'],
  [/是什么/g, 'What is']
];

function detectTopics(item) {
  const text = `${item.title}\n${item.excerpt || ''}`;
  const out = [];
  for (const [tag, re] of topicRules) if (re.test(text)) out.push(tag);
  return [...new Set(out)];
}

function englishTitle(title) {
  let s = String(title || '').trim();
  for (const [re, en] of phraseTranslations) s = s.replace(re, en);
  if (/[^\x00-\x7F]/.test(s)) {
    return `Chinese technical note: ${s}`;
  }
  return s;
}

function englishSummary(item, topics) {
  const author = item.author?.name || 'a watched Zhihu author';
  const topicText = topics.length ? topics.map(t => topicRules.find(r => r[0] === t)?.[2] || t).join(', ') : 'AI engineering';
  const type = item.type === 'article' ? 'article' : 'answer';
  return `${author} published a Zhihu ${type} relevant to ${topicText}. The original Chinese excerpt is included below so the feed can preserve the raw source while giving English readers enough context to triage the item.`;
}

function isoFromUnix(ts) {
  if (!ts) return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

const items = (capture.items || []).map(item => {
  const scoredAuthor = scoreByToken.get(item.author?.token) || {};
  const topics = detectTopics(item);
  return {
    id: `zhihu-${item.type}-${item.id}`,
    date,
    source: 'Zhihu Author Watchlist',
    platform: 'Zhihu',
    type: item.type,
    url: item.url,
    created_at: isoFromUnix(item.created_time),
    created_time: item.created_time || null,
    author: item.author,
    author_score: scoredAuthor.score || null,
    author_tags: scoredAuthor.tags || [],
    topics,
    zh: {
      title: item.title,
      excerpt: item.excerpt || ''
    },
    en: {
      title: englishTitle(item.title),
      summary: englishSummary(item, topics)
    },
    metrics: {
      voteup_count: item.voteup_count || 0,
      comment_count: item.comment_count || 0
    }
  };
}).sort((a, b) => (b.created_time || 0) - (a.created_time || 0));

const out = {
  date,
  source: 'zhihu_author_watchlist',
  generated_at: new Date().toISOString(),
  item_count: items.length,
  items
};

const outPath = path.join(FEED_DIR, `${date}-zhihu-authors.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Generated bilingual feed with ${items.length} items -> ${outPath}`);
