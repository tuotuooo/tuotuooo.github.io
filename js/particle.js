/* ============================================================
   K-02 能量核心粒子特效（黄色扫描线驱动）
   ------------------------------------------------------------
   以一条黄色扫描线扫过卡片的次数为节拍，分三幕推进：
     ① 第一遍扫过：画面自上而下逐行粒子化，粒子停在原位仍组成
        K-02 字样，已扫区背景随之虚化（未扫区保持清晰原图）；
     ② 停留：整幅是粒子化的 K-02，背景虚化、粒子轻微呼吸；
     ③ 第二遍扫过：粒子自上而下逐行被打乱（散开）再汇聚到中心，
        拼成密集六边形能量核心（中心嵌 β 字样）。
   扫描线由 canvas 自绘（黄色，与 CSS .card__scan 同色系），与粒子
   严格同步——单一时钟，避免"两条线假装同步"。移开复原，可反复触发。

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
    var srcCanvas = null;          // 完整原画面（含 K-02 字样），供第一遍未扫区清晰垫底
    var bgCanvas = null;           // 仅背景（渐变+网格，无字样），供虚化垫底——让字样只由粒子构成
    var particles = [];
    var running = false;
    var raf = 0;
    var animStart = 0;

    // 时序：第一遍扫描 → 停留 → 第二遍扫描
    var SWEEP_MS = 1400, HOLD_MS = 700;
    var T1_END = SWEEP_MS;                 // 第一遍结束
    var T2_START = SWEEP_MS + HOLD_MS;     // 第二遍开始
    var TOTAL_MS = T2_START + SWEEP_MS;    // 全部结束

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

      // 先存一份"纯背景"（无字样）——虚化垫底用，避免字样以实心虚影重复出现
      bgCanvas = document.createElement('canvas');
      bgCanvas.width = W; bgCanvas.height = H;
      bgCanvas.getContext('2d').drawImage(off, 0, 0);

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
          // 字样笔画（亮部）高密度采样以保住 "K-02" 轮廓；底色只稀疏点缀，
          // 这样粒子化后仍清楚看得出是 K-02，而不是一片均匀噪点。
          if (lum > 190 || Math.random() < 0.10) src.push({ x: x, y: y });
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
        // ex/ey = 第二遍"打乱"的散开位置（相对卡片中心的大范围随机）
        var ang = Math.atan2(p.y - H / 2, p.x - W / 2) + rnd(-1.2, 1.2);
        var dist = rnd(30, Math.min(W, H) * 0.52);
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

    // 画黄色扫描线（与 CSS .card__scan 的橙黄同色系），pos 为相对 art 顶部比例
    function drawSweep(pos) {
      var y = pos * H;
      var band = Math.max(26, H * 0.16);
      var grad = ctx.createLinearGradient(0, y - band, 0, y + band);
      grad.addColorStop(0, 'rgba(245,166,35,0)');
      grad.addColorStop(0.5, 'rgba(245,166,35,.30)');
      grad.addColorStop(1, 'rgba(245,166,35,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - band, W, band * 2);
      ctx.fillStyle = 'rgba(255,205,120,.72)';
      ctx.fillRect(0, y, W, 1.5);
    }

    // 虚化底图：只把纯背景（无 K-02 字样）模糊压暗，让字样完全由粒子构成
    function drawBlurBackdrop(alpha) {
      if (!bgCanvas || alpha <= 0) return;
      var blur = Math.max(3, Math.round(H * 0.018));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = 'blur(' + blur + 'px) brightness(.72)';
      ctx.drawImage(bgCanvas, 0, 0, W, H);
      ctx.restore();
    }

    function frame(ts) {
      if (!running) return;
      var el = ts - animStart;
      ctx.clearRect(0, 0, W, H);

      var ROWS = 0.28;                       // 扫描线扫过后，这一"行带"内完成动作
      var done = el >= TOTAL_MS;
      var stage = 3, local = 1, scanPos = 1.2;   // stage 0=第一遍 1=停留 2=第二遍 3=完成

      if (el < T1_END) {
        stage = 0; local = el / SWEEP_MS; scanPos = -0.1 + local * 1.2;
      } else if (el < T2_START) {
        stage = 1;
      } else if (!done) {
        stage = 2; local = (el - T2_START) / SWEEP_MS; scanPos = -0.1 + local * 1.2;
      }

      // ---------- 背景层 ----------
      var cutY = clamp(scanPos, 0, 1) * H;
      if (stage === 0) {
        // 第一遍：已扫区虚化底；未扫区仍是清晰原图（扫到哪虚到哪）
        if (cutY > 0) {
          ctx.save();
          ctx.beginPath(); ctx.rect(0, 0, W, cutY); ctx.clip();
          drawBlurBackdrop(0.92);
          ctx.restore();
        }
        if (cutY < H) ctx.drawImage(srcCanvas, 0, cutY, W, H - cutY, 0, cutY, W, H - cutY);
      } else if (stage === 1) {
        // 停留：整幅虚化背景
        drawBlurBackdrop(0.92);
      } else if (stage === 2) {
        // 第二遍：虚化背景随扫描渐隐，让核心从暗底浮出
        drawBlurBackdrop(clamp(1 - local * 1.05, 0, 1) * 0.92);
      }
      // done：不画底，露出 core-active 的深色背景

      // ---------- 粒子层 ----------
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var x, y, alpha = 1;
        var row = p.sy / H;

        if (stage === 0) {
          // 第一遍：扫到哪，粒子停在哪（sx,sy）——仍组成 K-02 形状
          if (row > scanPos) continue;
          alpha = easeOut(clamp((scanPos - row) / ROWS, 0, 1));
          x = p.sx; y = p.sy;
        } else if (stage === 1) {
          // 停留：粒子 K-02 轻微呼吸
          x = p.sx; y = p.sy;
          alpha = 0.86 + 0.14 * Math.sin(ts / 420 + p.phase);
        } else if (stage === 2) {
          // 第二遍：扫到哪，该行粒子先被打乱（散开）再汇聚到中心
          if (row > scanPos) {
            x = p.sx; y = p.sy; alpha = 0.9;   // 未扫到：仍是 K-02 粒子
          } else {
            var k = clamp((scanPos - row) / ROWS, 0, 1);
            var mx, my;
            if (k < 0.42) {
              var s = easeOut(k / 0.42);
              mx = p.sx + (p.ex - p.sx) * s;
              my = p.sy + (p.ey - p.sy) * s;
            } else {
              var g = easeInOut((k - 0.42) / 0.58);
              mx = p.ex + (p.tx - p.ex) * g;
              my = p.ey + (p.ty - p.ey) * g;
            }
            x = mx; y = my;
          }
        } else {
          // done：核心成型，轻微呼吸维持活性
          x = p.tx; y = p.ty;
          alpha = 0.82 + 0.18 * Math.sin(ts / 320 + p.phase);
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.tone;
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
      }

      // ---------- 黄色扫描线（仅两遍扫描期间，画在最上层）----------
      if ((stage === 0 || stage === 2) && !done) drawSweep(scanPos);

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
