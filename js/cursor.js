/* ============================================================
   Custom Cursor — 全站双圆点惯性光标逻辑
   暴露 window.CustomCursor（可选手动控制）。独立模块，无外部依赖。
   ============================================================ */
(function () {
  var root = document.documentElement;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 触摸 / 减少动效：保留原生光标，不启动
  if (!fine || reduce) return;
  root.classList.add('has-custom-cursor');

  var dot = document.createElement('div');
  var ring = document.createElement('div');
  dot.className = 'cursor cursor-dot';
  ring.className = 'cursor cursor-ring';
  dot.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ring);
  document.body.appendChild(dot);

  var mx = window.innerWidth / 2, my = window.innerHeight / 2;
  var dx = mx, dy = my;   // 小点：紧跟
  var rx = mx, ry = my;   // 大环：惯性拖尾
  var hover = 1, hoverT = 1, press = 1;

  var HOVER_SEL = 'a, button, .btn, .card, .acc, .nav__link, [data-cursor]';

  window.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
  }, { passive: true });
  window.addEventListener('mousedown', function () { press = 0.62; });
  window.addEventListener('mouseup', function () { press = 1; });
  window.addEventListener('blur', function () { press = 1; });

  // 事件委托：悬停可交互元素时放大（对动态节点也生效）
  document.addEventListener('mouseover', function (e) {
    if (e.target.closest && e.target.closest(HOVER_SEL)) {
      hoverT = 1.55; root.classList.add('cursor-hover');
    }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest(HOVER_SEL)) {
      hoverT = 1; root.classList.remove('cursor-hover');
    }
  });

  // 离开窗口淡出 / 回到窗口淡入
  document.addEventListener('mouseleave', function () {
    dot.style.opacity = 0; ring.style.opacity = 0;
  });
  document.addEventListener('mouseenter', function () {
    dot.style.opacity = ''; ring.style.opacity = '';
  });

  function loop() {
    // 小点贴手；大环追着小点走（而非各自追鼠标），保证小点不脱离环外
    dx += (mx - dx) * 0.78;   dy += (my - dy) * 0.78;
    rx += (dx - rx) * 0.28;   ry += (dy - ry) * 0.28;
    // 间距钳制：环基准半径 13px，中心距封顶 9px → 小点始终在环内
    var gx = dx - rx, gy = dy - ry;
    var gap = Math.sqrt(gx * gx + gy * gy);
    if (gap > 9) { rx = dx - gx * 9 / gap; ry = dy - gy * 9 / gap; }
    hover += (hoverT - hover) * 0.18;
    press += (1 - press) * 0.16;

    // 形变基于环相对小点的滞后方向，保留轻微惯性观感但不让小点出环
    var vx = dx - rx, vy = dy - ry;
    var dist = Math.sqrt(vx * vx + vy * vy);
    var stretch = 1 + Math.min(dist / 14, 0.3);
    var angle = dist > 0.5 ? Math.atan2(vy, vx) : 0;
    var s = hover * press;

    ring.style.transform =
      'translate3d(' + rx + 'px,' + ry + 'px,0) rotate(' + angle + 'rad) scale(' + (s * stretch) + ',' + (s / stretch) + ')';
    dot.style.transform =
      'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + (0.15 + press * 0.85) + ')';

    requestAnimationFrame(loop);
  }
  loop();

  window.CustomCursor = { dot: dot, ring: ring };
})();
