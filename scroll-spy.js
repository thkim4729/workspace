function createScrollSpy(options = {}) {
  const opt = {
    headerSelector: options.headerSelector || null,
    headerHeight: options.headerHeight !== undefined ? options.headerHeight : null,
    tabBarSelector: options.tabBarSelector || '[data-role="tabbar"]',
    tabSelector: options.tabSelector || '[data-role="tab"]',
    sectionSelector: options.sectionSelector || '[data-role="section"]',
    containerSelector: options.containerSelector || null,
    activeClass: options.activeClass || "is-active",
    fixedClass: options.fixedClass || "is-fixed",
    hiddenClass: options.hiddenClass || "is-hidden",
    scrollOffset: options.scrollOffset || 0,
    tabBarAriaLabel: options.tabBarAriaLabel || "섹션 탐색",
    hideTabBarOutsideContainer:
      options.hideTabBarOutsideContainer !== undefined ? options.hideTabBarOutsideContainer : false,
    onTabChange: options.onTabChange || null,
  };

  let _header = null;
  let _headerHeight = 0;
  let _headerObserver = null;
  let _tabBar = null;
  let _tabs = [];
  let _sections = [];

  let _container = null;
  let _containerTop = 0;
  let _containerBottom = 0;

  let _tabBarHeight = 0;
  let _originalTop = null;
  let _sectionBounds = [];

  let _isMounted = false;
  let _liveRegion = null;

  let _onScrollHandler = null;
  let _onResizeHandler = null;
  let _scrollRafId = null;

  let _isProgrammaticScroll = false;
  let _scrollEndTimer = null;
  let _currentActiveTab = null;

  let _reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _mount, { once: true });
    } else {
      _mount();
    }
    return api;
  }

  function _mount() {
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

    _container = opt.containerSelector
      ? document.querySelector(opt.containerSelector)
      : _sections[0]
        ? _sections[0].parentElement
        : null;

    _setupData();
    _setupA11y();
    _bindEvents();

    _measureAll();
    _startScroll();

    _isMounted = true;
  }

  function _setupData() {
    _tabs.forEach((tab, i) => {
      if (!tab.dataset.label) tab.dataset.label = `section-${i}`;
      if (_sections[i] && !_sections[i].dataset.label) {
        _sections[i].dataset.label = tab.dataset.label;
      }
    });
  }

  function _setupA11y() {
    _tabBar.setAttribute("role", "tablist");
    _tabBar.setAttribute("aria-label", opt.tabBarAriaLabel);

    _tabs.forEach((tab) => _a11y_attachTab(tab));
    _sections.forEach((section) => {
      const tab = _getTabByLabel(section.dataset.label);
      _a11y_attachSection(section, tab);
    });

    _a11y_setupLiveRegion();

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    _reducedMotion = mediaQuery.matches;
    mediaQuery.addEventListener("change", _onReducedMotionChange);
  }

  function _onReducedMotionChange(e) {
    _reducedMotion = e.matches;
  }

  function _a11y_setupLiveRegion() {
    _liveRegion = document.createElement("div");
    _liveRegion.setAttribute("role", "status");
    _liveRegion.setAttribute("aria-live", "polite");
    _liveRegion.setAttribute("aria-atomic", "true");
    Object.assign(_liveRegion.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0,0,0,0)",
      whiteSpace: "nowrap",
      border: "0",
    });
    document.body.appendChild(_liveRegion);
  }

  function _a11y_updateSelected(activeTab) {
    _tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab === activeTab)));
  }

  function _a11y_announce(activeTab) {
    if (!_liveRegion) return;
    const label = activeTab.textContent.trim();
    _liveRegion.textContent = "";
    requestAnimationFrame(() => {
      _liveRegion.textContent = `${label} 섹션으로 이동했습니다`;
    });
  }

  function _a11y_attachTab(tab) {
    const label = tab.dataset.label;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.id = `scrollspy-tab-${label}`;
    tab.setAttribute("aria-controls", `scrollspy-panel-${label}`);
  }

  function _a11y_attachSection(section, tab) {
    if (!section) return;
    const label = section.dataset.label;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", tab ? tab.id : "");
    section.id = `scrollspy-panel-${label}`;
  }

  function _a11y_detach(el, attrs) {
    attrs.forEach((attr) => el.removeAttribute(attr));
  }

  function _a11y_teardown() {
    _tabBar.removeAttribute("role");
    _tabBar.removeAttribute("aria-label");
    const tabAttrs = ["role", "aria-selected", "tabindex", "aria-controls", "id"];
    const sectionAttrs = ["role", "aria-labelledby", "id"];

    _tabs.forEach((tab) => _a11y_detach(tab, tabAttrs));
    _sections.forEach((section) => _a11y_detach(section, sectionAttrs));

    if (_liveRegion && _liveRegion.parentNode) {
      _liveRegion.parentNode.removeChild(_liveRegion);
      _liveRegion = null;
    }
    window.matchMedia("(prefers-reduced-motion: reduce)").removeEventListener("change", _onReducedMotionChange);
  }

  function _bindEvents() {
    _tabs.forEach((tab) => _bindTabClick(tab));

    _onScrollHandler = _onScroll;
    window.addEventListener("scroll", _onScrollHandler, { passive: true });
    _onResizeHandler = _debounce(_onResize, 200);
    window.addEventListener("resize", _onResizeHandler, { passive: true });

    if (_header && window.ResizeObserver) {
      _headerObserver = new ResizeObserver(_measureAll);
      _headerObserver.observe(_header);
    }
  }

  function _bindTabClick(tab) {
    tab._scrollSpyClickHandler = () => _onTabClick(tab);
    tab.addEventListener("click", tab._scrollSpyClickHandler);
  }

  function _unbindTabClick(tab) {
    if (tab._scrollSpyClickHandler) {
      tab.removeEventListener("click", tab._scrollSpyClickHandler);
      delete tab._scrollSpyClickHandler;
    }
  }

  function _onTabClick(tab) {
    const section = _getSectionByLabel(tab.dataset.label);
    if (!section) return;
    _activateTab(tab);
    _scrollToSection(section);
  }

  function _startScroll() {
    _updateFixed();
    _updateActiveByScroll();
  }

  function _onScroll() {
    if (_scrollRafId) return;
    _scrollRafId = requestAnimationFrame(() => {
      _updateFixed();
      if (!_isProgrammaticScroll) _updateActiveByScroll();
      _scrollRafId = null;
    });
  }

  function _updateActiveByScroll() {
    const scrollY = window.scrollY;
    const threshold = scrollY + _headerHeight + _tabBarHeight + opt.scrollOffset;
    let active = null;

    for (let i = 0; i < _sectionBounds.length; i++) {
      const bound = _sectionBounds[i];
      if (bound.top <= threshold) {
        active = bound;
      } else {
        break;
      }
    }

    if (active && active.bottom < threshold) {
      active = null;
    }

    if (!active) {
      if (_currentActiveTab) {
        _currentActiveTab.classList.remove(opt.activeClass);
        _a11y_updateSelected(null);
        _currentActiveTab = null;
      }
    } else {
      const tab = _getTabByLabel(active.label);
      if (tab && tab !== _currentActiveTab) {
        _activateTab(tab);
      }
    }
  }

  function _updateFixed() {
    if (_originalTop === null) return;

    const scrollY = window.scrollY;
    const fixThreshold = _originalTop - _headerHeight;
    const shouldFix = scrollY >= fixThreshold;

    // ⭐ [수정된 부분] 상단 이탈 체크 로직 제거, 하단 이탈만 체크
    if (opt.hideTabBarOutsideContainer && _container) {
      // 컨테이너 최하단을 완전히 벗어났을 때만 감지
      const boundaryBottom = _containerBottom - _headerHeight - _tabBarHeight;

      if (shouldFix && scrollY > boundaryBottom) {
        _tabBar.classList.add(opt.hiddenClass);
      } else {
        _tabBar.classList.remove(opt.hiddenClass);
      }
    }

    const isFixed = _tabBar.classList.contains(opt.fixedClass);
    if (shouldFix === isFixed) return;

    if (shouldFix) {
      _tabBar.classList.add(opt.fixedClass);
      _tabBar.style.top = `${_headerHeight}px`;
    } else {
      _tabBar.classList.remove(opt.fixedClass);
      _tabBar.style.top = "";
    }
  }

  function _activateTab(tab) {
    if (tab === _currentActiveTab) return;
    _currentActiveTab = tab;

    _tabs.forEach((t) => t.classList.toggle(opt.activeClass, t === tab));
    _a11y_updateSelected(tab);
    _a11y_announce(tab);
    _scrollTabIntoView(tab);

    if (typeof opt.onTabChange === "function") {
      opt.onTabChange(tab.dataset.label);
    }
  }

  function _scrollToSection(section) {
    const top = section.getBoundingClientRect().top + window.scrollY - _headerHeight - _tabBarHeight - opt.scrollOffset;

    _isProgrammaticScroll = true;
    clearTimeout(_scrollEndTimer);
    window.scrollTo({ top: top, behavior: _reducedMotion ? "auto" : "smooth" });

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

  function _measureAll() {
    _measureHeader();
    _measureTabBar();
    _measureContainer();
    _measureSections();
  }

  function _measureContainer() {
    if (!_container) return;
    const rect = _container.getBoundingClientRect();
    _containerTop = rect.top + window.scrollY;
    _containerBottom = rect.bottom + window.scrollY;
  }

  function _measureHeader() {
    if (typeof opt.headerHeight === "number") {
      _headerHeight = opt.headerHeight;
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

  function _measureSections() {
    _sectionBounds = _sections.map((section) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      return {
        section,
        label: section.dataset.label,
        top: top,
        bottom: top + section.offsetHeight,
      };
    });
  }

  function _onResize() {
    _measureAll();
  }
  function _scrollTabIntoView(tab) {
    if (!tab) return;
    tab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: _reducedMotion ? "auto" : "smooth" });
  }

  function addTab(tabEl, sectionEl) {
    if (!_isMounted) return;
    if (!tabEl.dataset.label) tabEl.dataset.label = `section-${_tabs.length}`;
    if (sectionEl && !sectionEl.dataset.label) sectionEl.dataset.label = tabEl.dataset.label;

    _bindTabClick(tabEl);
    _a11y_attachTab(tabEl);
    if (sectionEl) _a11y_attachSection(sectionEl, tabEl);

    _tabs.push(tabEl);
    if (sectionEl) _sections.push(sectionEl);

    _measureAll();
  }

  function removeTab(label) {
    if (!_isMounted) return;
    const tab = _getTabByLabel(label);
    const sec = _getSectionByLabel(label);

    if (tab) {
      const tabAttrs = ["role", "aria-selected", "tabindex", "aria-controls", "id"];
      _a11y_detach(tab, tabAttrs);
      _unbindTabClick(tab);
      _tabs.splice(_tabs.indexOf(tab), 1);
      if (tab.parentNode) tab.parentNode.removeChild(tab);
      if (tab === _currentActiveTab) _currentActiveTab = null;
    }
    if (sec) {
      const sectionAttrs = ["role", "aria-labelledby", "id"];
      _a11y_detach(sec, sectionAttrs);
      _sections.splice(_sections.indexOf(sec), 1);
      if (sec.parentNode) sec.parentNode.removeChild(sec);
    }

    _measureAll();
  }

  function destroy() {
    if (!_isMounted) return;
    window.removeEventListener("scroll", _onScrollHandler);
    window.removeEventListener("resize", _onResizeHandler);
    if (_headerObserver) _headerObserver.disconnect();

    clearTimeout(_scrollEndTimer);
    if (_scrollRafId) cancelAnimationFrame(_scrollRafId);

    _tabs.forEach((tab) => _unbindTabClick(tab));
    _a11y_teardown();

    _tabBar.classList.remove(opt.fixedClass);
    _tabBar.classList.remove(opt.hiddenClass);

    _isMounted = false;
    _tabs = [];
    _sections = [];
    _sectionBounds = [];
    _header = null;
    _tabBar = null;
    _container = null;
    _originalTop = null;
    _currentActiveTab = null;
  }

  function _getTabByLabel(label) {
    return _tabs.find((tab) => tab.dataset.label === label) || null;
  }

  function _getSectionByLabel(label) {
    return _sections.find((section) => section.dataset.label === label) || null;
  }

  function _debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  const api = { init, addTab, removeTab, destroy };
  return api;
}
