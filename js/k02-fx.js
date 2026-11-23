/* ============================================================
   K-02 特效 · 源能反应堆版 (k02-fx)
   ------------------------------------------------------------
   · 默认就是"粒子组成的 K-02"，粒子互不重叠（最小中心距约束）。
   · 悬停：同一批粒子平滑汇聚成一座源能反应堆——脉动堆芯 +
     6 根径向能量导流臂（流光脉冲）+ 双反向旋转约束环；移开流回。
     静态与动态都是粒子，弹簧驱动连续过渡——没有扫描擦除、没有硬切。
   · 全自包含，window.K02Fx(card) -> { play, reset, resize }。
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = {
    spring: 0.05,        // 弹簧刚度：趋近目标的力度
    damp: 0.85,          // 阻尼
    jitter: 0.010,       // 有机微扰（静止时的呼吸）
    mouseR: 96,          // 鼠标斥力半径
    mouseF: 3.8,         // 鼠标斥力强度
    mouseIdle: 850,      // 鼠标静止多久后斥力归零
    spin: 0.00024,       // 环旋转角速度基准 (rad/ms)
    morphEase: 0.05,     // 形态趋近速度
    stagger: 0.26,       // 粒子错峰比例（汇聚有层次但不割裂）
    minDist: 5.5,        // 粒子最小中心距——保证不重叠（光点直径 < 5.5）
    sizeMin: 3.2,
    sizeMax: 4.6,
    coreR: 0.34,         // 反应堆半径系数
    arms: 6,             // 径向能量导流臂数量
    armSpin: 0.12,       // 导流臂整体缓慢自转角速度系数
    maxPts: 620,         // 桌面粒子上限
    maxPtsSm: 380        // 窄卡粒子上限
  };

  var TONES = [
    [86, 232, 214], [122, 244, 224], [170, 255, 236], [54, 202, 190],
    [255, 214, 140], [255, 255, 255]
  ];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // 预渲染径向渐变光点：是"光"而非"方块"
  function makeSprite(rgb) {
    var c = document.createElement('canvas');
    var s = 40; c.width = c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',1)');
    grd.addColorStop(0.18, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',.9)');
    grd.addColorStop(0.46, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',.28)');
    grd.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return c;
  }
  var SPRITES = TONES.map(makeSprite);

  function noop() { return { play: function () {}, reset: function () {}, resize: function () {} }; }

  function createFx(card) {
    var art = card && card.querySelector('.card__art');
    if (!art) return null;

    var reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce) return noop();

    var canvas = document.createElement('canvas');
    canvas.className = 'card__particles';
    canvas.setAttribute('aria-hidden', 'true');
    art.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return noop();

    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = 0, H = 0, cx = 0, cy = 0, list = [], reactorR = 0;
    var morph = 0, morphTarget = 0, coreStart = 0;
    var running = false, raf = 0;
    var mouse = { x: -1e4, y: -1e4, at: -1e4, on: false };

    function onMove(e) {
      var r = art.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.at = performance.now();
      mouse.on = true;
    }
    function onLeave() { mouse.on = false; }
    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerleave', onLeave, { passive: true });

    // ---- 采样 K-02 字样：亮度阈值 + 最小间距（穿线法），粒子互不重叠 ----
    function sampleWord() {
      var off = document.createElement('canvas');
      off.width = W; off.height = H;
      var o = off.getContext('2d');
      o.fillStyle = '#fff';
      o.font = '900 ' + Math.round(H * 0.38) + 'px Orbitron, Rajdhani, sans-serif';
      o.textAlign = 'center'; o.textBaseline = 'alphabetic';
      o.fillText('K-02', W / 2, H * 0.76);
      var img = o.getImageData(0, 0, W, H).data;
      var cand = [];
      for (var y = 0; y < H; y += 1) {
        for (var x = 0; x < W; x += 1) {
          var i = (y * W + x) * 4;
          if (img[i + 3] < 40) continue;
          if (img[i] + img[i + 1] + img[i + 2] < 620) continue;
          cand.push({ x: x, y: y });
        }
      }
      // 随机化候选顺序，避免条纹取样；再按最小中心距挑选
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

    // ---- 源能反应堆目标：脉动堆芯 + 6 径向导流臂 + 双反向约束环 + 弥散晕 ----
    // 按预算分配：每个部件都有精确配额，保证结构完整（不会因先到先得被饿断）。
    // spin: 0.3=堆芯 / armSpin=导流臂 / +1,-1=约束环 / 0.25=晕
    function makeReactor(n) {
      var out = [], R = Math.min(W, H) * CFG.coreR;
      reactorR = R;
      var md = CFG.minDist, md2 = md * md;
      function add(x, y, spin, glow) {
        if (out.length >= n) return false;
        for (var i = 0; i < out.length; i++) {
          var dx = out[i].x - x, dy = out[i].y - y;
          if (dx * dx + dy * dy < md2) return false;
        }
        out.push({ x: x, y: y, spin: spin, glow: glow });
        return true;
      }

      // 配额（总和 n）：堆芯 26% / 内环 15% / 外环 17% / 6 臂 30% / 弥散补足
      var qCore = Math.round(n * 0.26);
      var qIn = Math.round(n * 0.15);
      var qOut = Math.round(n * 0.17);
      var qArm = Math.round(n * 0.30);

      // 1) 脉动堆芯：中心密集盘（缓慢自转），高光偏暖金
      var tries = 0;
      while (out.length < qCore && tries < n * 40) {
        tries++;
        var cr = R * 0.46 * Math.sqrt(Math.random()), ca = Math.random() * Math.PI * 2;
        add(cx + cr * Math.cos(ca), cy + cr * Math.sin(ca), 0.3, Math.random() < 0.18);
      }

      // 2) 6 根径向能量导流臂：每根按配额均匀铺点，从堆芯外缘到反应堆外，缓慢同向自转
      var ARM = CFG.arms, perArm = Math.max(6, Math.floor(qArm / ARM));
      for (var k = 0; k < ARM && out.length < n; k++) {
        var ba = k / ARM * Math.PI * 2 + Math.PI / 6;
        var cb = Math.cos(ba), sb = Math.sin(ba);
        for (var u = 0; u < perArm && out.length < n; u++) {
          var rr = R * (0.42 + (1.32 - 0.42) * (u / perArm));
          add(cx + cb * rr, cy + sb * rr, CFG.armSpin, rr > R && Math.random() < 0.16);
        }
      }

      // 3) 内约束环 r=0.7R：顺时针(+1)，四处刻度缺口，每 6 点一个高光刻度
      var rIn = R * 0.7;
      for (var i1 = 0; i1 < qIn && out.length < n; i1++) {
        var a1 = i1 / qIn * Math.PI * 2;
        var seg1 = a1 % (Math.PI / 2);
        if (seg1 > 1.34 && seg1 < 1.58) continue;
        add(cx + rIn * Math.cos(a1), cy + rIn * Math.sin(a1), 1, i1 % 6 === 0);
      }

      // 4) 外约束环 r=1.12R：逆时针(-1)，六处刻度缺口，每 8 点一个高光刻度
      var rOut = R * 1.12;
      for (var i2 = 0; i2 < qOut && out.length < n; i2++) {
        var a2 = i2 / qOut * Math.PI * 2;
        var seg2 = a2 % (Math.PI / 3);
        if (seg2 > 0.88 && seg2 < 1.08) continue;
        add(cx + rOut * Math.cos(a2), cy + rOut * Math.sin(a2), -1, i2 % 8 === 0);
      }

      // 5) 弥散晕补足到 n（半径较大，仍守间距）
      tries = 0;
      while (out.length < n && tries < n * 90) {
        tries++;
        var rr2 = R * 1.4 * Math.pow(Math.random(), 0.7), aa2 = Math.random() * Math.PI * 2;
        add(cx + rr2 * Math.cos(aa2), cy + rr2 * Math.sin(aa2), 0.25, false);
      }
      // 极端兜底：略放宽间距也要凑够 n
      var md2b = (md * 0.7) * (md * 0.7);
      while (out.length < n) {
        var rr3 = R * 1.6 * Math.sqrt(Math.random()), aa3 = Math.random() * Math.PI * 2;
        var x = cx + rr3 * Math.cos(aa3), y = cy + rr3 * Math.sin(aa3), ok = true;
        for (var z = 0; z < out.length; z++) {
          var ddx = out[z].x - x, ddy = out[z].y - y;
          if (ddx * ddx + ddy * ddy < md2b) { ok = false; break; }
        }
        if (ok) out.push({ x: x, y: y, spin: 0.25, glow: false });
      }

      // 转极坐标（供旋转）
      var res = [];
      for (var q = 0; q < n; q++) {
        var pt = out[q];
        res.push({
          ang: Math.atan2(pt.y - cy, pt.x - cx),
          rad: Math.hypot(pt.x - cx, pt.y - cy),
          spin: pt.spin, glow: pt.glow
        });
      }
      return res;
    }

    function build() {
      W = art.clientWidth; H = art.clientHeight;
      if (!W || !H) return;
      cx = W / 2; cy = H / 2;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var pts = sampleWord();
      if (!pts.length) return;
      var core = makeReactor(pts.length);
      list = pts.map(function (p, idx) {
        var t = core[idx] || core[core.length - 1];
        var tone = t.glow ? 4 : (idx % 4);
        return {
          sx: p.x, sy: p.y,                      // K-02 字形锚点
          cAng: t.ang, cRad: t.rad, cSpin: t.spin, // 反应堆目标极坐标
          x: p.x, y: p.y, px: p.x, py: p.y,
          vx: 0, vy: 0, hx: p.x, hy: p.y,
          delay: CFG.stagger * (idx / Math.max(1, pts.length)), // 错峰汇聚
          size: rnd(CFG.sizeMin, CFG.sizeMax),
          tone: tone, rgb: TONES[tone]
        };
      });
    }

    // 某粒子当前时刻的反应堆位置（含旋转）
    function corePos(p, ts) {
      var a = p.cAng + p.cSpin * CFG.spin * (ts - coreStart);
      return { x: cx + Math.cos(a) * p.cRad, y: cy + Math.sin(a) * p.cRad };
    }

    // 物理步进：字形 → 反应堆按 eased 插值，叠加鼠标斥力 + 弹簧 + 微扰 + 阻尼
    function step(p, ts, eased) {
      p.px = p.x; p.py = p.y;
      var c = corePos(p, ts);
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

    // 导流臂脉冲流光：随汇聚显现，能量光点沿 6 根臂向外流动（与粒子臂同步自转）
    function drawReactorFlow(ts, eased) {
      if (eased < 0.18 || reactorR <= 0) return;
      var t0 = ts - coreStart;
      var a = clamp((eased - 0.18) / 0.82, 0, 1);
      var r0 = reactorR * 0.4, r1 = reactorR * 1.3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (var k = 0; k < CFG.arms; k++) {
        var ang = k / CFG.arms * Math.PI * 2 + Math.PI / 6
                + CFG.armSpin * CFG.spin * t0;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var x0 = cx + ca * r0, y0 = cy + sa * r0;
        var x1 = cx + ca * r1, y1 = cy + sa * r1;
        // 臂底导光带
        var lg = ctx.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, 'rgba(86,232,214,' + (0.24 * a) + ')');
        lg.addColorStop(0.55, 'rgba(122,244,224,' + (0.12 * a) + ')');
        lg.addColorStop(1, 'rgba(86,232,214,0)');
        ctx.strokeStyle = lg;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // 流光点：相位错开，两端淡入淡出
        var ph = ((t0 / 1150) + k / CFG.arms) % 1;
        var pr = r0 + (r1 - r0) * ph;
        var px = cx + ca * pr, py = cy + sa * pr;
        var fade = Math.sin(ph * Math.PI);
        var gr = ctx.createRadialGradient(px, py, 0, px, py, 6.5);
        gr.addColorStop(0, 'rgba(207,255,240,' + (0.9 * a * fade) + ')');
        gr.addColorStop(0.4, 'rgba(86,232,214,' + (0.4 * a * fade) + ')');
        gr.addColorStop(1, 'rgba(86,232,214,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(px, py, 6.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(ts) {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      morph += (morphTarget - morph) * CFG.morphEase;
      if (Math.abs(morph - morphTarget) < 0.001) morph = morphTarget;
      var eased = easeInOut(morph);

      // 堆芯辉光：随汇聚渐显，带呼吸，集中在反应堆中心
      if (morph > 0.02) {
        var pulse = 0.86 + 0.14 * Math.sin(ts / 420);
        var gR = reactorR * 1.75;
        var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, gR);
        gr.addColorStop(0, 'rgba(120,255,232,' + (0.20 * morph * pulse) + ')');
        gr.addColorStop(0.45, 'rgba(64,214,198,' + (0.09 * morph * pulse) + ')');
        gr.addColorStop(1, 'rgba(64,214,198,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }

      // 导流臂脉冲流光（在粒子之下，衬托粒子清晰）
      drawReactorFlow(ts, eased);

      // 粒子层（常驻渲染）：拖尾 + 柔光点
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
        ctx.drawImage(SPRITES[p.tone], p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); raf = 0; }

    // 初始化即进入粒子 K-02 态（常驻）
    build();
    coreStart = performance.now();
    start();

    return {
      play: function () { morphTarget = 1; start(); },   // 悬停：汇聚成源能反应堆
      reset: function () { morphTarget = 0; start(); },  // 移开：流回 K-02 粒子
      resize: function () { stop(); list = []; build(); coreStart = performance.now(); start(); }
    };
  }

  global.K02Fx = createFx;
})(window);
