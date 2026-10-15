// ==UserScript==
// @name           Top Bar Tweaks
// @description    Keeps Zen's hidden top bar open when the window isn't touching the top of the screen, can roll down just the window buttons, and lets you set how fast and from how far away it pops up.
// @include        main
// ==/UserScript==

(() => {
  // This mod's id in Sine (from theme.json).
  const SINE_MOD_ID = "zen-top-bar-tweaks";
  // The settings page sits in a "top-bar-tweaks" folder next to this script,
  // wherever the mod manager (Sine, fx-autoconfig, ...) installed it.
  const SCRIPT_URL = Components.stack.filename.split(" -> ").pop().replace(/[?#].*$/, "");
  const SETTINGS_URL = new URL("top-bar-tweaks/settings.html", SCRIPT_URL).href;

  const PREF_BRANCH = "zen.topbartweaks.";
  const PREF_PIN = "zen.topbartweaks.show-when-not-at-top";
  const PREF_DELAY = "zen.topbartweaks.show-delay"; // ms, "default" = Zen's own
  const PREF_RANGE = "zen.topbartweaks.trigger-range"; // px from the top, "default" = Zen's own
  const PREF_ANIMATION = "zen.topbartweaks.animation"; // seconds, "default" = Zen's own
  const PREF_STYLE = "zen.topbartweaks.style"; // "bar" = whole bar, "buttons" = just the window buttons

  // How far (CSS px) below the top of the screen the window may sit and
  // still count as "touching the top". Covers rounding on scaled displays.
  const TOP_TOLERANCE = 2;
  // How often to check whether the window was moved (there's no move event).
  const POSITION_CHECK_MS = 250;
  // Zen waits this long before its bar slides in. "Just the buttons" does
  // its own sliding, so it copies this wait when no custom delay is set.
  const ZEN_SHOW_DELAY = 200;
  // The buttons stay this long after the mouse leaves, like Zen's bar.
  const HIDE_DELAY = 0.2;

  const BAR_ID = "zen-appcontent-navbar-wrapper";
  const HOVER = "zen-has-hover";
  const SHOWN = `#${BAR_ID}:is([${HOVER}], [has-popup-menu], [zen-compact-mode-active])`;
  const DURATION = "var(--zen-hidden-toolbar-transition-duration, 0.15s)";

  const CSS = `
    /* Pinned open: push the page down instead of drawing the bar over it. */
    :root[ttt-pinned] #tabbrowser-tabpanels[has-toolbar-hovered] .browserContainer {
      margin-top: 0 !important;
    }
    /* With a custom delay, our timer is the delay: drop Zen's extra 0.2s. */
    :root[ttt-custom-delay] ${SHOWN},
    :root[ttt-custom-delay] #tabbrowser-tabpanels[has-toolbar-hovered] .browserContainer {
      transition-delay: 0s !important;
    }

    /* ----- "Just the window buttons" -----
       The bar stays a thin strip. Only the minimize / maximize / close group
       slides down, and the page gets a matching rounded notch cut out of its
       top-right corner, so the real window background shows around them. */
    :root[ttt-buttons-only] #${BAR_ID} {
      height: var(--zen-element-separation) !important;
      overflow: visible !important;
      /* The buttons slide instead of the whole bar fading. */
      opacity: 1 !important;
    }
    :root[ttt-buttons-only] #tabbrowser-tabpanels[has-toolbar-hovered] .browserContainer {
      margin-top: 0 !important;
    }
    /* The empty rest of the bar mustn't catch the mouse over the page. */
    :root[ttt-buttons-only] #zen-appcontent-navbar-container {
      pointer-events: none !important;
    }
    :root[ttt-buttons-only] #${BAR_ID} .titlebar-buttonbox-container {
      pointer-events: auto !important;
      border-end-start-radius: var(--ttt-radius, 8px);
      overflow: clip;
      transform: translateY(-100%);
      transition:
        transform ${DURATION} ease-in-out ${HIDE_DELAY}s,
        max-height 0s linear calc(${DURATION} + ${HIDE_DELAY}s) !important;
    }
    :root[ttt-buttons-only] ${SHOWN} .titlebar-buttonbox-container {
      transform: none;
      transition: transform ${DURATION} ease-in-out !important;
    }
    /* mask-image and mask-size are set on the element itself (updateNotch):
       an SVG url() passed in through a variable doesn't take effect here. */
    .browserContainer[ttt-notch] {
      mask-repeat: no-repeat;
      mask-position: left top, left bottom, right 0 top calc(-1 * var(--ttt-notch-h));
      animation: ttt-notch-close ${DURATION} ease-in-out ${HIDE_DELAY}s both;
    }
    .browserContainer[ttt-notch][ttt-notch-open] {
      mask-position: left top, left bottom, right 0 top 0;
      animation: ttt-notch-open ${DURATION} ease-in-out both;
    }
    @keyframes ttt-notch-open {
      from { mask-position: left top, left bottom, right 0 top calc(-1 * var(--ttt-notch-h)); }
      to { mask-position: left top, left bottom, right 0 top 0; }
    }
    @keyframes ttt-notch-close {
      from { mask-position: left top, left bottom, right 0 top 0; }
      to { mask-position: left top, left bottom, right 0 top calc(-1 * var(--ttt-notch-h)); }
    }
  `;

  let bar, manager, originalSet;
  let config = {};
  let pinned = false;
  // Pointer height inside the window (CSS px from its top), null when outside.
  let pointerY = null;
  let pendingShow = 0;

  function readPref(name, fallback) {
    try {
      switch (Services.prefs.getPrefType(name)) {
        case Services.prefs.PREF_STRING:
          return Services.prefs.getStringPref(name);
        case Services.prefs.PREF_INT:
          return String(Services.prefs.getIntPref(name));
        case Services.prefs.PREF_BOOL:
          return Services.prefs.getBoolPref(name);
      }
    } catch {}
    return fallback;
  }

  // "default", "" or junk mean "leave it to Zen".
  function readNumber(name) {
    const value = String(readPref(name, "default")).trim();
    if (value === "" || value === "default" || isNaN(Number(value))) {
      return null;
    }
    return Math.max(0, Number(value));
  }

  function loadConfig() {
    config = {
      pin: readPref(PREF_PIN, true) !== false,
      delay: readNumber(PREF_DELAY),
      range: readNumber(PREF_RANGE),
      animation: readNumber(PREF_ANIMATION),
      buttonsOnly: readPref(PREF_STYLE, "bar") === "buttons",
    };
    const root = document.documentElement;
    if (config.animation === null) {
      root.style.removeProperty("--zen-hidden-toolbar-transition-duration");
    } else {
      root.style.setProperty("--zen-hidden-toolbar-transition-duration", `${config.animation}s`, "important");
    }
    if (config.range === null && config.delay === null) {
      cancelPendingShow();
    }
    checkPosition();
    updateNotch();
  }

  /* ---------- Part 1: keep the bar open when the window isn't at the top ---------- */

  function touchesTopOfScreen() {
    // Maximized and fullscreen windows always sit at the top.
    if (window.windowState !== window.STATE_NORMAL) {
      return true;
    }
    return window.screenY - window.screen.availTop <= TOP_TOLERANCE;
  }

  function checkPosition() {
    const shouldPin =
      config.pin &&
      window.windowState !== window.STATE_MINIMIZED &&
      !document.documentElement.hasAttribute("inDOMFullscreen") &&
      !touchesTopOfScreen();
    setPinned(shouldPin);
    updateButtonsMode();
  }

  function setPinned(value) {
    if (value === pinned) {
      return;
    }
    pinned = value;
    document.documentElement.toggleAttribute("ttt-pinned", value);
    cancelPendingShow();
    if (value) {
      showNow();
    } else if (!bar.matches(":hover")) {
      originalSet.call(manager, bar, false);
    }
  }

  /* ---------- "Just the window buttons" ---------- */

  // Only for Zen's usual layout, where the bar holds nothing but the window
  // buttons. With bookmarks in it, or while pinned open, the whole bar shows.
  function buttonsOnlyActive() {
    const root = document.documentElement;
    return (
      config.buttonsOnly &&
      !pinned &&
      root.getAttribute("zen-single-toolbar") === "true" &&
      !root.hasAttribute("zen-has-bookmarks") &&
      bar.hasAttribute("should-hide")
    );
  }

  function updateButtonsMode() {
    const root = document.documentElement;
    const active = buttonsOnlyActive();
    if (active !== root.hasAttribute("ttt-buttons-only")) {
      root.toggleAttribute("ttt-buttons-only", active);
      updateNotch();
    }
    root.toggleAttribute("ttt-custom-delay", showDelay() !== null);
  }

  function barShown() {
    return [HOVER, "has-popup-menu", "zen-compact-mode-active"].some(a => bar.hasAttribute(a));
  }

  // The page under the buttons: the top-right one when pages are split.
  function topRightPage() {
    let best = null;
    let bestRect = null;
    for (const page of gBrowser.tabpanels.querySelectorAll(":scope > .browserSidebarContainer")) {
      const rect = page.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(page).visibility === "hidden") {
        continue;
      }
      if (!bestRect || rect.top < bestRect.top - 1 || (Math.abs(rect.top - bestRect.top) <= 1 && rect.right > bestRect.right)) {
        best = page;
        bestRect = rect;
      }
    }
    return best;
  }

  // A mask image for the page's top-right corner: the page with a notch for
  // the buttons, then (below it) plain page, so sliding the image down rolls
  // the notch open. Corners use the page's own rounding.
  function notchMask(width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const w = width + r;
    const h = height + r;
    const path =
      `M0 0 A${r} ${r} 0 0 1 ${r} ${r} V${height - r} A${r} ${r} 0 0 0 ${2 * r} ${height}` +
      ` H${w - r} A${r} ${r} 0 0 1 ${w} ${h} V${2 * h} H0 Z`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${2 * h}'><path d='${path}' fill='black'/></svg>`;
    return { w, h, r, url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` };
  }

  let notched = null; // the .browserContainer that has the notch
  let notchTimer = 0;

  function clearNotch() {
    clearTimeout(notchTimer);
    if (notched) {
      notched.removeAttribute("ttt-notch");
      notched.removeAttribute("ttt-notch-open");
      for (const property of ["mask-image", "mask-size", "--ttt-notch-h"]) {
        notched.style.removeProperty(property);
      }
    }
    notched = null;
  }

  function updateNotch() {
    if (!document.documentElement.hasAttribute("ttt-buttons-only")) {
      clearNotch();
      return;
    }
    if (!barShown()) {
      if (notched?.hasAttribute("ttt-notch-open")) {
        notched.removeAttribute("ttt-notch-open");
        // Take the mask off once it has rolled back up.
        const duration = parseFloat(getComputedStyle(notched).animationDuration) || 0.15;
        clearTimeout(notchTimer);
        notchTimer = setTimeout(clearNotch, (duration + HIDE_DELAY) * 1000 + 100);
      }
      return;
    }

    const container = topRightPage()?.querySelector(":scope > .browserContainer");
    if (!container) {
      return;
    }
    if (container !== notched) {
      clearNotch();
    }
    clearTimeout(notchTimer);
    const page = container.getBoundingClientRect();
    const buttons = bar.querySelector(".titlebar-buttonbox-container").getBoundingClientRect();
    const barTop = bar.getBoundingClientRect().top;
    const toolbarHeight = document.getElementById("zen-appcontent-navbar-container").getBoundingClientRect().height;
    const width = Math.round(page.right - buttons.left);
    const height = Math.round(barTop + toolbarHeight - page.top);
    if (width <= 0 || height <= 0) {
      return;
    }
    const radius = parseFloat(getComputedStyle(container.parentNode).borderTopRightRadius) || 8;
    const mask = notchMask(width, height, radius);
    container.style.setProperty("mask-image", `linear-gradient(#000, #000), linear-gradient(#000, #000), ${mask.url}`);
    container.style.setProperty(
      "mask-size",
      `calc(100% - ${mask.w}px) 100%, 100% calc(100% - ${mask.h}px), ${mask.w}px ${2 * mask.h}px`
    );
    container.style.setProperty("--ttt-notch-h", `${mask.h}px`);
    document.documentElement.style.setProperty("--ttt-radius", `${mask.r}px`);
    notched = container;
    container.setAttribute("ttt-notch", "");
    container.setAttribute("ttt-notch-open", "");
  }

  /* ---------- Part 2: delay and trigger range ---------- */

  function showDelay() {
    if (config.delay !== null) {
      return config.delay;
    }
    return document.documentElement.hasAttribute("ttt-buttons-only") ? ZEN_SHOW_DELAY : null;
  }

  function showNow() {
    originalSet.call(manager, bar, true);
    if (pinned) {
      // Zen marks the page to slide under the bar; while pinned we want the
      // page pushed down below it instead.
      gBrowser.tabpanels.removeAttribute("has-toolbar-hovered");
    }
  }

  function cancelPendingShow() {
    clearTimeout(pendingShow);
    pendingShow = 0;
  }

  function insideRange() {
    return config.range !== null && pointerY !== null && pointerY <= config.range;
  }

  // Zen opens and closes the bar through this one function, so wrapping it
  // lets us add a delay, ignore Zen's own trigger strip, and keep it pinned.
  function patchedSet(element, value, attr = HOVER) {
    if (element !== bar || attr !== HOVER) {
      return originalSet.apply(this, arguments);
    }

    if (!value) {
      // Pinned bars stay open, and so does a bar the pointer is still
      // inside the custom trigger range for.
      if (pinned || insideRange()) {
        return undefined;
      }
      cancelPendingShow();
      return originalSet.apply(this, arguments);
    }

    if (pinned || bar.hasAttribute(HOVER)) {
      return showNow();
    }
    // With a custom range, Zen's own thin strip only counts if it's inside
    // the range. (pointerY is null when the pointer left through the top.)
    if (config.range !== null && pointerY !== null && pointerY > config.range) {
      return undefined;
    }
    const delay = showDelay();
    if (!delay) {
      return showNow();
    }
    if (!pendingShow) {
      pendingShow = setTimeout(() => {
        pendingShow = 0;
        showNow();
      }, delay);
    }
    return undefined;
  }

  function onMouseMove(event) {
    pointerY = event.screenY - window.mozInnerScreenY;
    if (pinned || config.range === null) {
      return;
    }
    if (pointerY <= config.range) {
      if (!bar.hasAttribute(HOVER)) {
        manager._setElementExpandAttribute(bar, true);
      }
      return;
    }
    cancelPendingShow();
    // Moved down out of the range without going over the bar itself
    // (the range is taller than the bar): close it, like Zen would.
    if (bar.hasAttribute(HOVER) && !bar.matches(":hover") && pointerY > bar.getBoundingClientRect().bottom) {
      manager._setElementExpandAttribute(bar, false);
    }
  }

  function onMouseLeaveWindow() {
    pointerY = null;
    if (config.range !== null && !pinned) {
      cancelPendingShow();
    }
  }

  /* ---------- settings page ---------- */

  function openSettings() {
    const existing = gBrowser.tabs.find(t => t.linkedBrowser?.currentURI?.spec === SETTINGS_URL);
    gBrowser.selectedTab = existing ?? gBrowser.addTrustedTab(SETTINGS_URL);
  }

  // The settings button on this mod's card in Settings > Sine Mods opens the
  // full settings page instead of the basic options box.
  function hookModCard(browser) {
    let win;
    try {
      win = browser.contentWindow;
    } catch {
      return;
    }
    if (!win || win.__tttHooked || !/^about:(preferences|settings)/.test(String(win.location?.href))) {
      return;
    }
    win.__tttHooked = true;
    win.addEventListener(
      "click",
      e => {
        const button = e.target.closest?.(".sineItemConfigureButton");
        if (button?.closest(".sineItem")?.getAttribute("mod-id") === SINE_MOD_ID) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openSettings();
        }
      },
      true
    );
  }

  function setupSettingsHooks() {
    gBrowser.addTabsProgressListener({
      onStateChange(browser, webProgress, request, flags) {
        const { STATE_STOP, STATE_IS_DOCUMENT } = Ci.nsIWebProgressListener;
        if (webProgress?.isTopLevel && flags & STATE_STOP && flags & STATE_IS_DOCUMENT) {
          hookModCard(browser);
        }
      },
      onLocationChange(browser, webProgress) {
        if (webProgress?.isTopLevel) {
          hookModCard(browser);
        }
      },
    });
    // Settings may already be open (e.g. restored from the last session).
    gBrowser.browsers.forEach(hookModCard);

    // Right-clicking the top bar (or any toolbar) offers the settings too.
    const menu = document.getElementById("toolbar-context-menu");
    if (menu) {
      const item = document.createXULElement("menuitem");
      item.id = "ttt-open-settings";
      item.setAttribute("label", "Top Bar Tweaks settings…");
      item.addEventListener("command", openSettings);
      menu.append(item);
    }
  }

  function init() {
    manager = window.gZenCompactModeManager;
    bar = document.getElementById(BAR_ID);
    if (!manager || !bar || typeof manager._setElementExpandAttribute !== "function") {
      console.warn("[Top Bar Tweaks] Zen's top bar wasn't found; this mod only works in Zen.");
      return;
    }
    if (document.documentElement.hasAttribute("popup-window")) {
      return;
    }

    windowUtils.loadSheetUsingURIString(
      "data:text/css;charset=utf-8," + encodeURIComponent(CSS),
      windowUtils.AUTHOR_SHEET
    );

    originalSet = manager._setElementExpandAttribute;
    manager._setElementExpandAttribute = patchedSet;

    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    document.documentElement.addEventListener("mouseleave", onMouseLeaveWindow);
    window.addEventListener("resize", () => {
      checkPosition();
      updateNotch();
    });
    // Open or close the notch whenever the bar opens or closes.
    new MutationObserver(updateNotch).observe(bar, {
      attributes: true,
      attributeFilter: [HOVER, "has-popup-menu", "zen-compact-mode-active"],
    });
    gBrowser.tabContainer.addEventListener("TabSelect", () => requestAnimationFrame(updateNotch));
    window.addEventListener("sizemodechange", () => setTimeout(checkPosition, 50));
    const timer = setInterval(checkPosition, POSITION_CHECK_MS);

    const prefObserver = () => loadConfig();
    Services.prefs.addObserver(PREF_BRANCH, prefObserver);
    window.addEventListener(
      "unload",
      () => {
        clearInterval(timer);
        Services.prefs.removeObserver(PREF_BRANCH, prefObserver);
      },
      { once: true }
    );

    setupSettingsHooks();
    loadConfig();
  }

  function whenReady(fn) {
    if (gBrowserInit.delayedStartupFinished) {
      fn();
      return;
    }
    const obs = subject => {
      if (subject === window) {
        Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
        fn();
      }
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }

  whenReady(init);
})();
