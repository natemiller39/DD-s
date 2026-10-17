// Austin's Fantasy DD's — game simulation shared by the browser (local play) and the server (online play).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Arena is a circle of radius R centred on (0,0). Launchers sit on the rim, one per seat.
  const R = 500, PAD = 32, LAUNCH_R = R - 62;
  const COOLDOWN = 1, RAPID_CD = 0.12, SWEEP = 1.15, SWEEP_RATE = 1.9;
  const MULTI_TIME = 5, RAPID_TIME = 4, SPREAD = 0.17;
  const ARROW_V = 1000, REEL_V = 1250, HIT_R = 46, PU_HIT = 58, MAX_PLAYERS = 6;
  const TIERS = [
    { val: 1, speed: 1, odds: .58 },
    { val: 2, speed: 1.15, odds: .26 },
    { val: 3, speed: 1.32, odds: .12 },
    { val: 5, speed: 1.55, odds: .04 },
  ];
  const COLORS = ['#e2483d', '#3d8be2', '#e8b23a', '#a35ee0', '#45c46a', '#2fc7c9'];
  const rnd = Math.random;

  const seatAngle = (seat, n) => Math.PI / 2 + seat * 2 * Math.PI / n;
  function launcherPos(seat, n) { const a = seatAngle(seat, n); return { x: Math.cos(a) * LAUNCH_R, y: Math.sin(a) * LAUNCH_R }; }
  const aimAngle = (p, n) => seatAngle(p.seat, n) + Math.PI + Math.sin(p.sweepT) * SWEEP;
  function rollTier() { let r = rnd(); for (let i = 0; i < TIERS.length; i++) { if ((r -= TIERS[i].odds) <= 0) return i; } return 0; }

  function create(list) {
    const n = list.length;
    const s = {
      t: 0, n,
      players: list.map((q, i) => ({
        id: q.id, name: q.name, color: COLORS[i], cpu: !!q.cpu, seat: i, score: 0, cd: 0, cdMax: COOLDOWN,
        arrows: [], sweepT: i * 1.7, cpuWait: rnd(), hits: 0, shots: 0, multiT: 0, rapidT: 0,
      })),
      dds: [], pus: [], spawned: 0, collected: 0,
      total: 14 + 6 * n,      // 2 players: 26 DD's, 6 players: 50
      maxOn: 6 + 2 * n,       // 2 players: 10 flying at once, 6 players: 18
      spawnT: 0, puT: 5 + rnd() * 3, over: false, events: [], nid: 1,
    };
    for (let i = 0; i < 6; i++) spawnDD(s);
    return s;
  }
  function spawnDD(s) {
    if (s.spawned >= s.total) return;
    s.spawned++;
    const tier = rollTier(), a = rnd() * Math.PI * 2, sp = (200 + rnd() * 130) * TIERS[tier].speed;
    s.dds.push({ id: s.nid++, x: Math.cos(a) * 20, y: Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, heading: a, tier, caught: null });
    s.events.push({ e: 'spawn', tier });
  }
  function spawnPU(s) {
    const a = rnd() * Math.PI * 2;
    s.pus.push({ id: s.nid++, x: 0, y: 0, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, type: rnd() < .5 ? 'multi' : 'rapid', life: 11, t: 0, caught: null });
    s.events.push({ e: 'pu' });
  }
  function fire(s, pid, angle) {
    const p = s.players.find(p => p.id === pid);
    if (!p || s.over || p.cd > 0) return false;
    const base = seatAngle(p.seat, s.n) + Math.PI;
    let a = aimAngle(p, s.n);
    // online clients send the angle they see on screen; accept it if it's within the sweep
    if (typeof angle === 'number' && isFinite(angle)) {
      let d = Math.atan2(Math.sin(angle - base), Math.cos(angle - base));
      d = Math.max(-SWEEP - .05, Math.min(SWEEP + .05, d));
      a = base + d;
    }
    const L = launcherPos(p.seat, s.n), offs = p.multiT > 0 ? [-SPREAD, 0, SPREAD] : [0];
    for (const o of offs) {
      const dx = Math.cos(a + o), dy = Math.sin(a + o);
      p.arrows.push({ id: s.nid++, x: L.x + dx * 55, y: L.y + dy * 55, dx, dy, st: 'f', dd: null, pu: null });
    }
    p.cdMax = p.rapidT > 0 ? RAPID_CD : COOLDOWN; p.cd = p.cdMax; p.shots++;
    s.events.push({ e: 'fire', pid, rapid: p.rapidT > 0 });
    return true;
  }
  function bounce(o, lim) {
    const r = Math.hypot(o.x, o.y);
    if (r > lim) {
      const nx = o.x / r, ny = o.y / r, d = o.vx * nx + o.vy * ny;
      if (d > 0) { o.vx -= 2 * d * nx; o.vy -= 2 * d * ny; }
      o.x = nx * lim; o.y = ny * lim; return true;
    }
    return false;
  }
  function cpuThink(s, p, dt) {
    if (p.cd > 0) return;
    if (p.rapidT > 0 && rnd() < dt * 6) { fire(s, p.id); return; }
    p.cpuWait -= dt; if (p.cpuWait > 0) return;
    const L = launcherPos(p.seat, s.n), a = aimAngle(p, s.n), ux = Math.cos(a), uy = Math.sin(a), rr = HIT_R * .8;
    const targets = s.dds.filter(d => d.caught === null).concat(s.pus.filter(u => u.caught === null));
    for (const d of targets) {
      for (let t = .05; t < 1.2; t += .05) {
        const ax = L.x + ux * ARROW_V * t, ay = L.y + uy * ARROW_V * t;
        if (Math.hypot(ax, ay) > R) break;
        if (Math.hypot(d.x + d.vx * t - ax, d.y + d.vy * t - ay) < rr) {
          p.cpuWait = .2 + rnd() * .6;
          if (rnd() < .5) fire(s, p.id);
          return;
        }
      }
    }
    if (rnd() < dt * .12) fire(s, p.id);
  }
  function step(s, dt) {
    if (s.over) return;
    s.t += dt;
    s.spawnT -= dt;
    if (s.spawnT <= 0 && s.dds.filter(d => d.caught === null).length < s.maxOn && s.spawned < s.total) { spawnDD(s); s.spawnT = .45 + rnd() * .45; }
    s.puT -= dt;
    if (s.puT <= 0) { if (s.pus.filter(u => u.caught === null).length < 2 && s.collected < s.total - 1) spawnPU(s); s.puT = Math.max(4, 9 - s.n) + rnd() * 5; }

    for (const d of s.dds) {
      if (d.caught !== null) continue;
      d.heading += (rnd() - .5) * dt * 5;
      const sp = Math.hypot(d.vx, d.vy), cur = Math.atan2(d.vy, d.vx);
      let df = d.heading - cur; df = Math.atan2(Math.sin(df), Math.cos(df));
      const na = cur + df * Math.min(1, dt * 2);
      d.vx = Math.cos(na) * sp; d.vy = Math.sin(na) * sp; d.x += d.vx * dt; d.y += d.vy * dt;
      if (bounce(d, R - PAD)) d.heading = Math.atan2(d.vy, d.vx);
    }
    for (const u of s.pus) { u.t += dt; if (u.caught !== null) continue; u.life -= dt; u.x += u.vx * dt; u.y += u.vy * dt; bounce(u, R - PAD - 10); }
    s.pus = s.pus.filter(u => u.caught !== null || u.life > 0);

    for (const p of s.players) {
      p.sweepT += dt * SWEEP_RATE;
      p.multiT = Math.max(0, p.multiT - dt); p.rapidT = Math.max(0, p.rapidT - dt);
      if (p.cd > 0) { p.cd = Math.max(0, p.cd - dt); if (p.cd === 0 && p.cdMax === COOLDOWN) s.events.push({ e: 'ready', pid: p.id }); }
      if (p.cpu) cpuThink(s, p, dt);
      const L = launcherPos(p.seat, s.n);
      for (const A of p.arrows) {
        if (A.st === 'f') {
          A.x += A.dx * ARROW_V * dt; A.y += A.dy * ARROW_V * dt;
          for (const d of s.dds) {
            if (d.caught !== null) continue;
            if (Math.hypot(d.x - A.x, d.y - A.y) < HIT_R) { d.caught = p.id; A.dd = d; A.st = 'r'; p.hits++; s.events.push({ e: 'hit', pid: p.id, tier: d.tier }); break; }
          }
          if (A.st === 'f') for (const u of s.pus) {
            if (u.caught !== null) continue;
            if (Math.hypot(u.x - A.x, u.y - A.y) < PU_HIT) { u.caught = p.id; A.pu = u; A.st = 'r'; s.events.push({ e: 'hit', pid: p.id }); break; }
          }
          if (Math.hypot(A.x, A.y) > R) A.st = 'r';
        } else {
          const dx = L.x - A.x, dy = L.y - A.y, dist = Math.hypot(dx, dy), stp = REEL_V * dt;
          if (dist <= stp) {
            A.done = true;
            if (A.dd) {
              const v = TIERS[A.dd.tier].val; p.score += v; s.collected++;
              s.dds = s.dds.filter(d => d !== A.dd);
              s.events.push({ e: 'score', pid: p.id, val: v, tier: A.dd.tier });
            }
            if (A.pu) {
              const k = A.pu.type; s.pus = s.pus.filter(u => u !== A.pu);
              if (k === 'multi') p.multiT = MULTI_TIME; else { p.rapidT = RAPID_TIME; p.cd = 0; }
              s.events.push({ e: 'power', pid: p.id, type: k });
            }
          } else { A.x += dx / dist * stp; A.y += dy / dist * stp; }
          if (A.dd) { A.dd.x = A.x; A.dd.y = A.y; }
          if (A.pu) { A.pu.x = A.x; A.pu.y = A.y; }
        }
      }
      p.arrows = p.arrows.filter(A => !A.done);
    }
    if (s.collected >= s.total) { s.over = true; for (const p of s.players) p.arrows = []; s.pus = []; s.events.push({ e: 'over' }); }
  }
  const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
  function snapshot(s) {
    return {
      t: r3(s.t), n: s.n, total: s.total, spawned: s.spawned, collected: s.collected, over: s.over,
      players: s.players.map(p => ({
        id: p.id, name: p.name, color: p.color, cpu: p.cpu, seat: p.seat, score: p.score, cd: r3(p.cd), cdMax: p.cdMax,
        sweepT: r3(p.sweepT), multiT: r1(p.multiT), rapidT: r1(p.rapidT), hits: p.hits, shots: p.shots,
        arrows: p.arrows.map(A => ({ id: A.id, x: r1(A.x), y: r1(A.y), dx: r3(A.dx), dy: r3(A.dy), st: A.st })),
      })),
      dds: s.dds.map(d => ({ id: d.id, x: r1(d.x), y: r1(d.y), vx: r1(d.vx), vy: r1(d.vy), tier: d.tier, c: d.caught !== null })),
      pus: s.pus.map(u => ({ id: u.id, x: r1(u.x), y: r1(u.y), type: u.type, life: r1(u.life), t: r1(u.t), c: u.caught !== null })),
    };
  }
  return { R, LAUNCH_R, SWEEP, COOLDOWN, MAX_PLAYERS, TIERS, COLORS, seatAngle, launcherPos, aimAngle, create, step, fire, snapshot };
});
