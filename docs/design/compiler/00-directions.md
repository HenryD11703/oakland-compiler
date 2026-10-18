# The Compile mode: three directions (task T55, approval gate b of stage 2)

Three mockups of the new part of the page, built from **real data**: the sieve of `bench/sieve.oak`, compiled by the real
compiler (586 bytes, 5 functions, 132 lines of WebAssembly), with the times of `npm run bench` (compile 1.1 ms, run 4.2 ms,
interpreted 1,270 ms, 302× faster, outputs identical). Dark theme, the same tokens as the page. Each one is shown in the two
states that matter, **Compile** and **Compare**, at 1280 px and at 375 px.

Open `index.html` in a browser (after `npm ci`, so the fonts are found), or look at `images/`. Regenerate with
`npx tsx scripts/mockup-compiler-data.ts` and `node scripts/mockup-compiler-shots.mjs`.

What the spec asks of every direction (S-23 to S-25): a mode switch next to Run; in Compile mode the output, the problems and a
**Compiled** panel (the WebAssembly text with foldable functions, the size, the time to compile and the time to run, a click on
a function jumps to its source); the timeline replaced by a sentence that says why it is not there; and **Compare**, which runs
both modes and shows the two times, the ratio and whether the outputs are identical.

## A. The same room (`a-same-room.html`)

The page as it is. The mode is a switch (Interpret | Compile) between *Examples* and the file name. In Compile mode the side
column loses *Now* and *Variables* (there are no steps) and gets three figures (bytes, compile ms, run ms); the views gain a
**Compiled** tab, a list of functions that unfold one by one, each marked *your code* or *runtime*, and the ones of yours say
which source lines they came from. Where the timeline was, one sentence and a **Compare** button; Compare opens as a whole view,
like the four whole views the page already has.
- **For:** the cheapest to build and the most familiar: nothing moves, one tab and one view are added. Compare reuses the whole-view code.
- **Against:** the WebAssembly lives in a narrow column (the lines are long and scroll sideways), and the source and its compiled
  form are never side by side, which is the interesting part of this stage.

## B. Source beside its WebAssembly (`b-side-by-side.html`)

In Compile mode the page becomes two columns that read together: your source (5/12) and the WebAssembly it became (7/12). The
lines of a function of yours are marked with a bar in the source's margin, and the function's header in the WebAssembly points
back to them ("← source lines 1–13"). The runtime the module carries is folded below, out of the way. Output and problems become one
line under the columns (opened with a click). The tape is replaced by a **ledger** (bytes, compile, run, and why there is no timeline)
and the **Compare** button; Compare puts two to-scale bars and the ratio where the ledger was, without leaving the page.
On a phone the two columns are two tabs (Source, WebAssembly).
- **For:** it shows what a compiler does, which is the point of the stage: you read your line and what it became. The wide text gets the room it needs.
- **Against:** the most work of the three: a new layout for Compile mode, and the output/problems drawer. The mapping from a source line to a WebAssembly line does not exist yet (only a whole function maps to its source), so the margin bar marks whole functions.

## C. The ledger (`c-ledger.html`)

The numbers are the page. The mode is a row of three words, **Interpret · Compile · Compare**; Compare is a mode that runs both
and keeps both on screen. The side column is a ledger of the module's functions: name, where it came from, how many lines, and its
share of the module as a bar; one opens at a time, and opening yours marks its source lines. In Compile mode four large figures sit where
the tape was; in Compare the footer is a to-scale chart (each step ten times more, from 0.1 ms to 10 s) and a very large ratio, and
the side column shows both outputs next to each other with the verdict.
- **For:** the strongest identity: it looks like nothing else, and the log-scale chart tells the truth about a 302× difference that a linear bar would hide as a sliver. Compare as a mode is simple to explain.
- **Against:** a switch that is three words is less obvious than a segmented control, and the WebAssembly is again in a column. Compare as a *mode* is not quite what the spec says (an action that runs both); it would need a line in the spec.

## My recommendation

**B, with C's chart for Compare.** The stage is about seeing what a compiler does, and B is the only direction where a line of
yours and its compiled form are on screen together. C's log-scale chart is better than B's linear bars (at 302× the compiled bar
is a hairline either way, but the log scale labels it honestly), so take it. A is the fallback if time runs out: it is what
"If it is too much" in `03-tasks.md` keeps as the minimum (a Compile button with the WAT visible).

Honest limits, true of all three: the WebAssembly is shown as the compiler prints it, with names like `$n.1` and `$break.7`
(a reader has to learn them; a legend is an option); the numbers are from one machine; and only whole functions map to source lines.
