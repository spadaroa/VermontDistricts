/* Vermont School District Builder — app */
(function () {
  "use strict";
  const D = window.DATA, E = window.Engine;
  const m = E.buildModel(D);
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  // ---------- constants ----------
  const RANGES = [
    { id: "2k", lo: 2000, hi: Infinity, label: "2,000 or more students", info: "The minimum combined ADM for an Act 170 merger committee (2026)." },
    { id: "2-4k", lo: 2000, hi: 4000, label: "2,000–4,000 students", info: "The range in the House Education Committee's first consolidation map (February 2026), following the Vermont Superintendents Association." },
    { id: "4-8k", lo: 4000, hi: 8000, label: "4,000–8,000 students", info: "The range Act 73 (2025) set for the Redistricting Task Force." },
  ];
  // district fills: medium-light tones that read in both themes
  const PAL = ["#8dd3c7", "#fdb462", "#bebada", "#fb8072", "#80b1d3", "#b3de69", "#fccde5", "#d9c27a", "#bc80bd", "#ccebc5", "#ffed6f", "#9fb8a0", "#e5a3a3", "#a6cee3"];
  const LEVEL_FIELDS = { glps: 1, pov: 1, chg: 1, st: 1, dens: 1, size: 1 };
  const fmt = (v) => Math.round(v).toLocaleString("en-US");
  const pct = (v, d = 0) => (v * 100).toFixed(d) + "%";
  const sgn = (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%";
  const money = (k) => (k >= 1000 ? "$" + (k / 1000).toFixed(2) + "M" : "$" + Math.round(k) + "K");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- presets ----------
  const PRESETS = D.presets.map((p, i) => ({ id: "p" + i, name: p.name, desc: p.desc, plan: p.plan, names: p.names }))
    .concat((window.GENERATED || []).map((g) => ({ id: g.id, name: g.name, desc: g.desc, plan: g.plan, names: g.names, range: g.range, generated: true })));
  const SU_PLAN = Int16Array.from(D.presets[0].plan), SU_NAMES = D.presets[0].names;

  // ---------- state ----------
  const S = {
    plan: null, K: 0, names: [], colors: [], sel: 0, tool: "pan", brushSU: false, preset: "p0", range: "2k",
    colorBy: "district", level: "town", overlay: "su", dots: false, undo: [], redo: [], st: null, base: null,
  };
  let busy = false;

  function setPlan(plan, K, names, opts) {
    opts = opts || {};
    S.plan = Int16Array.from(plan); S.K = K; S.names = (names || []).slice(0, K); while (S.names.length < K) S.names.push("");
    if (S.sel >= K) S.sel = 0;
    if (!opts.keepColors) S.colors = [];
    if (!opts.keepUndo) { S.undo = []; S.redo = []; }
    recolor(); refresh();
  }
  function rangeObj() { return RANGES.find((r) => r.id === S.range) || RANGES[0]; }
  function nameOf(d) {
    if (S.names[d]) return S.names[d];
    let b = -1; for (let i = 0; i < m.n; i++) if (S.plan[i] === d && (b < 0 || m.st[i] > m.st[b])) b = i;
    return b >= 0 ? m.U[b].name + " area" : "Empty district";
  }

  // greedy coloring: keep each district's color unless a neighbor shares it
  function recolor() {
    const K = S.K, adj = Array.from({ length: K }, () => new Set());
    for (let i = 0; i < m.n; i++) for (let k = m.nbStart[i]; k < m.nbStart[i + 1]; k++) {
      const a = S.plan[i], b = S.plan[m.nb[k]]; if (a >= 0 && b >= 0 && a !== b) adj[a].add(b);
    }
    const col = new Array(K).fill(-1);
    const order = [...Array(K).keys()].sort((a, b) => adj[b].size - adj[a].size);
    for (const d of order) {
      const used = new Set([...adj[d]].map((x) => col[x]).filter((c) => c >= 0));
      const prev = S.colors[d];
      if (prev != null && prev >= 0 && !used.has(prev)) { col[d] = prev; continue; }
      let c = d % PAL.length; for (let t = 0; t < PAL.length && used.has(c); t++) c = (c + 1) % PAL.length;
      col[d] = c;
    }
    S.colors = col;
  }
  const colorOf = (d) => (d >= 0 && S.colors[d] >= 0 ? PAL[S.colors[d]] : "var(--chip)");

  // ---------- map ----------
  const svg = $("map");
  let VB0, view;
  const gTowns = document.createElementNS(SVGNS, "g"), gOvl = document.createElementNS(SVGNS, "g"), gLines = document.createElementNS(SVGNS, "g"),
    gState = document.createElementNS(SVGNS, "g"), gDots = document.createElementNS(SVGNS, "g"), gLbl = document.createElementNS(SVGNS, "g"), gHov = document.createElementNS(SVGNS, "g");
  [gTowns, gOvl, gLines, gState, gDots, gLbl, gHov].forEach((g) => svg.appendChild(g));
  const ringD = (r) => "M" + r.map((p) => p[0] + "," + -p[1]).join("L") + "Z";
  const lineD = (l) => "M" + l.map((p) => p[0] + "," + -p[1]).join("L");
  const townEls = m.U.map((u, i) => {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", u.shape.map((poly) => poly.map(ringD).join("")).join(""));
    p.setAttribute("class", "town"); p.dataset.i = i; gTowns.appendChild(p); return p;
  });
  { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("class", "state"); p.setAttribute("d", D.state.map((poly) => poly.map(ringD).join("")).join("")); gState.appendChild(p); }
  const edgeEls = D.edges.map(([i, j, ls]) => {
    const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", ls.map(lineD).join("")); p.setAttribute("class", "dline"); p.style.display = "none"; gLines.appendChild(p);
    const q = document.createElementNS(SVGNS, "path"); q.setAttribute("d", ls.map(lineD).join("")); q.setAttribute("class", "ovl"); q.style.display = "none"; gOvl.appendChild(q);
    return { i, j, p, q };
  });
  {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const u of m.U) for (const poly of u.shape) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, -y); y1 = Math.max(y1, -y); }
    VB0 = { x: x0 - 6, y: y0 - 6, w: x1 - x0 + 12, h: y1 - y0 + 12 };
  }
  function fit() {
    const r = svg.getBoundingClientRect(), W = Math.max(r.width, 1), H = Math.max(r.height, 1);
    // keep the state clear of the toolbar (left) and, on wide screens, the open Topline card (right)
    const wide = W > 700 && window.innerWidth > 860;
    const tlOpen = wide && $("topline").open && getComputedStyle($("topline")).display !== "none";
    const L = wide ? 62 : 8, R = tlOpen ? 336 : 8, T = W <= 700 ? 56 : 10, B = 10;
    const aw = Math.max(W - L - R, W * 0.4), ah = Math.max(H - T - B, H * 0.5);
    const k = Math.max(VB0.w / aw, VB0.h / ah); // km per pixel
    const cx = VB0.x + VB0.w / 2, cy = VB0.y + VB0.h / 2;
    const px = L + aw / 2, py = T + ah / 2;
    view = { x: cx - px * k, y: cy - py * k, w: W * k, h: H * k };
    applyView();
  }
  function applyView() { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); drawLabels(); drawDots(); }
  function zoomAt(f, cx, cy) {
    const nw = Math.min(Math.max(view.w * f, 8), VB0.w * 3), k = nw / view.w;
    view = { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w: nw, h: view.h * k }; applyView();
  }
  function toSvg(ev) { const r = svg.getBoundingClientRect(); return [view.x + ((ev.clientX - r.left) / r.width) * view.w, view.y + ((ev.clientY - r.top) / r.height) * view.h]; }

  // ---------- shading ----------
  function townVal(i, f) {
    const u = m.U[i];
    if (f === "glps") return m.st[i] > 0 ? m.gl[i] / m.st[i] : null;
    if (f === "pov") return m.pt[i] >= 20 ? m.pb[i] / m.pt[i] : null;
    if (f === "chg") return m.y14[i] > 0 ? m.st[i] / m.y14[i] - 1 : null;
    if (f === "st") return m.st[i];
    if (f === "dens") return m.st[i] / Math.max(u.sqmi, 0.1);
    return null;
  }
  function distVal(d, f) {
    const s = S.st.D[d]; if (!s || !s.towns.length) return null;
    if (f === "glps") return s.st ? s.glps : null; if (f === "pov") return s.pov; if (f === "chg") return s.chg;
    if (f === "st") return s.st; if (f === "dens") return s.st / Math.max(s.area, 0.1);
    return null;
  }
  const RAMP = {
    glps: { lo: 300, hi: 3000, log: true, c: ["#f2f0e6", "#2e6b3f"], f: money, label: "Grand list per student" },
    pov: { lo: 0, hi: 0.3, c: ["#f4efe8", "#9c3d24"], f: (v) => pct(v), label: "Children 5–17 in poverty" },
    chg: { lo: -0.4, hi: 0.4, div: true, c: ["#b3502e", "#f2f0ea", "#2f6c9a"], f: (v) => sgn(v), label: "Students, change since 2014–15" },
    st: { lo: 10, hi: 4000, log: true, c: ["#eef0f3", "#28466b"], f: fmt, label: "Public school students" },
    dens: { lo: 0.5, hi: 200, log: true, c: ["#eef0f3", "#4b2d6b"], f: (v) => v.toFixed(v < 10 ? 1 : 0), label: "Students per square mile" },
  };
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return "rgb(" + A.map((v, k) => Math.round(v + (B[k] - v) * t)).join(",") + ")"; };
  function rampColor(f, v) {
    const R = RAMP[f]; if (v == null || !isFinite(v)) return "var(--chip)";
    let t = R.log ? (Math.log(Math.max(v, R.lo)) - Math.log(R.lo)) / (Math.log(R.hi) - Math.log(R.lo)) : (v - R.lo) / (R.hi - R.lo);
    t = Math.min(1, Math.max(0, t));
    if (R.div) return t < 0.5 ? mix(R.c[0], R.c[1], t * 2) : mix(R.c[1], R.c[2], (t - 0.5) * 2);
    return mix(R.c[0], R.c[1], t);
  }
  function sizeColor(d) {
    const s = S.st.D[d]; if (!s || !s.towns.length) return "var(--chip)";
    const r = rangeObj();
    if (s.st < r.lo) return mix("#f6e3d6", "#c0562f", Math.min(1, (r.lo - s.st) / r.lo * 1.4));
    if (s.st > r.hi) return mix("#dce7f2", "#2f5f99", Math.min(1, (s.st - r.hi) / r.hi * 1.4));
    return "#b9dcc0";
  }

  function paintMap() {
    const f = S.colorBy, dist = S.level === "district" || f === "size";
    for (let i = 0; i < m.n; i++) {
      const d = S.plan[i], el = townEls[i];
      let c;
      if (f === "district") c = colorOf(d);
      else if (f === "size") c = d >= 0 ? sizeColor(d) : "var(--chip)";
      else c = dist ? (d >= 0 ? rampColor(f, distVal(d, f)) : "var(--chip)") : rampColor(f, townVal(i, f));
      el.style.fill = c; el.classList.toggle("un", d < 0);
    }
    for (const e of edgeEls) {
      const a = S.plan[e.i], b = S.plan[e.j];
      const on = a !== b;
      e.p.style.display = on ? "" : "none";
      e.p.classList.toggle("sel", on && (a === S.sel || b === S.sel) && S.tool !== "pan");
      let ov = false;
      if (S.overlay === "su") ov = m.U[e.i].su !== m.U[e.j].su;
      else if (S.overlay === "grp") ov = m.U[e.i].grp !== m.U[e.j].grp;
      else if (S.overlay === "cesa") ov = m.U[e.i].cesa !== m.U[e.j].cesa;
      else if (S.overlay === "county") ov = m.U[e.i].county !== m.U[e.j].county;
      e.q.style.display = ov && !on ? "" : "none";
    }
    // put selected-district lines on top
    for (const e of edgeEls) if (e.p.classList.contains("sel")) gLines.appendChild(e.p);
    drawLegend(); drawLabels();
  }
  function drawLegend() {
    const L = $("legend"), f = S.colorBy;
    if (f === "district") { L.hidden = true; return; }
    L.hidden = false;
    if (f === "size") {
      const r = rangeObj();
      L.innerHTML = `<div><b>Size vs. target</b> (${esc(r.label)})</div><div class="dotkey" style="margin-top:6px">` +
        `<span><i class="gdot" style="background:#c0562f"></i>Below</span><span><i class="gdot" style="background:#b9dcc0"></i>In range</span><span><i class="gdot" style="background:#2f5f99"></i>Above</span></div>`;
      return;
    }
    const R = RAMP[f];
    const stops = R.div ? `${R.c[0]},${R.c[1]},${R.c[2]}` : `${R.c[0]},${R.c[1]}`;
    L.innerHTML = `<div><b>${R.label}</b>${S.level === "district" ? " · district average" : ""}</div><div class="bar" style="background:linear-gradient(90deg,${stops})"></div>` +
      `<div class="ends"><span>${R.div ? "" : "≤"}${R.f(R.lo)}</span><span>${R.div ? "" : "≥"}${R.f(R.hi)}</span></div>`;
  }
  function drawLabels() {
    if (!S.st || !view) return;
    gLbl.textContent = "";
    if (S.colorBy !== "district" && S.colorBy !== "size") return;
    const r = svg.getBoundingClientRect(), kpx = view.w / Math.max(r.width, 1);
    const fs = 13 * kpx, placed = [];
    const order = S.st.D.filter((s) => s.towns.length).sort((a, b) => b.st - a.st);
    for (const s of order) {
      const u = m.U[s.largest], x = u.lx, y = -u.ly;
      const w = String(s.d + 1).length * 8 * kpx + 4 * kpx, h = 15 * kpx;
      if (placed.some((p) => Math.abs(p[0] - x) < (p[2] + w) / 2 && Math.abs(p[1] - y) < (p[3] + h) / 2)) continue;
      placed.push([x, y, w, h]);
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("class", "dlbl"); t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("font-size", fs.toFixed(3));
      t.textContent = s.d + 1; gLbl.appendChild(t);
    }
  }
  function drawDots() {
    gDots.textContent = ""; $("dotkey").hidden = !S.dots;
    if (!S.dots || !view) return;
    const k = view.w / 900;
    const col = { P: "#1d4f91", H: "#0f2a4f", I: "#b06a12", C: "#7a2f7a" };
    for (const s of D.schools) {
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", s.x); c.setAttribute("cy", -s.y); c.setAttribute("r", (k * (2 + Math.sqrt(s.e) / 4)).toFixed(3));
      c.setAttribute("class", "dot"); c.style.fill = s.a === "P" ? (s.hs ? col.H : col.P) : col[s.a]; c.style.opacity = s.a === "P" ? 0.9 : 0.75;
      gDots.appendChild(c);
    }
    $("dotkey").innerHTML = `<span><i class="gdot" style="background:${col.P}"></i>Public</span><span><i class="gdot" style="background:${col.H}"></i>Public with grades 9–12</span><span><i class="gdot" style="background:${col.I}"></i>Independent</span><span><i class="gdot" style="background:${col.C}"></i>Career &amp; technical center</span>`;
  }

  // ---------- tooltip ----------
  const tip = $("tip");
  function showTip(i, ev) {
    const u = m.U[i], d = S.plan[i], r = $("mapwrap").getBoundingClientRect();
    const sch = u.s.map((k) => D.schools[k]).sort((a, b) => b.e - a.e);
    const kind = (s) => (s.a === "P" ? "" : s.a === "I" ? " (indep.)" : " (CTE)");
    tip.innerHTML = `<b>${esc(u.name)}</b> <span class="s">${esc(u.county)} County</span><br>` +
      `<span class="s">Today:</span> ${esc(u.su)}<br>` +
      `<span class="s">Plan:</span> ${d >= 0 ? `District ${d + 1} · ${esc(nameOf(d))}` : "Unassigned"}<br>` +
      `${fmt(u.st)} students · ${u.st ? money(u.gl / u.st) + " grand list per student" : "no resident students"}` +
      (u.pt >= 20 ? `<br>${pct(u.pb / u.pt)} of children in poverty` : "") +
      (sch.length ? `<ul class="sch">${sch.slice(0, 6).map((s) => `<li><span>${esc(s.n)}${kind(s)}</span><span>${s.g} · ${fmt(s.e)}</span></li>`).join("")}${sch.length > 6 ? `<li><span>+${sch.length - 6} more</span><span></span></li>` : ""}</ul>` : "");
    tip.hidden = false;
    const x = ev.clientX - r.left, y = ev.clientY - r.top, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(x + 14, r.width - w - 8) + "px"; tip.style.top = (y + h + 20 > r.height ? y - h - 12 : y + 14) + "px";
  }
  function hoverOutline(i) {
    gHov.textContent = "";
    if (i == null) return;
    const p = document.createElementNS(SVGNS, "path"); p.setAttribute("class", "hov"); p.setAttribute("d", townEls[i].getAttribute("d")); gHov.appendChild(p);
  }

  // ---------- interaction ----------
  let drag = null, space = false; const pointers = new Map();
  function townAt(ev) { const el = document.elementFromPoint(ev.clientX, ev.clientY); return el && el.classList && el.classList.contains("town") ? +el.dataset.i : null; }
  function paintTown(i, stroke) {
    const target = S.tool === "erase" ? -1 : S.sel;
    const list = S.brushSU ? m.U.map((u, k) => (u.su === m.U[i].su ? k : -1)).filter((k) => k >= 0) : [i];
    let changed = false;
    for (const k of list) if (S.plan[k] !== target) { if (!stroke.has(k)) stroke.set(k, S.plan[k]); S.plan[k] = target; changed = true; }
    if (changed) { paintMap(); scheduleRefresh(); }
  }
  svg.addEventListener("pointerdown", (ev) => {
    pointers.set(ev.pointerId, ev); svg.setPointerCapture(ev.pointerId);
    tip.hidden = true;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { type: "pinch", d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), v0: { ...view } }; return; }
    if (S.tool === "pan" || space || ev.button === 1) { drag = { type: "pan", x: ev.clientX, y: ev.clientY, v0: { ...view } }; svg.style.cursor = "grabbing"; return; }
    if (busy) { toast("Auto-balance is running. Stop it to paint."); return; }
    const i = townAt(ev); drag = { type: "paint", stroke: new Map() };
    if (i != null) paintTown(i, drag.stroke);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, ev);
    if (drag && drag.type === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const r = svg.getBoundingClientRect(), mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      const v = drag.v0, nw = Math.min(Math.max(v.w * (drag.d0 / d), 8), VB0.w * 3), k = nw / v.w;
      const cx = v.x + ((mx - r.left) / r.width) * v.w, cy = v.y + ((my - r.top) / r.height) * v.h;
      view = { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w: nw, h: v.h * k }; applyView(); return;
    }
    if (drag && drag.type === "pan") {
      const r = svg.getBoundingClientRect(), v = drag.v0;
      view = { ...v, x: v.x - ((ev.clientX - drag.x) / r.width) * v.w, y: v.y - ((ev.clientY - drag.y) / r.height) * v.h };
      svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); return;
    }
    const i = townAt(ev);
    if (drag && drag.type === "paint") { if (i != null) paintTown(i, drag.stroke); return; }
    if (ev.pointerType === "mouse") { if (i != null) { showTip(i, ev); hoverOutline(i); } else { tip.hidden = true; hoverOutline(null); } }
  });
  function endPointer(ev) {
    pointers.delete(ev.pointerId);
    if (!drag) return;
    if (drag.type === "pan") { svg.style.cursor = ""; applyView(); }
    if (drag.type === "paint" && drag.stroke.size) {
      S.undo.push([...drag.stroke].map(([i, d]) => [i, d, S.plan[i]])); S.redo = []; refresh();
    }
    if (drag.type === "pinch") applyView();
    if (drag.type === "pan" && ev.pointerType !== "mouse" && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) {
      const i = townAt(ev); if (i != null) { showTip(i, ev); hoverOutline(i); }
    }
    drag = pointers.size ? drag : null;
  }
  svg.addEventListener("pointerup", endPointer); svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("pointerleave", () => { if (!drag) { tip.hidden = true; hoverOutline(null); } });
  svg.addEventListener("wheel", (ev) => { ev.preventDefault(); const [x, y] = toSvg(ev); zoomAt(Math.exp(ev.deltaY * 0.0015), x, y); }, { passive: false });

  function setTool(t) {
    S.tool = t; svg.setAttribute("class", "tool-" + t);
    $("tPan").setAttribute("aria-pressed", t === "pan"); $("tPaint").setAttribute("aria-pressed", t === "paint"); $("tErase").setAttribute("aria-pressed", t === "erase");
    brushChip(); paintMap();
  }
  function brushChip() {
    const c = $("brushchip");
    c.hidden = S.tool === "pan";
    $("brushSw").style.background = S.tool === "erase" ? "transparent" : colorOf(S.sel);
    $("brushTxt").textContent = (S.tool === "erase" ? "Erasing" : `District ${S.sel + 1} · ${nameOf(S.sel)}`) + (S.brushSU ? " · whole SU" : "");
  }
  $("tPan").onclick = () => setTool("pan"); $("tPaint").onclick = () => setTool("paint"); $("tErase").onclick = () => setTool("erase");
  $("tBrush").onclick = () => { S.brushSU = !S.brushSU; $("tBrush").setAttribute("aria-pressed", S.brushSU); brushChip(); toast(S.brushSU ? "Brush: a town's whole supervisory union" : "Brush: one town"); };
  $("tIn").onclick = () => zoomAt(0.7, view.x + view.w / 2, view.y + view.h / 2);
  $("tOut").onclick = () => zoomAt(1 / 0.7, view.x + view.w / 2, view.y + view.h / 2);
  $("tFit").onclick = fit;
  function undo(redo) {
    const from = redo ? S.redo : S.undo, to = redo ? S.undo : S.redo; const step = from.pop(); if (!step) return;
    for (const [i, a, b] of step) S.plan[i] = redo ? b : a;
    to.push(step); refresh();
  }
  $("tUndo").onclick = () => undo(false); $("tRedo").onclick = () => undo(true);
  document.addEventListener("keydown", (ev) => {
    if (/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); undo(ev.shiftKey); return; }
    if (ev.key === " ") { space = true; ev.preventDefault(); }
    const k = ev.key.toLowerCase();
    if (k === "h") setTool("pan"); else if (k === "p") setTool("paint"); else if (k === "e") setTool("erase"); else if (k === "b") $("tBrush").click();
  });
  document.addEventListener("keyup", (ev) => { if (ev.key === " ") space = false; });

  // ---------- refresh ----------
  let rTimer = null;
  function scheduleRefresh() { clearTimeout(rTimer); rTimer = setTimeout(() => refresh(true), 120); }
  function refresh(light) {
    const r = rangeObj(), opts = { range: [r.lo, r.hi] };
    S.st = E.stats(m, S.plan, S.K, opts);
    S.base = E.stats(m, SU_PLAN, SU_NAMES.length, opts);
    if (!light) recolorIfNeeded();
    paintMap(); renderSwatches(); renderScore(); renderTopline(); renderTable(); brushChip(); renderPlanHead(); save();
  }
  function recolorIfNeeded() { const before = S.colors.join(); recolor(); if (S.colors.join() !== before) paintMap(); }

  // ---------- plan tab ----------
  function renderPlanHead() {
    const p = PRESETS.find((x) => x.id === S.preset);
    const same = p && p.plan.every((d, i) => d === S.plan[i]);
    $("planName").textContent = p ? (same ? p.name : p.name + " (edited)") : "Your plan";
    $("planDesc").textContent = p ? p.desc : "A plan you started yourself or loaded from a code.";
    const st = S.st;
    $("countLine").innerHTML = `<b>${st.K}</b> districts · <b>${fmt(m.totSt)}</b> public school students in <b>${m.n}</b> towns` +
      (st.unT ? ` · <span class="bad-t">${st.unT} towns (${fmt(st.unSt)} students) unassigned</span>` : "");
    $("rangeInfo").textContent = rangeObj().info + " Counts here are students by town of residence, not ADM.";
  }
  function renderSwatches() {
    const w = $("swatches"); w.textContent = "";
    for (let d = 0; d < S.K; d++) {
      const b = document.createElement("button");
      b.style.background = colorOf(d); b.textContent = d + 1; b.title = `District ${d + 1}: ${nameOf(d)} · ${fmt(S.st.D[d].st)} students`;
      b.setAttribute("aria-pressed", d === S.sel);
      b.onclick = () => selectDistrict(d); w.appendChild(b);
    }
    if (S.K < 60) {
      const a = document.createElement("button"); a.className = "add"; a.textContent = "+"; a.title = "Add a new, empty district";
      a.onclick = () => { S.K++; S.names.push(""); S.colors.push(-1); recolor(); selectDistrict(S.K - 1); if (S.tool === "pan") setTool("paint"); toast(`District ${S.K} added. Paint towns into it.`); };
      w.appendChild(a);
    }
    const nm = $("nameIn"); if (document.activeElement !== nm) nm.value = S.names[S.sel] || "";
    nm.placeholder = nameOf(S.sel);
  }
  function selectDistrict(d) { S.sel = d; if (S.tool === "pan") setTool("paint"); else { brushChip(); paintMap(); } renderSwatches(); renderTopline(); renderTable(); }
  $("nameIn").addEventListener("input", (ev) => { S.names[S.sel] = ev.target.value.trim(); brushChip(); renderTable(); renderTopline(); save(); });
  $("delDist").onclick = () => {
    if (S.K <= 1) return;
    const d = S.sel, step = [];
    for (let i = 0; i < m.n; i++) if (S.plan[i] === d) { step.push([i, d, -1]); S.plan[i] = -1; }
    // renumber: districts after d shift down by one
    const names = S.names.filter((_, k) => k !== d), cols = S.colors.filter((_, k) => k !== d);
    const plan = Int16Array.from(S.plan, (x) => (x < 0 ? -1 : x > d ? x - 1 : x));
    S.plan = plan; S.K -= 1; S.names = names; S.colors = cols; S.sel = Math.min(d, S.K - 1); S.undo = []; S.redo = [];
    toast(`District removed. ${step.length} towns are unassigned.`); refresh();
  };

  function cmp(v, b, better) { // better: "low" | "high"
    if (v === b || better == null) return ["neutral", "same as today"];
    const good = better === "low" ? v < b : v > b; return [good ? "good" : "bad", good ? "better" : "worse"];
  }
  function scoreRows() {
    const s = S.st, b = S.base, r = rangeObj();
    return [
      { k: "Districts", sub: "with at least one town", v: s.K, b: b.K, f: fmt, better: null },
      { k: "In the size target", sub: r.label, v: s.inRange, b: b.inRange, f: (x) => fmt(x), better: "high", tail: (x, o) => `${pct(o.stInRange)} of students` },
      { k: "Smallest district", sub: "students", v: s.minSt, b: b.minSt, f: fmt, better: null },
      { k: "Largest district", sub: "students", v: s.maxSt, b: b.maxSt, f: fmt, better: null },
      { k: "Grand list per student", sub: "highest ÷ lowest district", v: s.glRatio, b: b.glRatio, f: (x) => x.toFixed(1) + "×", better: "low" },
      { k: "Students near state tax capacity", sub: "in districts within 25% of the state's grand list per student", v: s.glNear, b: b.glNear, f: (x) => pct(x), better: "high" },
      { k: "Child poverty segregation", sub: "Theil's H across districts, 0 = even", v: s.povH, b: b.povH, f: (x) => x.toFixed(3), better: "low" },
      { k: "Longest span", sub: "miles between farthest town centers", v: s.maxSpan, b: b.maxSpan, f: (x) => x.toFixed(0) + " mi", better: "low" },
      { k: "Without a public high school", sub: "districts", v: s.noHS, b: b.noHS, f: fmt, better: "low" },
      { k: "SUs split", sub: "today's SUs divided between districts", v: s.susSplit, b: 0, f: fmt, better: "low" },
      { k: "In pieces", sub: "districts whose towns don't all touch", v: s.broken, b: b.broken, f: fmt, better: "low" },
    ];
  }
  function renderScore() {
    const el = $("score"); el.textContent = "";
    for (const row of scoreRows()) {
      const [cls, word] = cmp(+row.v.toFixed(4), +row.b.toFixed(4), row.better);
      const div = document.createElement("div"); div.className = "sr";
      div.innerHTML = `<div class="k">${row.k}<small>${row.sub}${row.tail ? " · " + row.tail(row.v, S.st) : ""}</small></div><div class="v">${row.f(row.v)}</div>` +
        `<div class="c">today ${row.f(row.b)}${row.better ? `<br><span class="pill ${cls}">${word}</span>` : ""}</div>`;
      el.appendChild(div);
    }
  }
  const SHORT = { "In the size target": "In size target", "Smallest district": "Smallest", "Largest district": "Largest", "Grand list per student": "Grand list, high÷low",
    "Child poverty segregation": "Poverty segregation", "Without a public high school": "No public HS" };
  function renderTopline() {
    const s = S.st, b = S.base, d = S.st.D[S.sel];
    const rows = scoreRows().filter((r) => ["Districts", "In the size target", "Smallest district", "Largest district", "Grand list per student", "Child poverty segregation", "Longest span", "Without a public high school", "SUs split"].includes(r.k));
    let h = `<table><tr><th>Statewide</th><th>Today</th><th>Plan</th><th>Chg.</th></tr>`;
    for (const r of rows) {
      const [cls] = cmp(+r.v.toFixed(4), +r.b.toFixed(4), r.better);
      const diff = r.v - r.b;
      const dtxt = Math.abs(diff) < 1e-9 ? "–" : r.k === "Grand list per student" ? (diff > 0 ? "+" : "−") + Math.abs(diff).toFixed(1) + "×" : r.k === "Child poverty segregation" ? (diff > 0 ? "+" : "−") + Math.abs(diff).toFixed(3) : r.k === "Longest span" ? (diff > 0 ? "+" : "−") + Math.abs(diff).toFixed(0) + " mi" : (diff > 0 ? "+" : "−") + fmt(Math.abs(diff));
      h += `<tr><td>${SHORT[r.k] || r.k}</td><td>${r.f(r.b)}</td><td class="p">${r.f(r.v)}</td><td class="dl ${r.better && Math.abs(diff) > 1e-9 ? cls : ""}">${dtxt}</td></tr>`;
    }
    h += `</table>`;
    if (d && d.towns.length) {
      h += `<h3><span class="sw" style="background:${colorOf(S.sel)}"></span>District ${S.sel + 1} · ${esc(nameOf(S.sel))}</h3><table>`;
      const r = rangeObj();
      const rowsD = [
        ["Students", fmt(d.st) + (d.inRange ? "" : d.st < r.lo ? " · below target" : " · above target")],
        ["Towns, today's SUs", `${d.towns.length} towns · ${d.sus.size} SU${d.sus.size === 1 ? "" : "s"}`],
        ["Grand list per student", `${money(d.glps)} · ${sgn(d.glps / m.glps - 1)} vs state`],
        ["Child poverty", `${pct(d.pov, 1)} · state ${pct(m.ppov, 1)}`],
        ["Since 2014–15", sgn(d.chg)],
        ["Span", d.span.toFixed(0) + " mi" + (d.comps > 1 ? ` · <span class="bad-t">${d.comps} pieces</span>` : "")],
        ["Schools", `${d.schools} public · ${d.pubHS} with 9–12${d.indHS ? ` · ${d.indHS} indep. HS` : ""}`],
      ];
      for (const [k, v] of rowsD) h += `<tr><td>${k}</td><td colspan="3" style="text-align:right">${v}</td></tr>`;
      h += `</table>`;
    } else if (d) h += `<h3><span class="sw" style="background:${colorOf(S.sel)}"></span>District ${S.sel + 1}</h3><p class="note">Empty. Paint towns into it.</p>`;
    $("toplineBody").innerHTML = h;
  }
  const tl = $("topline");
  { const v = LS("vtsdb.topline"); if (v === "0" || (v == null && window.matchMedia("(max-width: 860px)").matches)) tl.open = false; }
  tl.addEventListener("toggle", () => { LS("vtsdb.topline", tl.open ? "1" : "0"); });

  // ---------- districts table ----------
  let sortKey = "d", sortDir = 1;
  const COLS = [
    ["d", "District"], ["st", "Students"], ["chg", "Since 2014"], ["towns", "Towns"], ["area", "Sq mi"], ["span", "Span"],
    ["glps", "GL / student"], ["glvs", "vs state"], ["pov", "Child pov."], ["schools", "Schools"], ["pubHS", "Pub. HS"], ["indHS", "Ind. HS"], ["cte", "CTE"], ["small", "Small"], ["comps", "Pieces"], ["sus", "SUs"],
  ];
  function renderTable() {
    const T = $("dtable"), r = rangeObj();
    const val = (s, k) => k === "towns" ? s.towns.length : k === "sus" ? s.sus.size : k === "glvs" ? s.glps / m.glps - 1 : s[k];
    const rows = S.st.D.filter((s) => s.towns.length || s.d === S.sel).slice().sort((a, b) => (val(a, sortKey) - val(b, sortKey)) * sortDir || a.d - b.d);
    let h = "<thead><tr>" + COLS.map(([k, l]) => `<th data-k="${k}">${l}${sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr></thead><tbody>";
    for (const s of rows) {
      const stc = s.st < r.lo ? "warn-t" : s.st > r.hi ? "warn-t" : "";
      h += `<tr data-d="${s.d}" class="${s.d === S.sel ? "sel" : ""}"><td class="nm"><span class="sw" style="background:${colorOf(s.d)}"></span>${s.d + 1} · ${esc(nameOf(s.d))}</td>` +
        `<td class="${stc}">${fmt(s.st)}</td><td>${s.y14 ? sgn(s.chg) : "–"}</td><td>${s.towns.length}</td><td>${fmt(s.area)}</td><td>${s.span.toFixed(0)}</td>` +
        `<td>${s.st ? money(s.glps) : "–"}</td><td>${s.st ? sgn(s.glps / m.glps - 1) : "–"}</td><td>${s.pt ? pct(s.pov, 1) : "–"}</td>` +
        `<td>${s.schools}</td><td class="${s.pubHS ? "" : "warn-t"}">${s.pubHS}</td><td>${s.indHS}</td><td>${s.cte}</td><td>${s.small}</td>` +
        `<td class="${s.comps > 1 ? "bad-t" : ""}">${s.comps}</td><td>${s.sus.size}</td></tr>`;
    }
    const st = S.st;
    h += `<tr style="cursor:default"><td><b>State</b></td><td><b>${fmt(m.totSt)}</b></td><td>${sgn(m.totSt / m.y14.reduce((a, v) => a + v, 0) - 1)}</td><td>${m.n}</td><td></td><td></td><td>${money(m.glps)}</td><td>–</td><td>${pct(m.ppov, 1)}</td><td colspan="7" style="text-align:left;color:var(--muted)">${st.K} districts</td></tr>`;
    T.innerHTML = h + "</tbody>";
    T.querySelectorAll("th").forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "d" ? 1 : -1; } renderTable(); }));
    T.querySelectorAll("tr[data-d]").forEach((tr) => (tr.onclick = () => selectDistrict(+tr.dataset.d)));
  }

  // ---------- auto-balance ----------
  const W = [["wSize", "oSize"], ["wBal", "oBal"], ["wCompact", "oCompact"], ["wTax", "oTax"], ["wEcon", "oEcon"], ["wKeep", "oKeep"]];
  W.forEach(([w, o]) => { const f = () => ($(o).textContent = (+$(w).value).toFixed(1)); $(w).addEventListener("input", f); f(); });
  let opt = null, stopFlag = false;
  $("runOpt").onclick = () => {
    if (busy) return;
    const r = rangeObj();
    if (S.st.unT) { toast("Assign every town before auto-balancing (or start a new plan)."); return; }
    const wholeSU = $("wholeSU").checked;
    const bk = E.buildBlocks(m, wholeSU);
    const bplan = E.toBlockPlan(bk, S.plan);
    const before = Int16Array.from(S.plan);
    opt = new E.Optimizer(m, bk, bplan, S.K, {
      range: [r.lo, r.hi], seed: (Date.now() & 0xffff) + 1,
      weights: { size: +$("wSize").value, balance: +$("wBal").value, compact: +$("wCompact").value, tax: +$("wTax").value, econ: +$("wEcon").value, keep: +$("wKeep").value },
    });
    const total = +$("effort").value * (wholeSU ? 0.3 : 1), chunks = 120, per = Math.ceil(total / chunks);
    const s0 = opt.score; let c = 0; busy = true; stopFlag = false;
    $("runOpt").disabled = true; $("stopOpt").disabled = false; $("optMsg").textContent = "Running…";
    const tick = () => {
      if (stopFlag || c >= chunks) {
        opt.step(per * 3, 0);
        const plan = E.toTownPlan(m, bk, opt.plan);
        const step = []; for (let i = 0; i < m.n; i++) if (plan[i] !== before[i]) step.push([i, before[i], plan[i]]);
        S.plan = plan; if (step.length) { S.undo.push(step); S.redo = []; }
        busy = false; $("runOpt").disabled = false; $("stopOpt").disabled = true; $("optBar").style.width = "0";
        $("optMsg").textContent = `${stopFlag ? "Stopped" : "Done"}. Moved ${step.length} town${step.length === 1 ? "" : "s"}; score ${s0.toFixed(2)} → ${opt.score.toFixed(2)} (lower is better). Undo restores the previous map.`;
        refresh(); return;
      }
      const t = 0.15 * Math.pow(0.0005 / 0.15, c / (chunks - 1));
      opt.step(per, t); c++;
      $("optBar").style.width = ((c / chunks) * 100).toFixed(0) + "%";
      if (c % 6 === 0) { S.plan = E.toTownPlan(m, bk, opt.plan); paintMap(); }
      setTimeout(tick, 0);
    };
    tick();
  };
  $("stopOpt").onclick = () => (stopFlag = true);
  function suggestK() { const r = rangeObj(); const mid = isFinite(r.hi) ? (r.lo + r.hi) / 2 : r.lo * 1.5; return Math.max(2, Math.min(60, Math.round(m.totSt / mid))); }
  $("newSeed").onclick = () => {
    if (busy) return;
    const K = Math.max(2, Math.min(60, Math.round(+$("newK").value || suggestK())));
    const bk = E.buildBlocks(m, $("wholeSU").checked);
    const bp = E.seedPlan(bk, K, (Date.now() & 0xffff) + 3);
    S.preset = ""; $("presetSel").value = "";
    setPlan(E.toTownPlan(m, bk, bp), K, []);
    toast(`Starting map with ${K} districts. Run auto-balance to refine it.`);
  };
  $("newBlank").onclick = () => {
    if (busy) return;
    const K = Math.max(2, Math.min(60, Math.round(+$("newK").value || suggestK())));
    S.preset = ""; $("presetSel").value = "";
    setPlan(new Int16Array(m.n).fill(-1), K, []); setTool("paint");
    toast(`Blank map with ${K} empty districts. Paint towns into them.`);
  };

  // ---------- presets, range, map options ----------
  function fillPresets() {
    const sel = $("presetSel"); sel.innerHTML = "";
    const g1 = document.createElement("optgroup"); g1.label = "Real maps";
    const g2 = document.createElement("optgroup"); g2.label = "Generated examples";
    for (const p of PRESETS) { const o = new Option(p.name, p.id); (p.generated ? g2 : g1).appendChild(o); }
    sel.appendChild(g1); if (g2.children.length) sel.appendChild(g2);
    sel.appendChild(new Option("Your plan", ""));
    sel.lastChild.disabled = true;
  }
  function loadPreset(id) {
    const p = PRESETS.find((x) => x.id === id); if (!p) return;
    S.preset = id; $("presetSel").value = id;
    if (p.range) { const r = RANGES.find((x) => x.lo === p.range[0] && x.hi === (p.range[1] == null ? Infinity : p.range[1])); if (r) { S.range = r.id; $("rangeSel").value = r.id; } }
    setPlan(p.plan, p.names.length, p.names);
  }
  $("presetSel").onchange = (ev) => { if (!busy) loadPreset(ev.target.value); };
  RANGES.forEach((r) => $("rangeSel").appendChild(new Option(r.label, r.id)));
  $("rangeSel").onchange = (ev) => { S.range = ev.target.value; $("newK").value = suggestK(); refresh(); };
  $("colorBy").onchange = (ev) => { S.colorBy = ev.target.value; $("levelSeg").querySelectorAll("button").forEach((b) => (b.disabled = !LEVEL_FIELDS[S.colorBy] || S.colorBy === "size")); paintMap(); save(); };
  $("levelSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.level = b.dataset.level; $("levelSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", x === b)); paintMap(); save(); }));
  $("overlaySel").onchange = (ev) => { S.overlay = ev.target.value; paintMap(); save(); };
  $("showDots").onchange = (ev) => { S.dots = ev.target.checked; drawDots(); save(); };
  $("resetBtn").onclick = () => {
    if (busy) return;
    const b = $("resetBtn");
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Reset map?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Reset"; }, 3000); return; }
    b.classList.remove("armed"); b.textContent = "Reset";
    S.colorBy = "district"; S.level = "town"; S.overlay = "su"; S.dots = false; S.range = "2k"; S.brushSU = false;
    $("colorBy").value = "district"; $("overlaySel").value = "su"; $("showDots").checked = false; $("rangeSel").value = "2k"; $("tBrush").setAttribute("aria-pressed", false);
    loadPreset("p0"); setTool("pan"); fit(); toast("Back to today's supervisory unions.");
  };

  // ---------- tabs, panel ----------
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));
  const main = document.querySelector(".main");
  { const w = +LS("vtsdb.panelw"); if (w > 280) main.style.setProperty("--panel-w", w + "px"); }
  const rz = $("resizer");
  rz.addEventListener("pointerdown", (ev) => {
    rz.setPointerCapture(ev.pointerId); rz.classList.add("drag");
    const mv = (e) => { const w = Math.max(300, Math.min(window.innerWidth - 200, window.innerWidth - e.clientX)); main.style.setProperty("--panel-w", w + "px"); };
    const up = () => { rz.classList.remove("drag"); rz.removeEventListener("pointermove", mv); rz.removeEventListener("pointerup", up); LS("vtsdb.panelw", parseInt(getComputedStyle(main).getPropertyValue("--panel-w"))); fit(); };
    rz.addEventListener("pointermove", mv); rz.addEventListener("pointerup", up);
  });
  const toggleExpand = () => {
    const on = $("expandBtn").getAttribute("aria-pressed") !== "true";
    $("expandBtn").setAttribute("aria-pressed", on);
    main.style.setProperty("--panel-w", on ? Math.round(window.innerWidth * 0.62) + "px" : (+LS("vtsdb.panelw") > 280 ? LS("vtsdb.panelw") : 400) + "px");
    setTimeout(fit, 0);
  };
  $("expandBtn").onclick = toggleExpand; rz.addEventListener("dblclick", toggleExpand);
  new ResizeObserver(() => { if (view) { const r = svg.getBoundingClientRect(); const ar = r.width / Math.max(r.height, 1); view.h = view.w / ar; applyView(); } }).observe(svg);

  // ---------- save & share ----------
  const code = () => E.encodePlan(S.plan, S.names.slice(0, S.K).concat(S.K > S.names.length ? new Array(S.K - S.names.length).fill("") : []));
  function save() {
    $("codeBox").value = code();
    LS("vtsdb.state", JSON.stringify({ code: $("codeBox").value, preset: S.preset, range: S.range, colorBy: S.colorBy, level: S.level, overlay: S.overlay, dots: S.dots }));
  }
  function loadCode(c, quiet) {
    const r = E.decodePlan(c, m.n);
    if (!r) { if (!quiet) toast("That code doesn't match this tool's town list. Check that it starts with VT1."); return false; }
    S.preset = ""; $("presetSel").value = "";
    const p = PRESETS.find((x) => x.plan.every((d, i) => d === r.plan[i]) && x.names.length === r.K);
    if (p) { S.preset = p.id; $("presetSel").value = p.id; }
    setPlan(r.plan, r.K, r.names); if (!quiet) toast("Plan loaded."); return true;
  }
  const copy = (txt, msg) => {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, msg)); else fallbackCopy(txt, msg);
  };
  function fallbackCopy(txt, msg) { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); toast(msg); } catch (e) { toast("Copy didn't work here. Select the text and copy it by hand."); } t.remove(); }
  $("copyCode").onclick = () => copy($("codeBox").value, "Plan code copied.");
  $("loadCode").onclick = () => loadCode($("codeBox").value);
  function csv() {
    const q = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
    const rows = [["town", "county", "today_su", "district", "district_name", "students_2024", "students_2014", "ed_grand_list_thousands", "children_5_17_poverty", "children_5_17_total"]];
    m.U.forEach((u, i) => rows.push([u.name, u.county, u.su, S.plan[i] >= 0 ? S.plan[i] + 1 : "", S.plan[i] >= 0 ? nameOf(S.plan[i]) : "", u.st, u.y14, u.gl, u.pb, u.pt]));
    return rows.map((r) => r.map((x) => q(String(x))).join(",")).join("\n");
  }
  $("copyCsv").onclick = () => copy(csv(), "Town table copied as CSV.");
  $("dlCsv").onclick = () => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv()], { type: "text/csv" })); a.download = "vermont-district-plan.csv";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  let tTimer = null;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(tTimer); tTimer = setTimeout(() => (t.hidden = true), 2800); }

  // ---------- start ----------
  $("dataNote").textContent = `Built ${D.meta.built}. Students ${D.meta.studentsYear}; poverty ${D.meta.acs}. Statewide: ${fmt(m.totSt)} students, ${money(m.glps)} grand list per student, ${pct(m.ppov, 1)} of children 5–17 in poverty.`;
  fillPresets();
  let restored = false;
  const hash = (location.hash.match(/plan=([^&]+)/) || [])[1];
  if (hash) restored = loadCode(decodeURIComponent(hash), true);
  if (!restored) {
    try {
      const st = JSON.parse(LS("vtsdb.state") || "null");
      if (st) {
        S.range = RANGES.some((r) => r.id === st.range) ? st.range : "2k"; S.colorBy = st.colorBy || "district"; S.level = st.level || "town";
        S.overlay = st.overlay != null ? st.overlay : "su"; S.dots = !!st.dots;
        restored = loadCode(st.code, true);
        if (restored && st.preset && PRESETS.some((p) => p.id === st.preset && p.plan.every((d, i) => d === S.plan[i]))) { S.preset = st.preset; $("presetSel").value = st.preset; renderPlanHead(); }
      }
    } catch (e) { restored = false; }
  }
  $("rangeSel").value = S.range; $("colorBy").value = S.colorBy; $("overlaySel").value = S.overlay; $("showDots").checked = S.dots;
  $("levelSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", x.dataset.level === S.level));
  if (!restored) loadPreset("p0");
  $("newK").value = suggestK();
  setTool("pan"); fit(); refresh();
})();
