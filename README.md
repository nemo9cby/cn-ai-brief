# CN AI Brief

Translated briefings from Chinese AI sources for the global AI community.

This is the MVP for a public source pool: it turns existing `memory/newsroom/YYYY-MM-DD/{zhihu,qingke,podwise}.md` files into reviewable inbox drafts, then publishes curated English source cards as a static site.

## Product rule

Do **not** publish full translations of other people's work.

Public cards should contain:

- title
- source + author when available
- original link
- 3-5 sentence English summary
- key ideas
- why English readers should care
- one short translated excerpt only when useful

Local/private archives can keep fuller notes. The public site is curation + analysis, not a translation mirror.

## Workflow

```bash
npm run ingest   # reads ../memory/newsroom and writes content/inbox/*.json drafts
npm run build    # builds public/*.html from content/cards/*.json
```

Daily operating loop:

1. Existing newsroom crons collect Zhihu / Qingke / Podwise.
2. `npm run ingest` creates/updates draft inbox items.
3. Promote 3-5 best items into `content/cards/YYYY-MM-DD-*.json` with polished English.
4. `npm run build` regenerates the static site.
5. Later: sync the daily page into Substack/Buttondown.

## MVP scope

- Source pool first, newsletter second.
- Free layer: daily translated source cards + original links.
- Paid layer later: Nemo's weekly synthesis, strongest picks, and what English AI Twitter is missing.

## Full translation policy

Cards may include a `translation_id`. The build only publishes full translation pages when the matching translation file has one of these rights values:

- `owned`
- `licensed`
- `permissioned`
- `public_domain`

For third-party Zhihu/blog/podcast content without permission, keep the public card to summary, short quote, attribution, and original link.
