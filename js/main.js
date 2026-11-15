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

  // 滚动进度条
  var progress = document.getElementById('scrollProgress');
  function onScrollProgress() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var pct = max > 0 ? (h.scrollTop || window.scrollY) / max * 100 : 0;
    progress.style.width = pct + '%';
  }
  window.addEventListener('scroll', function () {
    onScrollNav(); onScrollProgress();
  }, { passive: true });
  onScrollNav(); onScrollProgress();

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

  // 翻页：右侧指示 + 线条过渡 + 整页翻页控制
  (function pager() {
    var pagerEl = document.getElementById('pager');
    var ids = ['top', 'news', 'operators', 'modules', 'timeline', 'about'];
    var pages = ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var sectMap = {}; var dots = []; var idx = 0; var locked = false;

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
    ids.forEach(function (id, i) {
      var dot = document.createElement('button');
      dot.className = 'pager__dot';
      dot.setAttribute('data-label', id.toUpperCase());
      dot.setAttribute('aria-label', id);
      dot.addEventListener('click', function () { go(i); });
      pagerEl.appendChild(dot);
      dots.push({ id: id, el: dot });
    });

    function setActive(id) {
      dots.forEach(function (d) { d.el.classList.toggle('is-active', d.id === id); });
      if (sectMap[id]) sectMap[id].classList.add('in');
    }
    var current = 0;
    var locked = false;
    function go(target) {
      target = Math.max(0, Math.min(pages.length - 1, target));
      if (target === current) return;
      current = target;
      locked = true;
      pages[current].scrollIntoView({ behavior: 'smooth' });
      setActive(pages[current].id);
      var done = false;
      function fin() { if (done) return; done = true; locked = false; }
      window.addEventListener('scrollend', fin, { once: true });
      setTimeout(fin, 1000);
    }

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
    if ('IntersectionObserver' in window) {
      var secIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in'); e.target.classList.remove('out');
            if (e.target.id === 'about' && !counted) { counted = true; countUp(); }
          } else {
            e.target.classList.add('out'); e.target.classList.remove('in');
          }
        });
      }, { threshold: 0.25 });
      pages.forEach(function (s) { secIo.observe(s); });
    }

    // 桌面鼠标/键盘：一次滑动 = 翻一整页
    var fullpage = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
    if (fullpage) {
      window.addEventListener('wheel', function (e) {
        e.preventDefault();
        if (locked || Math.abs(e.deltaY) < 8) return;
        go(current + (e.deltaY > 0 ? 1 : -1));
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

  // 移动端菜单
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');
  toggle.addEventListener('click', function () { menu.classList.toggle('is-open'); });
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { menu.classList.remove('is-open'); });
  });

  // 导航高亮
  var sections = ['news', 'operators', 'modules', 'timeline', 'about']
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
