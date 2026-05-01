# BookFormatter Pro

A professional manuscript formatting and AI proofreading platform for self-published authors.

## Architecture

- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js + TypeScript
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth (email + password)
- **AI**: OpenAI (gpt-4o for suggestions, gpt-4o-mini for auto-fix)
- **Payments**: Stripe (checkout sessions for Single Book $7 and Pro $19/mo)
- **Export**: pdfkit (PDF), docx (DOCX), JSZip (EPUB3)

## User Flow (5 Steps)

1. **Upload** — Drop manuscript file (.docx/.doc/.txt/.rtf). Text extracted via format-specific parsers (mammoth for DOCX/DOC, RTF stripper for RTF, plain read for TXT) and saved to `cleaned_text` in Supabase. Status = "Draft".
2. **Template** — Choose style (Modern Novel / Memoir / Fantasy / Non-Fiction), trim size, and output target (KDP / IngramSpark / etc.).
3. **AI Proofing** — Single "Start Proofreading" button. Behind the scenes runs a fast two-pass pipeline:
   - Pass 1 (gpt-4o-mini): Auto-fixes capitalization, punctuation, spelling, spacing (silent) — 5→50% progress
   - Pass 2 (gpt-4o): Grammar / run-on / clarity suggestions → saved to `corrections` table for author review — 50→92% progress
   - No mode selector in the UI — always runs the full pipeline for best results.
4. **Structure Review** — **Manual-first, highlight-then-tag**: manuscript loads as plain untagged text. User highlights text, then a floating toolbar appears with 3 simple tags: **Chapter / Intro / Conclusion Title** (blue, triggers page break + H1 heading), **Subchapter / Section** (teal, H2 heading), and **Body** (gray, normal paragraph). AI auto-detect is opt-in via button — never runs automatically. Tagged text immediately changes color for visual feedback. Everything untagged becomes body text in exports. Title/author come from the Upload page, not structure tags. User-defined tags are the sole source of truth for chapter headings, TOC, and all export formatting.
5. **Export** — Download PDF, DOCX, or EPUB3, formatted with selected template/trim/target settings and confirmed structure.

## Plans & Entitlements

- **Free**: 1 project/month, up to **2,500 words**, **DOCX export only**, watermark on exports. Enforced server-side at three endpoints — `POST /api/projects/upload` (word cap, blocks before project creation), `POST /api/projects/:id/process` (word cap), and `GET /api/projects/:id/exports/:format` (word cap + format gate). Plan resolution and word-count derivation are centralized in `resolveUserPlan()` and `resolveWordCount()` helpers in `server/routes.ts` (fail-closed; `PLAN_CAPS` table covers free/single/pro/agency). Word count derives from request text → in-memory cache → DB `cleaned_text` → DB `word_count`, in that order, so it survives server restarts.
- **Single Book** ($7 one-time): 1 manuscript, up to 50,000 words, **PDF, DOCX, and EPUB** export, no watermark.
- **Pro** (subscription): 5 projects/month, up to 150,000 words, all formats, save custom templates.
- **Agency** (sales-led): 20 projects/month, unlimited words, team seats.

## Auth Flow

- Frontend: Supabase Auth email+password sign-up/sign-in
- All API routes protected by `requireAuth` middleware
- JWT passed via `Authorization: Bearer <token>` header (via `apiFetch` utility)
- Server verifies JWT via `supabase.auth.getUser(token)`
- Projects scoped to `user_id` on create and list

## Key Files

- `server/routes.ts` — All API routes (with auth middleware + Stripe checkout)
- `server/export-generator.ts` — PDF, DOCX, and EPUB3 generation
- `server/openai-pipeline.ts` — Two-pass AI proofreading with progress callbacks
- `server/supabase.ts` — Supabase admin client
- `client/src/lib/auth.tsx` — Supabase Auth context (user, signIn, signUp, signOut, getToken)
- `client/src/lib/apiFetch.ts` — Auth-aware fetch wrapper (adds Bearer token automatically)
- `client/src/pages/Auth.tsx` — Login + Register tabs
- `client/src/pages/Project.tsx` — 5-tab project wizard (Upload → Template → AI → Structure → Export)
- `client/src/components/StructureReview.tsx` — Structure review component (paragraph type classification UI)
- `client/src/pages/Review.tsx` — Accept/reject individual AI suggestions
- `client/src/pages/Dashboard.tsx` — Auth-aware project list + plan display

## Export Engine

The formatting engine in `server/export-generator.ts` supports template-driven output for PDF, DOCX, and EPUB.

### Heading Detection (Two-Level Hierarchy)

**Chapter headings** (`isChapterHeading`): `Chapter 1`, `CHAPTER I`, `Chapter One`, `Part I`, `PROLOGUE`, `EPILOGUE`, `FOREWORD`, standalone all-caps short titles (≤8 words).

**Section headings** (`isSectionHeading`): Numbered sections (`1.1 Title`, `I. Title`, `2) Title`), keyword-prefixed (`Section`, `Act`, `Scene`, `Appendix`), and strict Title Case lines (2–6 words, all significant words capitalized, no sentence-starter words, no quotes/punctuation endings).

`classifyParagraph()` returns `"chapter" | "section" | "body"` — used as fallback heuristic when no confirmed structure exists.

`autoDetectStructure()` returns `ParagraphType[]` with simplified types (`"chapter" | "section" | "body"`) for the full text. Only runs when user explicitly clicks "AI Auto-detect" button.

**Simplified tag system (3 tags)**:
- `chapter` = "Chapter 1", "Introduction", "Prologue", "Conclusion" (triggers new page + H1 heading)
- `section` = sub-section/subchapter headings (H2)
- `body` = normal paragraph text (default for all untagged text)

Legacy types (`chapter-label`, `chapter-title`, `introduction`, `title`, `author`, `front-matter`, `scene-break`) are still accepted by the ParagraphType union and handled in export generators for backward compatibility with older saved data.

**Styling**: Chapters use `chapterTitleRules` (H1, new page); sections use derived rules at 75% font size, 50% spacing, bold, left-aligned (H2). EPUB sections render as `<h2 class="section-title">` with unique anchor IDs.

### Table of Contents (TOC)
TOC is generated automatically in all three export formats from the user-confirmed tagged headings. No AI or heuristic guessing — only explicit user tags drive the TOC.

- **PDF**: Two-pass rendering. TOC pages are reserved after the title page, body is rendered with heading page tracking, then TOC is filled in with chapter/section titles, dot leaders, and actual page numbers. First-page capacity accounts for the TOC title block.
- **DOCX**: TOC uses `InternalHyperlink` + `BookmarkStart/BookmarkEnd` + `PageReference` with right-aligned dot-leader tab stops. Headings in body get corresponding bookmarks via `paraIndex → bookmarkId` map for guaranteed synchronization. Word auto-updates page numbers when user opens the document.
- **EPUB**: Navigable `nav.xhtml` (EPUB3) and `toc.ncx` (EPUB2) generated from chapter/section structure. Sections appear as nested list items under their parent chapters.
- **TOC depth**: 2 by default (chapters = level 1, sections = level 2). Front matter headings (Prologue, Epilogue, etc.) can optionally be included.
- **Entry hierarchy**: `chapter` type = top-level entry (bold, title font); `section` type = indented secondary entry (smaller font).

### Template Config System
`ExportSettings.templateConfig` carries optional overrides:
- `marginSettings` (top/bottom/left/right in points)
- `paragraphSettings` (font, size, indent, lineSpacing)
- `headerFooterSettings` (showHeader, showFooter, headerContent, footerContent, font sizes)
- `chapterTitleRules` (fontSize, bold, centered, spaceBefore/After, startNewPage)

Defaults resolve from the template name (modern-novel / memoir / fantasy / non-fiction). DB values from `templates` or `projects.applied_template_snapshot` override defaults via deep merge.

### Header/Footer
- Default: running headers disabled (`showHeader: false`, `headerContent: "none"`); only page-number footer is shown.
- If a template explicitly enables headers (`showHeader: true`), PDF overlays them per-page (even/odd alternation); DOCX uses section headers.
- PDF headers/footers use `lineBreak: false` to prevent extra blank pages during buffered-page post-processing.
- EPUB: handled via CSS; no running headers (ereader convention).

### Front Matter Stripping
- All three export formats (PDF, DOCX, EPUB) strip duplicate title/author lines from the start of manuscript body text.
- `stripFrontMatter()` uses Unicode-aware normalization to match title and author against the first paragraphs.
- Standalone headings (PROLOGUE, THE BEGINNING, etc.) immediately after front matter are preserved as chapter headings.

### Margins
- Default margins are symmetric (equal left/right) for visually centered text blocks.
- KDP/IngramSpark targets use 72pt symmetric margins; generic targets scale by trim width.

### Table of Contents
- Template-driven: `tocSettings` in `TemplateConfig` controls whether a visible TOC page is generated.
- Settings: `includeTableOfContents`, `tocDepth`, `tocTitle`, `includeFrontMatterInToc`, `startTocOnNewPage`.
- Defaults: fiction templates = no visible print TOC; non-fiction/manual/guide/academic = visible print TOC.
- EPUB always generates proper nav/ncx TOC structure from detected headings regardless of `includeTableOfContents`.
- PDF/DOCX: TOC page is inserted between title page and body content when enabled.
- TOC entries are collected from the same heading detection used for chapter rendering (`isChapterHeading`).
- Frontend TOC controls in Template tab: toggle, title input, depth dropdown (1=chapters, 2=+sections), front matter toggle, new page toggle.
- TOC settings are passed as query params (`toc`, `tocTitle`, `tocDepth`, `tocFrontMatter`, `tocNewPage`) on export requests.
- Backend merges user-selected TOC overrides into `templateConfig.tocSettings` before generating exports.
- `tocDepth` is server-side clamped to 1–2.

### Structure Review (Manuscript Highlighter)
- `GET /api/projects/:id/structure` — Returns `fullText` (cleaned manuscript), plus any previously saved `paragraphs` with types. `?redetect=1` forces fresh auto-detection.
- `PUT /api/projects/:id/structure` — Saves confirmed paragraph blocks (`{ paragraphs: [{text, type}] }`). Types include: title, author, introduction, chapter, section, body, front-matter, scene-break.
- Storage format: `projects.manuscript_structure` is a JSONB array of `{text: string, type: string}` objects.
- **User-driven structure mapping**: Full manuscript is shown in a readable view. Users highlight text, pick a tag type, and the selection is tagged. Tagged entries listed in a sidebar panel with edit/delete. Un-tagged text becomes "body" in exports.
- At export time, tagged entries + body gaps are assembled into `paragraphs` with `confirmedTypes`. Exports bypass heuristic detection entirely when confirmed types exist.
- `introduction` type is treated like `chapter` in export rendering (TOC, page breaks, chapter heading styling).
- Scene breaks render as centered `* * *` dividers in PDF/DOCX/EPUB.

### AI Proofreading Modes
- **Fast mode** (`mode: "fast"`): Runs only Pass 1 (auto-fix: capitalization, spelling, punctuation, spacing). Skips the suggestion pass entirely. Much faster.
- **Full mode** (`mode: "full"`): Runs Pass 1 + Pass 2 (grammar, run-on, clarity suggestions for manual review). Takes 1–3 minutes.
- Mode is sent via `POST /api/projects/:id/process` body `{ mode: "fast" | "full" }`.
- Progress is reported via `processing_progress` column in Supabase, polled by frontend.

### DB Fields Used
- `projects`: `title`, `author_name`, `cleaned_text`, `genre`, `trim_size`, `output_target`, `selected_trim_size`, `selected_output_target`, `applied_template_snapshot`, `manuscript_structure`
- `templates` (optional): `margin_settings`, `paragraph_settings`, `header_footer_settings`, `chapter_title_rules`

### Export API

```
GET /api/projects/:id/exports/pdf?template=modern-novel&trim=6%22+×+9%22&target=Generic+PDF
GET /api/projects/:id/exports/docx?template=memoir&trim=5.5%22+×+8.5%22&target=IngramSpark
GET /api/projects/:id/exports/epub?template=fantasy
```

All export routes require auth. Generates fresh files from `cleaned_text` in Supabase.

## Stripe

- `POST /api/checkout/session` — creates Stripe Checkout session (requires auth)
- `POST /api/stripe/webhook` — handles payment events, updates user plan metadata
- Plans: `single` ($7 one-time), `pro` ($19/mo subscription)

### Required Secrets for Stripe

Add in Replit Secrets:
- `STRIPE_SECRET_KEY` — from Stripe Dashboard > Developers > API Keys
- `STRIPE_PRICE_SINGLE` — price ID for Single Book ($7 one-time)
- `STRIPE_PRICE_PRO` — price ID for Pro ($19/mo recurring)
- `STRIPE_WEBHOOK_SECRET` — from Stripe Dashboard > Webhooks, add endpoint `/api/stripe/webhook`

## Supabase Configuration

Required Replit Secrets:
- `SUPABASE_SERVICE_KEY` — service role key (for Stripe webhook plan updates + better auth)

Required SQL to run in Supabase SQL Editor:
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS processing_progress INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
```

To disable email confirmation for immediate sign-in (recommended for MVP):
- Supabase Dashboard → Authentication → Email → uncheck "Enable email confirmations"

## Pricing Tiers

- Free ($0), Single Book ($7 one-time), Pro ($19/mo), Agency (contact)

## Text Extraction Pipeline

- `.docx` / `.doc`: mammoth `extractRawText()` — reliable structured text extraction
- `.rtf`: Custom `stripRtf()` parser in `server/openai-pipeline.ts` — handles nested groups, CP-1252 encoding, Unicode escapes, smart quotes/dashes, image removal, font/style table stripping
- `.txt`: Direct UTF-8 read
- Export route has a safety net: detects `{\rtf` prefix in stored `cleaned_text` and strips RTF markup at export time for legacy projects

## Known Limitations

- PDF generation uses pdfkit built-in fonts only (no custom font embedding)
- Stripe webhook plan updates require SUPABASE_SERVICE_KEY
- Without `user_id` column in DB, all users see all projects (fallback mode)
