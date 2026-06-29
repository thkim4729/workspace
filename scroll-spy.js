/**
 * ScrollSpy (Refactored & Decoupled)
 * * 아키텍처 개선 사항:
 * 1. Config, DOM, State 분리: 변수들의 역할과 책임 공간을 명확히 나눔.
 * 2. A11y 모듈화: 웹 접근성 로직을 A11y 객체 내부에 격리하여 메인 로직과의 결합도(Coupling)를 낮춤.
 * 3. 옵션 객체 구조화: 옵션을 목적에 맞게 그룹화하여 유지보수성 향상.
 */

function createScrollSpy(options = {}) {
  /* ═══════════════════════════════════════════
     1. 설정 객체 (Configuration)
  ═══════════════════════════════════════════ */
  const config = {
    selectors: {
      header: options.headerSelector || null,
      tabBar: options.tabBarSelector || '[data-role="tabbar"]',
      tab: options.tabSelector || '[data-role="tab"]',
      section: options.sectionSelector || '[data-role="section"]',
      container: options.containerSelector || null,
    },
    classes: {
      active: options.activeClass || "is-active",
      fixed: options.fixedClass || "is-fixed",
      hidden: options.hiddenClass || "is-hidden",
    },
    layout: {
      headerHeight: options.headerHeight !== undefined ? options.headerHeight : null,
      scrollOffset: options.scrollOffset || 0,
    },
    behavior: {
      hideOutside: options.hideTabBarOutsideContainer !== undefined ? options.hideTabBarOutsideContainer : false,
      throttleMs: options.throttleMs || 50,
    },
    a11y: {
      tabBarLabel: options.tabBarAriaLabel || "섹션 탐색",
    },
    callbacks: {
      onTabChange: options.onTabChange || null,
    },
  };

  /* ═══════════════════════════════════════════
     2. DOM 요소 & 상태 & 참조 관리 (State Management)
  ═══════════════════════════════════════════ */
  const dom = {
    header: null,
    tabBar: null,
    tabBarWrapper: null,
    container: null,
    tabs: [],
    sections: [],
    liveRegion: null,
  };

  const state = {
    isMounted: false,
    isProgrammaticScroll: false,
    currentActiveTab: null,
    headerHeight: 0,
    tabBarHeight: 0,
    originalTop: null,
    containerTop: 0,
    containerBottom: 0,
    sectionBounds: [],
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const refs = {
    scrollRafId: null,
    scrollEndTimer: null,
    headerObserver: null,
    onScroll: null,
    onResize: null,
    onMotionChange: null,
    tabClickHandlers: new Map(), // 메모리 누수 방지를 위한 탭별 이벤트 매핑
  };

  /* ═══════════════════════════════════════════
     3. 웹 접근성 (A11y) 독립 모듈
     - 메인 로직의 변수를 직접 참조하지 않고 매개변수로 받아 처리합니다.
  ═══════════════════════════════════════════ */
  const A11y = {
    setupTabBar(tabBar, label) {
      tabBar.setAttribute("role", "tablist");
      tabBar.setAttribute("aria-label", label);
    },

    attachTab(tab) {
      const label = tab.dataset.label;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.id = `scrollspy-tab-${label}`;
      tab.setAttribute("aria-controls", `scrollspy-panel-${label}`);
    },

    attachSection(section, tab) {
      if (!section) return;
      const label = section.dataset.label;
      section.setAttribute("role", "tabpanel");
      section.setAttribute("aria-labelledby", tab ? tab.id : "");
      section.id = `scrollspy-panel-${label}`;
    },

    updateSelected(tabs, activeTab) {
      tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab === activeTab)));
    },

    createLiveRegion() {
      const region = document.createElement("div");
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      Object.assign(region.style, {
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
      document.body.appendChild(region);
      return region;
    },

    announce(region, activeTab) {
      if (!region || !activeTab) return;
      const label = activeTab.textContent.trim();
      region.textContent = "";
      requestAnimationFrame(() => {
        region.textContent = `${label} 섹션으로 이동했습니다`;
      });
    },

    detach(element, attrs) {
      attrs.forEach((attr) => element.removeAttribute(attr));
    },
  };

  /* ═══════════════════════════════════════════
     4. Lifecycle 로직 (Init, Mount, Destroy)
  ═══════════════════════════════════════════ */
  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }
    return api;
  }

  function mount() {
    if (config.selectors.header && config.layout.headerHeight === null) {
      dom.header = document.querySelector(config.selectors.header);
    }

    dom.tabBar = document.querySelector(config.selectors.tabBar);
    dom.tabs = Array.from(document.querySelectorAll(config.selectors.tab));
    dom.sections = Array.from(document.querySelectorAll(config.selectors.section));

    if (!dom.tabBar || !dom.tabs.length || !dom.sections.length) {
      console.warn("[ScrollSpy] 필수 요소를 찾을 수 없습니다. HTML 마크업을 확인하세요.");
      return;
    }

    // 컨테이너가 지정되지 않았다면 첫 번째 섹션의 부모를 기본 컨테이너로 사용
    dom.container = config.selectors.container
      ? document.querySelector(config.selectors.container)
      : dom.sections[0]
        ? dom.sections[0].parentElement
        : null;

    // .tabbar-wrapper가 있으면 이를 고정 및 측정의 기준으로 삼습니다.
    // 이 wrapper는 플레이스홀더와 형제(sibling) 관계여야 레이아웃 점프를 막을 수 있습니다.
    if (dom.tabBar.parentElement && dom.tabBar.parentElement.classList.contains("tabbar-wrapper")) {
      dom.tabBarWrapper = dom.tabBar.parentElement;
    }

    _setupDataAndA11y();
    _bindEvents();

    measureAll();
    handleScroll(); // 초기 진입 시 고정 여부 및 활성 탭 판단

    state.isMounted = true;
  }

  function _setupDataAndA11y() {
    // 1. Data Label 주입
    dom.tabs.forEach((tab, i) => {
      if (!tab.dataset.label) tab.dataset.label = `section-${i}`;
      if (dom.sections[i] && !dom.sections[i].dataset.label) {
        dom.sections[i].dataset.label = tab.dataset.label;
      }
    });

    // 2. A11y 적용
    A11y.setupTabBar(dom.tabBar, config.a11y.tabBarLabel);

    // 탭이 li로 감싸져 있을 경우, ARIA 표준을 위해 li에 role="presentation"을 부여합니다.
    // 이렇게 하면 스크린 리더가 tablist > tab 구조를 올바르게 해석할 수 있습니다.
    if (dom.tabs.length > 0 && dom.tabs[0].parentElement.tagName === "LI") {
      dom.tabs.forEach((tab) => {
        const parentLi = tab.parentElement;
        if (parentLi.parentElement === dom.tabBar) {
          parentLi.setAttribute("role", "presentation");
        }
      });
    }

    dom.tabs.forEach((tab) => A11y.attachTab(tab));
    dom.sections.forEach((section) => {
      const tab = _getTabByLabel(section.dataset.label);
      A11y.attachSection(section, tab);
    });

    dom.liveRegion = A11y.createLiveRegion();
  }

  /* ═══════════════════════════════════════════
     5. 이벤트 관리 (Events & Handlers)
  ═══════════════════════════════════════════ */
  function _bindEvents() {
    // Tabs Click Event
    dom.tabs.forEach((tab) => {
      const handler = () => _onTabClick(tab);
      refs.tabClickHandlers.set(tab, handler);
      tab.addEventListener("click", handler);
    });

    // Scroll & Resize
    refs.onScroll = () => {
      if (refs.scrollRafId) return;
      refs.scrollRafId = requestAnimationFrame(() => {
        handleScroll();
        refs.scrollRafId = null;
      });
    };
    window.addEventListener("scroll", refs.onScroll, { passive: true });

    refs.onResize = _debounce(measureAll, 200);
    window.addEventListener("resize", refs.onResize, { passive: true });

    // Reduced Motion Match
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    refs.onMotionChange = (e) => {
      state.reducedMotion = e.matches;
    };
    mediaQuery.addEventListener("change", refs.onMotionChange);

    // ResizeObserver (Header 동적 변경 감지)
    if (dom.header && window.ResizeObserver) {
      refs.headerObserver = new ResizeObserver(measureAll);
      refs.headerObserver.observe(dom.header);
    }
  }

  function _onTabClick(tab) {
    const section = _getSectionByLabel(tab.dataset.label);
    if (!section) return;
    _activateTab(tab);
    _scrollToSection(section);
  }

  /* ═══════════════════════════════════════════
     6. 스크롤 및 렌더링 제어 (Core Logic)
  ═══════════════════════════════════════════ */
  function handleScroll() {
    _updateFixedState();
    if (!state.isProgrammaticScroll) {
      _updateActiveSection();
    }
  }

  function _updateFixedState() {
    if (state.originalTop === null) return;

    const scrollY = window.scrollY;
    const fixThreshold = state.originalTop - state.headerHeight;
    const shouldFix = scrollY >= fixThreshold;

    const elementToManage = dom.tabBarWrapper || dom.tabBar;

    // 컨테이너 이탈 시 숨김 로직 (위쪽 이탈 검사는 제외)
    if (config.behavior.hideOutside && dom.container) {
      const boundaryBottom = state.containerBottom - state.headerHeight - state.tabBarHeight;
      if (shouldFix && scrollY > boundaryBottom) {
        elementToManage.classList.add(config.classes.hidden);
      } else {
        elementToManage.classList.remove(config.classes.hidden);
      }
    }

    const isFixed = elementToManage.classList.contains(config.classes.fixed);
    if (shouldFix === isFixed) return;

    if (shouldFix) {
      elementToManage.classList.add(config.classes.fixed);
      elementToManage.style.top = `${state.headerHeight}px`;
    } else {
      elementToManage.classList.remove(config.classes.fixed);
      elementToManage.style.top = "";
    }
  }

  function _updateActiveSection() {
    const scrollY = window.scrollY;
    const threshold = scrollY + state.headerHeight + state.tabBarHeight + config.layout.scrollOffset;
    let activeBound = null;

    // 캐싱된 Bounds를 기반으로 활성 섹션 탐색 (순차 탐색)
    for (let i = 0; i < state.sectionBounds.length; i++) {
      const bound = state.sectionBounds[i];
      if (bound.top <= threshold) {
        activeBound = bound;
      } else {
        break;
      }
    }

    if (activeBound && activeBound.bottom < threshold) {
      activeBound = null;
    }

    const newActiveTab = activeBound ? _getTabByLabel(activeBound.label) : null;

    if (newActiveTab !== state.currentActiveTab) {
      _activateTab(newActiveTab);
    }
  }

  function _activateTab(tab) {
    if (tab === state.currentActiveTab) return;
    state.currentActiveTab = tab;

    // 모든 탭의 부모 li의 active 클래스를 일괄적으로 관리합니다.
    dom.tabs.forEach((t) => {
      const isActive = t === tab;
      const parentLi = t.parentElement;
      // button을 감싸는 li가 tabbar의 직계 자식일 경우에만 active 클래스를 토글합니다.
      if (parentLi && parentLi.tagName === "LI" && parentLi.parentElement === dom.tabBar) {
        parentLi.classList.toggle(config.classes.active, isActive);
      }
    });

    A11y.updateSelected(dom.tabs, tab);
    A11y.announce(dom.liveRegion, tab);

    if (tab) {
      // 탭(버튼)을 감싸는 li 요소가 있을 경우, li를 스크롤 대상으로 하여 아이템 전체가 보이도록 처리
      const scrollTarget = tab.parentElement && tab.parentElement.tagName === "LI" ? tab.parentElement : tab;
      scrollTarget.scrollIntoView({
        inline: "nearest",
        block: "nearest",
        behavior: state.reducedMotion ? "auto" : "smooth",
      });
    }

    if (typeof config.callbacks.onTabChange === "function") {
      // tab이 null일 경우를 대비하여 label을 안전하게 전달합니다.
      config.callbacks.onTabChange(tab ? tab.dataset.label : null);
    }
  }

  function _scrollToSection(section) {
    const top =
      section.getBoundingClientRect().top +
      window.scrollY -
      state.headerHeight -
      state.tabBarHeight -
      config.layout.scrollOffset;

    state.isProgrammaticScroll = true;
    clearTimeout(refs.scrollEndTimer);
    window.scrollTo({ top: top, behavior: state.reducedMotion ? "auto" : "smooth" });

    // 스크롤 종료 감지
    let lastY = window.scrollY;
    function waitScrollEnd() {
      refs.scrollEndTimer = setTimeout(() => {
        if (Math.abs(window.scrollY - lastY) < 2) {
          state.isProgrammaticScroll = false;
        } else {
          lastY = window.scrollY;
          waitScrollEnd();
        }
      }, 100);
    }
    waitScrollEnd();
  }

  /* ═══════════════════════════════════════════
     7. 치수 측정 (Measurements)
  ═══════════════════════════════════════════ */
  function measureAll() {
    _measureHeader();
    _measureTabBar();
    _measureContainer();
    _measureSections();
  }

  function _measureHeader() {
    if (typeof config.layout.headerHeight === "number") {
      state.headerHeight = config.layout.headerHeight;
    } else if (dom.header) {
      state.headerHeight = dom.header.offsetHeight;
    } else {
      state.headerHeight = 0;
    }
  }

  function _measureTabBar() {
    const elementToMeasure = dom.tabBarWrapper || dom.tabBar;
    const wasFixed = elementToMeasure.classList.contains(config.classes.fixed);
    if (wasFixed) elementToMeasure.classList.remove(config.classes.fixed);

    // 높이는 실제 탭 목록(ul)을 기준으로, 위치는 wrapper를 기준으로 측정
    state.tabBarHeight = dom.tabBar.offsetHeight;
    state.originalTop = Math.round(elementToMeasure.getBoundingClientRect().top + window.scrollY);

    if (wasFixed) elementToMeasure.classList.add(config.classes.fixed);
    document.documentElement.style.setProperty("--tabbar-height", `${state.tabBarHeight}px`);
  }

  function _measureContainer() {
    if (!dom.container) return;
    const rect = dom.container.getBoundingClientRect();
    state.containerTop = rect.top + window.scrollY;
    state.containerBottom = rect.bottom + window.scrollY;
  }

  function _measureSections() {
    state.sectionBounds = dom.sections.map((section) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      return {
        section,
        label: section.dataset.label,
        top: top,
        bottom: top + section.offsetHeight,
      };
    });
  }

  /* ═══════════════════════════════════════════
     8. Public API 메소드 및 유틸리티
  ═══════════════════════════════════════════ */
  function addTab(tabEl, sectionEl) {
    if (!state.isMounted) return;

    if (!tabEl.dataset.label) tabEl.dataset.label = `section-${dom.tabs.length}`;
    if (sectionEl && !sectionEl.dataset.label) sectionEl.dataset.label = tabEl.dataset.label;

    const handler = () => _onTabClick(tabEl);
    refs.tabClickHandlers.set(tabEl, handler);
    tabEl.addEventListener("click", handler);

    A11y.attachTab(tabEl);
    const parentLi = tabEl.parentElement;
    if (parentLi && parentLi.tagName === "LI" && parentLi.parentElement === dom.tabBar) {
      parentLi.setAttribute("role", "presentation");
    }

    if (sectionEl) A11y.attachSection(sectionEl, tabEl);

    dom.tabs.push(tabEl);
    if (sectionEl) dom.sections.push(sectionEl);

    measureAll();
  }

  function removeTab(label) {
    if (!state.isMounted) return;
    const tab = _getTabByLabel(label);
    const sec = _getSectionByLabel(label);

    if (tab) {
      const parentLi = tab.parentElement;
      const isLiWrapped = parentLi && parentLi.tagName === "LI" && parentLi.parentElement === dom.tabBar;

      A11y.detach(tab, ["role", "aria-selected", "tabindex", "aria-controls", "id"]);
      if (isLiWrapped) {
        A11y.detach(parentLi, ["role"]);
      }

      const handler = refs.tabClickHandlers.get(tab);
      if (handler) {
        tab.removeEventListener("click", handler);
        refs.tabClickHandlers.delete(tab);
      }
      dom.tabs = dom.tabs.filter((t) => t !== tab);
      const elementToRemove = isLiWrapped ? parentLi : tab;
      if (elementToRemove.parentNode) elementToRemove.parentNode.removeChild(elementToRemove);
      if (tab === state.currentActiveTab) state.currentActiveTab = null;
    }

    if (sec) {
      A11y.detach(sec, ["role", "aria-labelledby", "id"]);
      dom.sections = dom.sections.filter((s) => s !== sec);
      if (sec.parentNode) sec.parentNode.removeChild(sec);
    }

    measureAll();
  }

  function destroy() {
    if (!state.isMounted) return;

    window.removeEventListener("scroll", refs.onScroll);
    window.removeEventListener("resize", refs.onResize);
    window.matchMedia("(prefers-reduced-motion: reduce)").removeEventListener("change", refs.onMotionChange);
    if (refs.headerObserver) refs.headerObserver.disconnect();

    clearTimeout(refs.scrollEndTimer);
    if (refs.scrollRafId) cancelAnimationFrame(refs.scrollRafId);

    // 이벤트 리스너 해제
    dom.tabs.forEach((tab) => {
      const handler = refs.tabClickHandlers.get(tab);
      if (handler) tab.removeEventListener("click", handler);
    });
    refs.tabClickHandlers.clear();

    // A11y & DOM 초기화
    A11y.detach(dom.tabBar, ["role", "aria-label"]);
    dom.tabs.forEach((tab) => {
      A11y.detach(tab, ["role", "aria-selected", "tabindex", "aria-controls", "id"]);
      const parentLi = tab.parentElement;
      if (parentLi && parentLi.tagName === "LI" && parentLi.parentElement === dom.tabBar) {
        A11y.detach(parentLi, ["role"]);
      }
    });
    dom.sections.forEach((sec) => A11y.detach(sec, ["role", "aria-labelledby", "id"]));

    if (dom.liveRegion && dom.liveRegion.parentNode) {
      dom.liveRegion.parentNode.removeChild(dom.liveRegion);
    }

    const elementToManage = dom.tabBarWrapper || dom.tabBar;
    elementToManage.classList.remove(config.classes.fixed);
    elementToManage.classList.remove(config.classes.hidden);

    // 상태 초기화
    state.isMounted = false;
    dom.tabs = [];
    dom.sections = [];
    state.sectionBounds = [];
  }

  // --- Utility Functions ---
  function _getTabByLabel(label) {
    return dom.tabs.find((tab) => tab.dataset.label === label) || null;
  }

  function _getSectionByLabel(label) {
    return dom.sections.find((section) => section.dataset.label === label) || null;
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
