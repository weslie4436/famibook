/**
 * FamiBook Okuma-style reader — local pages API or home vault, zh/en.
 */
const I18N = {
  zh: {
    pageWidth: "頁面寬度",
    displayMode: "顯示模式（單頁／雙頁）",
    splitSpreads: "跨頁切成單頁",
    paperTexture: "紙紋",
    bookFold: "書溝",
    lighting: "光影",
    sidePages: "側邊餘頁",
    bookShadow: "書本陰影",
    darkTheme: "深色主題",
    lightTheme: "淺色主題",
    volume: "第 {n} 集",
  },
  en: {
    pageWidth: "Page width",
    displayMode: "Display mode (single / double)",
    splitSpreads: "Split spreads into pages",
    paperTexture: "Paper texture",
    bookFold: "Book fold",
    lighting: "Lighting",
    sidePages: "Side pages",
    bookShadow: "Book shadow",
    darkTheme: "Dark theme",
    lightTheme: "Light theme",
    volume: "Vol. {n}",
  },
};

const PREF_KEYS = [
  "lang",
  "theme",
  "doublePage",
  "splitSpreads",
  "paperTexture",
  "bookFold",
  "lighting",
  "sidePages",
  "bookShadow",
  "pageWidth",
  "pageWidthManual",
];

const PAGES_ORIGIN = "https://theoldfathertw.github.io/famibook/";

function isWebReader() {
  return Boolean(window.FAMI_WEB_READER);
}

function inFamiOverlay() {
  try {
    return Boolean(
      window.FAMI_WEB_READER
      && window.parent
      && window.parent !== window
      && window.parent.location.origin === location.origin
    );
  } catch (err) {
    return false;
  }
}

function tellParent(kind, extra) {
  if (!inFamiOverlay()) return false;
  try {
    const msg = extra && typeof extra === "object"
      ? Object.assign({ fami: kind }, extra)
      : { fami: kind };
    window.parent.postMessage(msg, location.origin);
    return true;
  } catch (err) {
    return false;
  }
}

function vaultBase() {
  const raw = String(window.VAULT_ORIGIN || "").replace(/\/$/, "");
  return raw || location.origin;
}

function vaultAuth() {
  const q = new URLSearchParams(location.search);
  const k = q.get("k") || "";
  const book = q.get("book") || "";
  return { k, book, on: Boolean(k && book) };
}

function withVault(pathAndQuery) {
  const { k, book, on } = vaultAuth();
  if (!on) return pathAndQuery;
  const u = new URL(pathAndQuery, vaultBase() + "/");
  u.searchParams.delete("k");
  u.searchParams.delete("book");
  if (k) u.searchParams.set("k", k);
  if (book) u.searchParams.set("book", book);
  return u.href;
}

function pageUrl(srcOrLeaf) {
  const leaf =
    srcOrLeaf && typeof srcOrLeaf === "object" ? srcOrLeaf : { src: srcOrLeaf };
  const { k, book, on } = vaultAuth();
  const path = `/pages/${encodeURIComponent(leaf.src)}`;
  if (!on) return path;
  const u = new URL(path, vaultBase() + "/");
  u.searchParams.set("book", book);
  u.searchParams.set("k", k);
  if (leaf.mtime) u.searchParams.set("rev", String(leaf.mtime));
  return u.href;
}

function titleHasVolume(title, volume) {
  if (volume == null || volume === "") return true;
  const n = String(volume);
  const t = String(title || "");
  return t.includes("(" + n + ")") || t.includes("（" + n + "）") || t.includes("#" + n);
}

function applyCropClass(img, leaf) {
  img.className = "";
  if (!leaf) return;
  if (leaf.kind === "jacket") img.classList.add("jacket");
  // Clip the full capture in CSS. Box aspect follows leaf.cut so the
  // gutter stays; do not also fetch ?crop= (old vault ignores it and
  // both halves would show the same two-page PNG).
  if (leaf.crop === "left") img.classList.add("crop-left");
  if (leaf.crop === "right") img.classList.add("crop-right");
}

/** Display aspect (width/height) for one on-screen leaf. */
function leafAspect(leaf) {
  if (!leaf || !leaf.width || !leaf.height) return 0.71;
  const full = leaf.width / leaf.height;
  if (leaf.kind === "half") {
    const cut = leaf.cut == null ? leaf.width / 2 : Number(leaf.cut);
    const w = leaf.crop === "right" ? leaf.width - cut : cut;
    return w / leaf.height;
  }
  return full;
}

/**
 * CSS box that fills the pageWidth budget (full screen on the web reader).
 */
function fitLeafCssSize(leaf, innerW, innerH, margin, doubled) {
  const aspect = leafAspect(leaf);
  const availW = innerW * margin;
  const availH = innerH * margin;
  let horizNeed = availH * aspect;
  if (doubled) horizNeed *= 2;
  const vertical = availW < horizNeed;
  let cssW;
  let cssH;
  if (vertical) {
    cssW = doubled ? availW / 2 : availW;
    cssH = cssW / aspect;
  } else {
    cssH = availH;
    cssW = cssH * aspect;
  }
  return { vertical, width: Math.round(cssW), height: Math.round(cssH) };
}

const PAGE_ZOOM_MIN = 1;
const PAGE_ZOOM_MAX = 4;

/** Keep a scaled full-viewport stage covering the screen (origin 0,0). */
function pageZoomClamp(z, w, h) {
  const s = Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, z.s));
  if (s <= 1.001) return { s: 1, x: 0, y: 0 };
  return {
    s,
    x: Math.min(0, Math.max(w * (1 - s), z.x)),
    y: Math.min(0, Math.max(h * (1 - s), z.y)),
  };
}

/** Pinch: keep the start midpoint's local point under the current midpoint. */
function pageZoomFromPinch(start, mid, ratio, w, h) {
  const localX = (start.mx - start.x) / start.s;
  const localY = (start.my - start.y) / start.s;
  return pageZoomClamp({
    s: start.s * ratio,
    x: mid.x - localX * start.s * ratio,
    y: mid.y - localY * start.s * ratio,
  }, w, h);
}

function pageZoomFromPan(start, pt, w, h) {
  return pageZoomClamp({
    s: start.s,
    x: start.x + (pt.x - start.mx),
    y: start.y + (pt.y - start.my),
  }, w, h);
}

function pageZoomCss(z) {
  if (!z || z.s <= 1.001) return "";
  return "translate3d(" + z.x + "px," + z.y + "px,0) scale(" + z.s + ")";
}

const PAGE_ZOOM_TAP = 2.5;
const TAP_DOUBLE_MS = 300;
const TAP_DOUBLE_SLOP = 32;
const ZOOM_TOGGLE_GAP = 400;
const READER_CHROME_SEL = [
  "button",
  "input",
  "textarea",
  "select",
  "a",
  ".settings-menu",
  ".batch-tag-sheet",
  ".ask-mask",
  "#topMenu",
  "#bottomMenu",
  "#sliderContainer",
  "#pageSlider",
].join(", ");

/** Double-tap/click: zoom so the point stays under the finger; tap again to reset. */
function pageZoomToggleAt(z, pt, scale, w, h) {
  if (z && z.s > 1.02) return { s: 1, x: 0, y: 0 };
  const tapScale = Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, scale || PAGE_ZOOM_TAP));
  return pageZoomFromPinch(
    { s: 1, x: 0, y: 0, mx: pt.x, my: pt.y },
    { x: pt.x, y: pt.y },
    tapScale,
    w,
    h,
  );
}

function isDoubleTap(prev, next, nowMs) {
  if (!prev || !next) return false;
  if (nowMs - prev.t > TAP_DOUBLE_MS) return false;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  return (dx * dx + dy * dy) <= TAP_DOUBLE_SLOP * TAP_DOUBLE_SLOP;
}

function zoomToggleFresh(prevAt, nowMs) {
  return !prevAt || nowMs - prevAt >= ZOOM_TOGGLE_GAP;
}

function isReaderChromeNode(node) {
  if (!node || typeof node.closest !== "function") return false;
  if (node.closest(READER_CHROME_SEL)) return true;
  const mask = node.closest("#endMask, #configMask, #readerAskMask");
  return !!(mask && !mask.hidden);
}

function touchAllowsNativePan(ev) {
  const path = (ev && typeof ev.composedPath === "function" ? ev.composedPath() : null) || [];
  for (let i = 0; i < path.length; i++) {
    const el = path[i];
    if (el && el.tagName === "INPUT" && String(el.type || "").toLowerCase() === "range") return true;
    if (isReaderChromeNode(el)) return true;
  }
  return isReaderChromeNode(ev && ev.target);
}

/**
 * Okuma default page-width slider (fraction of screen × 100).
 * Official reader uses ~90 for books; webtoon differs — we keep book default.
 */
function suggestPageWidth(_leaf) {
  return isWebReader() ? 100 : 90;
}

async function main() {
  const prefs = {
    lang: "zh",
    theme: isWebReader() ? "light" : "dark",
    doublePage: false,
    splitSpreads: true,
    paperTexture: !isWebReader(),
    bookFold: !isWebReader(),
    lighting: !isWebReader(),
    sidePages: !isWebReader(),
    bookShadow: !isWebReader(),
    pageWidth: isWebReader() ? 100 : 90,
    pageWidthManual: false,
  };

  const els = {
    title: document.getElementById("bookTitle"),
    volume: document.getElementById("bookVolume"),
    nav: document.getElementById("navImage"),
    left: document.getElementById("imgPageLeft"),
    right: document.getElementById("imgPageRight"),
    slider: document.getElementById("pageSlider"),
    sliderL: document.getElementById("pageSliderLeft"),
    sliderR: document.getElementById("pageSliderRight"),
    loader: document.getElementById("loaderContainer"),
    config: document.getElementById("configMenu"),
    pageWidth: document.getElementById("pageWidthSlider"),
    theme: document.getElementById("themeSelection"),
    language: document.getElementById("languageSelection"),
    topMenu: document.getElementById("topMenu"),
    bottomMenu: document.getElementById("bottomMenu"),
    pageWait: document.getElementById("pageWait"),
    configMask: document.getElementById("configMask"),
    configButton: document.getElementById("configButton"),
  };

  let book = null;
  let leaves = [];
  let index = 0;
  let positionKey = "";
  let hideTimer = null;
  let saveTimer = null;
  let showingDouble = false;
  let pageZoom = { s: 1, x: 0, y: 0 };
  let pinch = null;
  let zoomPan = null;
  let sliderHeld = false;

  const vault = vaultAuth();
  const settingsMenu = document.getElementById("readerSettingsMenu");
  const settingsCatch = document.getElementById("readerSettingsCatch");
  const settingsWrap = document.getElementById("reader-settings");

  function goToShelf() {
    try {
      sessionStorage.removeItem("famibook.reading");
    } catch (err) {
      /* ignore */
    }
    if (tellParent("close-reader")) return;
    const pin = "?k=" + encodeURIComponent(vault.k) + "#k=" + encodeURIComponent(vault.k);
    if (isWebReader() || /github\.io$/i.test(location.hostname)) {
      location.href = "./index.html" + pin;
    } else {
      location.href = PAGES_ORIGIN + pin;
    }
  }

  function padReaderHistory() {
    if (!isWebReader() || inFamiOverlay()) return;
    try {
      const seq = (window.__famiStaySeq || 0) + 1;
      window.__famiStaySeq = seq + 1;
      const raw = (location.hash || "").replace(/^#/, "").replace(/&?stay=\d+/g, "").replace(/&$/, "");
      const href = (n) =>
        location.pathname + location.search + "#" + (raw ? raw + "&stay=" + n : "stay=" + n);
      history.pushState({ famiReader: 1, n: seq }, "", href(seq));
      history.pushState({ famiReader: 1, n: seq + 1 }, "", href(seq + 1));
    } catch (err) {
      /* ignore */
    }
  }
  if (isWebReader() && !window.__famiReaderStay) {
    window.__famiReaderStay = true;
    window.addEventListener("popstate", padReaderHistory);
    window.addEventListener("pageshow", padReaderHistory);
    padReaderHistory();
  }

  if (vault.on) {
    document.body.classList.add("vaultReader");
    const back = document.getElementById("backShelf");
    if (back) {
      back.hidden = false;
      let backStart = null;
      let backAt = 0;
      let backSwiped = false;
      function handleBack(e) {
        if (backStart) {
          const x = e.clientX != null ? e.clientX : backStart.x;
          const y = e.clientY != null ? e.clientY : backStart.y;
          const dx = x - backStart.x;
          const dy = y - backStart.y;
          backStart = null;
          if (Math.abs(dx) >= 48 && Math.abs(dx) >= Math.abs(dy) * 1.2) {
            e.preventDefault();
            e.stopPropagation();
            backSwiped = true;
            turnByExitSign(dx > 0 ? 1 : -1);
            return;
          }
        }
        if (backSwiped) {
          backSwiped = false;
          e.preventDefault();
          return;
        }
        if (e.type === "click" && Date.now() - backAt < 400) {
          e.preventDefault();
          return;
        }
        backAt = Date.now();
        goToShelf();
      }
      back.addEventListener("pointerdown", (e) => {
        backStart = { x: e.clientX, y: e.clientY };
      });
      back.addEventListener("pointerup", handleBack);
      back.addEventListener("click", handleBack);
    }
    document.getElementById("readerContext")?.remove();
  }

  function applyOrientationPref() {
    if (!isWebReader()) return;
    // Portrait = one leaf; landscape = two. Overwrite leftover disk prefs
    // so a desktop double-page setting cannot lock the phone upright.
    prefs.doublePage = window.matchMedia("(orientation: landscape)").matches;
  }

  function applyWebLocks() {
    if (!isWebReader()) return;
    prefs.theme = "light";
    prefs.pageWidth = 100;
    prefs.pageWidthManual = true;
    prefs.splitSpreads = true;
    prefs.sidePages = false;
    prefs.bookShadow = false;
    applyOrientationPref();
  }
  applyOrientationPref();
  if (isWebReader()) {
    const mq = window.matchMedia("(orientation: landscape)");
    const onOrient = () => {
      resetPageZoom();
      const want = mq.matches;
      if (prefs.doublePage === want) {
        if (leaves.length) refreshLayoutNavImage();
        return;
      }
      prefs.doublePage = want;
      if (!leaves.length) return;
      index = snapIndex(index);
      render({ dir: 0 });
    };
    if (mq.addEventListener) mq.addEventListener("change", onOrient);
    else mq.addListener(onOrient);
  }

  function t(key) {
    const pack = I18N[prefs.lang] || I18N.zh;
    return pack[key] || I18N.en[key] || key;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    const darkOpt = els.theme?.querySelector('option[value="dark"]');
    const lightOpt = els.theme?.querySelector('option[value="light"]');
    if (darkOpt) darkOpt.textContent = t("darkTheme");
    if (lightOpt) lightOpt.textContent = t("lightTheme");
  }

  async function persistPrefs(extra = {}) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const body = {};
    for (const k of PREF_KEYS) body[k] = prefs[k];
    Object.assign(body, extra);
    try {
      if (vaultAuth().on) {
        try {
          localStorage.setItem("famibook.readerPrefs", JSON.stringify(body));
        } catch (err) {
          /* ignore quota */
        }
        const positions = extra.positions || (positionKey ? { [positionKey]: index } : {});
        const payload = { positions };
        if (extra.finished) payload.finished = extra.finished;
        const readTotals = { ...(extra.read_totals || {}) };
        if (positionKey && leaves.length && Object.prototype.hasOwnProperty.call(positions, positionKey)) {
          readTotals[positionKey] = leaves.length;
        }
        if (Object.keys(readTotals).length) payload.read_totals = readTotals;
        await fetch(withVault("/api/prefs"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return;
      }
      await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn("prefs save failed", err);
    }
  }

  function schedulePersist(extra) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistPrefs(extra), 200);
  }

  async function persistPosition() {
    if (!positionKey) return;
    schedulePersist({ positions: { [positionKey]: index } });
  }

  function applyChrome() {
    document.body.classList.toggle("darkTheme", prefs.theme === "dark");
    document.body.classList.toggle("lightTheme", prefs.theme === "light");
    document.body.classList.toggle("sidePagesOn", prefs.sidePages);
    document.body.classList.toggle("manga", true);

    els.nav.classList.toggle("doublePage", showingDouble);
    els.nav.classList.toggle("singlePage", !showingDouble);
    els.nav.classList.toggle("bookShadow", prefs.bookShadow);

    const setFilter = (cls, on) => {
      document.querySelectorAll("." + cls).forEach((el) => {
        el.classList.toggle("enabled", on);
      });
    };
    setFilter("filter-paper", prefs.paperTexture);
    setFilter("filter-fold", prefs.bookFold && showingDouble);
    setFilter("filter-light", prefs.lighting);
    setFilter("filter-spec", prefs.lighting);

    const setBtn = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("enabled", on);
    };
    setBtn("paperTextureButton", prefs.paperTexture);
    setBtn("bookFoldButton", prefs.bookFold);
    setBtn("lightingButton", prefs.lighting);
    setBtn("sidePagesButton", prefs.sidePages);
    setBtn("bookShadowButton", prefs.bookShadow);
    setBtn("doublePageButton", prefs.doublePage);
    setBtn("splitSpreadsButton", prefs.splitSpreads);

    if (els.pageWidth) els.pageWidth.value = String(prefs.pageWidth);
    if (els.theme) els.theme.value = prefs.theme;
    if (els.language) els.language.value = prefs.lang;
    const setSwitch = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!on;
    };
    setSwitch("paperTextureSwitch", prefs.paperTexture);
    setSwitch("bookFoldSwitch", prefs.bookFold);
    setSwitch("lightingSwitch", prefs.lighting);
    applyI18n();
  }

  /**
   * Okuma-style: cover (leaf 0) always alone when user wants double-page;
   * then pairs (1,2), (3,4), … Last odd leaf alone.
   */
  function isDoublePossibleAt(i) {
    if (!prefs.doublePage) return false;
    if (leaves.length < 2) return false;
    if (i <= 0) return false; // cover / first leaf
    if (i + 1 >= leaves.length) return false; // no pair partner
    return true;
  }

  function snapIndex(i) {
    i = Math.max(0, Math.min(i, Math.max(0, leaves.length - 1)));
    if (!prefs.doublePage || i <= 0) return i;
    // Content pairs start at odd indices: 1,3,5…
    const off = i - 1;
    if (off % 2 === 1) i -= 1;
    if (i + 1 >= leaves.length) {
      // trailing single — ok
      return i;
    }
    return i;
  }

  function applyLeafBox(img, leaf, box) {
    if (!img) return;
    if (!leaf || !box) {
      img.style.width = "";
      img.style.height = "";
      img.style.aspectRatio = "";
      return;
    }
    img.style.aspectRatio = String(leafAspect(leaf));
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = box.width + "px";
    img.style.height = box.height + "px";
  }

  function snapHostPixel(host) {
    if (!host) return;
    if (pageZoom.s > 1.02) return;
    host.style.marginLeft = "0px";
    host.style.marginTop = "0px";
    const tf = host.style.transform;
    if (tf && tf !== "none") return;
    const rect = host.getBoundingClientRect();
    const dx = Math.round(rect.left) - rect.left;
    const dy = Math.round(rect.top) - rect.top;
    if (dx) host.style.marginLeft = dx + "px";
    if (dy) host.style.marginTop = dy + "px";
  }

  function viewSize() {
    const vv = window.visualViewport;
    if (isWebReader() && vv && vv.width >= 8 && vv.height >= 8) {
      return { w: vv.width, h: vv.height };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function layoutLeaves(leftImg, rightImg, leftLeaf, rightLeaf, host) {
    const margin = Math.max(0.1, Math.min(1, (prefs.pageWidth || 90) / 100));
    if (!leftImg || !leftLeaf) {
      applyLeafBox(leftImg, null, null);
      applyLeafBox(rightImg, null, null);
      return;
    }
    const { w: innerW, h: innerH } = viewSize();
    if (innerW < 8 || innerH < 8) return;
    const doubled = !!(rightLeaf && showingDouble);
    const box = fitLeafCssSize(leftLeaf, innerW, innerH, margin, doubled);
    showLeaf(leftImg, leftLeaf);
    showLeaf(rightImg, rightLeaf);
    applyLeafBox(leftImg, leftLeaf, box);
    applyLeafBox(rightImg, rightLeaf, rightLeaf ? box : null);
    snapHostPixel(host || leftImg.parentElement);
  }

  /**
   * Port of Okuma refreshLayoutNavImage (DrMint/Okuma-Reader js/read.js):
   * pageWidthSlider = % of screen to use. Pick vertical vs horizontal so the
   * page fits that budget and fills the window.
   */
  function refreshLayoutNavImage() {
    if (!leaves.length) return;

    let leftLeaf = leaves[index];
    let rightLeaf = null;
    if (showingDouble) {
      const a = leaves[index];
      const b = leaves[index + 1] || null;
      if (book?.reverse_turn) {
        leftLeaf = b;
        rightLeaf = a;
      } else {
        leftLeaf = a;
        rightLeaf = b;
      }
    }
    if (!leftLeaf) return;
    layoutLeaves(els.left, els.right, leftLeaf, rightLeaf, els.nav);
  }

  function layoutPair(leftImg, rightImg, pair) {
    const leftLeaf = pair && pair.left;
    const rightLeaf = pair && pair.right;
    const host = leftImg && leftImg.parentElement;
    layoutLeaves(leftImg, rightImg, leftLeaf, rightLeaf, host);
  }

  function paintSpread(leftImg, rightImg, host, pair) {
    if (host) {
      host.classList.toggle("doublePage", showingDouble);
      host.classList.toggle("singlePage", !showingDouble);
      host.classList.toggle("bookShadow", prefs.bookShadow);
    }
    layoutPair(leftImg, rightImg, pair);
  }

  function ensureIncoming() {
    if (els.incoming && els.incoming.isConnected) return els.incoming;
    const stage = document.getElementById("navStage");
    if (!stage || !els.nav) return null;
    const clone = els.nav.cloneNode(true);
    clone.id = "navIncoming";
    clone.querySelectorAll("[id]").forEach((node) => {
      node.id = node.id + "In";
    });
    clone.querySelectorAll(".pageHit").forEach((node) => node.remove());
    clone.hidden = true;
    stage.appendChild(clone);
    els.incoming = clone;
    els.inLeft = document.getElementById("imgPageLeftIn");
    els.inRight = document.getElementById("imgPageRightIn");
    return clone;
  }

  function waitTransform(el) {
    return new Promise((resolve) => {
      if (!el) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener("transitionend", onEnd);
        resolve();
      };
      function onEnd(ev) {
        if (ev.target !== el) return;
        if (ev.propertyName && ev.propertyName !== "transform") return;
        done();
      }
      el.addEventListener("transitionend", onEnd);
      setTimeout(done, 420);
    });
  }

  async function slideSpread(exitSign, pair) {
    const incoming = ensureIncoming();
    if (!incoming || !els.inLeft || !exitSign) {
      paintSpread(els.left, els.right, els.nav, pair);
      return;
    }
    paintSpread(els.inLeft, els.inRight, incoming, pair);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      paintSpread(els.left, els.right, els.nav, pair);
      incoming.hidden = true;
      return;
    }
    const ease = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
    incoming.style.transition = "none";
    els.nav.style.transition = "none";
    incoming.style.willChange = "transform";
    els.nav.style.willChange = "transform";
    incoming.style.transform = "translate3d(" + -exitSign * 100 + "%,0,0)";
    els.nav.style.transform = "translate3d(0,0,0)";
    incoming.hidden = false;
    incoming.style.visibility = "visible";
    void incoming.offsetWidth;
    els.nav.style.transition = ease;
    incoming.style.transition = ease;
    els.nav.style.transform = "translate3d(" + exitSign * 100 + "%,0,0)";
    incoming.style.transform = "translate3d(0,0,0)";
    await Promise.all([waitTransform(els.nav), waitTransform(incoming)]);
    paintSpread(els.left, els.right, els.nav, pair);
    els.nav.style.transition = "none";
    els.nav.style.transform = "none";
    els.nav.style.willChange = "auto";
    incoming.style.transition = "none";
    incoming.style.transform = "none";
    incoming.style.willChange = "auto";
    incoming.hidden = true;
  }

  // Warm the browser cache for nearby leaves so page turns feel instant.
  const preloadedUrls = new Set();
  function preloadNeighbors() {
    const radius = 2;
    for (let d = 1; d <= radius; d++) {
      for (const j of [index + d, index - d]) {
        const leaf = leaves[j];
        if (!leaf) continue;
        const url = pageUrl(leaf);
        if (preloadedUrls.has(url)) continue;
        preloadedUrls.add(url);
        new Image().src = url;
      }
    }
  }

  function showLeaf(img, leaf) {
    if (!img) return;
    if (!leaf) {
      img.removeAttribute("src");
      img.style.visibility = "hidden";
      img.style.width = "";
      img.style.height = "";
      img.style.aspectRatio = "";
      return;
    }
    img.style.visibility = "visible";
    img.style.objectFit = "";
    applyCropClass(img, leaf);
    const next = pageUrl(leaf);
    if (img.getAttribute("src") !== next) img.src = next;
  }

  function pairLeaves() {
    if (!leaves.length) return { left: null, right: null };
    if (!showingDouble) return { left: leaves[index], right: null };
    const a = leaves[index];
    const b = leaves[index + 1] || null;
    if (book?.reverse_turn) return { left: b, right: a };
    return { left: a, right: b };
  }

  function waitDecoded(url) {
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        if (im.decode) im.decode().then(resolve).catch(resolve);
        else resolve();
      };
      im.onerror = resolve;
      im.src = url;
    });
  }

  function showPageWait(on) {
    if (!els.pageWait) return;
    els.pageWait.hidden = !on;
  }

  let paintGen = 0;
  let turnBusy = false;
  let firstPaint = true;
  let waitTimer = 0;

  async function render(opts) {
    const exitSign = opts && opts.exitSign ? opts.exitSign : 0;
    if (!leaves.length) {
      showingDouble = false;
      applyChrome();
      showLeaf(els.left, null);
      showLeaf(els.right, null);
      els.sliderL.textContent = "0";
      els.sliderR.textContent = "0";
      return;
    }
    index = snapIndex(index);
    showingDouble = isDoublePossibleAt(index);
    applyChrome();

    const pair = pairLeaves();
    const gen = ++paintGen;
    if (isWebReader()) {
      const urls = [pair.left, pair.right].filter(Boolean).map((leaf) => pageUrl(leaf));
      if (!firstPaint) {
        clearTimeout(waitTimer);
        waitTimer = setTimeout(() => {
          if (gen === paintGen) showPageWait(true);
        }, 160);
      }
      await Promise.all(urls.map(waitDecoded));
      clearTimeout(waitTimer);
      showPageWait(false);
      if (gen !== paintGen) return;
    }

    if (isWebReader() && !firstPaint && exitSign && document.getElementById("navStage")) {
      await slideSpread(exitSign, pair);
      if (gen !== paintGen) return;
    } else {
      showLeaf(els.left, pair.left);
      showLeaf(els.right, pair.right);
      refreshLayoutNavImage();
    }
    firstPaint = false;
    if (!isWebReader()) {
      const pending = [els.left, els.right].filter(
        (el) => el.style.visibility !== "hidden" && el.src && !el.complete
      );
      pending.forEach((el) => {
        el.addEventListener("load", () => refreshLayoutNavImage(), { once: true });
      });
    }

    const cur = index + 1;
    const total = leaves.length;
    if (book.reverse_turn) {
      els.sliderL.textContent = String(total);
      els.sliderR.textContent = String(cur);
      els.slider.value = String(total - index);
    } else {
      els.sliderL.textContent = String(cur);
      els.sliderR.textContent = String(total);
      els.slider.value = String(cur);
    }
    persistPosition();
    preloadNeighbors();
  }

  function step(delta, exitSign) {
    if (!leaves.length || turnBusy || endCardOpen()) return false;
    const prev = index;
    if (prefs.doublePage) {
      if (delta > 0) {
        if (index === 0) index = 1;
        else index = Math.min(leaves.length - 1, index + 2);
      } else {
        if (index <= 1) index = 0;
        else index = Math.max(1, index - 2);
      }
    } else {
      index = Math.max(0, Math.min(leaves.length - 1, index + delta));
    }
    index = snapIndex(index);
    if (index === prev) return false;
    resetPageZoom();
    turnBusy = true;
    Promise.resolve(render({ dir: delta, exitSign: exitSign || 0 })).finally(() => {
      turnBusy = false;
    });
    hideMenusNow();
    return true;
  }

  function goNext(exitSign) {
    if (!leaves.length) return;
    if (step(1, exitSign)) return;
    if (turnBusy || endCardOpen()) return;
    if (isWebReader()) showEndCard(true);
  }
  function goPrev(exitSign) {
    step(-1, exitSign);
  }

  function endCardOpen() {
    const mask = document.getElementById("endMask");
    return !!(mask && !mask.hidden);
  }

  function coverThumbUrl() {
    const auth = vaultAuth();
    return vaultBase() + "/thumb?book=" + encodeURIComponent(auth.book) + "&k=" + encodeURIComponent(auth.k);
  }

  async function markFinished() {
    if (!positionKey || !vaultAuth().on) return;
    await persistPrefs({
      positions: { [positionKey]: index },
      finished: { [positionKey]: true },
    });
  }

  async function showEndCard(mark) {
    if (!isWebReader()) return;
    const mask = document.getElementById("endMask");
    if (!mask) return;
    if (mark) await markFinished();
    const img = document.getElementById("endCover");
    const vol = document.getElementById("endVol");
    const nextBtn = document.getElementById("endNext");
    if (img) img.src = coverThumbUrl();
    if (vol) {
      if (book && book.volume != null && book.volume !== "") {
        vol.hidden = false;
        vol.textContent = String(book.volume);
      } else {
        vol.hidden = true;
      }
    }
    if (nextBtn) nextBtn.hidden = !(book && book.next);
    mask.hidden = false;
    hideMenusNow();
    showPageWait(false);
    if (els.loader) els.loader.classList.add("hidden");
  }

  async function hideEndCard() {
    const mask = document.getElementById("endMask");
    if (mask) mask.hidden = true;
  }

  async function rereadFromEnd() {
    if (!positionKey) return;
    await persistPrefs({
      positions: { [positionKey]: 0 },
      finished: { [positionKey]: false },
    });
    index = 0;
    resetPageZoom();
    await hideEndCard();
    firstPaint = true;
    await render({ dir: 0 });
  }

  function openNextVolume() {
    if (!book || !book.next) return;
    if (tellParent("open-next", { book: book.next })) return;
    const auth = vaultAuth();
    location.replace("./read.html?book=" + encodeURIComponent(book.next)
      + "&k=" + encodeURIComponent(auth.k)
      + "#k=" + encodeURIComponent(auth.k));
  }

  function settingsMenuOpen() {
    return !!(settingsMenu && !settingsMenu.hidden);
  }

  function placeSettingsMenu() {
    if (!els.configButton || !settingsMenu || settingsMenu.hidden) return;
    const box = els.configButton.getBoundingClientRect();
    const pad = 10;
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const vo = vv ? vv.offsetTop : 0;
    const vl = vv ? vv.offsetLeft : 0;
    const mw = settingsMenu.offsetWidth || 220;
    const mh = settingsMenu.offsetHeight || 200;
    let left = box.right - mw;
    if (left < vl + pad) left = vl + pad;
    if (left + mw > vl + vw - pad) left = Math.max(vl + pad, vl + vw - mw - pad);
    let top = box.bottom + 8;
    if (top + mh > vo + vh - pad) top = box.top - mh - 8;
    if (top < vo + pad) top = vo + pad;
    settingsMenu.style.position = "fixed";
    settingsMenu.style.right = "auto";
    settingsMenu.style.bottom = "auto";
    settingsMenu.style.left = Math.round(left) + "px";
    settingsMenu.style.top = Math.round(top) + "px";
  }

  function closeSettingsMenu() {
    if (!settingsMenu) return;
    settingsMenu.hidden = true;
    if (settingsWrap && settingsMenu.parentNode !== settingsWrap) {
      settingsWrap.appendChild(settingsMenu);
    }
    if (els.configButton) {
      els.configButton.setAttribute("aria-expanded", "false");
      els.configButton.classList.remove("is-live");
    }
    if (settingsCatch) settingsCatch.hidden = true;
    document.documentElement.classList.remove("settings-open");
  }

  function openSettingsMenu() {
    if (!settingsMenu || !els.configButton) return;
    if (settingsCatch) {
      settingsCatch.hidden = false;
      document.body.appendChild(settingsCatch);
    }
    document.body.appendChild(settingsMenu);
    settingsMenu.hidden = false;
    document.documentElement.classList.add("settings-open");
    els.configButton.setAttribute("aria-expanded", "true");
    els.configButton.classList.add("is-live");
    bumpMenus();
    requestAnimationFrame(placeSettingsMenu);
  }

  function configIsOpen() {
    if (settingsMenuOpen()) return true;
    if (isWebReader() && els.configMask) return !els.configMask.hidden;
    return !!(els.config && els.config.classList.contains("enabled"));
  }

  function setConfigOpen(on) {
    if (on) closeSettingsMenu();
    if (isWebReader() && els.configMask) {
      els.configMask.hidden = !on;
      if (on) bumpMenus();
      return;
    }
    if (els.config) els.config.classList.toggle("enabled", on);
  }

  let hostGm = false;
  let readerAskFn = null;
  let readerAskTimer = 0;
  let repairBusy = false;

  function visiblePageFiles() {
    const pair = pairLeaves();
    const out = [];
    [pair.left, pair.right].forEach((leaf) => {
      if (!leaf || !leaf.src) return;
      if (out.indexOf(leaf.src) < 0) out.push(leaf.src);
    });
    return out;
  }

  function revealRepairMenu() {
    const pageBtn = document.getElementById("repairPageBtn");
    const volBtn = document.getElementById("repairVolumeBtn");
    if (!pageBtn && !volBtn) return;
    const show = isWebReader() && hostGm && book && book.capturable !== false;
    if (pageBtn) pageBtn.hidden = !show;
    if (volBtn) volBtn.hidden = !show;
  }

  async function loadHostDoor() {
    if (!isWebReader() || !vault.on) return;
    try {
      const res = await fetch(withVault("/api/me"));
      const me = await res.json();
      hostGm = !!me.gm;
    } catch (err) {
      hostGm = false;
    }
    revealRepairMenu();
  }

  function closeReaderAsk() {
    const mask = document.getElementById("readerAskMask");
    if (mask) {
      mask.hidden = true;
      mask.classList.remove("is-note", "is-out");
    }
    const actions = mask && mask.querySelector(".ask-actions");
    if (actions) actions.hidden = false;
    readerAskFn = null;
    if (readerAskTimer) {
      window.clearTimeout(readerAskTimer);
      readerAskTimer = 0;
    }
  }

  function openReaderAsk(text, fn) {
    readerAskFn = fn || null;
    const mask = document.getElementById("readerAskMask");
    const p = document.getElementById("readerAskText");
    const actions = mask && mask.querySelector(".ask-actions");
    if (readerAskTimer) {
      window.clearTimeout(readerAskTimer);
      readerAskTimer = 0;
    }
    if (p) p.textContent = text;
    if (actions) actions.hidden = !fn;
    if (mask) {
      mask.classList.toggle("is-note", !fn);
      mask.classList.remove("is-out");
      mask.hidden = false;
    }
  }

  function flashReaderNote(text) {
    openReaderAsk(text, null);
    readerAskTimer = window.setTimeout(() => {
      const mask = document.getElementById("readerAskMask");
      if (mask) mask.classList.add("is-out");
      readerAskTimer = window.setTimeout(() => {
        if (!mask || !mask.classList.contains("is-note")) return;
        closeReaderAsk();
      }, 280);
    }, 1600);
  }

  async function enqueueRepair(kind, extra, title) {
    if (repairBusy) return;
    const auth = vaultAuth();
    if (!auth.on) {
      flashReaderNote("家裡還沒開");
      return;
    }
    repairBusy = true;
    try {
      const res = await fetch(vaultBase() + "/api/host/jobs?k=" + encodeURIComponent(auth.k), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "enqueue",
          kind,
          book: auth.book,
          title: title || (book && book.title) || "",
          extra: extra || {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flashReaderNote(data.error === "need_host" ? "只有館主可以修" : (data.error || "還沒排進去"));
        return;
      }
      tellParent("job-queued");
      flashReaderNote("已交給主機");
    } catch (err) {
      flashReaderNote("家裡還沒開");
    } finally {
      repairBusy = false;
    }
  }

  function askRepairPage() {
    const files = visiblePageFiles();
    if (!files.length) {
      flashReaderNote("這一頁還沒圖");
      return;
    }
    const copy = files.length > 1 ? "修復這兩頁?" : "修復這一頁?";
    openReaderAsk(copy, () => {
      enqueueRepair("recapture_page", { files }, "修復單頁");
    });
  }

  function askRepairVolume() {
    openReaderAsk("整本重新擷取?", () => {
      enqueueRepair("recapture", {}, "整本重截");
    });
  }

  function bumpMenus() {
    if (sliderHeld) return;
    els.topMenu.classList.remove("hidden");
    els.bottomMenu.classList.remove("hidden");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (configIsOpen() || sliderHeld) return;
      els.topMenu.classList.add("hidden");
      els.bottomMenu.classList.add("hidden");
    }, 2500);
  }

  function hideMenusNow() {
    if (configIsOpen()) return;
    clearTimeout(hideTimer);
    els.topMenu.classList.add("hidden");
    els.bottomMenu.classList.add("hidden");
  }

  function applyAutoWidthIfNeeded() {
    if (prefs.pageWidthManual) return;
    // Prefer first content leaf (after cover) for typical manga proportions
    const sample = leaves[1] || leaves[0];
    if (!sample) return;
    prefs.pageWidth = suggestPageWidth(sample);
  }

  async function loadSeriesPrefs() {
    try {
      if (vaultAuth().on) {
        try {
          const raw = localStorage.getItem("famibook.readerPrefs");
          if (raw) {
            const savedPrefs = JSON.parse(raw);
            for (const k of PREF_KEYS) {
              if (savedPrefs[k] !== undefined) prefs[k] = savedPrefs[k];
            }
          }
        } catch (err) {
          /* ignore */
        }
        applyWebLocks();
        const res = await fetch(withVault("/api/prefs"));
        return await res.json();
      }
      const res = await fetch("/api/prefs");
      const data = await res.json();
      for (const k of PREF_KEYS) {
        if (data[k] !== undefined) prefs[k] = data[k];
      }
      applyWebLocks();
      return data;
    } catch (err) {
      console.warn("prefs load failed", err);
      return {};
    }
  }

  /**
   * Reload page leaves from /api/book.
   * @param {{ loadPrefs?: boolean }} [opts]
   *   loadPrefs: read disk prefs first (initial open only).
   *   Never re-read prefs after a settings toggle — that raced with
   *   debounced save and made "跨頁切成單頁" stick after one click.
   */
  async function reloadBook(opts = {}) {
    const loadPrefs = !!opts.loadPrefs;
    els.loader.classList.remove("hidden");
    let prefData = {};
    if (loadPrefs) {
      prefData = await loadSeriesPrefs();
      for (const k of PREF_KEYS) {
        if (prefData[k] !== undefined) prefs[k] = prefData[k];
      }
      // Bad combo on disk: keep split choice, drop double-page (not the reverse).
      if (prefs.doublePage && !prefs.splitSpreads) {
        prefs.doublePage = false;
        await persistPrefs();
      }
      applyWebLocks();
      if (!prefs.pageWidthManual && !prefData.fromDisk) {
        applyAutoWidthIfNeeded();
        await persistPrefs();
      }
    }

    const q = prefs.splitSpreads ? "" : "?split=0";
    const res = await fetch(withVault(`/api/book${q}`));
    book = await res.json();
    leaves = book.leaves || [];
    positionKey = book.positionKey || book.folder || book.title || "";
    els.title.textContent = book.title || "FamiBook";
    document.title = book.title || "FamiBook";
    if (els.volume) {
      if (book.volume != null && !titleHasVolume(book.title, book.volume)) {
        els.volume.hidden = false;
        els.volume.textContent = t("volume").replace("{n}", String(book.volume));
      } else {
        els.volume.textContent = "";
        els.volume.hidden = true;
      }
    }

    if (loadPrefs) {
      const saved = prefData.positions?.[positionKey] ?? prefData.position;
      index = Number.isFinite(saved)
        ? Math.max(0, Math.min(saved, Math.max(0, leaves.length - 1)))
        : 0;
    }
    index = snapIndex(Math.max(0, Math.min(index, Math.max(0, leaves.length - 1))));
    els.slider.max = String(Math.max(1, leaves.length));
    applyChrome();
    revealRepairMenu();
    if (loadPrefs && isWebReader()) {
      const done = !!(prefData.finished && prefData.finished[positionKey])
        || !!prefData.done
        || new URLSearchParams(location.search).get("end") === "1";
      if (done) {
        index = Math.max(0, leaves.length - 1);
        await showEndCard(true);
        els.loader.classList.add("hidden");
        tellParent("reader-ready");
        return;
      }
    }
    await render({ dir: 0 });
    els.loader.classList.add("hidden");
    tellParent("reader-ready");
  }

  // Old page follows the finger. A tap on an edge is the same gesture as
  // swiping toward the other side (left tap ≡ swipe right ≡ +1).
  function turnByExitSign(exitSign) {
    if (!exitSign) return;
    padReaderHistory();
    if (book?.reverse_turn) {
      if (exitSign > 0) goNext(exitSign);
      else goPrev(exitSign);
    } else if (exitSign > 0) {
      goPrev(exitSign);
    } else {
      goNext(exitSign);
    }
  }

  let swipe = null;
  let ignoreClick = false;
  let edgeStolen = false;
  let lastTap = null;
  let lastToggleAt = 0;
  let pendingTurn = 0;
  let zoomMoved = false;
  const navBox = document.getElementById("navImageContainer");
  const SWIPE_MIN = 48;
  const STEAL_LEFT = 72;
  const STEAL_RIGHT = 48;

  function applyPageZoom() {
    const stage = document.getElementById("navStage");
    if (!stage) return;
    stage.style.transformOrigin = "0 0";
    const css = pageZoomCss(pageZoom);
    stage.style.transform = css || "none";
  }
  function resetPageZoom() {
    pageZoom = { s: 1, x: 0, y: 0 };
    pinch = null;
    zoomPan = null;
    applyPageZoom();
  }
  function isPageZoomed() {
    return pageZoom.s > 1.02;
  }
  function toggleZoomAtPoint(pt) {
    const now = Date.now();
    if (!zoomToggleFresh(lastToggleAt, now)) return;
    lastToggleAt = now;
    clearTimeout(pendingTurn);
    pendingTurn = 0;
    lastTap = null;
    ignoreClick = true;
    pinch = null;
    zoomPan = null;
    edgeStolen = false;
    swipe = null;
    zoomMoved = false;
    const box = viewSize();
    pageZoom = pageZoomToggleAt(pageZoom, pt, PAGE_ZOOM_TAP, box.w, box.h);
    applyPageZoom();
  }
  function touchDist(a, b) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function touchMid(a, b) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }
  function beginPinch(e) {
    if (!isWebReader() || e.touches.length < 2) return false;
    const mid = touchMid(e.touches[0], e.touches[1]);
    pinch = {
      s: pageZoom.s,
      x: pageZoom.x,
      y: pageZoom.y,
      mx: mid.x,
      my: mid.y,
      dist: Math.max(1, touchDist(e.touches[0], e.touches[1])),
    };
    zoomPan = null;
    swipe = null;
    lastTap = null;
    edgeStolen = false;
    ignoreClick = true;
    return true;
  }
  function movePinch(e) {
    if (!pinch || e.touches.length < 2) return false;
    const box = viewSize();
    const ratio = Math.max(1, touchDist(e.touches[0], e.touches[1])) / pinch.dist;
    pageZoom = pageZoomFromPinch(pinch, touchMid(e.touches[0], e.touches[1]), ratio, box.w, box.h);
    applyPageZoom();
    return true;
  }
  function endPinch(e) {
    if (!pinch) return false;
    if (e.touches && e.touches.length >= 2) return true;
    if (pageZoom.s < 1.08) resetPageZoom();
    else {
      pinch = null;
      if (e.touches && e.touches.length === 1) {
        const t = e.touches[0];
        zoomPan = {
          s: pageZoom.s,
          x: pageZoom.x,
          y: pageZoom.y,
          mx: t.clientX,
          my: t.clientY,
        };
      }
    }
    return true;
  }
  function beginZoomPan(t) {
    zoomPan = {
      s: pageZoom.s,
      x: pageZoom.x,
      y: pageZoom.y,
      mx: t.clientX,
      my: t.clientY,
    };
    swipe = null;
    edgeStolen = false;
    ignoreClick = true;
  }
  function moveZoomPan(t) {
    if (!zoomPan || !t) return false;
    const box = viewSize();
    pageZoom = pageZoomFromPan(zoomPan, { x: t.clientX, y: t.clientY }, box.w, box.h);
    applyPageZoom();
    return true;
  }
  function onHitClick(sign, e) {
    e.stopPropagation();
    if (ignoreClick || e.detail >= 2) {
      ignoreClick = false;
      e.preventDefault();
      return;
    }
    clearTimeout(pendingTurn);
    pendingTurn = setTimeout(() => {
      pendingTurn = 0;
      turnByExitSign(sign);
    }, TAP_DOUBLE_MS);
  }
  // manga RTL: left edge = next, right edge = previous
  document.getElementById("hitPrev").addEventListener("click", (e) => onHitClick(1, e));
  document.getElementById("hitNext").addEventListener("click", (e) => onHitClick(-1, e));
  function isTurnSwipe(dx, dy) {
    return Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) >= Math.abs(dy) * 1.2;
  }
  function isReaderChrome(node) {
    return isReaderChromeNode(node);
  }
  function finishEdgeTouch(e) {
    if (pinch || zoomPan) return false;
    if (!edgeStolen) return false;
    edgeStolen = false;
    const t = e.changedTouches && e.changedTouches[0];
    const start = swipe;
    swipe = null;
    if (!t || !start) return true;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const w = window.innerWidth;
    ignoreClick = true;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const sign = start.x <= STEAL_LEFT ? 1 : start.x >= w - STEAL_RIGHT ? -1 : 0;
      if (!sign) return true;
      clearTimeout(pendingTurn);
      pendingTurn = setTimeout(() => {
        pendingTurn = 0;
        turnByExitSign(sign);
      }, TAP_DOUBLE_MS);
    } else if (isTurnSwipe(dx, dy)) {
      lastTap = null;
      turnByExitSign(dx > 0 ? 1 : -1);
    }
    return true;
  }
  function finishZoomTouch(e) {
    if (endPinch(e)) {
      e.preventDefault();
      return true;
    }
    if (zoomPan) {
      if (e.touches && e.touches.length) return true;
      zoomPan = null;
      return true;
    }
    return false;
  }
  if (isWebReader()) {
    document.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches.length || touchAllowsNativePan(e)) return;
        if (e.touches.length >= 2) {
          beginPinch(e);
          e.preventDefault();
          return;
        }
        const t = e.touches[0];
        zoomMoved = false;
        if (isPageZoomed()) {
          swipe = { x: t.clientX, y: t.clientY, id: "zoom" };
          e.preventDefault();
          return;
        }
        ignoreClick = false;
        const w = window.innerWidth;
        if (t.clientX > STEAL_LEFT && t.clientX < w - STEAL_RIGHT) return;
        edgeStolen = true;
        swipe = { x: t.clientX, y: t.clientY, id: "edge" };
        e.preventDefault();
      },
      { passive: false, capture: true },
    );
    document.addEventListener(
      "touchmove",
      (e) => {
        if (touchAllowsNativePan(e)) return;
        if (movePinch(e)) {
          lastTap = null;
          e.preventDefault();
          return;
        }
        const t = e.touches && e.touches[0];
        if (isPageZoomed() && t && swipe && swipe.id === "zoom" && !zoomPan) {
          const dx = t.clientX - swipe.x;
          const dy = t.clientY - swipe.y;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            zoomMoved = true;
            lastTap = null;
            beginZoomPan({ clientX: swipe.x, clientY: swipe.y });
          }
        }
        if (moveZoomPan(t)) {
          zoomMoved = true;
          lastTap = null;
          e.preventDefault();
          return;
        }
        if (!edgeStolen) return;
        e.preventDefault();
      },
      { passive: false, capture: true },
    );
    document.addEventListener("touchend", (e) => {
      if (touchAllowsNativePan(e)) return;
      const t = e.changedTouches && e.changedTouches[0];
      const now = Date.now();
      if (zoomPan && zoomMoved) {
        finishZoomTouch(e);
        lastTap = null;
        return;
      }
      zoomPan = null;
      if (t && !pinch) {
        const pt = { x: t.clientX, y: t.clientY };
        if (isDoubleTap(lastTap, pt, now)) {
          if (edgeStolen) {
            edgeStolen = false;
            swipe = null;
          }
          toggleZoomAtPoint(pt);
          e.preventDefault();
          return;
        }
        lastTap = { t: now, x: pt.x, y: pt.y };
      }
      if (finishZoomTouch(e)) return;
      finishEdgeTouch(e);
    }, { capture: true });
    document.addEventListener("touchcancel", (e) => {
      if (touchAllowsNativePan(e)) return;
      if (finishZoomTouch(e)) return;
      finishEdgeTouch(e);
    }, { capture: true });
  }
  navBox.addEventListener("pointerdown", (e) => {
    if (touchAllowsNativePan(e) || edgeStolen || pinch || zoomPan || isPageZoomed()) return;
    ignoreClick = false;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  navBox.addEventListener(
    "touchmove",
    (e) => {
      if (touchAllowsNativePan(e)) return;
      if (pinch || zoomPan || isPageZoomed()) {
        e.preventDefault();
        return;
      }
      if (edgeStolen || !swipe || !e.touches.length) return;
      const t = e.touches[0];
      const dx = t.clientX - swipe.x;
      const dy = t.clientY - swipe.y;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) >= Math.abs(dy)) e.preventDefault();
    },
    { passive: false },
  );
  function endSwipe(e) {
    if (edgeStolen || pinch || zoomPan || isPageZoomed()) return;
    if (!swipe || swipe.id === "edge" || swipe.id === "zoom" || (e.pointerId != null && e.pointerId !== swipe.id)) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (!isTurnSwipe(dx, dy)) return;
    lastTap = null;
    ignoreClick = true;
    clearTimeout(pendingTurn);
    pendingTurn = 0;
    turnByExitSign(dx > 0 ? 1 : -1);
  }
  navBox.addEventListener("pointerup", endSwipe);
  navBox.addEventListener("pointercancel", (e) => {
    if (swipe && e.pointerId === swipe.id) swipe = null;
  });
  navBox.addEventListener(
    "click",
    (e) => {
      if (!ignoreClick) return;
      ignoreClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  navBox.addEventListener("dblclick", (e) => {
    if (touchAllowsNativePan(e) || isReaderChrome(e.target)) return;
    e.preventDefault();
    toggleZoomAtPoint({ x: e.clientX, y: e.clientY });
  });

  document.getElementById("navImageContainer").addEventListener("click", (e) => {
    if (e.target.classList?.contains("pageHit")) return;
    if (ignoreClick || e.detail >= 2) return;
    bumpMenus();
  });

  function holdSlider(on) {
    sliderHeld = !!on;
    if (on) {
      clearTimeout(hideTimer);
      if (els.topMenu) els.topMenu.classList.remove("hidden");
      if (els.bottomMenu) els.bottomMenu.classList.remove("hidden");
    } else {
      bumpMenus();
    }
  }
  const sliderBox = document.getElementById("sliderContainer");
  ["pointerdown", "touchstart"].forEach((type) => {
    if (els.slider) els.slider.addEventListener(type, () => holdSlider(true), { passive: true });
    if (sliderBox) sliderBox.addEventListener(type, () => holdSlider(true), { passive: true });
  });
  ["pointerup", "pointercancel", "touchend", "touchcancel"].forEach((type) => {
    window.addEventListener(type, () => {
      if (!sliderHeld) return;
      holdSlider(false);
    }, { passive: true });
  });

  els.slider.addEventListener("input", () => {
    holdSlider(true);
    let v = parseInt(els.slider.value, 10) - 1;
    if (book.reverse_turn) v = leaves.length - parseInt(els.slider.value, 10);
    index = snapIndex(Math.max(0, Math.min(leaves.length - 1, v)));
    resetPageZoom();
    render({ dir: 0 });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      turnByExitSign(-1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      turnByExitSign(1);
    } else if (e.key === "Escape") {
      const ask = document.getElementById("readerAskMask");
      if (ask && !ask.hidden) closeReaderAsk();
      else if (settingsMenuOpen()) closeSettingsMenu();
      else setConfigOpen(false);
    } else if ((e.key === "f" || e.key === "F") && document.getElementById("fullScreenButton")) {
      toggleFs();
    }
  });

  document.getElementById("configButton").addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isWebReader() && settingsMenu) {
      if (settingsMenuOpen()) closeSettingsMenu();
      else {
        setConfigOpen(false);
        openSettingsMenu();
      }
      return;
    }
    setConfigOpen(!configIsOpen());
  });
  document.getElementById("openReaderConfig")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsMenu();
    setConfigOpen(true);
  });
  document.getElementById("repairPageBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsMenu();
    askRepairPage();
  });
  document.getElementById("repairVolumeBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsMenu();
    askRepairVolume();
  });
  document.getElementById("readerAskNo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeReaderAsk();
  });
  document.getElementById("readerAskYes")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const fn = readerAskFn;
    closeReaderAsk();
    if (fn) fn();
  });
  document.getElementById("readerAskMask")?.addEventListener("pointerup", (e) => {
    if (e.target && e.target.id === "readerAskMask") closeReaderAsk();
  });
  document.getElementById("backToShelf")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSettingsMenu();
    goToShelf();
  });
  document.getElementById("endAgain")?.addEventListener("click", (e) => {
    e.stopPropagation();
    rereadFromEnd();
  });
  document.getElementById("endNext")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openNextVolume();
  });
  document.getElementById("endHome")?.addEventListener("click", (e) => {
    e.stopPropagation();
    goToShelf();
  });
  if (settingsMenu) {
    settingsMenu.addEventListener("pointerdown", (e) => e.stopPropagation());
  }
  if (settingsCatch) {
    settingsCatch.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    settingsCatch.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsMenu();
      bumpMenus();
    });
  }
  window.addEventListener("resize", placeSettingsMenu);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", placeSettingsMenu);
  }
  document.getElementById("closeMenu").addEventListener("click", () => {
    setConfigOpen(false);
  });
  if (els.configMask) {
    let onMask = false;
    els.configMask.addEventListener("pointerdown", (e) => {
      onMask = e.target === els.configMask;
    });
    els.configMask.addEventListener("pointerup", (e) => {
      if (onMask && e.target === els.configMask) setConfigOpen(false);
      onMask = false;
    });
    if (els.config) {
      els.config.addEventListener("pointerdown", () => {
        onMask = false;
      });
    }
  }

  function toggleBtn(id, key, extra) {
    const node = document.getElementById(id);
    if (!node) return;
    node.addEventListener("click", async () => {
      prefs[key] = !prefs[key];
      applyChrome();
      if (extra) await extra();
      else {
        schedulePersist();
        render({ dir: 0 });
      }
    });
  }

  function bindSwitch(id, key) {
    const node = document.getElementById(id);
    if (!node) return;
    node.addEventListener("change", () => {
      prefs[key] = !!node.checked;
      applyChrome();
      schedulePersist();
      render({ dir: 0 });
    });
  }

  const doublePageButton = document.getElementById("doublePageButton");
  if (doublePageButton) {
    doublePageButton.addEventListener("click", async () => {
      prefs.doublePage = !prefs.doublePage;
      let needReload = false;
      if (prefs.doublePage && !prefs.splitSpreads) {
        prefs.splitSpreads = true;
        needReload = true;
      }
      applyChrome();
      await persistPrefs();
      if (needReload) await reloadBook();
      else render({ dir: 0 });
    });
  }
  toggleBtn("paperTextureButton", "paperTexture");
  toggleBtn("bookFoldButton", "bookFold");
  toggleBtn("lightingButton", "lighting");
  toggleBtn("sidePagesButton", "sidePages");
  toggleBtn("bookShadowButton", "bookShadow");
  toggleBtn("splitSpreadsButton", "splitSpreads", async () => {
    if (!prefs.splitSpreads && prefs.doublePage) {
      prefs.doublePage = false;
    }
    applyChrome();
    await persistPrefs();
    await reloadBook();
  });
  bindSwitch("paperTextureSwitch", "paperTexture");
  bindSwitch("bookFoldSwitch", "bookFold");
  bindSwitch("lightingSwitch", "lighting");

  if (els.pageWidth) els.pageWidth.addEventListener("input", () => {
    prefs.pageWidth = parseInt(els.pageWidth.value, 10) || 90;
    prefs.pageWidthManual = true;
    schedulePersist();
    applyChrome();
    refreshLayoutNavImage();
  });

  window.addEventListener("resize", () => {
    if (leaves.length) refreshLayoutNavImage();
  });
  window.addEventListener("orientationchange", () => {
    if (leaves.length) {
      window.setTimeout(() => refreshLayoutNavImage(), 0);
      window.setTimeout(() => refreshLayoutNavImage(), 250);
    }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (leaves.length) refreshLayoutNavImage();
    });
  }

  if (els.theme) els.theme.addEventListener("change", () => {
    prefs.theme = els.theme.value;
    schedulePersist();
    applyChrome();
  });

  if (els.language) els.language.addEventListener("change", () => {
    prefs.lang = els.language.value === "en" ? "en" : "zh";
    schedulePersist();
    applyChrome();
    if (book?.volume != null) {
      els.volume.textContent = t("volume").replace("{n}", String(book.volume));
    }
  });

  function toggleFs() {
    if (!document.getElementById("fullScreenButton")) return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
  document.getElementById("fullScreenButton")?.addEventListener("click", toggleFs);
  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("isFullscreen", !!document.fullscreenElement);
  });

  const ctx = document.getElementById("readerContext");
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3200);
  }
  function hideContext() {
    ctx?.classList.add("hidden");
  }
  window.addEventListener("contextmenu", (e) => {
    if (!ctx) return;
    // Allow native menu inside inputs / selects
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    e.preventDefault();
    hideMenusNow();
    const pad = 8;
    const w = 180;
    const h = 48;
    let x = e.clientX;
    let y = e.clientY;
    if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
    if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
    ctx.style.left = `${Math.max(pad, x)}px`;
    ctx.style.top = `${Math.max(pad, y)}px`;
    ctx.classList.remove("hidden");
  });
  window.addEventListener("click", hideContext);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideContext();
  });
  document.getElementById("ctxExportPdf")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    hideContext();
    showToast("正在匯出 PDF（大部頭可能要一分鐘）…");
    try {
      const res = await fetch("/api/export-pdf", {
        method: "POST",
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.ok ? "回應格式錯誤" : `HTTP ${res.status}`);
      }
      if (!data.ok) throw new Error(data.error || "匯出失敗");
      showToast(`已存到 PDF 收割夾：${data.name}`);
    } catch (err) {
      const msg = err?.name === "TimeoutError" ? "匯出逾時，請重試" : (err.message || err);
      showToast(`匯出失敗：${msg}`);
    }
  });

  // Load series prefs from disk once, then book (toggles must not re-read prefs)
  await loadSeriesPrefs();
  applyWebLocks();
  applyChrome();
  if (isWebReader()) hideMenusNow();
  else bumpMenus();
  await loadHostDoor();
  await reloadBook({ loadPrefs: true });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    pageZoomClamp,
    pageZoomFromPinch,
    pageZoomCss,
    pageZoomToggleAt,
    isDoubleTap,
    zoomToggleFresh,
    isReaderChromeNode,
    touchAllowsNativePan,
    PAGE_ZOOM_MIN,
    PAGE_ZOOM_MAX,
    PAGE_ZOOM_TAP,
    TAP_DOUBLE_MS,
    TAP_DOUBLE_SLOP,
    ZOOM_TOGGLE_GAP,
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  main().catch((err) => {
    console.error(err);
    const loader = document.getElementById("loaderContainer");
    if (loader) {
      loader.innerHTML = `<p style="color:#e08080;padding:2em;text-align:center">${err}</p>`;
    }
  });
}
