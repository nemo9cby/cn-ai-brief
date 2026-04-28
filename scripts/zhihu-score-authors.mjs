import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const INPUT = path.join(DATA_DIR, 'zhihu-llm-watchlist.json');
const OUTPUT = path.join(DATA_DIR, 'zhihu-llm-watchlist-scored.json');

const keywordWeights = [
  ['post-training', 8, /后训练|post.?training|RLHF|GRPO|SFT|DPO|PPO|reward|奖励模型|偏好优化|verifiable|RLVR/i],
  ['agents', 7, /agent|智能体|Claude Code|Codex|MCP|vibe coding|AI 编程|工具调用|function call/i],
  ['llm-systems', 6, /vLLM|推理|inference|CUDA|GPU|算子|Tensor Core|吞吐|显存|部署|量化|MoE|并行/i],
  ['models', 5, /大模型|LLM|语言模型|DeepSeek|Qwen|千问|Kimi|GLM|豆包|MiMo|GPT|Claude|Gemini|多模态/i],
  ['evals', 5, /评测|benchmark|SWE.?Bench|榜单|测评|泛化|幻觉|鲁棒|对齐/i],
  ['research', 4, /论文|arxiv|ACL|NeurIPS|ICLR|ICML|CVPR|技术报告/i],
  ['operator', 3, /创业|产品|工程|实践|落地|复盘|经验|团队/i]
];

const negativePattern = /情感|娱乐|明星|体育|房价|汽车价格战|政治|军事|医美|装修|旅游|育儿|基金|股票短线|玄学/;

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function daysAgo(ts) {
  if (!ts) return 3650;
  const ms = Number(ts) * 1000;
  if (!Number.isFinite(ms)) return 3650;
  return Math.max(0, (Date.now() - ms) / 86400000);
}
function scoreRecency(items) {
  const newest = Math.min(...items.map(i => daysAgo(i.favorited_time || i.created_time)).filter(Number.isFinite));
  if (!Number.isFinite(newest)) return 0;
  if (newest <= 14) return 20;
  if (newest <= 60) return 15;
  if (newest <= 180) return 10;
  if (newest <= 365) return 6;
  return 2;
}
function scoreKeywords(items, headline = '') {
  const text = `${headline}\n` + items.map(i => `${i.title}\n${i.excerpt || ''}`).join('\n');
  let score = 0;
  const tags = [];
  for (const [tag, weight, re] of keywordWeights) {
    const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
    if (matches.length) {
      tags.push(tag);
      score += Math.min(weight * matches.length, weight * 3);
    }
  }
  if (negativePattern.test(text)) score -= 12;
  return { score: clamp(score, -20, 60), tags: [...new Set(tags)] };
}
function scoreCollectionFit(items) {
  let s = 0;
  for (const i of items) {
    if (i.collection === 'LLM') s += 10;
    else if (i.collection === '我的收藏') s += 3;
  }
  return clamp(s, 0, 35);
}
function scoreDepth(author) {
  const votes = Number(author.total_saved_votes || 0);
  const saved = Number(author.saved_count || 0);
  return clamp(Math.log10(votes + 10) * 8 + Math.log2(saved + 1) * 5, 0, 35);
}
function scoreAuthor(author) {
  const seed = author.seed_items || [];
  const kw = scoreKeywords(seed, author.headline || '');
  const collectionFit = scoreCollectionFit(seed);
  const depth = scoreDepth(author);
  const recency = scoreRecency(seed);
  const frequency = clamp(Math.log2((author.saved_count || 0) + 1) * 10, 0, 30);
  const score = Math.round((kw.score + collectionFit + depth + recency + frequency) * 10) / 10;
  return {
    ...author,
    score,
    score_breakdown: {
      keyword_fit: Math.round(kw.score * 10) / 10,
      collection_fit: collectionFit,
      saved_depth: Math.round(depth * 10) / 10,
      recency,
      saved_frequency: Math.round(frequency * 10) / 10
    },
    tags: kw.tags
  };
}

if (!fs.existsSync(INPUT)) {
  console.error(`Missing ${INPUT}. Run npm run zhihu:authors first.`);
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const scored = (raw.authors || []).map(scoreAuthor).sort((a, b) => b.score - a.score);
const out = {
  ...raw,
  scoring_generated_at: new Date().toISOString(),
  scoring_method: 'collection_fit + keyword_fit + saved_depth + recency + saved_frequency; penalties for broad non-AI topics',
  authors: scored
};
fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');

console.log(`Scored ${scored.length} authors -> ${OUTPUT}`);
for (const a of scored.slice(0, 40)) {
  console.log(`${String(a.score).padStart(5)}\t${a.saved_count}\t${a.name}\t${a.token}\t${(a.tags || []).join(',')}\t${a.headline || ''}`);
}
