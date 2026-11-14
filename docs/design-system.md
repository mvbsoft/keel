# The keel design system

Every page keel makes (the usage page, the feature page) has one look. The look is defined once, in
`plugins/keel/templates/design/`. A page has no colours, fonts or radii of its own: its `style.css` only
lays things out and takes everything else from the system. A change of style is made in `keel.css`, and
both pages follow in the same change. `tests/design-system.test.js` enforces this.

## Where it lives

| File | What it holds |
|---|---|
| `plugins/keel/templates/design/keel.css` | Every colour token for both themes, the fonts, the radii and the shared components. |
| `plugins/keel/templates/design/keel-theme.js` | `window.KeelTheme`: `get()`, `set(theme)`, `control({ label, dark, light })` (returns the theme switch). `set` fires the document event `keel-theme`, for a page that draws by theme. |
| `plugins/keel/templates/design/keel-mark.png` | The brand mark (`docs/images/keel-mark.png` at 80 by 48 px); `keel.css` draws it in front of `.brand`. |

A page's `index.html` is a fragment: it has no doctype, `html`, `head` or `body` tag, because the publish
tool wraps it in its own document. At the top of the page file, before the page's first element, it
loads in this order: the Google Fonts link (IBM Plex Sans 400, 500, 600 and IBM Plex Mono 400, 500),
`keel.css`, the page's `style.css`, then `<script src="keel-theme.js"></script>`. The script is a plain
one, not deferred and not a module, so it sets the theme before the first paint. The right side of the
header holds `KeelTheme.control(...)` with the page's translated texts.

The build scripts copy the three design files beside the page, and the publish step in each skill text
(`_shared/usage-page.md`, `_shared/feature-page-build.md`) publishes them with the page. The design
files are listed once, as `DESIGN_FILES` in `plugins/keel/scripts/lib/design-files.js`. The feature
page's file list is `PAGE_ASSETS` in `plugins/keel/scripts/feature-page.js` (`style.css`, `page.js` and the
design files); the usage page's is `PAGE_FILES` in `plugins/keel/scripts/usage-setup.js` plus the design
files. A published page therefore carries its own copy of the system.

## Theme

A page opens dark, whatever the system or the host asks for: there is no `prefers-color-scheme` anywhere.
Light is a manual switch in the header. The choice is kept in the browser's `localStorage` (key
`keel-theme`) for that page; every published page has its own storage, so the choice is per page and per
browser. Where storage is blocked (a private window, a preview) the choice lasts for the visit.

The dark tokens are `:root { color-scheme: dark; ... }`; the light tokens are
`:root[data-keel-theme="light"] { color-scheme: light; ... }`. Both blocks define the same names. That
selector is the only theme selector a page may use.

## Colour tokens

Neutrals are [Radix Colors](https://www.radix-ui.com/colors) slate, the accent is Radix blue, the status
colours are Radix green, amber, red, blue and indigo. A status colour is the scale's step 11 (text) on its
step 3 (background). In the light theme step 11 is moved toward step 12 until the text reads at 4.5:1 on
every surface it is put on, because the band and the soft backgrounds are darker than white.

### Surfaces and lines

| Token | Dark | Light | Role | Source |
|---|---|---|---|---|
| `--bg` | `#111113` | `#f9f9fb` | Page background | slate 1 (dark), 2 (light) |
| `--card` | `#18191b` | `#ffffff` | Cards, tiles, windows, the active tab | slate 2, white |
| `--band` | `#212225` | `#f0f0f3` | Inset areas: tracks, code blocks, hovered tabs, sub-blocks | slate 3 |
| `--pop` | `#272a2d` | `#ffffff` | Small floating panels (`.pop`) and menus (`.menu`) | slate 4, white |
| `--pop-hover` | `#363a3f` | `#f0f0f3` | The item under the pointer or the keyboard in a menu | slate 6 (dark), 3 (light) |
| `--line` | `#363a3f` | `#d9d9e0` | Rules, field borders, table lines | slate 6 |
| `--card-line` | `#2e3135` | `#d9d9e0` | Card borders | slate 5 (dark), 6 (light) |

### Text

| Token | Dark | Light | Role | Source |
|---|---|---|---|---|
| `--ink` | `#edeef0` | `#1c2024` | Body text, headings | slate 12 |
| `--muted` | `#b0b4ba` | `#60646c` | Labels, hints, secondary text | slate 11 |
| `--faint` | `#8b8d98` | `#60646c` | Quietest text, the "other" series | slate 9 (dark), 11 (light) |

### Accent

| Token | Dark | Light | Role | Source |
|---|---|---|---|---|
| `--accent` | `#70b8ff` | `#0d6cc1` | Links, focus ring, the "next" state | blue 11 |
| `--accent-soft` | `#0d2847` | `#e6f4fe` | Soft accent background | blue 3 |
| `--on-accent` | `#0d1520` | `#ffffff` | Text on an `--accent` fill | blue 1 (dark), white |
| `--fill` | `#3b9eff` | `#0588f0` | Single-colour bars and marks | blue 10 |

### Brand run

| Token | Dark | Light | Role | Source |
|---|---|---|---|---|
| `--brand-a`, `--brand-b` | `#2f7df0`, `#23afd0` | `#1b5fd9`, `#12b5d6` | The mark's blue-to-cyan run; used once per page, in the plan limit meter and its chart | the brand mark |
| `--mark` | `url("keel-mark.png")` | same | The mark image of `.brand` | `keel-mark.png` |

### Status

Each status is a text colour on its own soft background. `info` is the blue of the accent; `violet` marks
the API state.

| Token | Dark | Light | Role | Source |
|---|---|---|---|---|
| `--good`, `--good-soft` | `#3dd68c`, `#132d21` | `#207c54`, `#e6f6eb` | Done, healthy | green 11, 3 |
| `--wait`, `--wait-soft` | `#ffca16`, `#302008` | `#a25f03`, `#fff7c2` | Waiting, a note | amber 11, 3 |
| `--risk`, `--risk-soft` | `#ff9592`, `#3b1219` | `#cc2c31`, `#feebec` | Trouble, a trap | red 11, 3 |
| `--info`, `--info-soft` | `#70b8ff`, `#0d2847` | `#0d6dc3`, `#e6f4fe` | In progress, an example | blue 11, 3 |
| `--violet`, `--violet-soft` | `#9eb1ff`, `#182449` | `#3a5bc7`, `#edf2fe` | API-priced use | indigo 11, 3 |

### Chart series

Eight hues, in this order: neighbouring series stay apart for colour-blind readers. Keep the order; do
not pick series colours by eye.

| Token | Dark | Light |
|---|---|---|
| `--c1` | `#3987e5` | `#2a78d6` |
| `--c2` | `#d95926` | `#eb6834` |
| `--c3` | `#199e70` | `#1baf7a` |
| `--c4` | `#c98500` | `#eda100` |
| `--c5` | `#d55181` | `#e87ba4` |
| `--c6` | `#008300` | `#008300` |
| `--c7` | `#9085e9` | `#6250d6` |
| `--c8` | `#e66767` | `#e34948` |

### Token kinds

The four kinds of tokens (input, cache write, cache read, output) are one hue in four steps, Radix cyan:
dark steps 11, 9, 8, 7; the light theme reverses the order so that `--k1` is always the step that stands out most on `--card`.

| Token | Dark | Light |
|---|---|---|
| `--k1` | `#4ccce6` | `#0d3c48` |
| `--k2` | `#00a2c7` | `#107d98` |
| `--k3` | `#11809c` | `#00a2c7` |
| `--k4` | `#12677e` | `#3db9cf` |

### Code colouring

| Token | Dark | Light | Colours | Source |
|---|---|---|---|---|
| `--hl-key` | `#9eb1ff` | `#3a5bc7` | Keys, keywords | indigo 11 |
| `--hl-str` | `#3dd68c` | `#207c54` | Strings | green 11 |
| `--hl-fn` | `#70b8ff` | `#0d6dc3` | Functions | blue 11 |
| `--hl-num` | `#ffca16` | `#9d5c05` | Numbers | amber 11 |
| `--hl-com` | `#8b8d98` | `#60646c` | Comments | slate 9, 11 |

### Overlay

| Token | Dark | Light | Role |
|---|---|---|---|
| `--scrim` | `rgb(0 0 0 / .6)` | `rgb(0 0 0 / .45)` | The dimming behind a window (`.shade`) |
| `--shadow` | `0 12px 32px rgb(0 0 0 / .45)` | `0 12px 32px rgb(0 0 0 / .14)` | Shadow of windows and panels |

### Model families

The same in both themes: a family keeps its series colour on every chart. `-2` is a softer step for an
older model of the family: 55 % of the family colour mixed with 45 % of `--card`.

| Token | Value |
|---|---|
| `--m-fable`, `--m-opus`, `--m-sonnet`, `--m-haiku` | `--c1`, `--c3`, `--c7`, `--c5` |
| `--m-fable-2`, `--m-opus-2`, `--m-sonnet-2`, `--m-haiku-2` | `color-mix(in oklab, <family> 55%, var(--card))` |
| `--m-other` | `--faint` |

### Fonts and radii

| Token | Value | Role |
|---|---|---|
| `--font-ui` | IBM Plex Sans, then system fonts | Everything except numbers and code |
| `--font-mono` | IBM Plex Mono, then system monospace | Numbers, code, keys |
| `--r-sm`, `--r-md`, `--r-lg`, `--r-pill` | 6, 10, 14, 99 px | Small marks and focus ring; fields and buttons; cards; pills and tabs |
| `--gutter` | 28 px, 16 px at 480 px and below | The page's side padding; it is never less than the device's safe-area inset, so a system bar at a phone's side does not cover the page |

## Rules for colour

- Text reaches 4.5:1 and marks (bars, fills, dots, lines) reach 3:1 against the surface they sit on
  (WCAG 2.2, 1.4.3 and 1.4.11). The test checks every pair, in both themes.
- Chart series reach 3:1 on `--card` in the dark theme and 2:1 in the light one. In the light theme some
  series (an amber, a pink) are below 3:1, which is why every chart also shows its numbers as text or a
  table. The token kinds are four steps of one hue and reach 2:1 only, for the same reason.
- Status colours are never chart series, and series colours never carry a status.
- A status is never shown by colour alone: it always has a word or an icon.
- The brand run appears once per page.
- A new colour is taken from a published scale, added to both themes and added to the test's pairs. It is
  never chosen by eye.
- No colour literal (hex, `rgb()`, `hsl()`, `oklch()`, a named colour) outside `keel.css`, in CSS, HTML
  or JavaScript. A page writes `var(--token)` or uses a class of the system.

## Type and shape

Text is IBM Plex Sans, 15 px with a line height of 1.5. Numbers and code are IBM Plex Mono with tabular
figures (`.mono`, `.num`, the right-aligned table cells), so columns of numbers line up. Sizes in use:
44 px (`.big`, 36 px on a narrow screen) and 26 px (`.ft`) for headline figures, 24 px (`.mid`), 20 px
for a window's title, 16 px for a card's title and `.lead`, 14 px for controls and tables, 13 px for
labels and hints (`.lbl`, `.small`, `.hint`), 12 px for `.eyebrow` and chart axes. Radii are the three
`--r-*` steps and the pill.

## Components

Each is a class (or a few) in `keel.css`; a page uses them as they are.

- **Page and header:** `.wrap` (centred column, 1264 px at most), `.top` (header row), `.brand` (mark and
  name; a `span` in it is the quiet part), `.tabs` (`a` or `button` items, `.on` for the current one),
  `.right` (the header's right side, where the theme switch goes).
- **Controls:** `.seg` (a small set of choices where one is always on: each choice is its own pill with
  no shared frame, the chosen one filled like a set `.chip`, and they wrap to the next row; `.seg.icons` for
  icon-only buttons, which is what `KeelTheme.control` returns), `.field` (a text input; a date button, see Calendar below, looks the same), `.btn` (`.sm`; `.n` is a count badge inside it), `.xbtn`
  (icon button, for closing or stepping), `.link` (a button that looks like a link), `.ic` (a 16 px line icon).
- **Layout:** `.grid` with `.c2`, `.c3`, `.c4`, `.c5`, `.c6`, `.c7`, `.c8`, `.c12` (twelve columns, one
  column below 860 px), `.card` (with a `header`, an `h2` and a `.hint`), `.row`, `.col`, `.spread`,
  `.facts` (a row of three small figures under a card's main one), `.tiles` and `.tile` (summary
  figures), `.foot`, `.empty`.
- **Type:** `.big`, `.mid`, `.lbl`, `.ft`, `.lead`, `.eyebrow`, `.bh` (small upper-case block heading),
  `.key` (a keyboard key or a short literal), `code`, `pre.code` (a code block), `.muted`, `.small`.
- **Plan limit meter:** `.meter` with an `i` child as the fill; `.meter.thin` for a small one. It shows
  only how full the window is: no thresholds and no warning colours.
- **Pills and chips:** `.pill` with `.good`, `.wait`, `.risk`, `.api`, `.level` or `.doing`, and the
  states `.next` (ring) and `.unknown` (dashed); add `.st` for the state dot. `.chip` (a filter; `.set`
  when it is on; `.sm` for a read-only one). `.dot` (a small rounded square, for a legend), `.sdot` (a round state dot: `.done`,
  `.waiting`, `.doing`, `.next`, `.unknown`), `.legend`.
- **Series fills:** a class puts a series colour on any mark: `.fable`, `.opus`, `.sonnet`, `.haiku` (and
  `-2`), `.m-other`, `.s1` to `.s8`, `.kind1` to `.kind4`, `.one` (the single-colour fill).
- **Bars and charts:** `.bars` and `.bar` (name, bar `.track`, value, `.pct`), `.chart` (stacked
  columns `.colm` on a quiet grid, with `.y` axis labels) and `.xaxis`, `.stack` (one stacked bar),
  `.prog` (progress of a plan: `.done`, `.waiting`, `.doing`).
- **Tables:** wrap a table in `.scroll` so it scrolls inside itself on a narrow screen; `th.r` and
  `td.r` align numbers right; `.t` (a row's title), `.m` (its quiet line), `tfoot` for a total row,
  `tr.pick` for a clickable row.
- **Text blocks:** `.sub` (a labelled inset block), `.callout` with `.trap`, `.example` or `.note`.
- **Windows:** `.shade` (the dimmed layer), `.sheet` with `.shead` and `.sbody` (the window), `.pop` (a
  small floating panel).
- **Menus:** a choice from a list is a `.menu-wrap` holding a `.menu-btn` (a `.chip`, a `.btn` or, inside
  a sentence, `button.inline`: the chosen word in the accent colour, with no frame and no underline) and a `.menu` of `.menu-item` rows; the chosen row has
  `aria-selected="true"` and shows its check, `.at` marks the row the keyboard is on, `.end` and `.up`
  open the list from the right edge or upwards. A page never shows the browser's own select list.
- **Calendar:** a date is a `.cal-wrap` holding a `.cal-btn` (a `.field` with a small calendar icon and the
  date as text) and a `.cal` panel, the same panel as a menu (it shares the menu's look and its `.end` and
  `.up`). The panel has a `.cal-head` (the `.cal-title` month between two `.xbtn.cal-nav` buttons) and a
  `.cal-grid` of `.cal-row` weeks that start on Monday; a `.cal-day` is 36 px square, the chosen one has
  `aria-selected="true"` and looks like a chosen menu row, today has `aria-current="date"` and a thin accent
  ring, and `.at` marks the day the keyboard is on (a thicker ring, drawn only while the keyboard is in
  use). A page never shows the browser's own
  date picker.

Below 860 px the grid collapses to one column; at 480 px and below the page padding (`--gutter`) and the
largest figure get smaller and `.tabs` scrolls sideways inside itself. A page works at 375 px with no sideways scroll of the
page itself.

## Adding a page or changing the style

To add a page:

1. Load the system at the top of the page file as described under [Where it lives](#where-it-lives)
   (a fragment, no `head` or `body` tag), and put `KeelTheme.control(...)` in the header's `.right`.
2. Write `style.css` for layout only, with `var(--token)` for anything coloured. Use the components above
   before writing a new one.
3. Make the build script copy the three design files beside the page, and the publish step publish them.
4. Add the page to `PAGES` in `tests/design-system.test.js`, so its files are checked too.
5. If the page draws on a canvas or in SVG, read colours from the tokens when it draws and draw again on
   the `keel-theme` event.

To change the style, edit `keel.css` (and this page, which lists every token) and run
`node --test tests/design-system.test.js`. The test fails when a page holds a colour literal, uses a token
that is not defined, when one theme lacks a token the other has, when a text or mark pair falls below its
ratio, when a page loads the system in a different way, and when this document does not name a token.
