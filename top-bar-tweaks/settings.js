"use strict";

/* ---------- connection to Zen ---------- */

const PREF_BRANCH = "zen.topbartweaks.";
const PREFS = {
  pin: "zen.topbartweaks.show-when-not-at-top",
  style: "zen.topbartweaks.style",
  delay: "zen.topbartweaks.show-delay",
  animation: "zen.topbartweaks.animation",
  range: "zen.topbartweaks.trigger-range",
};
// Same as the defaults in top-bar-tweaks.uc.js and preferences.json.
const DEFAULTS = { pin: true, style: "bar", delay: "default", animation: "default", range: "default" };

// Zen's own behavior, used by the preview for "Zen default".
const ZEN_DELAY = 200; // ms its bar waits before sliding in
const ZEN_ANIMATION = 0.15; // s
const ZEN_RANGE = 8; // px, the height of its thin top strip
const HIDE_DELAY = 200; // ms the bar stays after the mouse leaves

const inZen = typeof Services !== "undefined";
const sample = new Map();

const prefs = inZen
  ? {
      get(key) {
        const name = PREFS[key];
        try {
          switch (Services.prefs.getPrefType(name)) {
            case Services.prefs.PREF_BOOL:
              return Services.prefs.getBoolPref(name);
            case Services.prefs.PREF_INT:
              return String(Services.prefs.getIntPref(name));
            case Services.prefs.PREF_STRING:
              return Services.prefs.getStringPref(name);
          }
        } catch {}
        return DEFAULTS[key];
      },
      set(key, value) {
        const name = PREFS[key];
        // The options box may have saved it as another type.
        const type = typeof value === "boolean" ? Services.prefs.PREF_BOOL : Services.prefs.PREF_STRING;
        if (Services.prefs.getPrefType(name) !== type && Services.prefs.prefHasUserValue(name)) {
          Services.prefs.clearUserPref(name);
        }
        if (typeof value === "boolean") {
          Services.prefs.setBoolPref(name, value);
        } else {
          Services.prefs.setStringPref(name, value);
        }
      },
      observe(fn) {
        const observer = { observe: () => fn() };
        Services.prefs.addObserver(PREF_BRANCH, observer);
        window.addEventListener("unload", () => Services.prefs.removeObserver(PREF_BRANCH, observer));
      },
    }
  : {
      get: key => (sample.has(key) ? sample.get(key) : DEFAULTS[key]),
      set: (key, value) => sample.set(key, value),
      observe() {},
    };

function read() {
  const state = {};
  for (const key of Object.keys(PREFS)) {
    state[key] = prefs.get(key);
  }
  state.pin = state.pin !== false && state.pin !== "false";
  return state;
}

const number = (value, fallback) => (value === "default" || value === "" || isNaN(Number(value)) ? fallback : Number(value));

/* ---------- the notch shape (same idea as the mod) ---------- */

// The page with a rounded notch in its top-right corner for the buttons,
// then plain page below it, so sliding the image down rolls the notch open.
function notchMask(width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const w = width + r;
  const h = height + r;
  const path =
    `M0 0 A${r} ${r} 0 0 1 ${r} ${r} V${height - r} A${r} ${r} 0 0 0 ${2 * r} ${height}` +
    ` H${w - r} A${r} ${r} 0 0 1 ${w} ${h} V${2 * h} H0 Z`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${2 * h}'><path d='${path}' fill='black'/></svg>`;
  return { w, h, url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` };
}

function applyNotch(element, width, height, radius, open) {
  const mask = notchMask(width, height, radius);
  element.style.maskImage = `linear-gradient(#000, #000), linear-gradient(#000, #000), ${mask.url}`;
  element.style.maskSize = `calc(100% - ${mask.w}px) 100%, 100% calc(100% - ${mask.h}px), ${mask.w}px ${2 * mask.h}px`;
  element.style.maskRepeat = "no-repeat";
  element.style.maskPosition = `left top, left bottom, right 0 top ${open ? 0 : -mask.h}px`;
  element.style.setProperty("--notch-h", `${mask.h}px`);
}

/* ---------- live demo ---------- */

const demo = document.getElementById("demo");
const demoPage = document.getElementById("demo-page");
const demoButtons = document.getElementById("demo-buttons");
const rangeBand = document.getElementById("demo-range");
const rangeLabel = document.getElementById("demo-range-label");

let state = read();
let open = false;
let showTimer = 0;
let hideTimer = 0;

function renderDemo() {
  const range = number(state.range, ZEN_RANGE);
  demo.dataset.style = state.style === "buttons" ? "buttons" : "bar";
  demo.style.setProperty("--dur", `${number(state.animation, ZEN_ANIMATION)}s`);
  demo.style.setProperty("--range", `${Math.max(range, 1)}px`);
  rangeLabel.textContent = state.range === "default" ? "Zen default: 8 px" : `${range} px`;
  rangeBand.classList.toggle("thin", range < 16);

  if (demo.dataset.style === "buttons") {
    const page = demoPage.getBoundingClientRect();
    const buttons = demoButtons.getBoundingClientRect();
    const demoTop = demo.getBoundingClientRect().top + demo.clientTop;
    const width = page.right - buttons.left;
    const height = demoTop + buttons.height - page.top;
    applyNotch(demoPage, width, height, parseFloat(getComputedStyle(demoPage).borderTopRightRadius), open);
    demoPage.style.maskPosition = "";
  } else {
    for (const p of ["maskImage", "maskSize", "maskPosition"]) {
      demoPage.style[p] = "";
    }
  }
}

function setOpen(value) {
  if (value === open) {
    return;
  }
  open = value;
  demo.classList.remove("fresh");
  demo.classList.toggle("open", value);
}

function delay() {
  return number(state.delay, ZEN_DELAY);
}

// Roughly how Zen behaves: the strip at the top (or the custom range) opens
// it after the delay, and it closes a moment after the mouse leaves it.
demo.addEventListener("mousemove", event => {
  const box = demo.getBoundingClientRect();
  const y = event.clientY - box.top - demo.clientTop;
  const range = number(state.range, ZEN_RANGE);
  const overBar = open && (state.style === "buttons" ? demoButtons.matches(":hover") || y <= 8 : y <= 34);
  if (y <= range || overBar) {
    clearTimeout(hideTimer);
    hideTimer = 0;
    if (!open && !showTimer) {
      showTimer = setTimeout(() => {
        showTimer = 0;
        setOpen(true);
      }, delay());
    }
    return;
  }
  clearTimeout(showTimer);
  showTimer = 0;
  if (open && !hideTimer) {
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      setOpen(false);
    }, 10);
  }
});
demo.addEventListener("mouseleave", () => {
  clearTimeout(showTimer);
  showTimer = 0;
  setOpen(false);
});

/* ---------- controls ---------- */

function renderControls() {
  for (const group of document.querySelectorAll(".chips, .choices")) {
    const value = String(state[{ "show-delay": "delay", "trigger-range": "range" }[group.id] ?? group.id]);
    let matched = false;
    for (const button of group.querySelectorAll("button")) {
      const on = button.dataset.value === value;
      button.classList.toggle("selected", on);
      button.setAttribute("aria-pressed", on);
      matched ||= on;
    }
    // A value typed into about:config that isn't one of the buttons.
    if (!matched && group.classList.contains("chips")) {
      let custom = group.querySelector(".custom");
      if (!custom) {
        custom = document.createElement("button");
        custom.type = "button";
        custom.className = "custom";
        group.append(custom);
      }
      custom.dataset.value = value;
      custom.textContent = `Custom: ${value}`;
      custom.classList.add("selected");
    } else {
      group.querySelector(".custom")?.remove();
    }
  }
  document.getElementById("pin").checked = state.pin;
  document.getElementById("floating-win").classList.toggle("open", state.pin);
  document.getElementById("floating-caption").textContent = state.pin ? "Floating: stays open" : "Floating: hides too";
}

function render() {
  state = read();
  renderControls();
  renderDemo();
}

let savedTimer = 0;
function save(key, value) {
  prefs.set(key, value);
  if (!inZen) {
    render();
  }
  const saved = document.getElementById("saved");
  saved.textContent = "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.textContent = ""), 1500);
}

const groupKey = { style: "style", "show-delay": "delay", animation: "animation", "trigger-range": "range" };
for (const [id, key] of Object.entries(groupKey)) {
  document.getElementById(id).addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button && !button.classList.contains("custom")) {
      save(key, button.dataset.value);
    }
  });
}
document.getElementById("pin").addEventListener("change", event => save("pin", event.target.checked));
document.getElementById("reset").addEventListener("click", () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    prefs.set(key, value);
  }
  if (!inZen) {
    render();
  }
});

// The little "just the buttons" picture on its choice card.
const mini = document.querySelector('.mini[data-mini="buttons"] .mini-page');
// Page starts 7px down; the buttons are 72 x 26 at the window's corner.
const miniMask = notchMask(65, 19, 6);
mini.style.mask =
  `linear-gradient(#000, #000) left top / calc(100% - ${miniMask.w}px) 100% no-repeat, ` +
  `linear-gradient(#000, #000) left bottom / 100% calc(100% - ${miniMask.h}px) no-repeat, ` +
  `${miniMask.url} right top / ${miniMask.w}px ${2 * miniMask.h}px no-repeat`;

prefs.observe(render);
window.addEventListener("resize", renderDemo);
demo.classList.add("fresh");
render();
