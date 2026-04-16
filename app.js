function initOutlineSpy() {
  const outlineLinks = [...document.querySelectorAll(".outline-link[href^='#']")];
  if (!outlineLinks.length) return;

  const sectionMap = new Map();
  outlineLinks.forEach((link) => {
    const hash = link.getAttribute("href");
    if (!hash) return;

    const target = document.querySelector(hash);
    if (!target) return;
    sectionMap.set(target, link);
  });

  if (!sectionMap.size) return;

  const setActiveLink = (id) => {
    outlineLinks.forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (!visibleEntries.length) return;
      setActiveLink(visibleEntries[0].target.id);
    },
    {
      rootMargin: "-18% 0px -55% 0px",
      threshold: [0.2, 0.45, 0.7]
    }
  );

  for (const section of sectionMap.keys()) {
    observer.observe(section);
  }

  const initialHash = window.location.hash?.slice(1);
  if (initialHash) {
    setActiveLink(initialHash);
  } else {
    const firstSection = [...sectionMap.keys()][0];
    if (firstSection?.id) setActiveLink(firstSection.id);
  }
}

function initStepSwitchers() {
  const switchers = document.querySelectorAll("[data-step-switcher]");
  if (!switchers.length) return;

  switchers.forEach((switcher) => {
    const buttons = [...switcher.querySelectorAll("[data-step-target]")];
    const cards = buttons
      .map((button) => document.getElementById(button.dataset.stepTarget))
      .filter(Boolean);

    if (!buttons.length || !cards.length) return;

    const activateStep = (targetId, { scroll = false } = {}) => {
      buttons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.stepTarget === targetId);
      });

      cards.forEach((card) => {
        card.classList.toggle("is-active", card.id === targetId);
      });

      const targetCard = document.getElementById(targetId);
      if (scroll && targetCard) {
        targetCard.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        activateStep(button.dataset.stepTarget, { scroll: true });
      });
    });

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visibleEntry?.target?.id) return;
        activateStep(visibleEntry.target.id);
      },
      {
        rootMargin: "-10% 0px -48% 0px",
        threshold: [0.35, 0.6]
      }
    );

    cards.forEach((card) => observer.observe(card));
    activateStep(buttons[0].dataset.stepTarget);
  });
}

function initRiskMemory() {
  const riskItems = [...document.querySelectorAll(".risk-item")];
  if (!riskItems.length || !window.localStorage) return;

  riskItems.forEach((item, index) => {
    const storageKey = `risk-state:${window.location.pathname}:${index}`;
    const savedState = window.localStorage.getItem(storageKey);

    if (savedState === "open") {
      item.open = true;
    }

    if (savedState === "closed") {
      item.open = false;
    }

    item.addEventListener("toggle", () => {
      window.localStorage.setItem(storageKey, item.open ? "open" : "closed");
    });
  });
}

function initContentTabs() {
  const tabGroups = document.querySelectorAll("[data-content-tabs]");
  if (!tabGroups.length) return;

  tabGroups.forEach((group) => {
    const buttons = [...group.querySelectorAll("[data-tab-target]")];
    const panels = buttons
      .map((button) => document.getElementById(button.dataset.tabTarget))
      .filter(Boolean);

    if (!buttons.length || !panels.length) return;

    const activateTab = (targetId) => {
      buttons.forEach((button) => {
        const isActive = button.dataset.tabTarget === targetId;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === targetId);
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
    });

    activateTab(buttons[0].dataset.tabTarget);
  });
}

function initTreeTabs() {
  const treeGroups = document.querySelectorAll("[data-tree-tabs]");
  if (!treeGroups.length) return;

  treeGroups.forEach((group) => {
    const buttons = [...group.querySelectorAll("[data-tree-target]")];
    const panels = buttons
      .map((button) => document.getElementById(button.dataset.treeTarget))
      .filter(Boolean);

    if (!buttons.length || !panels.length) return;

    const activatePanel = (targetId) => {
      buttons.forEach((button) => {
        const isActive = button.dataset.treeTarget === targetId;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === targetId);
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => activatePanel(button.dataset.treeTarget));
    });

    activatePanel(buttons[0].dataset.treeTarget);
  });
}

function initSidebarTreeControls() {
  const toggles = document.querySelectorAll("[data-side-toggle]");
  toggles.forEach((toggle) => {
    const panel = toggle.parentElement?.querySelector("[data-side-panel]");
    if (!panel) return;

    toggle.addEventListener("click", () => {
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", isExpanded ? "false" : "true");
      panel.classList.toggle("is-expanded", !isExpanded);
    });
  });

  const subToggles = document.querySelectorAll("[data-sub-toggle]");
  subToggles.forEach((toggle, index) => {
    const panel = toggle.parentElement?.querySelector("[data-sub-panel]");
    if (!panel) return;

    toggle.addEventListener("click", () => {
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", isExpanded ? "false" : "true");
      panel.classList.toggle("is-expanded", !isExpanded);
      toggle.classList.toggle("is-active", !isExpanded);
    });

    if (index === 0) {
      toggle.classList.add("is-active");
    }
  });

  const treeButtons = [
    ...document.querySelectorAll(".side-sub-link[data-tree-target], .side-third-link[data-tree-target]")
  ];
  const treePanels = treeButtons
    .map((button) => document.getElementById(button.dataset.treeTarget))
    .filter(Boolean);

  if (!treeButtons.length || !treePanels.length) return;

  const activatePanel = (targetId) => {
    treeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.treeTarget === targetId);
    });

    document.querySelectorAll(".side-sub-link-toggle").forEach((toggle) => {
      const panel = toggle.parentElement?.querySelector("[data-sub-panel]");
      if (!panel) return;
      const hasActiveChild = [...panel.querySelectorAll(".side-third-link")].some((button) => button.dataset.treeTarget === targetId);
      toggle.classList.toggle("is-active", hasActiveChild);
      toggle.setAttribute("aria-expanded", hasActiveChild ? "true" : toggle.getAttribute("aria-expanded") || "false");
      panel.classList.toggle("is-expanded", hasActiveChild);
    });

    treePanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === targetId);
    });
  };

  treeButtons.forEach((button) => {
    button.addEventListener("click", () => activatePanel(button.dataset.treeTarget));
  });

  activatePanel(treeButtons[0].dataset.treeTarget);
}

initOutlineSpy();
initStepSwitchers();
initRiskMemory();
initContentTabs();
initTreeTabs();
initSidebarTreeControls();
