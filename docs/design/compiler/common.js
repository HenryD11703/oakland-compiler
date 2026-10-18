// Shared by the three mockups. Everything shown comes from window.CC (data.js): real output of the compiler for the sieve.
// Nothing here is the product: it only draws that data and switches between the states you can look at (#compile, #compare).
(function () {
  const CC = window.CC;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const int = (n) => Number(n).toLocaleString("en-US");
  const ms = (n) => (n >= 100 ? int(Math.round(n)) : n.toFixed(1)) + " ms";

  /** The highlighted HTML of the source lines from..to (1-based), each as a numbered row. `mark` is a [from, to] range to emphasise. */
  function sourceHtml(from = 1, to = CC.program.lines.length, mark = null) {
    let html = "";
    for (let n = from; n <= to; n++) {
      const parts = CC.program.lines[n - 1] || [];
      const text = parts.map(([cls, t]) => (cls === "ws" ? esc(t) : `<span class="t-${cls}">${esc(t)}</span>`)).join("") || " ";
      const on = mark && n >= mark[0] && n <= mark[1];
      html += `<div class="ln${on ? " on" : ""}"><span class="no">${n}</span><span class="tx">${text}</span></div>`;
    }
    return html;
  }

  /** One line of WebAssembly text, coloured. */
  function watLine(line) {
    return esc(line)
      .replace(/\$[\w:.]+/g, (m) => `<span class="w-id">${m}</span>`)
      .replace(/\b(i32|f64)\b(?![.])/g, (m) => `<span class="w-ty">${m}</span>`)
      .replace(/\((\s*)([a-z0-9_.]+)/g, (m, space, word) => `(${space}<span class="${/^(func|param|result|local|export|import|then|else|memory|global|data|table|elem|module|type|block|loop|if)$/.test(word) ? "w-kw" : "w-op"}">${word}</span>`)
      .replace(/\b(-?\d+)\b/g, (m) => `<span class="w-num">${m}</span>`);
  }

  const watHtml = (lines, count = lines.length) =>
    `<div class="wat"><pre>${lines.slice(0, count).map(watLine).join("\n")}${count < lines.length ? `\n<span class="dim">… ${lines.length - count} more lines</span>` : ""}</pre></div>`;

  const bySize = () => [...CC.module.functions];
  const totalLines = () => CC.module.functions.reduce((sum, f) => sum + f.lines.length, 0);

  /** The state in the URL hash: "compile" (the default) or "compare". */
  const state = () => (location.hash.replace("#", "") === "compare" ? "compare" : "compile");
  function onState(render) {
    render(state());
    window.addEventListener("hashchange", () => render(state()));
  }
  /** A small control for whoever is looking at the mockup (not part of the design). */
  function stateSwitch() {
    const el = document.createElement("div");
    el.className = "caption";
    el.innerHTML = `mockup state: <a href="#compile" style="color:inherit">compile</a> · <a href="#compare" style="color:inherit">compare</a>`;
    document.body.append(el);
  }

  window.M = { CC, esc, int, ms, sourceHtml, watLine, watHtml, bySize, totalLines, state, onState, stateSwitch };
})();
