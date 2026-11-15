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
      getContext() { return {scale() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {}, fillText() {}, fillRect() {}}; }
    };
  }
  function getElement(id) {
    if (!elements.has(id)) elements.set(id, fakeElement(id));
    return elements.get(id);
  }
  const navButtons = ['overview', 'history', 'outages', 'network', 'settings'].map(view => {
    const button = fakeElement('nav-' + view);
    button.dataset.view = view;
    return button;
  });
  const statsButtons = ['24h','7d','30d','90d','1y','all'].map(period => {
    const button = fakeElement('stats-period-'+period);
    button.dataset.statsPeriod = period;
    return button;
  });
  const networkButtons = ['24h','7d','30d','90d','1y','all'].map(period => {
    const button=fakeElement('network-'+period);button.dataset.networkPeriod=period;return button;
  });
  const views = ['overview', 'history', 'outages', 'network', 'settings'].map(view => getElement('view-' + view));
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    getElementById: getElement,
    createElement: () => fakeElement(),
    querySelectorAll(selector) {
      if (selector === '[data-view]') return navButtons;
      if (selector === '[data-stats-period]') return statsButtons;
      if (selector === '[data-network-period]') return networkButtons;
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
      period: '30d', samples: 0, probe_samples: 0, uptime: null,
      outages: 0, first_sample: null,
      download: {}, upload: {}, ping: {}, jitter: {}
    },
    '/api/network/usage': {
      period: '30d',available: true,interfaces: ['br0'],selected_interface: 'auto',interface: 'br0',
      sample_count: 2,first_sample: '2026-11-15T12:00:00+00:00',last_sample: '2026-11-15T12:10:00+00:00',
      download_bytes: 2000000000,upload_bytes: 1000000000,total_bytes: 3000000000,
      month_total_bytes: 3000000000,average_daily_bytes: 4000000000,
      monthly_limit_gb: 0, buckets: [{bucket: '2026-11-15',download_bytes: 2000000000,upload_bytes: 1000000000}]
    },
    '/api/results': {results: []},
    '/api/outages': {outages: []}
  };
  const fetch = async url => {
    const route = String(url).split('?')[0];
    calls.push(String(url));
    assert.ok(Object.hasOwn(dataByRoute, route), 'Unexpected API request: ' + url);
    const payload=route==='/api/statistics' && String(url).includes('period=1y')
      ? {...dataByRoute[route],period:'1y',samples:12,uptime:99.5,outages:3,first_sample:'2026-10-30T00:00:00+00:00'}
      : dataByRoute[route];
    return {ok: true, status: 200, json: async () => payload};
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
  assert.ok(calls.some(url => url.startsWith('/api/history')));
  assert.ok(calls.includes('/api/statistics?period=30d'));
  assert.equal(getElement('connection-pill').lastChild.textContent, 'Online');
  navButtons[1].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(getElement('view-history').classList.contains('visible'));
  assert.ok(calls.includes('/api/results'));
  statsButtons[4].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes('/api/statistics?period=1y'));
  assert.equal(getElement('stats-test-count').textContent, '12 successful tests in selected period');
  assert.equal(getElement('uptime').textContent, '99.50');
  assert.equal(getElement('outages-count').textContent, '3');
  assert.equal(getElement('uptime-period-label').textContent, '· LAST YEAR');
  assert.ok(statsButtons[4].classList.contains('selected'));

  navButtons[3].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(getElement('view-network').classList.contains('visible'));
  assert.ok(calls.includes('/api/network/usage?period=30d'));
  assert.equal(getElement('network-active-interface').textContent, 'Monitoring br0');
  assert.equal(getElement('network-total').textContent, '3.00');
  assert.equal(getElement('network-total-unit').textContent, 'GB');
  assert.equal(getElement('network-month').textContent, '3.00');
  networkButtons[4].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes('/api/network/usage?period=1y'));
  assert.ok(networkButtons[4].classList.contains('selected'));
});
