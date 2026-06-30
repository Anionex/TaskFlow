# TaskFlow Design System — Proposal (APPROVED v0.1)

> **Status: APPROVED · v0.1 · 2026-06-30 · derived from the PRD, not a pre-existing brand.**
> Originally a *first-pass proposal* reverse-engineered from the product requirements
> in [`docs/总结文档.md`](总结文档.md) (the PRD) and the front-end taste
> constraints in [`docs/anionex-taste.md`](anionex-taste.md). There was **no prior
> brand guide, Figma file, screenshot set, or component library** — every value
> below was a deliberate proposal.
>
> **Approved direction: A "案上 / The Quiet Workbench".** Locked decisions (see §11).
> Foundation build in progress; product pages not yet migrated.

---

## 1. What this is grounded in

Per the frontend-design method (ground the work in a concrete subject before
choosing visuals):

- **Subject** — TaskFlow V2.0, an *intelligent GTD system*. Core thesis: "用户少操作，系统多理解" — the user speaks in natural language; the system parses, classifies, decomposes, retrieves, and gently nudges. (PRD §1.1)
- **Audience** — students, knowledge workers, and individuals who have *many* tasks but won't spend effort on data entry and organization. (PRD §1.2)
- **The page's single job** — turn a loose human sentence into a structured, confirmable, advanceable task — with the human always in control (no silent writes). (PRD §1.3.1, §1.4.2)

The design's **signature** follows from that thesis (see §3).

### Inputs & hard constraints
| Source | Constraint |
| --- | --- |
| Stack | React 18 + TypeScript + Vite + Zustand + react-router + Chart.js; Tauri v2 shell. Web + desktop share one codebase. (PRD §2.2.2) |
| Decision | **Tailwind v4 + shadcn/ui** adopted. Tokens stay as CSS variables (source of truth); Tailwind maps onto them; themes swap at runtime via `[data-theme]`. |
| Decision | Existing hand-written `frontend/src/styles/global.css` + `theme.css` are **deprecated** by this proposal (superseded on approval — see §9). Not edited yet. |
| Taste doc | No emoji; icons are part of the text, not boxed in colored/rounded containers; **divide with hairline borders, not color blocks**; minimal layering (no "grid of cells"); Google Fonts via CDN; GSAP for motion but no flashy animation; **no hover-float on buttons**. |
| PRD | Three runtime themes: 普通 / 护眼 / 夜间. (PRD §2.5.2) |
| PRD | Product UI is **Chinese-first** → type system must pair Latin + CJK faces. |
| PRD | AI ops take *seconds*; every AI surface needs an explicit loading state and a graceful manual-form fallback. (PRD §1.4.1, §1.4.2) |

---

## 2. Recommended direction — "案上 / The Quiet Workbench"

A calm, airy, typographic workspace. The page reads like a sheet of paper with a
thinking assistant in the margin — not a dashboard of colored tiles.

**The bold spend is in exactly one place: the AI has its own voice.** Everything
the *system* authors — parse drafts, rewrite suggestions, morning recommendations,
evening summaries, search explanations — is set in a humanist **serif** voice and
set apart by a single thin accent hairline. Everything the *user* owns — tasks,
chrome, controls — stays in a clean grotesque **sans**. This:

- encodes the PRD thesis ("system understands you") *typographically* instead of with badges or tinted boxes;
- obeys the taste doc (differentiate by type + hairline, **never** by color blocks);
- keeps the rest of the UI quiet and disciplined, as the method demands ("spend your boldness in one place").

Around that one signature, the system is deliberately restrained: paper canvas,
hairline structure, one indigo accent reserved for the primary AI/confirm actions,
status shown as colored *text* not fills.

> This avoids all three generic defaults the method warns against (cream+serif+terracotta; near-black+acid accent; broadsheet hairline-grid): the canvas is cool paper not cream; the accent is a muted ink-indigo not an acid signal; structure is airy whitespace, not a dense ruled grid.

---

## 3. The signature, concretely

| Surface | User layer (sans) | System/AI layer (serif voice + hairline) |
| --- | --- | --- |
| Smart input | the textarea the user types into | — |
| Parse draft | editable fields the user adjusts | the framing line "已整理为可编辑草稿…" in serif |
| Rewrite | — | suggested next-action title in serif, with reason |
| Morning / Evening | task titles (sans) | the recommendation/summary prose in serif |
| Search | matched task rows (sans) | the one-line explanation in serif |

Rule: serif voice is for *system-authored sentences only*; never for labels,
buttons, numbers, or data. (Mirrors the CDS principle "serif is the voice.")

---

## 4. Type system

Google Fonts, loaded via CDN for early testing (taste doc §4). Latin + CJK pairs:

| Role | Family | Use |
| --- | --- | --- |
| Sans (UI/body) | **Hanken Grotesk** + **Noto Sans SC** | all chrome, task content, controls, numbers |
| Voice (display + AI) | **Source Serif 4** + **Noto Serif SC** | AI-authored sentences; large page/empty-state headings |
| Mono | **IBM Plex Mono** | order markers (①②③ alt), timestamps, IDs, code-ish data |

> Inter is deliberately *avoided* — it's the SaaS habit the method tells us to break. Hanken Grotesk keeps the airy SaaS feel with more character.

**Scale** (tokens in `tokens.draft.css`): 11 / 12 / 13 / 15 / 16 / 18 / 22 / 28 / 36 px.
Body = 15px. Weights: **400 and 500 only** (taste doc — no 600/700). Sentence case everywhere.

---

## 5. Color & tokens

Full values live in [`frontend/src/styles/tokens.css`](../frontend/src/styles/tokens.css).
Summary of the semantic layer (普通 / light):

| Token | Value | Role |
| --- | --- | --- |
| `--surface-0` | `#FCFCFB` | page canvas (paper) |
| `--surface-1` | `#FFFFFF` | in-flow card |
| `--surface-2` | `#FFFFFF` | popover/dialog (lifted by border + `--shadow-pop`) |
| `--text-primary` | `#1B1B19` | body |
| `--text-secondary` | `#565651` | supporting |
| `--text-muted` | `#8A8A83` | hints, placeholders |
| `--border` | `rgba(24,24,16,.10)` | the default divider — does most structural work |
| `--border-strong` | `rgba(24,24,16,.16)` | emphasis / hover |
| `--accent` | `#4742B8` | ink indigo — the one bold color; primary/AI actions, focus, progress |
| `--accent-soft` | `rgba(71,66,184,.12)` | focus tint / active-nav underline only |
| `--danger` / `--success` / `--warning` | `#A8331F` / `#2F6B45` / `#8A5A12` | status **as text + hairline**, never as filled blocks |

Restraint rules baked into the tokens:
- **One accent.** Indigo appears only on the primary action, focus ring, progress fill, active nav. Nothing else is colored.
- **No decorative fills.** Categories, tags, statuses = text + hairline. (taste doc §2)
- **One elevation.** Cards are flat (border only); only popovers/dialogs float, with a single `--shadow-pop`. (taste doc §3)
- Spacing in `rem` (vertical rhythm), component-internal gaps in px.

### Theme system (普通 / 护眼 / 夜间)
Themes are a single attribute on `<html>`: `data-theme="light|sepia|dark"`. Only the
semantic layer is redefined; the type/space/radius/motion layer is shared.
- **护眼 (sepia)** shifts the *accent itself off blue* to an umber `#8A5A2A` — genuinely cutting blue light, not just warming the background. (PRD §2.5.2 intent)
- **夜间 (dark)** lifts the indigo to `#8E89EC` for AA contrast and deepens `--shadow-pop`.
- `prefers-color-scheme: dark` is honored when no explicit theme is set; `prefers-reduced-motion` zeroes durations.

This keeps the existing `data-theme` switching approach the codebase already uses,
so the Zustand theme store needs only its value keys updated (`normal→light`, add `sepia`/`dark`).

---

## 6. Tailwind v4 + shadcn/ui integration

Tailwind v4 is CSS-first. The token file stays framework-agnostic; a thin entry
file maps Tailwind utilities **by reference** (`@theme inline`) so runtime theme
switching keeps working (utilities resolve to the live `var()`, not a copied value).

Proposed `frontend/src/styles/app.css` (created on approval — not yet):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "./tokens.css";                 /* the source of truth */

@theme inline {
  /* surfaces & text → Tailwind color utilities (bg-surface-1, text-secondary…) */
  --color-surface-0: var(--surface-0);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-text-primary:   var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted:     var(--text-muted);
  --color-border:  var(--border);
  --color-accent:  var(--accent);
  --color-danger:  var(--danger);
  --color-success: var(--success);
  --color-warning: var(--warning);

  /* fonts → font-sans / font-serif / font-mono */
  --font-sans:  var(--font-sans);
  --font-serif: var(--font-voice);
  --font-mono:  var(--font-mono);

  /* radius → rounded-md / rounded-lg */
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
}

/* shadcn/ui variable aliases → our tokens (shadcn reads these names) */
:root, [data-theme] {
  --background: var(--surface-0);
  --foreground: var(--text-primary);
  --card: var(--surface-1);            --card-foreground: var(--text-primary);
  --popover: var(--surface-2);         --popover-foreground: var(--text-primary);
  --primary: var(--accent);            --primary-foreground: var(--on-accent);
  --secondary: var(--surface-1);       --secondary-foreground: var(--text-primary);
  --muted: var(--surface-1);           --muted-foreground: var(--text-muted);
  --destructive: var(--danger);
  --border: var(--border);             --input: var(--border-strong);
  --ring: var(--ring);
  --radius: var(--radius-md);
  /* NOTE the clash: shadcn's `--accent` is a *hover surface*, not a brand color.
     Map it to a quiet surface; our brand color is shadcn's `--primary`. */
  --accent: var(--surface-1);          --accent-foreground: var(--text-primary);
}
```

shadcn is configured with `style: new-york`, `baseColor: neutral`, CSS variables on.
We override its component classes only where the taste doc requires (no hover-float,
hairline-only dividers, text-style icons) — documented per component in §7.

---

## 7. React component specifications

**Global component rules** (apply to every component; derived from the taste doc):
1. **Icons are used deliberately at key positions** for accent, wayfinding, and differentiation — and icon-*only* where the meaning is unambiguous. They are *not* zero, and *not* on everything. See "Iconography" below.
2. Divide with `--border` hairlines or whitespace — not background fills.
3. No hover-float / lift / scale on buttons. Allowed hover feedback: a `--border`→`--border-strong` shift or a subtle `--surface` change, ~`--dur-fast`.
4. Two font weights only. Sentence case. Active voice on all labels ("确认入库", not "提交").
5. Every AI surface has: a loading state and a degrade-to-manual path (PRD §1.4.2).

**Iconography** (library: **lucide-react**, shadcn's default — monochrome line icons):
- *Render as part of the text.* Inline, `currentColor`, sized to the line (~14–16px, 1.75 stroke), baseline-aligned. **Never** wrapped in a colored/rounded container chip. No emoji, ever.
- *Use at key positions* — the AI signature (sparkles on smart input, parse drafts, AI voice), primary/confirm actions (sparkles / check), wayfinding (nav, collapse chevron, search), status (flame for streak, clock/alert for overdue), and **icon-only utility controls** where unambiguous (theme switch sun/leaf/moon, close, search).
- *Don't abuse.* No icon on every tag, row, field label, or category. Categories stay text-only. If a text label is clearer than an icon, use the label. Rule of thumb: an icon earns its place only if it speeds recognition or carries the AI signature.
- *Accessibility*: decorative icons `aria-hidden`; icon-only buttons get `aria-label`.

### 7.1 Custom / signature components

**`<SmartInput>` — the hero (智能输入区)**
- *Purpose*: the natural-language entry point; the page's thesis made physical.
- *Anatomy*: borderless auto-growing `<textarea>` on `--surface-1`, a single hairline underline that thickens to `--accent` on focus; a quiet footer with a text link "批量捕获" and one primary action "智能解析".
- *Props*: `value`, `onChange`, `onParse(text)`, `onBrainDump(text)`, `loading`, `placeholder`.
- *States*: idle · focused (accent underline) · `loading` (footer shows "正在整理…" in serif voice + disabled action) · error→degrade (inline link "改用手动表单").
- *Taste*: no surrounding box; structure is the underline + whitespace. The sparkle is a text-sized inline glyph, not a boxed icon.

**`<AiDraftCard>` — parse/decompose confirmation (解析确认草稿)**
- *Purpose*: render an AI draft as **editable** fields; nothing writes to the DB until the user confirms (PRD §1.4.2).
- *Anatomy*: a card distinguished only by a **left hairline in `--accent`** (no tint fill); one serif voice line ("已整理为可编辑草稿，确认前可修改"); editable rows — title (`Input`), category (`Select`), star rating (`<StarRating>`), deadline (`DatePicker`); optional rewrite suggestion in serif; footer actions "放弃" (ghost) + "确认入库" (primary).
- *Props*: `draft: TaskDraft`, `editable`, `onChange(draft)`, `onConfirm(draft)`, `onDiscard`, `suggestion?`.
- *States*: editable · confirming (spinner on primary) · degraded (banner: "智能服务暂时不可用，请手动填写").
- *Taste*: differentiation is hairline + serif, never a colored block.

**`<TaskGroup>` — parent + first-level subtasks (任务组)**
- *Purpose*: container task with progress; first-level subtasks only (PRD §2.3.3).
- *Anatomy*: parent `<TaskRow>` + `<ProgressMeter>` (e.g. `2/5`) + collapse toggle; subtasks indented under a single left hairline (the only divider), each a `<TaskRow variant="subtask">` showing its order marker.
- *Props*: `parent: Task`, `subtasks: Task[]`, `collapsed`, `onToggleCollapse`, `onToggleComplete(id)`.
- *Taste*: indentation via one hairline + whitespace, not nested boxes ("no grid of cells").

**`<TaskRow>`**
- *Variants*: `default | subtask`. *Anatomy*: checkbox · title · `<CategoryLabel>` · `<StarRating size="sm">` · due text (colored text if overdue) · optional order marker. *States*: pending · completed (muted + strike) · overdue (due text in `--danger`) · selected (batch mode: `--accent-soft` row tint — the one permitted soft tint, for selection only).

**`<CategoryLabel>`** — category as **text + hairline pill** (学习/工作/生活/家庭/其他). No fill, no color-coding by category (would re-introduce color blocks). `--text-secondary` + `--border`.

**`<StarRating>`** — 0–5 importance. Filled stars use `--accent`, empty use `--text-muted`; both are the same outline glyph. Sizes `sm | md`. Interactive + readonly.

**`<ProgressMeter>`** — thin track (`--surface-0`) + `--accent` fill + `n/total` label in mono. Used by task groups and stats. (No percentage block.)

**`<AiVoice>`** — wrapper that renders system-authored prose in `--font-voice`; used by morning/evening/search/rewrite. Props: `tone?` (温暖鼓励型/冷静督促型/简短效率型 → affects copy upstream, not styling), `loading`.

**`<AiThinking>` / `<Skeleton>`** — mandatory loading affordance for the seconds-long AI calls (PRD §1.4.1): a calm shimmer + a serif line ("正在理解…"). Pairs with a timeout→degrade path.

### 7.2 shadcn/ui components (themed via §6, taste overrides noted)

| Component | shadcn base | Taste override |
| --- | --- | --- |
| Button | `button` | **capsule** (`--radius-pill`), compact (h≈28px, padding 6/15), **hairline** `--border`; default text `--text-secondary`→primary on hover; no hover translate/scale; primary = `--accent`. Icon-only buttons are round. |
| Input / Textarea / Select | `input` `textarea` `select` | hairline border, focus = `--ring`, no inner shadow |
| Dialog / Sheet | `dialog` `sheet` | `--surface-2` + `--shadow-pop`; for the brain-dump review & decompose panel |
| Toast | `sonner` | text + hairline; status as colored text, no filled banner |
| Tabs | `tabs` | active = `--accent` underline, not a filled pill |
| DropdownMenu / Tooltip | `dropdown-menu` `tooltip` | `--surface-2` + `--shadow-pop` |
| Switch | `switch` | theme switch (普通/护眼/夜间) |
| Skeleton / Progress | `skeleton` `progress` | back `<AiThinking>` / `<ProgressMeter>` |

> Tables (stats, etc.) render as data, not card grids — consistent with the airy direction.

---

## 8. Rationale — how each choice supports the PRD

| Choice | Supports |
| --- | --- |
| AI gets a serif **voice**; user layer stays sans | Makes "系统多理解" legible *typographically*; keeps human-in-control surfaces visually distinct (PRD §1.1, §1.4.2) without color blocks (taste §2) |
| One indigo accent, status-as-text, hairline structure | Taste doc §1–§3 (airy SaaS, no color-block/over-layering); also keeps focus on the AI signature (method: "spend boldness in one place") |
| `AiDraftCard` is editable + explicit confirm | Enforces "解析结果以可编辑草稿呈现…不静默写入" (PRD §1.3.1, §1.4.2) |
| Mandatory `AiThinking` + degrade path | AI ops are seconds-long and must degrade gracefully (PRD §1.4.1, §1.4.2) |
| Latin + CJK type pairing (Noto SC) | Product is Chinese-first; avoids fallback-font ransom-note text (PRD) |
| Tokens as CSS vars + `[data-theme]` swap | Three runtime themes incl. true low-blue 护眼 (PRD §2.5.2); works in Tauri + web from one codebase (PRD §1.4.4) |
| Tailwind v4 `@theme inline` + shadcn | Velocity for a 4-person MVP; accessible primitives for dialogs/inputs; consistent with the earlier shadcn recommendation |
| `ProgressMeter` `n/total` on parent task | Task-group progress display "如 3/5" (PRD §1.3.2) |
| `CategoryLabel` = text+hairline, order markers in mono | Categories & "建议执行顺序" carried as information, not decoration (method: structure as information) |

---

## 9. Migration plan (post-approval — NOT done yet)

1. Add deps: `tailwindcss@4`, `@tailwindcss/vite`, shadcn/ui (`style: new-york`, CSS vars on).
2. Add `app.css` (§6) importing `tokens.draft.css`; load Google Fonts via CDN in `index.html`.
3. Point the Zustand theme store at `light|sepia|dark`; set `data-theme` on `<html>`.
4. Build the component library (§7) — signature components first.
5. **Deprecate** `global.css` + `theme.css`: keep temporarily for any V1 screens, delete once pages are migrated. (They are *not* touched in this proposal.)
6. Rename `tokens.draft.css` → `tokens.css` once approved.

---

## 10. Three alternative visual directions

If "案上" isn't the vibe, three other coherent routes (each still obeys the taste doc):

**B · "索引 / The Index"** — editorial, structure-forward. Mono (`IBM Plex Mono`) for all data, order, and timestamps; a single signal color; numbered markers everywhere order is real information (subtask sequence, morning priority). *Signature*: numbering as meaning. *Pick if* the team values a precise, document-like, power-user feel. Risk: closer to the "broadsheet" default — needs precise spacing to avoid feeling like a ruled grid.

**C · "留白 / Calm"** — maximal whitespace, near-zero chrome. No borders at all; *space alone* divides regions; very large serif voice for AI; the only color is the accent on the primary action. *Signature*: whitespace as the sole divider. *Pick if* "人文关怀" (gentle morning/evening) is the emotional center. Risk: can read as empty on dense task lists; needs strong type hierarchy.

**D · "工位 / Console"** — denser, efficiency-first for heavy users (the "简短效率型" persona). Tighter spacing scale, mono labels, compact rows, keyboard-first. Same tokens, a `data-density="compact"` variant. *Signature*: information density done cleanly. *Pick if* the primary user is power-heavy and desktop-first. Risk: tension with the airy taste doc — would relax some whitespace.

> All four share the same token architecture; switching direction mostly changes type pairing, density, and where the one bold spend goes — not the engineering.

---

## 11. Decisions (locked — 2026-06-30)

1. **Direction: A "案上 / The Quiet Workbench".**
2. **AI voice face: Source Serif 4** (+ Noto Serif SC for CJK).
3. **Accent: ink indigo `#4742B8`** (light); umber in 护眼, lifted indigo in 夜间.
4. **shadcn style: new-york, base color neutral, CSS variables on.**
5. **Approved** to land the foundation: install Tailwind v4 + shadcn, wire tokens, deprecate old CSS — as the first build task.

6. **Button: 实心胶囊** — primary = compact solid accent, full-radius (`--radius-pill`); refined light/thin metrics; icon-only buttons round.
7. **Icon library: lucide-react** — accents at key positions, never boxed, not abused (see §7 Iconography).

### Build sequence
- [x] Tokens promoted: `tokens.draft.css` → `tokens.css`.
- [x] Tailwind v4 + shadcn foundation: `app.css` (`@theme inline` + shadcn aliases), `@tailwindcss/vite` plugin + `@/*` alias (vite + tsconfig), Google Fonts in `index.html`, `cn()` util, `components.json` (new-york/neutral/lucide), deps installed. `vite build` verified — tokens compile into output.
- [x] `global.css` / `theme.css` annotated deprecated (kept until components migrate).
- [ ] Build the component library (§7), signature components first.
- [ ] Migrate existing components/pages off the old class CSS, then delete it.

> Note: `npm run build` runs `tsc && vite build`; `tsc` will also type-check the **legacy** components (not yet migrated), which may surface pre-existing errors. The Tailwind/vite build pipeline itself is verified green.

*Non-goals for the foundation task: no product pages, no routing, no rewriting existing components — only the design-system plumbing.*
