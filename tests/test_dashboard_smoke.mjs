import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(projectRoot, 'app/static/app.js'), 'utf8');

test('dashboard loads, fetches live data and registers navigation clicks', async () => {
  const elements = new Map();
  const calls = [];
  const documentHandlers = new Map();
  function fakeElement(id = '') {
    const listeners = new Map();
    const classes = new Set(id === 'view-overview' ? ['visible'] : []);
    return {
      id,
      dataset: {},
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, force) => {
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
        },
        contains: name => classes.has(name)
      },
      style: {},
      lastChild: {textContent: ''},
      parentElement: {},
      textContent: '',
      value: '',
      disabled: false,
      checked: false,
      addEventListener(type, listener) { listeners.set(type, listener); },
      click() { listeners.get('click')?.(); },
      append() {},
      replaceChildren() {},
      getBoundingClientRect() { return {width: 500, height: 250, left: 0}; },
      getContext() { return {scale() {}, clearRect() {}}; }
    };
  }
  function getElement(id) {
    if (!elements.has(id)) elements.set(id, fakeElement(id));
    return elements.get(id);
  }
  const navButtons = ['overview', 'history', 'outages', 'settings'].map(view => {
    const button = fakeElement('nav-' + view);
    button.dataset.view = view;
    return button;
  });
  const views = ['overview', 'history', 'outages', 'settings'].map(view => getElement('view-' + view));
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    getElementById: getElement,
    createElement: () => fakeElement(),
    querySelectorAll(selector) {
      if (selector === '[data-view]') return navButtons;
      if (selector === '.view') return views;
      return [];
    },
    addEventListener(type, listener) { documentHandlers.set(type, listener); }
  };
  const window = {
    GBM_I18N: {
      locale: 'en',
      async init() {},
      t(message, values = {}) {
        return message.replace(/\{([a-z]+)\}/gi, (match, key) => String(values[key] ?? match));
      }
    },
    scrollTo() {},
    devicePixelRatio: 1
  };
  const dataByRoute = {
    '/api/status': {
      online: true, latest: null, last_probe: null, current_outage: null,
      uptime30: null, outages30: 0, speed_samples: 0,
      probe_interval: 30, speed_interval: 60, slow_threshold: 100,
      running: false, alert_outage: true, alert_restored: true, alert_slow: false,
      alerts_configured: false, last_attempt: null
    },
    '/api/history': {points: []},
    '/api/statistics': {
      samples: 0, download: {}, upload: {}, ping: {}, jitter: {}
    },
    '/api/results': {results: []},
    '/api/outages': {outages: []}
  };
  const fetch = async url => {
    const route = String(url).split('?')[0];
    calls.push(route);
    assert.ok(Object.hasOwn(dataByRoute, route), 'Unexpected API request: ' + url);
    return {ok: true, status: 200, json: async () => dataByRoute[route]};
  };
  const sandbox = {
    document, window, fetch, Date, Intl,
    ResizeObserver: class { observe() {} },
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame(callback) { callback(); }
  };

  // A loose identifier or other top-level runtime error would prevent
  // registration of DOMContentLoaded and leave every dashboard control dead.
  assert.doesNotThrow(() => vm.runInNewContext(source, sandbox));
  assert.equal(typeof documentHandlers.get('DOMContentLoaded'), 'function');
  await documentHandlers.get('DOMContentLoaded')();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(calls.includes('/api/status'));
  assert.ok(calls.includes('/api/history'));
  assert.ok(calls.includes('/api/statistics'));
  assert.equal(getElement('connection-pill').lastChild.textContent, 'Online');
  navButtons[1].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(getElement('view-history').classList.contains('visible'));
  assert.ok(calls.includes('/api/results'));
});
