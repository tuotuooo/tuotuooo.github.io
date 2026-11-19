/* ============================================================
   K-02 能量核心粒子特效
   ------------------------------------------------------------
   随扫描线分两遍推进，避免"整屏瞬间炸开"的突兀：
     第一遍扫描：自上而下把画面逐行粒子化（扫到哪碎到哪）；
     第二遍扫描：自上而下把颗粒逐行汇聚成密集六边形能量核心
       （中心嵌 β 字样）。每遍 1.4s，扫描线由 canvas 自绘以与
       粒子严格同步。移开复原，可反复触发。

   技术要点：浏览器无法直接把 DOM/CSS 画面取成像素，故在离屏
   canvas 上重绘一份近似的 art 作为"粒子母体"，再 getImageData
   采样。粒子数按卡片宽度自适应，移动端自动减半。

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

    // reduced-motion 下不启用粒子：返回空实现，走静态画面
    var reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce) return { play: function () {}, reset: function () {}, resize: function () {} };

    var canvas = document.createElement('canvas');
    canvas.className = 'card__particles';
    canvas.setAttribute('aria-hidden', 'true');
    art.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return { play: function () {}, reset: function () {}, resize: function () {} };

    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = 0, H = 0;
    var srcCanvas = null;          // 重绘的原画面，供"未扫描区"垫底显示
    var particles = [];
    var running = false;
    var raf = 0;
    var animStart = 0;
    // 两遍扫描，每遍时长与原 CSS 扫描线一致（1.4s），共 2.8s
    var SWEEP_MS = 1400, TOTAL_MS = SWEEP_MS * 2;

    // 重绘 art 源画面并采样出粒子起点
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

      // 青绿渐变底（呼应 data-seed="2" 的配色）
      var g = o.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#12352f');
      g.addColorStop(1, '#0a0f17');
      o.fillStyle = g; o.fillRect(0, 0, W, H);
      var rg = o.createRadialGradient(W * 0.2, H * 0.2, 4, W * 0.2, H * 0.2, W * 0.9);
      rg.addColorStop(0, 'rgba(54,209,196,.5)');
      rg.addColorStop(1, 'rgba(54,209,196,0)');
      o.fillStyle = rg; o.fillRect(0, 0, W, H);

      // 细网格点
      o.fillStyle = 'rgba(255,255,255,.09)';
      for (var gy = 8; gy < H; gy += 10) {
        for (var gx = 8; gx < W; gx += 10) o.fillRect(gx, gy, 1, 1);
      }

      // 编号字样（粒子主体来自这里）
      o.fillStyle = 'rgba(255,255,255,.94)';
      o.font = '900 ' + Math.round(H * 0.3) + 'px Orbitron, Rajdhani, sans-serif';
      o.textBaseline = 'alphabetic';
      o.fillText('K-02', 14, H - 14);

      var img = o.getImageData(0, 0, W, H).data;
      var step = W < 320 ? 4 : 5;
      var src = [];
      for (var y = 0; y < H; y += step) {
        for (var x = 0; x < W; x += step) {
          var i = (y * W + x) * 4;
          var R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
          if (A < 20) continue;
          var lum = R + G + B;
          // 亮部（字样/高光）必取，底色按概率取，形成"整块画面碎裂"的观感
          if (lum > 190 || Math.random() < 0.32) src.push({ x: x, y: y });
        }
      }
      // 粒子上限：移动端 520，桌面 900
      var max = W < 320 ? 520 : 900;
      if (src.length > max) {
        var picked = [];
        for (var k = 0; k < max; k++) picked.push(src[Math.floor(k * src.length / max)]);
        src = picked;
      }

      var targets = coreTargets(src.length);
      particles = src.map(function (p, idx) {
        var ang = Math.atan2(p.y - H / 2, p.x - W / 2) + rnd(-0.55, 0.55);
        var dist = rnd(26, 88);
        return {
          sx: p.x, sy: p.y,
          ex: clamp(p.x + Math.cos(ang) * dist, 2, W - 2),
          ey: clamp(p.y + Math.sin(ang) * dist, 2, H - 2),
          tx: targets[idx].x, ty: targets[idx].y,
          size: rnd(1.1, 2.3),
          phase: rnd(0, 6.28),
          tone: idx % 6 === 0 ? '#8affe6' : (idx % 3 === 0 ? '#5fe0cf' : '#36d1c4')
        };
      });
    }

    // 汇聚目标：六边形轮廓 + 中心 β 字样 + 向心密集填充
    function coreTargets(n) {
      var pts = [], cx = W / 2, cy = H / 2;
      var R = Math.min(W, H) * 0.33;

      // 1) 六边形轮廓（约 40%）
      var hex = [];
      for (var k = 0; k < 6; k++) {
        var a = Math.PI / 3 * k - Math.PI / 2;
        hex.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
      }
      var edgeN = Math.max(1, Math.floor(n * 0.4));
      for (var i = 0; i < edgeN; i++) {
        var t = i / edgeN * 6, e = Math.floor(t), f = t - e;
        var p1 = hex[e % 6], p2 = hex[(e + 1) % 6];
        pts.push({ x: p1[0] + (p2[0] - p1[0]) * f, y: p1[1] + (p2[1] - p1[1]) * f });
      }

      // 2) 中心 β 点阵（约 14%）
      var betaN = Math.max(1, Math.floor(n * 0.14));
      var bo = document.createElement('canvas');
      bo.width = 60; bo.height = 80;
      var bx = bo.getContext('2d');
      bx.fillStyle = '#fff';
      bx.font = 'bold 66px Georgia, serif';
      bx.textAlign = 'center'; bx.textBaseline = 'middle';
      bx.fillText('β', 30, 40);
      var bd = bx.getImageData(0, 0, 60, 80).data;
      var bp = [];
      for (var yy = 0; yy < 80; yy += 2) {
        for (var xx = 0; xx < 60; xx += 2) {
          if (bd[(yy * 60 + xx) * 4 + 3] > 60) bp.push({ x: xx, y: yy });
        }
      }
      if (bp.length) {
        for (var b = 0; b < betaN; b++) {
          var q = bp[Math.floor(b / betaN * bp.length)];
          pts.push({ x: cx + (q.x - 30) * 1.25, y: cy + (q.y - 40) * 1.25 });
        }
      }

      // 3) 其余粒子按黄金角螺旋向心填充（越靠中心越密）
      var rest = n - pts.length;
      for (var j = 0; j < rest; j++) {
        var frac = j / Math.max(1, rest - 1);
        var rad = R * 0.82 * Math.sqrt(1 - frac);
        var ang2 = j * 2.39996323;
        pts.push({ x: cx + rad * Math.cos(ang2), y: cy + rad * Math.sin(ang2) });
      }
      return pts;
    }

    // 画扫描线：一条青色光带，pos 为相对 art 顶部的比例（可为负/超过 1）
    function drawSweep(pos) {
      var y = pos * H;
      var band = Math.max(26, H * 0.16);
      var grad = ctx.createLinearGradient(0, y - band, 0, y + band);
      grad.addColorStop(0, 'rgba(54,209,196,0)');
      grad.addColorStop(0.5, 'rgba(120,255,232,.16)');
      grad.addColorStop(1, 'rgba(54,209,196,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - band, W, band * 2);
      // 亮边
      ctx.fillStyle = 'rgba(160,255,240,.55)';
      ctx.fillRect(0, y, W, 1.5);
    }

    function frame(ts) {
      if (!running) return;
      var el = ts - animStart;
      ctx.clearRect(0, 0, W, H);

      var done = el >= TOTAL_MS;
      var pass = el < SWEEP_MS ? 0 : 1;
      var local = done ? 1 : (pass === 0 ? el : el - SWEEP_MS) / SWEEP_MS;
      if (local > 1) local = 1;
      var scanPos = -0.1 + local * 1.2;         // 扫描线：顶部 -10% → 110%
      var ROWS = 0.26;                           // 扫描线扫过后，这一行带内完成动作

      // 第一遍：扫描线以下是"未扫描区"，垫完整原画面；扫过之处才碎成粒子
      if (pass === 0 && !done && srcCanvas) {
        var cutY = clamp(scanPos, 0, 1) * H;
        if (cutY < H) ctx.drawImage(srcCanvas, 0, cutY, W, H - cutY, 0, cutY, W, H - cutY);
      }

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var x, y;
        if (done) {
          // 两遍结束：核心成型，轻微呼吸维持活性
          x = p.tx; y = p.ty;
        } else if (pass === 0) {
          var rowA = p.sy / H;
          if (rowA > scanPos) continue;          // 未扫到：交给原图显示，不画散点
          var e = easeOut(clamp((scanPos - rowA) / ROWS, 0, 1));
          x = p.sx + (p.ex - p.sx) * e;
          y = p.sy + (p.ey - p.sy) * e;
        } else {
          var rowB = p.ey / H;
          var g = easeInOut(clamp((scanPos - rowB) / ROWS, 0, 1));
          x = p.ex + (p.tx - p.ex) * g;
          y = p.ey + (p.ty - p.ey) * g;
        }
        var alpha = done ? (0.82 + 0.18 * Math.sin(ts / 320 + p.phase)) : 1;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.tone;
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
      }

      // 扫描期间把扫描线画在最上层，强化"扫一遍进一步"的节奏
      if (!done) drawSweep(scanPos);
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    function play() {
      if (!particles.length) buildParticles();
      if (!particles.length) return;
      running = true;
      art.classList.add('is-shattered');
      cancelAnimationFrame(raf);
      animStart = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function reset() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, W, H);
      art.classList.remove('is-shattered');
    }

    return {
      play: play,
      reset: reset,
      resize: function () { if (running) reset(); particles = []; buildParticles(); }
    };
  }

  global.K02CoreShatter = createCoreShatter;
})(window);
