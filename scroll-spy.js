/**
 * ScrollSpy
 *
 * 역할 분담
 *  HTML  : 기본 마크업 구조 (태그, 클래스, 텍스트)
 *  JS    : data-* / aria-* 속성 동적 주입, 동작 제어
 *
 * 라이프사이클
 *  createScrollSpy() → init() → _mount()
 *    → _setupData() → _setupA11y() → _bindEvents() → _startScroll()
 *    → destroy()
 *
 * 접근성 함수는 A11Y 블록으로 묶어 관리
 */

function createScrollSpy(options = {}) {
  /* ═══════════════════════════════════════════
     OPTIONS
  ═══════════════════════════════════════════ */
  const opt = {
    headerSelector: options.headerSelector || null,
    headerHeight: options.headerHeight !== undefined ? options.headerHeight : null,
    tabBarSelector: options.tabBarSelector || '[data-role="tabbar"]',
    tabSelector: options.tabSelector || '[data-role="tab"]',
    sectionSelector: options.sectionSelector || '[data-role="section"]',
    activeClass: options.activeClass || "is-active",
    fixedClass: options.fixedClass || "is-fixed",
    scrollOffset: options.scrollOffset || 0,
    throttleMs: options.throttleMs || 50,
    tabBarAriaLabel: options.tabBarAriaLabel || "섹션 탐색",
    onTabChange: options.onTabChange || null,
  };

  /* ═══════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════ */
  let _header = null;
  let _headerHeight = 0;
  let _headerObserver = null;
  let _tabBar = null;
  let _tabs = [];
  let _sections = [];
  let _tabBarHeight = 0;
  let _originalTop = null;
  let _isMounted = false;
  let _liveRegion = null;

  let _onScrollHandler = null;
  let _onResizeHandler = null;

  let _isProgrammaticScroll = false;
  let _scrollEndTimer = null;
  let _currentActiveTab = null;

  let _reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ═══════════════════════════════════════════
     LIFECYCLE — init
  ═══════════════════════════════════════════ */
  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _mount, { once: true });
    } else {
      _mount();
    }
    return api;
  }

  /* ═══════════════════════════════════════════
     LIFECYCLE — mount
  ═══════════════════════════════════════════ */
  function _mount() {
    // headerHeight 옵션이 없을 때만 headerSelector를 사용해 동적으로 측정
    if (opt.headerSelector && opt.headerHeight === null) {
      _header = document.querySelector(opt.headerSelector);
    }
    _tabBar = document.querySelector(opt.tabBarSelector);
    _tabs = Array.from(document.querySelectorAll(opt.tabSelector));
    _sections = Array.from(document.querySelectorAll(opt.sectionSelector));

    if (!_tabBar || !_tabs.length || !_sections.length) {
      console.warn("[ScrollSpy] 필수 요소를 찾을 수 없습니다. HTML 마크업을 확인하세요.");
      return;
    }

    _measureHeader();
    _measureTabBar();
    _setupData();
    _setupA11y();
    _bindEvents();
    _startScroll();

    _isMounted = true;
  }

  /* ═══════════════════════════════════════════
     DATA SETUP
  ═══════════════════════════════════════════ */
  function _setupData() {
    _tabs.forEach((tab, i) => {
      if (!tab.dataset.label) {
        tab.dataset.label = `section-${i}`;
      }
      if (_sections[i] && !_sections[i].dataset.label) {
        _sections[i].dataset.label = tab.dataset.label;
      }
    });
    document.documentElement.style.setProperty("--tabbar-height", `${_tabBarHeight}px`);
  }

  /* ════════════════════════════════════════════════════════
     ── A11Y : SETUP & TEARDOWN ──
     모든 aria-* / role 속성 주입·해제·동기화를 이 블록에서만 처리.
  ════════════════════════════════════════════════════════ */

  function _setupA11y() {
    _a11y_setupTabBar();
    _a11y_setupTabs();
    _a11y_setupSections();
    _a11y_setupLiveRegion();
    _a11y_setupReducedMotion();
  }

  function _a11y_setupTabBar() {
    _tabBar.setAttribute("role", "tablist");
    _tabBar.setAttribute("aria-label", opt.tabBarAriaLabel);
  }

  function _a11y_setupTabs() {
    _tabs.forEach((tab, i) => {
      const label = tab.dataset.label;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false"); // 초기에는 어떤 탭도 선택되지 않음
      tab.id = `scrollspy-tab-${label}`;
      tab.setAttribute("aria-controls", `scrollspy-panel-${label}`);
    });
  }

  function _a11y_setupSections() {
    _sections.forEach((section) => {
      const label = section.dataset.label;
      const tab = _getTabByLabel(label);
      // 섹션에는 tabpanel 역할만 부여, tabindex 없음 (포커싱 불필요)
      section.setAttribute("role", "tabpanel");
      section.setAttribute("aria-labelledby", tab ? tab.id : "");
      section.id = `scrollspy-panel-${label}`;
    });
  }

  function _a11y_setupLiveRegion() {
    _liveRegion = document.createElement("div");
    _liveRegion.setAttribute("role", "status");
    _liveRegion.setAttribute("aria-live", "polite");
    _liveRegion.setAttribute("aria-atomic", "true");
    const s = _liveRegion.style;
    s.position = "absolute";
    s.width = "1px";
    s.height = "1px";
    s.padding = "0";
    s.margin = "-1px";
    s.overflow = "hidden";
    s.clip = "rect(0,0,0,0)";
    s.whiteSpace = "nowrap";
    s.border = "0";
    document.body.appendChild(_liveRegion);
  }

  function _a11y_setupReducedMotion() {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
      _reducedMotion = e.matches;
    });
  }

  function _a11y_updateSelected(activeTab) {
    _tabs.forEach((tab) => {
      const isActive = tab === activeTab;
      tab.setAttribute("aria-selected", String(isActive));
    });
  }

  function _a11y_announce(activeTab) {
    if (!_liveRegion) return;
    const label = activeTab.textContent.trim();
    _liveRegion.textContent = "";
    requestAnimationFrame(() => {
      _liveRegion.textContent = `${label} 섹션으로 이동했습니다`;
    });
  }

  function _a11y_attachTab(tab, section) {
    const label = tab.dataset.label;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.id = `scrollspy-tab-${label}`;
    tab.setAttribute("aria-controls", `scrollspy-panel-${label}`);
    if (section) {
      section.setAttribute("role", "tabpanel");
      section.setAttribute("aria-labelledby", tab.id);
      section.id = `scrollspy-panel-${label}`;
    }
  }

  function _a11y_detachTab(tab, section) {
    const tabAttrs = ["role", "aria-selected", "tabindex", "aria-controls", "id"];
    const sectionAttrs = ["role", "aria-labelledby", "id"];
    tabAttrs.forEach((attr) => tab.removeAttribute(attr));
    if (section) sectionAttrs.forEach((attr) => section.removeAttribute(attr));
  }

  function _a11y_teardown() {
    _tabBar.removeAttribute("role");
    _tabBar.removeAttribute("aria-label");
    const tabAttrs = ["role", "aria-selected", "tabindex", "aria-controls", "id"];
    _tabs.forEach((tab) => tabAttrs.forEach((attr) => tab.removeAttribute(attr)));
    const sectionAttrs = ["role", "aria-labelledby", "id"];
    _sections.forEach((section) => sectionAttrs.forEach((attr) => section.removeAttribute(attr)));
    if (_liveRegion && _liveRegion.parentNode) {
      _liveRegion.parentNode.removeChild(_liveRegion);
      _liveRegion = null;
    }
  }

  /* ── A11Y 블록 끝 ── */

  /* ═══════════════════════════════════════════
     EVENTS
  ═══════════════════════════════════════════ */
  function _bindEvents() {
    _tabs.forEach((tab) => {
      tab.addEventListener("click", () => _onTabClick(tab));
    });

    _onScrollHandler = _throttle(_onScroll, opt.throttleMs);
    window.addEventListener("scroll", _onScrollHandler, { passive: true });

    _onResizeHandler = _debounce(_onResize, 200);
    window.addEventListener("resize", _onResizeHandler, { passive: true });

    if (_header && window.ResizeObserver) {
      _headerObserver = new ResizeObserver(() => {
        _measureHeader();
        _measureTabBar();
      });
      _headerObserver.observe(_header);
    }
  }

  function _onTabClick(tab) {
    const section = _getSectionByLabel(tab.dataset.label);
    if (!section) return;
    _activateTab(tab);
    _scrollToSection(section);
  }

  /* ═══════════════════════════════════════════
     SCROLL 처리
  ═══════════════════════════════════════════ */
  function _startScroll() {
    _updateFixed();
    _updateActiveByScroll();
  }

  function _onScroll() {
    _updateFixed();
    if (!_isProgrammaticScroll) _updateActiveByScroll();
  }

  /**
   * 활성 섹션 판별.
   *
   * 기본 기준 : 탭바 하단(scrollY + 탭바높이)이 섹션 top을 지나친 섹션 중 마지막.
   *
   * 마지막 섹션 예외 처리 :
   *   페이지 끝에 도달했을 때(scrollY + 뷰포트높이 >= 전체문서높이 - 1px)
   *   마지막 섹션을 강제 활성화.
   *   → 마지막 섹션 높이가 뷰포트보다 낮아도 정확히 잡힘.
   */
  function _updateActiveByScroll() {
    const scrollY = window.scrollY;
    const viewHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;

    // 일반 구간: 기준선을 지나친 섹션 중 가장 마지막
    const threshold = scrollY + _headerHeight + _tabBarHeight + opt.scrollOffset;
    let active = null;

    _sections.forEach((section) => {
      if (section.offsetTop <= threshold) {
        active = section;
      }
    });

    // 활성 후보 섹션을 지나쳤는지 확인하여 비활성화 처리
    if (active && active.offsetTop + active.offsetHeight < threshold) {
      active = null;
    }

    // 활성 섹션이 없으면(예: 페이지 최상단 또는 모든 섹션을 지난 후) 모든 탭을 비활성화
    if (!active) {
      if (_currentActiveTab) {
        _currentActiveTab.classList.remove(opt.activeClass);
        _a11y_updateSelected(null);
        _currentActiveTab = null;
      }
    } else {
      const tab = _getTabByLabel(active.dataset.label);
      if (tab && tab !== _currentActiveTab) {
        _activateTab(tab);
      }
    }
  }

  function _updateFixed() {
    if (_originalTop === null) return;

    // 헤더가 있으면 헤더 높이를 뺀 위치를 기준으로 고정 여부 판단
    const fixThreshold = _originalTop - _headerHeight;
    const shouldFix = window.scrollY >= fixThreshold;
    const isFixed = _tabBar.classList.contains(opt.fixedClass);
    if (shouldFix === isFixed) return;

    if (shouldFix) {
      _tabBar.classList.add(opt.fixedClass);
      // 헤더 높이만큼 아래에 위치
      _tabBar.style.top = `${_headerHeight}px`;
    } else {
      _tabBar.classList.remove(opt.fixedClass);
      _tabBar.style.top = "";
    }
  }

  /* ═══════════════════════════════════════════
     TAB ACTIVATE
  ═══════════════════════════════════════════ */
  function _activateTab(tab) {
    if (tab === _currentActiveTab) return;
    _currentActiveTab = tab;

    _tabs.forEach((t) => {
      t.classList.toggle(opt.activeClass, t === tab);
    });
    _a11y_updateSelected(tab);
    _a11y_announce(tab);
    _scrollTabIntoView(tab);

    if (typeof opt.onTabChange === "function") {
      opt.onTabChange(tab.dataset.label);
    }
  }

  /* ═══════════════════════════════════════════
     SCROLL TO SECTION (탭 클릭)
  ═══════════════════════════════════════════ */
  function _scrollToSection(section) {
    const top = section.getBoundingClientRect().top + window.scrollY - _headerHeight - _tabBarHeight - opt.scrollOffset;

    _isProgrammaticScroll = true;
    clearTimeout(_scrollEndTimer);

    window.scrollTo({ top: top, behavior: _reducedMotion ? "auto" : "smooth" });

    // 실제 스크롤이 멈출 때까지 100ms 간격 감지 후 플래그 해제
    let lastY = window.scrollY;
    function waitScrollEnd() {
      _scrollEndTimer = setTimeout(() => {
        if (Math.abs(window.scrollY - lastY) < 2) {
          _isProgrammaticScroll = false;
        } else {
          lastY = window.scrollY;
          waitScrollEnd();
        }
      }, 100);
    }
    waitScrollEnd();
  }

  /* ═══════════════════════════════════════════
     MEASUREMENTS
  ═══════════════════════════════════════════ */
  function _measureHeader() {
    // 1. 옵션으로 받은 하드코딩 높이가 있으면 최우선 적용
    if (typeof opt.headerHeight === "number") {
      _headerHeight = opt.headerHeight;
      // 2. 동적으로 선택된 헤더 요소가 있으면 높이 측정
    } else if (_header) {
      _headerHeight = _header.offsetHeight;
    } else {
      _headerHeight = 0;
    }
  }

  function _measureTabBar() {
    const wasFixed = _tabBar.classList.contains(opt.fixedClass);
    if (wasFixed) _tabBar.classList.remove(opt.fixedClass);

    _tabBarHeight = _tabBar.offsetHeight;
    _originalTop = Math.round(_tabBar.getBoundingClientRect().top + window.scrollY);

    if (wasFixed) _tabBar.classList.add(opt.fixedClass);

    document.documentElement.style.setProperty("--tabbar-height", `${_tabBarHeight}px`);
  }

  function _onResize() {
    _measureHeader();
    _measureTabBar();
  }

  function _scrollTabIntoView(tab) {
    if (!tab) return;
    tab.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: _reducedMotion ? "auto" : "smooth",
    });
  }

  /* ═══════════════════════════════════════════
     PUBLIC API — 동적 탭 추가·제거
  ═══════════════════════════════════════════ */
  function addTab(tabEl, sectionEl) {
    if (!_isMounted) {
      console.warn("[ScrollSpy] init() 이후에 사용하세요.");
      return;
    }

    if (!tabEl.dataset.label) tabEl.dataset.label = `section-${_tabs.length}`;
    if (sectionEl && !sectionEl.dataset.label) sectionEl.dataset.label = tabEl.dataset.label;

    tabEl.addEventListener("click", () => _onTabClick(tabEl));

    _a11y_attachTab(tabEl, sectionEl);
    _tabs.push(tabEl);
    if (sectionEl) _sections.push(sectionEl);
  }

  function removeTab(label) {
    if (!_isMounted) return;
    const tab = _getTabByLabel(label);
    const sec = _getSectionByLabel(label);

    if (tab) {
      _a11y_detachTab(tab, sec);
      _tabs.splice(_tabs.indexOf(tab), 1);
      if (tab.parentNode) tab.parentNode.removeChild(tab);
      if (tab === _currentActiveTab) _currentActiveTab = null;
    }
    if (sec) {
      _sections.splice(_sections.indexOf(sec), 1);
      if (sec.parentNode) sec.parentNode.removeChild(sec);
    }
  }

  /* ═══════════════════════════════════════════
     LIFECYCLE — destroy
  ═══════════════════════════════════════════ */
  function destroy() {
    if (!_isMounted) return;
    window.removeEventListener("scroll", _onScrollHandler);
    window.removeEventListener("resize", _onResizeHandler);
    if (_headerObserver) _headerObserver.disconnect();
    clearTimeout(_scrollEndTimer);
    _a11y_teardown();
    _tabBar.classList.remove(opt.fixedClass);
    _isMounted = false;
    _tabs = [];
    _sections = [];
    _header = null;
    _tabBar = null;
    _originalTop = null;
    _currentActiveTab = null;
  }

  /* ═══════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════ */
  function _getTabByLabel(label) {
    return _tabs.find((tab) => tab.dataset.label === label) || null;
  }

  function _getSectionByLabel(label) {
    return _sections.find((section) => section.dataset.label === label) || null;
  }

  function _throttle(fn, ms) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn(...args);
      }
    };
  }

  function _debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /* ═══════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════ */
  const api = {
    init: init,
    addTab: addTab,
    removeTab: removeTab,
    destroy: destroy,
  };

  return api;
}

/* ─────────────────────────────────────────────
 * HTML 구조 예시
 * ─────────────────────────────────────────────
 *
 *  <nav data-role="tabbar">
 *    <button data-role="tab" data-label="intro">소개</button>
 *    <button data-role="tab" data-label="menu">메뉴</button>
 *  </nav>
 *  <div class="tabbar-placeholder" aria-hidden="true"></div>
 *
 *  <section data-role="section" data-label="intro">...</section>
 *  <section data-role="section" data-label="menu">...</section>
 *
 *
 * CSS
 *
 *  [data-role="tabbar"].is-fixed {
 *    position: fixed;
 *    top: 0; left: 0; right: 0;
 *  }
 *  .tabbar-placeholder { height: 0; }
 *  [data-role="tabbar"].is-fixed ~ .tabbar-placeholder {
 *    height: var(--tabbar-height, 49px);
 *  }
 *  [data-role="tab"].is-active { border-bottom: 2px solid currentColor; }
 *
 *
 * 초기화
 *
 *  var spy = createScrollSpy({
 *    tabBarAriaLabel: '메뉴 탐색',
 *    onTabChange: function(label) { console.log(label); },
 *  }).init();
 *
 *  spy.addTab(tabEl, sectionEl);
 *  spy.removeTab('menu');
 *  spy.destroy();
 *
 * ─────────────────────────────────────────────*/
