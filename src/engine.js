/* Vermont School District Builder — model, metrics and optimizer.
 * Runs in the browser (window.Engine) and in Node (module.exports).
 * A "plan" is an Int16Array over towns: plan[town] = district index (0..K-1) or -1 (unassigned).
 */
(function (root) {
  "use strict";
  const KM_MI = 0.621371;

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- model (towns) ----------
  function buildModel(data) {
    const U = data.units, n = U.length, S = data.schools;
    const sus = []; U.forEach((u) => { if (sus.indexOf(u.su) < 0) sus.push(u.su); });
    const m = {
      n, U, S, sus,
      st: new Float64Array(n), y14: new Float64Array(n), gl: new Float64Array(n), pb: new Float64Array(n), pt: new Float64Array(n),
      area: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), su: new Int16Array(n),
      nbStart: new Int32Array(n + 1), nb: null,
    };
    const nbs = [];
    for (let i = 0; i < n; i++) {
      const u = U[i];
      m.st[i] = u.st; m.y14[i] = u.y14; m.gl[i] = u.gl; m.pb[i] = u.pb; m.pt[i] = u.pt;
      m.area[i] = Math.max(u.sqmi, 1); m.x[i] = u.x; m.y[i] = u.y; m.su[i] = sus.indexOf(u.su);
      m.nbStart[i] = nbs.length; for (const [j] of u.nb) nbs.push(j);
    }
    m.nbStart[n] = nbs.length; m.nb = Int32Array.from(nbs);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    m.totSt = sum(m.st); m.totGl = sum(m.gl); m.totPb = sum(m.pb); m.totPt = sum(m.pt);
    m.glps = m.totGl / m.totSt; m.ppov = m.totPb / m.totPt;
    return m;
  }
  function currentPlan(m) { return Int16Array.from(m.su); }

  // ---------- blocks (towns, or whole supervisory unions) ----------
  function buildBlocks(m, wholeSU) {
    const of = new Int32Array(m.n), members = [];
    if (!wholeSU) { for (let i = 0; i < m.n; i++) { of[i] = i; members.push([i]); } }
    else { m.sus.forEach(() => members.push([])); for (let i = 0; i < m.n; i++) { of[i] = m.su[i]; members[m.su[i]].push(i); } }
    const B = members.length, nb = Array.from({ length: B }, () => new Set());
    for (let i = 0; i < m.n; i++) for (let k = m.nbStart[i]; k < m.nbStart[i + 1]; k++) {
      const a = of[i], b = of[m.nb[k]]; if (a !== b) nb[a].add(b);
    }
    const f = (fn) => Float64Array.from(members.map((ms) => ms.reduce((s, i) => s + fn(i), 0)));
    const area = f((i) => m.area[i]);
    return {
      B, of, members, nb: nb.map((s) => Int32Array.from(s)),
      st: f((i) => m.st[i]), gl: f((i) => m.gl[i]), pb: f((i) => m.pb[i]), pt: f((i) => m.pt[i]), area,
      x: Float64Array.from(members.map((ms, b) => ms.reduce((s, i) => s + m.x[i] * m.area[i], 0) / area[b])),
      y: Float64Array.from(members.map((ms, b) => ms.reduce((s, i) => s + m.y[i] * m.area[i], 0) / area[b])),
      su: Int16Array.from(members.map((ms) => m.su[ms[0]])),
    };
  }
  const toBlockPlan = (bk, plan) => Int16Array.from(bk.members.map((ms) => {
    const c = {}; let best = -1, bv = -1;
    for (const i of ms) { const d = plan[i]; c[d] = (c[d] || 0) + 1; if (c[d] > bv) { bv = c[d]; best = d; } }
    return best;
  }));
  const toTownPlan = (m, bk, bplan) => Int16Array.from({ length: m.n }, (_, i) => bplan[bk.of[i]]);

  function components(m, plan, d) {
    const seen = new Uint8Array(m.n); let comps = 0;
    for (let i = 0; i < m.n; i++) {
      if (plan[i] !== d || seen[i]) continue;
      comps++; const st = [i]; seen[i] = 1;
      while (st.length) {
        const a = st.pop();
        for (let k = m.nbStart[a]; k < m.nbStart[a + 1]; k++) { const b = m.nb[k]; if (plan[b] === d && !seen[b]) { seen[b] = 1; st.push(b); } }
      }
    }
    return comps;
  }
  const H2 = (p) => (p > 0 && p < 1 ? -(p * Math.log(p) + (1 - p) * Math.log(1 - p)) : 0);

  // ---------- metrics for display ----------
  // opts.range = [lo, hi] student size target
  function stats(m, plan, K, opts) {
    opts = opts || {}; const [lo, hi] = opts.range || [2000, Infinity];
    const D = Array.from({ length: K }, (_, d) => ({
      d, st: 0, y14: 0, gl: 0, pb: 0, pt: 0, area: 0, towns: [], sus: new Set(), schools: 0, pubHS: 0, indHS: 0, cte: 0, small: 0,
      schEnroll: 0, comps: 0, span: 0, largest: -1,
    }));
    let unT = 0, unSt = 0;
    for (let i = 0; i < m.n; i++) {
      const d = plan[i];
      if (d < 0 || d >= K) { unT++; unSt += m.st[i]; continue; }
      const s = D[d]; s.st += m.st[i]; s.y14 += m.y14[i]; s.gl += m.gl[i]; s.pb += m.pb[i]; s.pt += m.pt[i]; s.area += m.U[i].sqmi;
      s.towns.push(i); s.sus.add(m.su[i]);
      if (s.largest < 0 || m.st[i] > m.st[s.largest]) s.largest = i;
      for (const si of m.U[i].s) {
        const sc = m.S[si];
        if (sc.a === "P") { s.schools++; s.schEnroll += sc.e; if (sc.hs) s.pubHS++; if (sc.e < 100) s.small++; }
        else if (sc.a === "I") { if (sc.hs) s.indHS++; }
        else if (sc.a === "C") s.cte++;
      }
    }
    // span: longest distance between town centers (miles); contiguity
    for (const s of D) {
      let mx = 0; const t = s.towns;
      for (let a = 0; a < t.length; a++) for (let b = a + 1; b < t.length; b++) {
        const dx = m.x[t[a]] - m.x[t[b]], dy = m.y[t[a]] - m.y[t[b]]; const q = dx * dx + dy * dy; if (q > mx) mx = q;
      }
      s.span = Math.sqrt(mx) * KM_MI;
      s.comps = t.length ? components(m, plan, s.d) : 0;
      s.glps = s.st ? s.gl / s.st : 0; s.pov = s.pt ? s.pb / s.pt : 0; s.chg = s.y14 ? s.st / s.y14 - 1 : 0;
      s.inRange = s.st >= lo && s.st <= hi;
    }
    const used = D.filter((s) => s.towns.length);
    // SUs split across districts
    const suD = m.sus.map(() => new Set());
    for (let i = 0; i < m.n; i++) if (plan[i] >= 0) suD[m.su[i]].add(plan[i]);
    const susSplit = suD.filter((s) => s.size > 1).length;
    // poverty Theil's H across districts (children 5–17 in / not in poverty)
    const Hs = H2(m.ppov); let Hsum = 0, Ptot = 0;
    for (const s of used) { Hsum += s.pt * (Hs - H2(s.pov)); Ptot += s.pt; }
    const povH = Hs && Ptot ? Hsum / (Ptot * Hs) : 0;
    const gls = used.filter((s) => s.st > 0).map((s) => s.glps);
    const sts = used.map((s) => s.st);
    const glRatio = gls.length ? Math.max(...gls) / Math.min(...gls) : 0;
    // students in districts whose grand list per student is within ±25% of the state's
    let near = 0; for (const s of used) if (Math.abs(s.glps / m.glps - 1) <= 0.25) near += s.st;
    return {
      D, K: used.length, unT, unSt,
      minSt: sts.length ? Math.min(...sts) : 0, maxSt: sts.length ? Math.max(...sts) : 0,
      inRange: used.filter((s) => s.inRange).length, stInRange: used.filter((s) => s.inRange).reduce((a, s) => a + s.st, 0) / m.totSt,
      glRatio, glNear: near / m.totSt, povH,
      noHS: used.filter((s) => s.pubHS === 0).length, noHSany: used.filter((s) => s.pubHS + s.indHS === 0).length,
      maxSpan: used.length ? Math.max(...used.map((s) => s.span)) : 0,
      avgSpan: used.length ? used.reduce((a, s) => a + s.span, 0) / used.length : 0,
      susSplit, broken: used.filter((s) => s.comps > 1).length,
    };
  }

  // ---------- optimizer (simulated annealing over blocks) ----------
  const SCALE = { size: 0.25, balance: 0.4, compact: 0.6, tax: 0.35, econ: 0.04, keep: 0.25 };
  function Optimizer(m, bk, bplan, K, opts) {
    opts = opts || {};
    this.m = m; this.bk = bk; this.plan = bplan; this.K = K;
    this.w = Object.assign({ size: 3, balance: 0.5, compact: 1, tax: 0, econ: 0, keep: 0 }, opts.weights || {});
    this.lo = (opts.range || [2000, Infinity])[0]; this.hi = (opts.range || [2000, Infinity])[1];
    this.mean = m.totSt / K;
    this.r = rng(opts.seed || 1);
    const A = (this.agg = {
      st: new Float64Array(K), gl: new Float64Array(K), pb: new Float64Array(K), pt: new Float64Array(K),
      A: new Float64Array(K), Sx: new Float64Array(K), Sy: new Float64Array(K), Sr: new Float64Array(K), cnt: new Int32Array(K),
    });
    // SU keep term: students of each SU per district
    this.suSt = m.sus.map(() => new Float64Array(K)); this.suTot = new Float64Array(m.sus.length);
    this.suOfBlockTowns = bk.members.map((ms) => ms.map((i) => [m.su[i], m.st[i] + 1]));
    for (let b = 0; b < bk.B; b++) if (bplan[b] >= 0) this._add(b, bplan[b], 1);
    for (let b = 0; b < bk.B; b++) for (const [s, v] of this.suOfBlockTowns[b]) this.suTot[s] += v;
    this.econDen = m.totPt * m.ppov * (1 - m.ppov) || 1;
    this.terms = Array.from({ length: K }, (_, d) => this._term(d));
    this.suTerm = m.sus.map((_, s) => this._suTerm(s));
    this.sums = [0, 0, 0, 0, 0, 0];
    for (const t of this.terms) for (let k = 0; k < 5; k++) this.sums[k] += t[k];
    this.sums[5] = this.suTerm.reduce((a, v) => a + v, 0);
    this.score = this._score(this.sums);
    this.iter = 0;
  }
  Optimizer.prototype._add = function (b, d, s) {
    const bk = this.bk, A = this.agg, a = bk.area[b];
    A.st[d] += s * bk.st[b]; A.gl[d] += s * bk.gl[b]; A.pb[d] += s * bk.pb[b]; A.pt[d] += s * bk.pt[b];
    A.A[d] += s * a; A.Sx[d] += s * a * bk.x[b]; A.Sy[d] += s * a * bk.y[b];
    A.Sr[d] += s * a * (bk.x[b] * bk.x[b] + bk.y[b] * bk.y[b]); A.cnt[d] += s;
    if (this.suSt) for (const [su, v] of this.suOfBlockTowns[b]) this.suSt[su][d] += s * v;
  };
  // per-district terms: [size outside range², balance², compact, tax, econ]
  Optimizer.prototype._term = function (d) {
    const A = this.agg, m = this.m;
    if (A.cnt[d] === 0) return [1, 1, 0, 0, 0];
    const E = A.st[d];
    let out = 0;
    if (E < this.lo) out = (this.lo - E) / this.lo; else if (E > this.hi) out = (E - this.hi) / this.hi;
    const bal = (E - this.mean) / this.mean;
    const Ar = A.A[d], cx = A.Sx[d] / Ar, cy = A.Sy[d] / Ar;
    const I = A.Sr[d] - Ar * (cx * cx + cy * cy);
    const nmi = (2 * Math.PI * I) / (Ar * Ar);
    const g = E > 0 ? A.gl[d] / E / m.glps - 1 : 0;
    const p = A.pt[d] > 0 ? A.pb[d] / A.pt[d] - m.ppov : 0;
    return [out * out, bal * bal, Math.max(0, nmi - 1), (E / m.totSt) * g * g, (A.pt[d] * p * p) / this.econDen];
  };
  Optimizer.prototype._suTerm = function (s) {
    const row = this.suSt[s]; let mx = 0; for (let d = 0; d < this.K; d++) if (row[d] > mx) mx = row[d];
    return (this.suTot[s] - mx) / this.m.totSt;
  };
  Optimizer.prototype._score = function (S) {
    const w = this.w, K = this.K;
    return (
      (w.size * Math.sqrt(S[0] / K)) / SCALE.size + S[0] * 2 +
      (w.balance * Math.sqrt(S[1] / K)) / SCALE.balance +
      (w.compact * (S[2] / K)) / SCALE.compact +
      (w.tax * Math.sqrt(Math.max(0, S[3]))) / SCALE.tax +
      (w.econ * Math.sqrt(Math.max(0, S[4]))) / SCALE.econ +
      (w.keep * S[5]) / SCALE.keep
    );
  };
  Optimizer.prototype._staysConnected = function (u, d) {
    const nb = this.bk.nb, plan = this.plan, seeds = [];
    for (const v of nb[u]) if (plan[v] === d) seeds.push(v);
    if (seeds.length <= 1) return true;
    const want = new Set(seeds), seen = new Set([u, seeds[0]]), st = [seeds[0]];
    want.delete(seeds[0]);
    while (st.length && want.size) {
      const a = st.pop();
      for (const b of nb[a]) if (plan[b] === d && !seen.has(b)) { seen.add(b); want.delete(b); st.push(b); }
    }
    return want.size === 0;
  };
  Optimizer.prototype.step = function (iters, temp) {
    const bk = this.bk, plan = this.plan, r = this.r;
    let accepted = 0;
    for (let it = 0; it < iters; it++) {
      const u = (r() * bk.B) | 0, a = plan[u];
      if (a < 0) continue;
      const nbu = bk.nb[u]; if (!nbu.length) continue;
      const b = plan[nbu[(r() * nbu.length) | 0]];
      if (b < 0 || b === a) continue;
      if (this.agg.cnt[a] <= 1) continue;
      if (!this._staysConnected(u, a)) continue;
      const oa = this.terms[a], ob = this.terms[b];
      const susHit = [...new Set(this.suOfBlockTowns[u].map((x) => x[0]))], oldSu = susHit.map((s) => this.suTerm[s]);
      this._add(u, a, -1); plan[u] = b; this._add(u, b, 1);
      const na = this._term(a), nbt = this._term(b), newSu = susHit.map((s) => this._suTerm(s));
      const S = this.sums.slice();
      for (let k = 0; k < 5; k++) S[k] += na[k] - oa[k] + nbt[k] - ob[k];
      for (let j = 0; j < susHit.length; j++) S[5] += newSu[j] - oldSu[j];
      const sc = this._score(S), delta = sc - this.score;
      if (delta <= 0 || (temp > 0 && r() < Math.exp(-delta / temp))) {
        this.terms[a] = na; this.terms[b] = nbt; susHit.forEach((s, j) => (this.suTerm[s] = newSu[j]));
        this.sums = S; this.score = sc; accepted++;
      } else { this._add(u, b, -1); plan[u] = a; this._add(u, a, 1); }
    }
    this.iter += iters;
    return accepted;
  };
  Optimizer.prototype.anneal = function (total, t0, t1) {
    const chunks = 200, per = Math.ceil(total / chunks);
    for (let c = 0; c < chunks; c++) this.step(per, t0 * Math.pow(t1 / t0, c / (chunks - 1)));
    this.step(per * 5, 0);
    return this.score;
  };

  // ---------- seed plans: K compact regions of similar size, grown from spread-out seeds ----------
  function seedPlan(bk, K, seed) {
    const r = rng(seed || 7), B = bk.B, tot = bk.st.reduce((a, v) => a + v, 0);
    if (K >= B) return Int16Array.from({ length: B }, (_, b) => (b < K ? b : 0));
    // k-means++ style seeds weighted by students
    const seeds = []; const w = Array.from(bk.st, (v) => v + 1);
    const pick = (p) => { let t = r() * p.reduce((a, v) => a + v, 0); for (let i = 0; i < B; i++) { t -= p[i]; if (t <= 0) return i; } return B - 1; };
    seeds.push(pick(w));
    while (seeds.length < K) {
      const p = w.map((v, i) => {
        let dm = Infinity; for (const s of seeds) { const dx = bk.x[i] - bk.x[s], dy = bk.y[i] - bk.y[s]; dm = Math.min(dm, dx * dx + dy * dy); }
        return seeds.indexOf(i) >= 0 ? 0 : dm;
      });
      seeds.push(pick(p));
    }
    const plan = new Int16Array(B).fill(-1), size = new Float64Array(K);
    seeds.forEach((s, d) => { plan[s] = d; size[d] = bk.st[s]; });
    let left = B - K;
    while (left > 0) {
      // grow the smallest district that can still grow, taking its nearest unassigned neighbor
      const order = [...Array(K).keys()].sort((a, b) => size[a] - size[b]);
      let grown = false;
      for (const d of order) {
        let best = -1, bd = Infinity; const cx = bk.x[seeds[d]], cy = bk.y[seeds[d]];
        for (let b = 0; b < B; b++) {
          if (plan[b] !== d) continue;
          for (const v of bk.nb[b]) if (plan[v] < 0) { const q = (bk.x[v] - cx) ** 2 + (bk.y[v] - cy) ** 2; if (q < bd) { bd = q; best = v; } }
        }
        if (best >= 0) { plan[best] = d; size[d] += bk.st[best]; left--; grown = true; break; }
      }
      if (!grown) { for (let b = 0; b < B; b++) if (plan[b] < 0) { for (const v of bk.nb[b]) if (plan[v] >= 0) { plan[b] = plan[v]; left--; break; } } }
    }
    return plan;
  }

  // ---------- plan codes ----------
  const ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  function encodePlan(plan, names) {
    let s = ""; for (const d of plan) s += d < 0 ? "." : ALPH[d];
    return "VT1." + s + (names && names.length ? "." + names.map((x) => encodeURIComponent(x || "")).join("~") : "");
  }
  function decodePlan(code, n) {
    const p = String(code || "").trim().split(".");
    if (p[0] !== "VT1") return null;
    const s = p[1] || ""; if (s.length !== n) return null;
    const plan = new Int16Array(n); let K = 0;
    for (let i = 0; i < n; i++) { const c = s[i]; const d = c === "." ? -1 : ALPH.indexOf(c); if (c !== "." && d < 0) return null; plan[i] = d; K = Math.max(K, d + 1); }
    let names = p.length > 2 ? p.slice(2).join(".").split("~").map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } }) : [];
    while (names.length < K) names.push("");
    K = Math.max(K, names.length);
    return { plan, K, names: names.slice(0, K) };
  }

  // drop empty districts and renumber (keeps names aligned)
  function compact(plan, K, names) {
    const used = []; for (const d of plan) if (d >= 0 && used.indexOf(d) < 0) used.push(d);
    used.sort((a, b) => a - b);
    const map = new Int16Array(K).fill(-1); used.forEach((d, k) => (map[d] = k));
    return { plan: Int16Array.from(plan, (d) => (d < 0 ? -1 : map[d])), K: used.length, names: used.map((d) => (names || [])[d] || "") };
  }

  const E = { rng, buildModel, currentPlan, buildBlocks, toBlockPlan, toTownPlan, components, stats, Optimizer, seedPlan, encodePlan, decodePlan, compact, KM_MI, SCALE };
  if (typeof module !== "undefined" && module.exports) module.exports = E; else root.Engine = E;
})(this);
