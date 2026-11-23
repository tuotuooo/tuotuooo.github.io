/* ============================================================
   K-02 能量核心粒子特效（专属扫描线驱动 + 物理交互）
   ------------------------------------------------------------
   以 K-02 专属黄色扫描线（.card__scan--solo）扫过卡片的次数为节拍：
     ① 第一遍扫过：自上而下逐行把 "K-02" 字样粒子化，粒子被点亮后
        由物理弹簧归位、仍组成 K-02，已扫区背景虚化；
     ② 停留：整幅是粒子 K-02，柔和呼吸，鼠标可拨动；
     ③ 第二遍扫过：逐行把粒子炸散并改投核心目标，靠弹簧汇聚成
        "中心密集核 + 双断续轨道环 + β" 的能量核心。

   粒子不再是按关键帧插值的硬方块，而是带速度/阻尼的物理光点：
     · 弹簧把粒子拉向当前目标，带惯性与轻微回弹；
     · 鼠标在卡片上移动时对附近粒子施加斥力，粒子被拨开后弹回；
     · 鼠标停下斥力随时间衰减，核心重新聚拢。
   渲染用预渲染的径向渐变 sprite（柔光点）替代 fillRect，去掉塑料感。

   对外：window.K02CoreShatter(card) -> { play, reset, resize }
   ============================================================ */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function createCoreShatter(card) {
    var art = card && card.querySelector('.card__art');
    if (!art) return null;

    var reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce) return { play: function () {}, reset: function () {}, resize: function () {} };

    var soloScan = art.querySelector('.card__scan--solo');

    var canvas = document.createElement('canvas');
    canvas.className = 'card__particles';
    canvas.setAttribute('aria-hidden', 'true');
    art.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return { play: function () {}, reset: function () {}, resize: function () {} };

    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = 0, H = 0;
    var srcCanvas = null;          // 完整原画面（含 K-02 字样），未扫区清晰垫底
    var bgCanvas = null;           // 纯背景（无字样），虚化垫底
    var particles = [];
    var running = false;
    var raf = 0;
    var animStart = 0;
    var prevScan = -0.2;
    var lastStage = -1;

    // 时序：第一遍扫描 → 停留 → 第二遍扫描
    var SWEEP_MS = 1300, HOLD_MS = 640;
    var T1_END = SWEEP_MS;
    var T2_START = SWEEP_MS + HOLD_MS;
    var TOTAL_MS = T2_START + SWEEP_MS;

    // ---- 物理与交互参数 ----
    var SPRING = 0.035;     // 弹簧刚度：把粒子拉回目标
    var DAMP = 0.88;        // 阻尼：抑制振荡、带来惯性手感
    var MOUSE_R = 92;       // 鼠标斥力半径
    var MOUSE_F = 3.6;      // 鼠标斥力强度
    var MOUSE_IDLE = 900;   // 鼠标静止多久后斥力衰减到 0
    var mouse = { x: -9999, y: -9999, t: -9999, on: false };

    // ---- 预渲染发光点 sprite ----
    // 青绿系四色 + 金色高光 + 白色闪光；径向渐变让点是"光"而非"方块"。
    var sprites = [];
    (function buildSprites() {
      var tones = [
        [86, 232, 214], [122, 244, 224], [170, 255, 236], [54, 202, 190],
        [255, 214, 140], [255, 255, 255]
      ];
      sprites = tones.map(function (rgb) {
        var c = document.createElement('canvas');
        var s = 40; c.width = c.height = s;
        var g = c.getContext('2d');
        var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)');
        grd.addColorStop(0.16, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',.92)');
        grd.addColorStop(0.42, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',.34)');
        grd.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
        return c;
      });
    })();

    // ---- 鼠标追踪（canvas 不接收事件，绑在卡片上） ----
    function onMove(e) {
      var r = art.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.t = performance.now();
      mouse.on = true;
    }
    function onLeave() { mouse.on = false; }
    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerleave', onLeave, { passive: true });

    // β 点阵（相对中心的坐标）
    function sampleBetaPts() {
      var bo = document.createElement('canvas');
      bo.width = 56; bo.height = 72;
      var bx = bo.getContext('2d');
      bx.fillStyle = '#fff';
      bx.font = 'bold 62px Georgia, serif';
      bx.textAlign = 'center'; bx.textBaseline = 'middle';
      bx.fillText('β', 28, 36);
      var bd = bx.getImageData(0, 0, 56, 72).data;
      var arr = [];
      for (var yy = 0; yy < 72; yy += 2) {
        for (var xx = 0; xx < 56; xx += 2) {
          if (bd[(yy * 56 + xx) * 4 + 3] > 70) arr.push({ x: (xx - 28) * 1.15, y: (yy - 36) * 1.15 });
        }
      }
      return arr;
    }

    function buildParticles() {
      W = art.clientWidth; H = art.clientHeight;
      if (!W || !H) return;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var off = document.createElement('canvas');
      off.width = W; off.height = H;
      var o = off.getContext('2d');
      srcCanvas = off;

      var g = o.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#12352f');
      g.addColorStop(1, '#0a0f17');
      o.fillStyle = g; o.fillRect(0, 0, W, H);
      var rg = o.createRadialGradient(W * 0.2, H * 0.2, 4, W * 0.2, H * 0.2, W * 0.9);
      rg.addColorStop(0, 'rgba(54,209,196,.5)');
      rg.addColorStop(1, 'rgba(54,209,196,0)');
      o.fillStyle = rg; o.fillRect(0, 0, W, H);
      o.fillStyle = 'rgba(255,255,255,.09)';
      for (var gy = 8; gy < H; gy += 10) {
        for (var gx = 8; gx < W; gx += 10) o.fillRect(gx, gy, 1, 1);
      }

      bgCanvas = document.createElement('canvas');
      bgCanvas.width = W; bgCanvas.height = H;
      bgCanvas.getContext('2d').drawImage(off, 0, 0);

      o.fillStyle = 'rgba(255,255,255,.94)';
      o.font = '900 ' + Math.round(H * 0.3) + 'px Orbitron, Rajdhani, sans-serif';
      o.textBaseline = 'alphabetic';
      o.fillText('K-02', 14, H - 14);

      var img = o.getImageData(0, 0, W, H).data;
      var step = 2;
      var src = [];
      for (var y = 0; y < H; y += step) {
        for (var x = 0; x < W; x += step) {
          var i = (y * W + x) * 4;
          var R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
          if (A < 20) continue;
          if (R + G + B > 500) src.push({ x: x, y: y });  // 只采字样笔画
        }
      }
      var max = W < 320 ? 560 : 1000;
      if (src.length > max) {
        var picked = [];
        for (var k = 0; k < max; k++) picked.push(src[Math.floor(k * src.length / max)]);
        src = picked;
      }

      var core = coreTargets(src.length);
      particles = src.map(function (p, idx) {
        return {
          sx: p.x, sy: p.y,
          hx: p.x, hy: p.y,                         // 当前目标（阶段决定）
          cx: core.pts[idx].x, cy: core.pts[idx].y, // 核心图案目标
          x: p.x + rnd(-2, 2), y: p.y + rnd(-2, 2), // 物理位置
          vx: 0, vy: 0,                              // 速度
          active: false,                             // 是否已被扫描线点亮
          size: rnd(5.5, 9.5),                       // 光点 sprite 尺寸（含柔光）
          tone: core.glow[idx] ? 4 : (idx % 4),      // 色号
          phase: rnd(0, 6.28),
          flashAt: -99999
        };
      });
    }

    function coreTargets(n) {
      var pts = [], glow = [], cx = W / 2, cy = H / 2;
      var R = Math.min(W, H) * 0.33;

      var betaPts = sampleBetaPts();
      var betaN = Math.max(1, Math.floor(n * 0.1));
      if (betaPts.length) {
        for (var b = 0; b < betaN; b++) {
          var q = betaPts[Math.floor(b / betaN * betaPts.length)];
          pts.push({ x: cx + q.x, y: cy + q.y }); glow.push(true);
        }
      }
      var coreN = Math.floor(n * 0.28);
      for (var c = 0; c < coreN; c++) {
        var rr = R * 0.46 * Math.sqrt(Math.random());
        var aa = Math.random() * Math.PI * 2;
        pts.push({ x: cx + rr * Math.cos(aa), y: cy + rr * Math.sin(aa) });
        glow.push(Math.random() < 0.12);
      }
      var ring1 = Math.floor(n * 0.24);
      for (var i = 0; i < ring1; i++) {
        var a1 = i / ring1 * Math.PI * 2;
        if ((a1 > 1.0 && a1 < 1.5) || (a1 > 4.1 && a1 < 4.6)) a1 += 0.6;
        var rad1 = R * 0.8 + rnd(-R * 0.03, R * 0.03);
        pts.push({ x: cx + rad1 * Math.cos(a1), y: cy + rad1 * Math.sin(a1) }); glow.push(false);
      }
      var ring2 = Math.floor(n * 0.16);
      for (var j = 0; j < ring2; j++) {
        var a2 = j / ring2 * Math.PI * 2;
        if (a2 > 2.4 && a2 < 3.2) a2 += 0.9;
        var rad2 = R * 1.12 + rnd(-R * 0.04, R * 0.04);
        pts.push({ x: cx + rad2 * Math.cos(a2), y: cy + rad2 * Math.sin(a2) }); glow.push(false);
      }
      while (pts.length < n) {
        var rr2 = R * 1.5 * Math.pow(Math.random(), 0.7);
        var a3 = Math.random() * Math.PI * 2;
        pts.push({ x: cx + rr2 * Math.cos(a3), y: cy + rr2 * Math.sin(a3) }); glow.push(false);
      }
      return { pts: pts, glow: glow };
    }

    function moveScan(pos, opacity) {
      if (!soloScan) return;
      soloScan.style.transform = 'translate3d(0,' + (pos * H) + 'px,0)';
      if (opacity != null) soloScan.style.opacity = opacity;
    }
    function readScan() {
      if (!soloScan) return -1;
      var a = art.getBoundingClientRect();
      var s = soloScan.getBoundingClientRect();
      if (!a.height) return -1;
      return (s.top + s.height / 2 - a.top) / a.height;
    }
    function drawBlurBackdrop(alpha) {
      if (!bgCanvas || alpha <= 0) return;
      var blur = Math.max(3, Math.round(H * 0.018));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = 'blur(' + blur + 'px) brightness(.72)';
      ctx.drawImage(bgCanvas, 0, 0, W, H);
      ctx.restore();
    }

    // 单个粒子的物理积分：弹簧回目标 + 鼠标斥力 + 扰动 + 阻尼
    function step(p, ts) {
      if (!mouse.on) mouse.x = -9999;
      var f = 0;
      if (mouse.on) {
        var idle = ts - mouse.t;
        f = MOUSE_F * clamp(1 - idle / MOUSE_IDLE, 0, 1);
      }
      if (f > 0.02) {
        var dx = p.x - mouse.x, dy = p.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < MOUSE_R * MOUSE_R && d2 > 0.01) {
          var d = Math.sqrt(d2);
          var push = (1 - d / MOUSE_R) * f;
          p.vx += dx / d * push;
          p.vy += dy / d * push;
        }
      }
      p.vx += (p.hx - p.x) * SPRING;
      p.vy += (p.hy - p.y) * SPRING;
      p.vx += Math.sin(ts / 700 + p.phase) * 0.02;   // 有机微扰
      p.vy += Math.cos(ts / 640 + p.phase) * 0.02;
      p.vx *= DAMP; p.vy *= DAMP;
      p.x += p.vx; p.y += p.vy;
    }

    function frame(ts) {
      if (!running) return;
      var el = ts - animStart;
      ctx.clearRect(0, 0, W, H);

      var stage = 3, local = 1, scanPos = 1.2, lineOp = 0;
      if (el < T1_END) { stage = 0; local = el / SWEEP_MS; }
      else if (el < T2_START) { stage = 1; }
      else if (el < TOTAL_MS) { stage = 2; local = (el - T2_START) / SWEEP_MS; }

      if (stage !== lastStage) {
        if (stage === 0 || stage === 2) prevScan = -0.2;
        lastStage = stage;
      }

      if (stage === 0 || stage === 2) {
        var eased = easeInOut(local);
        scanPos = -0.14 + eased * 1.28;
        lineOp = clamp(local / 0.08, 0, 1) * clamp((1 - local) / 0.16, 0, 1);
      }

      moveScan(scanPos, lineOp);
      if (stage === 0 || stage === 2) {
        var real = readScan();
        if (real >= -0.5) scanPos = real;
        for (var n = 0; n < particles.length; n++) {
          var pp = particles[n];
          var row = pp.sy / H;
          if (row > prevScan && row <= scanPos) {
            if (stage === 0) {
              if (!pp.active) {
                pp.active = true; pp.flashAt = ts;
                pp.hx = pp.sx; pp.hy = pp.sy;
                pp.vy = rnd(-1.6, -0.3);   // 被点亮时轻微弹起
              }
            } else {
              pp.hx = pp.cx; pp.hy = pp.cy; pp.flashAt = ts;
              var a = rnd(0, 6.28), sp = rnd(2.6, 6.2);
              pp.vx += Math.cos(a) * sp; pp.vy += Math.sin(a) * sp;  // 炸散初速度
            }
          }
        }
        prevScan = scanPos;
      }
      if (stage === 1) {
        for (var m = 0; m < particles.length; m++) {
          if (!particles[m].active) { particles[m].active = true; particles[m].hx = particles[m].sx; particles[m].hy = particles[m].sy; }
        }
      } else if (stage === 3) {
        for (var q = 0; q < particles.length; q++) { particles[q].active = true; particles[q].hx = particles[q].cx; particles[q].hy = particles[q].cy; }
      }

      // 背景层
      var cutY = clamp(scanPos, 0, 1) * H;
      if (stage === 0) {
        if (cutY > 0) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, cutY); ctx.clip();
          drawBlurBackdrop(0.88); ctx.restore();
        }
        if (cutY < H) ctx.drawImage(srcCanvas, 0, cutY, W, H - cutY, 0, cutY, W, H - cutY);
      } else if (stage === 1) {
        drawBlurBackdrop(0.88);
      } else if (stage === 2) {
        drawBlurBackdrop(clamp(1 - local * 1.05, 0, 1) * 0.88);
      }

      // 核心辉光
      var coreGlow = 0;
      if (stage === 2) coreGlow = easeOut(clamp((local - 0.22) / 0.78, 0, 1));
      else if (stage === 3) coreGlow = 1;
      if (coreGlow > 0) {
        var pulse = 0.85 + 0.15 * Math.sin(ts / 360);
        var gR = Math.min(W, H) * 0.58;
        var ggrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, gR);
        ggrad.addColorStop(0, 'rgba(120,255,232,' + (0.20 * coreGlow * pulse) + ')');
        ggrad.addColorStop(0.45, 'rgba(64,214,198,' + (0.10 * coreGlow * pulse) + ')');
        ggrad.addColorStop(1, 'rgba(64,214,198,0)');
        ctx.fillStyle = ggrad; ctx.fillRect(0, 0, W, H);
      }

      // 粒子层：先跑物理，再画柔光点
      ctx.globalCompositeOperation = 'lighter';
      var baseAlpha = (stage === 0 || stage === 1) ? 0.9 : 0.62;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (!p.active) continue;
        step(p, ts);
        var sz = p.size;
        ctx.globalAlpha = baseAlpha;
        ctx.drawImage(sprites[p.tone], p.x - sz / 2, p.y - sz / 2, sz, sz);
        var fa = ts - p.flashAt;
        if (fa >= 0 && fa < 220) {
          ctx.globalAlpha = (1 - fa / 220) * 0.7;
          var fs = sz * 0.75;
          ctx.drawImage(sprites[5], p.x - fs / 2, p.y - fs / 2, fs, fs);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    function play() {
      if (!particles.length) buildParticles();
      if (!particles.length) return;
      running = true;
      art.classList.add('is-shattered');
      cancelAnimationFrame(raf);
      prevScan = -0.2; lastStage = -1;
      moveScan(-0.14, 0);
      animStart = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function reset() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, W, H);
      moveScan(-0.14, 0);
      art.classList.remove('is-shattered');
      mouse.on = false;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.active = false; p.vx = 0; p.vy = 0;
        p.x = p.sx; p.y = p.sy; p.hx = p.sx; p.hy = p.sy;
      }
    }

    return {
      play: play,
      reset: reset,
      resize: function () { if (running) reset(); particles = []; buildParticles(); }
    };
  }

  global.K02CoreShatter = createCoreShatter;
})(window);
