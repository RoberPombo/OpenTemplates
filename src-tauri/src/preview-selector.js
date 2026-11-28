/* oxlint-disable */
/*
 * Selector de elemento de OpenTemplates, inyectado por el proxy propio en las
 * respuestas HTML del preview. Corre en el origen del proxy (loopback).
 *
 * Seguridad:
 * - Solo acepta comandos del padre verificado: `event.origin === PARENT_ORIGIN`,
 *   `event.source === window.parent`, `nonce` por sesión, `source`, `version`.
 * - Solo envía datos a `PARENT_ORIGIN` con `targetOrigin` exacto (nunca '*').
 * - No ejecuta nada del contenido de la página; el payload son datos recortados.
 * - No toca IPC de Tauri; el contenido remoto sigue sin acceso a la app.
 */
(function () {
  if (window.__OT_PREVIEW_SELECTOR__) return;
  window.__OT_PREVIEW_SELECTOR__ = true;

  var cfg = window.__OT_PREVIEW__ || {};
  var SOURCE = "opentemplates-preview-selector";
  var VERSION = 1;
  // Configuración sin <script> inline (CSP `script-src 'self'`): query propio.
  var selfSrc = (document.currentScript && document.currentScript.src) || "";
  function srcParam(name) {
    try {
      return new URL(selfSrc).searchParams.get(name) || "";
    } catch (e) {
      return "";
    }
  }
  var PARENT_ORIGIN =
    (typeof cfg.parentOrigin === "string" && cfg.parentOrigin) || srcParam("parentOrigin");
  var PROXY_ORIGIN =
    (typeof cfg.proxyOrigin === "string" && cfg.proxyOrigin) ||
    srcParam("proxyOrigin") ||
    window.location.origin;
  var NONCE = (typeof cfg.nonce === "string" && cfg.nonce) || srcParam("nonce");
  var ORIGINAL_URL =
    (typeof cfg.originalUrl === "string" && cfg.originalUrl) || srcParam("originalUrl");

  var MAX_TEXT = 200;
  var MAX_SELECTOR = 300;
  var MAX_NAME = 160;
  var MAX_STYLE = 80;

  // Subconjunto curado de estilos computados; no es un volcado completo de CSS.
  var STYLE_PROPS = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "width",
    "height",
    "margin",
    "padding",
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "border",
    "border-radius",
    "z-index",
    "overflow",
    "flex-direction",
    "gap",
  ];

  // Roles ARIA implícitos curados (subconjunto pequeño y estable).
  var IMPLICIT_ROLES = {
    button: "button",
    a: "link",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    aside: "complementary",
    form: "form",
    img: "img",
    ul: "list",
    ol: "list",
    li: "listitem",
    table: "table",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
  };

  var active = false;
  var overlay = null;
  var highlighted = null;

  function clip(value, max) {
    var s = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return "\\" + c;
    });
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  // Atributos considerados estables para anclar el selector.
  var STABLE_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa", "aria-label", "name"];

  function buildSelector(el) {
    if (!(el instanceof Element)) return "";
    var tag = el.tagName.toLowerCase();

    // 1. id único.
    if (el.id) {
      var byId = "#" + cssEscape(el.id);
      if (isUnique(byId)) return clip(byId, MAX_SELECTOR);
    }

    // 2. atributos estables únicos.
    for (var i = 0; i < STABLE_ATTRS.length; i++) {
      var attr = STABLE_ATTRS[i];
      var val = el.getAttribute(attr);
      if (val) {
        var sel = tag + "[" + attr + '="' + cssEscape(val) + '"]';
        if (isUnique(sel)) return clip(sel, MAX_SELECTOR);
      }
    }

    // 3. camino tag:nth-of-type, acortado si ya es único.
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== "html") {
      var t = node.tagName.toLowerCase();
      var part = t;
      var parent = node.parentElement;
      if (parent) {
        var sameTag = 0;
        var index = 0;
        for (var j = 0; j < parent.children.length; j++) {
          if (parent.children[j].tagName.toLowerCase() === t) {
            sameTag++;
            if (parent.children[j] === node) index = sameTag;
          }
        }
        if (sameTag > 1) part += ":nth-of-type(" + index + ")";
      }
      parts.unshift(part);
      var candidate = parts.join(" > ");
      if (isUnique(candidate)) break;
      node = parent;
    }
    return clip(parts.join(" > "), MAX_SELECTOR);
  }

  function roleOf(el) {
    var explicit = el.getAttribute("role");
    if (explicit) return clip(explicit, MAX_NAME);
    var tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "img") return el.getAttribute("alt") ? "img" : null;
    return IMPLICIT_ROLES[tag] || null;
  }

  function nameOf(el) {
    var aria = el.getAttribute("aria-label");
    if (aria) return clip(aria, MAX_NAME);
    var labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      var ref = document.getElementById(labelledby);
      if (ref) return clip(ref.textContent || "", MAX_NAME);
    }
    if (el.tagName.toLowerCase() === "img") {
      var alt = el.getAttribute("alt");
      if (alt) return clip(alt, MAX_NAME);
    }
    var title = el.getAttribute("title");
    if (title) return clip(title, MAX_NAME);
    return null;
  }

  function stylesOf(el) {
    var out = {};
    var computed;
    try {
      computed = window.getComputedStyle(el);
    } catch (e) {
      return out;
    }
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var prop = STYLE_PROPS[i];
      var value = computed.getPropertyValue(prop);
      if (value != null && value !== "") out[prop] = clip(value, MAX_STYLE);
    }
    return out;
  }

  function rectOf(el) {
    try {
      var r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      };
    } catch (e) {
      return null;
    }
  }

  function currentPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function elementContext(el) {
    return {
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      selector: buildSelector(el),
      name: nameOf(el),
      text: clip(el.textContent || "", MAX_TEXT),
      url: currentPath(),
      rect: rectOf(el),
      computedStyles: stylesOf(el),
    };
  }

  function post(type, extra) {
    if (!PARENT_ORIGIN) return;
    var msg = { source: SOURCE, version: VERSION, type: type, nonce: NONCE };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
      }
    }
    try {
      window.parent.postMessage(msg, PARENT_ORIGIN);
    } catch (e) {
      /* noop */
    }
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.setAttribute("data-ot-selector-overlay", "");
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.border = "2px solid #2563eb";
    overlay.style.background = "rgba(37,99,235,0.12)";
    overlay.style.borderRadius = "2px";
    overlay.style.display = "none";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "0";
    overlay.style.height = "0";
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  function placeHighlight(el) {
    var o = ensureOverlay();
    if (!el || !(el instanceof Element) || el === o) {
      o.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    o.style.display = "block";
    o.style.top = r.top + "px";
    o.style.left = r.left + "px";
    o.style.width = r.width + "px";
    o.style.height = r.height + "px";
    highlighted = el;
  }

  function onMove(ev) {
    if (!active) return;
    var target = ev.target;
    if (target && target.getAttribute && target.getAttribute("data-ot-selector-overlay") != null)
      return;
    placeHighlight(target);
  }

  function onClick(ev) {
    if (!active) return;
    var target = ev.target;
    if (target && target.getAttribute && target.getAttribute("data-ot-selector-overlay") != null)
      return;
    // No romper la navegación normal fuera del modo; dentro, capturar sin actuar.
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
    if (target instanceof Element) post("element", { element: elementContext(target) });
  }

  // Bloquear activación/navegación en captura mientras se selecciona.
  function onActivationGuard(ev) {
    if (!active) return;
    if (ev.type === "submit" || ev.type === "keydown") {
      // Escape se gestiona aparte; el resto se suprime en modo selección.
      if (ev.type === "keydown" && ev.key !== "Escape" && ev.key !== "Enter" && ev.key !== " ")
        return;
    }
    var target = ev.target;
    if (target && target.getAttribute && target.getAttribute("data-ot-selector-overlay") != null)
      return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
  }

  function onKeyDown(ev) {
    if (!active) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      exit();
      post("exit");
    }
  }

  function enter() {
    if (active) return;
    active = true;
    document.documentElement.setAttribute("data-ot-selecting", "");
    ensureOverlay();
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onActivationGuard, true);
    document.addEventListener("mouseup", onActivationGuard, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("submit", onActivationGuard, true);
  }

  function exit() {
    if (!active) return;
    active = false;
    document.documentElement.removeAttribute("data-ot-selecting");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", onActivationGuard, true);
    document.removeEventListener("mouseup", onActivationGuard, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("submit", onActivationGuard, true);
    if (overlay) overlay.style.display = "none";
    highlighted = null;
  }

  // Comandos solo del padre verificado, con nonce y esquema.
  window.addEventListener("message", function (ev) {
    if (ev.origin !== PARENT_ORIGIN) return;
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.source !== SOURCE || d.version !== VERSION) return;
    if (d.nonce !== NONCE) return;
    if (d.type === "enter") enter();
    else if (d.type === "exit") exit();
  });

  // Cursor en modo selección.
  var style = document.createElement("style");
  style.setAttribute("data-ot-selector-style", "");
  style.textContent =
    "html[data-ot-selecting], html[data-ot-selecting] * { cursor: crosshair !important; }";
  (document.head || document.documentElement).appendChild(style);

  post("ready", { url: currentPath(), originalUrl: ORIGINAL_URL });
})();
