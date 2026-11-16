/* AETHER FRONTIER — 交互脚本（原创） */
(function () {
  'use strict';

  // 首屏加载仪式：进度条 + 线条描绘，完成后触发 Hero 浮现
  (function preloader() {
    var loader = document.getElementById('loader');
    var bar = document.getElementById('loaderBar');
    var pct = document.getElementById('loaderPct');
    if (!loader) { document.body.classList.add('loaded'); return; }
    var p = 0;
    var timer = setInterval(function () {
      p += Math.random() * 13 + 5;
      if (p >= 100) {
        p = 100; clearInterval(timer);
        bar.style.width = '100%';
        pct.textContent = '100';
        setTimeout(finish, 380);
      } else {
        bar.style.width = p + '%';
        pct.textContent = Math.floor(p);
      }
    }, 90);
    function finish() {
      document.body.classList.add('loaded');
      loader.classList.add('hide');
      setTimeout(function () { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }, 900);
    }
  })();

  // 顶栏滚动变色
  var nav = document.getElementById('nav');
  function onScrollNav() {
    if (window.scrollY > 40) nav.classList.add('is-scrolled');
    else nav.classList.remove('is-scrolled');
  }

  window.addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  // Hero 鼠标视差
  var heroBg = document.getElementById('heroBg');
  var hero = document.getElementById('top');
  if (heroBg && hero && window.matchMedia('(pointer:fine)').matches) {
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width - 0.5;
      var dy = (e.clientY - r.top) / r.height - 0.5;
      heroBg.style.transform = 'translate(' + (dx * 30) + 'px,' + (dy * 30) + 'px)';
    });
    hero.addEventListener('mouseleave', function () {
      heroBg.style.transform = 'translate(0,0)';
    });
  }

  // 标题逐字浮现
  var titleEn = document.querySelector('.hero__title-en');
  if (titleEn && !titleEn.dataset.split) {
    var text = titleEn.getAttribute('data-text') || titleEn.textContent;
    titleEn.textContent = '';
    text.split('').forEach(function (ch, i) {
      var span = document.createElement('span');
      span.className = 'ch';
      span.textContent = ch === ' ' ? ' ' : ch;
      span.style.animationDelay = (0.15 + i * 0.05) + 's';
      titleEn.appendChild(span);
    });
    titleEn.dataset.split = '1';
  }

  // 翻页：整页翻页控制 + 进入/退出特效
  (function pager() {
    var ids = ['top', 'news', 'operators', 'modules', 'timeline', 'profile', 'about'];
    var pages = ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var sectMap = {};

    pages.forEach(function (sec) {
      if (sec.classList.contains('section')) {
        var line = document.createElement('span');
        line.className = 'seg-line';
        sec.insertBefore(line, sec.firstChild);
        var hud = document.createElement('div');
        hud.className = 'hud';
        for (var k = 0; k < 4; k++) hud.appendChild(document.createElement('i'));
        sec.insertBefore(hud, sec.firstChild);
      }
      sectMap[sec.id] = sec;
    });
    // 吸顶标题（仅桌面整页翻页启用）：切屏时把文字换成目标屏标题并重播故障动画
    var stickyEl = document.getElementById('stickyTitle');
    var stickyNo = document.getElementById('stickyNo');
    var stickyEn = document.getElementById('stickyEn');
    var stickyCn = document.getElementById('stickyCn');
    var stickyEnable = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
    var titleData = {};
    pages.forEach(function (sec) {
      var t = sec.querySelector('.section__title');
      var tag = sec.querySelector('.section__tag');
      if (t) titleData[sec.id] = {
        en: t.querySelector('.en') ? t.querySelector('.en').textContent.trim() : '',
        cn: t.querySelector('.cn') ? t.querySelector('.cn').textContent.trim() : '',
        no: tag ? tag.textContent.trim() : ''
      };
    });
    var lastStickyId = null;
    function updateSticky(id) {
      if (!stickyEl) return;
      var d = titleData[id];
      if (!stickyEnable || !d) { stickyEl.classList.remove('show'); lastStickyId = null; return; }
      stickyEl.classList.add('show');
      if (id === lastStickyId) return;
      lastStickyId = id;
      stickyNo.textContent = d.no;
      stickyEn.textContent = d.en;
      stickyCn.textContent = d.cn;
      stickyEn.classList.remove('glitch'); void stickyEn.offsetWidth; stickyEn.classList.add('glitch');
    }
    if (stickyEnable) document.body.classList.add('sticky-mode');

    function setActive(id) {
      if (sectMap[id]) sectMap[id].classList.add('in');
      updateSticky(id);
    }
    var current = 0;
    var locked = false;          // 动画锁：平滑滚动进行中，避免自愈误校正
    var goTimer = null;
    function go(target) {
      target = Math.max(0, Math.min(pages.length - 1, target));
      if (target === current) return;
      current = target;
      locked = true;
      pages[current].scrollIntoView({ behavior: 'smooth' });
      setActive(pages[current].id);
      // 让地址栏反映当前屏（replaceState 不新增历史、不触发原生跳转/hashchange）
      try { history.replaceState(null, '', '#' + pages[current].id); } catch (e) {}
      // 不用 scrollend 解锁：smooth + scroll-snap 共存时它会在动画中途误触发，
      // 导致锁提前解开、惯性余波连翻。改用覆盖整个动画时长的定时器。
      clearTimeout(goTimer);
      goTimer = setTimeout(function () { locked = false; }, 800);
    }

    // 修复：所有站内锚点链接统一走 go()，避免原生跳转绕过控制器导致 current 与视口错位
    // （顶栏导航、Logo、Hero 按钮、返回顶部等；空 href="#" 或无关锚点不拦截）
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      var idx = ids.indexOf(id);
      if (idx < 0) return;
      a.addEventListener('click', function (e) { e.preventDefault(); go(idx); });
    });

    // 自愈兜底：任何原生滚动 / scroll-snap 吸附 / 直接改 hash 后，滚动静止时按视口反推并校正 current
    // 这样无论从哪条路径跳页，滚轮/方向键的翻页基准始终是"视口真正所在屏"
    var syncTimer = null;
    window.addEventListener('scroll', function () {
      if (locked) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () {
        var mid = window.scrollY + window.innerHeight / 2;
        var best = current, bestD = Infinity;
        pages.forEach(function (p, i) {
          var c = p.offsetTop + p.offsetHeight / 2;
          var d = Math.abs(c - mid);
          if (d < bestD) { bestD = d; best = i; }
        });
        current = best;
        updateSticky(pages[best].id);
      }, 160);
    }, { passive: true });

    // 带 #hash 打开/刷新、浏览器前进后退时，同步到对应屏
    function syncHash(instant) {
      var idx = ids.indexOf(location.hash.slice(1));
      if (idx < 0) return;
      if (instant) {
        current = idx;
        pages[idx].scrollIntoView({ behavior: 'auto' });
        setActive(pages[idx].id);
      } else {
        go(idx);
      }
    }
    if (location.hash) syncHash(true);
    window.addEventListener('hashchange', function () { syncHash(false); });

    // 进入/离开视口：触发元素进入与退出特效（兼容窄屏原生滚动）
    var counted = false;
    function countUp() {
      document.querySelectorAll('.about__stat').forEach(function (el) {
        var b = el.querySelector('b');
        if (!b) return;
        if (el.hasAttribute('data-inf')) { b.textContent = '∞'; return; }
        var target = parseInt(el.getAttribute('data-count'), 10) || 0;
        var start = null, dur = 1100;
        function step(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          var val = Math.floor(p * target);
          b.textContent = ('0' + val).slice(-2);
          if (p < 1) requestAnimationFrame(step);
          else b.textContent = ('0' + target).slice(-2);
        }
        requestAnimationFrame(step);
      });
    }
    // 个人档案屏：视图切换 + 进场重播
    var pfLayouts = { card: document.getElementById('pfCard'), tl: document.getElementById('pfTl') };
    var pfBtns = document.querySelectorAll('.profile__btn');
    var pfView = 'card';
    function profileShow(v) {
      pfView = v;
      Object.keys(pfLayouts).forEach(function (k) {
        var el = pfLayouts[k]; if (!el) return;
        el.classList.remove('show'); void el.offsetWidth;
        if (k === v) el.classList.add('show');
      });
      pfBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
    }
    pfBtns.forEach(function (b) {
      b.addEventListener('click', function () { profileShow(b.getAttribute('data-view')); });
    });

    if ('IntersectionObserver' in window) {
      var secIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in'); e.target.classList.remove('out');
            if (e.target.id === 'about' && !counted) { counted = true; countUp(); }
            if (e.target.id === 'profile') { profileShow(pfView); }
          } else {
            e.target.classList.add('out'); e.target.classList.remove('in');
            if (e.target.id === 'profile') {
              Object.keys(pfLayouts).forEach(function (k) { if (pfLayouts[k]) pfLayouts[k].classList.remove('show'); });
            }
          }
        });
      }, { threshold: 0.25 });
      pages.forEach(function (s) { secIo.observe(s); });
    }

    // 桌面鼠标/键盘：一次滑动 = 翻一整页
    var fullpage = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
    if (fullpage) {
      // 手势去抖：一长串连续滚轮（含惯性余波）只翻一页；
      // 手停下 IDLE_MS 后释放，下一次滑动才翻下一页。
      var wheelIdle = null;
      var wheelArmed = true;
      var IDLE_MS = 220;
      window.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) < 8) return;
        e.preventDefault();
        if (!wheelArmed) {                 // 手势未结束：吞掉，并顺延释放时间
          clearTimeout(wheelIdle);
          wheelIdle = setTimeout(function () { wheelArmed = true; }, IDLE_MS);
          return;
        }
        wheelArmed = false;                // 新手势：翻一页后进入静默
        clearTimeout(wheelIdle);
        wheelIdle = setTimeout(function () { wheelArmed = true; }, IDLE_MS);
        var dir = e.deltaY > 0 ? 1 : -1;
        go(current + dir);
      }, { passive: false });
      var sy = null;
      window.addEventListener('touchstart', function (e) { sy = e.touches[0].clientY; }, { passive: true });
      window.addEventListener('touchmove', function (e) {
        if (locked || sy === null) return;
        var dy = sy - e.touches[0].clientY;
        if (Math.abs(dy) > 50) { go(current + (dy > 0 ? 1 : -1)); sy = null; }
      }, { passive: true });
      window.addEventListener('touchend', function () { sy = null; });
      window.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
        else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
        else if (e.key === 'Home') { go(0); }
        else if (e.key === 'End') { go(pages.length - 1); }
      });
    }
    setActive('top');
  })();

  // 干员卡：悬停满 2s 才浮出隐藏信息（替代点击翻牌）
  (function cardReveal() {
    var cards = document.querySelectorAll('#operators .card');
    var canHover = window.matchMedia('(hover: hover)').matches;
    cards.forEach(function (card) {
      var timer = null;
      if (canHover) {
        card.addEventListener('mouseenter', function () {
          clearTimeout(timer);
          timer = setTimeout(function () { card.classList.add('revealed'); }, 2000);
        });
        card.addEventListener('mouseleave', function () {
          clearTimeout(timer);
          card.classList.remove('revealed');
        });
      } else {
        // 触屏设备：点击切换隐藏信息
        card.addEventListener('click', function () { card.classList.toggle('revealed'); });
      }
    });
  })();

  // 档案屏：悬停满 1s → 反差色覆盖展示隐藏详情（触屏则点击切换）
  (function profileReveal() {
    var accs = document.querySelectorAll('#profile .acc');
    var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    accs.forEach(function (acc) {
      // 自动生成一行摘要（取首条要点 / 时间线取描述，截断），让单屏常驻可读
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
        acc.addEventListener('click', function () { acc.classList.toggle('revealed'); });
      }
    });
  })();

  // 移动端菜单
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');
  toggle.addEventListener('click', function () { menu.classList.toggle('is-open'); });
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { menu.classList.remove('is-open'); });
  });

  // 导航高亮
  var sections = ['news', 'operators', 'modules', 'timeline', 'profile', 'about']
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  var links = {};
  menu.querySelectorAll('.nav__link').forEach(function (a) {
    links[a.getAttribute('href').slice(1)] = a;
  });
  if ('IntersectionObserver' in window) {
    var navIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          Object.keys(links).forEach(function (k) { links[k].classList.remove('is-active'); });
          if (links[e.target.id]) links[e.target.id].classList.add('is-active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { navIo.observe(s); });
  }

  // 时间线年份切换
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
  var years = document.querySelectorAll('.timeline__year');
  var panel = document.getElementById('tlPanel');
  years.forEach(function (btn) {
    btn.addEventListener('click', function () {
      years.forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      var d = data[btn.dataset.year];
      if (!d) return;
      panel.innerHTML =
        '<h3 class="timeline__hl">' + d.hl + '</h3>' +
        '<p class="timeline__text">' + d.text + '</p>' +
        '<ul class="timeline__list">' +
        d.list.map(function (it) { return '<li><span>' + it[0] + '</span>' + it[1] + '</li>'; }).join('') +
        '</ul>';
      panel.classList.remove('is-visible');
      void panel.offsetWidth;
      panel.classList.add('is-visible');
    });
  });
})();
