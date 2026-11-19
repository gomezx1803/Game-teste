(function () {
  var W = 800, H = 450, GROUND = 380, HORIZON = 330, PX = 4;
  var cv = document.getElementById('c');
  var ctx = cv.getContext('2d');
  var modeSel = document.getElementById('mode'), diffSel = document.getElementById('diff'), goBtn = document.getElementById('go');
  var FONT = '"Press Start 2P", "Courier New", monospace';
  try { document.fonts.load('16px "Press Start 2P"'); } catch (e) {}

  /* ---------- pixel helpers (logical 800x450, drawn on a 400x225 canvas) ---------- */
  function sn(v) { return Math.round(v / PX) * PX; }
  function rect(x, y, w, h, c) {
    var x0 = sn(x), y0 = sn(y), x1 = sn(x + w), y1 = sn(y + h);
    ctx.fillStyle = c;
    ctx.fillRect(x0, y0, Math.max(PX, x1 - x0), Math.max(PX, y1 - y0));
  }
  function ell(cx, cy, rx, ry, c) {
    ry = Math.max(PX, Math.round(ry / PX) * PX);
    ctx.fillStyle = c;
    for (var y = -ry; y < ry; y += PX) {
      var yy = y + PX / 2, k = Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))), w = rx * k;
      var x0 = sn(cx - w), x1 = sn(cx + w);
      ctx.fillRect(x0, sn(cy + y), Math.max(PX, x1 - x0), PX);
    }
  }
  function pline(a, b, t, c) {
    ctx.fillStyle = c;
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / PX));
    for (var i = 0; i <= n; i++) {
      ctx.fillRect(sn(a[0] + dx * i / n - t / 2), sn(a[1] + dy * i / n - t / 2), t, t);
    }
  }
  function label(t, x, y, size, color, align) {
    ctx.font = size + 'px ' + FONT;
    ctx.textAlign = align || 'center';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = size >= 32 ? 8 : 4;
    ctx.strokeStyle = '#1a0f08';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  /* ---------- input ---------- */
  var held = {}, pressed = {};
  var K1 = { l: 'KeyA', r: 'KeyD', u: 'KeyW', d: 'KeyS', b: 'Space', p: 'KeyJ', k: 'KeyK' };
  var K2 = { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown', b: 'Slash', p: 'Comma', k: 'Period' };
  var BLOCK_DEFAULT = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'];
  window.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'SELECT') { return; }
    if (BLOCK_DEFAULT.indexOf(e.code) >= 0) { e.preventDefault(); }
    initAudio();
    if (!e.repeat) { pressed[e.code] = true; }
    held[e.code] = true;
    if (e.code === 'Enter') { startOrNext(); }
  });
  window.addEventListener('keyup', function (e) { held[e.code] = false; });
  window.addEventListener('blur', function () { held = {}; });
  function take(code) { if (pressed[code]) { pressed[code] = false; return true; } return false; }
  function humanInput(m) {
    return { left: !!held[m.l], right: !!held[m.r], up: !!held[m.u], down: !!held[m.d], block: !!held[m.b], punch: take(m.p), kick: take(m.k) };
  }
  var ZERO = { left: 0, right: 0, up: 0, down: 0, block: 0, punch: 0, kick: 0 };

  /* ---------- sound ---------- */
  var actx = null;
  function initAudio() {
    if (actx) { return; }
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  function beep(freq, dur, type, vol) {
    if (!actx) { return; }
    try {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.value = vol || 0.05;
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) {}
  }

  /* ---------- data ---------- */
  var MOVES = {
    punch:  { s: 4, a: 4, r: 9,  dmg: 7,  reach: 64, yoff: -96, stun: 20, kb: 4.5, high: true,  low: false },
    kick:   { s: 8, a: 5, r: 15, dmg: 12, reach: 86, yoff: -52, stun: 24, kb: 9,   high: false, low: false },
    lpunch: { s: 3, a: 3, r: 8,  dmg: 5,  reach: 56, yoff: -36, stun: 18, kb: 3.5, high: false, low: true },
    lkick:  { s: 7, a: 4, r: 14, dmg: 9,  reach: 90, yoff: -14, stun: 22, kb: 7,   high: false, low: true }
  };
  var DIFF = { easy: 0.4, normal: 0.8, hard: 1.6 };
  var WINS_NEEDED = 2, ROUND_FRAMES = 60 * 60;

  var STYLE1 = { name: 'TIÃO', skin: '#7a4a2a', hair: '#150e0a', hairType: 'afro', color: '#d9382b', dark: '#8a2217' };
  var STYLE2 = { name: 'KAIO', skin: '#f3c9a0', hair: '#f2d04a', hairType: 'blond', color: '#2f7fe0', dark: '#1b4a8c' };

  function mk(x, face, st) {
    return { x: x, y: GROUND, vx: 0, vy: 0, face: face, hp: 100, hpShow: 100, st: st, name: st.name,
      act: null, stun: 0, kbv: 0, block: false, crouch: false,
      ko: false, koT: 0, onGround: true, walk: 0, aiT: 0, plan: 'approach',
      comboN: 0, comboLast: 0, comboShow: 0 };
  }

  var p1, p2, wins = [0, 0], round = 1, state = 'title', frame = 0;
  var timer = ROUND_FRAMES, introT = 0, endT = 0, shake = 0, banner = '', sub = '';
  var sparks = [];

  function newRound() {
    p1 = mk(230, 1, STYLE1);
    p2 = mk(570, -1, STYLE2);
    timer = ROUND_FRAMES; introT = 0; endT = 0; sparks = []; state = 'intro';
  }
  function startMatch() { wins = [0, 0]; round = 1; newRound(); }
  function startOrNext() { if (state === 'title' || state === 'matchEnd') { startMatch(); } }
  goBtn.addEventListener('click', function () { initAudio(); startOrNext(); goBtn.blur(); });
  cv.addEventListener('click', function () { initAudio(); startOrNext(); });
  modeSel.addEventListener('change', function () { modeSel.blur(); });
  diffSel.addEventListener('change', function () { diffSel.blur(); });

  /* ---------- computer opponent ---------- */
  function aiInput(f, o) {
    var inp = { left: 0, right: 0, up: 0, down: 0, block: 0, punch: 0, kick: 0 };
    var d = Math.abs(o.x - f.x), dir = o.x > f.x ? 1 : -1, react = DIFF[diffSel.value] || 0.8;
    f.aiT--;
    if (o.act && d < 115 && !f.act && Math.random() < react * 0.12) { f.plan = 'block'; f.aiT = rnd(14, 26); }
    if (f.aiT <= 0) {
      f.aiT = rnd(10, 22);
      var r = Math.random();
      if (d > 170) { f.plan = 'approach'; }
      else if (d > 105) { f.plan = r < 0.5 ? 'approach' : r < 0.68 ? 'kick' : r < 0.8 ? 'lkick' : r < 0.9 ? 'wait' : 'jump'; }
      else { f.plan = r < 0.26 ? 'punch' : r < 0.42 ? 'kick' : r < 0.56 ? 'lpunch' : r < 0.68 ? 'lkick' : r < 0.84 ? 'block' : 'retreat'; }
    }
    switch (f.plan) {
      case 'approach': if (dir > 0) { inp.right = 1; } else { inp.left = 1; } break;
      case 'retreat': if (dir > 0) { inp.left = 1; } else { inp.right = 1; } break;
      case 'block': inp.block = 1; break;
      case 'jump': inp.up = 1; if (dir > 0) { inp.right = 1; } else { inp.left = 1; } f.plan = 'wait'; break;
      case 'punch': inp.punch = 1; f.plan = 'wait'; break;
      case 'kick': inp.kick = 1; f.plan = 'wait'; break;
      case 'lpunch': inp.down = 1; inp.punch = 1; f.plan = 'wait'; break;
      case 'lkick': inp.down = 1; inp.kick = 1; f.plan = 'wait'; break;
    }
    if (f.act && f.act.landed && f.act.t > f.act.s + f.act.a && Math.random() < react * 0.05) {
      if (Math.random() < 0.5) { inp.punch = 1; } else { inp.kick = 1; }
    }
    return inp;
  }

  /* ---------- simulation ---------- */
  function update(f, inp, o) {
    var g = 0.7;
    if (f.ko) {
      f.koT++; f.block = false; f.crouch = false;
      f.vy += g; f.y += f.vy;
      if (f.y >= GROUND) { f.y = GROUND; f.vy = 0; }
      f.x = clamp(f.x + f.kbv, 40, W - 40); f.kbv *= 0.9;
      return;
    }
    if (f.stun > 0) {
      f.stun--; f.x += f.kbv; f.kbv *= 0.82; f.block = false; f.crouch = false; f.act = null; f.vx = 0;
    } else {
      if (f.onGround && !f.act) { f.face = o.x >= f.x ? 1 : -1; }
      if (f.onGround && !f.act) {
        f.block = !!inp.block; f.crouch = !!inp.down;
        if (f.block || f.crouch) { f.vx = 0; }
        else {
          f.vx = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * 3.3;
          if (inp.up) { f.vy = -13.5; f.onGround = false; }
        }
      }
      if (!f.onGround) { f.block = false; f.crouch = false; }
      var canStart = !f.block && (!f.act || (f.act.landed && f.act.t > f.act.s + f.act.a));
      if (canStart && (inp.punch || inp.kick)) {
        var low = f.onGround && !!inp.down, base = (inp.kick && !inp.punch) ? 'kick' : 'punch';
        var type = low ? (base === 'kick' ? 'lkick' : 'lpunch') : base;
        f.act = Object.assign({ t: 0, hit: false, landed: false, type: type }, MOVES[type]);
        if (f.onGround) { f.vx = 0; }
        beep(base === 'kick' ? 160 : 220, 0.06, 'triangle', 0.04);
      }
      if (f.act) {
        f.act.t++;
        if (f.act.t >= f.act.s + f.act.a + f.act.r) { f.act = null; }
        else if (f.onGround) { f.vx = 0; }
      }
      if (f.act) { f.crouch = f.onGround && f.act.low; }
      f.x += f.vx;
    }
    f.vy += g; f.y += f.vy;
    if (f.y >= GROUND) { f.y = GROUND; f.vy = 0; f.onGround = true; } else { f.onGround = false; }
    f.x = clamp(f.x, 40, W - 40);
    f.walk += Math.abs(f.vx) * 0.12;
  }

  function pushApart() {
    var dx = p2.x - p1.x, min = 40;
    if (Math.abs(dx) < min && Math.abs(p1.y - p2.y) < 60) {
      var push = (min - Math.abs(dx)) / 2, s = dx >= 0 ? 1 : -1;
      p1.x = clamp(p1.x - s * push, 40, W - 40);
      p2.x = clamp(p2.x + s * push, 40, W - 40);
    }
  }

  function spark(x, y, color, big) { sparks.push({ x: x, y: y, t: 0, color: color, big: big }); }

  function resolve(a, d) {
    var A = a.act;
    if (!A || A.hit || a.ko || d.ko) { return; }
    if (A.t <= A.s || A.t > A.s + A.a) { return; }
    var dx = (d.x - a.x) * a.face;
    if (dx < -10 || dx > A.reach + 20) { return; }
    var center = d.crouch ? d.y - 40 : d.y - 60;
    if (Math.abs((a.y + A.yoff) - center) > 70) { return; }
    if (A.high && d.crouch && d.onGround) { return; }
    A.hit = true;
    var blocked = d.block && d.onGround && !d.act && d.stun <= 0;
    var hx = d.x - a.face * 14, hy = a.y + A.yoff;
    if (blocked) {
      d.hp -= Math.max(1, Math.round(A.dmg * 0.12));
      d.kbv = a.face * A.kb * 0.7; d.x = clamp(d.x + d.kbv, 40, W - 40);
      spark(hx, hy, '#8fd0ff', false); beep(90, 0.07, 'square', 0.05);
    } else {
      var n = a.comboN;
      d.hp -= Math.max(1, Math.round(A.dmg * Math.max(0.4, 1 - 0.15 * n)));
      d.stun = Math.max(6, A.stun - 5 * n); d.act = null; d.kbv = a.face * A.kb;
      A.landed = true; a.comboN = n + 1; d.comboN = 0;
      if (a.comboN >= 2) { a.comboLast = a.comboN; }
      spark(hx, hy, '#ffd479', true); beep(A.type === 'kick' ? 70 : 110, 0.12, 'sawtooth', 0.07);
      shake = (A.type === 'kick' || A.type === 'lkick') ? 8 : 4;
    }
    if (d.hp <= 0) {
      d.hp = 0; d.ko = true; d.koT = 0; d.vy = -8; d.kbv = a.face * 8; d.act = null;
      shake = 14; beep(55, 0.4, 'sawtooth', 0.08);
    }
  }

  function chainEnd(a, d) {
    if (a.comboN > 0 && (d.stun <= 0 || d.ko)) {
      if (a.comboN >= 2) { a.comboLast = a.comboN; a.comboShow = 90; }
      a.comboN = 0;
    }
    if (a.comboShow > 0) { a.comboShow--; }
  }

  function endRound(winner) {
    state = 'roundEnd'; endT = 0;
    var koed = p1.ko || p2.ko;
    if (winner >= 0) { wins[winner]++; }
    banner = koed ? 'K.O.' : 'TEMPO';
    sub = winner < 0 ? 'Empate. O round se repete.' : (winner === 0 ? p1.name : p2.name) + ' vence o round';
  }

  function tick() {
    frame++;
    if (!p1) { return; }
    var cpu = modeSel.value === 'cpu';
    var in1 = humanInput(K1);
    var in2 = cpu ? aiInput(p2, p1) : humanInput(K2);
    if (state === 'fight') {
      update(p1, in1, p2); update(p2, in2, p1);
      pushApart();
      resolve(p1, p2); resolve(p2, p1);
      chainEnd(p1, p2); chainEnd(p2, p1);
      timer--;
      if (p1.ko || p2.ko) { endRound(p1.ko && p2.ko ? -1 : (p2.ko ? 0 : 1)); }
      else if (timer <= 0) { endRound(p1.hp === p2.hp ? -1 : (p1.hp > p2.hp ? 0 : 1)); }
    } else {
      update(p1, ZERO, p2); update(p2, ZERO, p1);
      chainEnd(p1, p2); chainEnd(p2, p1);
      if (state === 'intro') {
        introT++;
        banner = introT < 50 ? 'ROUND ' + round : 'LUTE!';
        sub = '';
        if (introT >= 90) { state = 'fight'; banner = ''; }
      } else if (state === 'roundEnd') {
        endT++;
        if (endT >= 170) {
          if (wins[0] >= WINS_NEEDED || wins[1] >= WINS_NEEDED) {
            state = 'matchEnd';
            banner = (wins[0] > wins[1] ? p1.name : p2.name) + ' CAMPEÃO';
            sub = 'Aperte Enter para lutar de novo';
          } else { round++; newRound(); }
        }
      }
    }
    [p1, p2].forEach(function (f) { if (f.hpShow > f.hp) { f.hpShow = Math.max(f.hp, f.hpShow - 0.6); } });
    sparks = sparks.filter(function (s) { s.t++; return s.t < 12; });
    if (shake > 0) { shake--; }
    pressed = {};
  }

  /* ---------- background: simple grass field with trees ---------- */
  var bgCanvas = document.createElement('canvas');
  bgCanvas.width = cv.width; bgCanvas.height = cv.height;

  function tree(x, s) {
    var trunkH = Math.round(64 * s);
    rect(x - 8, HORIZON + 12 - trunkH, 16, trunkH, '#7a4f2a');
    rect(x - 8, HORIZON + 12 - trunkH, 4, trunkH, '#5a3a1f');
    var cy = HORIZON + 12 - trunkH - 20 * s;
    ell(x, cy, 48 * s, 40 * s, '#2f7d32');
    ell(x - 10 * s, cy - 8 * s, 30 * s, 24 * s, '#43a047');
    ell(x + 22 * s, cy + 8 * s, 18 * s, 14 * s, '#276b2a');
  }
  function cloud(x, y) {
    ell(x, y, 40, 12, '#ffffff');
    ell(x + 26, y - 8, 26, 12, '#ffffff');
    ell(x - 28, y - 4, 22, 8, '#ffffff');
  }
  function buildBackground() {
    var keep = ctx;
    ctx = bgCanvas.getContext('2d');
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    var bands = ['#5fbcf0', '#72c6f2', '#86cff4', '#9bd9f6', '#b3e3f8', '#c9ecfa'];
    for (var i = 0; i < bands.length; i++) { rect(0, i * 56, W, 56, bands[i]); }
    rect(0, 336, W, 20, bands[bands.length - 1]);
    ell(660, 96, 44, 44, '#fff6c2');
    ell(660, 96, 30, 30, '#ffe066');
    cloud(130, 76); cloud(400, 52); cloud(540, 128); cloud(760, 40);
    ell(180, HORIZON + 24, 320, 72, '#6bb86a');
    ell(660, HORIZON + 28, 340, 64, '#58a65a');
    var xs = [48, 150, 300, 432, 560, 690, 770], sc = [1.1, 0.8, 1.2, 0.9, 1.15, 0.85, 1.0];
    for (var t = 0; t < xs.length; t++) { tree(xs[t], sc[t]); }
    var gb = ['#4caf50', '#47a84c'];
    for (var gy = HORIZON, k = 0; gy < H; gy += 20, k++) { rect(0, gy, W, 20, gb[k % 2]); }
    rect(0, HORIZON, W, 4, '#2e7d32');
    for (var j = 0; j < 90; j++) {
      var tx = (j * 97) % W, ty = HORIZON + 14 + ((j * 53) % 100);
      rect(tx, ty, 4, 8, '#2e7d32'); rect(tx + 8, ty + 4, 4, 4, '#2e7d32');
      if (j % 9 === 0) { rect(tx + 20, ty, 4, 4, '#fff176'); }
      if (j % 13 === 0) { rect(tx + 28, ty + 4, 4, 4, '#ffffff'); }
    }
    ctx = keep;
  }

  /* ---------- fighters ---------- */
  function ext(A) {
    if (A.t <= A.s) { return A.t / A.s * 0.7; }
    if (A.t <= A.s + A.a) { return 1; }
    return Math.max(0, 1 - (A.t - A.s - A.a) / A.r);
  }

  function pose(f) {
    var P = {
      hip: [0, -56], neck: [0, -96], head: [2, -112],
      handF: [26, -90], handB: [14, -82], footF: [16, 0], footB: [-14, 0], kb: 8
    };
    if (!f.onGround) {
      P.hip = [0, -62]; P.neck = [0, -102]; P.head = [2, -118];
      P.handF = [26, -96]; P.handB = [14, -88]; P.footF = [22, -28]; P.footB = [-8, -20];
    } else if (f.crouch) {
      P.hip = [0, -32]; P.neck = [4, -68]; P.head = [6, -84];
      P.handF = [26, -72]; P.handB = [16, -64]; P.footF = [24, 0]; P.footB = [-18, 0]; P.kb = 14;
    } else if (Math.abs(f.vx) > 0.1) {
      var s = Math.sin(f.walk) * 14;
      P.footF = [16 + s, -Math.max(0, Math.sin(f.walk)) * 8];
      P.footB = [-14 - s, -Math.max(0, -Math.sin(f.walk)) * 8];
    }
    if (f.block) {
      if (f.crouch) { P.handF = [24, -84]; P.handB = [18, -72]; }
      else { P.handF = [24, -104]; P.handB = [18, -90]; }
      P.neck[0] -= 2;
    }
    if (f.stun > 0 && !f.ko) { P.neck[0] -= 8; P.head[0] -= 12; P.handF = [10, -78]; P.handB = [0, -74]; }
    if (f.act) {
      var A = f.act, e = ext(A);
      if (A.type === 'punch') { P.handF = [20 + e * (A.reach - 20), -96]; P.neck[0] += 4 * e; }
      else if (A.type === 'kick') {
        P.footF = [20 + e * (A.reach - 20), -55 * e]; P.neck[0] -= 8 * e; P.head[0] -= 8 * e;
        P.handF = [10, -92]; P.handB = [-6, -86];
      } else if (A.type === 'lpunch') { P.handF = [20 + e * (A.reach - 20), -40]; P.neck[0] += 4 * e; }
      else {
        P.footF = [20 + e * (A.reach - 20), -12 * e]; P.neck[0] -= 6 * e; P.head[0] -= 6 * e;
        P.handF = [12, -66]; P.handB = [-2, -60];
      }
    }
    if (f.ko) {
      var k = Math.min(1, f.koT / 18);
      var L = { hip: [-12, -12], neck: [-54, -12], head: [-70, -14], handF: [-44, -26], handB: [-48, -4], footF: [24, -12], footB: [28, -2] };
      ['hip', 'neck', 'head', 'handF', 'handB', 'footF', 'footB'].forEach(function (key) {
        P[key] = [P[key][0] + (L[key][0] - P[key][0]) * k, P[key][1] + (L[key][1] - P[key][1]) * k];
      });
    }
    return P;
  }

  function leg(hip, foot, bend, color) {
    var knee = [(hip[0] + foot[0]) / 2 + bend, (hip[1] + foot[1]) / 2 + 2];
    pline(hip, knee, 12, color); pline(knee, foot, 12, color);
  }
  function shoe(foot) { rect(foot[0] - 6, foot[1] - 8, 16, 8, '#1b1b1b'); }

  function drawHead(P, st) {
    var hx = P.head[0], hy = P.head[1];
    if (st.hairType === 'afro') {
      ell(hx - 2, hy - 6, 20, 20, st.hair);
      ell(hx + 2, hy + 2, 12, 12, st.skin);
    } else {
      ell(hx - 2, hy - 4, 14, 14, st.hair);
      ell(hx + 2, hy + 2, 12, 12, st.skin);
      rect(hx - 8, hy - 10, 20, 8, st.hair);
    }
    rect(hx + 8, hy - 2, 4, 4, '#111111');
  }

  function drawFighter(f) {
    var st = f.st;
    ctx.save();
    var sw = 48 - (GROUND - f.y) * 0.1;
    ell(sn(f.x), GROUND + 4, Math.max(16, sw / 2), 8, 'rgba(0,0,0,0.28)');
    ctx.translate(sn(f.x), sn(f.y));
    ctx.scale(f.face, 1);
    var P = pose(f);
    leg(P.hip, P.footB, -P.kb, st.dark); shoe(P.footB);
    pline(P.neck, P.handB, 8, st.dark); rect(P.handB[0] - 4, P.handB[1] - 4, 8, 8, st.skin);
    pline(P.hip, P.neck, 24, st.color);
    rect(P.hip[0] - 12, P.hip[1] - 4, 24, 12, st.dark);
    leg(P.hip, P.footF, P.kb, st.color); shoe(P.footF);
    drawHead(P, st);
    pline(P.neck, P.handF, 8, st.color); rect(P.handF[0] - 4, P.handF[1] - 4, 8, 8, st.skin);
    if (f.block) { rect(36, -120, 8, 112, 'rgba(143,208,255,0.55)'); }
    ctx.restore();
  }

  function drawSparks() {
    sparks.forEach(function (s) {
      var r = (s.big ? 12 : 8) + s.t * (s.big ? 3 : 2), sz = s.t < 6 ? 8 : 4;
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4;
        rect(s.x + Math.cos(a) * r - sz / 2, s.y + Math.sin(a) * r - sz / 2, sz, sz, s.color);
      }
      if (s.t < 4) { rect(s.x - 4, s.y - 4, 8, 8, '#ffffff'); }
    });
  }

  /* ---------- HUD ---------- */
  function drawBar(x, w, f, right) {
    var y = 20, h = 24;
    rect(x - 4, y - 4, w + 8, h + 8, '#0c0814');
    var shown = f.hpShow / 100 * w, real = f.hp / 100 * w;
    if (shown > 0) { rect(right ? x + w - shown : x, y, shown, h, '#c9362a'); }
    if (real > 0) { rect(right ? x + w - real : x, y, real, h, f.hp > 30 ? '#ffd23f' : '#ff6a3d'); }
    rect(x, y, w, 4, 'rgba(255,255,255,0.25)');
    label(f.name, right ? x + w : x, y + h + 28, 16, '#f3ece4', right ? 'right' : 'left');
  }
  function pips(x, n, right) {
    for (var i = 0; i < WINS_NEEDED; i++) {
      var px = right ? x - 12 - i * 20 : x + i * 20;
      rect(px, 84, 12, 12, i < n ? '#ffd23f' : 'rgba(255,255,255,0.2)');
    }
  }
  function drawCombo(f, right) {
    var n = f.comboN >= 2 ? f.comboN : (f.comboShow > 0 ? f.comboLast : 0);
    if (n < 2) { return; }
    var live = f.comboN >= 2, x = right ? W - 32 : 32, al = right ? 'right' : 'left';
    var col = live ? ((Math.floor(frame / 4) % 2) ? '#ffd23f' : '#ff6a3d') : '#ffd23f';
    label(n + ' HITS', x, 148, 32, col, al);
    label('COMBO', x, 176, 16, '#f3ece4', al);
  }
  function drawHud() {
    drawBar(32, 328, p1, false);
    drawBar(440, 328, p2, true);
    pips(32, wins[0], false); pips(W - 32, wins[1], true);
    label(String(Math.max(0, Math.ceil(timer / 60))), W / 2, 52, 32, '#f3ece4', 'center');
    drawCombo(p1, false); drawCombo(p2, true);
  }

  function render() {
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (shake > 0) { ctx.translate(sn((Math.random() - 0.5) * shake), sn((Math.random() - 0.5) * shake)); }
    ctx.fillStyle = '#4caf50'; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    var order = p1.y <= p2.y ? [p2, p1] : [p1, p2];
    order.forEach(drawFighter);
    drawSparks();
    ctx.restore();
    drawHud();
    if (state === 'title') {
      rect(0, 0, W, H, 'rgba(12,8,20,0.55)');
      label('DUELO BRASA', W / 2, 196, 64, '#ffd23f', 'center');
      label('Aperte Enter ou clique para lutar', W / 2, 252, 16, '#f3ece4', 'center');
      label('Escolha o modo abaixo da tela', W / 2, 284, 16, '#c9bedb', 'center');
    } else if (banner) {
      if (state === 'matchEnd') { rect(0, 0, W, H, 'rgba(12,8,20,0.5)'); }
      var size = state === 'roundEnd' ? 96 : (state === 'matchEnd' ? 48 : 64);
      label(banner, W / 2, 216, size, banner === 'K.O.' ? '#ff4d3a' : '#ffd23f', 'center');
      if (sub) { label(sub, W / 2, 264, 16, '#f3ece4', 'center'); }
    }
  }

  /* ---------- loop ---------- */
  buildBackground();
  newRound(); state = 'title';
  var last = performance.now(), acc = 0, STEP = 1000 / 60;
  function loop(now) {
    acc += Math.min(100, now - last); last = now;
    while (acc >= STEP) { tick(); acc -= STEP; }
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
