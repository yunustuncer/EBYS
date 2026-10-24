// ==UserScript==
// @name         Emlak Beyan Sorgulama PRO
// @namespace    https://tampermonkey.net/
// @version      5.1.0
// @description  Canlı sorgu, TC/Vergi no doğrulama, kimlik maskeleme, malik özeti, tahakkuk/borç, resmî Rayiç Bedel Raporu (PDF) ve ayrıntılı tanılama günlüğü tek arayüzde.
// @match        *://bys.belsoft.com.tr/*
// @include      /^https?:\/\/bys\.belsoft\.com\.tr(:\d+)?\/.*$/i
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const VER = '5.1.0';

  /* ====================================================================
   * YAPILANDIRMA — ana site güncellenirse önce burayı kontrol edin.
   * Tanılama raporundaki "dom" ve "sağlık" bölümleri hangi adın
   * değiştiğini gösterir.
   * ==================================================================== */
  const CFG = {
    endpoints: { query: 'GetEstateDeclarationsByRegistryAndEstateInfo', accrual: 'GetDeclarationAccrumentDetail', refresh: 'VerifyAndGenerateToken' },
    idCode: { tc: '1', vergi: '2', sicil: '3', parsel: '4' },
    queryDefaults: { isOnlyActive: true, year: 1990, month: 1, day: 1, declarationStatus: '1' },
    labels: { ada: 'Ada', parsel: 'Parsel', id: 'TC Kimlik/Vergi/Sicil No', run: 'Sorgula', report: 'Rayiç Bedel Raporu', pageMarkers: ['Rapor Tipi', 'Sorgula'] },
    timeouts: { query: 45000, api: 30000, report: 120000 },
    storage: { token: 'accessToken', refresh: 'refreshToken', user: 'userName', url: 'Url' },
    crit: ['Oid', 'Estate.BlockOfBuildings', 'Estate.Parcel', 'DeclarationRegistry.Registry', 'DeclarationStatus.ParameterName', 'Estate.EstateType.TypeName', 'DeclarationAcceptenceDate'],
    core: ['tc', 'name', 'type', 'status', 'ada', 'parsel'],
    reports: { keep: 20 }   // kalıcı saklanacak rapor sayısı
  };

  /* ====================================================================
   * 0) TEMEL YARDIMCILAR + OLAY GÜNLÜĞÜ (document-start'ta kurulur)
   * ==================================================================== */
  const safeJson = o => { try { return JSON.stringify(o); } catch (e) { return String(o); } };
  // 10-11 haneli kimlik benzeri sayıları günlüklerde maskeler (lookbehind kullanmaz: eski tarayıcılarda da çalışır)
  const maskNums = s => String(s == null ? '' : s).replace(/(^|\D)(\d{3})\d{5,6}(\d{2})(?!\d)/g, '$1$2*****$3');
  const store = st => ({
    get(k, d) { try { const v = st.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { st.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  });
  // Depolama erişimi engelliyse (çerez/site verisi kapalı) betik çökmesin
  const pickStorage = k => { try { return window[k]; } catch (e) { return null; } };
  const LS = store(pickStorage('localStorage')), SS = store(pickStorage('sessionStorage'));

  const JR = [];
  try { const old = LS.get('emz5-journal', []); (Array.isArray(old) ? old : []).forEach(e => { e.old = true; JR.push(e); }); } catch (e) { /* yoksay */ }
  let jrDirty = false;
  function jlog(lvl, cat, msg, d) {
    try {
      const m = maskNums(String(msg == null ? '' : msg)).slice(0, 600);
      const last = JR[JR.length - 1];
      if (last && !last.old && last.cat === cat && last.msg === m && last.lvl === lvl && Date.now() - last.ts < 3000) { last.n = (last.n || 1) + 1; jrDirty = true; return; }
      JR.push({ ts: Date.now(), lvl, cat, msg: m, d: d === undefined ? undefined : maskNums(typeof d === 'string' ? d : safeJson(d)).slice(0, 2500) });
      if (JR.length > 500) JR.shift();
      jrDirty = true;
    } catch (e) { /* yoksay */ }
  }
  const flushJr = () => { if (jrDirty) { jrDirty = false; LS.set('emz5-journal', JR.slice(-250).map(r => { const c = Object.assign({}, r); delete c.old; if (c.d) c.d = String(c.d).slice(0, 500); return c; })); } };
  setInterval(flushJr, 3000);
  window.addEventListener('pagehide', flushJr);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushJr(); });

  window.addEventListener('error', ev => {
    if (ev.target && ev.target !== window && ev.target.tagName) { jlog('warn', 'kaynak', 'Yüklenemeyen kaynak: ' + (ev.target.src || ev.target.href || ev.target.tagName)); return; }
    jlog('error', 'js', ev.message || 'Betik hatası', { src: String(ev.filename || '').split('/').pop() + ':' + ev.lineno + ':' + ev.colno, stack: ev.error && ev.error.stack ? String(ev.error.stack).split('\n').slice(0, 4).join(' | ') : '' });
  }, true);
  window.addEventListener('unhandledrejection', ev => {
    const r = ev.reason;
    jlog('error', 'promise', (r && r.message) || String(r), r && r.stack ? String(r.stack).split('\n').slice(0, 4).join(' | ') : undefined);
  });
  ['error', 'warn'].forEach(k => {
    const o = console[k];
    console[k] = function () {
      try { jlog(k === 'error' ? 'warn' : 'info', 'konsol', [].map.call(arguments, a => (a instanceof Error ? a.message : typeof a === 'object' ? safeJson(a) : String(a))).join(' ').slice(0, 400)); } catch (e) { /* yoksay */ }
      return o.apply(this, arguments);
    };
  });
  jlog('info', 'sistem', 'Betik başlatıldı v' + VER, location.pathname);

  /* ====================================================================
   * 1) AĞ YAKALAYICI — JSON/PDF cevapları. PDF'e dokunulmaz.
   * ==================================================================== */
  const LOG = [], PDFS = [];
  let SEQ = 0, pending = 0, selfBlob = false;
  const NET = { own: false };
  const seenBlobs = new WeakSet();
  const isPdfType = t => /pdf|octet-stream/i.test(t || '');
  const epName = u => String(u).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '').replace(/^.*\/api\//, '');

  function save(url, method, body, status, text, t0, x) {
    x = x || {};
    const ms = Math.round(performance.now() - t0);
    let bodyKeys;
    if (typeof body === 'string' && body[0] === '{') { try { bodyKeys = Object.keys(JSON.parse(body)); } catch (e) { /* yoksay */ } }
    const e = {
      seq: ++SEQ, ts: Date.now(), time: new Date().toLocaleTimeString('tr-TR'), url: String(url), method: String(method || 'GET').toUpperCase(),
      body: body ? maskNums(body).slice(0, 3000) : null, bodyKeys, status, ms, size: text ? text.length : 0, own: !!x.own, aborted: !!x.aborted, err: x.err || '', ct: x.ct || '',
      preview: text ? maskNums(text.slice(0, 6000)) : ''
    };
    LOG.push(e); if (LOG.length > 150) LOG.shift();
    const ep = epName(e.url);
    if (x.aborted) jlog('info', 'ağ', 'İptal: ' + ep);
    else if (status === 0) jlog('error', 'ağ', 'Ağ hatası: ' + e.method + ' ' + ep, x.err);
    else if (status >= 400) jlog('error', 'ağ', 'HTTP ' + status + ' ' + e.method + ' ' + ep, e.preview.slice(0, 600));
    else if (ms > 15000) jlog('warn', 'ağ', 'Yavaş yanıt (' + ms + ' ms): ' + ep);
    else if (/\/api\//.test(e.url)) jlog('debug', 'ağ', e.method + ' ' + ep + ' → ' + status + ' (' + ms + ' ms, ' + (e.size / 1024).toFixed(1) + ' KB)' + (e.own ? ' [PRO]' : ''));
    return e;
  }
  // application/pdf olmayan (octet-stream) yanıtlar yalnızca "%PDF-" imzası varsa PDF sayılır
  function pushPdf(blob, url) {
    if (!blob || seenBlobs.has(blob) || !(blob.size > 500)) return;
    seenBlobs.add(blob);
    const trusted = /pdf/i.test(blob.type);
    const check = trusted ? Promise.resolve(true) : (typeof blob.slice === 'function' ? blob.slice(0, 5).text().then(t => t === '%PDF-', () => false) : Promise.resolve(false));
    check.then(ok => {
      if (!ok) return;
      const b = trusted ? blob : new Blob([blob], { type: 'application/pdf' });
      seenBlobs.add(b);
      PDFS.push({ seq: ++SEQ, time: Date.now(), blob: b, size: b.size, url: String(url || '') });
      if (PDFS.length > 12) PDFS.shift();
      jlog('info', 'pdf', 'PDF yakalandı (' + (b.size / 1024).toFixed(0) + ' KB)', epName(url));
    });
  }

  const _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const body = init && typeof init.body === 'string' ? init.body : null;
      const own = NET.own, t0 = performance.now();
      pending++;
      let p;
      try { p = _fetch.apply(this, arguments); } catch (e) { pending--; throw e; }
      return p.then(res => {
        let c;
        try { c = res.clone(); } catch (e) { pending--; save(url, method, body, res.status, '', t0, { own }); return res; }
        const ct = (c.headers && c.headers.get('content-type')) || '';
        if (isPdfType(ct)) {
          c.blob().then(b => { pushPdf(b, url); save(url, method, body, res.status, '[PDF ' + b.size + ' B]', t0, { own, ct }); }).catch(() => {}).finally(() => { pending--; });
        } else if (/^(image|font|video|audio)\//i.test(ct)) {
          pending--; save(url, method, body, res.status, '[ikili ' + ct + ']', t0, { own, ct });
        } else {
          c.text().then(tx => save(url, method, body, res.status, tx, t0, { own, ct })).catch(() => {}).finally(() => { pending--; });
        }
        return res;
      }, err => { pending--; save(url, method, body, 0, '', t0, { own, err: err && err.message, aborted: !!(err && err.name === 'AbortError') }); throw err; });
    };
  }

  const _open = XMLHttpRequest.prototype.open, _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__emz = { method: m, url: String(u) }; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    const e = this.__emz;
    if (e) {
      pending++;
      e.aborted = false;
      const t0 = performance.now();
      this.addEventListener('abort', () => { e.aborted = true; });
      this.addEventListener('loadend', () => {
        try {
          let tx = '';
          const rt = this.responseType;
          if (rt === '' || rt === 'text') tx = this.responseText;
          else if (rt === 'json') tx = JSON.stringify(this.response);
          else if (rt === 'blob' && this.response) {
            const bl = this.response;
            if (isPdfType(bl.type || this.getResponseHeader('content-type'))) pushPdf(bl, e.url);
            tx = '[BLOB ' + bl.size + ' B]';
          } else if (rt === 'arraybuffer' && this.response) {
            if (isPdfType(this.getResponseHeader('content-type'))) pushPdf(new Blob([this.response], { type: 'application/pdf' }), e.url);
            tx = '[BUFFER]';
          }
          save(e.url, e.method, typeof b === 'string' ? b : null, this.status, tx, t0, this.status === 0 ? { err: 'XHR bağlantı hatası veya iptal', aborted: e.aborted } : {});
        } catch (_) { /* yoksay */ }
        pending = Math.max(0, pending - 1);
      });
    }
    try { return _send.apply(this, arguments); } catch (err) { if (e) pending = Math.max(0, pending - 1); throw err; }
  };

  const _cou = URL.createObjectURL;
  URL.createObjectURL = function (o) {
    try { if (!selfBlob && o instanceof Blob && /pdf/i.test(o.type)) pushPdf(o, 'blob-url'); } catch (e) { /* yoksay */ }
    return _cou.apply(this, arguments);
  };
  // Kendi oluşturduğumuz blob adresleri yakalayıcıya girmez (orijinal işlev doğrudan çağrılır)
  const ownBlobUrl = b => _cou.call(URL, b);

  /* ---------- Kalıcı rapor deposu (IndexedDB) ---------- */
  const RDB = (() => {
    const DB = 'emz5-reports', ST = 'reports';
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      try {
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(ST)) rq.result.createObjectStore(ST, { keyPath: 'id' }); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error || new Error('IndexedDB açılamadı'));
        rq.onblocked = () => rej(new Error('IndexedDB engellendi'));
      } catch (e) { rej(e); }
    }).catch(e => { dbp = null; jlog('warn', 'depo', 'IndexedDB açılamadı: ' + (e && e.message)); throw e; }));
    const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction(ST, mode), rq = fn(t.objectStore(ST));
      t.oncomplete = () => res(rq ? rq.result : undefined);
      t.onerror = t.onabort = () => rej(t.error || new Error('Depo işlemi başarısız'));
    }));
    return {
      put: rec => run('readwrite', s => s.put(rec)),
      all: () => run('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.ts - x.ts)),
      del: id => run('readwrite', s => s.delete(id)),
      clear: () => run('readwrite', s => s.clear()),
      prune: keep => RDB.all().then(a => Promise.all(a.slice(keep).map(r => RDB.del(r.id))))
    };
  })();

  /* ====================================================================
   * 2) SAYFA ALGILAMA
   * ==================================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const rootText = () => { const r = $('#root'); return r ? r.textContent || '' : ''; };
  const onQueryPage = () => { const t = rootText(); return CFG.labels.pageMarkers.every(m => t.includes(m)); };

  let started = false, waited = 0, pill = null;
  function makePill(txt) {
    if (pill || !document.body) return;
    pill = document.createElement('button');
    pill.textContent = txt;
    pill.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;padding:8px 14px;border:0;border-radius:9px;background:#0f766e;color:#fff;font:600 12px system-ui;cursor:pointer;opacity:.85';
    pill.onclick = () => boot(true);
    document.body.appendChild(pill);
  }
  function boot(forced) {
    if (started) return;
    started = true;
    if (pill) { pill.remove(); pill = null; }
    try { init(); jlog('info', 'sistem', 'Arayüz kuruldu' + (forced ? ' (elle başlatıldı)' : '')); }
    catch (e) {
      jlog('error', 'init', 'Arayüz kurulamadı: ' + e.message, e.stack ? String(e.stack).split('\n').slice(0, 5).join(' | ') : '');
      document.documentElement.classList.remove('emz-on');
      const d = document.getElementById('emz'); if (d) d.remove();
      started = false;
      makePill('PRO paneli yeniden başlat');   // kurulum başarısızsa elle yeniden denenebilsin
    }
  }
  const poll = setInterval(() => {
    if (started) return clearInterval(poll);
    if (!document.body) return;
    if (onQueryPage()) { clearInterval(poll); return boot(false); }
    waited += 600;
    if (waited === 24000) {
      const t = rootText();
      jlog('warn', 'algılama', 'Sorgu sayfası algılanamadı (işaretçiler: ' + CFG.labels.pageMarkers.join(', ') + ')', t.slice(0, 300));
      if (t.includes('Parsel')) makePill('PRO paneli başlat');
    }
  }, 600);

  /* ====================================================================
   * 3) ORTAK FONKSİYONLAR
   * ==================================================================== */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const trl = s => String(s == null ? '' : s).toLocaleLowerCase('tr-TR');
  const normL = s => trl(s).replace(/[:*\s]+/g, ' ').trim();
  const f2 = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const g = (o, p) => { try { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); } catch (e) { return undefined; } };
  const UI = { showId: true };
  const maskId = s => (s && s.length >= 8 ? s.slice(0, 3) + '*'.repeat(s.length - 5) + s.slice(-2) : s || '');
  const maskRaw = (k, v) => (!UI.showId && /(identity|tax|tckn|vergi|sicil)/i.test(k) && /^\d{8,}$/.test(String(v)) ? maskId(String(v)) : v);
  const COLL = new Intl.Collator('tr', { numeric: true, sensitivity: 'accent' });

  function num(s) {
    if (typeof s === 'number') return s;
    if (s == null || s === '') return NaN;
    s = String(s).trim();
    if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return parseFloat(s);
  }
  function trDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
    if (!m || m[1] === '0001' || m[1] === '1900') return '';
    return m[3] + '.' + m[2] + '.' + m[1];
  }
  const dateKey = v => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(v || ''); return m ? +(m[3] + m[2] + m[1]) : 0; };
  function tcknOk(s) {
    if (!/^[1-9]\d{10}$/.test(s)) return false;
    const d = s.split('').map(Number);
    const a = (d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7]);
    return ((a % 10) + 10) % 10 === d[9] && d.slice(0, 10).reduce((x, y) => x + y, 0) % 10 === d[10];
  }
  function vknOk(s) {
    if (!/^\d{10}$/.test(s)) return false;
    const d = s.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const t = (d[i] + (9 - i)) % 10;
      let v = (t * Math.pow(2, 9 - i)) % 9;
      if (t !== 0 && v === 0) v = 9;
      sum += v;
    }
    return (10 - (sum % 10)) % 10 === d[9];
  }
  // vkn=true → kullanıcı "Vergi / Sicil No" kutusunu işaretledi. Aksi halde: geçerli 11 hane = TC, 10 hane = Vergi.
  function idCheck(raw, vkn) {
    const v = String(raw || '').replace(/[\s.\-_]/g, '');
    if (!v) return { empty: true, ok: false, v: '', kind: null, msg: '', tone: '' };
    if (!/^\d+$/.test(v)) return { ok: false, v, kind: null, msg: 'Yalnızca rakam girilebilir', tone: 'bad' };
    if (v.length > 11) return { ok: false, v, kind: null, msg: 'En çok 11 hane girilebilir (' + v.length + ' hane)', tone: 'bad' };
    if (vkn) {
      if (v.length === 10) return vknOk(v) ? { ok: true, v, kind: 'vergi', msg: '✔ Geçerli Vergi No', tone: 'ok' } : { ok: true, v, kind: 'vergi', msg: 'Vergi No doğrulama basamağı uyuşmuyor (yine de sorgulanır; bulunamazsa sicil no olarak denenir)', tone: 'warn' };
      return { ok: true, v, kind: 'sicil', msg: v.length + ' hane · Sicil No olarak sorgulanacak', tone: 'mu' };
    }
    if (v.length === 11) return tcknOk(v) ? { ok: true, v, kind: 'tc', msg: '✔ Geçerli TC kimlik no', tone: 'ok' } : { ok: false, v, kind: 'tc', msg: 'Geçersiz TC kimlik no. Vergi/Sicil No ise sağdaki kutuyu işaretleyin', tone: 'bad' };
    if (v.length === 10) return vknOk(v) ? { ok: true, v, kind: 'vergi', msg: '✔ 10 hane · Vergi No olarak sorgulanacak', tone: 'ok' } : { ok: true, v, kind: 'vergi', msg: '10 hane · Vergi No olarak sorgulanacak (doğrulama basamağı uyuşmuyor)', tone: 'warn' };
    return { ok: false, v, kind: 'tc', msg: 'TC 11 haneli olmalı (' + v.length + '/11). Vergi/Sicil No ise sağdaki kutuyu işaretleyin', tone: 'mu' };
  }

  /* ---------- Veri modeli ---------- */
  const regOf = j => g(j, 'DeclarationRegistry.Registry') || {};
  function idOf(reg) {
    const ri = reg && reg.RegistryInfo; if (!ri) return '';
    const t = reg.RegistryType || reg.SubscriberType;
    if (t === 'G' || t === 'Y') return ri.IdentityNumber || '';
    if (t === 'T' || t === 'K' || t === 'D') return ri.TaxNumber || '';
    return ri.IdentityNumber || ri.TaxNumber || '';
  }
  function nameOf(reg) {
    const ri = reg && reg.RegistryInfo; if (!ri) return '';
    const t = reg.RegistryType || reg.SubscriberType;
    const full = (a, b) => [a, b].filter(Boolean).join(' ').trim();
    if (t === 'G') return full(ri.Name, ri.SurName);
    if (t === 'Y') return full(ri.Name, ri.Surname);
    if (t === 'K' || t === 'T' || t === 'D' || ri.Title) return ri.Title || full(ri.Name, ri.SurName);
    return full(ri.Name, ri.SurName);
  }
  function doorOf(j) {
    const a = g(j, 'Estate.AddressSource') || {};
    const o = (a.OuterDoorNumber || '').trim(), i = (a.InnerDoorNumber || '').trim();
    return o && i ? o + ' / ' + i : o || (i ? '/ ' + i : '');
  }
  const COLS = [
    { key: 'tc', label: 'TC / Vergi / Sicil No', type: 'text', get: j => idOf(regOf(j)) },
    { key: 'name', label: 'Ad Soyad / Unvan', type: 'text', get: j => nameOf(regOf(j)) },
    { key: 'type', label: 'Beyan türü', type: 'text', get: j => g(j, 'Estate.EstateType.TypeName') },
    { key: 'usage', label: 'Beyan tipi', type: 'text', get: j => g(j, 'EstateDeclarationBuilding.EstateUsageType.UsageTypeName') || g(j, 'EstateDeclarationBuilding.UsageType.SubTypeName') },
    { key: 'declType', label: 'Beyan şekli', type: 'text', get: j => g(j, 'DeclarationType.ParameterName') },
    { key: 'order', label: 'Sıra', type: 'num', get: j => j.DeclarationOrder },
    { key: 'date', label: 'Beyan tarihi', type: 'date', get: j => trDate(j.DeclarationAcceptenceDate) },
    { key: 'acq', label: 'Edinme tarihi', type: 'date', get: j => trDate(j.AcqusitionDate) },
    { key: 'status', label: 'Durum', type: 'text', get: j => g(j, 'DeclarationStatus.ParameterName') },
    { key: 'book', label: 'Cilt', type: 'num', get: j => g(j, 'Estate.BookNo') },
    { key: 'page', label: 'Sayfa', type: 'num', get: j => g(j, 'Estate.PageNo') },
    { key: 'ada', label: 'Ada', type: 'num', get: j => g(j, 'Estate.BlockOfBuildings') },
    { key: 'parsel', label: 'Parsel', type: 'num', get: j => g(j, 'Estate.Parcel') },
    { key: 'section', label: 'Bağımsız bölüm', type: 'text', get: j => g(j, 'Estate.DetachedSectionNo') },
    { key: 'floor', label: 'Kat', type: 'text', get: j => g(j, 'Estate.FloorNo') },
    { key: 'qual', label: 'Nitelik', type: 'text', get: j => g(j, 'Estate.Qualification') },
    { key: 'door', label: 'Dış / İç kapı', type: 'text', get: doorOf },
    { key: 'landFrac', label: 'Hisse pay / payda', type: 'text', get: j => { const p = g(j, 'Estate.LandPortion'), d = g(j, 'Estate.LandDenominator'); return d ? p + ' / ' + d : ''; } },
    { key: 'share', label: 'BB Hisse', type: 'text', get: j => (j.ShareHolderDenominator ? j.ShareHolderPortion + '/' + j.ShareHolderDenominator : '') },
    { key: 'land', label: 'Taşınmaz alanı (m²)', type: 'area', get: j => g(j, 'Estate.LandArea') },
    { key: 'landShare', label: 'Hisse (m²)', type: 'area', get: j => (j.LandShareArea != null ? j.LandShareArea : g(j, 'Estate.LandShareArea')) },
    { key: 'build', label: 'Bina alanı (m²)', type: 'area', get: j => g(j, 'EstateDeclarationBuilding.BuildingArea') },
    { key: 'debt', label: 'Beyan borç', type: 'money', get: j => j.DeclarationDebt },
    { key: 'value', label: 'Rayiç / güncel değer', type: 'money', get: j => j.CurrentMarketValue },
    { key: 'exempt', label: 'Muafiyet', type: 'text', get: j => g(j, 'Exemption.ExemptionName') },
    { key: 'penalty', label: 'Cezalı', type: 'text', get: j => (j.IsThereAPenalty ? 'Evet' : '') },
    { key: 'district', label: 'Mahalle / Köy', type: 'text', get: j => g(j, 'Estate.AddressSource.DistrictName') },
    { key: 'addr', label: 'Adres', type: 'text', get: j => g(j, 'Estate.AddressSource.AddressString') }
  ];
  const COL = Object.fromEntries(COLS.map(c => [c.key, c]));
  const DEFAULT_SHOWN = ['tc', 'name', 'district', 'ada', 'parsel', 'floor', 'section', 'share', 'qual', 'land', 'landFrac', 'landShare', 'date', 'status', 'value'];
  const DEFAULT_HIDDEN = COLS.map(c => c.key).filter(k => !DEFAULT_SHOWN.includes(k));
  // Sütun sırası: önce DEFAULT_SHOWN sırası, kalanlar eski sırasıyla
  const _ord = COLS.map(c => c.key);
  COLS.sort((a, b) => {
    const ra = DEFAULT_SHOWN.indexOf(a.key), rb = DEFAULT_SHOWN.indexOf(b.key);
    return (ra < 0 ? 1000 + _ord.indexOf(a.key) : ra) - (rb < 0 ? 1000 + _ord.indexOf(b.key) : rb);
  });
  const GROUPS = [
    ['Malik', ['tc', 'name']], ['Tapu', ['book', 'page', 'ada', 'parsel', 'section', 'floor', 'qual', 'door', 'landFrac', 'share']],
    ['Beyan', ['type', 'usage', 'declType', 'order', 'date', 'acq', 'status']], ['Alan', ['land', 'landShare', 'build']],
    ['Mali durum', ['debt', 'value', 'exempt', 'penalty']], ['Adres', ['district', 'addr']]
  ];
  function fmt(c, v, raw) {
    if (v == null || v === '') return '—';
    if (c.key === 'tc' && !raw && !UI.showId) return maskId(String(v));
    if (c.type === 'area') { const n = num(v); return isNaN(n) ? v : f2(n); }
    if (c.type === 'money') { const n = num(v); return isNaN(n) ? v : f2(n) + ' ₺'; }
    return String(v);
  }
  const disp = (c, v) => (v == null || v === '' ? '' : fmt(c, v));
  const plain = (c, v) => (v == null || v === '' ? '' : fmt(c, v, true));
  function sortKey(c, v) {
    if (c.type === 'num' || c.type === 'area' || c.type === 'money') { const n = num(v); return isNaN(n) ? String(v == null ? '' : v) : n; }
    if (c.type === 'date') return dateKey(v);
    return trl(v);
  }
  // Karışık (sayı/metin) anahtarları güvenle karşılaştırır; metinlerde doğal sıralama (2 < 10) kullanılır
  const cmpKey = (A, B) => {
    const sa = typeof A === 'string', sb = typeof B === 'string';
    if (sa && sb) return COLL.compare(A, B);
    if (sa) return 1;          // metin (sayıya çevrilemeyen) sona
    if (sb) return -1;
    return A > B ? 1 : A < B ? -1 : 0;
  };

  const SHARE_TOL = 0.011; // m² cinsinden izin verilen fark (yuvarlama payı)
  function shareCheck(j) {
    const area = num(g(j, 'Estate.LandArea')), p = num(g(j, 'Estate.LandPortion')), d = num(g(j, 'Estate.LandDenominator'));
    const act = num(j.LandShareArea != null ? j.LandShareArea : g(j, 'Estate.LandShareArea'));
    if ([area, p, d, act].some(isNaN) || !d) return { s: 'na', msg: '' };
    const calc = area * p / d, diff = Math.abs(calc - act), ok = diff <= SHARE_TOL;
    return { s: ok ? 'ok' : 'bad', area, p, d, calc, act, diff, msg: (ok ? '✔ Tutuyor' : '✖ Tutmuyor') + ': ' + f2(area) + ' × ' + p + '/' + d + ' = ' + f2(calc) + ' m²' };
  }
  const chkCls = r => {
    if (r._chk && r._chk.s === 'bad') return ' chk-bad';   // hisse tutmuyor: kırmızı en önde
    if (r._debt) return ' chk-debt';                        // borçlu: sarı
    return r._chk && r._chk.s === 'ok' ? ' chk-ok' : '';    // tutuyor: yeşil
  };

  const tipHtml = (r, td) => {
    const sec = (cls, ic, title, body) => '<div class="tp-s ' + cls + '"><div class="tp-t"><span>' + ic + '</span>' + esc(title) + '</div>' + (body || '') + '</div>';
    const kv = (k, v) => '<div class="tp-r"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
    let n = 0, h = '';
    const c = r._chk;
    if (r._debt) {
      n++;
      h += sec('debt', '⚠', 'Beyan borcu: ' + f2(num(r.debt)) + ' ₺', '');
    }
    if (c && c.s === 'bad') {
      n++;
      h += sec('bad', '✖', 'Hisse hesabı tutmuyor',
        kv('Taşınmaz alanı × pay/payda', f2(c.area) + ' × ' + c.p + '/' + c.d) + kv('Hesaplanan', f2(c.calc) + ' m²') +
        kv('Kayıttaki', f2(c.act) + ' m²') + kv('Fark', f2(c.diff) + ' m²'));
    } else if (c && c.s === 'ok') {
      n++;
      h += sec('ok', '✔', 'Hisse tutuyor: ' + f2(c.area) + ' × ' + c.p + '/' + c.d + ' = ' + f2(c.calc) + ' m²', '');
    }
    const extra = [];
    if (r.penalty) extra.push(kv('Ceza', 'Cezalı beyan'));
    if (r.exempt) extra.push(kv('Muafiyet', r.exempt));
    if (td && td.dataset.c && td.scrollWidth > td.clientWidth + 1) { const cc = COL[td.dataset.c]; extra.push(kv(cc.label, disp(cc, r[cc.key]))); }
    if (extra.length) { n++; h += sec('info', 'ℹ', 'Ek bilgi', extra.join('')); }
    if (!n) return '';
    return '<div class="tp-h"><b>' + esc(r.name || '—') + '</b><small>Ada ' + esc(r.ada) + ' / Parsel ' + esc(r.parsel) + (r.tc ? ' · ' + esc(fmt(COL.tc, r.tc)) : '') + '</small></div>' + h;
  };

  function mapRow(j, i) {
    const r = { _id: String(j.Oid != null ? j.Oid : 'i' + i), _j: j, _raw: null };
    COLS.forEach(c => { let v; try { v = c.get(j); } catch (e) { v = ''; } if (v == null) v = ''; r[c.key] = typeof v === 'object' ? '' : v; });
    r._owner = r.tc || r.name || '—';
    r._parcel = r.ada + '|' + r.parsel;
    r._active = /AKT/.test((r.status || '').toLocaleUpperCase('tr-TR'));
    r._chk = shareCheck(j);
    r._debt = num(r.debt) > 0;
    return r;
  }
  function rawFields(j) {
    const out = [];
    (function walk(o, p, d) {
      if (o == null || d > 5) return;
      if (typeof o !== 'object') { if (o !== '' && p) out.push([p, o]); return; }
      if (Array.isArray(o)) { o.slice(0, 5).forEach((v, i) => walk(v, p + '[' + i + ']', d + 1)); return; }
      Object.keys(o).forEach(k => walk(o[k], p ? p + '.' + k : k, d + 1));
    })(j, '', 0);
    return out;
  }
  function findRows(j) {
    let best = null;
    (function walk(x, d) {
      if (d > 6 || !x) return;
      if (Array.isArray(x)) {
        const f = x[0];
        if (x.length && f && typeof f === 'object' && !Array.isArray(f)) {
          const score = (('Estate' in f) || ('DeclarationRegistry' in f) ? 1e6 : 0) + Object.keys(f).length;
          if (!best || score > best.score || (score === best.score && x.length > best.rows.length)) best = { rows: x, score };
        }
        x.slice(0, 3).forEach(y => walk(y, d + 1));
      } else if (typeof x === 'object') Object.values(x).forEach(y => walk(y, d + 1));
    })(j, 0);
    return best && best.rows;
  }
  function pathsOf(rows) {
    const out = new Set();
    rows.slice(0, 25).forEach(j => (function walk(o, p, d) {
      if (o == null) { if (p) out.add(p); return; }
      if (d > 5) return;
      if (typeof o !== 'object') { out.add(p); return; }
      if (Array.isArray(o)) { o.slice(0, 3).forEach(v => walk(v, p + '[]', d + 1)); return; }
      Object.keys(o).forEach(k => walk(o[k], p ? p + '.' + k : k, d + 1));
    })(j, '', 0));
    return out;
  }
  // Sunucu yanıtının yapısını kontrol eder: kritik alan kayboldu mu, yeni alan geldi mi, çekirdek sütun boş mu
  function schemaCheck(raw, mapped) {
    const res = { at: Date.now(), rows: raw.length, missing: [], added: [], emptyCore: [], ok: true };
    if (!raw.length) return res;
    res.missing = CFG.crit.filter(p => !raw.some(r => g(r, p) !== undefined));
    const cur = pathsOf(raw);
    const prevRaw = LS.get('emz5-schema', null), prev = Array.isArray(prevRaw) ? prevRaw : null;
    if (prev && prev.length) { const ps = new Set(prev); res.added = [...cur].filter(p => !ps.has(p)).slice(0, 40); }
    LS.set('emz5-schema', [...new Set([...cur, ...(prev || [])])].slice(0, 1500));   // yeni yollar önce: kırpılsa bile kaybolmaz
    res.emptyCore = CFG.core.filter(k => mapped.every(r => r[k] === '' || r[k] == null));
    res.ok = !res.missing.length && !res.emptyCore.length;
    return res;
  }

  /* ---------- Eski sayfa (arka plan motoru) ---------- */
  function oldInput(label) {
    const want = normL(label), ls = $$('#root label');
    const l = ls.find(x => normL(x.textContent) === want) || ls.find(x => normL(x.textContent).startsWith(want));
    if (!l) return null;
    const sc = l.parentElement;
    return (sc && sc.querySelector('input[type=text],input:not([type])')) || (l.htmlFor && document.getElementById(l.htmlFor)) || null;
  }
  const oldButton = text => $$('#root button').find(b => normL(b.textContent) === normL(text));
  function setNative(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const mouse = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view: window }));
  async function waitFor(fn, ms = 8000, step = 120) {
    const t0 = Date.now();
    for (;;) {
      let v = null; try { v = fn(); } catch (e) { /* yoksay */ }
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }
  async function waitDone(since) {
    const t0 = Date.now(); let quiet = 0;
    while (Date.now() - t0 < 30000) {
      await sleep(120);
      const got = LOG.some(e => e.seq > since);
      if (pending === 0 && (got || Date.now() - t0 > 3000)) { if (!quiet) quiet = Date.now(); if (Date.now() - quiet > 450) return; } else quiet = 0;
    }
  }
  const mainControl = () => $('#root [class*="-control"]');
  const mainTypeText = () => { const v = $('#root [class*="-singleValue"]'); return v ? v.textContent.trim() : ''; };
  async function setMainType(want) {
    try {
      if ((want || '') === mainTypeText()) return true;
      if (want) {
        const c = mainControl(); if (!c) return false;
        mouse(c, 'mousedown');
        const o = await waitFor(() => $$('#root [class*="-option"]').find(x => x.textContent.trim() === want), 1500, 40);
        if (o) o.click();
        await sleep(200);
        return mainTypeText() === want;
      }
      const ind = $$('#root [class*="-indicatorContainer"]');
      if (ind.length > 1) { mouse(ind[0], 'mousedown'); await sleep(250); }
      return mainTypeText() === '';
    } catch (e) { return false; }
  }
  function gridApis() {
    const out = [];
    $$('.ag-root-wrapper').forEach(w => {
      let el = w, f = null;
      for (let i = 0; el && i < 6 && !f; i++, el = el.parentElement) {
        const k = Object.keys(el).find(x => x.indexOf('__reactFiber$') === 0 || x.indexOf('__reactInternalInstance$') === 0);
        if (k) f = el[k];
      }
      for (let i = 0; f && i < 60; i++, f = f.return) {
        const sn = f.stateNode;
        if (sn && sn.api && typeof sn.api.getSelectedRows === 'function') { out.push(sn.api); break; }
        const p = f.memoizedProps;
        if (p && p.api && typeof p.api.getSelectedRows === 'function') { out.push(p.api); break; }
      }
    });
    return out;
  }
  function gridApi() {
    const all = gridApis();
    const cnt = a => { try { return a.getDisplayedRowCount ? a.getDisplayedRowCount() : a.getModel().getRowCount(); } catch (e) { return 0; } };
    return all.find(a => cnt(a) > 0) || all[0] || null;
  }

  // Resmî rapor penceresi (MUI Dialog)
  const DKEYS = {
    'beyan yılı': 'year', 'rapor tipi': 'rtype', 'son sayı no': 'no', 'konu': 'subject', 'üst başlık 1': 't1', 'üst başlık 2': 't2', 'üst başlık 3': 't3', 'üst başlık 4': 't4',
    'gideceği yer': 'place', 'gideceği il': 'city', 'gideceği ilçe': 'county', 'metin': 'body', 'alt not 1': 'n1', 'alt not 2': 'n2', 'alt not 3': 'n3', 'alt not 4': 'n4', 'müşterek/el birliği': 'conc'
  };
  const EDIT = ['year', 'rtype', 'subject', 't1', 't2', 't3', 't4', 'place', 'county', 'body', 'n1', 'n2', 'n3', 'n4', 'conc'];
  const DLABEL = {
    year: 'Beyan yılı', rtype: 'Rapor tipi', subject: 'Konu', t1: 'Üst başlık 1', t2: 'Üst başlık 2', t3: 'Üst başlık 3', t4: 'Üst başlık 4',
    place: 'Gideceği yer', county: 'Gideceği ilçe', body: 'Metin', n1: 'Alt not 1', n2: 'Alt not 2', n3: 'Alt not 3', n4: 'Alt not 4', conc: 'Müşterek / El birliği'
  };
  function readDialog() {
    const content = $$('.MuiDialogContent-root').find(c => !c.closest('#emz') && (c.querySelectorAll('.apllicationProcessDiv').length >= 10 || c.querySelectorAll('label').length >= 10));
    if (!content) return null;
    const out = {};
    let blocks = $$('.apllicationProcessDiv', content);
    if (blocks.length < 10) blocks = $$('label', content).map(l => l.parentElement).filter(Boolean);
    blocks.forEach(div => {
      const lab = div.querySelector('label'); if (!lab) return;
      const label = lab.textContent.trim();
      const key = DKEYS[trl(label).replace(/:/g, '').trim()]; if (!key) return;
      const hasCtl = !!div.querySelector('[class*="-control"]');
      const ta = div.querySelector('textarea');
      const inp = div.querySelector('input.inputs') || (!hasCtl ? div.querySelector('input[type=text],input:not([type])') : null);
      if (ta) out[key] = { key, label, kind: 'text', el: ta, value: ta.value };
      else if (inp) out[key] = { key, label, kind: 'text', el: inp, value: inp.value };
      else if (hasCtl) { const sv = div.querySelector('[class*="-singleValue"]'); out[key] = { key, label, kind: 'select', el: div.querySelector('[class*="-control"]'), box: div, value: sv ? sv.textContent.trim() : '' }; }
    });
    out._content = content;
    return Object.keys(out).length >= 11 ? out : null;
  }

  async function dialogOptions(item) {
    try {
      mouse(item.el, 'mousedown');
      const get = () => {
        let o = $$('[class*="-option"]', item.box);
        if (!o.length) o = $$('[class*="-option"]').filter(x => !x.closest('#emz'));
        const t = o.map(x => x.textContent.trim()).filter(Boolean);
        return t.length ? t : null;
      };
      const opts = (await waitFor(get, 1500, 40)) || [];
      const inp = $('input', item.box); if (inp) inp.blur();
      return [...new Set(opts)];
    } catch (e) { return []; }
  }
  async function pickDialogOption(item, text) {
    mouse(item.el, 'mousedown');
    const find = () => $$('[class*="-option"]', item.box).find(x => x.textContent.trim() === text) ||
      $$('[class*="-option"]').filter(x => !x.closest('#emz')).find(x => x.textContent.trim() === text);
    const o = await waitFor(find, 1500, 40);
    if (o) o.click(); else jlog('warn', 'rapor', 'Seçenek bulunamadı: ' + text);
    await sleep(150);
  }
  async function applyDialog(vals, base) {
    let f = readDialog(); if (!f) return;
    for (const k of EDIT) {
      const it = f[k];
      if (!it || vals[k] == null || it.value === vals[k]) continue;
      if (base && k !== 'rtype' && base[k] === vals[k]) continue;   // kullanıcı dokunmadıysa resmî değer kalsın
      if (it.kind === 'select') { await pickDialogOption(it, vals[k]); f = readDialog() || f; }
      else setNative(it.el, vals[k]);
    }
  }

  const waitGone = (el, ms) => waitFor(() => !document.contains(el), ms, 40);
  async function closeNative() {
    const roots = () => $$('.MuiModal-root,[role="dialog"]').filter(el => !el.closest('#emz') && document.contains(el));
    for (let k = 0; k < 6; k++) {
      const list = roots(); if (!list.length) return true;
      const top = list[list.length - 1];
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      if (await waitGone(top, 700)) continue;
      const ctn = top.querySelector('.MuiDialog-container') || top;
      mouse(ctn, 'mousedown'); mouse(ctn, 'click');
      if (await waitGone(top, 700)) continue;
      const cb = $$('button,[role="button"]', top).find(b => /^(kapat|close|iptal|vazgeç|×|✕|x)$/i.test(b.textContent.trim()) || /close|kapat/i.test(b.getAttribute('aria-label') || ''));
      if (cb) { cb.click(); await waitGone(top, 700); }
    }
    return !roots().length;
  }

  const toastTexts = before => $$('.Toastify__toast').filter(x => !before.has(x)).map(x => ({ t: x.textContent.trim(), bad: /--(warning|error)/.test(x.className) })).filter(x => x.t);
  function domSnap() {
    try {
      return {
        yol: location.pathname + location.hash, başlık: document.title, etiketler: $$('#root label').map(l => l.textContent.trim()).filter(Boolean).slice(0, 40),
        düğmeler: $$('#root button').map(b => b.textContent.trim()).filter(Boolean).slice(0, 40), girdiSayısı: $$('#root input').length, seçiciSayısı: $$('#root [class*="-control"]').length,
        ızgaraSayısı: gridApis().length, pencereEtiketleri: $$('.MuiDialogContent-root label').filter(l => !l.closest('#emz')).map(l => l.textContent.trim()).slice(0, 30)
      };
    } catch (e) { return { hata: e.message }; }
  }

  /* ====================================================================
   * 4) ARAYÜZ
   * ==================================================================== */
  function init() {
    // Yeniden kurulumda (başarısız ilk denemeden sonra) kalıntıları temizle
    ['emz', 'emz-back', 'emz-toast', 'emz-tip', 'emz-style'].forEach(id => { const x = document.getElementById(id); if (x) x.remove(); });
    const arr = v => (Array.isArray(v) ? v : []);
    const histLoad = () => [...arr(SS.get('emz3-hist-tc', [])), ...arr(LS.get('emz3-hist', []))].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 10);
    const histSave = h => { LS.set('emz3-hist', h.filter(x => !x.tc).slice(0, 8)); SS.set('emz3-hist-tc', h.filter(x => x.tc).slice(0, 6)); };
    const S = {
      rows: [], loading: false, error: '', info: '', warns: [], queried: false, lastQuery: null, meta: null, schema: null, lastRes: null,
      search: '', sort: { key: null, dir: 1 }, sel: new Set(), view: LS.get('emz3-view', 'table'), dense: LS.get('emz3-dense', false),
      hidden: new Set(arr(LS.get('emz3-hidden', DEFAULT_HIDDEN))), fType: null, fStatus: null, fDebt: false, fOwner: null,
      drawer: null, acc: {}, colMenu: false, hist: histLoad(), limit: 1000, lastSel: null, busy: '', rep: null, viewer: null, tray: false, trayQ: '', reports: [], owners: [],
      qid: 0, ctl: null, qStart: 0, fresh: false,
      logOpen: false, logTab: 'health', logQ: '', logErr: false, logSel: null, repBody: false
    };
    let HEALTH = { at: 0, items: [] };

    /* ---------------------------- CSS ---------------------------- */
    const css = `
:root{--bg:#f2f5f4;--s1:#fff;--s2:#f7f9f8;--bd:#dfe6e4;--tx:#0e1f1e;--mu:#5d706e;--ac:#0f766e;--ac2:#14b8a6;--acs:#e3f3f0;--hv:#eef4f2;
--ok:#15803d;--okb:#dcf5e4;--bad:#b42318;--badb:#fde8e6;--warn:#a15c07;--warnb:#fdf0d5;--sh:0 1px 2px rgba(14,31,30,.05),0 10px 28px rgba(14,31,30,.07)}
html.emz-dark{--bg:#0a1413;--s1:#101d1c;--s2:#152524;--bd:#233836;--tx:#e4efed;--mu:#8fa7a4;--ac:#2dd4bf;--ac2:#5eead4;--acs:#12312e;--hv:#17302d;
--ok:#86efac;--okb:#11321e;--bad:#fca5a5;--badb:#3b1a17;--warn:#fcd34d;--warnb:#33290d;--sh:0 1px 2px rgba(0,0,0,.4),0 12px 32px rgba(0,0,0,.4);color-scheme:dark}
html.emz-on:not(.emz-classic):not(.emz-away) #root{position:fixed!important;left:-30000px;top:0;width:1600px;height:1100px;opacity:0;pointer-events:none;overflow:hidden}
html.emz-on:not(.emz-classic):not(.emz-away) body{overflow:hidden!important}
html.emz-classic #emz,html.emz-away #emz{display:none}
#emz-back{display:none;position:fixed;top:12px;right:12px;z-index:2147483000;padding:10px 16px;border-radius:10px;border:0;background:#0f766e;color:#fff;font:600 13px system-ui;cursor:pointer;box-shadow:0 6px 20px rgba(15,118,110,.4)}
html.emz-classic:not(.emz-away) #emz-back{display:block}
#emz{position:fixed;inset:0;z-index:2147482000;background:var(--bg);color:var(--tx);overflow:auto;font:14px/1.5 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,Roboto,sans-serif}
#emz *{box-sizing:border-box}
#emz button{font-family:inherit;cursor:pointer}
#pbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:90;opacity:0;transition:opacity .25s;pointer-events:none;background:linear-gradient(90deg,transparent,var(--ac),var(--ac2),transparent) -50% 0/50% 100% no-repeat}
#pbar.on{opacity:1;animation:pb 1.1s linear infinite}
@keyframes pb{to{background-position:150% 0}}
.hd{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:10px;padding:0 24px;height:62px;background:color-mix(in srgb,var(--s1) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--bd)}
.logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(140deg,#0f766e,#134e4a);display:grid;place-items:center;color:#fff;font-size:19px;box-shadow:0 4px 12px rgba(15,118,110,.35)}
.ttl{font-weight:800;font-size:16px;line-height:1.15}.ttl small{display:block;font-weight:500;font-size:11.5px;color:var(--mu)}
.sp{flex:1}
.dot{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--mu);font-weight:600}
.dot i,.hchip i{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2);animation:pl 2.4s ease-in-out infinite}
.dot.off i{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.2)}
@keyframes pl{50%{box-shadow:0 0 0 6px rgba(34,197,94,0)}}
.hchip.warn i{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.22)}.hchip.bad i{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.22)}
.hchip.warn{border-color:#f59e0b}.hchip.bad{border-color:#ef4444;color:var(--bad)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--bd);background:var(--s1);color:var(--tx);font-weight:600;font-size:13px;transition:background .15s,border-color .15s,transform .12s,box-shadow .15s;white-space:nowrap}
.btn:hover{background:var(--hv);border-color:var(--ac)}
.btn:active{transform:scale(.97)}
.btn.pri{background:linear-gradient(140deg,#0f766e,#0d9488);color:#fff;border:0;box-shadow:0 4px 14px rgba(15,118,110,.35)}
.btn.pri:hover{box-shadow:0 6px 20px rgba(15,118,110,.45);filter:brightness(1.06)}
.btn.sky{background:linear-gradient(140deg,#155e75,#0e7490);color:#fff;border:0}
.btn.sm{height:32px;padding:0 10px;font-size:12px;border-radius:8px}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn:focus-visible,.inp:focus-visible,.chip:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.wrap{max-width:1680px;margin:0 auto;padding:20px 24px 110px}
.card{background:var(--s1);border:1px solid var(--bd);border-radius:16px;box-shadow:var(--sh)}
.sc{padding:18px 20px}
.sc h2{margin:0 0 14px;font-size:14px;color:var(--mu);font-weight:700;display:flex;align-items:center;gap:8px}
.fg{display:grid;grid-template-columns:1fr 1fr 1.7fr auto;gap:12px;align-items:end;padding-bottom:10px}
@media(max-width:1000px){.fg{grid-template-columns:1fr 1fr;row-gap:30px}}
.fld{position:relative}
.lb{display:block;font-size:12px;font-weight:700;color:var(--mu);margin-bottom:6px}
.lr{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}.lr .lb{margin:0}
.inp,.sel{width:100%;height:42px;border-radius:11px;border:1px solid var(--bd);background:var(--s2);color:var(--tx);padding:0 13px;font:inherit;font-size:14.5px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}
textarea.inp{height:auto;min-height:92px;padding:10px 13px;resize:vertical;line-height:1.45}
.inp:focus,.sel:focus{border-color:var(--ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 22%,transparent);background:var(--s1)}
.inp.err{border-color:#ef4444;animation:shk .3s}
@keyframes shk{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.inp.bad{border-color:#ef4444}.inp.good{border-color:#22c55e}
.fmsg{position:absolute;left:2px;top:calc(100% + 4px);font-size:11.5px;font-weight:600;color:var(--mu);line-height:1.2;transition:color .15s}
.fmsg.ok{color:var(--ok)}.fmsg.bad{color:var(--bad)}.fmsg.warn{color:var(--warn)}
.sw{position:relative;display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--mu);cursor:pointer;user-select:none}
.sw input{position:absolute;opacity:0;width:0;height:0}
.sw i{position:relative;width:32px;height:18px;border-radius:99px;background:var(--bd);transition:background .2s}
.sw i:after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s cubic-bezier(.3,1.4,.5,1)}
.sw input:checked+i{background:var(--ac)}.sw input:checked+i:after{transform:translateX(14px)}
.sw input:checked~span{color:var(--ac)}.sw input:focus-visible+i{outline:2px solid var(--ac);outline-offset:2px}
.live{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 16px 0;padding:8px 12px;border-radius:10px;background:var(--okb);color:var(--ok);font-size:12.5px;font-weight:600}
.live i{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)}
.ld{display:flex;align-items:center;gap:16px;padding:22px 24px 8px}.ld .spin{margin:0;flex-shrink:0}.ld b{display:block;font-size:15px}.ld span{color:var(--mu);font-size:12.5px}
.hint{font-size:12px;color:var(--mu);margin-top:20px}
.hist{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:var(--acs);color:var(--ac);font-size:12px;font-weight:600;border:1px solid transparent;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.chip:hover{border-color:var(--ac)}.chip.on{background:var(--ac);color:var(--s1)}.chip.plain{background:var(--s2);color:var(--mu);border-color:var(--bd)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:18px 0}
.st{padding:14px 16px;display:flex;gap:12px;align-items:center}
.st .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:var(--acs)}
.st b{display:block;font-size:20px;line-height:1.15;font-variant-numeric:tabular-nums}.st span{font-size:12px;color:var(--mu);font-weight:600}
.st.warnc .ic{background:var(--badb)}.st.warnc b{color:var(--bad)}
.fresh .st{animation:fu .5s cubic-bezier(.2,.8,.2,1) both}
.fresh .st:nth-child(2){animation-delay:.05s}.fresh .st:nth-child(3){animation-delay:.1s}.fresh .st:nth-child(4){animation-delay:.15s}.fresh .st:nth-child(5){animation-delay:.2s}.fresh .st:nth-child(6){animation-delay:.25s}.fresh .st:nth-child(7){animation-delay:.3s}
@keyframes fu{from{opacity:0;transform:translateY(10px)}}
.tb{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--bd)}
.srch{position:relative;flex:1;min-width:240px;max-width:460px}
.srch .inp{padding-left:38px;height:38px}.srch:before{content:"🔍";position:absolute;left:12px;top:9px;font-size:14px;opacity:.6}
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:9px;overflow:hidden}
.seg button{height:30px;padding:0 11px;border:0;background:var(--s1);color:var(--mu);font-weight:600;font-size:12px;transition:background .15s,color .15s}
.seg button.on{background:var(--ac);color:var(--s1)}
.fr{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-bottom:1px solid var(--bd);align-items:center}
.fr .lbl{font-size:12px;font-weight:700;color:var(--mu)}
.tw{overflow:auto;max-height:calc(100vh - 150px);min-height:480px}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:13.5px}
th{position:sticky;top:0;z-index:5;background:var(--s2);text-align:left;font-size:12px;color:var(--mu);font-weight:700;padding:11px 14px;border-bottom:1px solid var(--bd);white-space:nowrap;cursor:pointer;user-select:none;transition:color .12s}
th:hover{color:var(--ac)}th .ar{margin-left:4px;color:var(--ac)}
td{padding:11px 14px;border-bottom:1px solid var(--bd);white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}
.dense td{padding:6px 14px}
td.r,th.r{text-align:right}
tbody tr{cursor:pointer;transition:background .1s}tbody tr:hover{background:var(--hv)}tbody tr.sel{background:var(--acs)}
tbody tr.chk-ok td{background:var(--okb)}
tbody tr.chk-bad td{background:var(--badb)}
tbody tr.chk-debt td{background:var(--warnb)}
tbody tr.chk-debt:hover td{filter:brightness(.96)}
tbody tr.sel.chk-debt td{filter:brightness(.92);box-shadow:inset 0 -2px 0 var(--ac)}
tbody tr.chk-ok:hover td,tbody tr.chk-bad:hover td{filter:brightness(.96)}
tbody tr.sel.chk-ok td,tbody tr.sel.chk-bad td{filter:brightness(.92);box-shadow:inset 0 -2px 0 var(--ac)}
.st[data-copy]{cursor:pointer;transition:border-color .15s,box-shadow .15s}
.st[data-copy]:hover{border-color:var(--ac)}
.fresh tbody tr{animation:rin .38s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,24)*16ms)}
@keyframes rin{from{opacity:0;transform:translateX(-8px)}}
td.cb,th.cb{width:44px;text-align:center;padding:0 8px}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--ac);cursor:pointer}
.nm{font-weight:700}.mono{font-variant-numeric:tabular-nums;letter-spacing:.2px}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700}
.b-ok{background:var(--okb);color:var(--ok)}.b-bad{background:var(--badb);color:var(--bad)}.b-ac{background:var(--acs);color:var(--ac)}.b-warn{background:var(--warnb);color:var(--warn)}.b-mu{background:var(--s2);color:var(--mu)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;padding:16px;max-height:calc(100vh - 150px);overflow:auto}
.rc{padding:16px;cursor:pointer;border-radius:14px;border:1px solid var(--bd);background:var(--s1);transition:border-color .15s,transform .15s,box-shadow .15s}
.rc:hover{border-color:var(--ac);transform:translateY(-2px);box-shadow:var(--sh)}.rc.sel{border-color:var(--ac);background:var(--acs)}
.fresh .rc{animation:fu .45s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,12)*30ms)}
.rc .t{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;font-size:12.5px}.kv span{color:var(--mu)}.kv b{font-weight:600;text-align:right}
.emp{padding:70px 20px;text-align:center;color:var(--mu)}.emp .big{font-size:46px;margin-bottom:10px}.emp h3{margin:0 0 6px;color:var(--tx);font-size:18px}
.sk{height:14px;border-radius:7px;background:linear-gradient(90deg,var(--hv),var(--bd),var(--hv));background-size:200% 100%;animation:sk 1.2s infinite}
@keyframes sk{to{background-position:-200% 0}}
.alert,.info,.wn{margin:14px 16px 0;padding:12px 14px;border-radius:11px;font-weight:600;font-size:13px;animation:fu .3s both}
.alert{background:var(--badb);color:var(--bad)}.info{background:var(--acs);color:var(--ac)}.wn{background:var(--warnb);color:var(--warn)}
.pop{position:absolute;right:0;top:38px;z-index:40;min-width:250px;max-height:380px;overflow:auto;padding:10px;background:var(--s1);border:1px solid var(--bd);border-radius:12px;box-shadow:var(--sh);animation:pop2 .16s both}
.pop label{display:flex;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;font-size:13px;cursor:pointer}.pop label:hover{background:var(--hv)}
.rel{position:relative}
#fab:empty{display:none}
.fab{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:14px;background:#0b1f1e;color:#fff;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:96vw;flex-wrap:wrap;animation:fabin .25s cubic-bezier(.2,.9,.3,1.2) both}
@keyframes fabin{from{opacity:0;transform:translate(-50%,16px)}}
.fab small{opacity:.75;font-weight:500}.fab .btn{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff}.fab .btn.sky{background:linear-gradient(140deg,#155e75,#0e7490)}
.ov{position:fixed;inset:0;background:rgba(2,12,11,.5);z-index:70;backdrop-filter:blur(2px);animation:fade .18s both}
@keyframes fade{from{opacity:0}}
.dr{position:fixed;top:0;right:0;bottom:0;width:min(580px,100%);background:var(--s1);z-index:71;box-shadow:-12px 0 40px rgba(0,0,0,.25);display:flex;flex-direction:column;animation:sl .22s cubic-bezier(.2,.8,.2,1)}
@keyframes sl{from{transform:translateX(50px);opacity:0}}
.dr .dh{padding:18px 20px;border-bottom:1px solid var(--bd);display:flex;gap:12px;align-items:flex-start}
.dr .db{padding:18px 20px;overflow:auto;flex:1}
.dr h4{margin:18px 0 8px;font-size:12.5px;color:var(--mu)}.dr h4:first-child{margin-top:0}
.row2{display:flex;justify-content:space-between;gap:14px;padding:9px 12px;border-radius:9px;font-size:13.5px}
.row2:nth-child(odd){background:var(--s2)}.row2 span{color:var(--mu);flex-shrink:0}.row2 b{text-align:right;font-weight:600;word-break:break-word;cursor:copy}
.mini{width:100%;font-size:12.5px}.mini td,.mini th{padding:7px 8px;white-space:normal;max-width:none;position:static;cursor:default}
.modal{position:fixed;z-index:72;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1100px,94vw);height:min(720px,88vh);display:flex;flex-direction:column;background:var(--s1);color:var(--tx);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.4);overflow:hidden;animation:pop .2s cubic-bezier(.2,.9,.3,1.1) both}
@keyframes pop{from{opacity:0;transform:translate(-50%,-48%) scale(.97)}}
@keyframes pop2{from{opacity:0;transform:translateY(-6px)}}
.modal.big{width:min(1180px,96vw);height:min(900px,94vh)}.modal.sm{width:min(760px,95vw);height:auto;max-height:92vh}
.modal .mh{padding:14px 18px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.modal .mf{padding:12px 18px;border-top:1px solid var(--bd);display:flex;gap:10px;justify-content:flex-end;align-items:center}
.modal .mb{display:grid;grid-template-columns:42% 1fr;flex:1;min-height:0}
.modal .mb1{flex:1;min-height:0;overflow:auto;padding:16px 18px}
.modal .ml{overflow:auto;border-right:1px solid var(--bd)}
.modal pre{margin:0;padding:14px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.modal iframe{width:100%;height:100%;border:0;background:#525659}
#logbody{flex:1;min-height:0;display:flex;flex-direction:column}
.tabs{display:inline-flex;gap:4px;padding:3px;border-radius:10px;background:var(--s2);border:1px solid var(--bd)}
.tabs button{height:28px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--mu);font-weight:600;font-size:12px;transition:background .15s,color .15s}
.tabs button.on{background:var(--ac);color:var(--s1)}
.rg{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}.rg .full{grid-column:1/-1}
@media(max-width:700px){.rg{grid-template-columns:1fr}}
.lg{padding:9px 14px;border-bottom:1px solid var(--bd);cursor:pointer;font-size:12px;transition:background .1s}.lg:hover,.lg.on{background:var(--acs)}
.lg .u{font-family:ui-monospace,Consolas,monospace;word-break:break-all;margin-top:3px;color:var(--mu)}
.hi{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:11px 4px;border-bottom:1px solid var(--bd)}
.hi .ic{font-size:17px;text-align:center}.hi b{display:block}.hi small{display:block;color:var(--mu)}.hi .fx{color:var(--warn);font-size:12px;margin-top:2px}
.jr{display:grid;grid-template-columns:116px 66px 74px 1fr;gap:8px;padding:7px 14px;border-bottom:1px solid var(--bd);font-size:12.5px;align-items:start}
.jr .jt{color:var(--mu);font-variant-numeric:tabular-nums}.jr .jc{color:var(--mu);font-weight:600}.jr.error{background:var(--badb)}.jr.warn{background:var(--warnb)}.jr.debug{opacity:.75}
.jr pre{padding:6px 0;background:transparent}.jr summary{cursor:pointer;color:var(--ac)}
.ri{display:flex;gap:10px;align-items:center;padding:11px 14px;border-bottom:1px solid var(--bd)}.ri .x{flex:1;min-width:0}.ri small{display:block;color:var(--mu)}
#busy{position:fixed;inset:0;z-index:2147483200;display:none;align-items:center;justify-content:center;background:rgba(2,12,11,.5);backdrop-filter:blur(3px)}
#busy.on{display:flex;animation:fade .2s both}
#busy .bx{background:var(--s1);color:var(--tx);padding:26px 34px;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.4);text-align:center;min-width:300px;font-weight:600}
.spin{width:34px;height:34px;border-radius:50%;border:4px solid var(--bd);border-top-color:var(--ac);margin:0 auto 14px;animation:spn .8s linear infinite}
@keyframes spn{to{transform:rotate(360deg)}}
#emz-toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);background:#0b1f1e;color:#fff;padding:11px 18px;border-radius:11px;font-weight:600;font-size:13px;opacity:0;pointer-events:none;transition:.22s;z-index:2147483600;max-width:92vw}
#emz-toast.show{opacity:1;transform:translateX(-50%)}#emz-toast.bad{background:#7f1d1d}#emz-toast.ok{background:#14532d}
@media(prefers-reduced-motion:reduce){#emz *,#emz-toast{animation:none!important;transition:none!important}}
@media print{#emz .hd,#emz .sc-form,#emz .stats,#emz .tb,#emz .fr,.fab,.dr,.ov,#modal,#logm,#busy,#pbar{display:none!important}#emz{position:static;overflow:visible}.tw,.cards{max-height:none}
html.emz-on:not(.emz-classic):not(.emz-away) body{overflow:visible!important}html.emz-on:not(.emz-classic):not(.emz-away) #root{display:none!important}}
#emz-tip{position:fixed;z-index:2147483500;width:max-content;max-width:340px;min-width:240px;background:var(--s1);color:var(--tx);border:1px solid var(--bd);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.3);font:12.5px/1.45 "Segoe UI",system-ui,sans-serif;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .12s,transform .12s;overflow:hidden}
#emz-toasts{position:fixed;top:16px;right:16px;z-index:2147483600;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none;max-width:min(380px,92vw)}
.tst{--c:var(--ac);position:relative;overflow:hidden;pointer-events:auto;cursor:pointer;display:flex;gap:10px;align-items:center;padding:12px 16px 14px 12px;border-radius:14px;background:var(--s1);color:var(--tx);border:1px solid var(--bd);border-left:5px solid var(--c);box-shadow:0 14px 40px rgba(0,0,0,.28);font:600 13px/1.4 "Segoe UI",system-ui,sans-serif;animation:tin .5s cubic-bezier(.2,.9,.3,1.25) both}
.tst.ok{--c:#22c55e}.tst.bad{--c:#ef4444}.tst.warn{--c:#f59e0b}
.tst .ti{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--c);color:#fff;font-size:15px;animation:tpop .6s .15s cubic-bezier(.3,1.6,.5,1) both}
.tst.out{animation:tout .3s ease-in forwards}
.tst .tbar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--c);transform-origin:left;animation:tbar var(--d,2600ms) linear forwards}
@keyframes tin{from{opacity:0;transform:translateX(120%) scale(.9)}60%{opacity:1;transform:translateX(-8px)}to{opacity:1;transform:none}}
@keyframes tout{to{opacity:0;transform:translateX(120%) scale(.95)}}
@keyframes tpop{from{transform:scale(0) rotate(-90deg)}}
@keyframes tbar{to{transform:scaleX(0)}}
@media(prefers-reduced-motion:reduce){.tst,.tst *{animation-duration:.01s!important}}
#emz-tip.on{opacity:1;transform:none}
#emz-tip .tp-h{padding:10px 12px;background:var(--s2);border-bottom:1px solid var(--bd)}
#emz-tip .tp-h b{display:block;font-size:13.5px}
#emz-tip .tp-h small{color:var(--mu)}
#emz-tip .tp-s{padding:9px 12px;border-bottom:1px solid var(--bd)}
#emz-tip .tp-t{display:flex;gap:6px;align-items:center;font-weight:800;margin-bottom:4px}
#emz-tip .tp-s p{margin:6px 0 0;color:var(--mu)}
#emz-tip .tp-r{display:flex;justify-content:space-between;gap:14px;padding:1px 0}
#emz-tip .tp-r span{color:var(--mu);flex-shrink:0}
#emz-tip .tp-r b{text-align:right;word-break:break-word}
#emz-tip .tp-s.debt{background:var(--warnb)}#emz-tip .tp-s.debt .tp-t{color:var(--warn)}
#emz-tip .tp-s.ok{background:var(--okb)}#emz-tip .tp-s.ok .tp-t{color:var(--ok)}
#emz-tip .tp-s.bad{background:var(--badb)}#emz-tip .tp-s.bad .tp-t{color:var(--bad)}
#emz-tip .tp-s.info .tp-t{color:var(--ac)}
#emz-tip .tp-f{padding:6px 12px;font-size:11px;color:var(--mu);background:var(--s2)}
`;
    const st = document.createElement('style');
    st.id = 'emz-style';
    st.textContent = css;
    document.head.appendChild(st);
    if (LS.get('emz-theme', (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') === 'dark') document.documentElement.classList.add('emz-dark');

    /* --------------------------- Kabuk --------------------------- */
    const app = document.createElement('div');
    app.id = 'emz';
    app.innerHTML =
`<div id="pbar"></div>
<div class="hd">
  <div class="logo">🏛</div>
  <div class="ttl">Emlak beyan sorgulama<small>Türkoğlu Belediyesi · sürüm ${VER}</small></div>
  <div class="sp"></div>
  <span class="dot" id="sess"><i></i><span>Oturum</span></span>
  <button class="btn sm hchip ok" id="b-health" data-act="log" data-tab="health" title="Sistem sağlığı ve tanılama günlüğü"><i></i><span>Sistem</span></button>
  <button class="btn sm" data-act="tray" id="b-tray">📑 Raporlar</button>
  <button class="btn sm" data-act="sfx" id="b-sfx" title="Sesleri aç / kapat">🔊 Ses</button>
 <button class="btn sm" data-act="idvis" id="b-idvis" title="Kimlik numaralarını göster / gizle">👁 Kimlik</button>
  <button class="btn sm" data-act="log" data-tab="net" title="Ağ istekleri ve olay günlüğü">⚙ Günlük</button>
  <button class="btn sm" data-act="classic" title="Resmî ekrana dön">↩ Klasik ekran</button>
  <button class="btn sm" data-act="theme" title="Tema">🌓</button>
</div>
<div class="wrap">
  <div class="card sc sc-form">
    <h2>🔎 Sorgu</h2>
    <div class="fg">
      <div class="fld"><label class="lb" for="q-ada">Ada</label><input class="inp" id="q-ada" inputmode="numeric" placeholder="örn. 232" autocomplete="off"></div>
      <div class="fld"><label class="lb" for="q-parsel">Parsel</label><input class="inp" id="q-parsel" inputmode="numeric" placeholder="örn. 20" autocomplete="off"></div>
      <div class="fld"><div class="lr"><label class="lb" for="q-tc">TC kimlik / vergi / sicil no</label><label class="sw" title="Girilen numara vergi veya sicil numarasıysa işaretleyin"><input type="checkbox" id="q-vkn"><i></i><span>Vergi / Sicil No</span></label></div><input class="inp" id="q-tc" inputmode="numeric" placeholder="İsteğe bağlı" autocomplete="off"><div class="fmsg" id="q-msg"></div></div>
      <div style="display:flex;gap:8px"><button class="btn pri" id="b-run" style="height:42px;padding:0 22px" disabled>Sorgula</button><button class="btn" data-act="reset" style="height:42px">Temizle</button></div>
    </div>
    <div class="hint">Ada ve parsel <b>veya</b> kimlik numarasıyla sorgulayın. Her sorgu sunucudan canlı çekilir. Kısayollar: <b>Enter</b> sorgula · <b>/</b> ada alanına git · <b>Esc</b> kapat · <b>Ctrl+A</b> görünenleri seç</div>
    <div class="hist" id="hist"></div>
  </div>
  <div class="stats" id="stats"></div>
  <div class="card" id="res">
    <div class="tb">
      <div class="srch"><input class="inp" id="q-search" placeholder="Sonuçlarda ara (isim, TC, adres, ada…)" autocomplete="off"></div>
      <div class="seg" id="seg"><button data-view="table">Tablo</button><button data-view="cards">Kart</button><button data-view="owners">Malik özeti</button></div>
      <div class="sp"></div>
      <div class="rel"><button class="btn sm" data-act="cols">▦ Sütunlar</button><div id="colpop"></div></div>
      <button class="btn sm" data-act="dense" id="b-dense"></button>
      <button class="btn sm" data-act="csv">⬇ CSV</button>
      <button class="btn sm" data-act="json" title="Sunucudan gelen ham kayıtlar">⬇ JSON</button>
      <button class="btn sm" data-act="copy">⧉ Kopyala</button>
      <button class="btn sm" data-act="print">🖨 Yazdır</button>
    </div>
    <div class="fr" id="filters"></div>
    <div id="out"></div>
  </div>
</div>
<div id="layer"></div><div id="fab"></div><div id="modal"></div><div id="logm"></div><div id="busy"></div>`;
    document.body.appendChild(app);

    const back = document.createElement('button');
    back.id = 'emz-back'; back.textContent = '✨ Yeni arayüze dön';
    back.onclick = () => document.documentElement.classList.remove('emz-classic');
    document.body.appendChild(back);
    

    /* ---- Ses motoru (WebAudio ile sentezlenir, dış dosya gerekmez) ---- */
    const sfx = (() => {
      let on = LS.get('emz-sfx', true), ctx = null;
      const AC = window.AudioContext || window.webkitAudioContext;
      const get = () => {
        if (!AC) return null;
        if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
      };
      const tone = (f, t0, d, type, vol, to) => {
        const c = get(); if (!c) return;
        const o = c.createOscillator(), gn = c.createGain(), t = c.currentTime + t0;
        o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.012); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(gn); gn.connect(c.destination); o.start(t); o.stop(t + d + 0.03);
      };
      const P = {
        click: () => tone(1320, 0, .07, 'triangle', .11, 1800),                                        // kawaii "pip"
        nya: () => { tone(700, 0, .10, 'sine', .14, 1250); tone(1250, .10, .17, 'sine', .14, 820); },  // "nya~"
        ok: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * .07, .2, 'sine', .13)),         // "pirorin"
        bad: () => { tone(420, 0, .14, 'square', .07, 330); tone(300, .14, .24, 'square', .07, 210); },// "bu-bu"
        info: () => { tone(1047, 0, .09, 'sine', .1); tone(1319, .08, .13, 'sine', .1); },
        open: () => tone(660, 0, .09, 'triangle', .1, 1000),
        close: () => tone(1000, 0, .09, 'triangle', .1, 640)
      };
      return {
        get on() { return on; },
        setOn(v) { on = !!v; LS.set('emz-sfx', on); },
        play(n) { if (!on) return; try { P[n] && P[n](); } catch (e) { /* yoksay */ } },
        say(text) {   // Japonca ses varsa kısa anime tepkisi
          return;
          try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; u.pitch = 1.7; u.rate = 1.05; u.volume = .85; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* yoksay */ }
        }
      };
    })();
    { const b = $('#b-sfx'); if (b) b.textContent = sfx.on ? '🔊 Ses' : '🔇 Ses'; }

    /* ---- Bildirimler: sağ üstten, animasyonlu, sesli ---- */
    { const o = document.getElementById('emz-toasts'); if (o) o.remove(); }
    const toastBox = document.createElement('div');
    toastBox.id = 'emz-toasts';
    document.body.appendChild(toastBox);
    const TICON = { ok: '✔', bad: '✖', warn: '⚠', info: 'ℹ' };
    const toast = (m, ms, kind) => {
      kind = TICON[kind] ? kind : 'info';
      const dur = ms || 2600;
      const el = document.createElement('div');
      el.className = 'tst ' + kind;
      el.style.setProperty('--d', dur + 'ms');
      el.innerHTML = '<span class="ti">' + TICON[kind] + '</span><span class="tm">' + esc(m) + '</span><i class="tbar"></i>';
      toastBox.appendChild(el);
      while (toastBox.children.length > 4) toastBox.firstChild.remove();
      sfx.play(kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'info');
      let closed = false;
      const close = () => { if (closed) return; closed = true; el.classList.add('out'); setTimeout(() => el.remove(), 320); };
      el.onclick = close; setTimeout(close, dur);
    };



    function legacyClip(t) {
      return new Promise((res, rej) => {
        try {
          const ta = document.createElement('textarea');
          ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
          document.body.appendChild(ta); ta.select();
          const ok = document.execCommand('copy'); ta.remove();
          ok ? res() : rej(new Error('copy'));
        } catch (e) { rej(e); }
      });
    }
    // Pano API'si izin vermezse eski yönteme düşer
    function clip(t) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(() => legacyClip(t));
      return legacyClip(t);
    }
    const copy = (t, msg) => clip(t).then(() => toast(msg || 'Kopyalandı', 2200, 'ok'), () => toast('Kopyalanamadı', 2500, 'bad'));

    // Özel tooltip
    const tipEl = document.createElement('div');
    tipEl.id = 'emz-tip';
    document.body.appendChild(tipEl);
    let tipTimer = null, tipKey = null, tipRow = null, tipCell = null;
    const hideTip = () => { clearTimeout(tipTimer); tipKey = null; tipRow = null; tipCell = null; tipEl.classList.remove('on'); };

    const placeTip = () => {
      if (!tipRow || !document.contains(tipRow)) return;
      const rr = tipRow.getBoundingClientRect();
      const cr = tipCell && document.contains(tipCell) ? tipCell.getBoundingClientRect() : rr;
      const gap = 50, m = 8;
      const w = tipEl.offsetWidth;
      let left = cr.left;                                           // hücreyle hizalı
      if (left + w > innerWidth - m) left = innerWidth - w - m;
      tipEl.style.left = Math.max(m, left) + 'px';
      // Alt kenarı satırın üst kenarına sabitle (yükseklik ölçümüne bağlı değil)
      tipEl.style.top = 'auto';
      tipEl.style.bottom = (innerHeight - rr.top + gap) + 'px';
      const t = tipEl.getBoundingClientRect();
      if (t.top < m) {                                              // üste sığmadı: satırın altına koy
        tipEl.style.bottom = 'auto';
        let top = rr.bottom + gap;
        if (top + t.height > innerHeight - m) top = Math.max(m, innerHeight - t.height - m);
        tipEl.style.top = top + 'px';
      }
    };

    app.addEventListener('mousemove', e => {
      const row = e.target.closest && e.target.closest('#out [data-row]');
      if (!row) { if (tipKey) hideTip(); return; }
      const td = e.target.closest('td[data-c]');
      const key = row.dataset.row + '|' + (td ? td.dataset.c : '');
      if (key === tipKey) return;                                   // aynı hücredeyken yerinden oynamaz
      hideTip(); tipKey = key;
      tipTimer = setTimeout(() => {
        const r = S.rows.find(x => x._id === row.dataset.row); if (!r) return;
        const html = tipHtml(r, td); if (!html) return;
        tipRow = row; tipCell = td;
        tipEl.innerHTML = html; placeTip(); tipEl.classList.add('on');
      }, 1100);
    });
    app.addEventListener('mouseleave', hideTip);
    app.addEventListener('mousedown', hideTip);
    document.addEventListener('scroll', hideTip, true);
    document.addEventListener('keydown', hideTip);

    document.documentElement.classList.add('emz-on');
    setInterval(() => document.documentElement.classList.toggle('emz-away', !onQueryPage()), 1000);

    // Resmî sitenin kendi bildirimlerini (toast) günlüğe işle
    try {
      new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('Toastify__toast')) jlog(/--(warning|error)/.test(n.className) ? 'warn' : 'info', 'resmî-bildirim', n.textContent.trim().slice(0, 300));
      }))).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* yoksay */ }

    /* ----------------------- Oturum göstergesi ----------------------- */
    function tokenMs() {
      try {
        const t = sessionStorage.getItem(CFG.storage.token); if (!t) return null;
        const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return p.exp ? p.exp * 1000 - Date.now() : undefined;
      } catch (e) { return undefined; }
    }
    function renderSess() {
      const el = $('#sess'), ms = tokenMs();
      const off = ms === null || (typeof ms === 'number' && ms <= 0);
      el.classList.toggle('off', off);
      el.lastChild.textContent = ms === null ? 'Oturum yok' : (typeof ms === 'number' ? (ms <= 0 ? 'Oturum süresi doldu' : 'Oturum açık · ' + Math.max(1, Math.round(ms / 60000)) + ' dk') : 'Oturum açık');
    }
    renderSess(); setInterval(renderSess, 30000);

    /* ----------------------- Veri türetme ----------------------- */
    const visibleCols = () => COLS.filter(c => !S.hidden.has(c.key));
    const selRows = () => S.rows.filter(r => S.sel.has(r._id));
    const uniq = a => [...new Set(a.filter(Boolean))];
    let VR = null;   // görünür satır önbelleği: aynı filtre/sıralamada yeniden hesaplanmaz
    function visibleRows() {
      const key = [S.fType, S.fStatus, S.fDebt, S.fOwner, S.search, S.sort.key, S.sort.dir];
      if (VR && VR.rows === S.rows && VR.key.every((v, i) => v === key[i])) return VR.out;
      let r = S.rows;
      if (S.fType) r = r.filter(x => x.type === S.fType);
      if (S.fStatus) r = r.filter(x => x.status === S.fStatus);
      if (S.fDebt) r = r.filter(x => num(x.debt) > 0);
      if (S.fOwner) r = r.filter(x => x._owner === S.fOwner);
      if (S.search) {
        const q = trl(S.search).split(/\s+/).filter(Boolean);
        r = r.filter(x => { const hay = x._hay || (x._hay = trl(COLS.map(c => plain(c, x[c.key])).join(' | '))); return q.every(t => hay.includes(t)); });
      }
      if (S.sort.key) {
        const c = COL[S.sort.key], d = S.sort.dir;
        r = [...r].sort((a, b) => cmpKey(sortKey(c, a[c.key]), sortKey(c, b[c.key])) * d);
      }
      VR = { rows: S.rows, key, out: r };
      return r;
    }
    function totals(rows) {
      const parcels = new Set(); let land = 0, build = 0, share = 0, value = 0, debt = 0, debtN = 0;
      rows.forEach(r => {
        if (!parcels.has(r._parcel)) { parcels.add(r._parcel); const n = num(r.land); if (!isNaN(n)) land += n; }
        const b = num(r.build); if (!isNaN(b)) build += b;
        const s = num(r.landShare); if (!isNaN(s)) share += s;
        const v = num(r.value); if (!isNaN(v)) value += v;
        const d = num(r.debt); if (!isNaN(d) && d > 0) { debt += d; debtN++; }
      });
      return { parcels: parcels.size, land, build, share, value, debt, debtN, owners: uniq(rows.map(r => r._owner)).length, active: rows.filter(r => r._active).length };
    }
    function statusBadge(v) {
      if (!v) return '—';
      const u = v.toLocaleUpperCase('tr-TR');
      const cls = u.includes('AKT') ? 'b-ok' : (u.includes('PAS') || u.includes('İPT') || u.includes('IPT')) ? 'b-bad' : 'b-warn';
      return '<span class="badge ' + cls + '">' + esc(v) + '</span>';
    }
    function cellHtml(c, r) {
      const v = r[c.key];
      if (c.key === 'status') return statusBadge(v);
      if (c.key === 'type') return v ? '<span class="badge b-ac">' + esc(v) + '</span>' : '—';
      if (c.key === 'name') return '<span class="nm">' + esc(v || '—') + '</span>';
      if (c.key === 'debt') { const n = num(v); return n > 0 ? '<span class="badge b-bad">' + esc(fmt(c, v)) + '</span>' : '<span style="color:var(--mu)">—</span>'; }
      if (c.type !== 'text' || c.key === 'tc') return '<span class="mono">' + esc(fmt(c, v)) + '</span>';
      return esc(fmt(c, v));
    }
    const isNumCol = c => c.type === 'area' || c.type === 'money';
    const idLabel = h => (h.kind === 'sicil' ? 'Sicil ' : (h.kind === 'vergi' || (!h.kind && h.vkn)) ? 'Vergi ' : 'TC ') + (UI.showId ? h.tc : maskId(h.tc));
    const qDesc = q => (!q ? '' : q.id ? (q.kind === 'tc' ? 'TC ' : q.kind === 'sicil' ? 'Sicil ' : 'Vergi ') + (UI.showId ? q.id : maskId(q.id)) + (q.ada || q.parsel ? ' · ' + [q.ada && 'Ada ' + q.ada, q.parsel && 'Parsel ' + q.parsel].filter(Boolean).join(' / ') : '') : 'Ada ' + q.ada + ' / Parsel ' + q.parsel);

    /* ----------------------- Çizim ----------------------- */
    function renderHist() {
      $('#hist').innerHTML = S.hist.length
        ? '<span style="font-size:12px;color:var(--mu);font-weight:700">Son sorgular:</span>' + S.hist.map((h, i) =>
          '<span class="chip" tabindex="0" data-hist="' + i + '">🕘 ' + esc(h.tc ? idLabel(h) : 'Ada ' + h.ada + ' / Parsel ' + h.parsel) + '</span>').join('') +
        '<span class="chip plain" data-act="clearhist">Geçmişi sil</span>' : '';
    }
    function countUp(el) {
      const to = +el.dataset.to, d = +el.dataset.d, t0 = performance.now(), dur = 750;
      (function step(now) {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = (to * e).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }
    function renderStats() {
      const el = $('#stats');
      el.classList.toggle('fresh', S.fresh);
      if (!S.rows.length) { el.innerHTML = ''; return; }
      const rows = visibleRows(), t = totals(rows);
      const cu = (v, d) => '<span class="cu" data-to="' + v + '" data-d="' + d + '">' + (d ? f2(v) : v.toLocaleString('tr-TR')) + '</span>';
      const items = [
        ['📄', cu(rows.length, 0), 'Toplam kayıt', String(rows.length)],
        ['👤', cu(t.owners, 0), 'Malik / beyan sahibi', String(t.owners)],
        ['🗺', cu(t.parcels, 0), 'Tekil parsel', String(t.parcels)],
        ['📐', cu(t.land, 2) + ' m²', 'Taşınmazların tüm toplam alanı', f2(t.land)],
        ['📏', cu(t.share, 2) + ' m²', 'Taşınmazlara hisse düşen toplam alan', f2(t.share)]
      ];
      if (t.value > 0) items.push(['💰', cu(t.value, 2) + ' ₺', 'Toplam rayiç değer', f2(t.value)]);
      items.push(['✅', t.active + ' / ' + rows.length, 'Aktif beyan', t.active + ' / ' + rows.length]);
      el.innerHTML = items.map(i => '<div class="card st" data-copy="' + esc(i[3]) + '" title="Kopyalamak için tıklayın"><div class="ic">' + i[0] + '</div><div><b>' + i[1] + '</b><span>' + i[2] + '</span></div></div>').join('') +
        (t.debtN ? '<div class="card st warnc" data-copy="' + esc(f2(t.debt)) + '" title="Kopyalamak için tıklayın"><div class="ic">⚠</div><div><b>' + cu(t.debt, 2) + ' ₺</b><span>' + t.debtN + ' kayıtta beyan borcu</span></div></div>' : '');
      if (S.fresh) $$('.cu', el).forEach(countUp);
    }
    function renderFilters() {
      const el = $('#filters');
      if (!S.rows.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
      el.style.display = 'flex';
      const types = uniq(S.rows.map(r => r.type)), sts = uniq(S.rows.map(r => r.status));
      const vis = visibleRows().length;
      const chip = (on, attr, label) => '<span class="chip ' + (on ? 'on' : '') + '" tabindex="0" ' + attr + '>' + esc(label) + '</span>';
      let h = '<span class="lbl">Tür</span>' + chip(!S.fType, 'data-ft=""', 'Tümü') + types.map(t => chip(S.fType === t, 'data-ft="' + esc(t) + '"', t)).join('');
      h += '<span class="lbl" style="margin-left:14px">Durum</span>' + chip(!S.fStatus, 'data-fs=""', 'Tümü') + sts.map(t => chip(S.fStatus === t, 'data-fs="' + esc(t) + '"', t)).join('');
      if (S.rows.some(r => num(r.debt) > 0)) h += '<span style="margin-left:14px"></span>' + chip(S.fDebt, 'data-act="fdebt"', '⚠ Yalnız borçlular');
      if (S.fOwner) h += '<span style="margin-left:14px"></span>' + chip(true, 'data-act="fowner-off"', '👤 ' + (UI.showId ? S.fOwner : (/^\d{8,}$/.test(S.fOwner) ? maskId(S.fOwner) : S.fOwner)) + '  ✕');
      h += '<span class="sp"></span><span style="font-size:12.5px;color:var(--mu);font-weight:600">' + vis + ' / ' + S.rows.length + ' kayıt gösteriliyor</span>';
      el.innerHTML = h;
    }
    function ownersOf(rows) {
      const m = new Map();
      rows.forEach(r => {
        let o = m.get(r._owner);
        if (!o) { o = { key: r._owner, name: r.name, tc: r.tc, ids: [], parcels: new Set(), build: 0, debt: 0, active: 0 }; m.set(r._owner, o); }
        o.ids.push(r._id); o.parcels.add(r._parcel);
        const b = num(r.build); if (!isNaN(b)) o.build += b;
        const d = num(r.debt); if (!isNaN(d) && d > 0) o.debt += d;
        if (r._active) o.active++;
      });
      return [...m.values()].sort((a, b) => b.ids.length - a.ids.length);
    }
    const moreBtn = n => n > S.limit ? '<div style="padding:12px 16px;border-top:1px solid var(--bd)"><button class="btn sm" data-act="more">Daha fazla göster (' + (n - S.limit) + ' kayıt daha)</button> <span style="color:var(--mu);font-size:12px">İlk ' + S.limit + ' kayıt gösteriliyor; arama ve filtreler tüm kayıtlarda çalışır.</span></div>' : '';
    const stag = i => (i < 24 ? ' style="--i:' + i + '"' : '');
    function outHtml() {
      let h = '';
      if (S.error) h += '<div class="alert">⚠ ' + esc(S.error) + '</div>';
      S.warns.forEach(w => { h += '<div class="wn">⚠ ' + esc(w) + '</div>'; });
      if (S.info) h += '<div class="info">ℹ ' + esc(S.info) + '</div>';
      if (S.loading) {
        return h + '<div class="ld"><div class="spin"></div><div><b>Sorgulanıyor, lütfen bekleyin…</b><span>Sunucudan canlı veri alınıyor · <span id="qtime">' + Math.max(0, Math.round((Date.now() - S.qStart) / 1000)) + '</span> sn</span></div><span class="sp"></span><button class="btn sm" data-act="qcancel">İptal</button></div>' +
          '<div style="padding:10px 24px 24px">' + Array.from({ length: 5 }, () => '<div class="sk" style="margin-bottom:18px"></div>').join('') + '</div>';
      }
      if (!S.queried) return h + '<div class="emp"><div class="big">🏠</div><h3>Sorguya hazır</h3>Ada ve parsel numarasını ya da TC / vergi numarasını girip <b>Sorgula</b>’ya basın.</div>';
      if (!S.meta && !S.rows.length) {
        return h + '<div class="emp"><div class="big">' + (S.error ? '⚠' : '⏹') + '</div><h3>' + (S.error ? 'Sorgu tamamlanamadı' : 'Sorgu iptal edildi') + '</h3>' + (S.error ? 'Sunucudan sonuç alınamadı; veri gösterilmiyor.<br><small>Ayrıntılar için üstteki Sistem düğmesine bakın.</small>' : 'Hiçbir veri gösterilmiyor.') + '<br><br><button class="btn" data-act="refresh">↻ ' + (S.error ? 'Tekrar dene' : 'Yeniden sorgula') + '</button></div>';
      }
      if (S.meta) h += '<div class="live"><i></i><span>Canlı sunucu sonucu · ' + esc(qDesc(S.meta.q)) + ' · ' + S.meta.count + ' kayıt · ' + esc(S.meta.at.toLocaleTimeString('tr-TR')) + ' · ' + (S.meta.ms / 1000).toFixed(1).replace('.', ',') + ' sn</span><span class="sp"></span><button class="btn sm" data-act="refresh">↻ Yenile</button></div>';
      const rows = visibleRows();
      if (!rows.length) {
        return h + '<div class="emp"><div class="big">🔍</div><h3>' + (S.rows.length ? 'Filtreye uyan kayıt yok' : 'Kayıt bulunamadı') + '</h3>' +
          (S.rows.length ? 'Arama veya filtreleri değiştirin.' : 'Sunucuda <b>' + esc(qDesc(S.meta && S.meta.q)) + '</b> için kayıtlı beyan bulunamadı.<br><small>Sonuç az önce canlı sorgulandı; hafızadan okunmadı.</small>') + '</div>';
      }
      if (S.view === 'owners') {
        S.owners = ownersOf(rows);
        return h + '<div class="tw ' + (S.dense ? 'dense' : '') + '"><table><thead><tr><th class="cb"></th><th>Malik / unvan</th><th>TC / vergi / sicil no</th><th class="r">Kayıt</th><th class="r">Aktif</th><th class="r">Parsel</th><th class="r">Bina m²</th><th class="r">Beyan borcu</th></tr></thead><tbody>' +
          S.owners.map((o, i) => {
            const all = o.ids.every(id => S.sel.has(id));
            return '<tr data-own="' + i + '"' + stag(i) + ' class="' + (all ? 'sel' : '') + '"><td class="cb"><input type="checkbox" data-ownsel="' + i + '" ' + (all ? 'checked' : '') + '></td>' +
              '<td><span class="nm">' + esc(o.name || '—') + '</span></td><td class="mono">' + esc(o.tc ? fmt(COL.tc, o.tc) : '—') + '</td><td class="r mono">' + o.ids.length + '</td><td class="r mono">' + o.active + '</td>' +
              '<td class="r mono">' + o.parcels.size + '</td><td class="r mono">' + esc(f2(o.build)) + '</td><td class="r">' + (o.debt > 0 ? '<span class="badge b-bad">' + esc(f2(o.debt)) + ' ₺</span>' : '<span style="color:var(--mu)">—</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (S.view === 'cards') {
        return h + '<div class="cards">' + rows.slice(0, S.limit).map((r, i) =>
          '<div class="rc ' + (S.sel.has(r._id) ? 'sel' : '') + '"' + stag(i) + ' data-row="' + esc(r._id) + '">' +
          '<div class="t"><div><div class="nm" style="font-size:15px">' + esc(r.name || '—') + '</div><div class="mono" style="color:var(--mu);font-size:12px">' + esc(r.tc ? fmt(COL.tc, r.tc) : '') + '</div></div>' +
          '<div style="display:flex;gap:8px;align-items:center">' + statusBadge(r.status) + '<input type="checkbox" data-sel="' + esc(r._id) + '" ' + (S.sel.has(r._id) ? 'checked' : '') + '></div></div>' +
          '<div class="kv"><span>Tür</span><b>' + esc(r.type || '—') + '</b><span>Ada / parsel</span><b>' + esc(r.ada) + ' / ' + esc(r.parsel) + (r.section ? ' · ' + esc(r.section) : '') + '</b>' +
          '<span>Cilt / sayfa</span><b>' + esc(r.book) + ' / ' + esc(r.page) + '</b><span>Arsa</span><b>' + esc(fmt(COL.land, r.land)) + ' m²</b>' +
          '<span>Bina</span><b>' + esc(fmt(COL.build, r.build)) + ' m²</b><span>Beyan tarihi</span><b>' + esc(r.date || '—') + '</b>' +
          (num(r.debt) > 0 ? '<span>Beyan borcu</span><b style="color:var(--bad)">' + esc(fmt(COL.debt, r.debt)) + '</b>' : '') +
          '<span>Adres</span><b>' + esc(r.addr || '—') + '</b></div></div>').join('') + '</div>' + moreBtn(rows.length);
      }
      const cols = visibleCols();
      const allSel = rows.every(r => S.sel.has(r._id));
      return h + '<div class="tw ' + (S.dense ? 'dense' : '') + '"><table><thead><tr><th class="cb"><input type="checkbox" data-selall ' + (allSel ? 'checked' : '') + '></th>' +
        cols.map(c => '<th class="' + (isNumCol(c) ? 'r' : '') + '" data-sort="' + c.key + '">' + esc(c.label) + (S.sort.key === c.key ? '<span class="ar">' + (S.sort.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
        rows.slice(0, S.limit).map((r, i) => '<tr data-row="' + esc(r._id) + '"' + stag(i) + ' class="' + (S.sel.has(r._id) ? 'sel' : '') + chkCls(r) + '"><td class="cb"><input type="checkbox" data-sel="' + esc(r._id) + '" ' + (S.sel.has(r._id) ? 'checked' : '') + '></td>' +
          cols.map(c => '<td class="' + (isNumCol(c) ? 'r' : '') + '" data-c="' + c.key + '">' + cellHtml(c, r) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + moreBtn(rows.length);
    }
    function renderOut() {
      hideTip();
      const out = $('#out');
      const sc = $('.tw,.cards', out), keep = sc && !S.fresh ? [sc.scrollTop, sc.scrollLeft] : null;
      $$('#seg button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
      $('#b-dense').textContent = S.dense ? '↕ Rahat satır' : '↕ Sık satır';

      out.classList.toggle('fresh', S.fresh);
      out.innerHTML = outHtml();
      if (keep) { const n = $('.tw,.cards', out); if (n) { n.scrollTop = keep[0]; n.scrollLeft = keep[1]; } }
    }
    function accHtml(id) {
      const a = S.acc[id];
      if (!a) return '<button class="btn sm" data-act="acc">💳 Tahakkuk / borç detayını getir</button>';
      if (a.loading) return '<div class="sk" style="margin:8px 0"></div><div class="sk"></div>';
      if (a.error) return '<div class="alert" style="margin:0 0 8px">' + esc(a.error) + '</div><button class="btn sm" data-act="acc">Tekrar dene</button>';
      const L = a.list || [];
      if (!L.length) return '<div style="color:var(--mu)">Bu beyan için tahakkuk kaydı yok.</div>';
      const tot = L.reduce((s, x) => s + (+x.TotalAmount || 0), 0), rem = L.reduce((s, x) => s + (+x.RemainingAmount || 0), 0);
      return '<div style="margin-bottom:8px;font-weight:600">Toplam: ' + esc(f2(tot)) + ' ₺ · Kalan: <span style="color:' + (rem > 0 ? 'var(--bad)' : 'var(--ok)') + '">' + esc(f2(rem)) + ' ₺</span></div>' +
        '<table class="mini"><thead><tr><th>Açıklama</th><th>Taksit</th><th>Son ödeme</th><th class="r">Tutar</th><th class="r">Kalan</th></tr></thead><tbody>' +
        L.map(x => '<tr><td>' + esc(x.AccrumentExplanation || '') + '</td><td>' + esc((x.InstallmentNumber || '') + (x.TotalInstallmentNumber ? '/' + x.TotalInstallmentNumber : '')) + '</td><td>' + esc(trDate(x.LastPaymentDate)) +
          '</td><td class="r mono">' + esc(f2(+x.TotalAmount || 0)) + '</td><td class="r mono" style="color:' + ((+x.RemainingAmount || 0) > 0 ? 'var(--bad)' : 'inherit') + '">' + esc(f2(+x.RemainingAmount || 0)) + '</td></tr>').join('') + '</tbody></table>';
    }
    function renderFab() {
      if (!S.sel.size) { $('#fab').innerHTML = ''; return; }
      const t = totals(selRows());
      const html = '<div class="fab"><b>' + S.sel.size + ' seçili</b><small>' + esc(f2(t.build)) + ' m² bina' + (t.debtN ? ' · ' + esc(f2(t.debt)) + ' ₺ borç' : '') + '</small>' +
        '<button class="btn sm sky" data-act="report">📑 Rayiç bedel raporu</button><button class="btn sm" data-act="copysel">⧉ Kopyala</button><button class="btn sm" data-act="csvsel">⬇ CSV</button><button class="btn sm" data-act="unsel">✕</button></div>';
      const f = $('#fab .fab');
      if (f) { f.innerHTML = $('.fab', Object.assign(document.createElement('div'), { innerHTML: html })).innerHTML; } else $('#fab').innerHTML = html;
    }
    // Çekmece her yeniden çizildiğinde kaydırma konumunu korur (tahakkuk yüklenince başa atlamaz)
    function renderLayer() {
      const L = $('#layer'), old = $('.db', L);
      const top = old && L.dataset.rid === String(S.drawer) ? old.scrollTop : 0;
      drawLayer();
      L.dataset.rid = S.drawer == null ? '' : String(S.drawer);
      const nb = $('.db', L); if (nb) nb.scrollTop = top;
    }
    function drawLayer() {
      const L = $('#layer');
      const r = S.drawer != null ? S.rows.find(x => x._id === S.drawer) : null;
      if (!r) { L.innerHTML = ''; return; }
      const list = visibleRows(), pos = list.findIndex(x => x._id === r._id);
      if (!r._raw) r._raw = rawFields(r._j);
      L.innerHTML = '<div class="ov" data-act="closedr"></div><div class="dr"><div class="dh"><div style="flex:1"><div class="nm" style="font-size:18px">' + esc(r.name || '—') + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + statusBadge(r.status) + '<span class="mono" style="color:var(--mu)">' + esc(r.tc ? fmt(COL.tc, r.tc) : '') + '</span></div></div>' +
        '<button class="btn sm" data-act="prev" ' + (pos <= 0 ? 'disabled' : '') + '>◀</button><button class="btn sm" data-act="next" ' + (pos >= list.length - 1 ? 'disabled' : '') + '>▶</button>' +
        '<button class="btn sm" data-act="closedr">✕</button></div><div class="db">' +
        GROUPS.map(gr => '<h4>' + gr[0] + '</h4>' + gr[1].map(k => '<div class="row2"><span>' + esc(COL[k].label) + '</span><b data-cp="' + esc(disp(COL[k], r[k])) + '">' + esc(fmt(COL[k], r[k])) + '</b></div>').join('')).join('') +
        '<h4>Tahakkuk / borç</h4>' + accHtml(r._id) +
        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="copyrow">⧉ Satırı kopyala</button><button class="btn sky" data-act="report1">📑 Bu kayıt için rapor</button></div>' +
        '<h4>Tüm ham alanlar (' + r._raw.length + ')</h4>' + r._raw.map(([k, v]) => { const vv = maskRaw(k, v); return '<div class="row2"><span style="font-size:11.5px">' + esc(k) + '</span><b data-cp="' + esc(vv) + '">' + esc(vv) + '</b></div>'; }).join('') + '</div></div>';
    }

    /* ----------------------- Günlük / tanılama penceresi ----------------------- */
    const lvlBadge = l => '<span class="badge ' + (l === 'error' ? 'b-bad' : l === 'warn' ? 'b-warn' : l === 'debug' ? 'b-mu' : 'b-ac') + '">' + (l === 'error' ? 'hata' : l === 'warn' ? 'uyarı' : l === 'debug' ? 'ayrıntı' : 'bilgi') + '</span>';
    const stBadge = e => '<span class="badge ' + (e.status === 0 ? 'b-bad' : e.status >= 400 ? 'b-bad' : e.status >= 300 ? 'b-warn' : 'b-ok') + '">' + (e.status || 'ağ hatası') + '</span>';
    const netList = () => {
      const q = trl(S.logQ);
      return [...LOG].reverse().filter(e => (!S.logErr || e.status === 0 || e.status >= 400) && (!q || trl(e.url + ' ' + (e.body || '') + ' ' + e.preview).includes(q)));
    };
    function healthHtml() {
      const ic = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
      const items = HEALTH.items;
      const dom = domSnap();
      return '<div class="mb1"><div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><b>Son kontrol: ' + (HEALTH.at ? new Date(HEALTH.at).toLocaleTimeString('tr-TR') : '—') + '</b><span class="sp"></span><button class="btn sm" data-act="rehealth">↻ Yeniden kontrol et</button></div>' +
        items.map(x => '<div class="hi"><div class="ic">' + ic[x.lvl] + '</div><div><b>' + esc(x.name) + '</b><small>' + esc(x.detail) + '</small>' + (x.lvl !== 'ok' && x.lvl !== 'info' && x.fix ? '<div class="fx">Ne yapmalı: ' + esc(x.fix) + '</div>' : '') + '</div></div>').join('') +
        '<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--ac);font-weight:600">Resmî sayfada görünen etiket ve düğmeler</summary><pre>' + esc(JSON.stringify(dom, null, 2)) + '</pre></details>' +
        '<div style="margin-top:12px;color:var(--mu);font-size:12px">Bir şey çalışmazsa: <b>Tanılama raporunu kopyala</b> düğmesine basıp çıktıyı geliştiriciye iletin. Kimlik numaraları rapora maskeli girer; ad-soyad içeren yanıt içerikleri yalnızca “Yanıt içeriklerini ekle” işaretliyse eklenir.</div></div>';
    }
    function netHtml() {
      const items = netList();
      const sel = items.find(e => e.seq === S.logSel) || items[0];
      return '<div class="mb"><div class="ml">' + (items.length ? items.map(e => '<div class="lg ' + (sel && sel.seq === e.seq ? 'on' : '') + '" data-lg="' + e.seq + '">' + stBadge(e) + ' <b>' + esc(e.method) + '</b> · ' + e.ms + ' ms · ' + (e.size / 1024).toFixed(1) + ' KB · ' + e.time + (e.own ? ' · <span style="color:var(--ac)">PRO</span>' : '') + '<div class="u">' + esc(epName(e.url)) + '</div></div>').join('') : '<div class="emp">İstek yok. Bir sorgu çalıştırın.</div>') +
        '</div><div style="overflow:auto">' + (sel ? '<div style="padding:10px 14px;display:flex;gap:8px;border-bottom:1px solid var(--bd)"><button class="btn sm" data-act="copyentry" data-seq="' + sel.seq + '">⧉ Bu isteği kopyala</button></div><pre><b>İSTEK</b>\n' + esc(sel.method + ' ' + sel.url + (sel.body ? '\n\n' + sel.body : '') + '\n\n') + '<b>CEVAP</b> · ' + esc(String(sel.status || 'ağ hatası') + ' · ' + sel.ms + ' ms · ' + sel.ct) + (sel.err ? '\nHata: ' + esc(sel.err) : '') + '\n' + esc(sel.preview) + '</pre>' : '') + '</div></div>';
    }
    function journalHtml() {
      const q = trl(S.logQ);
      const list = [...JR].reverse().filter(e => (!S.logErr || e.lvl === 'error' || e.lvl === 'warn') && (!q || trl(e.cat + ' ' + e.msg + ' ' + (e.d || '')).includes(q))).slice(0, 300);
      return '<div class="mb1" style="padding:0">' + (list.length ? list.map(e => '<div class="jr ' + e.lvl + '"><div class="jt">' + new Date(e.ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (e.old ? '<br><small>önceki oturum</small>' : '') + '</div><div>' + lvlBadge(e.lvl) + '</div><div class="jc">' + esc(e.cat) + '</div><div>' + esc(e.msg) + (e.n > 1 ? ' <b>×' + e.n + '</b>' : '') + (e.d ? '<details><summary>ayrıntı</summary><pre>' + esc(e.d) + '</pre></details>' : '') + '</div></div>').join('') : '<div class="emp">Kayıt yok.</div>') + '</div>';
    }
    function renderLogBody() { const b = $('#logbody'); if (b) b.innerHTML = S.logTab === 'health' ? healthHtml() : S.logTab === 'net' ? netHtml() : journalHtml(); }
    function renderLog() {
      const L = $('#logm');
      if (!S.logOpen) { L.innerHTML = ''; return; }
      const tab = (k, t) => '<button class="' + (S.logTab === k ? 'on' : '') + '" data-act="logtab" data-tab="' + k + '">' + t + '</button>';
      L.innerHTML = '<div class="ov" data-act="closelog"></div><div class="modal"><div class="mh"><b style="font-size:15px">⚙ Tanılama merkezi</b>' +
        '<div class="tabs">' + tab('health', '🩺 Sağlık') + tab('net', '🌐 İstekler (' + LOG.length + ')') + tab('journal', '📜 Olaylar (' + JR.length + ')') + '</div>' +
        '<input class="inp" id="log-q" style="width:200px;height:32px;font-size:12.5px" placeholder="Ara…" value="' + esc(S.logQ) + '">' +
        '<label class="sw"><input type="checkbox" id="log-err" ' + (S.logErr ? 'checked' : '') + '><i></i><span>Yalnız sorunlar</span></label><span class="sp"></span>' +
        '<label class="sw" title="Başarılı yanıtların içeriği ad-soyad gibi kişisel veri taşıyabilir"><input type="checkbox" id="log-body" ' + (S.repBody ? 'checked' : '') + '><i></i><span>Yanıt içeriklerini ekle</span></label>' +
        '<button class="btn sm pri" data-act="diag">🩺 Tanılama raporunu kopyala</button><button class="btn sm" data-act="diagdl">⬇ Raporu indir</button><button class="btn sm" data-act="logclear" title="Günlükleri temizle">🗑</button><button class="btn sm" data-act="closelog">✕</button></div>' +
        '<div id="logbody"></div></div>';
      renderLogBody();
    }

    /* ----------------------- Sağlık kontrolü ----------------------- */
    function buildQueryBody(q) {
      return Object.assign({ idType: CFG.idCode[q.kind], idNo: q.id || null, blockOfBuildings: q.id ? '' : (q.ada || ''), parcel: q.id ? '' : (q.parsel || '') }, CFG.queryDefaults);
    }
    function runHealth() {
      const it = [];
      const add = (id, name, lvl, detail, fix) => it.push({ id, name, lvl, detail: detail || '', fix: fix || '' });
      const ms = tokenMs();
      add('token', 'Oturum belirteci', ms === null || (typeof ms === 'number' && ms <= 0) ? 'bad' : 'ok',
        ms === null ? 'Belirteç bulunamadı' : typeof ms === 'number' ? (ms <= 0 ? 'Süresi dolmuş' : Math.round(ms / 60000) + ' dk geçerli') : 'Mevcut (süre okunamadı)',
        'Çıkış yapıp yeniden giriş yapın. Sürerse resmî sitenin depolama anahtar adları değişmiş olabilir (CFG.storage).');
      let base = ''; try { base = apiBase(); } catch (e) { /* yoksay */ }
      add('api', 'API adresi', base ? 'ok' : 'bad', base ? base.replace(/^https?:\/\//, '') : 'Belirlenemedi', 'Resmî ekranda bir sorgu yapıp tekrar deneyin; adres yapısı değişmiş olabilir.');
      [['Ada alanı', () => oldInput(CFG.labels.ada)], ['Parsel alanı', () => oldInput(CFG.labels.parsel)], ['Kimlik alanı', () => oldInput(CFG.labels.id)], ['Sorgula düğmesi', () => oldButton(CFG.labels.run)], ['Rapor düğmesi', () => oldButton(CFG.labels.report)]].forEach(([n, f]) => {
        const ok = !!f();
        add('old-' + n, 'Resmî sayfa · ' + n, ok ? 'ok' : 'warn', ok ? 'Bulundu' : 'Bulunamadı (yalnız rapor akışını etkiler)', 'Resmî sayfadaki etiket veya düğme adı değişmiş olabilir. CFG.labels bölümünü güncelleyin; güncel adlar “Resmî sayfada görünen etiketler” kısmında.');
      });
      const ga = gridApis().length;
      add('grid', 'Resmî tablo (AG Grid) erişimi', ga ? 'ok' : 'warn', ga ? ga + ' tablo bulundu' : 'Bulunamadı (rapor akışı için gerekli)', 'Resmî sitenin tablo bileşeni değişmiş olabilir; gridApis() işlevi güncellenmeli.');
      const off = [...LOG].reverse().find(e => !e.own && e.method === 'POST' && e.url.includes(CFG.endpoints.query) && e.bodyKeys);
      if (!off) add('tpl', 'Resmî sorgu isteğiyle karşılaştırma', 'info', 'Henüz resmî ekran sorgu yapmadı. Klasik ekranda bir sorgu yaparsanız karşılaştırma yapılır.');
      else {
        const ours = ['userName', ...Object.keys(buildQueryBody({ kind: 'parsel', ada: '1', parsel: '1' }))];
        const miss = off.bodyKeys.filter(k => !ours.includes(k)), extra = ours.filter(k => !off.bodyKeys.includes(k));
        add('tpl', 'Resmî sorgu isteğiyle karşılaştırma', miss.length || extra.length ? 'warn' : 'ok',
          miss.length || extra.length ? (miss.length ? 'Resmî istekte olup bizde olmayan: ' + miss.join(', ') + '. ' : '') + (extra.length ? 'Bizde olup resmî istekte olmayan: ' + extra.join(', ') : '') : 'İstek alanları resmî ekranla aynı',
          'CFG.queryDefaults ve buildQueryBody işlevini resmî isteğe göre güncelleyin (İstekler sekmesinde resmî isteğin gövdesi görünür).');
      }
      const sc = S.schema;
      if (!sc) add('schema', 'Sunucu veri yapısı', 'info', 'Henüz sorgu yapılmadı');
      else add('schema', 'Sunucu veri yapısı', sc.missing.length ? 'bad' : sc.emptyCore.length ? 'warn' : 'ok',
        sc.missing.length ? 'Kritik alan(lar) yanıtta yok: ' + sc.missing.join(', ') : sc.emptyCore.length ? 'Tüm satırlarda boş çekirdek sütun: ' + sc.emptyCore.join(', ') : 'Kritik alanların tamamı mevcut' + (sc.added.length ? ' · ' + sc.added.length + ' yeni alan eklenmiş' : ''),
        'Sunucunun alan adları değişmiş olabilir. Ham yanıtı “⬇ JSON” ile indirip COLS ve CFG.crit içindeki yolları güncelleyin.');
      add('last', 'Son sorgu', !S.lastRes ? 'info' : S.lastRes.ok ? 'ok' : 'bad', !S.lastRes ? 'Henüz sorgu yapılmadı' : S.lastRes.msg, 'Olaylar sekmesinde ilgili ağ hatasını inceleyin.');
      const rec = JR.filter(e => !e.old && e.lvl === 'error' && Date.now() - e.ts < 600000);
      add('errs', 'Son 10 dakikadaki hatalar', rec.length ? 'warn' : 'ok', rec.length ? rec.length + ' hata · son: ' + rec[rec.length - 1].msg : 'Hata yok', 'Olaylar sekmesinde “Yalnız sorunlar” filtresiyle ayrıntıya bakın.');
      const ok = LS.set('emz5-probe', 1); try { localStorage.removeItem('emz5-probe'); } catch (e) { /* yoksay */ }
      add('store', 'Tarayıcı depolaması', ok ? 'ok' : 'warn', ok ? 'Çalışıyor' : 'Yazılamıyor (geçmiş ve günlük kalıcı olmaz)', 'Tarayıcının site verisi iznini kontrol edin.');
      HEALTH = { at: Date.now(), items: it };
      jlog(it.some(x => x.lvl === 'bad') ? 'error' : it.some(x => x.lvl === 'warn') ? 'warn' : 'info', 'sağlık', 'Sağlık kontrolü: ' + it.filter(x => x.lvl === 'bad').length + ' sorun, ' + it.filter(x => x.lvl === 'warn').length + ' uyarı', it.filter(x => x.lvl === 'bad' || x.lvl === 'warn').map(x => x.name + ': ' + x.detail));
      updateChip();
      return HEALTH;
    }
    function updateChip() {
      const b = $('#b-health'); if (!b) return;
      const bad = HEALTH.items.filter(x => x.lvl === 'bad').length, warn = HEALTH.items.filter(x => x.lvl === 'warn').length;
      const recent = JR.filter(e => !e.old && e.lvl === 'error' && Date.now() - e.ts < 600000).length;
      b.className = 'btn sm hchip ' + (bad || recent ? 'bad' : warn ? 'warn' : 'ok');
      b.lastChild.textContent = bad ? bad + ' sorun' : recent ? recent + ' hata' : warn ? warn + ' uyarı' : 'Sistem sağlıklı';
    }
    setInterval(updateChip, 5000);

    function buildReport(all) {
      const net = LOG.slice(all ? -150 : -60).map(e => ({
        saat: e.time, yöntem: e.method, uç: epName(e.url), durum: e.status, ms: e.ms, boyut: e.size, pro: e.own || undefined, hata: e.err || undefined, alanlar: e.bodyKeys,
        gövde: e.body ? e.body.slice(0, 1500) : undefined, yanıt: (e.status >= 400 || e.status === 0 || S.repBody) ? e.preview.slice(0, 1500) : undefined, tür: e.ct || undefined
      }));
      return {
        rapor: 'Emlak Beyan Sorgulama PRO · tanılama', sürüm: VER, zaman: new Date().toISOString(), sayfa: location.origin + location.pathname + location.hash,
        tarayıcı: { ua: navigator.userAgent, dil: navigator.language, ekran: screen.width + 'x' + screen.height }, not: 'Kimlik numaraları maskelidir. Ad-soyad içerebilecek yanıt içerikleri yalnızca kullanıcı izin verdiyse eklenir.',
        yapılandırma: { uçlar: CFG.endpoints, etiketler: CFG.labels, sorguVarsayılanları: CFG.queryDefaults }, sağlık: runHealth().items, veriYapısı: S.schema, dom: domSnap(),
        durum: { satır: S.rows.length, seçili: S.sel.size, günlükİstek: LOG.length, pdf: PDFS.length, rapor: S.reports.length, apiTaban: (() => { try { return apiBase(); } catch (e) { return ''; } })() },
        olaylar: JR.slice(all ? -500 : -120).map(e => ({ zaman: new Date(e.ts).toISOString(), düzey: e.lvl, tür: e.cat, ileti: e.msg, tekrar: e.n || undefined, önceki: e.old || undefined, ayrıntı: e.d })), ağ: net
      };
    }

    /* ----------------------- Sorgu ----------------------- */
    let tick = null;
    const startTicker = () => { stopTicker(); tick = setInterval(() => { const el = $('#qtime'); if (el) el.textContent = Math.max(0, Math.round((Date.now() - S.qStart) / 1000)); }, 500); };
    const stopTicker = () => { if (tick) { clearInterval(tick); tick = null; } };
    const vknBox = () => $('#q-vkn');
    function formState() {
      const ada = $('#q-ada').value.trim(), parsel = $('#q-parsel').value.trim(), vkn = vknBox().checked;
      const idc = idCheck($('#q-tc').value, vkn);
      if (!idc.empty) return { ok: idc.ok, idc, useId: true, q: { kind: idc.kind || 'tc', id: idc.v, ada, parsel, vkn } };
      if (ada && parsel) return { ok: true, idc, useId: false, q: { kind: 'parsel', id: '', ada, parsel, vkn: false } };
      return { ok: false, idc, useId: false, blank: true, msg: 'Ada ve parseli birlikte girin ya da TC / vergi / sicil no girin.', q: null };
    }
    function refreshForm() {
      const el = $('#q-tc'), m = $('#q-msg'), b = $('#b-run');
      if (!el || !m || !b) return;
      const fs = formState(), idc = fs.idc;
      el.classList.toggle('bad', idc.tone === 'bad');
      el.classList.toggle('good', !idc.empty && idc.tone === 'ok');
      let msg = idc.msg || '';
      if (!idc.empty && ($('#q-ada').value.trim() || $('#q-parsel').value.trim())) msg += (msg ? ' · ' : '') + 'Sonuç ada/parsel ile süzülecek';
      m.textContent = msg; m.className = 'fmsg ' + (idc.tone || '');
      b.disabled = !fs.ok || S.loading || !!S.busy;
      b.textContent = S.loading ? 'Sorgulanıyor…' : 'Sorgula';
      b.title = !fs.ok ? (idc.empty ? 'Ada ve parsel ya da kimlik no girin' : idc.msg) : '';
      $('#pbar').classList.toggle('on', S.loading || !!S.busy);
    }
    function cancelQuery(msg) {
      S.qid++;
      try { if (S.ctl) S.ctl.abort(); } catch (e) { /* yoksay */ }
      stopTicker(); S.ctl = null; S.loading = false;
      if (msg) S.info = msg;
    }
    async function runQuery() {
      if (S.loading || S.busy) return;
      const fs = formState();
      if (!fs.ok) {
        const ids = fs.useId ? ['#q-tc'] : ['#q-ada', '#q-parsel', '#q-tc'];
        ids.forEach(s => { const e = $(s); e.classList.add('err'); setTimeout(() => e.classList.remove('err'), 600); });
        if (fs.blank) { S.error = fs.msg; S.info = ''; S.warns = []; S.queried = false; S.rows = []; S.meta = null; renderResults(); }
        return;
      }
      const q = fs.q, qid = ++S.qid, ctl = new AbortController();
      S.ctl = ctl; S.loading = true; S.error = ''; S.info = ''; S.warns = []; S.queried = true; S.meta = null; S.lastQuery = q; S.qStart = Date.now();
      S.rows = []; S.sel.clear(); S.drawer = null; S.limit = 1000; S.lastSel = null; S.fOwner = null; S.fType = null; S.fStatus = null; S.fDebt = false; S.acc = {};
      renderResults(); refreshForm(); startTicker();
      jlog('info', 'sorgu', 'Başladı: ' + qDesc(q));
      const t0 = performance.now();
      let jrows = null;
      try {
        let data = await apiPost(CFG.endpoints.query, buildQueryBody(q), { signal: ctl.signal, timeout: CFG.timeouts.query, retry: 1 });
        // Kutu işaretliyken sonuç boşsa, diğer kimlik türüyle (vergi ↔ sicil) bir kez daha dene
        if (q.id && q.vkn && q.kind !== 'tc' && Array.isArray(data) && !data.length) {
          const alt = q.kind === 'vergi' ? 'sicil' : 'vergi';
          jlog('info', 'sorgu', 'Sonuç boş, ' + alt + ' olarak yeniden deneniyor');
          const d2 = await apiPost(CFG.endpoints.query, buildQueryBody(Object.assign({}, q, { kind: alt })), { signal: ctl.signal, timeout: CFG.timeouts.query });
          if (Array.isArray(d2) && d2.length) { data = d2; q.kind = alt; S.info = 'Numara ' + (alt === 'sicil' ? 'sicil' : 'vergi') + ' numarası olarak bulundu.'; }
        }
        if (qid !== S.qid) return;
        if (Array.isArray(data)) jrows = data;
        else if (data && typeof data === 'object') {
          jrows = findRows(data);
          if (!jrows) {
            jrows = [];
            const sm = data.Message || data.message || data.ErrorMessage || data.Error || '';
            if (sm) S.info = String(sm);
            jlog('warn', 'şema', 'Yanıtta kayıt listesi bulunamadı', { anahtarlar: Object.keys(data).slice(0, 20), ileti: sm });
          } else if (jrows.length && !('Estate' in jrows[0]) && !('DeclarationRegistry' in jrows[0])) {
            S.warns.push('Yanıt beklenen biçimde değil; kayıtlar eksik görünebilir. Sistem sekmesindeki tanılamaya bakın.');
            jlog('warn', 'şema', 'Kayıt listesi beklenen anahtarları içermiyor', { anahtarlar: Object.keys(jrows[0]).slice(0, 25) });
          }
        } else jrows = [];
        if (q.id && (q.ada || q.parsel)) {
          const nz = v => String(v == null ? '' : v).trim().replace(/^0+(?=\d)/, '').toLocaleLowerCase('tr-TR');
          const total = jrows.length;
          jrows = jrows.filter(j => (!q.ada || nz(g(j, 'Estate.BlockOfBuildings')) === nz(q.ada)) && (!q.parsel || nz(g(j, 'Estate.Parcel')) === nz(q.parsel)));
          S.info = (S.info ? S.info + ' ' : '') + 'Kimliğe ait ' + total + ' kayıt içinden ada/parsel ile ' + jrows.length + ' kayıt süzüldü.';
        }
      } catch (e) {
        if (qid !== S.qid) return;
        if (!e.aborted) { S.error = (e && e.message) || 'Sorgu başarısız.'; jlog('error', 'sorgu', 'Başarısız: ' + S.error, qDesc(q)); }
      }
      if (qid !== S.qid) return;
      stopTicker(); S.ctl = null; S.loading = false;
      if (jrows) jrows = jrows.filter(j => j && typeof j === 'object');
      S.rows = (jrows || []).map(mapRow);
      const ms = Math.round(performance.now() - t0);
      if (jrows) {
        S.meta = { at: new Date(), ms, count: S.rows.length, q };
        try {
          S.schema = schemaCheck(jrows, S.rows);
          if (S.schema.missing.length) { S.warns.push('Sunucudan gelen veri yapısı değişmiş olabilir; eksik alan: ' + S.schema.missing.join(', ')); jlog('error', 'şema', 'Kritik alan eksik: ' + S.schema.missing.join(', '), { örnekAnahtarlar: jrows[0] ? Object.keys(jrows[0]).slice(0, 30) : [] }); }
          if (S.schema.emptyCore.length) { S.warns.push('Şu sütunlar tüm satırlarda boş geldi: ' + S.schema.emptyCore.map(k => COL[k].label).join(', ') + '. Sunucu alan adları değişmiş olabilir.'); jlog('warn', 'şema', 'Tüm satırlarda boş çekirdek sütun: ' + S.schema.emptyCore.join(', ')); }
          if (S.schema.added.length) jlog('info', 'şema', S.schema.added.length + ' yeni alan görüldü', S.schema.added);
        } catch (e) { jlog('warn', 'şema', 'Şema kontrolü yapılamadı: ' + e.message); }
        S.lastRes = { ok: true, msg: S.rows.length + ' kayıt · ' + (ms / 1000).toFixed(1) + ' sn · ' + qDesc(q) };
        jlog('info', 'sorgu', 'Tamamlandı: ' + S.rows.length + ' kayıt, ' + ms + ' ms');
      } else S.lastRes = { ok: false, msg: S.error || 'İptal edildi' };
      if (S.rows.length) {
        const hh = { ada: q.ada, parsel: q.parsel, tc: q.id, vkn: !!q.vkn, kind: q.kind, t: Date.now() };
        S.hist = [hh, ...S.hist.filter(x => !(x.ada === hh.ada && x.parsel === hh.parsel && x.tc === hh.tc))].slice(0, 10);
        histSave(S.hist); renderHist();
      }
      S.fresh = true;
      if (S.rows.length) sfx.play('ok'); else if (S.error) { sfx.play('bad'); sfx.say('あれ？'); }
      renderResults(); refreshForm(); updateChip();
    }
    function renderResults() {
      renderStats(); renderFilters(); renderOut(); renderLayer(); renderFab(); renderColPop();
      S.fresh = false;
    }
    function renderColPop() {
      $('#colpop').innerHTML = S.colMenu ? '<div class="pop">' + COLS.map(c => '<label><input type="checkbox" data-col="' + c.key + '" ' + (S.hidden.has(c.key) ? '' : 'checked') + '>' + esc(c.label) + '</label>').join('') +
        '<div style="padding:6px 8px"><button class="btn sm" data-act="colreset">Varsayılan sütunlar</button></div></div>' : '';
    }
    function renderTray() { const n = S.reports.length; $('#b-tray').textContent = '📑 Raporlar' + (n ? ' (' + n + ')' : ''); }

    function trayListHtml() {
      if (!S.reports.length) return '<div class="emp"><div class="big">📑</div>Henüz rapor oluşturulmadı.</div>';
      const q = trl(S.trayQ).split(/\s+/).filter(Boolean);
      const list = S.reports.filter(r => {
        const hay = trl([r.label, r.at, r.rtype, (r.parcels || []).join(' '), (r.owners || []).join(' ')].join(' | '));
        return q.every(t => hay.includes(t));
      });
      if (!list.length) return '<div class="emp"><div class="big">🔍</div>Aramaya uyan rapor yok.</div>';
      return list.map(r => '<div class="ri"><div class="x"><b>' + esc(r.label) + '</b><small>' + esc(r.at) + ' · ' + (r.size / 1024).toFixed(0) + ' KB</small></div>' +
        '<button class="btn sm" data-act="pdf-open" data-rid="' + r.id + '">Aç</button><button class="btn sm" data-act="pdf-dl" data-rid="' + r.id + '">⬇</button><button class="btn sm" data-act="pdf-del" data-rid="' + r.id + '" title="Sil">🗑</button></div>').join('');
    }

    function dupWarn(rows) {
      const keys = new Set(rows.map(r => r.ada + '/' + r.parsel));
      const hit = S.reports.filter(r => (r.parcels || []).some(p => keys.has(p)));
      if (!hit.length) return '';
      return '<br><span style="color:var(--warn);font-weight:600">ℹ Bu parsel için daha önce ' + hit.length + ' rapor alınmış (son: ' + esc(hit[0].at) + '). “Raporlar” menüsünden açabilirsiniz.</span>';
    }

    function renderBusy() {
      const el = $('#busy');
      el.classList.toggle('on', !!S.busy);
      el.innerHTML = S.busy ? '<div class="bx"><div class="spin"></div>' + esc(S.busy) + '</div>' : '';
      refreshForm();
    }
    function renderModal() {
      const M = $('#modal');
      let h = '';
      if (S.rep) {
        const v = S.rep.vals, rows = S.rep.rows;
        const inp = (k, full, ta) => (k in v) ? '<div class="fld ' + (full ? 'full' : '') + '"><label class="lb">' + esc(DLABEL[k]) + '</label>' +
          (ta ? '<textarea class="inp" data-rp="' + k + '">' + esc(v[k]) + '</textarea>' : '<input class="inp" data-rp="' + k + '" value="' + esc(v[k]) + '">') + '</div>' : '';
        const t = totals(rows);
        h += '<div class="ov" data-act="rep-cancel"></div><div class="modal sm"><div class="mh"><b style="font-size:15px">📑 Rayiç bedel raporu · ayarlar</b><span class="sp"></span><button class="btn sm" data-act="rep-cancel">✕</button></div><div class="mb1">' +
          '<div style="margin-bottom:14px;font-size:13px;color:var(--mu)">' + rows.length + ' kayıt · ' + t.owners + ' malik · rapor sıra no: <b>' + esc(S.rep.no || '—') + (S.rep.cached ? ' (son bilinen)' : '') + '</b> · gideceği il: <b>' + esc(S.rep.city || '—') + '</b><br>' +
          'Çıktı resmî sistemin kendi PDF şablonudur; burada yalnızca içerik alanları doldurulur.' + dupWarn(rows) +
          (t.debtN ? '<br><span style="color:var(--bad);font-weight:600">⚠ Seçili kayıtların ' + t.debtN + ' tanesinde beyan borcu var; sistem raporu engeller.</span>' : '') + '</div>' +
          '<div class="rg"><div class="fld"><label class="lb">' + esc(DLABEL.rtype) + '</label><select class="sel" data-rp="rtype">' + S.rep.rtOpts.map(o => '<option ' + (o === v.rtype ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>' +
          inp('year') + inp('conc', true) + inp('subject', true) + inp('place') + inp('county') + inp('t1') + inp('t2') + inp('t3') + inp('t4') + inp('body', true, true) + inp('n1', true) + inp('n2', true) + inp('n3', true) + inp('n4', true) + '</div></div>' +
          '<div class="mf"><button class="btn" data-act="rep-cancel">Vazgeç</button><button class="btn pri" data-act="rep-go">📑 Raporu oluştur</button></div></div>';
      }
      if (S.viewer) {
        const r = S.reports.find(x => x.id === S.viewer);
        if (r) h += '<div class="ov" data-act="closeview"></div><div class="modal big"><div class="mh"><b style="font-size:15px">📄 ' + esc(r.label) + '</b><span style="color:var(--mu);font-size:12px">' + (r.size / 1024).toFixed(0) + ' KB · ' + esc(r.at) + ' · resmî şablon, değiştirilmedi</span><span class="sp"></span>' +
          '<button class="btn sm" data-act="pdf-dl" data-rid="' + r.id + '">⬇ İndir</button><button class="btn sm" data-act="pdf-print">🖨 Yazdır</button><button class="btn sm" data-act="pdf-tab" data-rid="' + r.id + '">↗ Yeni sekme</button><button class="btn sm" data-act="closeview">✕</button></div>' +
          '<div style="flex:1;min-height:0"><iframe id="emz-pdf" src="' + r.url + '"></iframe></div></div>';
      }
      if (S.tray) {
        h += '<div class="ov" data-act="closetray"></div><div class="modal sm"><div class="mh"><b style="font-size:15px">📑 Kayıtlı raporlar</b><span style="color:var(--mu);font-size:12px">son ' + CFG.reports.keep + ' rapor bu tarayıcıda saklanır</span><span class="sp"></span>' +
          (S.reports.length ? '<button class="btn sm" data-act="pdf-clear">🗑 Tümünü sil</button>' : '') + '<button class="btn sm" data-act="closetray">✕</button></div>' +
          '<div style="padding:10px 14px;border-bottom:1px solid var(--bd)"><input class="inp" id="tray-q" style="height:36px" placeholder="Ara: ada, parsel, isim, tarih…" value="' + esc(S.trayQ) + '" autocomplete="off"></div>' +
          '<div class="mb1" id="tray-list" style="padding:0">' + trayListHtml() + '</div></div>';
      }
      M.innerHTML = h;
    }

    /* ----------------------- Dışa aktarma ----------------------- */
    function exportRows(onlySel) {
      let rows = visibleRows();
      if (onlySel || S.sel.size) {
        const s = rows.filter(r => S.sel.has(r._id));
        if (s.length || onlySel) rows = s;      // seçim süzgeçle gizlenmişse tüm görünür satırlar aktarılır
      }
      return rows;
    }
    const csvq = v => { let t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t) && !/^-?[\d.,]+( ₺)?$/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const toCSV = rows => { const cols = visibleCols(); return [cols.map(c => csvq(c.label)).join(';')].concat(rows.map(r => cols.map(c => csvq(disp(c, r[c.key]))).join(';'))).join('\r\n'); };
    const toTSV = rows => { const cols = visibleCols(); return [cols.map(c => c.label).join('\t')].concat(rows.map(r => cols.map(c => disp(c, r[c.key]).replace(/\s+/g, ' ')).join('\t'))).join('\n'); };
    function downloadBlob(blob, name) {
      const a = document.createElement('a');
      a.href = ownBlobUrl(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
    const idNote = () => (UI.showId ? '' : ' · kimlikler maskeli');
    function downloadCSV(rows) {
      if (!rows.length) return toast('Aktarılacak kayıt yok');
      const q = S.lastQuery || {};
      downloadBlob(new Blob(['\uFEFF' + toCSV(rows)], { type: 'text/csv;charset=utf-8' }), 'emlak-beyan-' + (q.ada && !q.id ? q.ada + '-' + q.parsel : 'sorgu') + '-' + stamp() + '.csv');
      toast(rows.length + ' kayıt indirildi' + idNote(), 2600, 'ok');
    }
    function downloadJSON(rows) {
      if (!rows.length) return toast('Aktarılacak kayıt yok');
      downloadBlob(new Blob([JSON.stringify(rows.map(r => r._j), null, 2)], { type: 'application/json' }), 'emlak-beyan-ham-' + stamp() + '.json');
      toast(rows.length + ' ham kayıt indirildi (kimlikler maskesiz)', 3000, 'ok');
    }

    /* ----------------------- API ----------------------- */
    const apiBase = (() => {
      let cache = null;
      return () => {
        if (cache) return cache;
        const ref = LOG.find(e => e.method === 'POST' && !e.own && /\/api\/[A-Za-z]/.test(e.url));
        let b = '', sure = false;
        if (ref) {
          try { const abs = new URL(ref.url, location.href).href, m = /^(.*?)\/?api\/[A-Za-z]/.exec(abs); if (m) { b = m[1]; sure = true; } } catch (e) { /* yoksay */ }
        }
        if (!b) {
          let u = null; try { u = sessionStorage.getItem(CFG.storage.url); } catch (e) { /* yoksay */ }
          if (u && u !== '/') { try { b = new URL(u, location.href).href; sure = true; } catch (e) { /* yoksay */ } }
        }
        if (!b) b = location.origin;
        b = b.replace(/\/+$/, '');
        if (sure) cache = b;      // yalnızca güvenilir kaynaktan bulunan adres önbelleğe alınır
        return b;
      };
    })();
    let refreshing = null;
    function refreshToken() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          const at = sessionStorage.getItem(CFG.storage.token), rt = sessionStorage.getItem(CFG.storage.refresh);
          if (!at || !rt || !_fetch) return false;
          const r = await _fetch.call(window, apiBase() + '/api/' + CFG.endpoints.refresh, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ RefreshToken: rt, AccessToken: at }) });
          if (!r.ok) { jlog('error', 'oturum', 'Belirteç yenileme başarısız (HTTP ' + r.status + ')'); return false; }
          const d = await r.json();
          if (!d || !d.AccessToken) { jlog('error', 'oturum', 'Belirteç yenileme yanıtı beklenmedik', Object.keys(d || {})); return false; }
          sessionStorage.setItem(CFG.storage.token, d.AccessToken);
          if (d.RefreshToken) sessionStorage.setItem(CFG.storage.refresh, d.RefreshToken);
          jlog('info', 'oturum', 'Belirteç yenilendi');
          return true;
        } catch (e) { jlog('error', 'oturum', 'Belirteç yenilenemedi: ' + e.message); return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
      })();
      return refreshing;
    }
    async function apiPost(name, body, opt) {
      opt = opt || {};
      if (!sessionStorage.getItem(CFG.storage.token)) throw new Error('Oturum bulunamadı. Giriş yapıp sayfayı yenileyin.');
      const attempt = async () => {
        const ac = new AbortController(); let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; ac.abort(); }, opt.timeout || CFG.timeouts.api);
        const onAbort = () => ac.abort();
        if (opt.signal) { if (opt.signal.aborted) ac.abort(); else opt.signal.addEventListener('abort', onAbort, { once: true }); }
        try {
          const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' };
          const tok = sessionStorage.getItem(CFG.storage.token);
          if (tok) headers.Authorization = 'Bearer ' + tok;
          NET.own = true; let p;
          try { p = fetch(apiBase() + '/api/' + name, { method: 'POST', headers, cache: 'no-store', signal: ac.signal, body: JSON.stringify(Object.assign({ userName: sessionStorage.getItem(CFG.storage.user) }, body)) }); } finally { NET.own = false; }
          const res = await p;
          return { res, tx: await res.text() };
        } catch (e) {
          if (e && e.name === 'AbortError') throw Object.assign(new Error(timedOut ? 'Sunucu yanıt vermedi (zaman aşımı). Tekrar deneyin.' : 'Sorgu iptal edildi.'), { aborted: !timedOut, timeout: timedOut });
          throw Object.assign(new Error('Sunucuya ulaşılamadı. Ağ bağlantınızı kontrol edin.'), { net: true });
        } finally { clearTimeout(timer); if (opt.signal) opt.signal.removeEventListener('abort', onAbort); }
      };
      let r;
      for (let i = 0; ; i++) {
        try { r = await attempt(); } catch (e) {
          if (e.aborted || e.timeout || i >= (opt.retry || 0)) throw e;
          jlog('warn', 'api', 'Yeniden deneniyor: ' + name, e.message); await sleep(900); continue;
        }
        if (r.res.status >= 502 && r.res.status <= 504 && i < (opt.retry || 0)) { jlog('warn', 'api', 'Sunucu geçici hata (' + r.res.status + '), yeniden deneniyor: ' + name); await sleep(900); continue; }
        break;
      }
      if (r.res.status === 401 && await refreshToken()) { jlog('info', 'api', '401 sonrası yeniden deneniyor: ' + name); r = await attempt(); }
      if (r.res.status === 401) throw new Error('Oturum süresi dolmuş. Sayfayı yenileyip yeniden giriş yapın.');
      if (!r.res.ok) {
        let m = '';
        try { const j = JSON.parse(r.tx); m = (j && (j.Message || j.message)) || ''; } catch (e) { m = String(r.tx || '').slice(0, 160); }
        throw new Error('Sunucu hatası (' + r.res.status + ')' + (m ? ': ' + m : ''));
      }
      if (!r.tx) return null;
      try { return JSON.parse(r.tx); } catch (e) { jlog('error', 'api', 'JSON olmayan yanıt: ' + name, r.tx.slice(0, 300)); throw new Error('Sunucudan beklenmeyen bir yanıt alındı.'); }
    }
    async function loadAcc() {
      const id = S.drawer; if (id == null) return;
      S.acc[id] = { loading: true }; renderLayer();
      try {
        const d = await apiPost(CFG.endpoints.accrual, { estateDeclarationOid: Number(id) });
        S.acc[id] = { list: (d && d.AccrumentList) || [] };
        if (d && !('AccrumentList' in d)) jlog('warn', 'şema', 'Tahakkuk yanıtında AccrumentList yok', Object.keys(d));
      } catch (e) { S.acc[id] = { error: e.message || 'Tahakkuk bilgisi alınamadı.' }; jlog('error', 'tahakkuk', e.message); }
      renderLayer();
    }

    /* ----------------------- Resmî rayiç bedel raporu ----------------------- */
    async function legacyQuery(q) {
      if (!q) return false;
      const iAda = oldInput(CFG.labels.ada), iPar = oldInput(CFG.labels.parsel), iTc = oldInput(CFG.labels.id), btn = oldButton(CFG.labels.run);
      if (!iAda || !iPar || !iTc || !btn) { jlog('error', 'rapor', 'Eski form öğeleri bulunamadı', { ada: !!iAda, parsel: !!iPar, kimlik: !!iTc, sorgula: !!btn }); return false; }
      const useId = !!q.id;
      await setMainType(useId ? (q.kind === 'tc' ? 'TC Kimlik No' : q.kind === 'sicil' ? 'Sicil No' : 'Vergi No') : '');
      setNative(iAda, useId ? '' : q.ada); setNative(iPar, useId ? '' : q.parsel); setNative(iTc, useId ? q.id : '');
      const since = SEQ;
      await sleep(100); btn.click(); await sleep(150); await waitDone(since); await sleep(350);
      const api = gridApi(); if (!api) return false;
      let n = 0; api.forEachNode(x => { if (x.data) n++; });
      return n >= S.rows.length;
    }

    async function loadOldGrid() {
      const raw = S.rows.map(r => r._j);
      const api = gridApi();
      const cnt = () => { let n = 0; try { api.forEachNode(x => { if (x.data) n++; }); } catch (e) { /* yoksay */ } return n; };
      if (api) {
        try { // ızgarada zaten aynı kayıtlar varsa yeniden yükleme
          const have = new Set(); api.forEachNode(x => { if (x.data) have.add(String(x.data.Oid)); });
          if (have.size === raw.length && S.rows.every(r => have.has(r._id))) return true;
        } catch (e) { /* yoksay */ }
        try {
          if (typeof api.setRowData === 'function') api.setRowData(raw);
          else if (typeof api.setGridOption === 'function') api.setGridOption('rowData', raw);
        } catch (e) { jlog('warn', 'rapor', 'Izgara verisi yüklenemedi: ' + e.message); }
        await waitFor(() => cnt() === raw.length, 1200, 40);
        const n = cnt();
        if (n === raw.length) return true;
        jlog('warn', 'rapor', 'Izgara satır sayısı uyuşmuyor (' + n + '/' + raw.length + '), eski ekran yeniden sorgulanacak');
      } else jlog('warn', 'rapor', 'Izgara API bulunamadı, eski ekran yeniden sorgulanacak');
      return legacyQuery(S.lastQuery);
    }

    async function syncSelection(ids) {
      if (!(await loadOldGrid())) return { ok: false, n: 0 };
      const api = gridApi();
      if (!api) {
        $$('.ag-pinned-left-cols-container .ag-row').forEach(rw => {
          const r = S.rows[+rw.getAttribute('row-index')], cb = rw.querySelector('input[type=checkbox]');
          if (!r || !cb) return;
          if (ids.has(r._id) !== (cb.checked || rw.classList.contains('ag-row-selected'))) cb.click();
        });
        await sleep(250);
        const n = $$('.ag-pinned-left-cols-container .ag-row-selected').length;
        return { ok: n === ids.size, n };
      }

      const cur = api.getSelectedRows().map(x => String(x.Oid));
      if (cur.length === ids.size && cur.every(o => ids.has(o))) return { ok: true, n: cur.length };

      try { api.deselectAll(); } catch (e) { /* yoksay */ }
      api.forEachNode(node => { if (node.data && ids.has(String(node.data.Oid))) node.setSelected(true); });
      await waitFor(() => api.getSelectedRows().length === ids.size, 800, 30);
      const got = api.getSelectedRows().length;
      return { ok: got === ids.size, n: got };
    }
    async function openNativeDialog() {
      const b = oldButton(CFG.labels.report);
      if (!b) throw new Error('Eski ekranda "' + CFG.labels.report + '" düğmesi bulunamadı.');
      const before = new Set($$('.Toastify__toast'));
      b.click();
      const dlg = await waitFor(() => { const f = readDialog(); return f && f.no && f.no.value !== '' ? f : null; }, 12000, 40);
      if (dlg) return dlg;
      const t = toastTexts(before).map(x => x.t).join(' · ');
      throw new Error(t || 'Rapor penceresi açılamadı.');
    }
    const repFail = (step, e) => { S.error = e.message || 'Rapor hazırlanamadı.'; jlog('error', 'rapor', step + ' adımında hata: ' + S.error, { dom: domSnap() }); renderOut(); toast(S.error, 5000, 'bad'); };
    let RTOPTS = null; // rapor tipi seçenekleri, sayfa yenilenene kadar hatırlanır
    let REPCACHE = LS.get('emz5-repcache', null);
    async function reportStart(only) {
      if (S.busy) return;
      const rows = only ? S.rows.filter(r => r._id === only) : selRows();
      if (!rows.length) return toast('Önce kayıt seçin');

            
      if (REPCACHE && REPCACHE.base && REPCACHE.opts && REPCACHE.opts.length) {
        const base = REPCACHE.base, vals = Object.assign({}, base);
        if ('year' in vals && !vals.year) vals.year = String(new Date().getFullYear());
        const last = LS.get('emz3-rtype', '');
        vals.rtype = REPCACHE.opts.includes(last) ? last : (REPCACHE.opts.includes(base.rtype) ? base.rtype : REPCACHE.opts[0]);
        S.rep = { vals, base, rtOpts: REPCACHE.opts, no: REPCACHE.no, city: REPCACHE.city, ids: rows.map(r => r._id), rows, cached: true };
        renderModal();
        return;
      }      

      S.busy = 'Rapor penceresi hazırlanıyor…'; renderBusy();
      jlog('info', 'rapor', 'Hazırlık başladı (' + rows.length + ' kayıt)');
      let rep = null;
      try {
        const ids = new Set(rows.map(r => r._id));
        const ok = await syncSelection(ids);
        if (!ok.ok) throw new Error('Seçili kayıtlar eski ekranda işaretlenemedi (' + ok.n + '/' + ids.size + '). Klasik ekrandan deneyin.');
        const dlg = await openNativeDialog();
        let opts = RTOPTS || (dlg.rtype ? await dialogOptions(dlg.rtype) : []);
        if (opts.length && !RTOPTS) RTOPTS = opts;
        if (!opts.length) { opts = ['SATIŞ', 'DİĞER']; jlog('warn', 'rapor', 'Rapor tipi seçenekleri okunamadı, varsayılan kullanıldı'); }
        const vals = {};
        EDIT.forEach(k => { if (dlg[k]) vals[k] = dlg[k].value; });
        const base = Object.assign({}, vals);
        if ('year' in vals && !vals.year) vals.year = String(new Date().getFullYear());
        const last = LS.get('emz3-rtype', '');
        vals.rtype = opts.includes(last) ? last : (opts.includes(dlg.rtype && dlg.rtype.value) ? dlg.rtype.value : opts[0]);
        rep = { vals, base, rtOpts: opts, no: dlg.no.value, city: dlg.city ? dlg.city.value : '', ids: [...ids], rows };
        REPCACHE = { base, opts, no: rep.no, city: rep.city }; LS.set('emz5-repcache', REPCACHE);
        jlog('info', 'rapor', 'Pencere okundu', { alanlar: Object.keys(dlg).filter(k => k !== '_content') });
        await closeNative();
      } catch (e) { repFail('hazırlık', e); await closeNative(); }
      S.busy = ''; renderBusy();
      if (rep) { S.rep = rep; renderModal(); }
    }
    async function waitPdf(since, before) {
      const t0 = Date.now(); let lastN = 0, stable = 0;
      for (;;) {
        await sleep(100);
        const p = PDFS.filter(x => x.seq > since);
        if (p.length !== lastN) { lastN = p.length; stable = Date.now(); }
        if (p.length && Date.now() - stable > 250) return p[p.length - 1];
        // yalnızca API hataları rapor akışını bozar (görsel/yazı tipi/izleme istekleri sayılmaz)
        const bad = LOG.find(e => e.seq > since && /\/api\//.test(e.url) && !e.aborted && (e.status >= 400 || e.status === 0));
        if (bad && !p.length) throw new Error('Sunucu hatası (' + (bad.status || 'ağ') + ') · ' + epName(bad.url));
        const tx = toastTexts(before).find(x => x.bad);
        if (tx && !p.length && Date.now() - t0 > 800) throw new Error(tx.t);
        if (Date.now() - t0 > CFG.timeouts.report) throw new Error('Rapor zaman aşımına uğradı.');
      }
    }
    async function reportGo() {
      const rep = S.rep; if (!rep || S.busy) return;
      S.rep = null; renderModal();
      S.busy = 'Resmî rapor oluşturuluyor… (birkaç saniye sürebilir)'; renderBusy();
      let step = 'seçim'; const T0 = performance.now(), lap = n => jlog('info', 'süre', 'Rapor · ' + n + ': ' + Math.round(performance.now() - T0) + ' ms');
      try {
        LS.set('emz3-rtype', rep.vals.rtype);
        const ok = await syncSelection(new Set(rep.ids));
        if (!ok.ok) throw new Error('Seçili kayıtlar eski ekranda işaretlenemedi (' + ok.n + '/' + rep.ids.length + ').');
        lap('seçim'); step = 'pencere'; await openNativeDialog(); lap('pencere açıldı');
        step = 'alan doldurma'; await applyDialog(rep.vals, rep.base); lap('alanlar dolduruldu');
        const chk = readDialog();
        if (!chk || !chk.rtype || !chk.rtype.value) throw new Error('Rapor tipi seçilemedi.');
        const btn = $$('button', chk._content.closest('.MuiModal-root') || document).find(b => trl(b.textContent).trim() === 'rapor oluştur');
        if (!btn) throw new Error('"Rapor Oluştur" düğmesi bulunamadı.');
        step = 'PDF bekleme';
        const since = SEQ, before = new Set($$('.Toastify__toast'));
        btn.click();
        const pdf = await waitPdf(since, before); lap('PDF geldi');
        const q = S.lastQuery || {};
        const id = 'r' + Date.now();
        const label = (q.ada && !q.id ? 'Ada ' + q.ada + ' / Parsel ' + q.parsel : 'Rayiç bedel') + ' · ' + rep.rows.length + ' kayıt · ' + rep.vals.rtype;
        const rec = {
          id, ts: Date.now(), label, size: pdf.size, blob: pdf.blob,
          name: 'Rayic-Bedel-' + (q.ada && !q.id ? q.ada + '-' + q.parsel : 'rapor') + '-' + stamp() + '.pdf',
          parcels: [...new Set(rep.rows.map(r => r.ada + '/' + r.parsel))], count: rep.rows.length, rtype: rep.vals.rtype,
          owners: [...new Set(rep.rows.map(r => r.name).filter(Boolean))]
        };
        S.reports.unshift(Object.assign({}, rec, { url: ownBlobUrl(pdf.blob), at: new Date(rec.ts).toLocaleString('tr-TR') }));
        while (S.reports.length > CFG.reports.keep) { const o = S.reports.pop(); try { URL.revokeObjectURL(o.url); } catch (e) { /* yoksay */ } RDB.del(o.id).catch(() => {}); }
        RDB.put(rec).then(() => RDB.prune(CFG.reports.keep)).catch(e => jlog('warn', 'depo', 'Rapor kalıcı kaydedilemedi: ' + e.message));
        renderTray();
        jlog('info', 'rapor', 'Rapor oluşturuldu (' + (pdf.size / 1024).toFixed(0) + ' KB)');
        S.viewer = id;
        closeNative().catch(() => {});   // arka planda kapanır
        sfx.play('ok'); sfx.say('やった！');
      } catch (e) { repFail(step, e); await closeNative(); S.rep = rep; /* ayarlar kaybolmasın, tekrar denenebilsin */ }
      S.busy = ''; renderBusy(); renderModal();
    }

    /* ----------------------- Olaylar ----------------------- */
    const selAll = on => visibleRows().forEach(r => on ? S.sel.add(r._id) : S.sel.delete(r._id));
    function refreshSel() {
      $$('#out [data-row]').forEach(el => { const on = S.sel.has(el.dataset.row); el.classList.toggle('sel', on); const cb = $('[data-sel]', el); if (cb) cb.checked = on; });
      $$('#out [data-own]').forEach(el => { const o = S.owners[+el.dataset.own]; if (!o) return; const on = o.ids.every(id => S.sel.has(id)); el.classList.toggle('sel', on); const cb = $('[data-ownsel]', el); if (cb) cb.checked = on; });
      const all = $('#out [data-selall]'); if (all) { const rows = visibleRows(); all.checked = rows.length > 0 && rows.every(r => S.sel.has(r._id)); }
      renderFab();
    }
    const setView = v => { S.view = v; LS.set('emz3-view', v); renderOut(); };
    const repById = id => S.reports.find(x => x.id === id);
    const fillForm = q => { $('#q-ada').value = q.ada || ''; $('#q-parsel').value = q.parsel || ''; $('#q-tc').value = q.id || q.tc || ''; vknBox().checked = !!q.vkn; refreshForm(); };
    const ACT = {
      theme() { const d = document.documentElement.classList.toggle('emz-dark'); LS.set('emz-theme', d ? 'dark' : 'light'); },
      classic() { document.documentElement.classList.add('emz-classic'); },
      log(el) { S.logOpen = true; S.logSel = null; if (el.dataset.tab) S.logTab = el.dataset.tab; if (S.logTab === 'health') runHealth(); renderLog(); },
      closelog() { S.logOpen = false; renderLog(); },
      logtab(el) { S.logTab = el.dataset.tab; if (S.logTab === 'health') runHealth(); renderLog(); },
      rehealth() { runHealth(); renderLogBody(); toast('Sağlık kontrolü yenilendi'); },
      diag() { copy(JSON.stringify(buildReport(false), null, 2), 'Tanılama raporu kopyalandı'); },
      diagdl() { downloadBlob(new Blob([JSON.stringify(buildReport(true), null, 2)], { type: 'application/json' }), 'emz-tanilama-' + stamp() + '.json'); toast('Tanılama raporu indirildi', 2400, 'ok'); },
      logclear() { LOG.length = 0; JR.length = 0; LS.set('emz5-journal', []); S.logSel = null; jlog('info', 'sistem', 'Günlükler temizlendi'); renderLog(); updateChip(); },
      copyentry(el) { const e = LOG.find(x => x.seq === +el.dataset.seq); if (e) copy(JSON.stringify({ yöntem: e.method, url: e.url, durum: e.status, ms: e.ms, gövde: e.body, yanıt: e.preview, hata: e.err }, null, 2), 'İstek kopyalandı'); },
      sfx() { sfx.setOn(!sfx.on); $('#b-sfx').textContent = sfx.on ? '🔊 Ses' : '🔇 Ses'; if (sfx.on) sfx.play('nya'); },
      idvis() {
        UI.showId = !UI.showId;
        const b = $('#b-idvis'); if (b) b.textContent = UI.showId ? '👁 Kimlik' : '🙈 Kimlik gizli';
        renderHist(); renderResults(); refreshForm();
        toast(UI.showId ? 'Kimlik numaraları gösteriliyor' : 'Kimlik numaraları gizlendi');
      },
      reset() {
        cancelQuery(); ['#q-ada', '#q-parsel', '#q-tc'].forEach(s => { $(s).value = ''; }); vknBox().checked = false; $('#q-ada').focus();
        S.rows = []; S.queried = false; S.error = ''; S.info = ''; S.warns = []; S.meta = null; S.acc = {}; S.sel.clear(); renderResults(); refreshForm();
      },
      clearhist() { S.hist = []; histSave([]); renderHist(); },
      cols() { S.colMenu = !S.colMenu; renderColPop(); },
      colreset() { S.hidden = new Set(DEFAULT_HIDDEN); LS.set('emz3-hidden', DEFAULT_HIDDEN); renderOut(); renderColPop(); },
      dense() { S.dense = !S.dense; LS.set('emz3-dense', S.dense); renderOut(); },
      csv() { downloadCSV(exportRows(false)); },
      csvsel() { downloadCSV(exportRows(true)); },
      json() { downloadJSON(exportRows(false)); },
      qcancel() { cancelQuery('Sorgu iptal edildi.'); renderResults(); refreshForm(); },
      refresh() { const q = (S.meta && S.meta.q) || S.lastQuery; if (!q || S.loading) return; fillForm(q); runQuery(); },
      copy() { const r = exportRows(false); r.length ? copy(toTSV(r), r.length + ' satır kopyalandı (Excel’e yapıştırabilirsiniz)' + idNote()) : toast('Kayıt yok'); },
      copysel() { copy(toTSV(exportRows(true))); },
      print() { window.print(); },
      more() { S.limit += 1000; renderOut(); },
      fdebt() { S.fDebt = !S.fDebt; renderResults(); },
      'fowner-off'() { S.fOwner = null; renderResults(); },
      report() { reportStart(); },
      report1() { reportStart(S.drawer); },
      'rep-cancel'() { S.rep = null; renderModal(); },
      'rep-go'() { reportGo(); },
      unsel() { S.sel.clear(); refreshSel(); },
      closedr() { S.drawer = null; renderLayer(); },
      acc() { loadAcc(); },
      prev() { navDrawer(-1); }, next() { navDrawer(1); },
      copyrow() { const r = S.rows.find(x => x._id === S.drawer); if (r) copy(COLS.map(c => c.label + ': ' + disp(c, r[c.key])).join('\n') + (UI.showId ? '' : '\n(kimlik maskeli)')); },
      tray() { S.trayQ = ''; S.tray = true; renderModal(); },
      closetray() { S.tray = false; renderModal(); },
      'pdf-open'(el) { S.tray = false; S.viewer = el.dataset.rid; renderModal(); },
      closeview() { S.viewer = null; renderModal(); },
      'pdf-dl'(el) { const r = repById(el.dataset.rid); if (r) downloadBlob(r.blob, r.name); },
      'pdf-tab'(el) { const r = repById(el.dataset.rid); if (r) window.open(r.url, '_blank'); },
      'pdf-del'(el) {
        const r = repById(el.dataset.rid); if (!r) return;
        if (S.viewer === r.id) S.viewer = null;
        S.reports = S.reports.filter(x => x.id !== r.id);
        try { URL.revokeObjectURL(r.url); } catch (e) { /* yoksay */ }
        RDB.del(r.id).catch(() => {});
        renderTray(); renderModal();
      },
      'pdf-clear'() {
        if (!confirm('Kayıtlı tüm raporlar silinsin mi?')) return;
        S.reports.forEach(r => { try { URL.revokeObjectURL(r.url); } catch (e) { /* yoksay */ } });
        S.reports = []; S.viewer = null; RDB.clear().catch(() => {});
        renderTray(); renderModal();
      },
      'pdf-print'() { const fr = $('#emz-pdf'); try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (er) { const r = repById(S.viewer); if (r) window.open(r.url, '_blank'); toast('PDF yeni sekmede açıldı; oradan yazdırın.'); } }
    };
    function navDrawer(d) {
      const list = visibleRows(), p = list.findIndex(x => x._id === S.drawer), np = list[p + d];
      if (np) { S.drawer = np._id; renderLayer(); }
    }

    let cpTimer = null;
    app.addEventListener('click', e => {
      const t = e.target;
      try {

        const sb = t.closest('button,.chip,.st[data-copy],input[type=checkbox]');
        if (sb) { const a = (sb.dataset && sb.dataset.act) || ''; sfx.play(/^(close|rep-cancel)/.test(a) ? 'close' : /^(log|tray|report|report1|pdf-open)$/.test(a) ? 'open' : sb.id === 'b-run' ? 'nya' : 'click'); }        

        // Sütun menüsü dışına tıklanınca (hangi öğeye tıklanırsa tıklansın) kapanır
        if (S.colMenu && !t.closest('.pop') && !t.closest('[data-act="cols"]')) { S.colMenu = false; renderColPop(); }
        const act = t.closest('[data-act]');
        if (act) { const fn = ACT[act.dataset.act]; if (fn) fn(act, e); return; }
        if (t.matches('#b-run')) return runQuery();
        const sv = t.closest('[data-view]'); if (sv) return setView(sv.dataset.view);
        const hc = t.closest('[data-hist]'); if (hc && hc.dataset.hist !== '') { const h = S.hist[+hc.dataset.hist]; if (h) { fillForm(h); runQuery(); } return; }
        const fc = t.closest('[data-ft]'); if (fc) { S.fType = fc.dataset.ft || null; renderResults(); return; }
        const fs2 = t.closest('[data-fs]'); if (fs2) { S.fStatus = fs2.dataset.fs || null; renderResults(); return; }
        if (t.dataset.col) { S.hidden.has(t.dataset.col) ? S.hidden.delete(t.dataset.col) : S.hidden.add(t.dataset.col); LS.set('emz3-hidden', [...S.hidden]); renderOut(); return; }
        if (t.matches('[data-selall]')) { selAll(t.checked); refreshSel(); return; }
        if (t.matches('[data-sel]')) {
          const i = t.dataset.sel;
          if (e.shiftKey && S.lastSel) {
            const list = visibleRows(), a = list.findIndex(x => x._id === S.lastSel), b = list.findIndex(x => x._id === i);
            if (a >= 0 && b >= 0) for (let k = Math.min(a, b); k <= Math.max(a, b); k++) t.checked ? S.sel.add(list[k]._id) : S.sel.delete(list[k]._id);
          }
          t.checked ? S.sel.add(i) : S.sel.delete(i); S.lastSel = i; refreshSel(); return;
        }
        if (t.matches('[data-ownsel]')) { const o = S.owners[+t.dataset.ownsel]; if (o) { o.ids.forEach(id => t.checked ? S.sel.add(id) : S.sel.delete(id)); refreshSel(); } return; }
        const th = t.closest('[data-sort]');
        if (th) { const k = th.dataset.sort; S.sort = S.sort.key === k ? (S.sort.dir === 1 ? { key: k, dir: -1 } : { key: null, dir: 1 }) : { key: k, dir: 1 }; renderOut(); return; }
        const lg = t.closest('[data-lg]'); if (lg) { S.logSel = +lg.dataset.lg; renderLogBody(); return; }
        const cp = t.closest('[data-cp]'); if (cp) { copy(cp.dataset.cp); return; }
        const cc = t.closest('[data-copy]'); if (cc) { copy(cc.dataset.copy, cc.dataset.copy + ' kopyalandı'); return; }
        const cbc = t.closest('td.cb'); if (cbc && t.tagName !== 'INPUT') { const i = $('input', cbc); if (i) i.click(); return; }
        const ow = t.closest('[data-own]'); if (ow) { const o = S.owners[+ow.dataset.own]; if (o) { S.fOwner = o.key; setView('table'); renderResults(); } return; }
        const row = t.closest('[data-row]');
        if (row) {
          const r = S.rows.find(x => x._id === row.dataset.row);
          if (!r) return;
          const td = t.closest('td[data-c]');
          if (!td) { S.drawer = r._id; renderLayer(); return; }   // kart görünümünde kart tıklaması ayrıntıyı açar
          const c = COL[td.dataset.c];
          let v = r[c.key];
          if (v == null || v === '') { toast(c.label + ' boş', 2000, 'bad'); return; }
          if (c.type === 'money' || c.type === 'area') { const n = num(v); if (!isNaN(n)) v = f2(n); }
          if (c.key === 'tc' && !UI.showId) v = maskId(String(v));   // maskeliyken gerçek numara panoya gitmez
          clearTimeout(cpTimer);
          cpTimer = setTimeout(() => copy(String(v), c.label + ' kopyalandı: ' + v), 280);
          return;
        }
      } catch (err) {
        jlog('error', 'arayüz', 'Tıklama işlenemedi: ' + err.message, err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : '');
        toast('Beklenmeyen hata: ' + err.message + ' (ayrıntı: Günlük)', 4500, 'bad');
        if (S.busy) { S.busy = ''; renderBusy(); }
      }
    });


    app.addEventListener('dblclick', e => {
      clearTimeout(cpTimer);
      const row = e.target.closest('[data-row]');
      
      if (row && !e.target.closest('input')) { window.getSelection().removeAllRanges(); S.drawer = row.dataset.row; renderLayer(); }
    });

    $('#modal').addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.rp; if (k && S.rep) S.rep.vals[k] = e.target.value; });
    $('#modal').addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.rp; if (k && S.rep) S.rep.vals[k] = e.target.value; });
    $('#modal').addEventListener('input', e => { if (e.target.id === 'tray-q') { S.trayQ = e.target.value; const l = $('#tray-list'); if (l) l.innerHTML = trayListHtml(); } });
    $('#logm').addEventListener('input', e => { if (e.target.id === 'log-q') { S.logQ = e.target.value; renderLogBody(); } });
    $('#logm').addEventListener('change', e => {
      if (e.target.id === 'log-err') { S.logErr = e.target.checked; renderLogBody(); }
      else if (e.target.id === 'log-body') S.repBody = e.target.checked;
    });
    $('#q-search').addEventListener('input', e => { S.search = e.target.value; renderStats(); renderFilters(); renderOut(); });
    vknBox().addEventListener('change', refreshForm);
    ['#q-ada', '#q-parsel'].forEach(s => $(s).addEventListener('input', refreshForm));
    $('#q-tc').addEventListener('input', e => { const c = e.target.value.replace(/\D/g, ''); if (c !== e.target.value) e.target.value = c; refreshForm(); });
    ['#q-ada', '#q-parsel', '#q-tc'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runQuery(); } }));
    app.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('chip')) { e.preventDefault(); e.target.click(); } });

    document.addEventListener('keydown', e => {
      const cl = document.documentElement.classList;
      if (cl.contains('emz-classic') || cl.contains('emz-away')) return;
      const typing = /INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''));
      if (e.key === 'Escape') {
        if (S.busy) return;
        if (S.viewer) { S.viewer = null; renderModal(); }
        else if (S.rep) { S.rep = null; renderModal(); }
        else if (S.tray) { S.tray = false; renderModal(); }
        else if (S.logOpen) { S.logOpen = false; renderLog(); }
        else if (S.drawer != null) { S.drawer = null; renderLayer(); }
        else if (S.colMenu) { S.colMenu = false; renderColPop(); }
      } else if (e.key === '/' && !typing) { e.preventDefault(); $('#q-ada').focus(); $('#q-ada').select(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing && S.rows.length) { e.preventDefault(); selAll(true); refreshSel(); }
      else if (S.drawer != null && !typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) navDrawer(e.key === 'ArrowRight' ? 1 : -1);
    });

    // Hata ayıklama için erişim; numaralandırılamaz (sayfa betiklerinin anahtar taramasında görünmez)
    if (LS.get('emz-debug', false)) { try { Object.defineProperty(window, '__EMZ__', { value: { VER, CFG, LOG, PDFS, JR, S, health: runHealth, report: buildReport, mapRow }, enumerable: false, configurable: true }); } catch (e) { /* yoksay */ } }
    renderHist(); renderResults(); renderTray(); refreshForm();
    RDB.all().then(list => {
      const have = new Set(S.reports.map(r => r.id));
      list.filter(r => !have.has(r.id) && r.blob).forEach(r => S.reports.push(Object.assign({}, r, { url: ownBlobUrl(r.blob), at: new Date(r.ts).toLocaleString('tr-TR') })));
      S.reports.sort((a, b) => b.ts - a.ts);
      renderTray(); if (S.tray) renderModal();
      if (list.length) jlog('info', 'depo', list.length + ' kayıtlı rapor yüklendi');
    }).catch(() => {});
    $('#q-ada').focus();
    setTimeout(() => { try { runHealth(); } catch (e) { jlog('error', 'sağlık', 'Sağlık kontrolü çalışmadı: ' + e.message); } }, 1500);
  }
})();