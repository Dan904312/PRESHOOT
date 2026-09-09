/**
 * Minimal DOM + globals harness that boots the real js/studio.js and
 * js/studio-ui.js inside a VM so Studio navigation can be exercised
 * functionally (render -> read the rendered back button -> run its handler).
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function makeEl(id) {
  const el = {
    id: id || '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    value: '',
    style: {},
    dataset: {},
    classes: {},
    children: [],
    classList: {
      add: function (c) {
        el.classes[c] = true;
      },
      remove: function (c) {
        delete el.classes[c];
      },
      contains: function (c) {
        return !!el.classes[c];
      },
      toggle: function (c) {
        el.classes[c] = !el.classes[c];
      }
    },
    setAttribute: function (k, v) {
      el.dataset[k] = v;
    },
    getAttribute: function (k) {
      return el.dataset[k] == null ? null : el.dataset[k];
    },
    removeAttribute: function (k) {
      delete el.dataset[k];
    },
    appendChild: function (c) {
      el.children.push(c);
      return c;
    },
    insertAdjacentHTML: function (_pos, html) {
      el.innerHTML += html;
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    focus: function () {},
    scrollIntoView: function () {},
    querySelector: function (sel) {
      return el.innerHTML.indexOf(String(sel).replace(/^[.#]/, '')) >= 0 ? makeEl('') : null;
    },
    querySelectorAll: function () {
      return [];
    },
    closest: function () {
      return null;
    }
  };
  return el;
}

export function bootStudio(options) {
  options = options || {};
  const store = Object.create(null);
  const els = Object.create(null);
  const toasts = [];

  function el(id) {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  }

  const documentStub = {
    documentElement: makeEl('html'),
    body: makeEl('body'),
    getElementById: function (id) {
      if (id === 'studio-root' || options.allElements) return el(id);
      return els[id] || null;
    },
    querySelector: function () {
      return null;
    },
    querySelectorAll: function () {
      return [];
    },
    createElement: function (tag) {
      return makeEl(tag);
    },
    addEventListener: function () {},
    removeEventListener: function () {}
  };

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: function (fn) {
      if (typeof fn === 'function') sandbox.__pendingTimers.push(fn);
      return 0;
    },
    clearTimeout: function () {},
    setInterval: function () {
      return 0;
    },
    clearInterval: function () {},
    __pendingTimers: [],
    document: documentStub,
    navigator: { userAgent: 'node', onLine: true },
    localStorage: {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: function (k, v) {
        store[k] = String(v);
      },
      removeItem: function (k) {
        delete store[k];
      }
    },
    alert: function () {},
    confirm: function () {
      return true;
    },
    prompt: function () {
      return null;
    },
    toast: function (m) {
      toasts.push(String(m));
    },
    showToast: function (m) {
      toasts.push(String(m));
    },
    openM: function () {},
    closeM: function () {},
    goTab: function (t) {
      sandbox.S.tab = t;
      if (t === 'studio' && sandbox.PreShootStudioUI) sandbox.PreShootStudioUI.renderStudio();
    },
    /* app.html defines these globally; mirror them so storage-backed
     * navigation context behaves the same way it does in the browser. */
    gs: function (k, fallback) {
      try {
        const raw = sandbox.localStorage.getItem('scout_' + k);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    ss: function (k, v) {
      try {
        sandbox.localStorage.setItem('scout_' + k, JSON.stringify(v));
      } catch (e) {}
    },
    renderHome: function () {},
    renderContinueCard: function () {},
    renderLib: function () {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.S = {
    tab: 'studio',
    plan: 'pro',
    prefs: {},
    niche: {},
    studioView: { mode: 'list' },
    activeProductionId: null
  };

  vm.createContext(sandbox);
  ['js/studio.js', 'js/studio-ui.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  });

  return {
    sandbox: sandbox,
    S: sandbox.S,
    Studio: sandbox.PreShootStudio,
    UI: sandbox.PreShootStudioUI,
    toasts: toasts,
    studioHtml: function () {
      return el('studio-root').innerHTML;
    },
    flushTimers: function () {
      const q = sandbox.__pendingTimers.splice(0, sandbox.__pendingTimers.length);
      q.forEach(function (fn) {
        try {
          fn();
        } catch (e) {}
      });
    },
    /** Pull the onclick handler of the rendered header back button and run it. */
    clickBack: function () {
      const html = el('studio-root').innerHTML;
      const m = html.match(/class="studio-back"[^>]*onclick="([^"]+)"/);
      if (!m) throw new Error('no studio-back button rendered');
      const code = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      vm.runInContext(code, sandbox, { filename: 'back-click' });
      return code;
    },
    backButtonHtml: function () {
      const html = el('studio-root').innerHTML;
      const m = html.match(/<button[^>]*class="studio-back"[^>]*>/);
      return m ? m[0] : '';
    },
    crumbHtml: function () {
      const html = el('studio-root').innerHTML;
      const m = html.match(/<nav class="st-crumb"[\s\S]*?<\/nav>/);
      return m ? m[0] : '';
    }
  };
}

export function seedProjects(h) {
  const p1 = h.Studio.createProject({ name: 'Throwaway Campaign A' });
  const p2 = h.Studio.createProject({ name: 'Throwaway Campaign B' });
  const a1 = h.Studio.createProduction(p1.id, { name: 'A Video One' }).production;
  const a2 = h.Studio.createProduction(p1.id, { name: 'A Video Two' }).production;
  const b1 = h.Studio.createProduction(p2.id, { name: 'B Video One' }).production;
  return { p1: p1, p2: p2, a1: a1, a2: a2, b1: b1 };
}
