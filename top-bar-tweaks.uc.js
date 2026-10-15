// ==UserScript==
// @name           Top Bar Tweaks
// @description    Keeps Zen's hidden top bar open when the window isn't touching the top of the screen, and lets you set how fast and from how far away it pops up.
// @include        main
// ==/UserScript==

(() => {
  const PREF_BRANCH = "zen.topbartweaks.";
  const PREF_PIN = "zen.topbartweaks.show-when-not-at-top";
  const PREF_DELAY = "zen.topbartweaks.show-delay"; // ms, "default" = Zen's own
  const PREF_RANGE = "zen.topbartweaks.trigger-range"; // px from the top, "default" = Zen's own
  const PREF_ANIMATION = "zen.topbartweaks.animation"; // seconds, "default" = Zen's own

  // How far (CSS px) below the top of the screen the window may sit and
  // still count as "touching the top". Covers rounding on scaled displays.
  const TOP_TOLERANCE = 2;
  // How often to check whether the window was moved (there's no move event).
  const POSITION_CHECK_MS = 250;

  const BAR_ID = "zen-appcontent-navbar-wrapper";
  const HOVER = "zen-has-hover";

  const CSS = `
    /* Pinned open: push the page down instead of drawing the bar over it. */
    :root[ttt-pinned] #tabbrowser-tabpanels[has-toolbar-hovered] .browserContainer {
      margin-top: 0 !important;
    }
    /* With a custom delay, our timer is the delay: drop Zen's extra 0.2s. */
    :root[ttt-custom-delay] #${BAR_ID}:is([${HOVER}], [has-popup-menu], [zen-compact-mode-active]),
    :root[ttt-custom-delay] #tabbrowser-tabpanels[has-toolbar-hovered] .browserContainer {
      transition-delay: 0s !important;
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
    };
    const root = document.documentElement;
    root.toggleAttribute("ttt-custom-delay", config.delay !== null);
    if (config.animation === null) {
      root.style.removeProperty("--zen-hidden-toolbar-transition-duration");
    } else {
      root.style.setProperty("--zen-hidden-toolbar-transition-duration", `${config.animation}s`, "important");
    }
    if (config.range === null && config.delay === null) {
      cancelPendingShow();
    }
    checkPosition();
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

  /* ---------- Part 2: delay and trigger range ---------- */

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
    if (!config.delay) {
      return showNow();
    }
    if (!pendingShow) {
      pendingShow = setTimeout(() => {
        pendingShow = 0;
        showNow();
      }, config.delay);
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
    window.addEventListener("resize", checkPosition);
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
