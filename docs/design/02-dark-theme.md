# Dark theme and resizable panels

Requested by Henry after using the first version (2026-10-15). Direction A ("Proof") keeps its identity: warm paper tones turned into a warm near-black, and the one accent (the proofreader's red) brightened so that it still reads on dark.

## Palette

| Token | Value | Role |
|---|---|---|
| `--paper` | `#14130f` | page and editor |
| `--paper-2` | `#1c1a15` | transport bar, menus, tooltips |
| `--ink` | `#ece6d6` | text, the Run button |
| `--dim` | `#a8a08c` | secondary text, line numbers, comments |
| `--rule` / `--edge` | `#36332b` / `#4a463b` | hairlines inside a panel / borders between panels |
| `--mark` | `#ff6b3d` | the only accent: "now" and "changed" |

Contrast, measured with the WCAG formula (the E2E suite runs axe on every panel as well):

| Pair | Ratio |
|---|---|
| ink on paper | 14.9 |
| dim on paper / on paper-2 | 7.1 / 6.7 |
| mark on paper / on paper-2 | 6.6 / 6.1 |
| mark on the active-line wash | 5.5 |
| dim on the active-line wash | 6.0 |
| string colour `#d3bf8e` on paper | 10.3 |
| punctuation `#cfc8b4` on paper | 11.1 |

The light theme is gone, not hidden: the colours live in tokens, so a second theme is a matter of redefining them, but nothing in v1 needs it.

## Panels

Two dividers, both reachable by mouse, touch and keyboard (`role="separator"`):

- between the code and the right column (width, 320 px minimum; the code keeps at least 360 px);
- between *Variables* and the views (height, 72 px minimum; the views keep at least 160 px).

Arrow keys move 16 px, Shift 64 px, Home and End go to the limits, Enter or a double click restores the default. The sizes are kept in `localStorage` (`oakland:layout`). On a phone the panels are tabs and there are no dividers.

The timeline lanes are not resizable: they are drawn at fixed row heights and scaling them would need the drawing rewritten.

## Output and scrollbars

The output text went from 11.5 px to 14 px. The tab panel that is showing scrolls, both ways, inside the space the views have, so a wide output (the Heart example) no longer needs a bar of its own. Scrollbars are thin and take the border colour (`scrollbar-width`, `scrollbar-color`).
