// Shared by the three mockups. Everything shown comes from window.OAK (data.js), which is real output of the
// rebuilt interpreter for the diamond program. Nothing here is the product: it only draws that data.
(function () {
  const OAK = window.OAK;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const int = (n) => Number(n).toLocaleString("en-US");

  /** The highlighted HTML of source line n (1-based). Classes: kw ty lit num str cm id fn p ws. */
  function codeLine(n) {
    const parts = OAK.program.lines[n - 1] || [];
    return parts.map(([cls, text]) => (cls === "ws" ? esc(text) : `<span class="t-${cls}">${esc(text)}</span>`)).join("") || " ";
  }

  /** Names assigned or declared on each line of the program, to show values next to the code. */
  const lineVariables = {};
  OAK.program.source.split(/\r?\n/).forEach((text, i) => {
    const m = /^\s*(?:float|int|string|boolean|char|var)?\s*([A-Za-z_]\w*)\s*=[^=]/.exec(text);
    if (m) lineVariables[i + 1] = m[1];
  });

  /** The index of the snapshot nearest to a step number. */
  const snapshotFor = (step) => OAK.snapshots.reduce((best, s, k) => (Math.abs(s.index - step) < Math.abs(OAK.snapshots[best].index - step) ? k : best), 0);
  const FEATURED = snapshotFor(4200);

  const outputAt = (snap) => OAK.run.stdout.slice(0, snap.printedChars);
  const variable = (snap, name) => snap.variables.find((v) => v.name === name);

  /** The `. . * *` art with the row being drawn marked. */
  function outputRows(snap) {
    const rows = outputAt(snap).split("\n");
    if (rows[rows.length - 1] === "") rows.pop();
    return rows;
  }

  /** A transport that moves through the snapshots; `onChange(k)` is called with the new snapshot index. */
  function player(onChange, start) {
    let k = start;
    let timer = null;
    const last = OAK.snapshots.length - 1;
    const api = {
      get k() {
        return k;
      },
      go(next) {
        k = Math.max(0, Math.min(last, next));
        onChange(k);
        if (k === last) api.pause();
      },
      step(d) {
        api.go(k + d);
      },
      play(speedMs) {
        api.pause();
        if (k === last) k = 0;
        timer = setInterval(() => api.step(1), speedMs || 250);
        document.body.classList.add("playing");
      },
      pause() {
        clearInterval(timer);
        timer = null;
        document.body.classList.remove("playing");
      },
      toggle() {
        timer ? api.pause() : api.play();
      },
      get playing() {
        return timer !== null;
      },
    };
    onChange(k);
    return api;
  }

  /** Wires data-tab buttons to data-pane panels inside `root`. */
  function tabs(root) {
    const buttons = [...root.querySelectorAll("[data-tab]")];
    const panes = [...root.querySelectorAll("[data-pane]")];
    const show = (name) => {
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
      panes.forEach((p) => (p.hidden = p.dataset.pane !== name));
    };
    buttons.forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
    show(buttons[0].dataset.tab);
    return show;
  }

  /** The pruned syntax tree as nested lists of {kind,label,children}. */
  const astHtml = (node) =>
    `<li><span class="ast-node ast-${esc(node.kind)}"><b>${esc(node.kind)}</b> <i>${esc(node.label)}</i></span>` +
    (node.children.length ? `<ul>${node.children.map(astHtml).join("")}</ul>` : node.more ? `<ul><li class="ast-more">… ${node.more} more</li></ul>` : "") +
    "</li>";

  const symbolsRows = () =>
    OAK.symbols
      .map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.kind)}</td><td>${esc(s.type)}</td><td>${esc(s.scope)}</td><td>${s.line}:${s.column}</td></tr>`)
      .join("");

  const problemsRows = () =>
    OAK.problems.items
      .map((p) => `<li><span class="phase">${esc(p.phase)}</span><span class="where">${p.line}:${p.column}</span><span class="msg">${esc(p.message)}</span></li>`)
      .join("");

  window.M = { OAK, esc, int, codeLine, lineVariables, snapshotFor, FEATURED, outputAt, outputRows, variable, player, tabs, astHtml, symbolsRows, problemsRows };
})();
