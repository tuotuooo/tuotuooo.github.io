/* ============================================================
   K-03~06 干员卡 · 独立专属特效 (card-fx)
   ------------------------------------------------------------
   · 每张卡默认就是"粒子组成的自身编号"，粒子互不重叠；
   · 悬停：同一批粒子平滑汇聚成各自的专属图案，并叠加专属效果层：
       K-03 生命脉冲(心电波形) / K-04 准星锁定(旋转刻度) /
       K-05 数据网格(动态连线) / K-06 六边护盾(同心六边形)
   · 与 K-02 同一套可靠底座（柔光点/弹簧物理/鼠标斥力/拖尾）；
     四套形态、配色、效果层彼此独立。
   · 全自包含，window.CardFx(card) -> { play, reset, resize }。
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = {
    spring: 0.05, damp: 0.85, jitter: 0.010,
    mouseR: 96, mouseF: 3.8, mouseIdle: 850,
    spin: 0.00022, morphEase: 0.055, stagger: 0.24,
    minDist: 7.5, sizeMin: 4.2, sizeMax: 5.9,
    maxPts: 460, maxPtsSm: 300
  };

  // 每张卡：字号样本词 + 5 档配色(4主色+高光+白) + 专属图案 + 专属效果层
  var SPECS = {
    '3': {
      word: 'K-03',
      tones: [[92,230,168],[150,255,205],[210,255,228],[60,185,135],[255,235,180],[255,255,255]],
      glow: [120,255,200],
      form: formPulse,
      overlay: overlayECG
    },
    '4': {
      word: 'K-04',
      tones: [[255,118,86],[255,170,110],[255,214,158],[214,72,54],[255,240,190],[255,255,255]],
      glow: [255,140,100],
      form: formReticle,
      overlay: overlayReticle
    },
    '5': {
      word: 'K-05',
      tones: [[122,168,255],[162,142,255],[204,192,255],[88,120,220],[225,205,255],[255,255,255]],
      glow: [150,170,255],
      form: formMesh,
      overlay: overlayMesh
    },
    '6': {
      word: 'K-06',
      tones: [[240,178,74],[255,205,120],[255,232,172],[198,138,50],[255,244,205],[255,255,255]],
      glow: [255,200,110],
      form: formShield,
      overlay: overlayHex
    }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  var spriteCache = {};
  function sprite(rgb) {
    var key = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    if (spriteCache[key]) return spriteCache[key];
    var c = document.createElement('canvas'), s = 40;
    c.width = c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grd.addColorStop(0, 'rgba(' + key + ',1)');
    grd.addColorStop(0.18, 'rgba(' + key + ',.9)');
    grd.addColorStop(0.46, 'rgba(' + key + ',.28)');
    grd.addColorStop(1, 'rgba(' + key + ',0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    spriteCache[key] = c;
    return c;
  }

  function noop() { return { play: function(){}, reset: function(){}, resize: function(){} }; }

  // 最小间距穿线取样器：保证粒子互不重叠
  function picker(md) {
    var out = [], md2 = md * md;
    return {
      add: function (x, y, spin, glow) {
        for (var i = 0; i < out.length; i++) {
          var dx = out[i].x - x, dy = out[i].y - y;
          if (dx * dx + dy * dy < md2) return false;
        }
        out.push({ x: x, y: y, spin: spin || 0, glow: !!glow });
        return true;
      },
      list: out
    };
  }
  // 补足/截断到 n 并转极坐标（供旋转）
  function toPolar(out, n, cx, cy) {
    var res = [];
    for (var q = 0; q < n; q++) {
      var p = out[q % out.length];
      res.push({
        ang: Math.atan2(p.y - cy, p.x - cx),
        rad: Math.hypot(p.x - cx, p.y - cy),
        spin: p.spin, glow: p.glow
      });
    }
    return res;
  }

  // ---------- 专属目标图案（返回极坐标数组） ----------
  // K-03 生命脉冲：中心医疗十字 + 双同心环 + 外围脉冲点
  function formPulse(n, cx, cy, R) {
    var p = picker(CFG.minDist), arm = R * 0.48, w = R * 0.14;
    for (var y = -arm; y <= arm; y += 7)
      for (var x = -w; x <= w; x += 7) p.add(cx + x, cy + y, 0, true);
    for (var x2 = -arm; x2 <= arm; x2 += 7)
      for (var y2 = -w; y2 <= w; y2 += 7) p.add(cx + x2, cy + y2, 0, true);
    [0.92, 1.28].forEach(function (k, ki) {
      var r = R * k, c = Math.max(12, Math.floor(2 * Math.PI * r / 8));
      for (var i = 0; i < c; i++) {
        var a = i / c * Math.PI * 2;
        if (a > 1.0 && a < 1.35) continue;
        p.add(cx + r * Math.cos(a), cy + r * Math.sin(a), ki % 2 ? 1 : -1, false);
      }
    });
    var tries = 0;
    while (p.list.length < n && tries < n * 60) {
      tries++;
      var rr = R * (0.6 + Math.random()), aa = Math.random() * Math.PI * 2;
      p.add(cx + rr * R * 0.9 * Math.cos(aa), cy + rr * R * 0.9 * Math.sin(aa), 0.3, false);
    }
    return toPolar(p.list, n, cx, cy);
  }

  // K-04 准星锁定：中心圆 + 四向准星线 + 四角取景框 + 刻度环
  function formReticle(n, cx, cy, R) {
    var p = picker(CFG.minDist);
    var cr = R * 0.16, cc = Math.floor(2 * Math.PI * cr / 7);
    for (var i = 0; i < cc; i++) {
      var a = i / cc * Math.PI * 2;
      p.add(cx + cr * Math.cos(a), cy + cr * Math.sin(a), 0, true);
    }
    for (var k = 0; k < 4; k++) {
      var ang = k * Math.PI / 2;
      for (var d = R * 0.28; d < R * 0.72; d += 7)
        p.add(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 0, false);
    }
    var s = R * 0.82, seg = R * 0.22;
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function (q) {
      var bx = cx + q[0] * s, by = cy + q[1] * s;
      for (var t = 0; t <= seg; t += 7) {
        p.add(bx - q[0] * t, by, 0, false);
        p.add(bx, by - q[1] * t, 0, false);
      }
    });
    var ring = R * 1.02, rc = Math.floor(2 * Math.PI * ring / 8);
    for (var r = 0; r < rc; r++) {
      var ra = r / rc * Math.PI * 2;
      if (ra > 2.5 && ra < 3.0) continue;
      p.add(cx + ring * Math.cos(ra), cy + ring * Math.sin(ra), 0.4, false);
    }
    var tries = 0;
    while (p.list.length < n && tries < n * 60) {
      tries++;
      var rr = R * 1.15 * Math.sqrt(Math.random()), aa = Math.random() * Math.PI * 2;
      p.add(cx + rr * Math.cos(aa), cy + rr * Math.sin(aa), 0, false);
    }
    return toPolar(p.list, n, cx, cy);
  }

  // K-05 数据网格：规则网格节点（带抖动），部分高亮
  function formMesh(n, cx, cy, R) {
    var p = picker(CFG.minDist), cols = 7, rows = 5;
    var spanX = R * 1.9, spanY = R * 1.55;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = cx - spanX/2 + spanX * c / (cols - 1) + rnd(-3, 3);
        var y = cy - spanY/2 + spanY * r / (rows - 1) + rnd(-3, 3);
        p.add(x, y, 0, Math.random() < 0.18);
        // 节点周围小卫星点
        for (var s = 0; s < 3; s++) {
          var sa = Math.random() * Math.PI * 2, sr = rnd(6, 11);
          p.add(x + sr * Math.cos(sa), y + sr * Math.sin(sa), (s % 2 ? 1 : -1) * 0.3, false);
        }
      }
    }
    var tries = 0;
    while (p.list.length < n && tries < n * 60) {
      tries++;
      var rr = R * 1.25 * Math.sqrt(Math.random()), aa = Math.random() * Math.PI * 2;
      p.add(cx + rr * Math.cos(aa), cy + rr * Math.sin(aa), 0, false);
    }
    return toPolar(p.list, n, cx, cy);
  }

  // K-06 六边护盾：蜂窝六边形顶点 + 中心盾形轮廓
  function formShield(n, cx, cy, R) {
    var p = picker(CFG.minDist), hr = R * 0.3;
    // 蜂窝：中心 + 一圈六边形
    var centers = [{ x: cx, y: cy }];
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      centers.push({ x: cx + Math.cos(a) * hr * 1.72, y: cy + Math.sin(a) * hr * 1.72 });
    }
    centers.forEach(function (c, ci) {
      for (var k = 0; k < 6; k++) {
        var va = k / 6 * Math.PI * 2 + Math.PI / 6;
        p.add(c.x + hr * Math.cos(va), c.y + hr * Math.sin(va), ci % 2 ? 0.3 : -0.3, ci === 0);
      }
    });
    // 外层盾形轮廓点
    var shieldR = R * 1.05;
    for (var s = 0; s < 5; s++) {
      for (var t = 0; t <= 12; t++) {
        var ty = -0.7 + s / 4 * 1.5;
        var halfW = shieldR * Math.sqrt(Math.max(0, 1 - ty * ty)) * (ty > 0.4 ? 0.7 : 1);
        p.add(cx - halfW + 2 * halfW * t / 12, cy + ty * shieldR * 0.85, 0, false);
      }
    }
    var tries = 0;
    while (p.list.length < n && tries < n * 60) {
      tries++;
      var rr = R * 1.2 * Math.sqrt(Math.random()), aa = Math.random() * Math.PI * 2;
      p.add(cx + rr * Math.cos(aa), cy + rr * Math.sin(aa), 0, false);
    }
    return toPolar(p.list, n, cx, cy);
  }

  // ---------- 专属效果层（在粒子之下绘制，随 morph 渐显） ----------
  function ecgWave(t) {
    if (t < 0.32) return 0;
    if (t < 0.40) return -0.14;
    if (t < 0.47) return 1;
    if (t < 0.55) return -0.3;
    if (t < 0.72) return 0.08;
    return 0;
  }
  function overlayECG(ctx, e) {
    var a = e.eased; if (a < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.8;
    ctx.strokeStyle = 'rgb(' + e.spec.glow.join(',') + ')';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    var speed = e.ts * 0.06;
    for (var x = 0; x < e.W; x += 3) {
      var ph = ((x + speed) % 150) / 150;
      var y = e.cy - ecgWave(ph) * e.H * 0.14;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  function overlayReticle(ctx, e) {
    var a = e.eased; if (a < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(e.cx, e.cy);
    ctx.rotate(e.ts * 0.00035);
    ctx.globalAlpha = a * 0.75;
    ctx.strokeStyle = 'rgb(' + e.spec.glow.join(',') + ')';
    ctx.lineWidth = 1.3;
    var r = Math.min(e.W, e.H) * 0.44;
    ctx.setLineDash([5, 11]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    for (var i = 0; i < 24; i++) {
      var ang = i / 24 * Math.PI * 2, inner = r * (i % 6 === 0 ? 0.9 : 0.95);
      ctx.beginPath();
      ctx.moveTo(inner * Math.cos(ang), inner * Math.sin(ang));
      ctx.lineTo(r * Math.cos(ang), r * Math.sin(ang));
      ctx.stroke();
    }
    ctx.restore();
  }
  function overlayMesh(ctx, e) {
    var a = e.eased; if (a < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(' + e.spec.glow.join(',') + ')';
    ctx.lineWidth = 1;
    var L = e.list, lim = Math.min(L.length, 150), th = e.W * 0.2, th2 = th * th;
    for (var i = 0; i < lim; i++) {
      for (var j = i + 1; j < lim; j++) {
        var dx = L[i].x - L[j].x, dy = L[i].y - L[j].y, d2 = dx * dx + dy * dy;
        if (d2 < th2 && d2 > 4) {
          ctx.globalAlpha = a * 0.42 * (1 - Math.sqrt(d2) / th);
          ctx.beginPath();
          ctx.moveTo(L[i].x, L[i].y); ctx.lineTo(L[j].x, L[j].y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  function overlayHex(ctx, e) {
    var a = e.eased; if (a < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(e.cx, e.cy);
    ctx.rotate(e.ts * 0.00016);
    var base = Math.min(e.W, e.H);
    [0.34, 0.52, 0.68].forEach(function (k, ki) {
      ctx.globalAlpha = a * (0.7 - ki * 0.16);
      ctx.strokeStyle = 'rgb(' + e.spec.glow.join(',') + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      var r = base * k;
      for (var i = 0; i < 6; i++) {
        var ang = i / 6 * Math.PI * 2 + Math.PI / 6;
        var x = r * Math.cos(ang), y = r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    });
    ctx.restore();
  }

  function createFx(card, seed) {
    var spec = SPECS[seed];
    var art = card && card.querySelector('.card__art');
    if (!spec || !art) return null;

    var reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce) return noop();

    var canvas = document.createElement('canvas');
    canvas.className = 'card__particles';
    canvas.setAttribute('aria-hidden', 'true');
    art.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return noop();

    var sprites = spec.tones.map(sprite);
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = 0, H = 0, cx = 0, cy = 0, list = [];
    var morph = 0, morphTarget = 0, formStart = 0;
    var running = false, raf = 0;
    var mouse = { x: -1e4, y: -1e4, at: -1e4, on: false };

    function onMove(e) {
      var r = art.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      mouse.at = performance.now(); mouse.on = true;
    }
    function onLeave() { mouse.on = false; }
    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerleave', onLeave, { passive: true });

    function sampleWord() {
      var off = document.createElement('canvas');
      off.width = W; off.height = H;
      var o = off.getContext('2d');
      o.fillStyle = '#fff';
      o.font = '900 ' + Math.round(H * 0.3) + 'px Orbitron, Rajdhani, sans-serif';
      o.textBaseline = 'alphabetic';
      o.fillText(spec.word, 14, H - 14);
      var img = o.getImageData(0, 0, W, H).data, cand = [];
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4;
        if (img[i + 3] < 40) continue;
        if (img[i] + img[i + 1] + img[i + 2] < 600) continue;
        cand.push({ x: x, y: y });
      }
      for (var s = cand.length - 1; s > 0; s--) {
        var j = Math.floor(Math.random() * (s + 1)), t = cand[s];
        cand[s] = cand[j]; cand[j] = t;
      }
      var pts = [], md2 = CFG.minDist * CFG.minDist;
      for (var k = 0; k < cand.length; k++) {
        var q = cand[k], ok = true;
        for (var m = 0; m < pts.length; m++) {
          var dx = pts[m].x - q.x, dy = pts[m].y - q.y;
          if (dx * dx + dy * dy < md2) { ok = false; break; }
        }
        if (ok) pts.push(q);
      }
      var max = W < 320 ? CFG.maxPtsSm : CFG.maxPts;
      if (pts.length > max) {
        var pick = [];
        for (var p = 0; p < max; p++) pick.push(pts[Math.floor(p * pts.length / max)]);
        pts = pick;
      }
      return pts;
    }

    function build() {
      W = art.clientWidth; H = art.clientHeight;
      if (!W || !H) return;
      cx = W / 2; cy = H / 2;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var pts = sampleWord();
      if (!pts.length) return;
      var R = Math.min(W, H) * 0.4;
      var form = spec.form(pts.length, cx, cy, R);
      list = pts.map(function (p, idx) {
        var t = form[idx % form.length];
        var tone = t.glow ? 4 : (idx % 4);
        return {
          sx: p.x, sy: p.y,
          fAng: t.ang, fRad: t.rad, fSpin: t.spin,
          x: p.x, y: p.y, px: p.x, py: p.y,
          vx: 0, vy: 0, hx: p.x, hy: p.y,
          delay: CFG.stagger * (idx / Math.max(1, pts.length)),
          size: rnd(CFG.sizeMin, CFG.sizeMax),
          tone: tone, rgb: spec.tones[tone]
        };
      });
    }

    function formPos(p, ts) {
      var a = p.fAng + p.fSpin * CFG.spin * (ts - formStart);
      return { x: cx + Math.cos(a) * p.fRad, y: cy + Math.sin(a) * p.fRad };
    }

    function step(p, ts, eased) {
      p.px = p.x; p.py = p.y;
      var c = formPos(p, ts);
      var m = clamp((eased - p.delay) / (1 - p.delay), 0, 1);
      p.hx = p.sx + (c.x - p.sx) * m;
      p.hy = p.sy + (c.y - p.sy) * m;
      var f = 0;
      if (mouse.on) f = CFG.mouseF * clamp(1 - (ts - mouse.at) / CFG.mouseIdle, 0, 1);
      if (f > 0.02) {
        var dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < CFG.mouseR * CFG.mouseR && d2 > 0.01) {
          var d = Math.sqrt(d2), push = (1 - d / CFG.mouseR) * f;
          p.vx += dx / d * push; p.vy += dy / d * push;
        }
      }
      p.vx += (p.hx - p.x) * CFG.spring;
      p.vy += (p.hy - p.y) * CFG.spring;
      p.vx += Math.sin(ts / 760 + p.sx * 0.05) * CFG.jitter;
      p.vy += Math.cos(ts / 690 + p.sy * 0.05) * CFG.jitter;
      p.vx *= CFG.damp; p.vy *= CFG.damp;
      p.x += p.vx; p.y += p.vy;
    }

    function frame(ts) {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      morph += (morphTarget - morph) * CFG.morphEase;
      if (Math.abs(morph - morphTarget) < 0.001) morph = morphTarget;
      var eased = easeInOut(morph);

      // 专属辉光：随汇聚渐显，带呼吸
      if (morph > 0.02) {
        var pulse = 0.88 + 0.12 * Math.sin(ts / 420);
        var gR = Math.min(W, H) * 0.6;
        var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, gR);
        var gc = spec.glow;
        gr.addColorStop(0, 'rgba(' + gc[0] + ',' + gc[1] + ',' + gc[2] + ',' + (0.17 * morph * pulse) + ')');
        gr.addColorStop(0.5, 'rgba(' + gc[0] + ',' + gc[1] + ',' + gc[2] + ',' + (0.07 * morph * pulse) + ')');
        gr.addColorStop(1, 'rgba(' + gc[0] + ',' + gc[1] + ',' + gc[2] + ',0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }

      // 专属效果层
      spec.overlay(ctx, { W: W, H: H, cx: cx, cy: cy, morph: morph, eased: eased, ts: ts, list: list, spec: spec });

      // 粒子层：拖尾 + 柔光点
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      var baseAlpha = 0.82;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        step(p, ts, eased);
        var dx = p.x - p.px, dy = p.y - p.py, sp2 = dx * dx + dy * dy;
        if (sp2 > 0.7) {
          ctx.globalAlpha = baseAlpha * clamp(Math.sqrt(sp2) / 9, 0.1, 0.45);
          ctx.strokeStyle = 'rgb(' + p.rgb[0] + ',' + p.rgb[1] + ',' + p.rgb[2] + ')';
          ctx.lineWidth = p.size * 0.3;
          ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        ctx.globalAlpha = baseAlpha;
        ctx.drawImage(sprites[p.tone], p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); raf = 0; }

    build();
    formStart = performance.now();
    start();

    return {
      play: function () { morphTarget = 1; start(); },
      reset: function () { morphTarget = 0; start(); },
      resize: function () { stop(); list = []; build(); formStart = performance.now(); start(); }
    };
  }

  global.CardFx = function (card) {
    var art = card && card.querySelector('.card__art');
    var seed = art && art.getAttribute('data-seed');
    if (!SPECS[seed]) return null;
    return createFx(card, seed);
  };
})(window);
