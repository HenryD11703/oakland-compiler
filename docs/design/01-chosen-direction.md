# Chosen direction (approval gate b, 2026-10-15)

**Henry chose A (Proof) with B's (Reel) timeline as the step control. The syntax tree is a tab ("Syntax tree").**

What that means for the build, from `00-directions.md` and the mockups in `mockups/`:

- **Look:** Proof. Paper `#f2eee4`, ink `#14130f`, one vermilion `#c9340e` for "now" and "changed"; Instrument Sans for the interface, Spline Sans Mono for code; ruled tables, small-caps labels, a thick rule on top. Light only (the spec leaves a dark theme out of v1).
- **Layout (1280 px):** source on the left (7/12), a column on the right with *Now*, *Variables* and the tabs *Output · Problems · Syntax tree · Symbols*; the transport along the bottom. At 375 px the views become tabs *Code · State · Views* with the transport fixed at the bottom.
- **Transport:** Reel's timeline instead of a plain slider. Lanes drawn from the whole trace, not a sample: the line being run, the conditions (held / did not), the output printed, and the values of up to two numeric variables over time. A playhead you drag or move with the keyboard, plus first / back / play / forward and a speed control.
- **Values next to the code:** Proof's feature. The mockup put them in a right-hand column; in the real editor they are shown at the end of each line that assigns a variable (`x = 8.0`), because a column outside the editor would have to be kept aligned while the editor scrolls sideways. Same information, same place on screen in effect.
- **Not in the mockups, still needed:** an examples menu that loads the cleaned programs, open and save of `.oak` files, the run / stop buttons, squiggles under mistakes in the editor, click-to-jump from Problems, Symbols and the tree.
- **Fonts are bundled**, not loaded from Google Fonts (principle 9: nothing leaves the browser, and the page must work offline once loaded).
