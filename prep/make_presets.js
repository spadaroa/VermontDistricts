// Generates the "one possible map" examples and writes src/generated.json.
//   node prep/make_presets.js
const fs = require('fs'); const E = require('../src/engine.js');
const data = JSON.parse(fs.readFileSync(__dirname + '/../src/data.json', 'utf8'));
const m = E.buildModel(data);
const fmt = (s) => `K=${s.K} in-range=${s.inRange} min=${s.minSt} max=${s.maxSt} glRatio=${s.glRatio.toFixed(2)} glNear=${(s.glNear*100).toFixed(0)}% povH=${s.povH.toFixed(3)} span=${s.maxSpan.toFixed(0)} split=${s.susSplit} broken=${s.broken} noHS=${s.noHS}`;
console.log('today   ', fmt(E.stats(m, E.currentPlan(m), m.sus.length, { range: [2000, 4000] })));
function autoName(plan, K) {
  return Array.from({ length: K }, (_, d) => { let b = -1; for (let i = 0; i < m.n; i++) if (plan[i] === d && (b < 0 || m.st[i] > m.st[b])) b = i; return b >= 0 ? m.U[b].name + ' area' : ''; });
}
function make(cfg) {
  let best = null;
  for (const seed of cfg.seeds) {
    const bk = E.buildBlocks(m, cfg.wholeSU);
    const bp = E.seedPlan(bk, cfg.K, seed);
    const o = new E.Optimizer(m, bk, bp, cfg.K, { weights: cfg.w, range: cfg.range, seed });
    o.anneal(cfg.iters, cfg.t0 || 0.2, 0.0005);
    const plan = E.toTownPlan(m, bk, o.plan);
    const s = E.stats(m, plan, cfg.K, { range: cfg.range });
    console.log(' ', cfg.id, seed, o.score.toFixed(3), fmt(s));
    if (!best || o.score < best.score) best = { score: o.score, plan, s };
  }
  console.log('BEST', cfg.id, fmt(best.s));
  return { id: cfg.id, name: cfg.name, desc: cfg.desc, generated: true, range: cfg.range, plan: Array.from(best.plan), names: autoName(best.plan, cfg.K) };
}
const out = [
  make({ id: 'g24su', name: 'Generated: 2,000–4,000 students, whole SUs', K: 28, wholeSU: true, range: [2000, 4000], seeds: [1, 2, 3, 4, 5, 6], iters: 300000,
    w: { size: 3, balance: 0.3, compact: 1.5 },
    desc: 'One possible map, made by the auto-balancer: 28 districts of about 2,000 to 4,000 students, built from whole supervisory unions and kept compact. It is an illustration, not a proposal.' }),
  make({ id: 'g48su', name: 'Generated: 4,000–8,000 students, whole SUs', K: 14, wholeSU: true, range: [4000, 8000], seeds: [1, 2, 3, 4, 5, 6], iters: 300000,
    w: { size: 3, balance: 0.3, compact: 1.5 },
    desc: 'One possible map, made by the auto-balancer: 14 districts in the 4,000 to 8,000 student range that Act 73 set for the Task Force, built from whole supervisory unions and kept compact. It is an illustration, not a proposal.' }),
  make({ id: 'g48tax', name: 'Generated: 4,000–8,000 students, even tax capacity', K: 14, wholeSU: false, range: [4000, 8000], seeds: [1, 2, 3, 4], iters: 1500000,
    w: { size: 3, balance: 0.3, compact: 1, tax: 2, keep: 0.5 },
    desc: 'One possible map, made by the auto-balancer from towns: 14 districts of 4,000 to 8,000 students whose grand list per student is as close to the statewide figure as it can get while staying compact, with a light preference for keeping supervisory unions together. It is an illustration, not a proposal.' }),
];
fs.writeFileSync(__dirname + '/../src/generated.json', JSON.stringify(out));
