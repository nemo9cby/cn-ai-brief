import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const cardsDir = path.join(cwd, 'content', 'cards');
const translationsDir = path.join(cwd, 'content', 'translations');
const publicDir = path.join(cwd, 'public');
const translationPublicDir = path.join(publicDir, 'translations');
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(translationPublicDir, { recursive: true });

const publishableRights = new Set(['owned', 'licensed', 'permissioned', 'public_domain']);

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function slugify(s = '') {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'translation';
}

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

function readCards() {
  return readJsonDir(cardsDir).map(x => x.data)
    .sort((a,b) => `${b.date} ${b.title}`.localeCompare(`${a.date} ${a.title}`));
}

function readTranslations() {
  const map = new Map();
  for (const { file, data } of readJsonDir(translationsDir)) {
    const id = data.id || file.replace(/\.json$/, '');
    data.id = id;
    data.slug = data.slug || slugify(id);
    map.set(id, data);
  }
  return map;
}

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
    :root{--bg:#0b1020;--card:#121a31;--text:#edf2ff;--muted:#9fb0d0;--line:#253150;--accent:#8bd3ff;--chip:#1d2947}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#08101f,#10162a);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);line-height:1.55}main{max-width:980px;margin:0 auto;padding:40px 20px 80px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}.hero{padding:36px 0 24px;border-bottom:1px solid var(--line);margin-bottom:24px}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}h1{font-size:44px;line-height:1.05;margin:10px 0 12px}.subtitle{font-size:18px;color:var(--muted);max-width:720px}.card{background:rgba(18,26,49,.86);border:1px solid var(--line);border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 10px 28px rgba(0,0,0,.18)}.meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:13px}.chip{background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:#c8d6f5}.card h2{font-size:24px;margin:12px 0}.section-title{margin-top:18px;color:#d7e5ff;font-size:15px;text-transform:uppercase;letter-spacing:.04em}.quote{border-left:3px solid var(--accent);padding-left:14px;color:#cfe0ff}.footer{margin-top:40px;color:var(--muted);font-size:14px;border-top:1px solid var(--line);padding-top:20px}.translation{white-space:pre-wrap;font-size:18px}.notice{background:#1e2a18;border:1px solid #4a6b38;color:#dff5cf;border-radius:14px;padding:14px;margin:18px 0}.muted{color:var(--muted)}ul{padding-left:20px}@media(max-width:640px){h1{font-size:34px}.card{padding:18px}}
  </style></head><body><main>${body}</main></body></html>`;
}

function translationLink(c, translations) {
  if (!c.translation_id) return '';
  const t = translations.get(c.translation_id);
  if (!t) return '<p class="muted">Full translation: pending rights review.</p>';
  if (!publishableRights.has(t.rights)) return '<p class="muted">Full translation: not publicly available. Summary and original link only.</p>';
  return `<p><a href="translations/${esc(t.slug)}.html">Full English translation →</a></p>`;
}

function renderCard(c, translations) {
  return `<article class="card">
    <div class="meta"><span>${esc(c.date)}</span><span>·</span><span>${esc(c.source)}</span>${(c.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</div>
    <h2>${esc(c.title)}</h2>
    <p>${esc(c.summary)}</p>
    ${c.key_ideas?.length ? `<div class="section-title">Key ideas</div><ul>${c.key_ideas.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${c.why_english_readers_should_care ? `<div class="section-title">Why English readers should care</div><p>${esc(c.why_english_readers_should_care)}</p>` : ''}
    ${c.short_translated_excerpt ? `<div class="section-title">Short translated excerpt</div><p class="quote">${esc(c.short_translated_excerpt)}</p>` : ''}
    ${translationLink(c, translations)}
    ${c.original_url ? `<p><a href="${esc(c.original_url)}">Original source</a></p>` : ''}
  </article>`;
}

function renderTranslation(t) {
  return layout(`CN AI Brief - ${t.title}`, `<section class="hero"><div class="eyebrow">Full Translation</div><h1>${esc(t.title)}</h1><p class="subtitle">${esc(t.source || '')}</p><p><a href="../index.html">← Home</a></p></section>
    <div class="notice">Published because rights status is marked as <strong>${esc(t.rights)}</strong>. Full translations should only be used for owned, licensed, permissioned, or public-domain material.</div>
    ${t.original_url ? `<p><a href="${esc(t.original_url)}">Original source</a></p>` : ''}
    <article class="card translation">${esc(t.translation_text || '')}</article>`);
}

const cards = readCards();
const translations = readTranslations();
const dates = [...new Set(cards.map(c => c.date))];

for (const t of translations.values()) {
  if (publishableRights.has(t.rights)) {
    fs.writeFileSync(path.join(translationPublicDir, `${t.slug}.html`), renderTranslation(t));
  }
}

const body = `<section class="hero"><div class="eyebrow">CN AI Brief</div><h1>Chinese AI signals, translated for global readers.</h1><p class="subtitle">A public source pool for English-speaking AI readers who want access to high-signal Chinese discussions on LLMs, agents, post-training, infrastructure, and operator lessons.</p></section>
  <p class="meta">${cards.length} published cards · ${dates.length} daily pages · updated from curated newsroom sources</p>
  ${cards.map(c => renderCard(c, translations)).join('\n')}
  <div class="footer">Public cards use summaries, short excerpts, attribution, and original links. Full translation pages are only published for owned, licensed, permissioned, or public-domain material.</div>`;
fs.writeFileSync(path.join(publicDir, 'index.html'), layout('CN AI Brief', body));
for (const date of dates) {
  const dayCards = cards.filter(c => c.date === date);
  fs.writeFileSync(path.join(publicDir, `${date}.html`), layout(`CN AI Brief - ${date}`, `<section class="hero"><div class="eyebrow">Daily Brief</div><h1>${date}</h1><p class="subtitle">Translated Chinese AI source cards.</p><p><a href="index.html">← Home</a></p></section>${dayCards.map(c => renderCard(c, translations)).join('\n')}`));
}
console.log(`Built ${cards.length} cards and ${[...translations.values()].filter(t => publishableRights.has(t.rights)).length} translation pages into ${publicDir}`);
