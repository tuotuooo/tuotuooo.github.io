/* ============================================================
   AETHER FRONTIER — 通用整页翻页控制器
   ------------------------------------------------------------
   设计原则（本次重构核心）：
   1. 单一数据源：current 是"当前在哪一屏"的唯一状态。
   2. 单一写入口：只有 go()（主动翻页）和 syncTo()（静默自愈）能改 current。
   3. 单一派生：导航高亮 / 吸顶标题 / 进出场动画 全部由 onActivate 从
      current 派生，不再各用一套 IntersectionObserver 各算各的。
   4. 无连翻补丁：用 scrollend（+ 兜底定时器）作为"滚动真正结束"的解锁
      信号，滚动进行中直接吞掉后续滚轮惯性；取代原 wheelArmed + 220ms
      静默、800ms goTimer、160ms syncTimer 等多个互相打架的魔数定时器。

   对外 API：
   AetherPager({ ids, onActivate }) -> { go, next, prev, current, fullpage, reduceMotion, ids, pages }
   ============================================================ */
(function (global) {
  'use strict';

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function AetherPager(options) {
    options = options || {};
    var ids = options.ids || [];
    var onActivate = options.onActivate || function () {};
    var onSync = options.onSync || function () {};

    // 只保留真实存在的 section，index 仍对应原始 ids 下标
    var entries = [];
    ids.forEach(function (id, i) {
      var el = document.getElementById(id);
      if (el) entries.push({ el: el, id: id, index: i });
    });
    if (!entries.length) return null;

    var mq = global.matchMedia || function () { return { matches: false }; };
    var reduceMotion = mq('(prefers-reduced-motion: reduce)').matches;
    var fullpage = mq('(min-width: 1024px) and (pointer: fine)').matches;

    var current = -1;
    var animating = false;         // 平滑滚动进行中 —— 连翻锁
    var scrollStopTimer = null;    // 滚动停止检测（自愈的唯一触发点）
    var unlockTimer = null;        // 最后防线
    var SCROLL_IDLE = 140;         // 无 scroll 事件持续多久算"滚动停止"
    var UNLOCK_FALLBACK = 1600;    // scrollend 与停止检测都缺席时的终极兜底

    // 桌面整页模式关掉 CSS scroll-snap，避免 proximity 吸附与 scrollIntoView
    // 互相干扰、导致 scrollend 在动画中途误触发（原实现的痛点之一）。
    if (fullpage) document.documentElement.classList.add('no-snap');

    function hashIndex() {
      var h = (global.location.hash || '').replace(/^#/, '');
      for (var i = 0; i < ids.length; i++) if (ids[i] === h) return i;
      for (var j = 0; j < entries.length; j++) if (entries[j].id === h) return entries[j].index;
      return -1;
    }

    function writeHash(index) {
      // replaceState：不新增历史、不触发 hashchange、不产生原生跳转
      try { global.history.replaceState(null, '', '#' + ids[index]); } catch (e) {}
    }

    // 唯一的状态提交点
    function commit(index, silent) {
      if (index === current) return;
      current = index;
      onActivate(ids[index], index, !!silent);
    }

    // 滚动真正停止：解锁 + 做一次精确校正（此刻视口已停稳，判定才可信）
    function onScrollStopped() {
      if (scrollStopTimer) { clearTimeout(scrollStopTimer); scrollStopTimer = null; }
      if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
      if (animating) {
        animating = false;
        // 抵达目标后按"距视口顶部最近"校正（与 block:'start' 对齐）
        syncTo(nearestIndex());
      } else {
        // 原生滚动（拖动滚动条 / 触屏 / 移动端）同样自愈
        syncTo(nearestIndex());
      }
    }

    // 主动翻页：唯一会触发平滑滚动的路径
    function go(target, opts) {
      target = clamp(target, 0, entries.length - 1);
      // 把"第几个有效 section"换算回 ids 下标，供 commit/hash 使用
      var idx = entries[target].index;
      if (idx === current) return;
      opts = opts || {};

      commit(idx, false);
      writeHash(idx);
      if (opts.noScroll) return;

      var smooth = !reduceMotion && opts.smooth !== false;
      var el = entries[target].el;

      if (smooth) {
        animating = true;
        // 主路径：监听本屏滚动停止（rAF 节流 + debounce，见下方全局 scroll 监听）。
        // 辅助路径：scrollend（支持的浏览器更精确）。
        // 终极兜底：无论前两者是否触发，超时后强制停稳校正。
        if (unlockTimer) clearTimeout(unlockTimer);
        unlockTimer = setTimeout(onScrollStopped, UNLOCK_FALLBACK);
        try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (e) { el.scrollIntoView(); onScrollStopped(); }
      } else {
        try { el.scrollIntoView({ behavior: 'auto', block: 'start' }); }
        catch (e) { el.scrollIntoView(); }
        onScrollStopped();
      }
    }

    function next() { go(currentIndex() + 1); }
    function prev() { go(currentIndex() - 1); }

    function currentIndex() {
      for (var i = 0; i < entries.length; i++) if (entries[i].index === current) return i;
      return 0;
    }

    // 静默自愈：原生滚动（拖滚动条 / 触屏 / 移动端）后把 current 拉回
    // 视口中心那屏。只更新状态与 UI，不再触发滚动，避免循环。
    function syncTo(index) {
      if (animating || index === current) return;
      commit(index, true);
      writeHash(index);
      onSync(ids[index], index);
    }

    function nearestIndex() {
      // 所有翻页都用 block:'start'，故以"section 顶部距视口顶部的距离"判定，
      // 比中心距离更稳——尤其对高于一屏的档案屏，中心点会偏离可视区域。
      var bestIdx = current, bestDist = Infinity;
      entries.forEach(function (en) {
        var d = Math.abs(en.el.getBoundingClientRect().top);
        if (d < bestDist) { bestDist = d; bestIdx = en.index; }
      });
      return bestIdx;
    }

    // 站内锚点统一走 go()，避免原生跳转绕过控制器导致状态与视口错位
    global.document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var target = a.getAttribute('href').slice(1);
      var pos = -1;
      for (var i = 0; i < entries.length; i++) if (entries[i].id === target) { pos = i; break; }
      if (pos < 0) return;
      a.addEventListener('click', function (e) { e.preventDefault(); go(pos); });
    });

    // 前进/后退或外部改 hash（replaceState 不触发本事件，故不会自循环）
    global.addEventListener('hashchange', function () {
      var h = hashIndex();
      if (h < 0) return;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].index === h) { go(i); break; }
      }
    });

    // 滚动停止检测：唯一自愈触发点。滚动进行中不断重置 debounce，
    // 只有真正停下（含平滑滚动抵达、拖动滚动条、触屏惯性结束）才校正。
    global.addEventListener('scroll', function () {
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(onScrollStopped, SCROLL_IDLE);
    }, { passive: true });
    // scrollend 更精确：支持的浏览器用它立即收尾，不依赖固定兜底
    if ('onscrollend' in global) {
      global.addEventListener('scrollend', onScrollStopped);
    }

    // 桌面整页模式：滚轮 / 键盘翻页
    if (fullpage) {
      global.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) < 8) return;
        e.preventDefault();
        // 滚动未结束就吞掉：惯性余波与快速连滑都不会连翻；
        // 一旦 scrollend/fallback 解锁，下一次有意滑动立即可用。
        if (animating) return;
        go(currentIndex() + (e.deltaY > 0 ? 1 : -1));
      }, { passive: false });

      global.addEventListener('keydown', function (e) {
        // 输入框内不劫持方向键
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); prev(); }
        else if (e.key === 'Home') { e.preventDefault(); go(0); }
        else if (e.key === 'End') { e.preventDefault(); go(entries.length - 1); }
      });
    }

    // 初始化：带 hash 打开时先瞬时定位，再统一提交状态
    var initial = hashIndex();
    var initialPos = 0;
    if (initial >= 0) {
      entries.forEach(function (en, i) { if (en.index === initial) initialPos = i; });
      try { entries[initialPos].el.scrollIntoView({ behavior: 'auto', block: 'start' }); }
      catch (e) { entries[initialPos].el.scrollIntoView(); }
      commit(initial, true);
      writeHash(initial);
    } else {
      commit(entries[0].index, true);
    }

    // 供外部读取
    var api = {
      go: go,
      next: next,
      prev: prev,
      current: function () { return current; },
      fullpage: fullpage,
      reduceMotion: reduceMotion,
      ids: ids.slice(),
      pages: entries.map(function (en) { return en.el; })
    };
    return api;
  }

  global.AetherPager = AetherPager;
})(window);
