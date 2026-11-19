/* AETHER FRONTIER — 交互脚本
   ------------------------------------------------------------
   本次重构：翻页 / 当前屏状态统一交给 js/pager.js（单一数据源）。
   本文件只负责"把状态渲染成 UI"以及各模块的局部交互：
     - onActivate 是唯一的"当前屏变化"出口，导航高亮 / 吸顶标题 /
       进出场动画 / 数字滚动 / 档案视图全部在此派生，互不重复计算。
     - 补无障碍：aria-expanded / aria-pressed / 焦点可见 / reduced-motion。
   ============================================================ */
(function () {
  'use strict';

  var mq = window.matchMedia || function () { return { matches: false }; };
  var reduceMotion = mq('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------
  // 1. 首屏加载仪式：真实进度（跟随资源加载）+ 可点击跳过
  //    原实现用 Math.random() 假进度 + 固定 1.2s，改为跟随文档就绪；
  //    保留最小展示时间以维持"仪式感"，reduced-motion 下直接完成。
  // ------------------------------------------------------------
  (function preloader() {
    var loader = document.getElementById('loader');
    var bar = document.getElementById('loaderBar');
    var pct = document.getElementById('loaderPct');
    if (!loader) { document.body.classList.add('loaded'); return; }

    var p = 0, target = 0, done = false, timer = null;
    var MIN_SHOW = 520;                 // 最短展示，避免闪一下
    var start = now();

    function now() { return (window.performance && performance.now()) || Date.now(); }
    function paint(v) {
      if (bar) bar.style.width = v + '%';
      if (pct) pct.textContent = String(Math.floor(v));
    }

    // 用 setInterval 而非 rAF 推进：定时器在无渲染帧环境（后台标签页 /
    // 无头浏览器）依然运行，避免进度停滞导致首屏永久隐藏。
    function tick() {
      p += (target - p) * 0.18 + 0.6;
      if (p > target) p = target;
      paint(p);
      if (target >= 100 && p >= 99.6) { paint(100); finish(); }
    }

    function finish() {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      var wait = reduceMotion ? 0 : Math.max(0, MIN_SHOW - (now() - start));
      setTimeout(function () {
        document.body.classList.add('loaded');
        loader.classList.add('hide');
        paint(100);
        setTimeout(function () {
          if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
        }, 900);
      }, wait);
    }

    function ready() {
      target = 100;
      // 确定性兜底：即使进度循环异常，也在短时间内强制收尾。
      setTimeout(function () { if (!done) { paint(100); finish(); } }, 320);
    }

    if (reduceMotion) { p = 100; target = 100; paint(100); finish(); return; }

    if (document.readyState === 'complete') ready();
    else window.addEventListener('load', ready, { once: true });
    setTimeout(ready, 2200);            // 极慢网络兜底：不让 loader 无限停留
    timer = setInterval(tick, 24);

    // 点击跳过
    loader.setAttribute('role', 'status');
    loader.style.cursor = 'pointer';
    loader.addEventListener('click', function () { target = 100; }, { passive: true });
  })();

  // ------------------------------------------------------------
  // 2. 顶栏滚动变色（passive + rAF 节流）
  // ------------------------------------------------------------
  (function navScroll() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var ticking = false;
    function update() {
      ticking = false;
      nav.classList.toggle('is-scrolled', window.scrollY > 40);
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  // ------------------------------------------------------------
  // 3. Hero 视差（fine pointer 且非 reduced-motion；rAF 节流）
  // ------------------------------------------------------------
  (function heroParallax() {
    var heroBg = document.getElementById('heroBg');
    var hero = document.getElementById('top');
    if (!heroBg || !hero || reduceMotion || !mq('(pointer:fine)').matches) return;
    var ticking = false, dx = 0, dy = 0;
    function apply() {
      ticking = false;
      heroBg.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      dx = ((e.clientX - r.left) / r.width - 0.5) * 30;
      dy = ((e.clientY - r.top) / r.height - 0.5) * 30;
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    });
    hero.addEventListener('mouseleave', function () {
      dx = 0; dy = 0;
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    });
  })();

  // ------------------------------------------------------------
  // 4. 标题逐字浮现（reduced-motion 下直接显示完整文本）
  // ------------------------------------------------------------
  (function splitTitle() {
    var titleEn = document.querySelector('.hero__title-en');
    if (!titleEn || titleEn.dataset.split) return;
    var text = titleEn.getAttribute('data-text') || titleEn.textContent;
    if (reduceMotion) { titleEn.textContent = text; titleEn.dataset.split = '1'; return; }
    titleEn.textContent = '';
    text.split('').forEach(function (ch, i) {
      var span = document.createElement('span');
      span.className = 'ch';
      span.textContent = ch === ' ' ? '\u00A0' : ch;   // 修正：用不换行空格
      span.style.animationDelay = (0.15 + i * 0.05) + 's';
      titleEn.appendChild(span);
    });
    titleEn.dataset.split = '1';
  })();

  // ------------------------------------------------------------
  // 5. 档案视图切换（两种视图共用一组按钮，带 aria-pressed）
  // ------------------------------------------------------------
  var pfLayouts = { card: document.getElementById('pfCard'), tl: document.getElementById('pfTl') };
  var pfBtns = Array.prototype.slice.call(document.querySelectorAll('.profile__btn'));
  var pfView = 'card';

  function profileShow(v) {
    pfView = v;
    Object.keys(pfLayouts).forEach(function (k) {
      var el = pfLayouts[k];
      if (!el) return;
      el.classList.remove('show');
      void el.offsetWidth;                 // 重排以重播进场
      if (k === v) el.classList.add('show');
    });
    pfBtns.forEach(function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  pfBtns.forEach(function (b) {
    b.setAttribute('type', 'button');
    b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
    b.addEventListener('click', function () { profileShow(b.getAttribute('data-view')); });
  });

  // ------------------------------------------------------------
  // 6. 数字滚动（进入关于屏触发一次，尊重 reduced-motion）
  // ------------------------------------------------------------
  var counted = false;
  function countUp() {
    if (counted) return;
    counted = true;
    document.querySelectorAll('.about__stat').forEach(function (el) {
      var b = el.querySelector('b');
      if (!b) return;
      if (el.hasAttribute('data-inf')) { b.textContent = '∞'; return; }
      var target = parseInt(el.getAttribute('data-count'), 10) || 0;
      if (reduceMotion) { b.textContent = ('0' + target).slice(-2); return; }
      var start = null, dur = 900;
      function step(ts) {
        if (!start) start = ts;
        var prog = Math.min((ts - start) / dur, 1);
        var val = Math.floor(prog * target);
        b.textContent = ('0' + val).slice(-2);
        if (prog < 1) requestAnimationFrame(step);
        else b.textContent = ('0' + target).slice(-2);
      }
      requestAnimationFrame(step);
    });
  }

  // ------------------------------------------------------------
  // 7. 准备章节元数据 + 注入装饰元素（HUD 角标 / 分段线）
  // ------------------------------------------------------------
  var PAGES = ['top', 'news', 'operators', 'modules', 'timeline', 'profile', 'about'];
  var navLinks = {};
  var titleData = {};
  var pageEls = {};

  document.querySelectorAll('.nav__link').forEach(function (a) {
    navLinks[a.getAttribute('href').slice(1)] = a;
  });

  PAGES.forEach(function (id) {
    var sec = document.getElementById(id);
    if (!sec) return;
    pageEls[id] = sec;
    if (sec.classList.contains('section')) {
      var hud = document.createElement('div');
      hud.className = 'hud';
      hud.setAttribute('aria-hidden', 'true');
      for (var k = 0; k < 4; k++) hud.appendChild(document.createElement('i'));
      sec.insertBefore(hud, sec.firstChild);
      var line = document.createElement('span');
      line.className = 'seg-line';
      line.setAttribute('aria-hidden', 'true');
      sec.insertBefore(line, sec.firstChild);
    }
    var t = sec.querySelector('.section__title');
    var tag = sec.querySelector('.section__tag');
    if (t) {
      var en = t.querySelector('.en'), cn = t.querySelector('.cn');
      titleData[id] = {
        en: en ? en.textContent.trim() : '',
        cn: cn ? cn.textContent.trim() : '',
        no: tag ? tag.textContent.trim() : ''
      };
    }
  });

  // 吸顶标题
  var stickyEl = document.getElementById('stickyTitle');
  var stickyNo = document.getElementById('stickyNo');
  var stickyEn = document.getElementById('stickyEn');
  var stickyCn = document.getElementById('stickyCn');
  var stickyEnabled = false;
  var lastStickyId = null;

  function updateSticky(id) {
    if (!stickyEl) return;
    var d = titleData[id];
    if (!stickyEnabled || !d) { stickyEl.classList.remove('show'); lastStickyId = null; return; }
    stickyEl.classList.add('show');
    if (id === lastStickyId) return;
    lastStickyId = id;
    stickyNo.textContent = d.no;
    stickyEn.textContent = d.en;
    stickyCn.textContent = d.cn;
    if (!reduceMotion) {
      stickyEn.classList.remove('glitch');
      void stickyEn.offsetWidth;
      stickyEn.classList.add('glitch');
    }
  }

  // ------------------------------------------------------------
  // 8. 唯一的"当前屏变化"出口：所有 UI 从这里派生
  //    取代原 secIo + navIo + pager.updateSticky 三套独立检测。
  // ------------------------------------------------------------
  function onActivate(id, index, silent) {
    // (a) 进出场动画：当前屏 in，其余屏 out
    PAGES.forEach(function (pid) {
      var el = pageEls[pid];
      if (!el) return;
      if (pid === id) { el.classList.add('in'); el.classList.remove('out'); }
      else { el.classList.remove('in'); el.classList.add('out'); }
    });

    // (b) 导航高亮 + aria-current
    Object.keys(navLinks).forEach(function (k) {
      var active = (k === id);
      navLinks[k].classList.toggle('is-active', active);
      if (active) navLinks[k].setAttribute('aria-current', 'true');
      else navLinks[k].removeAttribute('aria-current');
    });

    // (c) 吸顶标题
    updateSticky(id);

    // (d) 关于屏数字滚动
    if (id === 'about') countUp();

    // (e) 档案屏视图进场 / 离场复位
    if (id === 'profile') profileShow(pfView);
    else Object.keys(pfLayouts).forEach(function (k) {
      if (pfLayouts[k]) pfLayouts[k].classList.remove('show');
    });
  }

  // ------------------------------------------------------------
  // 9. 启动翻页控制器（单一状态源）
  // ------------------------------------------------------------
  var pager = window.AetherPager({
    ids: PAGES,
    onActivate: onActivate,
    onSync: function () {}   // 静默自愈无需额外副作用，UI 已在 onActivate 派生
  });

  if (pager) {
    stickyEnabled = pager.fullpage && !pager.reduceMotion && !!stickyEl;
    if (stickyEnabled) document.body.classList.add('sticky-mode');
    // pager 初始化时已按当前屏（可能是 #hash 直开）commit 过一次，这里补渲染
    // 是为了让吸顶标题在 stickyEnabled 就绪后正确显示。
    // 必须用 pager.current() 取实际当前屏：写死 PAGES[0] 会把 hash 直开的
    // 状态覆盖回首屏，导致目标屏停在 out 态（正文 opacity:0 一片空白）。
    var cur = pager.current();
    if (cur >= 0 && cur < PAGES.length) onActivate(PAGES[cur], cur, true);
  }

  // ------------------------------------------------------------
  // 10. 干员卡：悬停满 2s 浮出详情（触屏点击切换）
  //     定时器统一挂在当前卡片上，避免多张卡互相残留。
  // ------------------------------------------------------------
  (function cardReveal() {
    var canHover = mq('(hover: hover)').matches;
    document.querySelectorAll('#operators .card').forEach(function (card) {
      if (canHover) {
        var timer = null;
        card.addEventListener('mouseenter', function () {
          clearTimeout(timer);
          timer = setTimeout(function () { card.classList.add('revealed'); }, 2000);
        });
        card.addEventListener('mouseleave', function () {
          clearTimeout(timer);
          card.classList.remove('revealed');
        });
      } else {
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', function () { card.classList.toggle('revealed'); });
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.classList.toggle('revealed'); }
        });
      }
    });
  })();

  // ------------------------------------------------------------
  // 11. 档案条目：悬停满 1s 反差色展示详情（触屏点击切换，可键盘操作）
  // ------------------------------------------------------------
  (function profileReveal() {
    var canHover = mq('(hover: hover) and (pointer: fine)').matches;
    document.querySelectorAll('#profile .acc').forEach(function (acc) {
      // 自动生成一行摘要
      if (!acc.querySelector('.acc__sum')) {
        var b = acc.querySelector('.acc__body');
        var txt = '';
        if (b) {
          var firstLi = b.querySelector('li');
          var desc = b.querySelector('.tl__desc');
          txt = firstLi ? firstLi.textContent : (desc ? desc.textContent : '');
          txt = txt.replace(/\s+/g, ' ').trim();
          if (txt.length > 46) txt = txt.slice(0, 46) + '…';
        }
        var sum = document.createElement('div');
        sum.className = 'acc__sum';
        sum.textContent = txt;
        acc.insertBefore(sum, acc.querySelector('.acc__body'));
      }
      function toggle() { acc.classList.toggle('revealed'); }
      if (canHover) {
        var timer = null;
        acc.addEventListener('mouseenter', function () {
          clearTimeout(timer);
          timer = setTimeout(function () { acc.classList.add('revealed'); }, 1000);
        });
        acc.addEventListener('mouseleave', function () {
          clearTimeout(timer);
          acc.classList.remove('revealed');
        });
      } else {
        acc.setAttribute('tabindex', '0');
        acc.addEventListener('click', toggle);
        acc.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }
    });
  })();

  // ------------------------------------------------------------
  // 12. 移动端菜单（aria-expanded）
  // ------------------------------------------------------------
  (function mobileMenu() {
    var toggle = document.getElementById('navToggle');
    var menu = document.getElementById('navMenu');
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'navMenu');
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  })();

  // ------------------------------------------------------------
  // 13. 时间线年份切换（用 DOM API 构建，避免 innerHTML 拼接；带 aria）
  // ------------------------------------------------------------
  (function timeline() {
    var data = {
      '2026': { hl: '2026 — 边境重启', text: '深境远征赛季开启，新的据点蓝图上线，档案系统完成重构。',
        list: [['11 / 08', '服务器维护与赛季更新'], ['11 / 01', '「深境远征」预告发布'], ['09 / 15', '边境档案 2.0 上线']] },
      '2025': { hl: '2025 — 大地编码', text: '据点建造玩法实装，资源与防线进入动态平衡。',
        list: [['07 / 20', '建造蓝图系统上线'], ['04 / 02', '边境贸易站开放']] },
      '2024': { hl: '2024 — 衍生影像', text: '边境故事以动态影像延续，角色档案进一步丰富。',
        list: [['12 / 10', '年度影像合集发布'], ['06 / 18', '新角色档案解锁']] },
      '2023': { hl: '2023 — 编年史', text: '时间线系统建立，泰拉式世界观逐步铺开。',
        list: [['10 / 01', '编年史模块上线'], ['03 / 09', '首批干员入驻']] },
      '2022': { hl: '2022 — 初探', text: '档案系统雏形建立，第一批边境记录归档。',
        list: [['08 / 15', '项目启动'], ['02 / 01', '内部测试']] },
      '2021': { hl: '2021 — 立项', text: 'AETHER FRONTIER 概念确立，风格框架搭建。',
        list: [['11 / 11', '概念确立']] }
    };
    var years = Array.prototype.slice.call(document.querySelectorAll('.timeline__year'));
    var panel = document.getElementById('tlPanel');
    if (!panel || !years.length) return;

    years.forEach(function (btn) {
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-pressed', btn.classList.contains('is-active') ? 'true' : 'false');
      btn.addEventListener('click', function () {
        years.forEach(function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');

        var d = data[btn.getAttribute('data-year')];
        if (!d) return;
        var hl = document.createElement('h3'); hl.className = 'timeline__hl'; hl.textContent = d.hl;
        var tx = document.createElement('p'); tx.className = 'timeline__text'; tx.textContent = d.text;
        var ul = document.createElement('ul'); ul.className = 'timeline__list';
        d.list.forEach(function (it) {
          var li = document.createElement('li');
          var span = document.createElement('span'); span.textContent = it[0];
          li.appendChild(span);
          li.appendChild(document.createTextNode(it[1]));
          ul.appendChild(li);
        });
        panel.textContent = '';
        panel.appendChild(hl); panel.appendChild(tx); panel.appendChild(ul);
        if (!reduceMotion) {
          panel.classList.remove('is-visible');
          void panel.offsetWidth;
          panel.classList.add('is-visible');
        }
      });
    });
  })();
})();
