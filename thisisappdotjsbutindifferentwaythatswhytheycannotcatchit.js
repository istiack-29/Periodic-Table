'use strict';

/* ============================================================
   CONSTANTS & CONFIGURATION
============================================================ */

const CONFIG = {
  DATA_BASE: './data',
  MANIFEST: './data/manifest.json',
  CACHE_VERSION: 'qe-v1',
  MAX_RECENT: 10,
  MAX_FAVORITES: 50,
  SEARCH_DEBOUNCE_MS: 180,
  LOAD_STATUS_MESSAGES: [
    'Initializing quantum lattice…',
    'Loading element manifests…',
    'Parsing atomic structures…',
    'Calibrating electron shells…',
    'Rendering periodic matrix…',
    'Synchronizing multilingual data…',
    'Activating holographic layers…',
    'Quantum Elements ready.',
  ],
  CATEGORY_CLASSES: {
    'reactive nonmetal':       'cat-reactive-nonmetal',
    'noble gas':               'cat-noble-gas',
    'alkali metal':            'cat-alkali-metal',
    'alkaline earth metal':    'cat-alkaline-earth',
    'metalloid':               'cat-metalloid',
    'post-transition metal':   'cat-post-transition',
    'transition metal':        'cat-transition-metal',
    'lanthanide':              'cat-lanthanide',
    'actinide':                'cat-actinide',
    'unknown':                 'cat-unknown',
  },
  CATEGORY_COLORS: {
    'reactive nonmetal':     '#4ade80',
    'noble gas':             '#a78bfa',
    'alkali metal':          '#f87171',
    'alkaline earth metal':  '#fb923c',
    'metalloid':             '#34d399',
    'post-transition metal': '#60a5fa',
    'transition metal':      '#facc15',
    'lanthanide':            '#f472b6',
    'actinide':              '#e879f9',
    'unknown':               '#94a3b8',
  },
};

/* ============================================================
   STATE
============================================================ */

const STATE = {
  lang: localStorage.getItem('qe-lang') || 'en',
  theme: localStorage.getItem('qe-theme') || 'dark',
  elements: [],
  elementMap: new Map(),
  activeFilter: 'all',
  currentElement: null,
  activeTab: 'overview',
  favorites: JSON.parse(localStorage.getItem('qe-favorites') || '[]'),
  recent: JSON.parse(localStorage.getItem('qe-recent') || '[]'),
  compareSlots: [null, null],
  quizState: { questions: [], current: 0, score: 0, answered: false, selectedOption: -1 },
  tableZoom: 1,
  atomAnimation: { running: true, frame: null, spin: true },
  learningMode: 'flashcard',
  flashcardIndex: 0,
  searchQuery: '',
};

/* ============================================================
   UTILITY HELPERS
============================================================ */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function t(obj) {
  if (!obj || typeof obj !== 'object') return obj ?? '';
  return obj[STATE.lang] ?? obj['en'] ?? '';
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function categoryKey(element) {
  const cat = (element.basicInformation?.category?.en || '').toLowerCase();
  for (const key of Object.keys(CONFIG.CATEGORY_CLASSES)) {
    if (cat.includes(key)) return key;
  }
  return 'unknown';
}

function categoryClass(element) {
  return CONFIG.CATEGORY_CLASSES[categoryKey(element)] || 'cat-unknown';
}

function categoryColor(element) {
  return CONFIG.CATEGORY_COLORS[categoryKey(element)] || CONFIG.CATEGORY_COLORS['unknown'];
}

function saveLocal(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

function showToast(message, type = 'info', duration = 3000) {
  const container = $('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

/* ============================================================
   DETAILED ERROR DISPLAY (নতুন — স্ক্রিনে এরর দেখাবে)
============================================================ */

function showDetailedError(title, details, hint = '') {
  // লোডিং স্ক্রিনে এরর বার্তা আপডেট করে
  const statusEl = $('#loading-status-text');
  const fillEl = $('#loading-progress-fill');

  if (fillEl) {
    fillEl.style.background = '#f87171';
    fillEl.style.width = '100%';
  }

  if (statusEl) {
    statusEl.style.color = '#f87171';
    statusEl.innerHTML = `
      <div style="text-align:left; max-width:340px; margin:0 auto;">
        <strong style="font-size:1rem;">❌ ${title}</strong><br><br>
        <code style="font-size:0.75rem; white-space:pre-wrap; display:block; background:rgba(255,0,0,0.1); padding:8px; border-radius:6px; margin-bottom:8px;">${details}</code>
        ${hint ? `<span style="font-size:0.75rem; color:#94a3b8;">💡 ${hint}</span>` : ''}
      </div>
    `;
  }

  // কনসোলেও লগ করো
  console.error(`[QuantumElements] ${title}:`, details);
}

/* ============================================================
   DATA ENGINE — রিফাইন্ড ও ডিটেইলড এরর সহ
============================================================ */

const DataEngine = (() => {
  const cache = new Map();

  async function fetchWithRetry(url, retries = 2, delay = 400) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`[Fetch] চেষ্টা ${i + 1}/${retries}: ${url}`);
        const res = await fetch(url, { cache: 'no-store' });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} — ${res.statusText} (URL: ${url})`);
        }

        const text = await res.text();

        // JSON পার্স করার আগে যাচাই
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          throw new Error(
            `JSON পার্স এরর (URL: ${url})\n` +
            `এরর: ${parseErr.message}\n` +
            `ফাইলের শুরু: ${text.substring(0, 100)}...`
          );
        }

        console.log(`[Fetch] সফল: ${url}`);
        return data;

      } catch (err) {
        lastError = err;
        console.warn(`[Fetch] ব্যর্থ চেষ্টা ${i + 1}: ${err.message}`);
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, delay * (i + 1)));
        }
      }
    }
    // সব চেষ্টা ব্যর্থ হলে
    throw lastError;
  }

  async function fetchElement(id) {
    if (cache.has(id)) return cache.get(id);
    const url = `${CONFIG.DATA_BASE}/${id}.json`;
    const data = await fetchWithRetry(url);

    // ডেটা ভ্যালিডেশন
    if (!data || typeof data !== 'object') {
      throw new Error(`${url} থেকে invalid ডেটা পেয়েছি। Object expected, পেয়েছি: ${typeof data}`);
    }
    if (!data.basicInformation) {
      throw new Error(
        `${url} এ "basicInformation" field নেই!\n` +
        `পাওয়া fields: ${Object.keys(data).join(', ')}`
      );
    }
    if (!data.basicInformation.atomicNumber) {
      throw new Error(`${url} এ "basicInformation.atomicNumber" নেই!`);
    }

    cache.set(id, data);
    return data;
  }

  async function loadManifest() {
    console.log(`[Manifest] লোড হচ্ছে: ${CONFIG.MANIFEST}`);
    try {
      const manifest = await fetchWithRetry(CONFIG.MANIFEST);

      if (!manifest || typeof manifest !== 'object') {
        throw new Error(`manifest.json invalid: Object expected, পেয়েছি: ${typeof manifest}`);
      }
      if (!Array.isArray(manifest.elements)) {
        throw new Error(
          `manifest.json এ "elements" array নেই!\n` +
          `পাওয়া keys: ${Object.keys(manifest).join(', ')}\n` +
          `Expected format: { "elements": [1, 2, 3, ...] }`
        );
      }
      if (manifest.elements.length === 0) {
        throw new Error(`manifest.json এ "elements" array টি খালি! কমপক্ষে একটি element ID দিন।`);
      }

      console.log(`[Manifest] সফল! ${manifest.elements.length}টি element ID পাওয়া গেছে:`, manifest.elements);
      return manifest.elements;

    } catch (err) {
      // manifest লোড না হলে detailed error দেখাও
      throw new Error(`manifest.json লোড করা যায়নি:\n${err.message}`);
    }
  }

  async function loadAllElements(onProgress) {
    const ids = await loadManifest();
    const total = ids.length;
    const results = [];
    const errors = [];

    console.log(`[DataEngine] মোট ${total}টি element লোড হবে:`, ids);

    const BATCH = 10;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const loaded = await Promise.allSettled(batch.map(id => fetchElement(id)));

      loaded.forEach((r, batchIdx) => {
        const id = batch[batchIdx];
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
          console.log(`[DataEngine] ✅ Element #${id} লোড সফল`);
        } else {
          const errMsg = r.reason?.message || 'অজানা এরর';
          errors.push({ id, error: errMsg });
          console.error(`[DataEngine] ❌ Element #${id} লোড ব্যর্থ:`, errMsg);
        }
      });

      const progress = Math.round(((i + batch.length) / total) * 100);
      if (onProgress) onProgress(progress, Math.min(i + BATCH, total), total);
    }

    // কিছু element লোড হয়নি — কিন্তু মোটামুটি কাজ করবে
    if (errors.length > 0 && results.length === 0) {
      const errorSummary = errors.map(e => `• Element #${e.id}: ${e.error}`).join('\n');
      throw new Error(
        `কোনো element লোড হয়নি!\n\n` +
        `ব্যর্থ elements:\n${errorSummary}\n\n` +
        `সম্ভাব্য কারণ:\n` +
        `• data/ ফোল্ডারে JSON ফাইল নেই\n` +
        `• ফাইলের নাম ভুল (হওয়া উচিত: 1.json, 2.json, ...)\n` +
        `• JSON ফরম্যাটে সমস্যা আছে`
      );
    }

    if (errors.length > 0) {
      console.warn(`[DataEngine] ${errors.length}টি element লোড হয়নি, কিন্তু ${results.length}টি সফল।`);
      showToast(`${errors.length}টি element লোড হয়নি। Console দেখুন।`, 'warning', 5000);
    }

    return results.sort((a, b) =>
      (a.basicInformation?.atomicNumber || 0) - (b.basicInformation?.atomicNumber || 0)
    );
  }

  return { loadAllElements, fetchElement };
})();

/* ============================================================
   LOADING SCREEN
============================================================ */

function updateLoader(progress, loaded, total) {
  const fill = $('#loading-progress-fill');
  const status = $('#loading-status-text');
  const track = $('.loading-progress-track');

  if (fill) fill.style.width = `${progress}%`;
  if (track) track.setAttribute('aria-valuenow', progress);

  const msgIdx = Math.floor((progress / 100) * (CONFIG.LOAD_STATUS_MESSAGES.length - 1));
  if (status) status.textContent = CONFIG.LOAD_STATUS_MESSAGES[msgIdx] || `লোড হচ্ছে ${loaded}/${total} elements…`;
}

function hideLoader() {
  const screen = $('#loading-screen');
  if (!screen) return;
  screen.classList.add('loading-screen--done');
  setTimeout(() => { screen.hidden = true; screen.remove(); }, 900);
}

/* ============================================================
   PERIODIC TABLE ENGINE
============================================================ */

const ELEMENT_POSITIONS = (() => {
  const pos = {};
  const layout = [
    [1,1,1], [2,1,18],
    [3,2,1],[4,2,2],[5,2,13],[6,2,14],[7,2,15],[8,2,16],[9,2,17],[10,2,18],
    [11,3,1],[12,3,2],[13,3,13],[14,3,14],[15,3,15],[16,3,16],[17,3,17],[18,3,18],
    [19,4,1],[20,4,2],[21,4,3],[22,4,4],[23,4,5],[24,4,6],[25,4,7],[26,4,8],[27,4,9],[28,4,10],[29,4,11],[30,4,12],[31,4,13],[32,4,14],[33,4,15],[34,4,16],[35,4,17],[36,4,18],
    [37,5,1],[38,5,2],[39,5,3],[40,5,4],[41,5,5],[42,5,6],[43,5,7],[44,5,8],[45,5,9],[46,5,10],[47,5,11],[48,5,12],[49,5,13],[50,5,14],[51,5,15],[52,5,16],[53,5,17],[54,5,18],
    [55,6,1],[56,6,2],[57,6,3],[72,6,4],[73,6,5],[74,6,6],[75,6,7],[76,6,8],[77,6,9],[78,6,10],[79,6,11],[80,6,12],[81,6,13],[82,6,14],[83,6,15],[84,6,16],[85,6,17],[86,6,18],
    [87,7,1],[88,7,2],[89,7,3],[104,7,4],[105,7,5],[106,7,6],[107,7,7],[108,7,8],[109,7,9],[110,7,10],[111,7,11],[112,7,12],[113,7,13],[114,7,14],[115,7,15],[116,7,16],[117,7,17],[118,7,18],
  ];
  layout.forEach(([num, row, col]) => { pos[num] = { row, col }; });
  return pos;
})();

const LANTHANIDE_RANGE = [57,58,59,60,61,62,63,64,65,66,67,68,69,70,71];
const ACTINIDE_RANGE   = [89,90,91,92,93,94,95,96,97,98,99,100,101,102,103];

function buildElementBlock(element, compact = false) {
  const info = element.basicInformation;
  const num = info?.atomicNumber;
  const catClass = categoryClass(element);
  const color = categoryColor(element);
  const name = t(info?.name) || '';
  const symbol = info?.symbol || '';
  const mass = info?.atomicMass != null ? parseFloat(info.atomicMass).toFixed(3) : '';
  const isRadioactive = info?.radioactive ? ' element-block--radioactive' : '';

  const block = document.createElement('div');
  block.className = `element-block ${catClass}${isRadioactive}${compact ? ' element-block--compact' : ''}`;
  block.setAttribute('role', 'gridcell');
  block.setAttribute('tabindex', '0');
  block.setAttribute('data-element-id', element.elementId || num);
  block.setAttribute('data-atomic-number', num);
  block.setAttribute('data-symbol', symbol);
  block.setAttribute('data-category', categoryKey(element));
  block.setAttribute('data-period', info?.period || '');
  block.setAttribute('data-group', info?.group || '');
  block.setAttribute('aria-label', `${name}, atomic number ${num}`);
  block.style.setProperty('--element-color', color);

  block.innerHTML = `
    <span class="element-block__number">${num}</span>
    <span class="element-block__symbol">${symbol}</span>
    <span class="element-block__name">${name}</span>
    ${!compact ? `<span class="element-block__mass">${mass}</span>` : ''}
    <div class="element-block__glow" aria-hidden="true"></div>
  `;

  return block;
}

function renderGroupNumbers() {
  const container = $('#table-group-numbers');
  if (!container) return;
  container.innerHTML = '';
  const spacer = document.createElement('div');
  spacer.className = 'table-group-number table-group-number--spacer';
  container.appendChild(spacer);
  for (let g = 1; g <= 18; g++) {
    const el = document.createElement('div');
    el.className = 'table-group-number';
    el.textContent = g;
    container.appendChild(el);
  }
}

function renderPeriodNumbers() {
  const container = $('#table-period-numbers');
  if (!container) return;
  container.innerHTML = '';
  for (let p = 1; p <= 7; p++) {
    const el = document.createElement('div');
    el.className = 'table-period-number';
    el.setAttribute('data-period', p);
    el.textContent = p;
    container.appendChild(el);
  }
}

function renderPeriodicTable() {
  const grid = $('#periodic-table-grid');
  if (!grid) return;

  const frag = document.createDocumentFragment();

  const cells = {};
  for (let row = 1; row <= 7; row++) {
    for (let col = 1; col <= 18; col++) {
      const cell = document.createElement('div');
      cell.className = 'table-cell';
      cell.style.gridRow = row;
      cell.style.gridColumn = col;
      cell.setAttribute('data-row', row);
      cell.setAttribute('data-col', col);
      cells[`${row}-${col}`] = cell;
      frag.appendChild(cell);
    }
  }

  const lanthSet = new Set(LANTHANIDE_RANGE);
  const actSet = new Set(ACTINIDE_RANGE);

  STATE.elements.forEach(element => {
    const num = element.basicInformation?.atomicNumber;
    if (lanthSet.has(num) || actSet.has(num)) return;
    const pos = ELEMENT_POSITIONS[num];
    if (!pos) return;
    const key = `${pos.row}-${pos.col}`;
    if (cells[key]) {
      const block = buildElementBlock(element);
      cells[key].appendChild(block);
    }
  });

  grid.appendChild(frag);

  const lanthanideContainer = $('#lanthanide-cells');
  if (lanthanideContainer) {
    lanthanideContainer.innerHTML = '';
    const lfrag = document.createDocumentFragment();
    LANTHANIDE_RANGE.forEach(num => {
      const element = STATE.elementMap.get(num);
      if (element) lfrag.appendChild(buildElementBlock(element, true));
    });
    lanthanideContainer.appendChild(lfrag);
  }

  const actinideContainer = $('#actinide-cells');
  if (actinideContainer) {
    actinideContainer.innerHTML = '';
    const afrag = document.createDocumentFragment();
    ACTINIDE_RANGE.forEach(num => {
      const element = STATE.elementMap.get(num);
      if (element) afrag.appendChild(buildElementBlock(element, true));
    });
    actinideContainer.appendChild(afrag);
  }
}

/* ============================================================
   FILTER ENGINE
============================================================ */

function buildCategoryFilters() {
  const container = $('#filter-buttons-container');
  const legend = $('#category-legend');
  if (!container || !legend) return;

  const catMap = new Map();
  STATE.elements.forEach(el => {
    const key = categoryKey(el);
    const label = t(el.basicInformation?.category) || key;
    if (!catMap.has(key)) catMap.set(key, { label, color: categoryColor(el) });
  });

  const newButtons = document.createDocumentFragment();

  catMap.forEach(({ label, color }, key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-btn';
    btn.setAttribute('data-filter', key);
    btn.setAttribute('aria-pressed', 'false');
    btn.style.setProperty('--filter-color', color);
    btn.innerHTML = `<span class="filter-btn__dot" aria-hidden="true"></span>${label}`;
    newButtons.appendChild(btn);
  });

  container.appendChild(newButtons);

  legend.innerHTML = '';
  const lfrag = document.createDocumentFragment();
  catMap.forEach(({ label, color }, key) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-item__swatch" style="background:${color}" aria-hidden="true"></span><span class="legend-item__label">${label}</span>`;
    lfrag.appendChild(item);
  });
  legend.appendChild(lfrag);
}

function applyFilter(filterKey) {
  STATE.activeFilter = filterKey;

  $$('.filter-btn').forEach(btn => {
    const active = btn.dataset.filter === filterKey;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  $$('.element-block').forEach(block => {
    if (filterKey === 'all') {
      block.classList.remove('element-block--filtered');
    } else {
      const match = block.dataset.category === filterKey;
      block.classList.toggle('element-block--filtered', !match);
    }
  });
}

/* ============================================================
   SEARCH ENGINE
============================================================ */

function searchElements(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return STATE.elements.filter(el => {
    const info = el.basicInformation;
    const nameEn = (info?.name?.en || '').toLowerCase();
    const nameBn = (info?.name?.bn || '').toLowerCase();
    const symbol = (info?.symbol || '').toLowerCase();
    const num = String(info?.atomicNumber || '');
    const catEn = (info?.category?.en || '').toLowerCase();

    return nameEn.includes(q) || nameBn.includes(q) ||
           symbol.includes(q) || num === q || catEn.includes(q);
  }).slice(0, 12);
}

function renderSearchSuggestions(results, query) {
  const dropdown = $('#search-suggestions-dropdown');
  const list = $('#search-suggestions-list');
  const countEl = $('#search-result-count');
  const input = $('#navbar-search-input');

  if (!dropdown || !list) return;

  if (!results.length || !query.trim()) {
    dropdown.hidden = true;
    input?.setAttribute('aria-expanded', 'false');
    return;
  }

  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  results.forEach(el => {
    const info = el.basicInformation;
    const li = document.createElement('li');
    li.className = 'search-suggestion-item';
    li.setAttribute('role', 'option');
    li.setAttribute('data-atomic-number', info?.atomicNumber);
    li.style.setProperty('--element-color', categoryColor(el));
    li.innerHTML = `
      <span class="suggestion__symbol">${info?.symbol || ''}</span>
      <span class="suggestion__info">
        <span class="suggestion__name">${t(info?.name)}</span>
        <span class="suggestion__meta">#${info?.atomicNumber} · ${t(info?.category)}</span>
      </span>
    `;
    frag.appendChild(li);
  });

  list.appendChild(frag);
  if (countEl) countEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
  dropdown.hidden = false;
  input?.setAttribute('aria-expanded', 'true');
}

const debouncedSearch = debounce((query) => {
  STATE.searchQuery = query;
  const results = searchElements(query);
  renderSearchSuggestions(results, query);

  $$('.element-block').forEach(block => {
    if (!query.trim()) {
      block.classList.remove('element-block--search-match', 'element-block--search-dim');
      return;
    }
    const match = results.some(el =>
      String(el.basicInformation?.atomicNumber) === block.dataset.atomicNumber
    );
    block.classList.toggle('element-block--search-match', match);
    block.classList.toggle('element-block--search-dim', !match);
  });
}, CONFIG.SEARCH_DEBOUNCE_MS);

function clearSearch() {
  const input = $('#navbar-search-input');
  if (input) input.value = '';
  const dropdown = $('#search-suggestions-dropdown');
  if (dropdown) dropdown.hidden = true;
  $$('.element-block').forEach(block => {
    block.classList.remove('element-block--search-match', 'element-block--search-dim');
  });
  STATE.searchQuery = '';
}

/* ============================================================
   ADVANCED SEARCH ENGINE
============================================================ */

function runAdvancedSearch() {
  const minAtomic = parseInt($('#filter-atomic-min')?.value || '1', 10);
  const maxAtomic = parseInt($('#filter-atomic-max')?.value || '118', 10);
  const period = $('#filter-period')?.value || '';
  const block = $('#filter-block')?.value || '';
  const phase = $('#filter-phase')?.value || '';
  const radioOnly = $('#filter-radioactive')?.checked || false;

  const results = STATE.elements.filter(el => {
    const info = el.basicInformation;
    const num = info?.atomicNumber || 0;
    const elPeriod = String(info?.period || '');
    const elBlock = (info?.block || '').toLowerCase();
    const elPhase = (info?.phase?.en || '').toLowerCase();
    const elRadio = info?.radioactive || false;

    if (num < minAtomic || num > maxAtomic) return false;
    if (period && elPeriod !== period) return false;
    if (block && elBlock !== block) return false;
    if (phase && !elPhase.includes(phase.toLowerCase())) return false;
    if (radioOnly && !elRadio) return false;

    return true;
  });

  const container = $('#advanced-search-results');
  if (!container) return;

  if (!results.length) {
    container.innerHTML = '<p class="advanced-no-results">No elements match your filters.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  results.forEach(el => {
    const info = el.basicInformation;
    const item = document.createElement('div');
    item.className = 'advanced-result-item';
    item.setAttribute('data-atomic-number', info?.atomicNumber);
    item.style.setProperty('--element-color', categoryColor(el));
    item.innerHTML = `
      <span class="adv-result__symbol">${info?.symbol || ''}</span>
      <div class="adv-result__info">
        <strong class="adv-result__name">${t(info?.name)}</strong>
        <span class="adv-result__meta">#${info?.atomicNumber} · Period ${info?.period} · Group ${info?.group} · ${info?.block}-block</span>
        <span class="adv-result__phase">${t(info?.phase)}</span>
      </div>
    `;
    frag.appendChild(item);
  });

  container.innerHTML = `<p class="adv-result-count">${results.length} element${results.length !== 1 ? 's' : ''} found</p>`;
  container.appendChild(frag);
}

/* ============================================================
   ELEMENT MODAL ENGINE
============================================================ */

function openModal(atomicNumber) {
  const element = STATE.elementMap.get(Number(atomicNumber));
  if (!element) return;

  STATE.currentElement = element;
  addToRecent(element);

  const modal = $('#element-modal');
  if (!modal) return;

  populateModalHeader(element);
  switchModalTab('overview', element);
  updateFavoriteButton(element);

  modal.hidden = false;
  modal.removeAttribute('hidden');
  document.body.classList.add('modal-open');

  requestAnimationFrame(() => {
    const closeBtn = $('#modal-close-btn');
    closeBtn?.focus();
  });

  const body = $('#modal-body');
  if (body) body.scrollTop = 0;
}

function closeModal() {
  const modal = $('#element-modal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  cancelAtomAnimation();
  STATE.currentElement = null;
}

function populateModalHeader(element) {
  const info = element.basicInformation;

  const symbolEl = $('#modal-symbol');
  const atomicNumEl = $('#modal-atomic-number');
  const nameEl = $('#modal-element-name');
  const nameBnEl = $('#modal-element-name-bn');
  const taglineEl = $('#modal-element-tagline');
  const badgesEl = $('#modal-header-badges');
  const quickStatsEl = $('#modal-quick-stats');

  if (symbolEl) symbolEl.textContent = info?.symbol || '';
  if (atomicNumEl) atomicNumEl.textContent = info?.atomicNumber || '';
  if (nameEl) nameEl.textContent = info?.name?.en || '';
  if (nameBnEl) nameBnEl.textContent = info?.name?.bn || '';
  if (taglineEl) taglineEl.textContent = t(info?.appearance) || t(info?.phase) || '';

  const symbolBlock = $('#modal-symbol-block');
  if (symbolBlock) symbolBlock.style.setProperty('--element-color', categoryColor(element));

  if (badgesEl) {
    const catColor = categoryColor(element);
    badgesEl.innerHTML = `
      <span class="badge badge--category" style="--badge-color:${catColor}">${t(info?.category)}</span>
      <span class="badge badge--block">${info?.block || '?'}-block</span>
      <span class="badge badge--phase">${t(info?.phase)}</span>
      ${info?.radioactive ? '<span class="badge badge--radioactive">☢ Radioactive</span>' : ''}
    `;
  }

  if (quickStatsEl) {
    const phys = element.physicalProperties;
    const chem = element.chemicalProperties;
    quickStatsEl.innerHTML = `
      <div class="quick-stat"><span class="quick-stat__label">Mass</span><span class="quick-stat__value">${info?.atomicMass ?? '—'}</span></div>
      <div class="quick-stat"><span class="quick-stat__label">Density</span><span class="quick-stat__value">${phys?.density?.value ?? '—'} ${phys?.density?.unit || ''}</span></div>
      <div class="quick-stat"><span class="quick-stat__label">Electronegativity</span><span class="quick-stat__value">${chem?.electronegativity ?? '—'}</span></div>
      <div class="quick-stat"><span class="quick-stat__label">Period</span><span class="quick-stat__value">${info?.period ?? '—'}</span></div>
      <div class="quick-stat"><span class="quick-stat__label">Group</span><span class="quick-stat__value">${info?.group ?? '—'}</span></div>
    `;
  }
}

function switchModalTab(tabName, element) {
  STATE.activeTab = tabName;
  const el = element || STATE.currentElement;
  if (!el) return;

  $$('.modal-tab').forEach(tab => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  $$('.modal-tabpanel').forEach(panel => {
    const active = panel.id === `tabpanel-${tabName}`;
    panel.hidden = !active;
    panel.classList.toggle('modal-tabpanel--active', active);
  });

  const activeTab = $(`#tab-${tabName}`);
  const indicator = $('#modal-tab-indicator');
  if (activeTab && indicator) {
    const rect = activeTab.getBoundingClientRect();
    const listRect = activeTab.closest('.modal-tabs__list')?.getBoundingClientRect();
    if (listRect) {
      indicator.style.transform = `translateX(${rect.left - listRect.left}px)`;
      indicator.style.width = `${rect.width}px`;
    }
  }

  switch (tabName) {
    case 'overview':   renderOverviewTab(el);    break;
    case 'structure':  renderStructureTab(el);   break;
    case 'properties': renderPropertiesTab(el);  break;
    case 'industrial': renderIndustrialTab(el);  break;
    case 'safety':     renderSafetyTab(el);      break;
    case 'learning':   renderLearningTab(el);    break;
    case 'reactions':  renderReactionsTab(el);   break;
    case 'environment':renderEnvironmentTab(el); break;
    case 'history':    renderHistoryTab(el);     break;
    case 'quiz':       renderQuizTab(el);        break;
  }
}

/* -------- TAB RENDERERS -------- */

function renderOverviewTab(element) {
  const info = element.basicInformation;

  initAtomViewer(element);

  const configNotation = $('#electron-config-notation');
  const configShells = $('#electron-config-shells');
  const atomic = element.atomicStructure;

  if (configNotation) configNotation.textContent = atomic?.electronConfiguration || '';
  if (configShells && atomic?.shellDistribution) {
    configShells.innerHTML = atomic.shellDistribution.map((count, i) =>
      `<div class="shell-row">
        <span class="shell-row__label">Shell ${i + 1}</span>
        <div class="shell-row__electrons">
          ${Array.from({ length: count }, () => '<span class="electron-dot" aria-hidden="true"></span>').join('')}
        </div>
        <span class="shell-row__count">${count} e⁻</span>
      </div>`
    ).join('');
  }

  const overview = $('#overview-content');
  if (overview) {
    overview.innerHTML = `
      <div class="overview-grid">
        <div class="overview-item"><span class="overview-item__label">Pronunciation</span><span class="overview-item__value">${t(info?.pronunciation)}</span></div>
        <div class="overview-item"><span class="overview-item__label">Appearance</span><span class="overview-item__value">${t(info?.appearance)}</span></div>
        <div class="overview-item"><span class="overview-item__label">Color</span><span class="overview-item__value">${t(info?.color)}</span></div>
        <div class="overview-item"><span class="overview-item__label">Phase at STP</span><span class="overview-item__value">${t(info?.phase)}</span></div>
        <div class="overview-item"><span class="overview-item__label">Natural Occurrence</span><span class="overview-item__value">${t(info?.naturalOccurrence)}</span></div>
        <div class="overview-item"><span class="overview-item__label">Radioactive</span><span class="overview-item__value">${info?.radioactive ? 'Yes ☢' : 'No'}</span></div>
      </div>
    `;
  }

  const factsList = $('#fun-facts-list');
  const facts = element.learningContent?.funFacts || [];
  if (factsList) {
    if (facts.length) {
      factsList.innerHTML = facts.map(f => `<li class="fun-fact-item"><span class="fun-fact-icon" aria-hidden="true">⚡</span>${t(f)}</li>`).join('');
    } else {
      factsList.innerHTML = '<li class="fun-fact-item fun-fact-item--empty">No fun facts available.</li>';
    }
  }

  const hudNucleus = $('#hud-nucleus-label');
  const hudElectrons = $('#hud-electron-count');
  const atomic2 = element.atomicStructure;
  if (hudNucleus) hudNucleus.textContent = `${atomic2?.protons ?? 0}p · ${atomic2?.neutrons ?? 0}n`;
  if (hudElectrons) hudElectrons.textContent = `${atomic2?.electrons ?? 0} e⁻`;
}

function renderStructureTab(element) {
  const container = $('#structure-content');
  if (!container) return;
  const atomic = element.atomicStructure;
  const qn = atomic?.quantumNumbers || {};
  const orb = atomic?.orbitalConfiguration || {};

  container.innerHTML = `
    <div class="data-section">
      <h3 class="data-section__title">Atomic Composition</h3>
      <div class="data-grid">
        ${dataRow('Protons', atomic?.protons ?? '—')}
        ${dataRow('Neutrons', atomic?.neutrons ?? '—')}
        ${dataRow('Electrons', atomic?.electrons ?? '—')}
        ${dataRow('Valence Electrons', atomic?.valenceElectrons ?? '—')}
        ${dataRow('Electron Shells', atomic?.shells ?? '—')}
        ${dataRow('Shell Distribution', (atomic?.shellDistribution || []).join(', '))}
        ${dataRow('Electron Configuration', atomic?.electronConfiguration || '—')}
        ${dataRow('Oxidation States', (atomic?.oxidationStates || []).join(', '))}
      </div>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Quantum Numbers</h3>
      <div class="data-grid">
        ${dataRow('Principal (n)', qn.principal ?? '—')}
        ${dataRow('Azimuthal (l)', qn.azimuthal ?? '—')}
        ${dataRow('Magnetic (mₗ)', qn.magnetic ?? '—')}
        ${dataRow('Spin (mₛ)', qn.spin ?? '—')}
      </div>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Orbital Configuration</h3>
      <div class="orbital-config">
        ${Object.entries(orb).map(([orbital, electrons]) =>
          `<div class="orbital-item">
            <span class="orbital-item__name">${orbital}</span>
            <div class="orbital-item__boxes">
              ${renderOrbitalBoxes(orbital, electrons)}
            </div>
            <span class="orbital-item__count">${electrons}</span>
          </div>`
        ).join('')}
      </div>
    </div>
  `;
}

function renderOrbitalBoxes(orbital, count) {
  const maxElectrons = orbital.startsWith('s') ? 2 : orbital.startsWith('p') ? 6 : orbital.startsWith('d') ? 10 : 14;
  const boxes = Math.ceil(maxElectrons / 2);
  let html = '';
  let placed = 0;
  for (let b = 0; b < boxes; b++) {
    const first = placed < count ? '↑' : '';
    placed++;
    const second = placed < count ? '↓' : '';
    placed++;
    html += `<div class="orbital-box">${first}${second ? `<span>${second}</span>` : ''}</div>`;
  }
  return html;
}

function renderPropertiesTab(element) {
  const container = $('#properties-content');
  if (!container) return;
  const phys = element.physicalProperties || {};
  const chem = element.chemicalProperties || {};

  container.innerHTML = `
    <div class="data-section">
      <h3 class="data-section__title">Physical Properties</h3>
      <div class="data-grid">
        ${dataRowUnit('Density', phys.density)}
        ${dataRowUnit('Melting Point', phys.meltingPoint)}
        ${dataRowUnit('Boiling Point', phys.boilingPoint)}
        ${dataRowUnit('Atomic Radius', phys.atomicRadius)}
        ${dataRowUnit('Covalent Radius', phys.covalentRadius)}
        ${dataRowUnit('Van der Waals Radius', phys.vanDerWaalsRadius)}
        ${dataRowUnit('Thermal Conductivity', phys.thermalConductivity)}
        ${dataRowUnit('Specific Heat', phys.specificHeat)}
        ${dataRowUnit('Electrical Conductivity', phys.electricalConductivity)}
        ${dataRow('Crystal Structure', t(phys.crystalStructure))}
        ${dataRow('Magnetic Ordering', t(phys.magneticOrdering))}
      </div>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Chemical Properties</h3>
      <div class="data-grid">
        ${dataRow('Electronegativity', chem.electronegativity ?? '—')}
        ${dataRowUnit('Ionization Energy', chem.ionizationEnergy)}
        ${dataRowUnit('Electron Affinity', chem.electronAffinity)}
        ${dataRow('Reactivity', t(chem.reactivity))}
        ${dataRow('Flame Test Color', t(chem.flameTestColor))}
        ${dataRow('Common Compounds', (chem.commonCompounds || []).join(', '))}
      </div>
    </div>
    ${chem.spectralLines?.length ? `
    <div class="data-section">
      <h3 class="data-section__title">Spectral Lines</h3>
      <div class="spectral-lines">
        ${(chem.spectralLines || []).map(line => {
          const nm = parseFloat(line);
          const hue = Math.round(((nm - 380) / (750 - 380)) * 360);
          return `<div class="spectral-line" style="--hue:${hue}deg" title="${line}"><span class="spectral-line__label">${line}</span></div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `;
}

function renderIndustrialTab(element) {
  const container = $('#industrial-content');
  if (!container) return;
  const ind = element.industrialApplications || {};

  const sections = [
    { key: 'industrialUses',    icon: '🏭', label: 'Industrial Uses' },
    { key: 'commercialUses',    icon: '🏪', label: 'Commercial Uses' },
    { key: 'electronicsUses',   icon: '⚡', label: 'Electronics' },
    { key: 'semiconductorUses', icon: '💡', label: 'Semiconductors' },
    { key: 'aerospaceUses',     icon: '🚀', label: 'Aerospace' },
    { key: 'batteryUses',       icon: '🔋', label: 'Battery Technology' },
    { key: 'aiHardwareUses',    icon: '🤖', label: 'AI Hardware' },
    { key: 'renewableEnergyUses',icon: '☀️', label: 'Renewable Energy' },
    { key: 'nanotechnologyUses', icon: '🔬', label: 'Nanotechnology' },
    { key: 'nuclearUses',       icon: '☢️', label: 'Nuclear' },
    { key: 'militaryUses',      icon: '🛡️', label: 'Military' },
    { key: 'medicalUses',       icon: '⚕️', label: 'Medical' },
    { key: 'foodIndustryUses',  icon: '🥗', label: 'Food Industry' },
    { key: 'constructionUses',  icon: '🏗️', label: 'Construction' },
  ];

  container.innerHTML = sections
    .filter(s => ind[s.key])
    .map(s => `
      <div class="industrial-card">
        <div class="industrial-card__header">
          <span class="industrial-card__icon" aria-hidden="true">${s.icon}</span>
          <h3 class="industrial-card__title">${s.label}</h3>
        </div>
        <p class="industrial-card__text">${t(ind[s.key])}</p>
      </div>
    `).join('') || '<p class="no-data">No industrial application data available.</p>';
}

function renderSafetyTab(element) {
  const container = $('#safety-content');
  if (!container) return;
  const safety = element.safetyInformation || {};
  const levelClass = (safety.safetyLevel?.en || '').toLowerCase().includes('high') ? 'safety-level--high' : 'safety-level--medium';

  container.innerHTML = `
    <div class="safety-level-banner ${levelClass}">
      <span class="safety-level-banner__icon" aria-hidden="true">⚠</span>
      <span class="safety-level-banner__text">${t(safety.safetyLevel) || 'Unknown Risk Level'}</span>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Hazard Classifications</h3>
      <div class="hazard-badges">
        ${(safety.hazardClassifications || []).map(h =>
          `<span class="hazard-badge">${t(h)}</span>`
        ).join('') || '<span class="no-data-inline">None listed</span>'}
      </div>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Hazards</h3>
      <p class="safety-text safety-text--hazard">${t(safety.hazards) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Storage Requirements</h3>
      <p class="safety-text">${t(safety.storageRequirements) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Handling Procedures</h3>
      <p class="safety-text">${t(safety.handlingProcedures) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Exposure Risks</h3>
      <p class="safety-text safety-text--risk">${t(safety.exposureRisks) || '—'}</p>
    </div>
  `;
}

function renderLearningTab(element) {
  const contentContainer = $('#learning-content');
  const comparisonsContainer = $('#modal-comparisons');
  const lc = element.learningContent || {};

  if (contentContainer) {
    contentContainer.innerHTML = `
      <div class="learning-block learning-block--simple">
        <h3 class="learning-block__title">Simple Explanation</h3>
        <p class="learning-block__text">${t(lc.simpleExplanation) || '—'}</p>
      </div>
      <div class="learning-block learning-block--advanced">
        <h3 class="learning-block__title">Advanced Explanation</h3>
        <p class="learning-block__text">${t(lc.advancedExplanation) || '—'}</p>
      </div>
      ${lc.learningTips?.length ? `
      <div class="learning-block learning-block--tips">
        <h3 class="learning-block__title">💡 Learning Tips</h3>
        <ul class="learning-tips-list">
          ${lc.learningTips.map(tip => `<li>${t(tip)}</li>`).join('')}
        </ul>
      </div>` : ''}
      ${lc.misconceptions?.length ? `
      <div class="learning-block learning-block--misconceptions">
        <h3 class="learning-block__title">🚫 Common Misconceptions</h3>
        <ul class="misconceptions-list">
          ${lc.misconceptions.map(m => `<li>${t(m)}</li>`).join('')}
        </ul>
      </div>` : ''}
    `;
  }

  if (comparisonsContainer && lc.comparisons?.length) {
    comparisonsContainer.innerHTML = `
      <h3 class="comparisons-title">Comparisons</h3>
      <div class="comparison-cards">
        ${lc.comparisons.map(comp => {
          const compared = STATE.elementMap.get(comp.compareWithId);
          const compName = compared ? t(compared.basicInformation?.name) : `Element #${comp.compareWithId}`;
          return `
            <div class="comparison-card">
              <div class="comparison-card__element" data-atomic-number="${comp.compareWithId}" style="--element-color:${compared ? categoryColor(compared) : '#666'}">
                <span class="comparison-card__symbol">${compared?.basicInformation?.symbol || '?'}</span>
                <span class="comparison-card__name">${compName}</span>
              </div>
              <p class="comparison-card__relation">${t(comp.relation)}</p>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (comparisonsContainer) {
    comparisonsContainer.innerHTML = '';
  }
}

function renderReactionsTab(element) {
  const container = $('#reactions-content');
  if (!container) return;
  const reactions = element.reactionExamples || {};

  const renderReactionGroup = (title, items, icon = '⚗') => {
    if (!items?.length) return '';
    return `
      <div class="data-section">
        <h3 class="data-section__title">${icon} ${title}</h3>
        ${items.map(r => `
          <div class="reaction-card">
            <div class="reaction-card__equation">${r.equation || ''}</div>
            <p class="reaction-card__desc">${t(r.description)}</p>
          </div>
        `).join('')}
      </div>
    `;
  };

  const bondingHtml = reactions.bondingExamples?.length ? `
    <div class="data-section">
      <h3 class="data-section__title">🔗 Bonding Examples</h3>
      ${reactions.bondingExamples.map(b => `
        <div class="reaction-card">
          <div class="reaction-card__equation">${b.molecule || ''}</div>
          <span class="reaction-card__bond-type">${t(b.bondType)}</span>
          <p class="reaction-card__desc">${t(b.description)}</p>
        </div>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML =
    renderReactionGroup('Reactions', reactions.reactions, '⚗') +
    renderReactionGroup('Oxidation Examples', reactions.oxidationExamples, '⬆') +
    renderReactionGroup('Reduction Examples', reactions.reductionExamples, '⬇') +
    bondingHtml ||
    '<p class="no-data">No reaction data available.</p>';
}

function renderEnvironmentTab(element) {
  const container = $('#environment-content');
  if (!container) return;
  const bio = element.biologicalAndEnvironmentalData || {};
  const mining = element.miningAndEconomics || {};

  const score = bio.sustainabilityScore;
  const scoreWidth = score != null ? Math.round((score / 10) * 100) : 0;

  container.innerHTML = `
    <div class="data-section">
      <h3 class="data-section__title">Biological Importance</h3>
      <p class="env-text">${t(bio.biologicalImportance) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Role in the Human Body</h3>
      <p class="env-text">${t(bio.humanBodyRole) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Toxicity</h3>
      <p class="env-text">${t(bio.toxicity) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Environmental Impact</h3>
      <p class="env-text">${t(bio.environmentalImpact) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Pollution Risks</h3>
      <p class="env-text">${t(bio.pollutionRisks) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Recycling Methods</h3>
      <p class="env-text">${t(bio.recyclingMethods) || '—'}</p>
    </div>
    ${score != null ? `
    <div class="data-section">
      <h3 class="data-section__title">Sustainability Score</h3>
      <div class="sustainability-bar" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="10">
        <div class="sustainability-bar__fill" style="width:${scoreWidth}%"></div>
      </div>
      <span class="sustainability-score">${score}/10</span>
    </div>` : ''}
    <div class="data-section">
      <h3 class="data-section__title">Mining &amp; Economics</h3>
      <div class="data-grid">
        ${dataRow('Mining Methods', t(mining.miningMethods))}
        ${dataRow('Market Value', t(mining.marketValue))}
        ${dataRow('Future Demand', t(mining.futureDemand))}
        ${dataRow('Global Importance', t(mining.globalImportance))}
      </div>
    </div>
    ${mining.abundance ? `
    <div class="data-section">
      <h3 class="data-section__title">Abundance</h3>
      <div class="data-grid">
        ${dataRow('Universe', t(mining.abundance?.universe))}
        ${dataRow('Earth Crust', t(mining.abundance?.earthCrust))}
        ${dataRow('Oceans', t(mining.abundance?.oceans))}
      </div>
    </div>` : ''}
    ${mining.majorProducingCountries?.length ? `
    <div class="data-section">
      <h3 class="data-section__title">Major Producing Countries</h3>
      <ul class="country-list">
        ${mining.majorProducingCountries.map(c => `<li>${t(c)}</li>`).join('')}
      </ul>
    </div>` : ''}
  `;
}

function renderHistoryTab(element) {
  const container = $('#history-content');
  if (!container) return;
  const history = element.discoveryAndHistory || {};

  container.innerHTML = `
    <div class="timeline">
      <div class="timeline-item">
        <div class="timeline-item__year">${history.discoveryYear || '?'}</div>
        <div class="timeline-item__content">
          <h3 class="timeline-item__title">Discovery</h3>
          <p><strong>${t(history.discoveredBy)}</strong> · ${t(history.discoveryLocation)}</p>
        </div>
      </div>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Discovery Story</h3>
      <p class="history-text">${t(history.discoveryStory) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Historical Uses</h3>
      <p class="history-text">${t(history.historicalUses) || '—'}</p>
    </div>
    <div class="data-section">
      <h3 class="data-section__title">Famous Experiments</h3>
      <p class="history-text">${t(history.famousExperiments) || '—'}</p>
    </div>
  `;
}

function renderQuizTab(element) {
  const questions = element.learningContent?.quizQuestions || [];
  STATE.quizState = { questions, current: 0, score: 0, answered: false, selectedOption: -1 };
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const container = $('#quiz-content');
  const scoreEl = $('#quiz-score');
  if (!container) return;

  const { questions, current, score, answered, selectedOption } = STATE.quizState;

  if (!questions.length) {
    container.innerHTML = '<p class="no-data">No quiz questions available for this element.</p>';
    if (scoreEl) scoreEl.textContent = '';
    return;
  }

  if (current >= questions.length) {
    const pct = Math.round((score / questions.length) * 100);
    const medal = pct === 100 ? '🏆' : pct >= 70 ? '🥈' : '📚';
    container.innerHTML = `
      <div class="quiz-complete">
        <div class="quiz-complete__icon">${medal}</div>
        <h3 class="quiz-complete__title">${STATE.lang === 'bn' ? 'কুইজ সম্পন্ন!' : 'Quiz Complete!'}</h3>
        <p class="quiz-complete__score">${STATE.lang === 'bn' ? 'স্কোর' : 'Score'}: ${score} / ${questions.length}</p>
        <div class="quiz-complete__bar" aria-label="Score bar">
          <div class="quiz-complete__bar-fill" style="width:${pct}%"></div>
        </div>
        <button type="button" class="quiz-restart-btn" id="quiz-restart">
          ${STATE.lang === 'bn' ? 'আবার চেষ্টা করুন' : 'Try Again'}
        </button>
      </div>
    `;
    if (scoreEl) scoreEl.textContent = '';
    return;
  }

  const q = questions[current];
  const correct = q.correctOptionIndex;

  if (scoreEl) scoreEl.textContent = `${STATE.lang === 'bn' ? 'প্রশ্ন' : 'Question'} ${current + 1} / ${questions.length}  ·  ${STATE.lang === 'bn' ? 'স্কোর' : 'Score'}: ${score}`;

  const understoodLabel  = STATE.lang === 'bn' ? 'বুঝেছি' : 'Understood';
  const explanationLabel = STATE.lang === 'bn' ? 'ব্যাখ্যা' : 'Explanation';

  container.innerHTML = `
    <div class="quiz-question-card">
      <p class="quiz-question-text">${t(q.question)}</p>
      <div class="quiz-options" role="radiogroup" aria-label="${STATE.lang === 'bn' ? 'উত্তরের বিকল্পসমূহ' : 'Answer options'}">
        ${(q.options || []).map((opt, i) => {
          let extraClass = '';
          if (answered) {
            if (i === correct)           extraClass = ' quiz-option--correct';
            else if (i === selectedOption) extraClass = ' quiz-option--wrong';
          }
          return `
            <button
              type="button"
              class="quiz-option${extraClass}"
              data-index="${i}"
              aria-pressed="${answered && i === selectedOption ? 'true' : 'false'}"
              ${answered ? 'disabled' : ''}
            >${t(opt)}</button>
          `;
        }).join('')}
      </div>
      ${answered ? `
        <div class="quiz-explanation" role="note" aria-label="${explanationLabel}">
          <span class="quiz-explanation__icon" aria-hidden="true">💡</span>
          <div class="quiz-explanation__body">
            <strong class="quiz-explanation__label">${explanationLabel}</strong>
            <p class="quiz-explanation__text">${t(q.explanation)}</p>
          </div>
        </div>
        <button type="button" class="quiz-understood-btn" id="quiz-understood">
          <span class="quiz-understood-btn__text">${understoodLabel}</span>
          <span class="quiz-understood-btn__arrow" aria-hidden="true">→</span>
        </button>
      ` : ''}
    </div>
  `;
}

function handleQuizOption(btn) {
  const { questions, current } = STATE.quizState;
  if (STATE.quizState.answered) return;
  const selected = parseInt(btn.dataset.index, 10);
  const correct = questions[current].correctOptionIndex;
  STATE.quizState.answered = true;
  STATE.quizState.selectedOption = selected;
  if (selected === correct) STATE.quizState.score++;

  // Re-render to show correct/wrong state + explanation + Understood button
  renderQuizQuestion();
}

function dataRow(label, value) {
  return `<div class="data-row">
    <span class="data-row__label">${label}</span>
    <span class="data-row__value">${value != null && value !== '' ? value : '—'}</span>
  </div>`;
}

function dataRowUnit(label, obj) {
  if (!obj || obj.value == null) return dataRow(label, '—');
  return dataRow(label, `${obj.value} ${obj.unit || ''}`);
}

/* ============================================================
   3D ATOM VIEWER
============================================================ */

function initAtomViewer(element) {
  cancelAtomAnimation();
  const canvas = $('#atom-viewer-canvas');
  if (!canvas) return;

  const atomic = element.atomicStructure;
  const shells = atomic?.shellDistribution || [1];
  const color = categoryColor(element);
  const ctx = canvas.getContext('2d');

  const container = $('#atom-viewer-container');
  const size = Math.min(container?.offsetWidth || 300, 360);
  canvas.width = size;
  canvas.height = size;

  const cx = size / 2;
  const cy = size / 2;
  const baseOrbitRadius = size * 0.1;
  const orbitStep = size * 0.07;

  const electronAngles = shells.map((count, shellIdx) => {
    return Array.from({ length: count }, (_, i) => (Math.PI * 2 * i) / count);
  });

  let rotation = 0;

  function draw() {
    ctx.clearRect(0, 0, size, size);

    const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 0.45);
    grd.addColorStop(0, hexToRgba(color, 0.15));
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);

    shells.forEach((_, i) => {
      const r = baseOrbitRadius + (i + 1) * orbitStep;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.38, rotation * 0.3 * (i % 2 === 0 ? 1 : -1), 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(color, 0.3);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    const nucleusGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.06);
    nucleusGrd.addColorStop(0, lightenColor(color, 0.6));
    nucleusGrd.addColorStop(1, color);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(6, size * 0.055), 0, Math.PI * 2);
    ctx.fillStyle = nucleusGrd;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;

    shells.forEach((count, shellIdx) => {
      const r = baseOrbitRadius + (shellIdx + 1) * orbitStep;
      const tilt = shellIdx % 2 === 0 ? 0.38 : 0.45;
      const spinDir = shellIdx % 2 === 0 ? 1 : -1;

      for (let e = 0; e < count; e++) {
        electronAngles[shellIdx][e] += (0.012 + shellIdx * 0.004) * spinDir * (STATE.atomAnimation.spin ? 1 : 0);
        const angle = electronAngles[shellIdx][e] + rotation * 0.3 * spinDir;
        const ex = cx + r * Math.cos(angle);
        const ey = cy + r * tilt * Math.sin(angle);

        const eGrd = ctx.createRadialGradient(ex, ey, 0, ex, ey, 5);
        eGrd.addColorStop(0, '#fff');
        eGrd.addColorStop(1, hexToRgba(color, 0));
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fillStyle = eGrd;
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    rotation += 0.003;
    STATE.atomAnimation.frame = requestAnimationFrame(draw);
  }

  STATE.atomAnimation.running = true;
  draw();
}

function cancelAtomAnimation() {
  if (STATE.atomAnimation.frame) {
    cancelAnimationFrame(STATE.atomAnimation.frame);
    STATE.atomAnimation.frame = null;
  }
}

function hexToRgba(hex, alpha) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(100,200,255,${alpha})`;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lightenColor(hex, factor) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '#ffffff';
  const r = Math.min(255, Math.round(parseInt(result[1], 16) + (255 - parseInt(result[1], 16)) * factor));
  const g = Math.min(255, Math.round(parseInt(result[2], 16) + (255 - parseInt(result[2], 16)) * factor));
  const b = Math.min(255, Math.round(parseInt(result[3], 16) + (255 - parseInt(result[3], 16)) * factor));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/* ============================================================
   PARTICLE BACKGROUND
============================================================ */

function initParticleBackground() {
  const canvas = $('#canvas-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W = canvas.width = window.innerWidth;
  let H = canvas.height = window.innerHeight;

  const PARTICLE_COUNT = Math.min(80, Math.floor((W * H) / 15000));
  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.5 + 0.5,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    alpha: Math.random() * 0.5 + 0.1,
  }));

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,200,255,${p.alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  draw();

  window.addEventListener('resize', () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }, { passive: true });
}

/* ============================================================
   FAVORITES ENGINE
============================================================ */

function toggleFavorite(atomicNumber) {
  const num = Number(atomicNumber);
  const idx = STATE.favorites.indexOf(num);
  if (idx === -1) {
    if (STATE.favorites.length >= CONFIG.MAX_FAVORITES) {
      showToast('Favorites limit reached.', 'warning');
      return;
    }
    STATE.favorites.push(num);
    showToast(`Added to favorites!`, 'success');
  } else {
    STATE.favorites.splice(idx, 1);
    showToast(`Removed from favorites.`, 'info');
  }
  saveLocal('qe-favorites', STATE.favorites);
  renderFavoritesPanel();
  updateFavoriteButton(STATE.currentElement);
}

function updateFavoriteButton(element) {
  const btn = $('#modal-favorite-btn');
  if (!btn || !element) return;
  const num = element.basicInformation?.atomicNumber;
  const isFav = STATE.favorites.includes(num);
  btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
  btn.querySelector('span').textContent = isFav ? '♥' : '♡';
  btn.classList.toggle('modal-favorite-btn--active', isFav);
}

function renderFavoritesPanel() {
  const list = $('#favorites-list');
  const empty = $('#favorites-empty');
  if (!list) return;

  if (!STATE.favorites.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  list.innerHTML = STATE.favorites.map(num => {
    const el = STATE.elementMap.get(num);
    if (!el) return '';
    const info = el.basicInformation;
    return `
      <li class="panel-element-item" data-atomic-number="${num}" style="--element-color:${categoryColor(el)}">
        <span class="panel-element-item__symbol">${info?.symbol || ''}</span>
        <div class="panel-element-item__info">
          <strong>${t(info?.name)}</strong>
          <span>#${num}</span>
        </div>
        <button type="button" class="panel-element-item__remove" data-remove-fav="${num}" aria-label="Remove ${t(info?.name)} from favorites">✕</button>
      </li>
    `;
  }).join('');
}

/* ============================================================
   RECENT ENGINE
============================================================ */

function addToRecent(element) {
  const num = element.basicInformation?.atomicNumber;
  STATE.recent = [num, ...STATE.recent.filter(n => n !== num)].slice(0, CONFIG.MAX_RECENT);
  saveLocal('qe-recent', STATE.recent);
  renderRecentPanel();
}

function renderRecentPanel() {
  const list = $('#recent-list');
  const empty = $('#recent-empty');
  if (!list) return;

  if (!STATE.recent.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  list.innerHTML = STATE.recent.map(num => {
    const el = STATE.elementMap.get(num);
    if (!el) return '';
    const info = el.basicInformation;
    return `
      <li class="panel-element-item" data-atomic-number="${num}" style="--element-color:${categoryColor(el)}">
        <span class="panel-element-item__symbol">${info?.symbol || ''}</span>
        <div class="panel-element-item__info">
          <strong>${t(info?.name)}</strong>
          <span>#${num}</span>
        </div>
      </li>
    `;
  }).join('');
}

/* ============================================================
   COMPARE ENGINE
============================================================ */

function setCompareSlot(slotIndex, element) {
  STATE.compareSlots[slotIndex] = element;
  renderCompareSlot(slotIndex);
  if (STATE.compareSlots[0] && STATE.compareSlots[1]) {
    renderComparisonTable();
  }
}

function renderCompareSlot(index) {
  const slotEl = $(`#compare-slot-${index === 0 ? 'a' : 'b'}`);
  if (!slotEl) return;
  const element = STATE.compareSlots[index];
  if (!element) {
    slotEl.innerHTML = `<span class="compare-slot__placeholder">Select Element ${index === 0 ? 'A' : 'B'}</span>`;
    return;
  }
  const info = element.basicInformation;
  slotEl.innerHTML = `
    <div class="compare-slot__element" style="--element-color:${categoryColor(element)}">
      <span class="compare-slot__symbol">${info?.symbol || ''}</span>
      <span class="compare-slot__name">${t(info?.name)}</span>
      <button type="button" class="compare-slot__clear" data-clear-slot="${index}" aria-label="Remove element">✕</button>
    </div>
  `;
}

function renderComparisonTable() {
  const wrapper = $('#compare-table-wrapper');
  if (!wrapper) return;
  const [a, b] = STATE.compareSlots;
  if (!a || !b) return;

  const rows = [
    ['Atomic Number', a.basicInformation?.atomicNumber, b.basicInformation?.atomicNumber],
    ['Symbol', a.basicInformation?.symbol, b.basicInformation?.symbol],
    ['Atomic Mass', a.basicInformation?.atomicMass, b.basicInformation?.atomicMass],
    ['Category', t(a.basicInformation?.category), t(b.basicInformation?.category)],
    ['Period', a.basicInformation?.period, b.basicInformation?.period],
    ['Group', a.basicInformation?.group, b.basicInformation?.group],
    ['Block', a.basicInformation?.block, b.basicInformation?.block],
    ['Phase', t(a.basicInformation?.phase), t(b.basicInformation?.phase)],
    ['Electronegativity', a.chemicalProperties?.electronegativity, b.chemicalProperties?.electronegativity],
    ['Protons', a.atomicStructure?.protons, b.atomicStructure?.protons],
    ['Electrons', a.atomicStructure?.electrons, b.atomicStructure?.electrons],
    ['Electron Config', a.atomicStructure?.electronConfiguration, b.atomicStructure?.electronConfiguration],
    ['Density (g/cm³)', a.physicalProperties?.density?.value, b.physicalProperties?.density?.value],
    ['Melting Point (K)', a.physicalProperties?.meltingPoint?.value, b.physicalProperties?.meltingPoint?.value],
    ['Boiling Point (K)', a.physicalProperties?.boilingPoint?.value, b.physicalProperties?.boilingPoint?.value],
    ['Ionization Energy (kJ/mol)', a.chemicalProperties?.ionizationEnergy?.value, b.chemicalProperties?.ionizationEnergy?.value],
  ];

  wrapper.innerHTML = `
    <table class="compare-table" aria-label="Element comparison table">
      <thead>
        <tr>
          <th scope="col">Property</th>
          <th scope="col">${a.basicInformation?.symbol}</th>
          <th scope="col">${b.basicInformation?.symbol}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(([label, valA, valB]) => {
          const aNum = parseFloat(valA);
          const bNum = parseFloat(valB);
          const canCompare = !isNaN(aNum) && !isNaN(bNum);
          const aWin = canCompare && aNum > bNum ? ' compare-cell--higher' : '';
          const bWin = canCompare && bNum > aNum ? ' compare-cell--higher' : '';
          return `
            <tr class="compare-row">
              <td class="compare-cell compare-cell--label">${label}</td>
              <td class="compare-cell${aWin}">${valA ?? '—'}</td>
              <td class="compare-cell${bWin}">${valB ?? '—'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

/* ============================================================
   LEARNING SECTION ENGINE
============================================================ */

function renderLearningSectionCards() {
  const grid = $('#learning-cards-grid');
  if (!grid || !STATE.elements.length) return;

  const pool = [...STATE.elements].sort(() => Math.random() - 0.5).slice(0, 6);

  grid.innerHTML = pool.map(el => {
    const info = el.basicInformation;
    const lc = el.learningContent;
    return `
      <div class="learning-card" data-atomic-number="${info?.atomicNumber}" style="--element-color:${categoryColor(el)}">
        <div class="learning-card__front">
          <span class="learning-card__symbol">${info?.symbol || ''}</span>
          <span class="learning-card__number">#${info?.atomicNumber}</span>
          <span class="learning-card__name">${t(info?.name)}</span>
          <span class="learning-card__hint">Click to learn</span>
        </div>
        <div class="learning-card__back">
          <p class="learning-card__fact">${t(lc?.simpleExplanation) || t((lc?.funFacts || [])[0]) || t(info?.category)}</p>
        </div>
      </div>
    `;
  }).join('');
}

function renderRelatedElements(element) {
  const list = $('#related-elements-list');
  if (!list || !element) return;
  const related = element.learningContent?.relatedElements || [];
  list.innerHTML = related.map(num => {
    const el = STATE.elementMap.get(num);
    if (!el) return '';
    const info = el.basicInformation;
    return `
      <div class="related-element-chip" data-atomic-number="${num}" style="--element-color:${categoryColor(el)}">
        <span class="related-element-chip__symbol">${info?.symbol || ''}</span>
        <span class="related-element-chip__name">${t(info?.name)}</span>
      </div>
    `;
  }).join('');

  const row = $('#related-elements-row');
  if (row) row.hidden = !related.length;
}

/* ============================================================
   LEARNING PANEL ENGINE
============================================================ */

function renderLearningModeContent(mode) {
  const container = $('#learning-mode-content');
  if (!container || !STATE.elements.length) return;
  STATE.learningMode = mode;

  $$('.learning-mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const pool = [...STATE.elements].sort(() => Math.random() - 0.5);

  switch (mode) {
    case 'flashcard': {
      STATE.flashcardIndex = 0;
      const el = pool[0];
      renderFlashcard(container, el);
      break;
    }
    case 'quiz': {
      const allQ = [];
      STATE.elements.forEach(el => {
        (el.learningContent?.quizQuestions || []).forEach(q => allQ.push({ q, el }));
      });
      const picked = allQ.sort(() => Math.random() - 0.5).slice(0, 5);
      renderPanelQuiz(container, picked);
      break;
    }
    case 'match': {
      renderMatchGame(container, pool.slice(0, 8));
      break;
    }
  }
}

function renderFlashcard(container, element) {
  if (!element) return;
  const info = element.basicInformation;
  container.innerHTML = `
    <div class="flashcard" id="learning-flashcard" data-atomic-number="${info?.atomicNumber}" style="--element-color:${categoryColor(element)}">
      <div class="flashcard__inner">
        <div class="flashcard__front">
          <span class="flashcard__symbol">${info?.symbol || ''}</span>
        </div>
        <div class="flashcard__back">
          <strong class="flashcard__name">${t(info?.name)}</strong>
          <span class="flashcard__num">#${info?.atomicNumber}</span>
          <span class="flashcard__category">${t(info?.category)}</span>
          <p class="flashcard__fact">${t((element.learningContent?.funFacts || [])[0]) || ''}</p>
        </div>
      </div>
      <button type="button" class="flashcard__next" id="flashcard-next">Next →</button>
    </div>
  `;
}

function renderPanelQuiz(container, items) {
  if (!items.length) {
    container.innerHTML = '<p>No questions available.</p>';
    return;
  }
  let currentItem = 0;
  let panelScore = 0;
  const showQuestion = () => {
    if (currentItem >= items.length) {
      container.innerHTML = `<div class="panel-quiz-result">Score: ${panelScore}/${items.length} 🎉</div>`;
      return;
    }
    const { q, el } = items[currentItem];
    container.innerHTML = `
      <div class="panel-quiz-question">
        <p>${t(q.question)}</p>
        <div class="panel-quiz-options">
          ${(q.options || []).map((opt, i) => `
            <button type="button" class="panel-quiz-option" data-index="${i}">${t(opt)}</button>
          `).join('')}
        </div>
        <p class="panel-quiz-progress">${currentItem + 1}/${items.length}</p>
      </div>
    `;
    $$('.panel-quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const selected = parseInt(btn.dataset.index, 10);
        if (selected === q.correctOptionIndex) panelScore++;
        $$('.panel-quiz-option').forEach((b, i) => {
          b.disabled = true;
          if (i === q.correctOptionIndex) b.classList.add('quiz-option--correct');
          else if (i === selected) b.classList.add('quiz-option--wrong');
        });
        setTimeout(() => { currentItem++; showQuestion(); }, 1200);
      }, { once: true });
    });
  };
  showQuestion();
}

function renderMatchGame(container, elements) {
  const symbols = elements.map(el => ({ type: 'symbol', num: el.basicInformation?.atomicNumber, text: el.basicInformation?.symbol || '' }));
  const names   = elements.map(el => ({ type: 'name',   num: el.basicInformation?.atomicNumber, text: t(el.basicInformation?.name) }));
  const cards = [...symbols, ...names].sort(() => Math.random() - 0.5);
  let selected = null;
  let matched = new Set();

  const render = () => {
    container.innerHTML = `
      <p class="match-instructions">Match symbols to element names!</p>
      <div class="match-grid">
        ${cards.map((card, i) => `
          <button type="button" class="match-card ${matched.has(i) ? 'match-card--matched' : ''}" data-index="${i}" aria-label="${card.text}">${matched.has(i) || (selected === i) ? card.text : '?'}</button>
        `).join('')}
      </div>
      ${matched.size === cards.length ? '<p class="match-complete">🎉 All matched!</p>' : ''}
    `;

    $$('.match-card').forEach(btn => {
      const idx = parseInt(btn.dataset.index, 10);
      if (matched.has(idx)) return;
      btn.addEventListener('click', () => {
        if (selected === null) {
          selected = idx;
          btn.textContent = cards[idx].text;
          btn.classList.add('match-card--selected');
        } else if (selected !== idx) {
          const a = cards[selected];
          const b = cards[idx];
          if (a.num === b.num && a.type !== b.type) {
            matched.add(selected);
            matched.add(idx);
            showToast('Match!', 'success', 1200);
          } else {
            showToast('Not a match.', 'info', 1000);
          }
          selected = null;
          render();
        }
      });
    });
  };
  render();
}

/* ============================================================
   COMMAND PALETTE ENGINE
============================================================ */

function openCommandPalette() {
  const palette = $('#command-palette');
  if (!palette) return;
  palette.hidden = false;
  const input = $('#command-palette-input');
  if (input) { input.value = ''; input.focus(); }
  renderCommandElements('');
}

function closeCommandPalette() {
  const palette = $('#command-palette');
  if (palette) palette.hidden = true;
}

function renderCommandElements(query) {
  const list = $('#command-list-elements');
  if (!list) return;

  const results = query.trim() ? searchElements(query).slice(0, 8) : STATE.elements.slice(0, 8);

  list.innerHTML = results.map(el => {
    const info = el.basicInformation;
    return `
      <li role="option" class="command-item" data-element="${info?.atomicNumber}" tabindex="-1" style="--element-color:${categoryColor(el)}">
        <span class="command-item__icon" aria-hidden="true">${info?.symbol || ''}</span>
        <span class="command-item__label">${t(info?.name)}</span>
        <span class="command-item__meta">#${info?.atomicNumber}</span>
      </li>
    `;
  }).join('');
}

/* ============================================================
   TABLE ZOOM & TOUCH/DRAG
============================================================ */

function applyTableZoom(factor) {
  STATE.tableZoom = clamp(STATE.tableZoom * factor, 0.5, 2.5);
  const grid = $('#periodic-table-grid');
  if (grid) grid.style.transform = `scale(${STATE.tableZoom})`;
  const viewport = $('#table-viewport');
  if (viewport) viewport.classList.toggle('table-viewport--zoomed', STATE.tableZoom !== 1);
}

function initTableDrag() {
  const viewport = $('#table-viewport');
  if (!viewport) return;

  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let startY = 0;
  let scrollTop = 0;

  viewport.addEventListener('mousedown', e => {
    if (e.target.closest('.element-block')) return;
    isDown = true;
    viewport.classList.add('table-viewport--dragging');
    startX = e.pageX - viewport.offsetLeft;
    startY = e.pageY - viewport.offsetTop;
    scrollLeft = viewport.scrollLeft;
    scrollTop = viewport.scrollTop;
    e.preventDefault();
  }, { passive: false });

  viewport.addEventListener('mouseleave', () => { isDown = false; viewport.classList.remove('table-viewport--dragging'); });
  viewport.addEventListener('mouseup', () => { isDown = false; viewport.classList.remove('table-viewport--dragging'); });

  viewport.addEventListener('mousemove', e => {
    if (!isDown) return;
    const x = e.pageX - viewport.offsetLeft;
    const y = e.pageY - viewport.offsetTop;
    viewport.scrollLeft = scrollLeft - (x - startX) * 1.2;
    viewport.scrollTop = scrollTop - (y - startY) * 1.2;
  }, { passive: true });

  let touchStartX = 0;
  let touchStartY = 0;
  let touchScrollLeft = 0;
  let touchScrollTop = 0;

  viewport.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchScrollLeft = viewport.scrollLeft;
    touchScrollTop = viewport.scrollTop;
  }, { passive: true });

  viewport.addEventListener('touchmove', e => {
    const dx = touchStartX - e.touches[0].clientX;
    const dy = touchStartY - e.touches[0].clientY;
    viewport.scrollLeft = touchScrollLeft + dx;
    viewport.scrollTop = touchScrollTop + dy;
  }, { passive: true });
}

/* ============================================================
   MODAL SWIPE TO CLOSE (MOBILE)
============================================================ */

function initModalSwipeClose() {
  const panel = $('#modal-panel');
  if (!panel) return;

  let startY = 0;
  let startScroll = 0;

  panel.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    startScroll = panel.scrollTop;
  }, { passive: true });

  panel.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80 && startScroll <= 0) {
      closeModal();
    }
  }, { passive: true });
}

/* ============================================================
   PANEL TOGGLE ENGINE
============================================================ */

function togglePanel(panelId, triggerId) {
  const panel = $(`#${panelId}`);
  const trigger = $(`#${triggerId}`);
  if (!panel) return;

  const isVisible = !panel.hidden;
  $$('.side-panel').forEach(p => { p.hidden = true; });
  $$('.panel-trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));

  if (!isVisible) {
    panel.hidden = false;
    panel.removeAttribute('hidden');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
}

/* ============================================================
   MULTILINGUAL ENGINE
============================================================ */

function setLanguage(lang) {
  STATE.lang = lang;
  localStorage.setItem('qe-lang', lang);
  document.documentElement.setAttribute('data-lang', lang);

  const langToggle = $('#lang-toggle');
  if (langToggle) langToggle.setAttribute('aria-pressed', lang === 'bn' ? 'true' : 'false');

  $$('.element-block').forEach(block => {
    const num = parseInt(block.dataset.atomicNumber, 10);
    const el = STATE.elementMap.get(num);
    if (!el) return;
    const nameEl = block.querySelector('.element-block__name');
    if (nameEl) nameEl.textContent = t(el.basicInformation?.name);
  });

  $$('.filter-btn:not(.filter-btn--all)').forEach(btn => {
    const filter = btn.dataset.filter;
    const cat = STATE.elements.find(el => categoryKey(el) === filter);
    if (cat) btn.lastChild.textContent = t(cat.basicInformation?.category);
  });

  if (STATE.currentElement && !$('#element-modal')?.hidden) {
    populateModalHeader(STATE.currentElement);
    switchModalTab(STATE.activeTab, STATE.currentElement);
  }

  showToast(lang === 'bn' ? 'বাংলায় পরিবর্তিত হয়েছে' : 'Switched to English', 'success');
}

/* ============================================================
   THEME ENGINE
============================================================ */

function setTheme(theme) {
  STATE.theme = theme;
  localStorage.setItem('qe-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('#theme-toggle');
  if (btn) btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
}

function toggleTheme() {
  setTheme(STATE.theme === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   FOOTER INIT
============================================================ */

function initFooter() {
  const yearEl = $('#footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const systemEl = $('#footer-system-info');
  if (systemEl) systemEl.textContent = `${navigator.language} · ${window.innerWidth}×${window.innerHeight}`;

  const countEl = $('#footer-element-count');
  if (countEl) countEl.textContent = STATE.elements.length;
}

/* ============================================================
   KEYBOARD NAVIGATION
============================================================ */

function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    const modal = $('#element-modal');
    const commandPalette = $('#command-palette');
    const advSearch = $('#advanced-search-modal');

    if (e.key === 'Escape') {
      if (commandPalette && !commandPalette.hidden) { closeCommandPalette(); return; }
      if (advSearch && !advSearch.hidden) { advSearch.hidden = true; return; }
      if (modal && !modal.hidden) { closeModal(); return; }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (commandPalette?.hidden === false) closeCommandPalette();
      else openCommandPalette();
      return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (commandPalette && !commandPalette.hidden) {
      const items = $$('.command-item:not([hidden])');
      const focused = document.activeElement?.closest('.command-item');
      const idx = items.indexOf(focused);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[Math.min(idx + 1, items.length - 1)]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx <= 0) $('#command-palette-input')?.focus();
        else items[Math.max(idx - 1, 0)]?.focus();
      } else if (e.key === 'Enter' && focused) {
        focused.click();
      }
      return;
    }

    switch (e.key) {
      case 't': case 'T': toggleTheme(); break;
      case 'l': case 'L': setLanguage(STATE.lang === 'en' ? 'bn' : 'en'); break;
      case 'r': case 'R': openRandomElement(); break;
    }
  });
}

function openRandomElement() {
  if (!STATE.elements.length) return;
  const randomEl = STATE.elements[Math.floor(Math.random() * STATE.elements.length)];
  openModal(randomEl.basicInformation?.atomicNumber);
}

/* ============================================================
   EVENT DELEGATION
============================================================ */

function initEventDelegation() {
  document.addEventListener('click', e => {
    const block = e.target.closest('.element-block');
    if (block) { openModal(block.dataset.atomicNumber); return; }

    const filterBtn = e.target.closest('.filter-btn');
    if (filterBtn) { applyFilter(filterBtn.dataset.filter); return; }

    if (e.target.closest('#modal-close-btn')) { closeModal(); return; }
    if (e.target.closest('#modal-backdrop')) { closeModal(); return; }

    const modalTab = e.target.closest('.modal-tab');
    if (modalTab) { switchModalTab(modalTab.dataset.tab, STATE.currentElement); return; }

    if (e.target.closest('#modal-favorite-btn')) { toggleFavorite(STATE.currentElement?.basicInformation?.atomicNumber); return; }

    const panelTrigger = e.target.closest('.panel-trigger');
    if (panelTrigger) { togglePanel(panelTrigger.getAttribute('aria-controls'), panelTrigger.id); return; }

    const panelClose = e.target.closest('.side-panel__close');
    if (panelClose) {
      const panelId = panelClose.dataset.closes;
      const panel = $(`#${panelId}`);
      if (panel) panel.hidden = true;
      const trigger = $(`[aria-controls="${panelId}"]`);
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      return;
    }

    const clearSlot = e.target.closest('[data-clear-slot]');
    if (clearSlot) {
      const idx = parseInt(clearSlot.dataset.clearSlot, 10);
      STATE.compareSlots[idx] = null;
      renderCompareSlot(idx);
      const wrapper = $('#compare-table-wrapper');
      if (wrapper) wrapper.innerHTML = '';
      return;
    }

    const removeFav = e.target.closest('[data-remove-fav]');
    if (removeFav) {
      const num = parseInt(removeFav.dataset.removeFav, 10);
      STATE.favorites = STATE.favorites.filter(n => n !== num);
      saveLocal('qe-favorites', STATE.favorites);
      renderFavoritesPanel();
      return;
    }

    const panelItem = e.target.closest('.panel-element-item');
    if (panelItem) { openModal(panelItem.dataset.atomicNumber); return; }

    const relatedChip = e.target.closest('.related-element-chip');
    if (relatedChip) { openModal(relatedChip.dataset.atomicNumber); return; }

    const comparisonCard = e.target.closest('.comparison-card');
    if (comparisonCard) {
      const num = comparisonCard.querySelector('[data-atomic-number]')?.dataset.atomicNumber;
      if (num) openModal(num);
      return;
    }

    const suggestion = e.target.closest('.search-suggestion-item');
    if (suggestion) { openModal(suggestion.dataset.atomicNumber); clearSearch(); return; }

    const advResult = e.target.closest('.advanced-result-item');
    if (advResult) {
      openModal(advResult.dataset.atomicNumber);
      const advModal = $('#advanced-search-modal');
      if (advModal) advModal.hidden = true;
      return;
    }

    const commandEl = e.target.closest('.command-item[data-element]');
    if (commandEl) { openModal(commandEl.dataset.element); closeCommandPalette(); return; }

    const commandAction = e.target.closest('.command-item[data-action]');
    if (commandAction) { handleCommandAction(commandAction.dataset.action); closeCommandPalette(); return; }

    if (e.target.closest('#command-palette-backdrop')) { closeCommandPalette(); return; }

    if (e.target.closest('.advanced-search-backdrop')) {
      const advModal = $('#advanced-search-modal');
      if (advModal) advModal.hidden = true;
      return;
    }

    if (e.target.closest('#advanced-search-close')) {
      const advModal = $('#advanced-search-modal');
      if (advModal) advModal.hidden = true;
      return;
    }

    if (e.target.closest('#open-advanced-search')) {
      const advModal = $('#advanced-search-modal');
      if (advModal) { advModal.hidden = false; runAdvancedSearch(); }
      const dropdown = $('#search-suggestions-dropdown');
      if (dropdown) dropdown.hidden = true;
      return;
    }

    if (e.target.closest('#command-palette-trigger')) { openCommandPalette(); return; }

    if (e.target.closest('#mobile-menu-trigger')) {
      const menu = $('#mobile-nav-menu');
      const trigger = $('#mobile-menu-trigger');
      if (menu) {
        const showing = !menu.hidden;
        menu.hidden = showing;
        trigger?.setAttribute('aria-expanded', showing ? 'false' : 'true');
      }
      return;
    }

    if (e.target.closest('#theme-toggle')) { toggleTheme(); return; }
    if (e.target.closest('#lang-toggle')) { setLanguage(STATE.lang === 'en' ? 'bn' : 'en'); return; }
    if (e.target.closest('#hero-random-element')) { openRandomElement(); return; }
    if (e.target.closest('#table-zoom-in')) { applyTableZoom(1.15); return; }
    if (e.target.closest('#table-zoom-out')) { applyTableZoom(1 / 1.15); return; }
    if (e.target.closest('#table-zoom-reset')) {
      STATE.tableZoom = 1;
      const grid = $('#periodic-table-grid');
      if (grid) grid.style.transform = '';
      return;
    }

    if (e.target.closest('#favorites-clear')) {
      STATE.favorites = [];
      saveLocal('qe-favorites', STATE.favorites);
      renderFavoritesPanel();
      return;
    }

    if (e.target.closest('#recent-clear')) {
      STATE.recent = [];
      saveLocal('qe-recent', STATE.recent);
      renderRecentPanel();
      return;
    }

    if (e.target.closest('#compare-clear')) {
      STATE.compareSlots = [null, null];
      renderCompareSlot(0);
      renderCompareSlot(1);
      const wrapper = $('#compare-table-wrapper');
      if (wrapper) wrapper.innerHTML = '';
      return;
    }

    if (e.target.closest('#filter-reset')) { applyFilter('all'); return; }
    if (e.target.closest('#atom-ctrl-spin')) { STATE.atomAnimation.spin = !STATE.atomAnimation.spin; return; }

    const quizOption = e.target.closest('.quiz-option:not([disabled])');
    if (quizOption) { handleQuizOption(quizOption); return; }

    if (e.target.closest('#quiz-understood')) {
      STATE.quizState.current++;
      STATE.quizState.answered = false;
      STATE.quizState.selectedOption = -1;
      renderQuizQuestion();
      return;
    }

    if (e.target.closest('#quiz-restart')) { renderQuizTab(STATE.currentElement); return; }

    const flashcard = e.target.closest('.flashcard');
    if (flashcard && !e.target.closest('.flashcard__next')) {
      flashcard.classList.toggle('flashcard--flipped');
      return;
    }

    if (e.target.closest('#flashcard-next')) {
      const lmc = $('#learning-mode-content');
      if (lmc) {
        STATE.flashcardIndex = (STATE.flashcardIndex + 1) % STATE.elements.length;
        renderFlashcard(lmc, STATE.elements[STATE.flashcardIndex]);
      }
      return;
    }

    const learnModeBtn = e.target.closest('.learning-mode-btn');
    if (learnModeBtn) { renderLearningModeContent(learnModeBtn.dataset.mode); return; }

    const learningCard = e.target.closest('.learning-card');
    if (learningCard) { learningCard.classList.toggle('learning-card--flipped'); return; }

    const compSlotBtn = e.target.closest('[data-add-to-compare]');
    if (compSlotBtn && STATE.currentElement) {
      const slot = parseInt(compSlotBtn.dataset.addToCompare, 10);
      setCompareSlot(slot, STATE.currentElement);
      togglePanel('panel-compare', 'trigger-compare');
      return;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const block = e.target.closest('.element-block');
      if (block) { e.preventDefault(); openModal(block.dataset.atomicNumber); }
    }
  });

  const searchInput = $('#navbar-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => debouncedSearch(e.target.value));
    searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });
  }

  ['filter-atomic-min','filter-atomic-max','filter-period','filter-block','filter-phase','filter-radioactive'].forEach(id => {
    $(`#${id}`)?.addEventListener('change', () => {
      if (!$('#advanced-search-modal')?.hidden) runAdvancedSearch();
    });
  });

  const cmdInput = $('#command-palette-input');
  if (cmdInput) {
    cmdInput.addEventListener('input', e => renderCommandElements(e.target.value));
  }
}

function handleCommandAction(action) {
  switch (action) {
    case 'toggle-theme': toggleTheme(); break;
    case 'toggle-lang': setLanguage(STATE.lang === 'en' ? 'bn' : 'en'); break;
    case 'random-element': openRandomElement(); break;
    case 'open-compare': togglePanel('panel-compare', 'trigger-compare'); break;
    case 'open-learning': togglePanel('panel-learning', 'trigger-learning'); break;
  }
}

/* ============================================================
   HERO PARTICLE FIELD
============================================================ */

function initHeroParticleField() {
  const field = $('#hero-particle-field');
  if (!field) return;
  const SYMBOLS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca'.split(' ');
  for (let i = 0; i < 12; i++) {
    const span = document.createElement('span');
    span.className = 'hero-floating-symbol';
    span.textContent = SYMBOLS[i % SYMBOLS.length];
    span.style.cssText = `
      left: ${Math.random() * 90}%;
      top: ${Math.random() * 100}%;
      animation-delay: ${Math.random() * 6}s;
      animation-duration: ${6 + Math.random() * 8}s;
      opacity: ${0.05 + Math.random() * 0.15};
      font-size: ${0.8 + Math.random() * 1.2}rem;
    `;
    field.appendChild(span);
  }
}

/* ============================================================
   HERO STAT COUNTER ANIMATION
============================================================ */

function animateHeroStats(elements) {
  const categories = new Set(elements.map(el => categoryKey(el))).size;
  const stats = {
    'elements': elements.length,
    'datapoints': elements.length * 90,
    'languages': 2,
    'categories': categories,
  };

  $$('[data-stat]').forEach(el => {
    const key = el.dataset.stat;
    if (!(key in stats)) return;
    const target = stats[key];
    const isLarge = target > 999;
    if (isLarge) { el.textContent = `${(target / 1000).toFixed(1)}K+`; return; }
    let current = 0;
    const step = Math.ceil(target / 30);
    const interval = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current;
      if (current >= target) clearInterval(interval);
    }, 40);
  });
}

/* ============================================================
   MAIN INITIALIZATION
============================================================ */

async function init() {
  console.log('[QuantumElements] শুরু হচ্ছে…');

  // থিম ও ভাষা প্রয়োগ
  document.documentElement.setAttribute('data-theme', STATE.theme);
  document.documentElement.setAttribute('data-lang', STATE.lang);

  initParticleBackground();
  initHeroParticleField();

  updateLoader(5, 0, 1);

  try {
    console.log('[QuantumElements] ডেটা লোড শুরু হচ্ছে…');
    console.log(`[QuantumElements] manifest পথ: ${CONFIG.MANIFEST}`);
    console.log(`[QuantumElements] data ফোল্ডার: ${CONFIG.DATA_BASE}`);

    const elements = await DataEngine.loadAllElements((progress, loaded, total) => {
      updateLoader(progress, loaded, total);
    });

    console.log(`[QuantumElements] ✅ মোট ${elements.length}টি element লোড সম্পন্ন!`);

    STATE.elements = elements;
    elements.forEach(el => {
      STATE.elementMap.set(el.basicInformation?.atomicNumber, el);
    });

    updateLoader(95, elements.length, elements.length);

    renderGroupNumbers();
    renderPeriodNumbers();
    renderPeriodicTable();
    buildCategoryFilters();
    renderFavoritesPanel();
    renderRecentPanel();
    renderLearningSectionCards();
    renderLearningModeContent('flashcard');
    animateHeroStats(elements);
    initFooter();
    initTableDrag();
    initModalSwipeClose();
    initEventDelegation();
    initKeyboardNav();

    updateLoader(100, elements.length, elements.length);
    setTimeout(hideLoader, 600);

    document.dispatchEvent(new CustomEvent('quantumElementsReady', {
      detail: { elementCount: elements.length }
    }));

    console.log('[QuantumElements] 🚀 সম্পূর্ণ প্রস্তুত!');

  } catch (error) {
    // =========================================================
    // এখানে এক্সাক্টলি কোথায় সমস্যা তা স্ক্রিনে দেখাবে
    // =========================================================
    console.error('[QuantumElements] ❌ ইনিশিয়ালাইজেশন ব্যর্থ:', error);

    showDetailedError(
      'ডেটা লোড করা যায়নি',
      error.message || 'অজানা এরর',
      'data/ ফোল্ডারে 1.json আছে কিনা দেখুন। manifest.json এ {"elements":[1]} থাকা দরকার।'
    );

    showToast('ডেটা লোড ব্যর্থ হয়েছে। স্ক্রিনের এরর বার্তা পড়ুন।', 'error', 10000);
  }
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}