// ==UserScript==
// @name         EBYS Plus (Birleşik)
// @namespace    http://tampermonkey.net/
// @version      29.0.0
// @description  EBYS Plus (otomatik giriş, şablonlar, çoklu dosya) + Evrak Kaşe Asistanı (PDF önizleme kontrol yazıları ve havale tablosu) tek dosyada; ortak kurulum ve ortak ayarlar.
// @author       Sen
// @match        https://ebys.tkgm.gov.tr/edys-web/sistemeGiris.xhtml*
// @match        https://ebys.tkgm.gov.tr/edys-web/mainInbox.xhtml*
// @match        https://ebys.tkgm.gov.tr/edys-web/pdfjs19/web/viewer.xhtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gov.tr
// @run-at       document-idle
// @grant        none
// @updateURL      https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/ebys-plus.user.js
// @downloadURL    https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/ebys-plus.user.js
// ==/UserScript==

// Hangi sayfadayız? PDF önizleme sayfasında sadece Kaşe Asistanı, diğerlerinde sadece EBYS Plus çalışır.
const __EP_PDF_SAYFASI__ = location.pathname.includes('/pdfjs19/web/viewer.xhtml');

/* ============================================================
   BÖLÜM 1 - EVRAK KAŞE ASİSTANI (PDF önizleme sayfası)
   ============================================================ */
if (__EP_PDF_SAYFASI__) {
(function () {
  'use strict';

  // ================= Depolama =================
  // NOT: Bu anahtarlar EBYS Plus bölümüyle ORTAKTIR (aynı alan adı, aynı localStorage).
  const OLD_KEY = 'tkgmDamgaPresets';
  const SET_KEY = 'tkgmDamgaSettingsV2';
  const POS_KEY = 'tkgmDamgaPosV3';
  const LAST_MEMUR = 'tkgmSonMemur';

  const store = {
    get(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const getLast = () => { try { return localStorage.getItem(LAST_MEMUR) || ''; } catch (e) { return ''; } };
  const setLast = v => { try { localStorage.setItem(LAST_MEMUR, v); } catch (e) {} };

  const DEF_PRESETS = [
    { label: 'Tescil/terkin', l1: 'TAKBİS tescil/terkin kontrolü\ntarafımdan yapılmıştır.', isim: true },
    { label: 'Kütük terkin', l1: 'TAKBİS ve kütük terkin kontrolü\ntarafımdan yapılmıştır.', isim: true },
  ];

  function sanitizeSettings(o) {
    const arr = x => (Array.isArray(x) ? x : []);
    const memurlar = arr(o && o.memurlar).map(x => String(x).trim()).filter(Boolean);
    let sabit = String((o && o.sabit) || '').trim();
    if (!memurlar.includes(sabit)) sabit = '';
    return {
      presets: arr(o && o.presets)
        .filter(p => p && typeof p.label === 'string' && p.label.trim())
        .map(p => ({ label: p.label.trim(), l1: String(p.l1 || ''), isim: p.isim === undefined ? true : !!p.isim })),
      memurlar,
      havaleEden: typeof (o && o.havaleEden) === 'string' ? o.havaleEden : 'OTOMATİK HAVALE',
      sabit,
      upper: !!(o && o.upper),
    };
  }
  function sanitizePos(o) {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    Object.keys(o).forEach(k => {
      const p = o[k];
      if (p && isFinite(p.x) && isFinite(p.y) && isFinite(p.size)) out[k] = { x: +p.x, y: +p.y, size: +p.size };
    });
    return out;
  }

  function loadSettings() {
    const s = store.get(SET_KEY, null);
    if (s && Array.isArray(s.presets)) return sanitizeSettings(s);
    let presets = DEF_PRESETS;
    const o = store.get(OLD_KEY, null);
    if (Array.isArray(o) && o.length) presets = o;
    return sanitizeSettings({ presets, memurlar: [], havaleEden: 'OTOMATİK HAVALE' });
  }

  let settings = loadSettings();
  let pos = sanitizePos(store.get(POS_KEY, {}));
  const saveSettings = () => store.set(SET_KEY, settings);

  const HROWS = [
    ['GÖREVLİ MEMUR:', 'memur'], ['YEVMİYE NO:', 'yevNo'],
    ['YEVMİYE TARİHİ:', 'yevTarih'], ['SAAT:', 'saat'], ['HAVALE EDEN:', 'havale'],
  ];
  const HAND = ['yevNo', 'yevTarih', 'saat'];

  const STAMP_CSS = `
    .tk-stamp{position:absolute;z-index:50;color:#000;box-sizing:border-box}
    .tk-stamp.t{font-family:"Times New Roman",Times,serif;text-align:center;line-height:1.25;white-space:pre}
    .tk-stamp.t .nm{font-weight:bold;font-style:italic}
    .tk-stamp.h{font-family:Calibri,Arial,sans-serif;color:#0b1a6b;background:transparent;border-radius:.6em}
    .tk-stamp.h table{width:100%;border-collapse:separate;border-spacing:0;border:.14em solid #1a3a9c;
      border-radius:0 0 .6em .6em;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .tk-stamp.h td{border:0;border-right:.12em solid #1a3a9c;border-bottom:.12em solid #1a3a9c;
      padding:.15em .6em;font-weight:700;line-height:1.15;height:auto}
    .tk-stamp.h td:last-child{border-right:0}
    .tk-stamp.h tr:last-child td{border-bottom:0}
    .tk-stamp.h td.k{width:1%;white-space:nowrap}
    .tk-stamp.h td.v{min-width:8em;font-weight:600}
    .tk-stamp.h tr.el td{padding-top:.3675em;padding-bottom:.3675em}
    .tk-stamp.h .hd{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:.8em;
      border:.14em solid #1a3a9c;border-bottom:0;border-radius:.6em .6em 0 0;padding:.2em .6em;
      background:rgba(26,58,156,.08);-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .tk-stamp.h .hd .hl{font-size:.75em;font-weight:700;letter-spacing:.14em;color:#1a3a9c;
      line-height:1.2;white-space:nowrap}
    .tk-stamp.h .hd .hn{flex:1;text-align:right;font-size:1.45em;font-weight:800;line-height:1.2;
      min-width:3em;min-height:1.2em;letter-spacing:.04em;color:#0b1a6b}
  `;

  function layout(el, size, pw, u) {
    if (el.dataset.type === 'h') {
      el.style.width = (size / 100 * pw) + u;
      el.style.fontSize = (size / 100 * pw * 0.05) + u;
    } else {
      el.style.fontSize = (size / 100 * pw) + u;
    }
  }

  const mk = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const pad = n => String(n).padStart(2, '0');

  function dragWith(handle, e, onMove, onEnd) {
    try { handle.setPointerCapture(e.pointerId); } catch (x) {}
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      handle.removeEventListener('pointermove', onMove);
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => handle.removeEventListener(t, end));
      onEnd();
    };
    handle.addEventListener('pointermove', onMove);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => handle.addEventListener(t, end));
  }

  const TOP = (() => {
    try { const d = window.top.document; return d && d.body ? d : document; } catch (e) { return document; }
  })();

  let started = false;
  const wait = setInterval(() => {
    const A = window.PDFViewerApplication;
    if (!started && A && A.pdfDocument && A.pdfViewer) { started = true; clearInterval(wait); init(A); }
  }, 300);

  function init(A) {
    let stamps = [];
    let gid = 0;
    let allPages = false;
    let printing = false;
    const hist = ['[]'];
    let textT = 0;
    let havaleEklendi = false;

    const st = mk('style');
    st.textContent = STAMP_CSS + `
      .tk-stamp{outline:1px dashed transparent;transition:outline-color .15s}
      .tk-stamp:hover,.tk-stamp:focus-within,.tk-stamp.tk-front{outline-color:#3b82f6}
      .tk-stamp.tk-front{z-index:60}
      .tk-stamp .l1,.tk-stamp .nm,.tk-stamp td.v,.tk-stamp .hn{outline:none;min-width:20px}
      .tk-stamp .rz{position:absolute;right:-8px;bottom:-8px;width:14px;height:14px;border-radius:50%;
        background:#2563eb;border:2px solid #fff;cursor:nwse-resize;touch-action:none;
        opacity:0;pointer-events:none;transition:opacity .15s;box-shadow:0 1px 4px #0006}
      .tk-stamp:hover .rz,.tk-stamp:focus-within .rz,.tk-stamp.tk-front .rz{opacity:1;pointer-events:auto}
      #tk-tb{position:fixed;z-index:15000;display:none;gap:2px;padding:0;background:transparent;
        font:11px/1 system-ui,Arial,sans-serif}
      #tk-tb.show{display:flex}
      #tk-tb span{display:grid;place-items:center;width:24px;height:24px;padding:0;border-radius:5px;
        background:rgba(37,99,235,.9);color:#fff;font-size:13px;cursor:pointer;user-select:none;
        opacity:.65;transition:opacity .12s,background .12s}
      #tk-tb span:hover{opacity:1;background:rgba(29,78,216,1)}
      #tk-tb .x{background:rgba(220,38,38,.9)}
      #tk-tb .x:hover{background:rgba(185,28,28,1)}
      #tk-tb .mv{cursor:move;touch-action:none}
      #tk-root{position:fixed;top:44px;right:18px;z-index:10000;display:flex;flex-direction:column;align-items:flex-end;gap:10px;
        font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
      #tk-fab{width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;color:#fff;position:relative;
        background:linear-gradient(135deg,#3b82f6,#1d4ed8);box-shadow:0 4px 14px #0007;display:grid;place-items:center;transition:transform .15s}
      #tk-fab:hover{transform:scale(1.08)}
      #tk-fab .ic-x{display:none}
      #tk-root.open #tk-fab .ic-main{display:none}
      #tk-root.open #tk-fab .ic-x{display:block}
      #tk-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;
        font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 4px;box-sizing:border-box}
      #tk-panel{width:236px;background:rgba(30,32,38,.97);color:#e8eaed;border-radius:14px;padding:12px;border:1px solid #ffffff1f;
        box-shadow:0 12px 32px #000b;display:none;flex-direction:column;gap:6px}
      #tk-root.open #tk-panel{display:flex;animation:tkIn .16s ease-out}
      @keyframes tkIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
      .tk-title{font-weight:700;font-size:14px;padding:2px 2px 4px}
      .tk-sec{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#9aa0a6;margin:8px 2px 0}
      .tk-btn{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:#ffffff14;
        color:#e8eaed;cursor:pointer;font:inherit;text-align:left;box-sizing:border-box}
      .tk-btn:hover{background:#ffffff26}
      .tk-btn.hv{background:#1e40af}
      .tk-btn.hv:hover{background:#1d4ed8}
      .tk-btn.pri{background:#16a34a;color:#fff;font-weight:600;justify-content:center}
      .tk-btn.pri:hover{background:#15803d}
      .tk-btn.usr{background:#ffffff0d;border:1px dashed #ffffff40;font-size:12px}
      .tk-btn.usr .u{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tk-row{display:flex;gap:6px}
      .tk-row .tk-btn{justify-content:center;padding:7px 6px}
      .tk-sw{display:flex;align-items:center;justify-content:space-between;padding:6px 4px;cursor:pointer;user-select:none}
      .tk-sw input{display:none}
      .tk-sw i{width:34px;height:19px;border-radius:10px;background:#5f6368;position:relative;transition:.2s;flex:none}
      .tk-sw i::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:.2s}
      .tk-sw input:checked+i{background:#3b82f6}
      .tk-sw input:checked+i::after{left:17px}
      .tk-hint{font-size:11px;color:#9aa0a6;margin:2px 2px 0}
      #tk-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:#202124;color:#fff;padding:9px 16px;
        border-radius:8px;z-index:30000;box-shadow:0 4px 16px #0009;font:13px system-ui,Arial,sans-serif;opacity:0;
        transition:opacity .2s;pointer-events:none}
      #tk-toast.show{opacity:1}
      .tk-ov{position:fixed;inset:0;background:#0008;z-index:20000;display:flex;align-items:center;justify-content:center;
        font:14px system-ui,Arial,sans-serif}
      .tk-box{background:#fff;color:#222;border-radius:12px;padding:20px;width:460px;max-width:94vw;max-height:90vh;overflow:auto;box-shadow:0 12px 40px #000a}
      .tk-box h3{margin:0 0 6px;font-size:17px}
      .tk-box .sub{font-size:12px;color:#666;margin:0 0 4px}
      .tk-box label.l{display:block;font-weight:700;margin:12px 0 4px;font-size:12px;color:#444}
      .tk-box input[type=text],.tk-box input:not([type]),.tk-box select,.tk-box textarea{width:100%;box-sizing:border-box;padding:8px;
        border:1px solid #c4c7cc;border-radius:6px;font:14px system-ui,Arial,sans-serif;background:#fff;color:#222}
      .tk-box input:focus,.tk-box select:focus,.tk-box textarea:focus{outline:2px solid #3b82f655;border-color:#3b82f6}
      .tk-box textarea{resize:vertical}
      .tk-box .row{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}
      .tk-box button{border:0;border-radius:6px;padding:8px 14px;cursor:pointer;font-size:13px;background:#2563eb;color:#fff}
      .tk-box button:hover{filter:brightness(1.1)}
      .tk-box button.c{background:#6b7280}
      .tk-box button.d{background:#dc2626;padding:6px 10px}
      .tk-box button.s{background:#e5e7eb;color:#222}
      .tk-box .pr-item{border:1px solid #e0e2e6;border-radius:8px;padding:10px;margin-top:8px;background:#fafafa}
      .tk-box .pr-item .top{display:flex;gap:6px;align-items:center}
      .tk-box hr{border:0;border-top:1px solid #e0e2e6;margin:18px 0 4px}
      .tk-box details{margin-top:12px;border:1px solid #e0e2e6;border-radius:8px;padding:8px 10px}
      .tk-box summary{cursor:pointer;font-weight:600;font-size:13px}
      .tk-box .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
      .tk-box .chk{display:flex;align-items:center;gap:6px;margin-top:12px;font-size:13px;cursor:pointer}
      .tk-box .chk input{width:auto}
      .tk-box .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .tk-ov{z-index:2147483000;background:rgba(15,23,42,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:tkFade .18s ease-out}
      #tk-toast{z-index:2147483600}
      @keyframes tkFade{from{opacity:0}to{opacity:1}}
      @keyframes tkPop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
      .tk-box.wide{--ac:#2563eb;--ac2:#1d4ed8;--bd:#e5e7eb;--mut:#6b7280;--bg:#f8fafc;
        width:960px;max-width:96vw;height:82vh;max-height:780px;padding:0;display:flex;flex-direction:column;overflow:hidden;
        border-radius:18px;background:#fff;box-shadow:0 24px 64px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);
        animation:tkPop .2s ease-out}
      .tk-box.wide .st-head{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--bd);background:#fff}
      .tk-box .st-ttl{display:flex;align-items:center;gap:12px}
      .tk-box .st-logo{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:18px;color:#fff;
        background:linear-gradient(135deg,#3b82f6,#1d4ed8);box-shadow:0 4px 12px rgba(37,99,235,.35)}
      .tk-box.wide .st-head h3{margin:0;font-size:17px;font-weight:700;color:#111827}
      .tk-box .st-hs{margin:2px 0 0;font-size:12px;color:var(--mut)}
      .tk-box.wide .st-x{width:34px;height:34px;padding:0;border-radius:50%;display:grid;place-items:center;background:#f1f5f9;color:#475569;font-size:14px}
      .tk-box.wide .st-x:hover{background:#e2e8f0;filter:none}
      .tk-box.wide .st-body{flex:1;display:flex;min-height:0}
      .tk-box.wide .st-nav{width:210px;flex:none;border-right:1px solid var(--bd);background:var(--bg);padding:14px 10px;
        display:flex;flex-direction:column;gap:3px;overflow:auto}
      .tk-box.wide .st-tab{display:flex;align-items:center;gap:10px;text-align:left;background:transparent;color:#374151;
        padding:9px 10px;border-radius:10px;font-size:13.5px;font-weight:500;transition:background .15s,color .15s,box-shadow .15s}
      .tk-box.wide .st-tab .ic{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#e9eef5;font-size:14px;transition:.15s;flex:none}
      .tk-box.wide .st-tab:hover{background:#eef2f7;filter:none}
      .tk-box.wide .st-tab.on{background:#fff;color:var(--ac2);font-weight:600;box-shadow:0 1px 3px rgba(15,23,42,.1),0 0 0 1px rgba(37,99,235,.18)}
      .tk-box.wide .st-tab.on .ic{background:var(--ac)}
      .tk-box.wide .st-pages{flex:1;overflow:auto;padding:24px 28px;background:#fff;scrollbar-width:thin}
      .tk-box .st-page{animation:tkFade .18s ease-out}
      .tk-box .st-page h4{margin:0 0 4px;font-size:18px;font-weight:700;color:#111827}
      .tk-box .st-sub{margin:0 0 18px;color:var(--mut);font-size:13px;line-height:1.5}
      .tk-box.wide input[type=text],.tk-box.wide input:not([type]),.tk-box.wide select,.tk-box.wide textarea{
        border:1px solid #d9dee5;border-radius:10px;padding:9px 12px;font-size:13.5px;background:#fff;transition:border-color .15s,box-shadow .15s}
      .tk-box.wide input[type=text]:focus,.tk-box.wide input:not([type]):focus,.tk-box.wide select:focus,.tk-box.wide textarea:focus{
        outline:0;border-color:var(--ac);box-shadow:0 0 0 3px rgba(37,99,235,.15)}
      .tk-box.wide label.l{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:16px 0 6px}
      .tk-box.wide .st-card{border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:12px;background:#fff;
        box-shadow:0 1px 2px rgba(15,23,42,.04);transition:box-shadow .15s,border-color .15s}
      .tk-box.wide .st-card:hover{border-color:#cfd6df;box-shadow:0 4px 14px rgba(15,23,42,.07)}
      .tk-box .st-top{display:flex;gap:6px;align-items:center;margin-bottom:10px}
      .tk-box.wide .st-ic{background:#f1f5f9;color:#475569;width:32px;height:32px;min-width:0;padding:0;border-radius:8px;
        display:grid;place-items:center;font-size:14px;flex:none}
      .tk-box.wide .st-ic:hover{background:#e2e8f0;filter:none}
      .tk-box.wide .st-ic.dng{background:#fff1f2;color:#e11d48}
      .tk-box.wide .st-ic.dng:hover{background:#ffe4e6}
      .tk-box.wide .st-chk{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:13.5px;color:#374151;cursor:pointer;user-select:none}
      .tk-box.wide .st-card>.st-chk:only-child{margin-top:0}
      .tk-box.wide .st-chk input[type=checkbox]{appearance:none;-webkit-appearance:none;width:36px;height:20px;border-radius:10px;
        background:#cbd5e1;position:relative;cursor:pointer;flex:none;transition:background .2s;padding:0;border:0;margin:0}
      .tk-box.wide .st-chk input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
        background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
      .tk-box.wide .st-chk input[type=checkbox]:checked{background:var(--ac)}
      .tk-box.wide .st-chk input[type=checkbox]:checked::after{transform:translateX(16px)}
      .tk-box.wide .st-add{background:#f5f9ff;color:var(--ac2);border:1.5px dashed #93c5fd;padding:12px;width:100%;border-radius:12px;font-weight:600;transition:.15s}
      .tk-box.wide .st-add:hover{background:#eaf3ff;filter:none}
      .tk-box.wide .st-pri{background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:9px 16px;border-radius:10px;font-weight:600;white-space:nowrap}
      .tk-box.wide .st-addbar{display:flex;gap:8px;margin-bottom:12px}
      .tk-box.wide details.st-bulk{margin:0 0 4px;border:1px solid var(--bd);border-radius:12px;background:var(--bg);padding:10px 14px}
      .tk-box.wide details.st-bulk summary{color:#374151}
      .tk-box.wide .st-tools{display:flex;gap:8px;align-items:center;margin:14px 0 10px}
      .tk-box.wide .st-tools button.s{background:#f1f5f9;color:#374151;border-radius:10px;padding:9px 12px}
      .tk-box.wide .st-count{margin-left:auto;font-size:12px;font-weight:600;color:var(--ac2);background:#eaf1ff;padding:4px 10px;border-radius:20px}
      .tk-box.wide .st-none{display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:13px;color:#4b5563;background:var(--bg);
        border:1px solid var(--bd);border-radius:10px;margin-bottom:8px;cursor:pointer}
      .tk-box.wide .st-none input,.tk-box.wide .st-prow input[type=radio]{width:auto;accent-color:#f59e0b;flex:none;margin:0}
      .tk-box.wide .st-plist{border:1px solid var(--bd);border-radius:14px;max-height:44vh;overflow:auto;scrollbar-width:thin;background:#fff}
      .tk-box.wide .st-prow{display:flex;gap:8px;align-items:center;padding:7px 12px;border-bottom:1px solid #f0f2f5;transition:background .12s}
      .tk-box.wide .st-prow:hover{background:#f8fafc}
      .tk-box.wide .st-prow:last-child{border-bottom:0}
      .tk-box.wide .st-prow.def{background:#fffbeb}
      .tk-box .st-av{width:32px;height:32px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;
        background:linear-gradient(135deg,#60a5fa,#4f46e5)}
      .tk-box.wide .st-prow.def .st-av{box-shadow:0 0 0 2px #fff,0 0 0 4px #f59e0b}
      .tk-box.wide .st-prow input.f-pname{flex:1;border-color:transparent;background:transparent}
      .tk-box.wide .st-prow input.f-pname:hover{border-color:#e2e8f0}
      .tk-box.wide .st-prow input.f-pname:focus{background:#fff}
      .tk-box.wide .st-empty{padding:28px;text-align:center;color:#94a3b8;font-size:13px;border:1.5px dashed #d1d5db;border-radius:14px;background:var(--bg)}
      .tk-box.wide .st-danger{border-color:#fecdd3;background:#fff8f8}
      .tk-box .st-dt{font-weight:700;color:#be123c;font-size:13.5px}
      .tk-box .st-ds{margin:4px 0 12px;color:#6b7280;font-size:12.5px}
      .tk-box.wide button.d{background:#fff;color:#e11d48;border:1px solid #fda4af;padding:9px 14px;border-radius:10px;font-weight:600}
      .tk-box.wide button.d:hover{background:#e11d48;color:#fff;filter:none}
      .tk-box.wide .row{margin:0;padding:14px 24px;border-top:1px solid var(--bd);background:var(--bg);align-items:center}
      .tk-box.wide .row::before{content:"Değişiklikler «Kaydet» ile uygulanır";margin-right:auto;font-size:12px;color:#94a3b8}
      .tk-box.wide .row button{padding:9px 20px;border-radius:10px;font-weight:600;font-size:13.5px}
      .tk-box.wide .row button.c{background:#fff;color:#374151;border:1px solid #d9dee5}
      .tk-box.wide .row button:not(.c){background:linear-gradient(135deg,#3b82f6,#1d4ed8);box-shadow:0 2px 8px rgba(37,99,235,.35)}
      @media (max-width:720px){
        .tk-box.wide{height:92vh}
        .tk-box.wide .st-body{flex-direction:column}
        .tk-box.wide .st-nav{width:auto;flex-direction:row;border-right:0;border-bottom:1px solid var(--bd);overflow-x:auto;padding:8px}
        .tk-box.wide .st-tab span:last-child{white-space:nowrap}
        .tk-box.wide .st-pages{padding:16px}
        .tk-box.wide .row::before{display:none}
        .tk-box.wide .st-tab::before{display:none}
      }
      .tk-box.wide .st-tab{position:relative}
      .tk-box.wide .st-tab::before{content:"";position:absolute;left:-10px;top:50%;width:4px;height:0;border-radius:0 4px 4px 0;
        background:var(--ac);transform:translateY(-50%);transition:height .18s}
      .tk-box.wide .st-tab.on::before{height:22px}
      .tk-box.wide .st-tab:hover:not(.on){transform:translateX(2px)}
      .tk-box.wide .st-tab .ic{color:#64748b;background:#e9eef5}
      .tk-box.wide .st-tab .ic svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      .tk-box.wide .st-tab.on .ic{color:#fff;background:linear-gradient(135deg,#3b82f6,#1d4ed8);box-shadow:0 2px 6px rgba(37,99,235,.35)}
      .tk-box.wide .st-tab:focus-visible{outline:2px solid rgba(37,99,235,.45);outline-offset:1px}
      .tk-box.wide .st-addbar{align-items:stretch}
      .tk-box.wide .st-pri{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 18px;
        box-shadow:0 2px 8px rgba(37,99,235,.3);transition:transform .15s,box-shadow .15s,filter .15s}
      .tk-box.wide .st-pri:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(37,99,235,.4);filter:none}
      .tk-box.wide .st-pri:active{transform:translateY(0);box-shadow:0 1px 4px rgba(37,99,235,.35)}
      .tk-box.wide .st-pri:focus-visible,.tk-box.wide .st-add:focus-visible{outline:2px solid rgba(37,99,235,.45);outline-offset:2px}
      .tk-box.wide .st-add:hover{transform:translateY(-1px);border-color:#60a5fa}
      .tk-box.wide .st-add:active{transform:none}
      .tk-box.wide .st-ic{transition:background .15s,transform .15s}
      .tk-box.wide .st-ic:active{transform:scale(.92)}
      .tk-box.wide .st-pri{position:relative;overflow:hidden;gap:8px;min-height:40px;padding:0 18px 0 12px;
        border:1px solid rgba(29,78,216,.55);border-radius:11px;font-size:13.5px;font-weight:600;letter-spacing:.01em;
        background:linear-gradient(180deg,#4f8ff7 0%,#2563eb 55%,#1d4ed8 100%);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 1px 2px rgba(29,78,216,.4),0 4px 12px rgba(37,99,235,.28)}
      .tk-box.wide .st-pri::after{content:"";position:absolute;top:0;left:-70%;width:45%;height:100%;
        background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);transform:skewX(-20deg);transition:left .5s ease}
      .tk-box.wide .st-pri:hover::after{left:130%}
      .tk-box.wide .st-pri:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 2px 4px rgba(29,78,216,.4),0 8px 20px rgba(37,99,235,.4)}
      .tk-box.wide .st-pri:active{box-shadow:inset 0 2px 4px rgba(15,23,42,.25),0 1px 2px rgba(29,78,216,.4)}
      .tk-box.wide .pl{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;
        background:rgba(255,255,255,.22);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);flex:none;transition:transform .25s}
      .tk-box.wide .pl svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round}
      .tk-box.wide .st-pri:hover .pl,.tk-box.wide .st-add:hover .pl{transform:rotate(90deg)}
      .tk-box.wide .st-add{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13.5px}
      .tk-box.wide .st-add .pl{background:#dbeafe;color:var(--ac2);box-shadow:none}
      .tk-box.wide .st-tools button.s,.tk-box.wide .row button.c{border:1px solid #d9dee5;background:#fff;color:#374151;
        box-shadow:0 1px 2px rgba(15,23,42,.06);transition:background .15s,border-color .15s,transform .15s,box-shadow .15s}
      .tk-box.wide .st-tools button.s:hover,.tk-box.wide .row button.c:hover{background:#f8fafc;border-color:#b8c1cc;
        transform:translateY(-1px);box-shadow:0 4px 10px rgba(15,23,42,.08);filter:none}
      .tk-box.wide .st-tools button.s:active,.tk-box.wide .row button.c:active{transform:none;box-shadow:none}
      .tk-box.wide .row button:not(.c){border:1px solid rgba(29,78,216,.55);
        background:linear-gradient(180deg,#4f8ff7 0%,#2563eb 55%,#1d4ed8 100%);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 4px 12px rgba(37,99,235,.3);
        transition:transform .15s,box-shadow .15s,filter .15s}
      .tk-box.wide .row button:not(.c):hover{transform:translateY(-1px);filter:none;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 8px 20px rgba(37,99,235,.4)}
      .tk-box.wide .row button:not(.c):active{transform:none;box-shadow:inset 0 2px 4px rgba(15,23,42,.25)}
      .tk-box.wide svg.bi{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
      .tk-box.wide .row button,.tk-box.wide .st-tools button.s,.tk-box.wide button.d{display:inline-flex;align-items:center;justify-content:center;gap:8px}
      .tk-box.wide button:focus-visible,.tk-box.wide summary:focus-visible{outline:2px solid rgba(37,99,235,.45);outline-offset:2px}
      .tk-box.wide .st-x svg.bi{width:15px;height:15px;stroke-width:2.4}
      .tk-box.wide .st-ic{border:1px solid #e5e7eb;background:#fff;color:#64748b;box-shadow:0 1px 2px rgba(15,23,42,.05);
        transition:background .15s,border-color .15s,color .15s,transform .15s,box-shadow .15s}
      .tk-box.wide .st-ic svg.bi{width:15px;height:15px}
      .tk-box.wide .st-ic:hover{background:#eff6ff;border-color:#bfdbfe;color:var(--ac2);transform:translateY(-1px);
        box-shadow:0 3px 8px rgba(37,99,235,.15);filter:none}
      .tk-box.wide .st-ic.dng{background:#fff;color:#f43f5e}
      .tk-box.wide .st-ic.dng:hover{background:#fff1f2;border-color:#fecdd3;color:#e11d48;box-shadow:0 3px 8px rgba(225,29,72,.15)}
      .tk-box.wide .st-ic:active{transform:scale(.92);box-shadow:none}
      .tk-box.wide button.d{box-shadow:0 1px 2px rgba(225,29,72,.08);transition:background .15s,color .15s,transform .15s,box-shadow .15s}
      .tk-box.wide button.d:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(225,29,72,.3)}
      .tk-box.wide button.d:active{transform:none;box-shadow:inset 0 2px 4px rgba(0,0,0,.2)}
      .tk-box.wide .row button{min-height:40px;padding:0 20px;border-radius:11px}
      .tk-box.wide .row button svg.bi{width:16px;height:16px;stroke-width:2.4}
      .tk-box.wide .st-none input[type=radio],.tk-box.wide .st-prow input[type=radio]{appearance:none;-webkit-appearance:none;
        width:18px;height:18px;border-radius:50%;border:2px solid #cbd5e1;background:#fff;cursor:pointer;flex:none;margin:0;padding:0;
        display:grid;place-items:center;transition:border-color .15s,background .15s,box-shadow .15s}
      .tk-box.wide .st-none input[type=radio]::after,.tk-box.wide .st-prow input[type=radio]::after{content:"";width:8px;height:8px;border-radius:50%;
        background:#fff;transform:scale(0);transition:transform .15s}
      .tk-box.wide .st-prow input[type=radio]:hover,.tk-box.wide .st-none input[type=radio]:hover{border-color:#f59e0b}
      .tk-box.wide .st-none input[type=radio]:checked,.tk-box.wide .st-prow input[type=radio]:checked{
        border-color:#f59e0b;background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.2)}
      .tk-box.wide .st-none input[type=radio]:checked::after,.tk-box.wide .st-prow input[type=radio]:checked::after{transform:scale(1)}
      .tk-box.wide details.st-bulk summary{list-style:none;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;font-weight:600}
      .tk-box.wide details.st-bulk summary::-webkit-details-marker{display:none}
      .tk-box.wide details.st-bulk summary::before{content:"";width:7px;height:7px;border-right:2px solid #64748b;border-bottom:2px solid #64748b;
        transform:rotate(-45deg);transition:transform .2s;margin:0 3px 0 2px}
      .tk-box.wide details.st-bulk[open] summary::before{transform:rotate(45deg)}
      .tk-box.wide details.st-bulk summary:hover{color:var(--ac2)}
      .tk-box.wide details.st-bulk[open] summary{margin-bottom:10px}
      .tk-box.wide .row{gap:10px}
      .tk-box.wide .row button{position:relative;overflow:hidden;min-height:42px;padding:0 22px;border-radius:12px;
        font-size:13.5px;font-weight:600;letter-spacing:.01em;cursor:pointer;
        transition:transform .15s,box-shadow .2s,background .2s,border-color .2s,color .2s}
      .tk-box.wide .row button svg.bi{transition:transform .25s,color .2s}
      .tk-box.wide .row button.c{background:#fff;color:#475569;border:1px solid #d5dbe3;
        box-shadow:0 1px 2px rgba(15,23,42,.06)}
      .tk-box.wide .row button.c:hover{background:#f8fafc;color:#0f172a;border-color:#b6c0cc;
        transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.1)}
      .tk-box.wide .row button.c:hover svg.bi{color:#dc2626}
      .tk-box.wide .row button.c:active{transform:scale(.97);box-shadow:none;background:#f1f5f9}
      .tk-box.wide .row button:not(.c){color:#fff;border:1px solid rgba(29,78,216,.6);
        background:linear-gradient(180deg,#5b9bff 0%,#2563eb 52%,#1d4ed8 100%);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 1px 2px rgba(29,78,216,.45),0 6px 16px rgba(37,99,235,.3)}
      .tk-box.wide .row button:not(.c)::after{content:"";position:absolute;top:0;left:-70%;width:45%;height:100%;
        background:linear-gradient(100deg,transparent,rgba(255,255,255,.38),transparent);
        transform:skewX(-20deg);transition:left .55s ease;pointer-events:none}
      .tk-box.wide .row button:not(.c):hover{transform:translateY(-1px);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 2px 4px rgba(29,78,216,.45),0 10px 24px rgba(37,99,235,.42)}
      .tk-box.wide .row button:not(.c):hover::after{left:130%}
      .tk-box.wide .row button:not(.c):active{transform:scale(.97);
        box-shadow:inset 0 2px 5px rgba(15,23,42,.3)}
      .tk-box.wide .row button:not(.c) svg.bi path{stroke-dasharray:24;stroke-dashoffset:0}
      .tk-box.wide .row button:not(.c):hover svg.bi path{animation:tkTick .4s ease-out}
      @keyframes tkTick{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}
      .tk-box.wide .row button:focus-visible{outline:0;box-shadow:0 0 0 3px #fff,0 0 0 5px rgba(37,99,235,.6)}
      .tk-box.wide .st-x{width:34px;height:34px;padding:0;border-radius:10px;
        border:1px solid transparent;background:transparent;color:#94a3b8;
        transition:background .15s,color .15s,border-color .15s,transform .12s}
      .tk-box.wide .st-x svg.bi{width:16px;height:16px;stroke-width:2.2;transform:none}
      .tk-box.wide .st-x:hover{background:#fef2f2;color:#dc2626;border-color:#fecaca;
        transform:none;filter:none}
      .tk-box.wide .st-x:active{background:#fee2e2;transform:scale(.94)}
      .tk-box.wide .st-x:focus-visible{outline:0;box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(220,38,38,.4)}
      @media (max-width:720px){
        .tk-box.wide .row button{flex:1}
      }
      .tk-box.wide .row{padding:11px 22px;gap:8px}
      .tk-box.wide .row button{min-height:34px;padding:0 16px;border-radius:999px;font-size:13px;gap:6px}
      .tk-box.wide .row button svg.bi{width:14px;height:14px;stroke-width:2.4}
      .tk-box.wide .st-x{width:34px;height:34px;border-radius:50%;
        border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;
        box-shadow:0 1px 2px rgba(15,23,42,.06);
        transition:background .15s,color .15s,border-color .15s,box-shadow .15s,transform .12s}
      .tk-box.wide .st-x svg.bi{width:15px;height:15px;stroke-width:2.4}
      .tk-box.wide .st-x:hover{background:#fee2e2;color:#dc2626;border-color:#fecaca;
        box-shadow:0 0 0 4px rgba(220,38,38,.1);transform:none}
      .tk-box.wide .st-x:active{background:#fecaca;transform:scale(.92);box-shadow:none}
      .tk-box.wide .st-x:focus-visible{outline:0;box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(220,38,38,.45)}
    `;
    document.head.appendChild(st);
    if (TOP !== document) TOP.head.appendChild(st.cloneNode(true));

    const pageDiv = n => document.querySelector('.page[data-page-number="' + n + '"]');
    const curPage = () => A.pdfViewer.currentPageNumber || 1;
    const stopKeys = el => ['keydown', 'keypress', 'keyup'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));

    const toastEl = mk('div'); toastEl.id = 'tk-toast';
    TOP.body.appendChild(toastEl);
    let toastT;
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastT);
      toastT = setTimeout(() => toastEl.classList.remove('show'), 2400);
    }

    const tb = mk('div'); tb.id = 'tk-tb';
    tb.innerHTML = '<span class="mv" title="Taşı">✥</span><span class="dup" title="Kopyala">⧉</span><span class="x" title="Sil">✕</span>';
    document.body.appendChild(tb);
    const tbMv = tb.querySelector('.mv');
    let active = null, hideT = 0, switchT = 0, dragging = false;

    function hideTb() {
      clearTimeout(hideT);
      tb.classList.remove('show');
      if (active) active.el.classList.remove('tk-front');
      active = null;
    }
    function placeTb() {
      if (!active) return;
      if (!active.el.isConnected) return hideTb();
      const r = active.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) { tb.classList.remove('show'); return; }
      tb.classList.add('show');
      const h = tb.offsetHeight, w = tb.offsetWidth;
      let top = r.top - h - 6;
      if (top < 4) top = r.bottom + 6;
      const left = Math.max(4, Math.min(r.left, innerWidth - w - 4));
      tb.style.top = top + 'px'; tb.style.left = left + 'px';
    }
    function activate(obj) {
      clearTimeout(hideT);
      if (active && active !== obj) active.el.classList.remove('tk-front');
      active = obj;
      obj.el.classList.add('tk-front');
      placeTb();
    }
    function scheduleHide() {
      clearTimeout(hideT);
      hideT = setTimeout(() => {
        if (dragging || !active) return;
        if (active.el.contains(document.activeElement)) return;
        hideTb();
      }, 450);
    }
    tb.addEventListener('pointerenter', () => { clearTimeout(hideT); clearTimeout(switchT); });
    tb.addEventListener('pointerleave', scheduleHide);
    tb.querySelector('.dup').onclick = () => { if (active) active.dup(); };
    tb.querySelector('.x').onclick = () => { if (active) active.del(); };
    tbMv.addEventListener('pointerdown', e => { if (active) active.move(e); });

    function savePos(s) {
      const r2 = v => Math.round(v * 100) / 100;
      const x = parseFloat(s.style.left), y = parseFloat(s.style.top), size = +s.dataset.size;
      if (!isFinite(x) || !isFinite(y) || !isFinite(size)) return;
      pos[s.dataset.key] = { x: r2(x), y: r2(y), size: r2(size) };
      store.set(POS_KEY, pos);
    }

    function getData(s) {
      if (s.dataset.type === 't') {
        const nmEl = s.querySelector('.nm');
        return { l1: s.querySelector('.l1').innerText, nm: nmEl ? nmEl.innerText : '' };
      }
      const d = {};
      const hn = s.querySelector('.hd .hn');
      d.basvuru = hn ? hn.innerText.trim() : '';
      s.querySelectorAll('td.v').forEach((td, i) => { d[HROWS[i][1]] = td.innerText.trim(); });
      return d;
    }

    // Yapıştırmayı düz metne çevir (execCommand çalışmazsa Range ile ekler)
    function plainPaste(el) {
      el.addEventListener('paste', e => {
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
        let ok = false;
        try { ok = document.execCommand('insertText', false, t); } catch (x) {}
        if (!ok) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0);
            r.deleteContents();
            const n = document.createTextNode(t);
            r.insertNode(n);
            r.setStartAfter(n); r.collapse(true);
            sel.removeAllRanges(); sel.addRange(r);
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }

    function snapshot() {
      return JSON.stringify(stamps.map(o => ({
        page: o.page, gid: o.gid, type: o.el.dataset.type, key: o.el.dataset.key,
        x: parseFloat(o.el.style.left), y: parseFloat(o.el.style.top),
        size: +o.el.dataset.size, data: getData(o.el),
      })));
    }
    function commit() {
      const s = snapshot();
      if (s === hist[hist.length - 1]) return;
      hist.push(s);
      if (hist.length > 40) hist.shift();
    }
    function flushText() { if (textT) { clearTimeout(textT); textT = 0; commit(); } }
    function restore(json) {
      hideTb();
      stamps.forEach(o => o.el.remove());
      stamps = [];
      JSON.parse(json).forEach(d => createStamp(d.type, d.key, d.data, d.page, { x: d.x, y: d.y, size: d.size }, d.gid));
      updateBadge();
    }

    function createStamp(type, key, data, n, p, g) {
      const host = pageDiv(n);
      if (!host) return;
      const s = mk('div', 'tk-stamp ' + type);
      s.dataset.type = type;
      s.dataset.key = key;
      s.dataset.size = p.size;
      s.style.left = p.x + '%';
      s.style.top = p.y + '%';

      if (type === 't') {
        const l1 = mk('div', 'l1', data.l1); l1.contentEditable = 'true'; l1.spellcheck = false;
        plainPaste(l1);
        s.appendChild(l1);
        if (data.nm) {
          const nm = mk('div', 'nm', data.nm); nm.contentEditable = 'true'; nm.spellcheck = false;
          plainPaste(nm);
          s.appendChild(nm);
        }
      } else {
        const hd = mk('div', 'hd');
        const hl = mk('span', 'hl', 'BAŞVURU NO:');
        const hn = mk('span', 'hn', data.basvuru || '');
        hn.contentEditable = 'true'; hn.spellcheck = false;
        plainPaste(hn);
        hd.append(hl, hn);
        s.appendChild(hd);

        const tbl = mk('table');
        HROWS.forEach(([label, f]) => {
          const tr = mk('tr');
          const a = mk('td', 'k', label);
          const b = mk('td', 'v', data[f] || ''); b.contentEditable = 'true'; b.spellcheck = false;
          plainPaste(b);
          if (HAND.includes(f)) {
            const upd = () => tr.classList.toggle('el', !b.textContent.trim());
            upd(); b.addEventListener('input', upd);
          }
          tr.append(a, b); tbl.appendChild(tr);
        });
        s.appendChild(tbl);
      }

      const rz = mk('div', 'rz'); rz.title = 'Boyutlandır (sürükle)';
      s.appendChild(rz);
      stopKeys(s);
      s.addEventListener('input', () => { clearTimeout(textT); textT = setTimeout(() => { textT = 0; commit(); }, 600); });

      const obj = { el: s, page: n, gid: g };
      const minS = type === 'h' ? 15 : 0.8;
      const maxS = type === 'h' ? 100 : 9;

      obj.del = () => {
        s.remove();
        stamps = stamps.filter(o => o !== obj);
        if (active === obj) hideTb();
        updateBadge();
        commit();
      };
      obj.dup = () => {
        addStamp(type, key, getData(s), {
          page: n,
          pos: { x: Math.min(parseFloat(s.style.left) + 2, 95), y: Math.min(parseFloat(s.style.top) + 3, 95), size: +s.dataset.size },
        });
      };
      obj.move = e => {
        e.preventDefault();
        const pr = s.parentElement.getBoundingClientRect();
        const sr = s.getBoundingClientRect();
        const offX = e.clientX - sr.left, offY = e.clientY - sr.top;
        dragging = true;
        dragWith(tbMv, e, ev => {
          let x = (ev.clientX - offX - pr.left) / pr.width * 100;
          let y = (ev.clientY - offY - pr.top) / pr.height * 100;
          x = Math.max(0, Math.min(100 - sr.width / pr.width * 100, x));
          y = Math.max(0, Math.min(100 - sr.height / pr.height * 100, y));
          s.style.left = x + '%'; s.style.top = y + '%';
          placeTb();
        }, () => { dragging = false; savePos(s); commit(); scheduleHide(); });
      };

      s.addEventListener('pointerenter', () => {
        clearTimeout(switchT);
        if (active && active !== obj) {
          switchT = setTimeout(() => activate(obj), 300);
        } else activate(obj);
      });
      s.addEventListener('pointerdown', () => { clearTimeout(switchT); activate(obj); });
      s.addEventListener('pointerleave', () => { clearTimeout(switchT); scheduleHide(); });
      s.addEventListener('focusin', () => activate(obj));
      s.addEventListener('focusout', scheduleHide);

      rz.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX;
        const w0 = s.getBoundingClientRect().width || 1;
        const s0 = +s.dataset.size;
        dragWith(rz, e, ev => {
          const k = Math.max(0.2, (w0 + ev.clientX - x0) / w0);
          s.dataset.size = Math.min(maxS, Math.max(minS, s0 * k));
          tickNow();
        }, () => { savePos(s); commit(); });
      });

      host.appendChild(s);
      stamps.push(obj);
      tickNow();
    }

    function nextY(n) {
      let y = 2;
      const host = pageDiv(n);
      if (!host) return y;
      const pr = host.getBoundingClientRect();
      if (!pr.height) return y;
      stamps.forEach(o => {
        if (o.page !== n || !o.el.isConnected) return;
        const r = o.el.getBoundingClientRect();
        y = Math.max(y, (r.bottom - pr.top) / pr.height * 100 + 1);
      });
      return Math.min(y, 95);
    }

    function addStamp(type, key, data, opts) {
      opts = opts || {};
      const base = type === 'h' ? { x: 55, y: 4, size: 29 } : { x: 50, y: 85, size: 1.8 };
      const p = Object.assign({}, base, pos[key] || {}, opts.pos || {});
      p.x = Math.min(Math.max(+p.x || 0, 0), 95);
      p.y = Math.min(Math.max(+p.y || 0, 0), 95);
      p.size = +p.size || base.size;
      const hasSaved = !!(pos[key] || opts.pos);

      let pages;
      if (opts.page) pages = [opts.page];
      else if (allPages) pages = Array.from({ length: A.pdfDocument.numPages }, (_, i) => i + 1);
      else pages = [curPage()];

      const g = ++gid;
      pages.forEach(n => createStamp(type, key, data, n,
        hasSaved ? p : Object.assign({}, p, { x: 2, y: nextY(n) }), g));
      updateBadge();
      commit();
    }

    function tickNow() {
      stamps.forEach(o => {
        if (!o.el.isConnected) { const p = pageDiv(o.page); if (p) p.appendChild(o.el); }
        const p = o.el.parentElement;
        if (p && p.clientWidth) layout(o.el, +o.el.dataset.size, p.clientWidth, 'px');
      });
      placeTb();
    }
    let raf = 0;
    const tick = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; tickNow(); }); };
    if (A.eventBus && A.eventBus.on) {
      ['pagerendered', 'scalechange', 'pagesloaded', 'pagechanging', 'rotationchanging'].forEach(ev => A.eventBus.on(ev, tick));
    } else {
      setInterval(tickNow, 800);
    }
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);

    function modal(build) {
      const ov = mk('div', 'tk-ov');
      const box = mk('div', 'tk-box');
      ov.appendChild(box);
      stopKeys(ov);
      const close = () => ov.remove();
      build(box, close);
      TOP.body.appendChild(ov);
      return ov;
    }
    const field = (box, label, el) => {
      const l = mk('label', 'l', label);
      box.append(l, el);
      return el;
    };

    const BI = {
      up: '<svg class="bi" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
      down: '<svg class="bi" viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
      x: '<svg class="bi" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
      check: '<svg class="bi" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
      sort: '<svg class="bi" viewBox="0 0 24 24"><path d="M11 5h10M11 9h7M11 13h4"/><path d="M3 17l3 3 3-3M6 4v16"/></svg>',
      trash: '<svg class="bi" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
      reset: '<svg class="bi" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    };

    const btnRow = (box, okText, onOk, close) => {
      const r = mk('div', 'row');
      const c = mk('button', 'c', 'Vazgeç'); c.onclick = close;
      const o = mk('button', '', okText); o.onclick = onOk;
      if (box.classList.contains('wide')) {
        c.innerHTML = BI.x; c.append('Vazgeç');
        o.innerHTML = BI.check; o.append(okText);
      }
      r.append(c, o); box.appendChild(r);
    };

    const fmtName = n => (settings.upper ? n.toLocaleUpperCase('tr') : n);

    function defaultUser() {
      if (settings.sabit && settings.memurlar.includes(settings.sabit)) return settings.sabit;
      const last = getLast();
      return settings.memurlar.includes(last) ? last : '';
    }

    function pickUser(title, cb) {
      modal((box, close) => {
        box.appendChild(mk('h3', '', title));
        box.appendChild(mk('p', 'sub', 'Kaşede görünecek ad soyad'));
        const sel = field(box, 'Kullanıcı', mk('select'));
        const def = defaultUser();
        if (!def) { const o = mk('option', '', '— Seçin —'); o.value = ''; sel.appendChild(o); }
        settings.memurlar.forEach(m => { const o = mk('option', '', m); o.value = m; sel.appendChild(o); });
        sel.value = def;

        const wrap = mk('label', 'chk');
        const cb2 = mk('input'); cb2.type = 'checkbox'; cb2.checked = !!settings.sabit;
        wrap.append(cb2, document.createTextNode('Her zaman bu kullanıcıyı kullan (bir daha sorma)'));
        box.appendChild(wrap);

        const ok = () => {
          if (!sel.value) return toast('Lütfen bir kullanıcı seçin');
          setLast(sel.value);
          settings.sabit = cb2.checked ? sel.value : '';
          saveSettings(); buildPanel(); close();
          cb(sel.value);
        };
        sel.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
        btnRow(box, 'Tamam', ok, close);
        setTimeout(() => sel.focus(), 50);
      });
    }

    function addControl(p, name) {
      addStamp('t', 't:' + p.label, { l1: p.l1, nm: fmtName(name) });
    }
    function onPreset(p) {
      if (!p.isim) return addStamp('t', 't:' + p.label, { l1: p.l1, nm: '' });
      const list = settings.memurlar;
      if (!list.length) {
        toast('Önce Ayarlar\'dan görevli memur ekleyin');
        return settingsForm();
      }
      if (settings.sabit && list.includes(settings.sabit)) return addControl(p, settings.sabit);
      if (settings.sabit) { settings.sabit = ''; saveSettings(); buildPanel(); }
      if (havaleEklendi && list.includes(getLast())) return addControl(p, getLast());
      pickUser('Kullanıcı seçin', name => addControl(p, name));
    }

    function havaleForm() {
      modal((box, close) => {
        box.appendChild(mk('h3', '', 'Havale bilgileri'));

        const bas = field(box, 'Başvuru No', mk('input'));
        bas.type = 'text';
        const sel = field(box, 'Görevli Memur', mk('select'));
        if (!settings.memurlar.length) {
          const o = mk('option', '', '(Ayarlardan memur ekleyin)'); o.value = ''; sel.appendChild(o);
        } else {
          settings.memurlar.forEach(m => { const o = mk('option', '', m); o.value = m; sel.appendChild(o); });
          sel.value = defaultUser() || settings.memurlar[0];
        }
        const hav = field(box, 'Havale Eden', mk('input'));
        hav.type = 'text'; hav.value = settings.havaleEden || '';

        const det = mk('details');
        det.appendChild(mk('summary', '', 'Yevmiye bilgileri (isteğe bağlı)'));
        const g3 = mk('div', 'grid3');
        const mkIn = (ph) => { const i = mk('input'); i.type = 'text'; i.placeholder = ph; return i; };
        const yNo = mkIn('Yevmiye No'), yTar = mkIn('GG.AA.YYYY'), saat = mkIn('SS:DD');
        g3.append(yNo, yTar, saat);
        det.appendChild(g3);
        const chkWrap = mk('label', 'chk');
        const now = mk('input'); now.type = 'checkbox';
        chkWrap.append(now, document.createTextNode('Tarih ve saati şimdiki zamanla doldur'));
        det.appendChild(chkWrap);
        box.appendChild(det);

        const ok = () => {
          if (!sel.value) {
            toast('Görevli memur seçilmedi' + (settings.memurlar.length ? '' : ' — Ayarlardan ekleyin'));
            return;
          }
          setLast(sel.value);
          havaleEklendi = true;
          let yt = yTar.value.trim(), sa = saat.value.trim();
          if (now.checked) {
            const d = new Date();
            yt = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
            sa = pad(d.getHours()) + ':' + pad(d.getMinutes());
          }
          addStamp('h', 'h', {
            basvuru: bas.value.trim(), memur: sel.value, yevNo: yNo.value.trim(),
            yevTarih: yt, saat: sa, havale: hav.value.trim(),
          });
          buildPanel();
          close();
        };
        [bas, hav, yNo, yTar, saat].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); }));
        btnRow(box, 'Ekle', ok, close);
        setTimeout(() => bas.focus(), 50);
      });
    }

    function settingsForm() {
      modal((box, close) => {
        box.classList.add('wide');

        const head = mk('div', 'st-head');
        const xb = mk('button', 'st-x'); xb.innerHTML = BI.x; xb.title = 'Kapat'; xb.onclick = close;
        const ttl = mk('div', 'st-ttl');
        const tt = mk('div');
        tt.append(mk('h3', '', 'Ayarlar'), mk('p', 'st-hs', 'Kontrol yazıları, personel ve havale tercihleri'));
        ttl.append(mk('span', 'st-logo', '⚙'), tt);
        head.append(ttl, xb);
        const nav = mk('div', 'st-nav');
        const pagesEl = mk('div', 'st-pages');
        const body = mk('div', 'st-body');
        body.append(nav, pagesEl);
        box.append(head, body);

        const tabs = [];

        const ICONS = {
          pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
          users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
          clip: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/></svg>',
          sliders: '<svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></svg>',
        };

        const addTab = (icon, title) => {
          const b = mk('button', 'st-tab');
          const ico = mk('span', 'ic'); ico.innerHTML = ICONS[icon] || icon;
          b.append(ico, mk('span', '', title));
          const pg = mk('div', 'st-page');
          b.onclick = () => tabs.forEach(t => {
            const on = t.b === b;
            t.b.classList.toggle('on', on);
            t.pg.style.display = on ? '' : 'none';
          });
          tabs.push({ b, pg });
          nav.appendChild(b); pagesEl.appendChild(pg);
          return pg;
        };
        const fld = (parent, label, el) => { parent.append(mk('label', 'l', label), el); return el; };
        const GL = { '↑': BI.up, '↓': BI.down, '✕': BI.trash };
        const ic = (txt, title, cls) => {
          const b = mk('button', 'st-ic' + (cls ? ' ' + cls : ''));
          b.innerHTML = GL[txt] || txt; b.title = title; return b;
        };
        const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
        const withPlus = (b, text) => { b.textContent = ''; const i = mk('i', 'pl'); i.innerHTML = PLUS; b.append(i, document.createTextNode(text)); return b; };
        const sib = (el, k) => { let s = el[k]; while (s && s.style.display === 'none') s = s[k]; return s; };

        const p1 = addTab('pen', 'Kontrol yazıları');
        p1.append(mk('h4', '', 'Kontrol yazıları'),
          mk('p', 'st-sub', 'Panelde buton olarak görünen hazır yazılar. Sırayı ↑ ↓ ile değiştirebilirsiniz.'));
        const plist = mk('div'); p1.appendChild(plist);

        function addPreset(p) {
          const it = mk('div', 'st-card');
          const top = mk('div', 'st-top');
          const lab = mk('input', 'f-label'); lab.type = 'text'; lab.placeholder = 'Buton adı'; lab.value = p.label || '';
          const up = ic('↑', 'Yukarı taşı'), dn = ic('↓', 'Aşağı taşı'), del = ic('✕', 'Sil', 'dng');
          up.onclick = () => { const s = it.previousElementSibling; if (s) plist.insertBefore(it, s); };
          dn.onclick = () => { const s = it.nextElementSibling; if (s) plist.insertBefore(s, it); };
          del.onclick = () => it.remove();
          top.append(lab, up, dn, del);
          const txt = mk('textarea', 'f-text'); txt.rows = 3; txt.placeholder = 'Yazı metni'; txt.value = p.l1 || '';
          const w = mk('label', 'st-chk');
          const cb = mk('input', 'f-isim'); cb.type = 'checkbox'; cb.checked = p.isim !== false;
          w.append(cb, document.createTextNode('Kaşeye isim ekle (kullanıcı seçimi sorulur)'));
          it.append(top, txt, w);
          plist.appendChild(it);
        }
        settings.presets.forEach(addPreset);
        const addP = withPlus(mk('button', 'st-add'), 'Yeni yazı ekle');
        addP.onclick = () => { addPreset({}); plist.lastElementChild.querySelector('.f-label').focus(); };
        p1.appendChild(addP);

        const p2 = addTab('users', 'Personel');
        p2.append(mk('h4', '', 'Personel'),
          mk('p', 'st-sub', 'Kaşe ve havalede seçilebilecek görevli memurlar. Soldaki yuvarlakla varsayılan kullanıcıyı seçebilirsiniz; seçilen kişi bir daha sorulmaz.'));

        const gname = 'tkdef' + Date.now();
        const mlist = mk('div', 'st-plist');
        const empty = mk('div', 'st-empty', 'Henüz kimse eklenmedi. Yukarıdaki kutuya ad soyad yazıp Enter\'a basın.');
        const count = mk('span', 'st-count');
        const noneR = mk('input'); noneR.type = 'radio'; noneR.name = gname;

        const refresh = () => {
          const rows = [...mlist.children];
          rows.forEach(rw => rw.classList.toggle('def', rw.querySelector('input[type=radio]').checked));
          count.textContent = rows.length + ' kişi';
          mlist.style.display = rows.length ? '' : 'none';
          empty.style.display = rows.length ? 'none' : '';
        };
        const names = () => [...mlist.querySelectorAll('.f-pname')].map(i => i.value.trim().replace(/\s+/g, ' ')).filter(Boolean);
        const has = v => names().some(n => n.toLocaleLowerCase('tr') === v.toLocaleLowerCase('tr'));

        function addPerson(name, isDef) {
          const row = mk('div', 'st-prow');
          const r = mk('input'); r.type = 'radio'; r.name = gname; r.title = 'Varsayılan kullanıcı yap'; r.checked = !!isDef;
          r.onchange = refresh;
          const inp = mk('input', 'f-pname'); inp.type = 'text'; inp.value = name; inp.placeholder = 'Ad Soyad';
          const ini = s => s.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr') || '?';
          const av = mk('span', 'st-av', ini(name));
          inp.addEventListener('input', () => { av.textContent = ini(inp.value); });
          const up = ic('↑', 'Yukarı taşı'), dn = ic('↓', 'Aşağı taşı'), del = ic('✕', 'Sil', 'dng');
          up.onclick = () => { const s = sib(row, 'previousElementSibling'); if (s) mlist.insertBefore(row, s); };
          dn.onclick = () => { const s = sib(row, 'nextElementSibling'); if (s) mlist.insertBefore(s, row); };
          del.onclick = () => { const was = r.checked; row.remove(); if (was) noneR.checked = true; refresh(); };
          row.append(r, av, inp, up, dn, del);
          mlist.appendChild(row);
          return row;
        }

        const nin = mk('input'); nin.type = 'text'; nin.placeholder = 'Ad Soyad yazın, Enter ile ekleyin';
        const nbtn = withPlus(mk('button', 'st-pri'), 'Ekle');
        const addBar = mk('div', 'st-addbar'); addBar.append(nin, nbtn);
        const doAdd = () => {
          const v = nin.value.trim().replace(/\s+/g, ' ');
          if (!v) return;
          if (has(v)) return toast('Bu kişi zaten listede');
          const row = addPerson(v, false);
          nin.value = ''; nin.focus(); refresh();
          row.scrollIntoView({ block: 'nearest' });
        };
        nbtn.onclick = doAdd;
        nin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });

        const bulk = mk('details', 'st-bulk');
        bulk.appendChild(mk('summary', '', 'Toplu ekle (her satıra bir isim)'));
        const bta = mk('textarea'); bta.rows = 5; bta.placeholder = 'Ahmet Yılmaz\nAyşe Demir\n...';
        const bbtn = withPlus(mk('button', 'st-pri'), 'Listeye ekle'); bbtn.style.marginTop = '8px';
        bbtn.onclick = () => {
          let n = 0;
          bta.value.split('\n').forEach(line => {
            const v = line.trim().replace(/\s+/g, ' ');
            if (v && !has(v)) { addPerson(v, false); n++; }
          });
          bta.value = ''; refresh();
          toast(n ? n + ' kişi eklendi' : 'Eklenecek yeni isim bulunamadı');
        };
        bulk.append(bta, bbtn);

        const fil = mk('input'); fil.type = 'text'; fil.placeholder = '🔍 Listede ara'; fil.style.maxWidth = '220px';
        fil.oninput = () => {
          const q = fil.value.trim().toLocaleLowerCase('tr');
          [...mlist.children].forEach(rw => {
            rw.style.display = !q || rw.querySelector('.f-pname').value.toLocaleLowerCase('tr').includes(q) ? '' : 'none';
          });
        };
        const sortB = mk('button', 's'); sortB.innerHTML = BI.sort; sortB.append('A → Z sırala');
        sortB.onclick = () => {
          [...mlist.children]
            .sort((a, b) => a.querySelector('.f-pname').value.localeCompare(b.querySelector('.f-pname').value, 'tr'))
            .forEach(rw => mlist.appendChild(rw));
        };
        const tools = mk('div', 'st-tools'); tools.append(fil, sortB, count);

        const noneWrap = mk('label', 'st-none');
        noneR.onchange = refresh;
        noneWrap.append(noneR, document.createTextNode('Varsayılan kullanıcı yok (her seferinde sor)'));

        p2.append(addBar, bulk, tools, noneWrap, empty, mlist);
        settings.memurlar.forEach(m => addPerson(m, m === settings.sabit));
        if (!settings.memurlar.includes(settings.sabit)) noneR.checked = true;
        refresh();

        const p3 = addTab('clip', 'Havale');
        p3.append(mk('h4', '', 'Havale tablosu'), mk('p', 'st-sub', 'Havale formunda otomatik gelen değerler.'));
        const he = fld(p3, 'Varsayılan "Havale eden"', mk('input'));
        he.type = 'text'; he.value = settings.havaleEden || '';

        const p4 = addTab('sliders', 'Genel');
        p4.append(mk('h4', '', 'Genel'), mk('p', 'st-sub', 'Görünüm ve sıfırlama seçenekleri.'));
        const upCard = mk('div', 'st-card');
        const upW = mk('label', 'st-chk');
        const up = mk('input'); up.type = 'checkbox'; up.checked = !!settings.upper;
        upW.append(up, document.createTextNode('Kaşedeki ismi BÜYÜK harfle yaz'));
        upCard.appendChild(upW);
        const dz = mk('div', 'st-card st-danger');
        dz.append(mk('div', 'st-dt', 'Tehlikeli bölge'),
          mk('p', 'st-ds', 'Hazır yazılar, personel listesi, varsayılan kullanıcı, konum ve boyutlar silinir.'));
        p4.append(upCard, dz);
        const rst = mk('button', 'd'); rst.innerHTML = BI.reset; rst.append('Tüm ayarları varsayılana döndür');
        rst.onclick = () => {
          if (!confirm('Tüm ayarlar (hazır yazılar, personel listesi, varsayılan kullanıcı, konum ve boyutlar) varsayılana dönecek. Emin misiniz?')) return;
          settings = sanitizeSettings({ presets: DEF_PRESETS, memurlar: [], havaleEden: 'OTOMATİK HAVALE' });
          pos = {};
          saveSettings(); store.set(POS_KEY, pos); setLast('');
          buildPanel(); close(); toast('Tüm ayarlar varsayılana döndü');
        };
        dz.appendChild(rst);

        const save = () => {
          const presets = [...plist.children].map(it => ({
            label: it.querySelector('.f-label').value.trim(),
            l1: it.querySelector('.f-text').value,
            isim: it.querySelector('.f-isim').checked,
          })).filter(p => p.label);

          const seen = new Set(), memurlar = [];
          let sabit = '';
          [...mlist.children].forEach(rw => {
            const v = rw.querySelector('.f-pname').value.trim().replace(/\s+/g, ' ');
            if (!v) return;
            const k = v.toLocaleLowerCase('tr');
            if (seen.has(k)) return;
            seen.add(k); memurlar.push(v);
            if (rw.querySelector('input[type=radio]').checked) sabit = v;
          });

          settings = sanitizeSettings({ presets, memurlar, havaleEden: he.value.trim(), sabit, upper: up.checked });
          saveSettings(); buildPanel(); close(); toast('Ayarlar kaydedildi');
        };
        btnRow(box, 'Kaydet', save, close);
        tabs[0].b.onclick();
      });
    }

    const root = mk('div'); root.id = 'tk-root';
    const panel = mk('div'); panel.id = 'tk-panel';
    const fab = mk('button'); fab.id = 'tk-fab'; fab.title = 'Evrak Kaşe Asistanı (Alt+D)';
    fab.innerHTML =
      '<svg class="ic-main" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/></svg>' +
      '<svg class="ic-x" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '<span id="tk-badge"></span>';
    root.append(fab, panel);
    document.body.appendChild(root);

    const toggle = force => root.classList.toggle('open', force === undefined ? !root.classList.contains('open') : !!force);
    fab.onclick = () => toggle();

    function updateBadge() {
      const n = stamps.length;
      const b = document.getElementById('tk-badge');
      if (!b) return;
      b.textContent = n;
      b.style.display = n ? 'flex' : 'none';
    }

    function undoLast() {
      flushText();
      if (hist.length < 2) return toast('Geri alınacak bir şey yok');
      hist.pop();
      restore(hist[hist.length - 1]);
    }
    function clearAll() {
      if (!stamps.length) return toast('Sayfada eklenmiş bir şey yok');
      if (!confirm('Eklenen tüm yazı ve tablolar silinsin mi?')) return;
      hideTb();
      stamps.forEach(o => o.el.remove());
      stamps = [];
      updateBadge();
      commit();
    }

    function buildPanel() {
      panel.innerHTML = '';
      panel.appendChild(mk('div', 'tk-title', 'Evrak Kaşe Asistanı'));
      panel.appendChild(mk('div', 'tk-sec', 'Kontrol yazıları'));

      const cur = defaultUser();
      const ub = mk('button', 'tk-btn usr');
      const label = !settings.memurlar.length ? 'Kullanıcı listesi boş'
        : settings.sabit ? 'Kullanıcı: ' + settings.sabit
        : cur ? 'Son seçilen: ' + cur + ' (her seferinde sorulur)'
        : 'Kullanıcı seçilmedi';
      ub.append(mk('span', '', '👤'), mk('span', 'u', label), mk('span', '', '✎'));
      ub.title = 'Kullanıcıyı değiştir / sabit varsayılanı kaldır';
      ub.onclick = () => settings.memurlar.length ? pickUser('Kullanıcıyı değiştir', () => {}) : settingsForm();
      panel.appendChild(ub);

      if (!settings.presets.length) panel.appendChild(mk('div', 'tk-hint', 'Ayarlardan yazı ekleyin.'));
      settings.presets.forEach(p => {
        const b = mk('button', 'tk-btn', '✍  ' + p.label);
        b.onclick = () => onPreset(p);
        panel.appendChild(b);
      });

      panel.appendChild(mk('div', 'tk-sec', 'Havale'));
      const hv = mk('button', 'tk-btn hv', '📋  Havale tablosu');
      hv.onclick = havaleForm; panel.appendChild(hv);

      panel.appendChild(mk('div', 'tk-sec', 'Seçenekler'));
      const sw = mk('label', 'tk-sw');
      const cb = mk('input'); cb.type = 'checkbox'; cb.checked = allPages;
      cb.onchange = () => { allPages = cb.checked; };
      sw.append(mk('span', '', 'Tüm sayfalara ekle'), cb, mk('i'));
      panel.appendChild(sw);

      const r1 = mk('div', 'tk-row');
      const un = mk('button', 'tk-btn', '↶ Geri al'); un.onclick = undoLast;
      const cl = mk('button', 'tk-btn', '🗑 Temizle'); cl.onclick = clearAll;
      r1.append(un, cl); panel.appendChild(r1);

      const r2 = mk('div', 'tk-row');
      const ay = mk('button', 'tk-btn', '⚙ Ayarlar'); ay.onclick = settingsForm;
      r2.appendChild(ay); panel.appendChild(r2);

      const pr = mk('button', 'tk-btn pri', '🖨  Yazdır');
      pr.style.marginTop = '4px';
      pr.onclick = () => doPrint(pr); panel.appendChild(pr);

      panel.appendChild(mk('div', 'tk-hint', 'En son kullanılan konum ve boyut hatırlanır.'));
    }
    buildPanel();

    async function doPrint(btn) {
      if (printing) return toast('Yazdırma hazırlanıyor, lütfen bekleyin');
      printing = true;
      const label = btn && btn.textContent;
      const urls = [];
      let fr = null;
      const cleanup = () => {
        if (fr) { fr.remove(); fr = null; }
        urls.forEach(u => URL.revokeObjectURL(u));
        urls.length = 0;
      };
      try {
        const live = stamps.map(o => {
          const c = o.el.cloneNode(true);
          c.classList.remove('tk-front');
          c.querySelectorAll('.rz').forEach(x => x.remove());
          return { page: o.page, node: c };
        });

        // Her iki getViewport imzası da korumalı
        const getVp = (page, scale) => {
          try { const r = page.getViewport({ scale }); if (r && r.width) return r; } catch (e) {}
          try { const r2 = page.getViewport(scale); if (r2 && r2.width) return r2; } catch (e) {}
          throw new Error('Sayfa boyutu okunamadı');
        };

        const imgs = [];
        const total = A.pdfDocument.numPages;
        for (let i = 1; i <= total; i++) {
          if (btn) btn.textContent = 'Hazırlanıyor… ' + i + '/' + total;
          const page = await A.pdfDocument.getPage(i);
          const v1 = getVp(page, 1);
          const v = getVp(page, 2.2);
          const cv = document.createElement('canvas');
          cv.width = v.width; cv.height = v.height;
          const task = page.render({ canvasContext: cv.getContext('2d'), viewport: v });
          await (task.promise || task);
          const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
          cv.width = cv.height = 0;
          if (!blob) throw new Error('Sayfa ' + i + ' görüntüye çevrilemedi');
          const url = URL.createObjectURL(blob);
          urls.push(url);
          imgs.push({ src: url, w: v1.width, h: v1.height });
        }

        fr = document.createElement('iframe');
        fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
        document.body.appendChild(fr);
        const d = fr.contentDocument;
        d.open();
        d.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          @page{size:${imgs[0].w}pt ${imgs[0].h}pt;margin:0}
          html,body{margin:0;padding:0}
          .pg{position:relative;overflow:hidden;page-break-after:always;break-after:page}
          .pg:last-child{page-break-after:auto;break-after:auto}
          .pg>img{width:100%;height:100%;display:block}
          ${STAMP_CSS}
        </style></head><body></body></html>`);
        d.close();

        imgs.forEach((im, idx) => {
          const pg = d.createElement('div');
          pg.className = 'pg';
          pg.style.width = im.w + 'pt';
          pg.style.height = im.h + 'pt';
          const img = d.createElement('img');
          img.src = im.src;
          pg.appendChild(img);
          live.filter(s => s.page === idx + 1).forEach(s => {
            const n = d.importNode(s.node, true);
            n.querySelectorAll('[contenteditable]').forEach(x => x.removeAttribute('contenteditable'));
            n.style.outline = 'none';
            layout(n, +n.dataset.size, im.w, 'pt');
            pg.appendChild(n);
          });
          d.body.appendChild(pg);
        });

        await Promise.all([...d.images].map(i => i.decode().catch(() => {})));
        fr.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 500));
        fr.contentWindow.focus();
        fr.contentWindow.print();
        setTimeout(cleanup, 180000);
      } catch (err) {
        cleanup();
        alert('Yazdırma hazırlanamadı: ' + err.message);
      } finally {
        printing = false;
        if (btn) btn.textContent = label;
      }
    }

    if (TOP !== document && TOP.defaultView) {
      TOP.defaultView.addEventListener('keydown', e => {
        if (e.key === 'Escape') { const ov = TOP.querySelector('.tk-ov'); if (ov) ov.remove(); }
      }, true);
    }
    const hasStamps = () => stamps.length > 0;
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('#print,#secondaryPrint') && hasStamps()) {
        e.preventDefault(); e.stopImmediatePropagation(); doPrint();
      }
    }, true);
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P') && hasStamps()) {
        e.preventDefault(); e.stopImmediatePropagation(); doPrint(); return;
      }
      if (e.altKey && e.code === 'KeyD') {
        const t = e.target;
        const editing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        if (editing || TOP.querySelector('.tk-ov')) return;
        e.preventDefault(); toggle(); return;
      }
      if (e.key === 'Escape') {
        const ov = TOP.querySelector('.tk-ov');
        if (ov) ov.remove();
        else if (root.classList.contains('open')) toggle(false);
      }
    }, true);
  }
})();

}

/* ============================================================
   BÖLÜM 2 - EBYS PLUS (giriş + gelen kutusu sayfaları)
   ============================================================ */
if (!__EP_PDF_SAYFASI__) {
(function () {
    'use strict';

    const KEYS = {
        vault: 'ep_vault_v2',
        pw: 'ep_pw_v2',
        enabled: 'ep_enabled',
        oldVault: 'ep_vault_v1',
        oldSession: 'ep_session_v1',
        templates: 'ep_templates_v1',
    };
    const LEGACY_PLAIN_KEYS = ['kullanici_adi', 'sifre', 'e_imza', 'kep_parola', 'kep_sifre'];
    const UNLOCK_MS = 5 * 60 * 1000;
    const PBKDF2_ITER = 150000;

    const EP = { creds: null, templates: [], unlockedUntil: 0, clicked: {}, halted: false };
    const isLoginPage = location.pathname.includes('sistemeGiris.xhtml');

    /* ============================== Yardımcılar ============================== */

    const store = {
        get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
        remove: (k) => { try { localStorage.removeItem(k); } catch (_) { /* yok say */ } },
    };

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }

    function toast(message, type = 'success') {
        let box = document.getElementById('ep-toasts');
        if (!box) { box = el('div'); box.id = 'ep-toasts'; document.body.appendChild(box); }
        const t = el('div', `ep-toast ep-toast-${type}`);
        t.setAttribute('role', 'status');
        t.textContent = message;
        box.appendChild(t);
        setTimeout(() => { t.classList.add('ep-out'); setTimeout(() => t.remove(), 300); }, 3200);
    }

    /* ======================= Kaşe ayarları (ORTAK DEPO) =======================
       Kaşe Asistanı (PDF sayfası) ile aynı localStorage anahtarını kullanır.
       Veri biçimi ve doğrulama kaşe bölümüyle birebir aynıdır. */

    const KASE_KEY = 'tkgmDamgaSettingsV2';
    const KASE_OLD_KEY = 'tkgmDamgaPresets';
    const KASE_DEF_PRESETS = [
        { label: 'Tescil/terkin', l1: 'TAKBİS tescil/terkin kontrolü\ntarafımdan yapılmıştır.', isim: true },
        { label: 'Kütük terkin', l1: 'TAKBİS ve kütük terkin kontrolü\ntarafımdan yapılmıştır.', isim: true },
    ];
    function kaseSanitize(o) {
        const arr = (x) => (Array.isArray(x) ? x : []);
        const memurlar = arr(o && o.memurlar).map((x) => String(x).trim()).filter(Boolean);
        let sabit = String((o && o.sabit) || '').trim();
        if (!memurlar.includes(sabit)) sabit = '';
        return {
            presets: arr(o && o.presets)
                .filter((p) => p && typeof p.label === 'string' && p.label.trim())
                .map((p) => ({ label: p.label.trim(), l1: String(p.l1 || ''), isim: p.isim === undefined ? true : !!p.isim })),
            memurlar,
            havaleEden: typeof (o && o.havaleEden) === 'string' ? o.havaleEden : 'OTOMATİK HAVALE',
            sabit,
            upper: !!(o && o.upper),
        };
    }
    function kaseLoad() {
        let s = null;
        try { s = JSON.parse(store.get(KASE_KEY, 'null')); } catch (_) { s = null; }
        if (s && Array.isArray(s.presets)) return kaseSanitize(s);
        let presets = KASE_DEF_PRESETS;
        try { const o = JSON.parse(store.get(KASE_OLD_KEY, 'null')); if (Array.isArray(o) && o.length) presets = o; } catch (_) { /* yok say */ }
        return kaseSanitize({ presets, memurlar: [], havaleEden: 'OTOMATİK HAVALE' });
    }
    function kaseSave(s) {
        if (!store.set(KASE_KEY, JSON.stringify(kaseSanitize(s)))) {
            toast('Kaşe ayarları kaydedilemedi (depolama alanı dolu olabilir).', 'error');
            return false;
        }
        return true;
    }
    const lcTr = (s) => String(s).toLocaleLowerCase('tr');
    const cleanName = (s) => String(s).trim().replace(/\s+/g, ' ');
    function parseNames(text) {
        const seen = new Set(), out = [];
        String(text || '').split('\n').forEach((line) => {
            const v = cleanName(line);
            if (v && !seen.has(lcTr(v))) { seen.add(lcTr(v)); out.push(v); }
        });
        return out;
    }

    /* ================================ Stiller ================================ */

    function injectStyles() {
        if (document.getElementById('ep-styles')) return;
        const style = el('style');
        style.id = 'ep-styles';
        style.textContent = `
        :root{
            --ep-ink:#1c2530; --ep-muted:#65707d; --ep-line:#dde2e8; --ep-bg:#ffffff; --ep-soft:#f4f6f8;
            --ep-accent:#0d5c8f; --ep-accent-hover:#0a4a75; --ep-danger:#b3261e; --ep-ok:#1f7a4d;
            --ep-font:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
        }
        .ep-overlay,.ep-panel,.ep-fab,#ep-toasts,#ep-template-menu,#ep-template-btn{ font-family:var(--ep-font); box-sizing:border-box; }
        .ep-overlay *,.ep-panel *,#ep-template-menu *{ box-sizing:border-box; }

        @keyframes ep-fade{ from{opacity:0} to{opacity:1} }
        @keyframes ep-rise{ from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:none} }
        @keyframes ep-shake{ 20%,60%{transform:translateX(-4px)} 40%,80%{transform:translateX(4px)} }
        @keyframes ep-pop{ 0%{transform:scale(.9); opacity:0} 100%{transform:scale(1); opacity:1} }

        .ep-btn{ font:600 13.5px var(--ep-font); border:1px solid transparent; border-radius:999px; padding:9px 18px; cursor:pointer;
            transition:background .15s, border-color .15s, opacity .15s, transform .1s, box-shadow .15s; }
        .ep-btn:active{ transform:scale(.97); }
        .ep-btn:focus-visible,.ep-item:focus-visible,.ep-fab:focus-visible,.ep-eye:focus-visible,.ep-icon-btn:focus-visible{ outline:2px solid var(--ep-accent); outline-offset:2px; }
        .ep-btn:disabled{ opacity:.5; cursor:not-allowed; }
        .ep-btn-primary{ background:linear-gradient(180deg,#2c86c4 0%,#0d5c8f 100%); color:#fff; border-color:rgba(10,74,117,.6);
            box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 3px 10px rgba(13,92,143,.28); }
        .ep-btn-primary:hover{ background:linear-gradient(180deg,#2f8fd0 0%,#0a4a75 100%); box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 6px 16px rgba(13,92,143,.38); }
        .ep-btn-danger{ background:var(--ep-danger); color:#fff; }
        .ep-btn-secondary{ background:#fff; color:var(--ep-ink); border-color:var(--ep-line); box-shadow:0 1px 2px rgba(15,23,42,.06); }
        .ep-btn-secondary:hover{ background:var(--ep-soft); }

        /* Bildirimler */
        #ep-toasts{ position:fixed; top:14px; right:14px; z-index:100005; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
        .ep-toast{ background:var(--ep-ink); color:#fff; padding:10px 16px; border-radius:8px; font-size:13.5px; max-width:340px;
            border-left:4px solid var(--ep-ok); box-shadow:0 8px 24px rgba(0,0,0,.22); animation:ep-rise .25s ease; transition:opacity .3s, transform .3s; }
        .ep-toast-error{ border-left-color:#ef6b63; }
        .ep-toast-info{ border-left-color:#5aa9e0; }
        .ep-toast.ep-out{ opacity:0; transform:translateY(-6px); }

        /* Diyalog (bulanık arka plan) */
        .ep-overlay{ position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,.45);
            backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); display:flex; align-items:center;
            justify-content:center; animation:ep-fade .15s ease; padding:20px; }
        .ep-overlay.ep-overlay-2{ z-index:100002; background:rgba(15,23,42,.35); backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); }
        .ep-modal{ background:var(--ep-bg); color:var(--ep-ink); width:420px; max-width:92vw; max-height:90vh; overflow:auto;
            padding:24px; border-radius:16px; box-shadow:0 24px 64px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06); animation:ep-rise .2s ease; }
        .ep-modal-wide{ width:660px; }
        .ep-modal h3{ margin:0 0 4px; font-size:17px; font-weight:650; }
        .ep-sub{ margin:0 0 16px; font-size:13px; line-height:1.5; color:var(--ep-muted); }
        .ep-steps{ display:flex; align-items:center; gap:12px; margin-bottom:16px; font-size:12px; color:var(--ep-muted); white-space:nowrap; }
        .ep-bar{ flex:1; height:4px; border-radius:4px; background:var(--ep-line); overflow:hidden; }
        .ep-bar i{ display:block; height:100%; background:var(--ep-accent); transition:width .3s ease; }
        .ep-body{ animation:ep-fade .18s ease; }
        .ep-field{ display:block; margin-bottom:12px; font-size:13px; font-weight:550; }
        .ep-field em{ font-style:normal; font-weight:400; color:var(--ep-muted); }
        .ep-input-wrap{ display:flex; align-items:center; margin-top:5px; position:relative; }
        .ep-input-wrap input{ width:100%; padding:9px 12px; border:1px solid var(--ep-line); border-radius:10px; font:14px var(--ep-font);
            color:var(--ep-ink); background:#fff; outline:none; transition:border-color .15s, box-shadow .15s; }
        .ep-input-wrap input:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-input-wrap input[data-secret]{ padding-right:64px; }
        .ep-input-wrap input[data-masked="1"]{ -webkit-text-security:disc; text-security:disc; }
        .ep-eye{ position:absolute; right:6px; border:0; background:none; color:var(--ep-accent); font:600 12px var(--ep-font); cursor:pointer; padding:5px 8px; border-radius:6px; }
        .ep-field textarea,.ep-k-ta{ display:block; width:100%; margin-top:5px; padding:9px 12px; border:1px solid var(--ep-line); border-radius:10px;
            font:14px/1.45 var(--ep-font); color:var(--ep-ink); background:#fff; outline:none; resize:vertical; min-height:96px;
            transition:border-color .15s, box-shadow .15s; }
        .ep-field textarea:focus,.ep-k-ta:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-toggle{ display:flex; align-items:center; gap:10px; margin-bottom:12px; font-size:13px; font-weight:550; cursor:pointer; user-select:none; }
        .ep-toggle input{ width:18px; height:18px; accent-color:var(--ep-accent); cursor:pointer; flex:none; margin:0; }
        .ep-select{ display:block; width:100%; margin-top:5px; padding:9px 12px; border:1px solid var(--ep-line); border-radius:10px; font:14px var(--ep-font); background:#fff; color:var(--ep-ink); outline:none; }
        .ep-select:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-err{ min-height:18px; margin-top:2px; font-size:12.5px; color:var(--ep-danger); }
        .ep-err.ep-shake{ animation:ep-shake .35s ease; }
        .ep-actions{ display:flex; gap:10px; margin-top:14px; }
        .ep-actions .ep-btn{ flex:1; }
        .ep-actions .ep-btn-skip{ flex:none; background:transparent; border-color:transparent; color:var(--ep-muted); box-shadow:none; }
        .ep-actions .ep-btn-skip:hover{ background:var(--ep-soft); color:var(--ep-ink); }

        /* Menü */
        .ep-fab{ position:fixed; left:248px; top:4px; z-index:99998; padding:7px 17px; color:#fff; border:1px solid rgba(255,255,255,.35);
            background:linear-gradient(135deg,#0d5c8f 0%,#1489c9 100%);
            border-radius:999px; font:600 12.5px var(--ep-font); letter-spacing:.02em; cursor:pointer;
            box-shadow:0 2px 8px rgba(13,92,143,.35); transition:box-shadow .15s, transform .1s, filter .15s; }
        .ep-fab:hover{ filter:brightness(1.08); box-shadow:0 4px 14px rgba(13,92,143,.45); }
        .ep-fab:active{ transform:scale(.96); }
        .ep-fab[aria-expanded="true"]{ background:linear-gradient(135deg,#0a4a75 0%,#0d5c8f 100%); }
        .ep-panel{ position:fixed; left:2px; top:3px; z-index:99999; width:250px; background:var(--ep-bg); color:var(--ep-ink);
            border:1px solid var(--ep-line); border-radius:12px; padding:14px; box-shadow:0 14px 36px rgba(0,0,0,.22); animation:ep-rise .18s ease; }
        .ep-panel[hidden]{ display:none; }
        .ep-panel-head{ display:flex; flex-direction:column; gap:2px; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--ep-line); }
        .ep-panel-head strong{ font-size:14.5px; }
        .ep-status{ font-size:12px; color:var(--ep-ok); }
        .ep-status.off{ color:var(--ep-danger); }
        .ep-switch{ display:flex; align-items:center; justify-content:space-between; font-size:13px; padding:6px 4px 10px; cursor:pointer; }
        .ep-switch input{ width:34px; height:18px; accent-color:var(--ep-accent); cursor:pointer; }
        .ep-item{ display:block; width:100%; text-align:left; background:none; border:0; border-radius:7px; padding:8px 8px; font:13px var(--ep-font);
            color:var(--ep-ink); cursor:pointer; transition:background .12s; }
        .ep-item:hover{ background:var(--ep-soft); }
        .ep-item-danger{ color:var(--ep-danger); }
        .ep-foot{ display:block; margin-top:8px; padding:8px 8px 0; border-top:1px solid var(--ep-line); font-size:12px; color:var(--ep-muted); text-decoration:none; }
        .ep-foot:hover{ color:var(--ep-accent); }

        /* Şablon menüsü (hızlı erişim) */
        #ep-template-btn{ display:inline-flex; align-items:center; gap:6px; margin-left:6px; padding:6px 15px;
            background:linear-gradient(135deg,#0d5c8f 0%,#1489c9 100%); color:#fff; border:1px solid rgba(255,255,255,.35);
            border-radius:999px; font:600 13.5px var(--ep-font); letter-spacing:.01em; cursor:pointer;
            box-shadow:0 2px 8px rgba(13,92,143,.35); transition:box-shadow .15s, transform .1s, filter .15s; }
        #ep-template-btn::before{ content:"🗂️"; font-size:13px; line-height:1; }
        #ep-template-btn:hover{ filter:brightness(1.08); box-shadow:0 4px 14px rgba(13,92,143,.45); }
        #ep-template-btn[aria-expanded="true"]{ background:linear-gradient(135deg,#0a4a75 0%,#0d5c8f 100%); }
        #ep-template-btn:active{ transform:scale(.96); }
        #ep-template-menu{ position:fixed; z-index:99999; width:290px; padding:8px 0; background:#fff; border:1px solid var(--ep-line);
            border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,.2); font-size:13.5px; animation:ep-rise .15s ease; max-height:70vh; overflow:auto; }
        #ep-template-menu input{ display:block; width:calc(100% - 20px); margin:2px 10px 6px; padding:7px 10px; border:1px solid var(--ep-line);
            border-radius:7px; font:13px var(--ep-font); outline:none; }
        #ep-template-menu input:focus{ border-color:var(--ep-accent); }
        .ep-tpl-item{ padding:8px 16px; cursor:pointer; color:var(--ep-ink); display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .ep-tpl-item:hover,.ep-tpl-item:focus{ background:var(--ep-soft); color:var(--ep-accent); outline:none; }
        .ep-tpl-empty{ padding:8px 16px; color:var(--ep-muted); font-size:12.5px; }
        .ep-tpl-tag{ font-size:10px; font-weight:700; color:var(--ep-muted); border:1px solid var(--ep-line); border-radius:5px; padding:1px 5px; flex:none; }

        /* Çoklu dosya ekleme */
        .ep-multi-btn{ margin-right:6px; margin-bottom:0; vertical-align:middle; position:relative; top:0px; display:inline-flex; align-items:center; gap:7px; padding:7px 15px;
        background:#f1f7fd !important; color:var(--ep-accent) !important;
        border:1px solid rgba(13,92,143,.18) !important; border-radius:10px; font:600 13px var(--ep-font);
        letter-spacing:.01em; transition:background .15s, border-color .15s, box-shadow .15s, transform .1s, color .15s; }
        .ep-multi-btn svg{ width:15px; height:15px; flex:none; stroke:currentColor; fill:none; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; transition:transform .18s ease; }
        .ep-multi-btn:hover{ background:var(--ep-accent) !important; border-color:var(--ep-accent) !important; color:#fff !important;
            box-shadow:0 3px 10px rgba(13,92,143,.25); }
        .ep-multi-btn:hover svg{ transform:translateY(-1px); }
        .ep-multi-btn:active{ transform:scale(.97); }
        .ep-multi-modal{ width:520px; }
        .ep-multi-list{ display:flex; flex-direction:column; gap:8px; max-height:340px; overflow:auto; margin:14px 0; padding-right:2px; }
        .ep-multi-row{ display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--ep-line); border-radius:9px; background:var(--ep-soft); }
        .ep-multi-row input[type="text"]{ flex:1; min-width:0; padding:7px 9px; border:1px solid var(--ep-line); border-radius:7px; font:13px var(--ep-font); outline:none; }
        .ep-multi-row input[type="text"]:focus{ border-color:var(--ep-accent); }
        .ep-multi-row input[type="text"]:disabled{ opacity:.6; }
        .ep-multi-row .ep-multi-size{ font-size:11px; color:var(--ep-muted); flex:none; white-space:nowrap; }
        .ep-multi-row .ep-multi-status{ font-size:11px; font-weight:700; flex:none; width:74px; text-align:right; }
        .ep-multi-status.wait{ color:var(--ep-muted); }
        .ep-multi-status.busy{ color:var(--ep-accent); }
        .ep-multi-status.ok{ color:var(--ep-ok); }
        .ep-multi-status.err{ color:var(--ep-danger); }
        .ep-multi-row.ep-multi-active{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.12); }
        .ep-progress{ height:8px; border-radius:4px; background:var(--ep-line); overflow:hidden; margin-top:4px; }
        .ep-progress i{ display:block; height:100%; width:0%; background:var(--ep-accent); transition:width .25s ease; }
        .ep-progress-label{ font-size:11.5px; color:var(--ep-muted); margin-top:6px; text-align:right; }

        /* Şablon Yönetim Paneli */
        .ep-mgr-toolbar{ display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; }
        .ep-mgr-toolbar .ep-btn{ flex:none; padding:8px 14px; font-size:12.5px; }
        .ep-mgr-search{ flex:1; min-width:140px; padding:8px 12px; border:1px solid var(--ep-line); border-radius:8px; font:13px var(--ep-font); outline:none; transition:border-color .15s, box-shadow .15s; }
        .ep-mgr-search:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-mgr-list{ display:flex; flex-direction:column; gap:8px; max-height:380px; overflow:auto; padding-right:2px; }
        .ep-mgr-row{ display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid var(--ep-line); border-radius:10px;
            background:var(--ep-soft); transition:background .15s, opacity .2s, transform .2s; }
        @keyframes ep-hl{ from{ background:#d6e7f5; border-color:var(--ep-accent); } to{ background:var(--ep-soft); border-color:var(--ep-line); } }
        .ep-mgr-row.ep-row-hl{ animation:ep-hl 1.1s ease-out; }
        .ep-mgr-row:hover{ background:#eef2f6; }
        .ep-mgr-row.ep-row-out{ opacity:0; transform:translateX(14px); }
        .ep-mgr-row-main{ flex:1; min-width:0; }
        .ep-mgr-row-title{ font-weight:600; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ep-mgr-row-sub{ font-size:11.5px; color:var(--ep-muted); margin-top:2px; }
        .ep-badge{ display:inline-block; font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:999px; background:#e4ecf3; color:var(--ep-accent); margin-left:6px; vertical-align:middle; }
        .ep-mgr-row-actions{ display:flex; gap:4px; flex:none; }
        .ep-icon-btn{ border:1px solid var(--ep-line); background:#fff; border-radius:7px; padding:6px 9px; font-size:13px; cursor:pointer;
            transition:background .15s, border-color .15s, transform .1s; line-height:1; }
        .ep-icon-btn:hover{ background:var(--ep-soft); border-color:var(--ep-accent); }
        .ep-icon-btn:active{ transform:scale(.92); }
        .ep-icon-btn:disabled{ opacity:.35; cursor:not-allowed; }
        .ep-icon-btn-danger:hover{ background:#fbeceb; border-color:var(--ep-danger); color:var(--ep-danger); }
        .ep-icon-btn svg{ width:15px; height:15px; display:block; fill:none; stroke:currentColor; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
        .ep-icon-btn{ display:inline-flex; align-items:center; justify-content:center; color:#4a5663; }
        .ep-icon-btn:hover{ color:var(--ep-accent); }
        .ep-icon-btn-danger:hover{ color:var(--ep-danger); }
        .ep-mgr-empty{ padding:34px 10px; text-align:center; color:var(--ep-muted); font-size:13px; }
        .ep-mgr-confirm{ display:flex; gap:6px; align-items:center; font-size:12px; color:var(--ep-danger); white-space:nowrap; }
        .ep-mgr-confirm button{ border:0; cursor:pointer; font:600 12px var(--ep-font); padding:5px 10px; border-radius:6px; }
        .ep-mgr-confirm .yes{ color:#fff; background:var(--ep-danger); }
        .ep-mgr-confirm .no{ color:var(--ep-ink); background:#fff; border:1px solid var(--ep-line); }

        /* Şablon Düzenleyici */
        .ep-ed-label{ font-size:11.5px; font-weight:700; color:var(--ep-muted); margin:16px 0 6px; text-transform:uppercase; letter-spacing:.04em; }
        .ep-ed-field-row{ display:flex; gap:6px; align-items:center; margin-bottom:6px; animation:ep-pop .15s ease; }
        .ep-ed-field-row input{ flex:1; padding:7px 9px; border:1px solid var(--ep-line); border-radius:7px; font:13px var(--ep-font); outline:none; transition:border-color .15s; }
        .ep-ed-field-row input:focus{ border-color:var(--ep-accent); }
        .ep-ed-chips{ margin-top:6px; }
        .ep-ed-chip{ display:inline-flex; align-items:center; gap:4px; font-size:11.5px; padding:4px 10px; border-radius:999px; background:var(--ep-soft);
            border:1px solid var(--ep-line); cursor:pointer; color:var(--ep-accent); font-weight:600; transition:background .15s, transform .1s; margin:2px 5px 2px 0; }
        .ep-ed-chip:hover{ background:#e4ecf3; }
        .ep-ed-chip:active{ transform:scale(.95); }
        .ep-ed-content{ width:100%; min-height:170px; resize:vertical; padding:10px; border:1px solid var(--ep-line); border-radius:8px;
            font:12.5px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; outline:none; transition:border-color .15s, box-shadow .15s; }
        .ep-ed-content:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-modal-xl{ width:940px; }
        .ep-ed-grid{ display:grid; grid-template-columns:290px 1fr; gap:20px; margin-top:8px; }
        @media (max-width:800px){ .ep-ed-grid{ grid-template-columns:1fr; } }
        .ep-ed-side .ep-ed-label:first-of-type{ margin-top:0; }
        .ep-ed-side .ep-ed-field-row{ display:grid; grid-template-columns:1fr 1fr auto; }
        .ep-ed-side .ep-ed-field-row input{ min-width:0; }
        .ep-ed-hint{ margin-top:8px; font-size:11.5px; line-height:1.5; color:var(--ep-muted); }
        .ep-ed-hint code{ background:var(--ep-soft); padding:1px 5px; border-radius:4px; }
        .ep-ed-main{ min-width:0; }
        .ep-ed-tabs{ display:flex; gap:2px; border-bottom:1px solid var(--ep-line); }
        .ep-ed-tab{ border:0; background:none; padding:8px 14px; font:600 12.5px var(--ep-font); color:var(--ep-muted); cursor:pointer;
            border-bottom:2px solid transparent; margin-bottom:-1px; }
        .ep-ed-tab:hover{ color:var(--ep-ink); }
        .ep-ed-tab.on{ color:var(--ep-accent); border-bottom-color:var(--ep-accent); }
        .ep-ed-toolbar{ display:flex; flex-wrap:wrap; align-items:center; gap:2px; padding:6px; background:var(--ep-soft);
            border:1px solid var(--ep-line); border-top:0; transition:opacity .15s; }
        .ep-ed-toolbar.ep-disabled{ opacity:.4; pointer-events:none; }
        .ep-tb{ min-width:30px; height:28px; padding:0 8px; border:1px solid transparent; background:none; border-radius:6px;
            font:600 12.5px var(--ep-font); color:var(--ep-ink); cursor:pointer; transition:background .12s, border-color .12s; }
        .ep-tb:hover{ background:#fff; border-color:var(--ep-line); }
        .ep-tb.on{ background:#dbe9f4; color:var(--ep-accent); border-color:#b9d2e6; }
        .ep-tb-sep{ width:1px; height:18px; background:var(--ep-line); margin:0 4px; }
        .ep-wys{ min-height:290px; max-height:46vh; overflow:auto; padding:18px 22px; border:1px solid var(--ep-line); border-top:0;
            border-radius:0 0 8px 8px; background:#fff; font:14px/1.6 'Times New Roman',Georgia,serif; text-align:justify; outline:none; }
        .ep-wys:focus{ border-color:var(--ep-accent); }
        .ep-wys p{ margin:0 0 8px; }
        .ep-tabmark{ display:inline-block; width:46px; height:.9em; vertical-align:middle; border-radius:2px; opacity:.75;
            background:repeating-linear-gradient(90deg,#c3d3e2 0 4px,transparent 4px 8px); }
        .ep-ed-main .ep-ed-content{ min-height:290px; max-height:46vh; border-top:0; border-radius:0 0 8px 8px; }
        .ep-ed-main .ep-ed-preview{ min-height:290px; max-height:46vh; margin-top:0; padding:18px 22px; border:1px solid var(--ep-line);
            border-top:0; border-radius:0 0 8px 8px; font:14px/1.6 'Times New Roman',Georgia,serif; text-align:justify; }
        .ep-wys[hidden],.ep-ed-content[hidden],.ep-ed-preview[hidden],.ep-ed-chips[hidden]{ display:none !important; }
        .ep-mgr-row-snip{ margin-top:3px; font-size:11.5px; color:#8a95a2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        /* Şablon menüsü: kategoriler, yıldız, vurgulama */
        .ep-tm-head{ padding:8px 14px 4px; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--ep-muted); }
        .ep-tm-fav{ color:#b7791f; }
        .ep-tm-cat{ display:flex; align-items:center; gap:8px; width:100%; border:0; background:none; padding:9px 14px; font:600 13px var(--ep-font); color:var(--ep-ink); cursor:pointer; text-align:left; }
        .ep-tm-cat:hover{ background:var(--ep-soft); }
        .ep-tm-caret{ display:inline-block; font-size:11px; color:var(--ep-muted); transition:transform .15s; }
        .ep-tm-cat.open .ep-tm-caret{ transform:rotate(90deg); }
        .ep-tm-catname{ flex:1; }
        .ep-tm-count{ font-size:11px; color:var(--ep-muted); background:var(--ep-soft); border-radius:999px; padding:1px 8px; }
        .ep-tm-sub{ margin:0 0 4px 20px; border-left:2px solid var(--ep-line); }
        .ep-tpl-name{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ep-star{ border:0; background:none; cursor:pointer; font-size:15px; line-height:1; color:#c5ccd4; padding:0 2px; flex:none; }
        .ep-star:hover,.ep-star.on{ color:#e0a100; }
        .ep-tpl-item mark{ background:#fff0b3; color:inherit; border-radius:2px; padding:0 1px; }

        /* Yönetim paneli */
        .ep-mgr-cat{ min-width:150px; padding:8px 10px; border:1px solid var(--ep-line); border-radius:8px; font:13px var(--ep-font); background:#fff; outline:none; }
        .ep-mgr-cat:focus{ border-color:var(--ep-accent); }
        .ep-fav-mark{ color:#e0a100; }
        .ep-icon-fav.on{ color:#e0a100; }
        .ep-icon-fav.on svg{ fill:currentColor; }

        /* Düzenleyici */
        .ep-fav-toggle{ width:100%; margin:2px 0 4px; padding:8px 12px; border:1px dashed var(--ep-line); border-radius:8px; background:#fff;
            font:600 12.5px var(--ep-font); color:var(--ep-muted); cursor:pointer; text-align:left; transition:background .15s, color .15s, border-color .15s; }
        .ep-fav-toggle:hover{ background:var(--ep-soft); }
        .ep-fav-toggle.on{ color:#9a6b00; background:#fff8e1; border:1px solid #f0d58a; }
        .ep-ed-colhead{ display:grid; grid-template-columns:1fr 1fr 30px; gap:6px; font-size:11px; color:var(--ep-muted); margin-bottom:4px; padding-left:2px; }
        .ep-ed-nofield{ padding:12px; border:1px dashed var(--ep-line); border-radius:8px; font-size:12px; color:var(--ep-muted); text-align:center; margin-bottom:6px; }
        .ep-ed-main .ep-ed-chips{ margin:0 0 10px; padding:8px 10px; background:#f1f7fd; border:1px solid rgba(13,92,143,.15); border-radius:8px; }
        .ep-ed-chips:empty{ display:none; }
        .ep-ed-chips-title{ font-size:11.5px; font-weight:700; color:var(--ep-muted); margin-right:6px; }

        /* Şablon menüsü: sağ tık tarzı kademeli menü */
        #ep-template-sub{ position:fixed; z-index:100001; min-width:210px; max-width:300px; padding:6px 0; background:#fff; border:1px solid var(--ep-line);
            border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,.2); font:13.5px var(--ep-font); animation:ep-rise .12s ease; max-height:70vh; overflow:auto; box-sizing:border-box; }
        #ep-template-sub *{ box-sizing:border-box; }
        .ep-cm-item{ display:flex; align-items:center; gap:8px; padding:8px 14px; cursor:default; color:var(--ep-ink); font-weight:550; user-select:none; }
        .ep-cm-item:hover,.ep-cm-item.active{ background:#e5f1fb; color:var(--ep-accent); }
        .ep-cm-name{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ep-cm-count{ font-size:11px; color:var(--ep-muted); background:var(--ep-soft); border-radius:999px; padding:1px 8px; }
        .ep-cm-arrow{ font-size:15px; color:var(--ep-muted); line-height:1; }
        .ep-cm-sep{ height:1px; background:var(--ep-line); margin:5px 0; }
        .ep-cm-fav .ep-cm-name{ color:#9a6b00; }

        /* Editör: rozetler, durum satırı, tam ekran */
        .ep-fieldmark{ display:inline-block; padding:0 9px; margin:0 1px; border-radius:999px; background:#dbe9f4; color:var(--ep-accent);
            border:1px solid #b9d2e6; font:600 12px/1.65 var(--ep-font); user-select:all; white-space:nowrap; cursor:default; }
        .ep-fieldmark.ep-fm-special{ background:#fff8e1; color:#9a6b00; border-color:#f0d58a; }
        .ep-fieldmark.ep-fm-bad{ background:#fbeceb; color:var(--ep-danger); border-color:#efb7b3; }
        .ep-ed-status{ display:flex; flex-wrap:wrap; gap:14px; margin-top:8px; font-size:11.5px; color:var(--ep-muted); }
        .ep-ed-status .warn{ color:#9a6b00; }
        .ep-ed-status .bad{ color:var(--ep-danger); font-weight:600; }
        .ep-ed-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
        .ep-overlay.ep-overlay-full{ padding:0; }
        .ep-modal-xl.ep-modal-full{ width:100vw; max-width:100vw; height:100vh; max-height:100vh; border-radius:0; padding:18px 24px;
            display:flex; flex-direction:column; overflow:hidden; }
        .ep-modal-full .ep-ed-grid{ flex:1; min-height:0; grid-template-columns:320px 1fr; margin-top:4px; }
        .ep-modal-full .ep-ed-side{ overflow:auto; padding-right:6px; }
        .ep-modal-full .ep-ed-main{ display:flex; flex-direction:column; min-height:0; }
        .ep-modal-full .ep-wys,.ep-modal-full .ep-ed-content,.ep-modal-full .ep-ed-main .ep-ed-preview{ flex:1; min-height:0; max-height:none; height:auto; }
        .ep-modal-full .ep-ed-content{ resize:none; }
        .ep-modal-full .ep-sub{ margin-bottom:8px; }

        @media (prefers-reduced-motion:reduce){ .ep-overlay,.ep-modal,.ep-body,.ep-toast,.ep-panel,#ep-template-menu,.ep-mgr-row,.ep-ed-field-row{ animation:none !important; } }
        .ep-cm-manage{ color:var(--ep-muted); }
        .ep-cm-manage:hover{ color:var(--ep-accent); }

        /* ===== Şablon Yönetimi & Düzenleyici yenilemesi ===== */
        .ep-modal-mgr{ width:1400px; max-width:96vw; height:850px; max-height:92vh; padding:0; display:flex; flex-direction:column; overflow:hidden; }
        .ep-mg-head{ display:flex; align-items:center; gap:14px; padding:20px 24px 14px; }
        .ep-mg-ico{ width:46px; height:46px; border-radius:12px; display:grid; place-items:center; font-size:22px; flex:none;
            background:linear-gradient(135deg,#0d5c8f,#1489c9); box-shadow:0 4px 12px rgba(13,92,143,.3); }
        .ep-mg-titles{ flex:1; min-width:0; }
        .ep-mg-titles h3{ margin:0; font-size:18px; }
        .ep-mg-titles .ep-sub{ margin:2px 0 0; }
        .ep-mg-stats{ display:flex; gap:10px; padding:0 24px 14px; flex-wrap:wrap; }
        .ep-mg-stat{ flex:1; min-width:110px; padding:10px 14px; border:1px solid var(--ep-line); border-radius:10px; background:linear-gradient(#fff,var(--ep-soft)); }
        .ep-mg-stat b{ display:block; font-size:20px; line-height:1.15; color:var(--ep-accent); }
        .ep-mg-stat span{ font-size:11.5px; color:var(--ep-muted); }
        .ep-mg-tools{ display:flex; gap:8px; padding:0 24px 10px; flex-wrap:wrap; align-items:center; }
        .ep-mg-tools .ep-btn{ flex:none; padding:8px 13px; font-size:12.5px; }
        .ep-mg-searchbox{ position:relative; flex:1; min-width:200px; }
        .ep-mg-searchbox svg{ position:absolute; left:11px; top:50%; transform:translateY(-50%); width:15px; height:15px; stroke:var(--ep-muted); fill:none; stroke-width:2; stroke-linecap:round; pointer-events:none; }
        .ep-mg-searchbox input{ width:100%; padding:9px 12px 9px 34px; border:1px solid var(--ep-line); border-radius:9px; font:13px var(--ep-font); outline:none; transition:border-color .15s, box-shadow .15s; }
        .ep-mg-searchbox input:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-mg-chips{ display:flex; gap:6px; padding:0 24px 12px; overflow-x:auto; scrollbar-width:thin; }
        .ep-mg-chip{ flex:none; display:inline-flex; align-items:center; gap:6px; padding:5px 11px; border:1px solid var(--ep-line); border-radius:999px; background:#fff;
            font:600 12px var(--ep-font); color:var(--ep-ink); cursor:pointer; transition:background .15s, border-color .15s, color .15s; }
        .ep-mg-chip i{ font-style:normal; font-size:10.5px; padding:0 6px; border-radius:999px; background:var(--ep-soft); color:var(--ep-muted); }
        .ep-mg-chip:hover{ background:var(--ep-soft); }
        .ep-mg-chip.on{ background:var(--ep-accent); border-color:var(--ep-accent); color:#fff; }
        .ep-mg-chip.on i{ background:rgba(255,255,255,.22); color:#fff; }
        .ep-mg-body{ display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:16px; padding:0 24px 16px; height:min(50vh,440px); }
        .ep-mg-list{ display:flex; flex-direction:column; gap:8px; overflow:auto; padding:2px 4px 2px 2px; }
        .ep-mg-row{ display:flex; align-items:center; gap:10px; padding:11px 12px; border:1px solid var(--ep-line); border-radius:11px; background:#fff; cursor:pointer;
            transition:border-color .15s, box-shadow .15s, background .15s, opacity .2s, transform .2s; outline:none; }
        .ep-mg-row:hover{ border-color:#b9d2e6; box-shadow:0 2px 10px rgba(13,92,143,.08); }
        .ep-mg-row:focus-visible{ box-shadow:0 0 0 3px rgba(13,92,143,.25); }
        .ep-mg-row.ep-sel{ border-color:var(--ep-accent); background:#f3f9fe; box-shadow:0 0 0 3px rgba(13,92,143,.12); }
        .ep-mg-row.ep-row-hl{ animation:ep-hl 1.1s ease-out; }
        .ep-mg-row.ep-row-out{ opacity:0; transform:translateX(14px); }
        .ep-mg-row.ep-dragging{ opacity:.4; }
        .ep-mg-row.ep-drop-before{ box-shadow:0 -3px 0 var(--ep-accent); }
        .ep-mg-row.ep-drop-after{ box-shadow:0 3px 0 var(--ep-accent); }
        .ep-mg-grip{ cursor:grab; color:#a7b1bc; display:flex; flex:none; }
        .ep-mg-grip svg{ width:14px; height:18px; }
        .ep-mg-row:hover .ep-mg-grip{ color:var(--ep-accent); }
        .ep-mg-main{ flex:1; min-width:0; }
        .ep-mg-title{ display:flex; align-items:center; gap:6px; font-weight:650; font-size:13.5px; }
        .ep-mg-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ep-mg-meta{ display:flex; align-items:center; gap:8px; margin-top:3px; font-size:11.5px; color:var(--ep-muted); }
        .ep-mg-pill{ padding:1px 8px; border-radius:999px; background:#e4ecf3; color:var(--ep-accent); font-weight:600; }
        .ep-mg-actions{ display:flex; gap:4px; flex:none; opacity:.55; transition:opacity .15s; }
        .ep-mg-row:hover .ep-mg-actions,.ep-mg-row.ep-sel .ep-mg-actions,.ep-mg-row:focus-within .ep-mg-actions{ opacity:1; }
        .ep-mg-preview{ border:1px solid var(--ep-line); border-radius:12px; background:#e9edf2; overflow:auto; padding:12px; }
        .ep-mg-pv-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; font-size:13px; }
        .ep-mg-pv-head .ep-btn{ padding:6px 12px; font-size:12px; }
        .ep-paper{ background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.06); padding:24px 28px; border-radius:2px;
            font:13.5px/1.6 'Times New Roman',Georgia,serif; text-align:justify; color:#111; min-height:200px; }
        .ep-paper p{ margin:0 0 8px; }
        .ep-mg-pv-empty{ height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; text-align:center; color:var(--ep-muted); font-size:12.5px; }
        .ep-mg-pv-empty div{ font-size:30px; }
        .ep-mg-foot{ display:flex; align-items:center; gap:10px; padding:14px 24px; border-top:1px solid var(--ep-line); background:var(--ep-soft); }
        .ep-mg-foot .ep-btn{ flex:none; min-width:120px; }
        .ep-mg-count{ font-size:12px; color:var(--ep-muted); }
        .ep-mg-dirty{ font-size:12.5px; font-weight:600; color:#9a6b00; margin-right:auto; }
        .ep-mg-dirty[hidden]{ display:none; }
        .ep-mg-foot .ep-mg-count{ margin-right:auto; }
        @media (max-width:860px){ .ep-mg-body{ grid-template-columns:1fr; height:52vh; } .ep-mg-preview{ display:none; } }

        /* Düzenleyici */
        .ep-modal-xl{ width:1040px; max-width:96vw; height:min(90vh,800px); padding:0; display:flex; flex-direction:column; overflow:hidden; }
        .ep-modal-xl.ep-modal-full{ padding:0; height:100vh; }
        .ep-modal-xl .ep-ed-head{ padding:18px 24px 14px; align-items:flex-end; gap:16px; border-bottom:1px solid var(--ep-line); background:linear-gradient(#fff,var(--ep-soft)); }
        .ep-ed-titlebox{ flex:1; min-width:0; }
        .ep-ed-kicker{ font-size:10.5px; font-weight:700; letter-spacing:.08em; color:var(--ep-accent); margin-bottom:4px; }
        .ep-ed-name{ width:100%; border:0; border-bottom:2px solid transparent; background:transparent; font:650 21px var(--ep-font); color:var(--ep-ink); padding:2px 0; outline:none; transition:border-color .15s; }
        .ep-ed-name:hover{ border-bottom-color:var(--ep-line); }
        .ep-ed-name:focus{ border-bottom-color:var(--ep-accent); }
        .ep-ed-meta{ display:flex; align-items:center; gap:8px; flex:none; }
        .ep-ed-meta input{ width:190px; padding:8px 11px; border:1px solid var(--ep-line); border-radius:8px; font:13px var(--ep-font); outline:none; background:#fff; }
        .ep-ed-meta input:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-ed-meta .ep-fav-toggle{ width:auto; margin:0; white-space:nowrap; padding:8px 12px; }
        .ep-modal-xl .ep-ed-grid,.ep-modal-full .ep-ed-grid{ flex:1; min-height:0; margin:0; padding:16px 24px 0; grid-template-columns:300px minmax(0,1fr); }
        .ep-modal-xl .ep-ed-side{ overflow:auto; background:var(--ep-soft); border:1px solid var(--ep-line); border-radius:12px; padding:14px; }
        .ep-modal-xl .ep-ed-main{ display:flex; flex-direction:column; min-height:0; }
        .ep-ed-stage{ flex:1; min-height:0; overflow:auto; padding:18px; background:#e9edf2; border:1px solid var(--ep-line); border-top:0; border-radius:0 0 10px 10px; }
        .ep-ed-stage .ep-wys{ max-width:820px; min-height:420px; max-height:none; height:auto; margin:0 auto; border:0; border-radius:2px; padding:34px 44px;
            box-shadow:0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); }
        .ep-ed-stage .ep-ed-content{ display:block; max-width:none; min-height:420px; max-height:none; height:100%; border:0; border-radius:8px; background:#1e2530; color:#e6edf3; padding:14px 16px; }
        .ep-ed-stage .ep-ed-preview{ max-width:820px; min-height:420px; max-height:none; margin:0 auto; border:0; border-radius:2px; padding:34px 44px; background:#fff;
            box-shadow:0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); }
        .ep-ed-toolbar{ border-radius:0; }
        .ep-tb[data-cmd="mkfield"]{ color:var(--ep-accent); background:#e8f2fa; border-color:#b9d2e6; }
        .ep-tb[data-cmd="mkfield"]:hover{ background:var(--ep-accent); color:#fff; }
        .ep-modal-xl .ep-ed-side .ep-ed-field-row{ padding:6px; background:#fff; border:1px solid var(--ep-line); border-radius:9px; margin-bottom:8px; }
        .ep-modal-xl .ep-err{ padding:0 24px; min-height:0; }
        .ep-modal-xl .ep-actions{ margin:0; padding:12px 24px; border-top:1px solid var(--ep-line); background:var(--ep-soft); align-items:center; }
        .ep-modal-xl .ep-actions .ep-btn{ flex:none; min-width:120px; }
        .ep-ed-foot-left{ margin-right:auto; display:flex; align-items:center; gap:14px; font-size:12px; color:var(--ep-muted); }
        .ep-ed-dirty{ color:#9a6b00; font-weight:600; }
        .ep-ed-dirty[hidden]{ display:none; }
        @media (max-width:800px){ .ep-modal-xl .ep-ed-grid,.ep-modal-full .ep-ed-grid{ grid-template-columns:1fr; overflow:auto; } .ep-ed-head{ flex-wrap:wrap; } }

        /* Kategori kenar listesi */
        .ep-modal-mgr{ width:1280px; max-width:97vw; }
        .ep-mg-body{ grid-template-columns:180px minmax(0,0.8fr) minmax(0,1.2fr); }
        .ep-mg-chips{ flex-direction:column; overflow-y:auto; overflow-x:hidden; padding:2px 6px 2px 0; gap:4px; border-right:1px solid var(--ep-line); }
        .ep-mg-chip{ width:100%; justify-content:space-between; border-radius:8px; text-align:left; }
        .ep-mg-cl{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        @media (max-width:860px){
        .ep-mg-body{ grid-template-columns:1fr; }
        .ep-mg-chips{ flex-direction:row; overflow-x:auto; overflow-y:hidden; border-right:0; padding:0 0 6px; }
        .ep-mg-chip{ width:auto; }
        }
        /* Hazır bilgi menüsü ve tablo */
        .ep-ed-main .ep-ed-chips{ position:relative; }
        .ep-ed-chip-main{ background:var(--ep-accent); color:#fff; border-color:var(--ep-accent); }
        .ep-ed-chip-main:hover{ background:var(--ep-accent-hover); }
        .ep-ed-pop{ position:absolute; top:100%; left:0; z-index:10; width:310px; max-height:300px; overflow:auto; background:#fff; border:1px solid var(--ep-line); border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,.2); padding:6px 0; }
        .ep-ed-pop[hidden]{ display:none; }
        .ep-ed-pop-head{ padding:8px 14px 2px; font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--ep-muted); }
        .ep-ed-pop-item{ display:flex; justify-content:space-between; gap:10px; padding:7px 14px; font-size:13px; cursor:pointer; }
        .ep-ed-pop-item:hover{ background:#e5f1fb; color:var(--ep-accent); }
        .ep-ed-pop-item small{ color:var(--ep-muted); }
        .ep-wys td,.ep-paper td{ border:1px solid #999; padding:4px; min-width:40px; }

        /* Şablon yönetimi boyutları */
        .ep-modal-mgr{ width:1400px; max-width:96vw; height:min(850px,92vh); }
        .ep-mg-body{ height:auto; flex:1; min-height:0; grid-template-rows:minmax(0,1fr); }
        .ep-mg-list,.ep-mg-preview{ min-height:0; }

        /* ===== Kaşe ayarları penceresi (ortak ayarlar) ===== */
        .ep-kase{ width:720px; }
        .ep-kase-card{ border:1px solid var(--ep-line); border-radius:12px; padding:12px; margin-bottom:10px; background:var(--ep-soft); }
        .ep-kase-top{ display:flex; gap:6px; align-items:center; margin-bottom:8px; }
        .ep-kase-top input{ flex:1; min-width:0; padding:8px 10px; border:1px solid var(--ep-line); border-radius:8px; font:13.5px var(--ep-font); outline:none; background:#fff; }
        .ep-kase-top input:focus,.ep-kase-card textarea:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-kase-card textarea{ display:block; width:100%; padding:8px 10px; border:1px solid var(--ep-line); border-radius:8px; font:13.5px/1.45 var(--ep-font); resize:vertical; min-height:60px; outline:none; background:#fff; }
        .ep-kase-card .ep-toggle{ margin:8px 0 0; }
        .ep-kase-note{ margin:10px 0 4px; font-size:12px; color:var(--ep-muted); }
        /* ===== Çoklu dosya paneli (yenilenmiş) ===== */
        .ep-multi-modal.ep-mu{ width:780px; max-width:96vw; max-height:92vh; padding:0; display:flex; flex-direction:column; overflow:hidden; }
        .ep-mu-head{ display:flex; align-items:center; gap:14px; padding:20px 24px 12px; }
        .ep-mu-ico{ width:44px; height:44px; border-radius:12px; display:grid; place-items:center; flex:none; color:#fff;
            background:linear-gradient(135deg,#0d5c8f,#1489c9); box-shadow:0 4px 12px rgba(13,92,143,.3); }
        .ep-mu-ico svg{ width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
        .ep-mu-titles h3{ margin:0; font-size:18px; }
        .ep-mu-titles .ep-sub{ margin:2px 0 0; }
        .ep-mu-quota{ padding:0 24px 6px; }
        .ep-mu-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
        .ep-mu-stat{ padding:9px 13px; border:1px solid var(--ep-line); border-radius:10px; background:linear-gradient(#fff,var(--ep-soft)); }
        .ep-mu-stat b{ display:block; font-size:17px; line-height:1.25; color:var(--ep-accent); }
        .ep-mu-stat span{ font-size:11.5px; color:var(--ep-muted); }
        .ep-mu-stat.bad{ border-color:#efb7b3; background:#fdf3f2; }
        .ep-mu-stat.bad b{ color:var(--ep-danger); }
        .ep-mu-cap{ position:relative; height:10px; margin-top:10px; border-radius:6px; background:var(--ep-line); overflow:hidden; display:flex; }
        .ep-mu-cap i{ display:block; height:100%; transition:width .25s ease; }
        .ep-mu-cap .u{ background:#94a3b8; }
        .ep-mu-cap .s{ background:var(--ep-accent); }
        .ep-mu-cap.kep .s{ background:#d99100; }
        .ep-mu-cap.over .s{ background:var(--ep-danger); }
        .ep-mu-cap b{ position:absolute; top:0; bottom:0; width:2px; background:#b45309; }
        .ep-mu-legend{ display:flex; gap:14px; margin-top:6px; font-size:11px; color:var(--ep-muted); flex-wrap:wrap; }
        .ep-mu-legend span::before{ content:""; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; background:currentColor; }
        .ep-mu-legend .lu{ color:#94a3b8; } .ep-mu-legend .ls{ color:var(--ep-accent); } .ep-mu-legend .lk{ color:#b45309; }
        .ep-mu-alerts{ padding:0 24px; }
        .ep-mu-alerts:empty{ display:none; }
        .ep-mu-al{ padding:8px 12px; border-radius:9px; font-size:12.5px; line-height:1.45; border:1px solid; margin-top:6px; }
        .ep-mu-al.err{ background:#fdf3f2; border-color:#efb7b3; color:#8f1d16; }
        .ep-mu-al.warn{ background:#fff8e1; border-color:#f0d58a; color:#7a5400; }
        .ep-mu-al.info{ background:#f1f7fd; border-color:#b9d2e6; color:#0a4a75; }
        .ep-mu-tools{ display:flex; align-items:center; gap:6px; padding:12px 24px 8px; flex-wrap:wrap; }
        .ep-mu-tools .lbl{ font-size:11.5px; font-weight:700; color:var(--ep-muted); text-transform:uppercase; letter-spacing:.04em; margin-right:2px; }
        .ep-mu-tools .ep-btn{ padding:6px 12px; font-size:12px; }
        .ep-mu-tools .cnt{ margin-left:auto; font-size:12px; font-weight:600; color:var(--ep-accent); background:#eaf1ff; padding:4px 10px; border-radius:20px; }
        .ep-mu .ep-multi-list{ flex:1; min-height:140px; max-height:none; margin:0; padding:2px 24px 12px; }
        .ep-mu-row{ background:#fff; border-radius:11px; padding:9px 10px; gap:9px; transition:border-color .15s, box-shadow .15s, opacity .2s; }
        .ep-mu-row:hover{ border-color:#b9d2e6; }
        .ep-mu-row.ep-dragging{ opacity:.4; }
        .ep-mu-row.ep-drop-before{ box-shadow:0 -3px 0 var(--ep-accent); }
        .ep-mu-row.ep-drop-after{ box-shadow:0 3px 0 var(--ep-accent); }
        .ep-mu-no{ width:22px; height:22px; border-radius:50%; background:var(--ep-accent); color:#fff; font:700 11px/22px var(--ep-font); text-align:center; flex:none; }
        .ep-mu-ext{ flex:none; min-width:44px; text-align:center; font:700 10.5px var(--ep-font); padding:3px 6px; border-radius:6px; background:#e4ecf3; color:var(--ep-accent); text-transform:uppercase; }
        .ep-mu-main{ flex:1; min-width:0; }
        .ep-mu-main input{ width:100%; }
        .ep-mu-meta{ margin-top:3px; font-size:11px; color:var(--ep-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ep-mu-btns{ display:flex; gap:3px; flex:none; }
        .ep-mu-btns .ep-icon-btn{ padding:5px 7px; }
        .ep-mu-prog{ padding:0 24px 10px; }
        .ep-mu-prog[hidden]{ display:none; }
        .ep-mu .ep-actions{ margin:0; padding:12px 24px; border-top:1px solid var(--ep-line); background:var(--ep-soft); align-items:center; }
        .ep-mu .ep-actions .ep-btn{ flex:none; min-width:130px; display:inline-flex; align-items:center; justify-content:center; gap:7px; }
        .ep-mu .ep-actions .ep-btn svg{ width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
        .ep-mu .ep-actions .sp{ margin-right:auto; font-size:12px; color:var(--ep-muted); }
        @media (max-width:640px){ .ep-mu-stats{ grid-template-columns:1fr; } }
        /* Giriş kutuları: her ekranda tam genişlik, rahat boyut */
        .ep-modal .ep-field{ display:block; width:100%; }
        .ep-input-wrap{ display:flex !important; width:100%; }
        .ep-input-wrap input,.ep-field textarea,.ep-select{ width:100% !important; max-width:100% !important; min-width:0 !important; box-sizing:border-box !important; }
        .ep-input-wrap input{ min-height:38px; padding:8px 12px; font-size:14px; }
        .ep-field textarea{ min-height:96px; padding:8px 12px; }
        .ep-field > span:first-child{ display:block; margin-bottom:2px; }

        /* Şablon bilgi formu: geniş, iki sütunlu */
        .ep-modal.ep-modal-form{ width:680px; }
        .ep-form-grid{ display:grid; grid-template-columns:1fr 1fr; gap:6px 18px; }
        .ep-mini{ font:600 12px var(--ep-font); padding:5px 12px; margin:0 0 8px; border:1px solid var(--ep-line); border-radius:999px;
            background:#fff; color:var(--ep-accent); cursor:pointer; transition:background .15s, border-color .15s; }
        .ep-mini:hover{ background:var(--ep-soft); border-color:var(--ep-accent); }
        @media (max-width:640px){ .ep-form-grid{ grid-template-columns:1fr; } }

        /* EBYS uyarı/onay pencereleri (örn. "300 dpi'dan düşük") panellerimizin üstünde görünsün */
        .ui-confirm-dialog.ui-dialog{ z-index:100050 !important; }
        .lobibox-notify-wrapper{ z-index:100060 !important; }
        `;
        document.head.appendChild(style);
    }

    /* ============================ Diyalog / Sihirbaz ============================
       Tek bileşen: 1 adım = form, çok adım = sihirbaz. Sonuçta {alanId: değer} döner, iptalde null.
       Alan tipleri: (varsayılan) metin, 'password', 'textarea', 'toggle' (onay kutusu -> true/false).
       step.skippable = true ise "Atla" düğmesi çıkar; atlanan adımın değerleri sonuca yazılmaz. */

    function runWizard(steps, { submitLabel = 'Kaydet', cancelLabel = 'Vazgeç', danger = false, overlayClass = '', modalClass = '' } = {}) {
        return new Promise((resolve) => {
            let idx = 0;
            const values = {};
            const multi = steps.length > 1;
            const overlay = el('div', `ep-overlay ${overlayClass}`.trim());
            const modal = el('div', `ep-modal ${modalClass}`.trim());
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const close = (result) => {
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(result);
            };
            const goBack = () => { if (idx > 0) { idx--; render(); } else close(null); };
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); goBack(); } };
            document.addEventListener('keydown', onKey, true);

            const fieldHTML = (f) => {
                const fid = `ep-f-${esc(f.id)}`;
                if (f.type === 'toggle') {
                    const on = values[f.id] ?? f.value ?? false;
                    return `<label class="ep-toggle"><input id="${fid}" type="checkbox" ${on ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
                }
                if (f.type === 'textarea') {
                    return `
                    <label class="ep-field"><span>${esc(f.label)}${f.required === false && !f.noTag ? ' <em>(isteğe bağlı)</em>' : ''}</span>
                        <textarea id="${fid}" rows="${f.rows || 5}" placeholder="${esc(f.placeholder || '')}" spellcheck="false">${esc(values[f.id] ?? f.value ?? '')}</textarea>
                    </label>`;
                }
                const secret = f.type === 'password';
                return `
                <label class="ep-field"><span>${esc(f.label)}${f.required === false && !f.noTag ? ' <em>(isteğe bağlı)</em>' : ''}</span>
                    <span class="ep-input-wrap">
                        <input id="${fid}" type="text" name="ep_${esc(f.id)}_${Math.random().toString(36).slice(2, 8)}"
                               placeholder="${esc(f.placeholder || '')}"
                               value="${esc(values[f.id] ?? f.value ?? '')}" autocomplete="off"
                               autocorrect="off" autocapitalize="off" spellcheck="false"
                               data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-bwignore="true"
                               ${secret ? 'data-secret data-masked="1"' : ''}>
                        ${secret ? '<button type="button" class="ep-eye" tabindex="-1">Göster</button>' : ''}
                    </span>
                </label>`;
            };

            function render() {
                const step = steps[idx];
                const last = idx === steps.length - 1;
                modal.innerHTML = `
                    ${multi ? `<div class="ep-steps"><span>Adım ${idx + 1} / ${steps.length}</span><div class="ep-bar"><i style="width:${((idx + 1) / steps.length) * 100}%"></i></div></div>` : ''}
                    <div class="ep-body">
                        <h3>${esc(step.title)}</h3>
                        ${step.subtitle ? `<p class="ep-sub">${esc(step.subtitle)}</p>` : ''}
                        <div class="${step.grid ? 'ep-form-grid' : ''}">${(step.fields || []).map(fieldHTML).join('')}</div>
                        ${step.extraBtn ? `<button type="button" class="ep-mini" data-act="extra">${esc(step.extraBtn.label)}</button>` : ''}
                        <div class="ep-err" role="alert"></div>
                    </div>
                    <div class="ep-actions">
                        <button type="button" class="ep-btn ep-btn-secondary" data-act="back">${idx > 0 ? 'Geri' : esc(cancelLabel)}</button>
                        ${step.skippable ? '<button type="button" class="ep-btn ep-btn-skip" data-act="skip">Atla</button>' : ''}
                        <button type="button" class="ep-btn ${danger && last ? 'ep-btn-danger' : 'ep-btn-primary'}" data-act="next">${last ? esc(submitLabel) : 'Devam'}</button>
                    </div>`;

                const errEl = modal.querySelector('.ep-err');
                const fail = (msg) => {
                    errEl.textContent = msg;
                    errEl.classList.remove('ep-shake'); void errEl.offsetWidth; errEl.classList.add('ep-shake');
                };

                modal.querySelectorAll('.ep-eye').forEach((btn) => {
                    btn.onclick = () => {
                        const input = btn.parentElement.querySelector('input');
                        const show = input.dataset.masked === '1';
                        input.dataset.masked = show ? '0' : '1';
                        btn.textContent = show ? 'Gizle' : 'Göster';
                    };
                });

                const next = () => {
                    for (const f of step.fields || []) {
                        const input = modal.querySelector(`#ep-f-${CSS.escape(f.id)}`);
                        if (f.type === 'toggle') { values[f.id] = input.checked; continue; }
                        const raw = input.hasAttribute('data-secret') || f.type === 'textarea' ? input.value : input.value.trim();
                        if (f.required !== false && !raw.trim()) return fail(`${f.label} boş bırakılamaz.`);
                        if (f.validate) {
                            const err = f.validate(raw, values);
                            if (err) return fail(err);
                        }
                        values[f.id] = raw;
                    }
                    if (last) close(values);
                    else { idx++; render(); }
                };
                const skip = () => {
                    (step.fields || []).forEach((f) => { delete values[f.id]; });
                    if (last) close(values);
                    else { idx++; render(); }
                };

                modal.querySelector('[data-act="next"]').onclick = next;
                modal.querySelector('[data-act="back"]').onclick = goBack;
                const skipBtn = modal.querySelector('[data-act="skip"]');
                if (skipBtn) skipBtn.onclick = skip;
                const extraBtn = modal.querySelector('[data-act="extra"]');
                if (extraBtn) extraBtn.onclick = () => {
                    step.extraBtn.onClick(modal);
                    if (!step.extraBtn.keepOpen) close(null);
                };
                modal.querySelectorAll('input[type="text"]').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); }));
                setTimeout(() => (modal.querySelector('input[type="text"],textarea') || modal.querySelector('[data-act="next"]')).focus(), 30);
            }

            render();
        });
    }

    /* ============================ Şifreleme katmanı ============================ */

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const bufToB64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
    const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

    function openDB() {
        return new Promise((res, rej) => {
            const r = indexedDB.open('ep_db', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('keys');
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    }
    async function idbRun(mode, fn) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction('keys', mode);
            const req = fn(tx.objectStore('keys'));
            tx.oncomplete = () => { db.close(); res(req && req.result); };
            tx.onerror = () => { db.close(); rej(tx.error); };
        });
    }
    async function getDeviceKey(create) {
        let key = await idbRun('readonly', (s) => s.get('device'));
        if (!key && create) {
            key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            await idbRun('readwrite', (s) => s.put(key, 'device'));
        }
        return key || null;
    }

    async function saveCreds(creds) {
        try {
            const key = await getDeviceKey(true);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(creds)));
            store.set(KEYS.vault, JSON.stringify({ v: 2, iv: bufToB64(iv), data: bufToB64(data) }));
            return true;
        } catch (_) {
            toast('Bilgiler kaydedilemedi. Tarayıcı depolama/şifreleme ayarlarını kontrol edin.', 'error');
            return false;
        }
    }

    /** @returns {object|null|'broken'} */
    async function loadCreds() {
        const raw = store.get(KEYS.vault, '');
        if (!raw) return null;
        let key;
        try { key = await getDeviceKey(false); } catch (_) { return 'unavailable'; }
        if (!key) return 'broken';
        try {
            const v = JSON.parse(raw);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(v.iv) }, key, b64ToBuf(v.data));
            return JSON.parse(dec.decode(plain));
        } catch (_) { return 'broken'; }
    }

    async function pbkdf2Bits(password, salt) {
        const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, km, 256);
    }
    async function savePassword(password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        store.set(KEYS.pw, JSON.stringify({ salt: bufToB64(salt), hash: bufToB64(await pbkdf2Bits(password, salt)) }));
    }
    async function verifyPassword(password) {
        try {
            const rec = JSON.parse(store.get(KEYS.pw, 'null'));
            if (!rec) return true;
            return bufToB64(await pbkdf2Bits(password, new Uint8Array(b64ToBuf(rec.salt)))) === rec.hash;
        } catch (_) { return false; }
    }

    async function legacyDecrypt(password, vault) {
        const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: b64ToBuf(vault.salt), iterations: PBKDF2_ITER, hash: 'SHA-256' },
            km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(vault.iv) }, key, b64ToBuf(vault.data));
        return JSON.parse(dec.decode(plain));
    }

    /* ============================ Kurulum / Erişim ============================ */

    const CRED_FIELDS = [
        { id: 'kullanici_adi', label: 'Kullanıcı adı', placeholder: 'tk49322' },
        { id: 'sifre', label: 'EBYS şifresi', type: 'password' },
        { id: 'e_imza', label: 'e-İmza PIN', type: 'password', required: false },
        { id: 'kep_parola', label: 'KEP parola', type: 'password', required: false },
        { id: 'kep_sifre', label: 'KEP şifre', type: 'password', required: false },
    ];
    const pickCreds = (v) => Object.fromEntries(CRED_FIELDS.map((f) => [f.id, v[f.id] || '']));

    const passwordFields = () => [
        { id: 'pw1', label: 'Güvenlik parolası', type: 'password', placeholder: 'En az 4 karakter',
          validate: (v) => (v.length < 4 ? 'En az 4 karakter olmalı.' : null) },
        { id: 'pw2', label: 'Güvenlik parolası (tekrar)', type: 'password',
          validate: (v, all) => (v !== all.pw1 ? 'Parolalar eşleşmiyor.' : null) },
    ];

    // Kurulum sihirbazından gelen kaşe değerlerini ortak depoya EKLEMELİ işler (mevcut veriyi silmez)
    function applyKaseFromSetup(v) {
        const cur = kaseLoad();
        let changed = false;

        if (typeof v.memurlar === 'string') {
            const seen = new Set(cur.memurlar.map(lcTr));
            parseNames(v.memurlar).forEach((n) => { if (!seen.has(lcTr(n))) { seen.add(lcTr(n)); cur.memurlar.push(n); } });
            changed = true;
        }
        if (typeof v.havaleEden === 'string') { cur.havaleEden = v.havaleEden.trim(); changed = true; }
        if (typeof v.upper === 'boolean') { cur.upper = v.upper; changed = true; }
        if (v.ilkVarsayilan === true && cur.memurlar.length && !cur.sabit) { cur.sabit = cur.memurlar[0]; changed = true; }
        if (v.hazirYazilar === true) {
            const have = new Set(cur.presets.map((p) => lcTr(p.label)));
            KASE_DEF_PRESETS.forEach((p) => { if (!have.has(lcTr(p.label))) cur.presets.push({ ...p }); });
            changed = true;
        }
        if (changed) kaseSave(cur);
    }

    async function runSetup() {
        const k = kaseLoad();
        const v = await runWizard([
            { title: 'EBYS Plus - Kurulum', subtitle: 'EBYS sistemine ait giriş bilgilerinizi giriniz.', fields: CRED_FIELDS.slice(0, 2) },
            { title: 'e-İmza ve KEP', subtitle: 'Kullanmıyorsanız boş bırakabilirsiniz.', fields: CRED_FIELDS.slice(2) },
            { title: 'Kaşe: Görevli memurlar', skippable: true,
              subtitle: 'Kaşe ve havale tablosunda seçilebilecek kişiler. Her satıra bir ad soyad yazın. İsterseniz atlayıp sonra menüden ekleyebilirsiniz.',
              fields: [{ id: 'memurlar', label: 'Ad soyad listesi', type: 'textarea', rows: 6, required: false,
                         placeholder: 'Ahmet Yılmaz\nAyşe Demir', value: k.memurlar.join('\n') }] },
            { title: 'Kaşe tercihleri', skippable: true,
              subtitle: 'Havale tablosu ve kaşe görünümü için varsayılanlar. Sonradan "Kaşe ayarları"ndan değiştirilebilir.',
              fields: [
                  { id: 'havaleEden', label: 'Varsayılan "Havale eden"', required: false, value: k.havaleEden },
                  { id: 'ilkVarsayilan', label: 'Listedeki ilk kişi varsayılan kullanıcı olsun (bir daha sorulmasın)', type: 'toggle', value: false },
                  { id: 'upper', label: 'Kaşedeki ismi BÜYÜK harfle yaz', type: 'toggle', value: k.upper },
              ] },
            { title: 'Kaşe: Hazır kontrol yazıları', skippable: true,
              subtitle: 'Varsayılan yazılar ("Tescil/terkin", "Kütük terkin") kaşe panelinde buton olarak görünür. Metinlerini ve yeni yazıları kurulumdan sonra "Kaşe ayarları"ndan düzenleyebilirsiniz.',
              fields: [{ id: 'hazirYazilar', label: 'Varsayılan hazır yazıları ekle', type: 'toggle', value: true }] },
            { title: 'Güvenlik parolasını belirleyin',
              subtitle: 'Kayıtlı şifreleri güncellemek için gerekir.',
              fields: passwordFields() },
        ], { submitLabel: 'Kurulumu tamamla' });
        if (!v) return null;
        const creds = pickCreds(v);
        if (!(await saveCreds(creds))) return null;
        await savePassword(v.pw1);
        applyKaseFromSetup(v);
        toast('Kurulum tamamlandı. Bilgileriniz şifrelenerek kaydedildi.');
        return creds;
    }

    async function bootstrap() {
        if (sessionStorage.getItem('ep_skip_setup')) return null;

        const oldRaw = store.get(KEYS.oldVault, '');
        if (oldRaw) {
            let vault; try { vault = JSON.parse(oldRaw); } catch (_) { vault = null; }
            if (vault) {
                toast('Önceki sürümün kaydı bulundu. Son kez ana parolanız istenecek.', 'info');
                for (let i = 0; i < 3; i++) {
                    const r = await runWizard([{ title: 'Ana parolanız', subtitle: 'Bu parola bundan sonra "Güvenlik parolası" olarak kullanılacak; girişte sorulmayacak.',
                        fields: [{ id: 'p', label: 'Ana parola', type: 'password' }] }], { submitLabel: 'Devam' });
                    if (!r) break;
                    try {
                        const creds = pickCreds(await legacyDecrypt(r.p, vault));
                        if (!(await saveCreds(creds))) throw new Error('kayıt başarısız');
                        await savePassword(r.p);
                        store.remove(KEYS.oldVault);
                        try { sessionStorage.removeItem(KEYS.oldSession); } catch (_) { /* yok say */ }
                        toast('Bilgileriniz yeni sisteme taşındı. Artık giriş sırasında parola sorulmayacak.');
                        return creds;
                    } catch (_) { toast(`Ana parola hatalı (${i + 1}/3).`, 'error'); }
                }
                sessionStorage.setItem('ep_skip_setup', '1');
                return null;
            }
        }

        if (LEGACY_PLAIN_KEYS.some((k) => store.get(k))) {
            toast('Şifresiz kayıtlı eski bilgiler bulundu, güvenli hale getiriliyor…', 'info');
            const r = await runWizard([{ title: 'Güvenlik parolasını belirleyin',
                subtitle: 'Yalnızca kayıtlı bilgileri değiştirmek veya silmek için gerekir.', fields: passwordFields() }],
                { submitLabel: 'Kaydet' });
            if (!r) { sessionStorage.setItem('ep_skip_setup', '1'); return null; }
            const creds = pickCreds(Object.fromEntries(LEGACY_PLAIN_KEYS.map((k) => [k, store.get(k)])));
            if (!(await saveCreds(creds))) { sessionStorage.setItem('ep_skip_setup', '1'); return null; }
            await savePassword(r.pw1);
            LEGACY_PLAIN_KEYS.forEach((k) => store.remove(k));
            store.remove('sifreGuncellemeDurumu');
            toast('Bilgileriniz şifrelendi.');
            return creds;
        }

        const creds = await runSetup();
        if (!creds) sessionStorage.setItem('ep_skip_setup', '1');
        return creds;
    }

    async function requireAccess() {
        if (Date.now() < EP.unlockedUntil || !store.get(KEYS.pw)) return true;
        for (let i = 0; i < 3; i++) {
            const r = await runWizard([{ title: 'Güvenlik parolası', subtitle: 'Lütfen Sistem Parolasını Giriniz.',
                fields: [{ id: 'p', label: 'Güvenlik parolası', type: 'password' }] }], { submitLabel: 'Onayla' });
            if (!r) return false;
            if (await verifyPassword(r.p)) { EP.unlockedUntil = Date.now() + UNLOCK_MS; return true; }
            toast(`Güvenlik parolası hatalı (${i + 1}/3).`, 'error');
        }
        return false;
    }

    /* ======================= Kaşe ayarları penceresi (güvenlik parolası İSTEMEZ) ======================= */

    function openKaseSettings() {
        return new Promise((resolve) => {
            const cur = kaseLoad();
            const presets = cur.presets.map((p) => ({ ...p }));

            const overlay = el('div', 'ep-overlay');
            const modal = el('div', 'ep-modal ep-modal-wide ep-kase');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = `
                <h3>👥 Kaşe ayarları</h3>
                <p class="ep-sub">Evrak Kaşe Asistanı ile ortak kullanılır. PDF önizleme sayfasındaki "Ayarlar" ile aynı veridir.</p>

                <div class="ep-ed-label" style="margin-top:4px">Görevli memurlar (her satıra bir isim)</div>
                <textarea id="ep-k-names" class="ep-k-ta" rows="6" spellcheck="false" placeholder="Ahmet Yılmaz&#10;Ayşe Demir"></textarea>
                <label class="ep-field" style="margin-top:10px"><span>Varsayılan kullanıcı</span>
                    <select id="ep-k-def" class="ep-select"></select></label>
                <label class="ep-field"><span>Havale eden</span>
                    <span class="ep-input-wrap"><input id="ep-k-hav" type="text" autocomplete="off"></span></label>
                <label class="ep-toggle"><input id="ep-k-up" type="checkbox"><span>Kaşedeki ismi BÜYÜK harfle yaz</span></label>

                <div class="ep-ed-label">Hazır kontrol yazıları</div>
                <div id="ep-k-presets"></div>
                <button type="button" class="ep-btn ep-btn-secondary" id="ep-k-addp" style="width:100%">+ Yeni yazı ekle</button>
                <div class="ep-kase-note">Konum ve boyut bilgileri PDF sayfasında otomatik hatırlanır; burada değişmez.</div>

                <div class="ep-err" id="ep-k-err" role="alert"></div>
                <div class="ep-actions">
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-k-cancel">Vazgeç</button>
                    <button type="button" class="ep-btn ep-btn-primary" id="ep-k-save">Kaydet</button>
                </div>`;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const $ = (s) => modal.querySelector(s);
            const namesEl = $('#ep-k-names'), defEl = $('#ep-k-def'), havEl = $('#ep-k-hav'), upEl = $('#ep-k-up');
            const presetsBox = $('#ep-k-presets'), errEl = $('#ep-k-err');

            namesEl.value = cur.memurlar.join('\n');
            havEl.value = cur.havaleEden;
            upEl.checked = cur.upper;

            let chosenDef = cur.sabit;
            function rebuildDefault() {
                const list = parseNames(namesEl.value);
                defEl.innerHTML = '';
                const none = el('option', '', 'Yok (her seferinde sor)'); none.value = '';
                defEl.appendChild(none);
                list.forEach((n) => { const o = el('option'); o.value = n; o.textContent = n; defEl.appendChild(o); });
                defEl.value = list.includes(chosenDef) ? chosenDef : '';
            }
            defEl.addEventListener('change', () => { chosenDef = defEl.value; });
            namesEl.addEventListener('input', debounce(rebuildDefault, 150));
            rebuildDefault();

            function renderPresets() {
                presetsBox.innerHTML = '';
                if (!presets.length) presetsBox.appendChild(el('div', 'ep-ed-nofield', 'Hazır yazı yok. "Yeni yazı ekle" ile oluşturun.'));
                presets.forEach((p, i) => {
                    const card = el('div', 'ep-kase-card');
                    card.innerHTML = `
                        <div class="ep-kase-top">
                            <input type="text" data-k="label" placeholder="Buton adı" value="${esc(p.label)}">
                            <button type="button" class="ep-icon-btn" data-a="up" title="Yukarı taşı" aria-label="Yukarı taşı"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
                            <button type="button" class="ep-icon-btn" data-a="dn" title="Aşağı taşı" aria-label="Aşağı taşı"><svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></button>
                            <button type="button" class="ep-icon-btn ep-icon-btn-danger" data-a="del" title="Sil" aria-label="Sil"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                        </div>
                        <textarea data-k="l1" rows="3" placeholder="Yazı metni">${esc(p.l1)}</textarea>
                        <label class="ep-toggle"><input type="checkbox" data-k="isim" ${p.isim !== false ? 'checked' : ''}><span>Kaşeye isim ekle (kullanıcı seçimi sorulur)</span></label>`;
                    card.querySelector('[data-k="label"]').addEventListener('input', (e) => { p.label = e.target.value; });
                    card.querySelector('[data-k="l1"]').addEventListener('input', (e) => { p.l1 = e.target.value; });
                    card.querySelector('[data-k="isim"]').addEventListener('change', (e) => { p.isim = e.target.checked; });
                    card.querySelector('[data-a="up"]').onclick = () => { if (i > 0) { [presets[i - 1], presets[i]] = [presets[i], presets[i - 1]]; renderPresets(); } };
                    card.querySelector('[data-a="dn"]').onclick = () => { if (i < presets.length - 1) { [presets[i + 1], presets[i]] = [presets[i], presets[i + 1]]; renderPresets(); } };
                    card.querySelector('[data-a="del"]').onclick = () => { presets.splice(i, 1); renderPresets(); };
                    presetsBox.appendChild(card);
                });
            }
            renderPresets();
            $('#ep-k-addp').onclick = () => {
                presets.push({ label: '', l1: '', isim: true });
                renderPresets();
                const last = presetsBox.querySelector('.ep-kase-card:last-child [data-k="label"]');
                if (last) last.focus();
            };

            const onKey = (e) => {
                if (document.querySelector('.ep-overlay-2')) return;
                if (e.key === 'Escape') { e.stopPropagation(); doClose(); }
            };
            document.addEventListener('keydown', onKey, true);
            function doClose() { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(); }
            $('#ep-k-cancel').onclick = doClose;

            $('#ep-k-save').onclick = () => {
                const cleaned = presets.filter((p) => String(p.label).trim());
                if (presets.some((p) => !String(p.label).trim() && String(p.l1).trim())) {
                    errEl.textContent = 'Metni olan bir yazının buton adı boş. Ad girin ya da yazıyı silin.';
                    return;
                }
                const memurlar = parseNames(namesEl.value);
                const next = kaseSanitize({
                    presets: cleaned, memurlar, havaleEden: havEl.value.trim(),
                    sabit: memurlar.includes(chosenDef) ? chosenDef : '', upper: upEl.checked,
                });
                if (!kaseSave(next)) return;
                toast('Kaşe ayarları kaydedildi.');
                doClose();
            };
            setTimeout(() => namesEl.focus(), 30);
        });
    }

    /* ============================ Güvenlik menüsü ============================ */

    function buildMenu() {
        if (document.getElementById('ep-fab')) return;

        const fab = el('button', 'ep-fab', '📑 EBYS Plus');
        fab.id = 'ep-fab';
        fab.type = 'button';
        fab.setAttribute('aria-haspopup', 'true');

        const panel = el('div', 'ep-panel', `
            <div class="ep-panel-head"><strong>📑 EBYS Plus</strong><span class="ep-status" id="ep-status"></span></div>
            <label class="ep-switch"><span>🔌 Sistem Aktif</span><input type="checkbox" id="ep-auto"></label>
            <button type="button" class="ep-item" data-act="edit">📝 Kayıtlı şifreleri düzenle</button>
            <button type="button" class="ep-item" data-act="templates">🗂️ Şablonları düzenle</button>
            <button type="button" class="ep-item" data-act="kase">👥 Kaşe ayarları</button>
            <button type="button" class="ep-item" data-act="ext">📎 İzin verilen dosya uzantıları</button>
            <button type="button" class="ep-item" data-act="password">🔑 Güvenlik parolasını değiştir</button>
            <button type="button" class="ep-item ep-item-danger" data-act="wipe">🗑️ Tüm verileri sil</button>
            <a class="ep-foot" href="https://emvalis.github.io/" target="_blank" rel="noopener">ℹ️ Hakkında</a>`);
        panel.id = 'ep-panel';
        panel.hidden = true;
        document.body.append(panel, fab);

        const setOpen = (open) => { panel.hidden = !open; fab.setAttribute('aria-expanded', String(open)); };
        fab.onclick = (e) => { e.stopPropagation(); setOpen(panel.hidden); };
        document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) setOpen(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });

        const auto = panel.querySelector('#ep-auto');
        auto.checked = store.get(KEYS.enabled, '1') !== '0';
        auto.onchange = () => {
            store.set(KEYS.enabled, auto.checked ? '1' : '0');
            toast(auto.checked ? 'Sistem Aktif Edildi.' : 'Sistem Pasife Alındı.', 'info');
            if (auto.checked) tick();
        };

        panel.addEventListener('click', async (e) => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (!act) return;
            setOpen(false);

            if (act === 'edit') {
                if (!EP.creds) { sessionStorage.removeItem('ep_skip_setup'); EP.creds = await runSetup(); refreshStatus(); tick(); return; }
                if (!(await requireAccess())) return;
                const v = await runWizard([{ title: 'Kayıtlı bilgileri güncelle', subtitle: 'Değişiklikler şifrelenerek kaydedilir.',
                    fields: CRED_FIELDS.map((f) => ({ ...f, value: EP.creds[f.id] })) }]);
                if (!v) return;
                const updated = pickCreds(v);
                if (!(await saveCreds(updated))) return;
                EP.creds = updated;
                EP.clicked = {}; EP.halted = false; sessionStorage.removeItem('ep_attempts');
                toast('Bilgiler güncellendi.');
                refreshStatus();
            }

            if (act === 'templates') {
                await openTemplateManager();
            }

            if (act === 'kase') {
                await openKaseSettings();   // güvenlik parolası gerekmez
            }



            if (act === 'ext') {
                const v = await runWizard([{
                    title: 'İzin verilen dosya uzantıları',
                    subtitle: 'Çoklu dosya eklemede yalnızca bu uzantılar seçilebilir. Virgül, boşluk veya satır ile ayırın (örn. pdf, docx, jpg).',
                    fields: [
                        { id: 'exts', label: 'Uzantılar', type: 'textarea', rows: 5, value: getAllowedExts().join(', '), required: false },
                    ],
                    extraBtn: {
                        label: '↺ Standart listeye dön',
                        keepOpen: true,
                        onClick: (modal) => {
                            const ta = modal.querySelector('#ep-f-exts');
                            if (ta) { ta.value = DEFAULT_EXT.join(', '); ta.focus(); }
                            toast('Standart liste yüklendi. Uygulamak için Kaydet\'e basın.', 'info');
                        },
                    },
                }], { submitLabel: 'Kaydet' });
                if (!v) return;
                const list = parseExts(v.exts);
                if (!list.length) return toast('En az bir uzantı girmelisiniz.', 'error');
                store.set(EXT_KEY, JSON.stringify(list));
                toast(`${list.length} uzantıya izin verildi.`);
            }




            if (act === 'password') {
                if (!EP.creds) return toast('Önce kurulum yapın.', 'error');
                if (!(await requireAccess())) return;
                const v = await runWizard([{ title: 'Yeni Güvenlik parolası', fields: passwordFields() }]);
                if (!v) return;
                await savePassword(v.pw1);
                toast('Güvenlik parolası değiştirildi.');
            }

            if (act === 'wipe') {
                if (!(await requireAccess())) return;
                const ok = await runWizard([{ title: 'Tüm veriler silinsin mi?',
                    subtitle: 'Kayıtlı bilgiler, şifreleme anahtarı ve Güvenlik parolası bu tarayıcıdan kaldırılır. Şablonlarınız ve Kaşe ayarlarınız (personel, hazır yazılar) korunur. Bu işlem geri alınamaz.', fields: [] }],
                    { submitLabel: 'Evet, sil', danger: true });
                if (!ok) return;
                [KEYS.vault, KEYS.pw, KEYS.oldVault].forEach(store.remove);
                try { await idbRun('readwrite', (s) => s.delete('device')); } catch (_) { /* yok say */ }
                EP.creds = null;
                refreshStatus();
                toast('Tüm veriler silindi.', 'info');
            }
        });

        refreshStatus();
    }

    function refreshStatus() {
        const s = document.getElementById('ep-status');
        if (!s) return;
        s.textContent = EP.creds ? 'Yönetim Paneli ~ Hazır' : 'Kurulum gerekli';
        s.classList.toggle('off', !EP.creds);
    }

    /* ============================ Otomatik giriş ============================ */

    function typeInto(input, text) {
        input.focus();
        input.value = '';
        for (const ch of text) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
            input.value += ch;
            input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function fill(input, value, mask = false) {
        if (!input || !value) return false;
        if (mask && input.type !== 'password') input.type = 'password';
        if (input.value !== value) typeInto(input, value);
        return true;
    }

    function canAttempt(name) {
        const now = Date.now();
        let list; try { list = JSON.parse(sessionStorage.getItem('ep_attempts') || '{}'); } catch (_) { list = {}; }
        const recent = (list[name] || []).filter((t) => now - t < 60000);
        if (recent.length >= 2) {
            if (!EP.halted) { EP.halted = true; toast('Otomatik giriş durduruldu. Bilgileriniz hatalı olabilir; menüden kontrol edin.', 'error'); }
            return false;
        }
        recent.push(now);
        list[name] = recent;
        sessionStorage.setItem('ep_attempts', JSON.stringify(list));
        return true;
    }

    function autoFill() {
        if (!EP.creds || EP.halted || store.get(KEYS.enabled, '1') === '0') return;
        const c = EP.creds;

        fill(document.getElementById('txtPinKod'), c.e_imza, true);

        const kepParolaInput = document.getElementById('passwordParola');
        const kepVisible = !!kepParolaInput && kepParolaInput.getClientRects().length > 0;
        if (!kepVisible) EP.clicked.kep = false;

        const kepA = fill(kepParolaInput, c.kep_parola, true);
        const kepB = fill(document.getElementById('passwordSifre'), c.kep_sifre, true);
        if (kepA && kepB && kepVisible && !EP.clicked.kep) {
            const kepForm = document.getElementById('kepLogin2FormId');
            const btn = kepForm && Array.from(kepForm.querySelectorAll('button[type="submit"]'))
                .find((b) => b.textContent.trim() === 'Bağlan' || b.getAttribute('aria-label') === 'Bağlan');
            if (btn && canAttempt('kep')) { EP.clicked.kep = true; btn.click(); }
        }

        const user = document.querySelector('input[name="parolaSertifikaAccordion:uForm:txtUKullaniciAdi"]');
        const pass = document.getElementById('loginUSifre');
        const loginVisible = !!pass && pass.getClientRects().length > 0;
        if (!isLoginPage && !loginVisible) EP.clicked.login = false;
        if (user && pass && c.kullanici_adi && c.sifre && (isLoginPage || loginVisible)) {
            fill(user, c.kullanici_adi);
            fill(pass, c.sifre);
            if (!EP.clicked.login) {
                const blockLeft = Number(sessionStorage.getItem('ep_block_until') || 0) - Date.now();
                if (blockLeft > 0) {
                    clearTimeout(EP.blockTimer);
                    EP.blockTimer = setTimeout(tick, blockLeft + 500);
                    return;
                }
                const last = Number(sessionStorage.getItem('ep_last_login') || 0);
                if (Date.now() - last < 20000) return;

                const btn = (pass.form && pass.form.querySelector('button[type="submit"]')) || document.querySelector('button[type="submit"]');
                if (btn && canAttempt('login')) {
                    EP.clicked.login = true;
                    sessionStorage.setItem('ep_last_login', String(Date.now()));
                    btn.click();
                }
            }
        }
    }

    /* ======================== Giriş uyarılarını algıla ======================== */

    const seenNotices = new WeakSet();
    let noticeBusy = false;

    function watchLoginNotices() {
        if (!EP.creds || !document.getElementById('loginUSifre')) return;
        document.querySelectorAll('.lobibox-notify-msg').forEach((n) => {
            if (seenNotices.has(n)) return;
            const msg = (n.textContent || '').trim();
            if (!msg) return;
            seenNotices.add(n);
            handleLoginNotice(msg);
        });
    }

    function handleLoginNotice(msg) {
        const t = msg.toLocaleLowerCase('tr');

        if (t.includes('bloke')) {
            EP.halted = true;
            sessionStorage.setItem('ep_block_until', String(Date.now() + 65000));
            toast('Girişiniz 1 dakika bloke edildi. Otomatik giriş durduruldu.', 'error');
            offerPasswordUpdate('Sistem girişinizi 1 dakikalığına bloke etti. Şifrenizi yakın zamanda değiştirdiyseniz yeni şifrenizi kaydedebilirsiniz; blok bitince otomatik giriş yapılır.');
            return;
        }

        if (t.includes('giriş yapılamamıştır')) {
            EP.halted = true;
            offerPasswordUpdate('Sistem girişi kabul etmedi. Kurumunuz şifreleri belirli aralıklarla yeniletiyorsa şifreniz değişmiş olabilir.');
            return;
        }

        if (t.includes('boş olamaz')) {
            toast('Alanlar boş gönderildi, yeniden deneniyor…', 'info');
            sessionStorage.removeItem('ep_last_login');
            EP.clicked.login = false;
            setTimeout(tick, 400);
        }
    }

    async function offerPasswordUpdate(reason) {
        if (noticeBusy) return;
        noticeBusy = true;
        try {
            const c = await confirmChoice('Şifrenizi mi değiştirdiniz?', reason, [
                { key: 'yes', label: 'Evet, şifremi değiştirdim', primary: true },
                { key: 'no', label: 'Hayır, değiştirmedim' },
            ]);
            if (c === 'no') {
                toast('Otomatik giriş durduruldu. Kullanıcı adı/şifrenizi EBYS Plus menüsünden kontrol edin.', 'info');
                return;
            }
            if (c !== 'yes') return;

            const v = await runWizard([{
                title: 'Yeni şifrenizi girin',
                subtitle: 'Yeni EBYS şifreniz şifrelenerek kaydedilecek ve giriş otomatik denenecek.',
                fields: [{ id: 'sifre', label: 'Yeni EBYS şifresi', type: 'password' }],
            }], { submitLabel: 'Kaydet ve giriş yap' });
            if (!v) return;

            const updated = { ...EP.creds, sifre: v.sifre };
            if (!(await saveCreds(updated))) return;
            EP.creds = updated;
            EP.clicked = {}; EP.halted = false;
            sessionStorage.removeItem('ep_attempts');
            sessionStorage.removeItem('ep_last_login');
            toast('Şifre güncellendi, giriş deneniyor…');
            tick();
        } finally {
            noticeBusy = false;
        }
    }

    /* ======================== Evrak açıklamasını otomatik doldur ======================== */

    const ACIKLAMA_PAIRS = [
        { label: 'windowCevapEvrakForm:evrakEkTabView:dosyaAdi', area: 'windowCevapEvrakForm:evrakEkTabView:dosyaAciklama' },
        { label: 'inboxItemInfoForm:evrakEkTabView:dosyaAdi', area: 'inboxItemInfoForm:evrakEkTabView:dosyaAciklama' },
        { label: 'yeniGidenEvrakForm:evrakEkTabView:dosyaAdi', area: 'yeniGidenEvrakForm:evrakEkTabView:dosyaAciklama' },
    ];
    const aciklamaState = {};

    function initAciklama() {
        document.addEventListener('input', (e) => {
            if (!e.isTrusted || !e.target) return;
            const p = ACIKLAMA_PAIRS.find((x) => x.area === e.target.id);
            if (p) (aciklamaState[p.area] ||= {}).edited = true;
        }, true);
    }

    function autoAciklama() {
        ACIKLAMA_PAIRS.forEach((p) => {
            const label = document.getElementById(p.label);
            const area = document.getElementById(p.area);
            if (!label || !area) return;
            const text = label.textContent.trim().replace(/\.[^.\s]{1,5}$/, '');
            if (!text) { delete aciklamaState[p.area]; return; }
            const st = (aciklamaState[p.area] ||= {});
            if (st.seen !== text) { st.seen = text; st.edited = false; }
            if (st.edited) return;
            if (area.value.trim() === '' || area.value === st.auto) {
                if (area.value !== text) {
                    area.value = text;
                    area.dispatchEvent(new Event('input', { bubbles: true }));
                    area.dispatchEvent(new Event('change', { bubbles: true }));
                }
                st.auto = text;
            }
        });
    }

    /* ======================== Çoklu Dosya Ekleme ======================== */

    const EK_UPLOAD_PREFIXES = [
        'windowCevapEvrakForm:evrakEkTabView',
        'inboxItemInfoForm:evrakEkTabView',
        'yeniGidenEvrakForm:evrakEkTabView',
    ];




    /* ---------- İzin verilen uzantılar (ayarlanabilir) ---------- */
    const EXT_KEY = 'ep_allowed_ext_v1';
    // Standart liste. Menüden "İzin verilen dosya uzantıları" ile de çoğaltabilirsin.
    const DEFAULT_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'txt', 'csv', 'xml', 'html', 'htm', 'eml', 'msg', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'zip', 'rar', '7z', 'tar', 'gz', 'udf', 'p7s', 'mp3', 'mp4', 'avi', 'wav', 'mov', 'dwg', 'kml', 'kmz'];
    const normExt = (s) => String(s).toLowerCase().replace(/^[\s.*]+/, '').replace(/[^a-z0-9]/g, '');
    const parseExts = (text) => [...new Set(String(text || '').split(/[\s,;]+/).map(normExt).filter(Boolean))];
    function getAllowedExts() {
        try {
            const a = JSON.parse(store.get(EXT_KEY, 'null'));
            if (Array.isArray(a) && a.length) return a.map(normExt).filter(Boolean);
        } catch (_) { /* varsayılana dön */ }
        return DEFAULT_EXT.slice();
    }
    const fileExt = (f) => { const m = /\.([^.]+)$/.exec(f.name); return m ? normExt(m[1]) : ''; };

    /* ---------- Kota: EBYS'in "X MB Yüklenmiş | Y MB Yüklenebilir" yazısından okunur ---------- */
    const KEP_WARN_MB = 80;       // KEP'te pratikte sorun çıkan sınır
    const DEFAULT_TOTAL_MB = 299; // yazı okunamazsa varsayılan toplam
    // "41,2KB" / "1,5MB" / "812B" gibi yazıyı MB'a çevirir
    function sizeTextToMB(num, unit) {
        const n = parseFloat(String(num).replace(/\./g, '').replace(',', '.'));
        if (!isFinite(n)) return 0;
        const u = unit.toUpperCase();
        return u === 'GB' ? n * 1024 : u === 'MB' ? n : u === 'KB' ? n / 1024 : n / 1048576;
    }

    function readQuota(prefix) {
        const tbl = document.getElementById(prefix.replace(':evrakEkTabView', '') + ':ekListesiDataTable')
            || document.querySelector('.ekListesiDataTable');

        // 1) Yüklü dosyaların satırlarındaki "(41,2KB)" yazılarını topla
        let used = 0;
        tbl?.querySelectorAll('tbody tr[data-ri]').forEach((tr) => {
            const cell = tr.querySelector('button[id$=":indirButton"]')?.closest('td');
            const m = /\(\s*([\d.,]+)\s*(KB|MB|GB|B)\s*\)/i.exec(cell?.textContent || '');
            if (m) used += sizeTextToMB(m[1], m[2]);
        });

        // 2) Toplam kapasite: alt yazıdaki "Yüklenmiş + Yüklenebilir" (yuvarlak olsa da toplam doğru)
        const foot = tbl?.querySelector('.ui-datatable-footer')?.textContent || '';
        const f = (re) => { const m = re.exec(foot); return m ? parseFloat(m[1].replace(',', '.')) : null; };
        const fUsed = f(/([\d.,]+)\s*MB\s*Yüklenmiş/i);
        const fLeft = f(/([\d.,]+)\s*MB\s*Yüklenebilir/i);
        const total = (fUsed !== null && fLeft !== null) ? fUsed + fLeft : DEFAULT_TOTAL_MB;

        return { used, left: Math.max(0, total - used) };
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Her yüklemeden önce EBYS'in "Temizle" butonuna basar ve formun yenilenmesini bekler
    async function clearEkForm(prefix) {
        const btn = document.getElementById(`${prefix}:dosyaTemizleButton`);
        if (!btn) return;
        const panelId = `${prefix}:ekEkleBilgiPanel`;
        const old = document.getElementById(panelId);
        btn.click();
        if (!old) { await sleep(600); return; }
        try { await waitForCondition(document.body, () => document.getElementById(panelId) !== old, 4000); } catch (_) { /* devam et */ }
        await sleep(150);
    }


    function waitForCondition(container, checkFn, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            if (!container) { reject(new Error('gözlemlenecek alan bulunamadı')); return; }
            if (checkFn()) { resolve(); return; }
            const obs = new MutationObserver(() => {
                if (checkFn()) { obs.disconnect(); clearTimeout(timer); resolve(); }
            });
            obs.observe(container, { childList: true, characterData: true, subtree: true });
            const timer = setTimeout(() => { obs.disconnect(); reject(new Error('zaman aşımı')); }, timeoutMs);
        });
    }

    function setEkFileInput(prefix, file) {
        const input = document.getElementById(`${prefix}:fileUploadButtonA_input`);
        if (!input) throw new Error('dosya seçme alanı bulunamadı');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setEkAciklama(prefix, text) {
        const area = document.getElementById(`${prefix}:dosyaAciklama`);
        if (!area) return;
        const val = text.slice(0, 250);
        area.value = val;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        area.dispatchEvent(new Event('change', { bubbles: true }));
        (aciklamaState[`${prefix}:dosyaAciklama`] ||= {}).edited = true;
        (aciklamaState[`${prefix}:dosyaAciklama`] ||= {}).auto = val;
    }

    async function uploadOneFile(prefix, file, customName) {
        const tabPanel = document.body;
        const readLabel = () => document.getElementById(`${prefix}:dosyaAdi`)?.textContent.trim() ?? '';
        await clearEkForm(prefix);          // her dosyadan önce Temizle
        const before = readLabel();

        setEkFileInput(prefix, file);
        await waitForCondition(tabPanel, () => { const now = readLabel(); return now !== '' && now !== before; });

        setEkAciklama(prefix, customName);
        await new Promise((r) => setTimeout(r, 150));

        const ekleBtn = document.getElementById(`${prefix}:dosyaEkleButton`);
        if (!ekleBtn) throw new Error('"Ekle" butonu bulunamadı');
        ekleBtn.click();

        await waitForCondition(tabPanel, () => readLabel() === '');
    }

    async function runMultiUpload(prefix, items, { onRow, onProgress, isStopped } = {}) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].skip) continue;
            if (isStopped?.()) break;
            onRow?.(i, 'busy');
            try {
                await uploadOneFile(prefix, items[i].file, (items[i].name || '').trim() || items[i].file.name.replace(/\.[^.]+$/, ''));
                onRow?.(i, 'ok');
            } catch (err) {
                onRow?.(i, 'err', err.message);
            }
            onProgress?.(i + 1, items.length);
        }
    }





        function openMultiUploadModal(prefix, files) {
        const MB = 1048576;
        const allowed = getAllowedExts();
        const quota = readQuota(prefix);
        const usedB = quota.used * MB, leftB = quota.left * MB, totalB = Math.max(1, usedB + leftB);
        const fmt = (b) => (b >= MB ? `${(b / MB).toFixed(1).replace('.', ',')} MB` : b <= 0 ? '0 MB' : `${Math.max(1, Math.round(b / 1024))} KB`);
        const fmtDate = (t) => (t ? fmtTarih(new Date(t)) : '-');

        let stopped = false, running = false, finished = false, dragId = null, uid = 0;
        const items = [], rejected = [];
        Array.from(files).forEach((file) => {
            if (allowed.includes(fileExt(file))) items.push({ id: ++uid, file, name: file.name.replace(/\.[^.]+$/, ''), status: 'wait', msg: '' });
            else rejected.push(file.name);
        });
        if (!items.length) {
            toast(`Seçilen dosyaların türü izin verilenler arasında değil. İzin verilenler: ${allowed.join(', ')}`, 'error');
            return;
        }

        const ICO_UP = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
        const ICO_DN = '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
        const ICO_X = '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        const ICO_UPLOAD = '<svg viewBox="0 0 24 24"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
        const GRIP = '<svg viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="3" r="1.5"/><circle cx="10" cy="3" r="1.5"/><circle cx="4" cy="9" r="1.5"/><circle cx="10" cy="9" r="1.5"/><circle cx="4" cy="15" r="1.5"/><circle cx="10" cy="15" r="1.5"/></svg>';

        const overlay = el('div', 'ep-overlay ep-overlay-2');
        const modal = el('div', 'ep-modal ep-multi-modal ep-mu');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="ep-mu-head">
                <div class="ep-mu-ico">${ICO_UPLOAD}</div>
                <div class="ep-mu-titles">
                    <h3>Çoklu Dosya Ekle</h3>
                    <p class="ep-sub">Sırayı belirleyin, ek metinlerini düzenleyin ve “Yükle”ye basın. Dosyalar <b>listedeki sırayla</b> eklenir.</p>
                </div>
            </div>
            <div class="ep-mu-quota">
                <div class="ep-mu-stats" id="ep-mu-stats"></div>
                <div class="ep-mu-cap" id="ep-mu-cap"></div>
                <div class="ep-mu-legend"><span class="lu">Mevcut</span><span class="ls">Seçilen</span><span class="lk">KEP uyarı sınırı (${KEP_WARN_MB} MB)</span></div>
            </div>
            <div class="ep-mu-alerts" id="ep-mu-alerts"></div>
            <div class="ep-mu-tools">
                <span class="lbl">Sırala</span>
                <button type="button" class="ep-btn ep-btn-secondary" data-sort="name">Ada göre</button>
                <button type="button" class="ep-btn ep-btn-secondary" data-sort="date">Tarihe göre</button>
                <span class="cnt" id="ep-mu-cnt"></span>
            </div>
            <div class="ep-multi-list" id="ep-mu-list"></div>
            <div class="ep-mu-prog" id="ep-mu-prog" hidden>
                <div class="ep-progress"><i id="ep-multi-bar"></i></div>
                <div class="ep-progress-label" id="ep-multi-label"></div>
            </div>
            <div class="ep-actions">
                <span class="sp" id="ep-mu-hint">Satırları sürükleyerek veya ↑ ↓ ile taşıyabilirsiniz.</span>
                <button type="button" class="ep-btn ep-btn-secondary" id="ep-multi-cancel">Vazgeç</button>
                <button type="button" class="ep-btn ep-btn-primary" id="ep-multi-start"></button>
            </div>`;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const $ = (s) => modal.querySelector(s);
        const listEl = $('#ep-mu-list'), alertsEl = $('#ep-mu-alerts'), statsEl = $('#ep-mu-stats'), capEl = $('#ep-mu-cap'),
              cntEl = $('#ep-mu-cnt'), progBox = $('#ep-mu-prog'), bar = $('#ep-multi-bar'), label = $('#ep-multi-label'),
              hintEl = $('#ep-mu-hint');
        const startBtn = $('#ep-multi-start'), cancelBtn = $('#ep-multi-cancel');

        const totals = () => {
            const selB = items.reduce((a, it) => a + it.file.size, 0);
            return { selB, over: selB > leftB, kep: usedB + selB > KEP_WARN_MB * MB };
        };

        function renderTop() {
            const { selB, over, kep } = totals();
            statsEl.innerHTML = `
                <div class="ep-mu-stat"><b>${fmt(usedB)}</b><span>Sistemde mevcut yüklü</span></div>
                <div class="ep-mu-stat"><b>${fmt(selB)}</b><span>Seçilen (${items.length} dosya)</span></div>
                <div class="ep-mu-stat${over ? ' bad' : ''}"><b>${over ? `${fmt(selB - leftB)} aşım` : fmt(leftB - selB)}</b>
                    <span>${over ? 'Kapasite aşıldı' : `Kalan kapasite (toplam ${fmt(totalB)})`}</span></div>`;

            const uP = Math.min(100, usedB / totalB * 100);
            const sP = Math.min(100 - uP, selB / totalB * 100);
            const kP = KEP_WARN_MB * MB / totalB * 100;
            capEl.className = 'ep-mu-cap' + (over ? ' over' : kep ? ' kep' : '');
            capEl.innerHTML = `<i class="u" style="width:${uP}%"></i><i class="s" style="width:${sP}%"></i>${kP < 100 ? `<b title="KEP uyarı sınırı" style="left:${kP}%"></b>` : ''}`;

            let al = '';
            if (over) al += `<div class="ep-mu-al err">⛔ Seçilen dosyalar (<b>${fmt(selB)}</b>) kalan kapasiteyi (<b>${fmt(leftB)}</b>) <b>${fmt(selB - leftB)}</b> aşıyor. Listeden dosya çıkarın; aşım giderilmeden yükleme yapılamaz.</div>`;
            if (kep) al += `<div class="ep-mu-al warn">⚠️ Evrakın toplam ek boyutu <b>${fmt(usedB + selB)}</b> olacak. KEP sınırı 100 MB olsa da ${KEP_WARN_MB} MB üzerinde sorun çıkabildiği için <b>KEP ile gönderilmeyebilir</b>.</div>`;
            if (rejected.length) {
                const shown = rejected.slice(0, 5).map(esc).join(', ') + (rejected.length > 5 ? ` ve ${rejected.length - 5} dosya daha` : '');
                al += `<div class="ep-mu-al info">ℹ️ Türü desteklenmediği için listeye alınmayan ${rejected.length} dosya: ${shown}.<br>İzin verilen uzantılar: <b>${esc(allowed.join(', '))}</b></div>`;
            }
            alertsEl.innerHTML = al;
            cntEl.textContent = `${items.length} dosya · ${fmt(selB)}`;
            updateButtons();
        }

        function updateButtons() {
            if (finished || !startBtn.isConnected) return;
            const { over } = totals();
            startBtn.innerHTML = `${ICO_UPLOAD}<span>Yükle (${items.length})</span>`;
            startBtn.disabled = running || over || !items.length;
            modal.querySelectorAll('[data-sort]').forEach((b) => { b.disabled = running; });
        }

        const STATUS_TXT = { wait: 'Bekliyor', busy: 'Yükleniyor', ok: 'Eklendi', err: 'Hata' };

        function move(i, d) {
            const j = i + d;
            if (j < 0 || j >= items.length) return;
            [items[i], items[j]] = [items[j], items[i]];
            const id = items[j].id;
            renderRows();
            listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
        }

        function renderRows() {
            const locked = running || finished;
            listEl.innerHTML = '';
            items.forEach((it, i) => {
                const row = el('div', 'ep-multi-row ep-mu-row' + (it.status === 'busy' ? ' ep-multi-active' : ''));
                row.dataset.id = it.id;
                row.innerHTML = `
                    <span class="ep-mu-no">${i + 1}</span>
                    <span class="ep-mg-grip" title="Sürükleyerek taşı">${GRIP}</span>
                    <span class="ep-mu-ext">${esc(fileExt(it.file) || '?')}</span>
                    <div class="ep-mu-main">
                        <input type="text" value="${esc(it.name)}" maxlength="250" ${locked ? 'disabled' : ''} aria-label="Ek metni">
                        <div class="ep-mu-meta" title="${esc(it.file.name)}">${esc(it.file.name)} · ${fmt(it.file.size)} · ${fmtDate(it.file.lastModified)}</div>
                    </div>
                    <span class="ep-multi-status ${it.status}" ${it.msg ? `title="${esc(it.msg)}"` : ''}>${STATUS_TXT[it.status]}</span>
                    <div class="ep-mu-btns">
                        <button type="button" class="ep-icon-btn" data-a="up" title="Yukarı taşı" aria-label="Yukarı taşı" ${locked || i === 0 ? 'disabled' : ''}>${ICO_UP}</button>
                        <button type="button" class="ep-icon-btn" data-a="dn" title="Aşağı taşı" aria-label="Aşağı taşı" ${locked || i === items.length - 1 ? 'disabled' : ''}>${ICO_DN}</button>
                        <button type="button" class="ep-icon-btn ep-icon-btn-danger" data-a="del" title="Listeden çıkar" aria-label="Listeden çıkar" ${locked ? 'disabled' : ''}>${ICO_X}</button>
                    </div>`;

                row.querySelector('input').addEventListener('input', (e) => { it.name = e.target.value; });
                row.querySelector('[data-a="up"]').onclick = () => move(i, -1);
                row.querySelector('[data-a="dn"]').onclick = () => move(i, 1);
                row.querySelector('[data-a="del"]').onclick = () => { items.splice(i, 1); renderRows(); renderTop(); };

                // Sürükle-bırak (yalnızca tutamaçtan başlar; ad kutusunda metin seçimi bozulmaz)
                const grip = row.querySelector('.ep-mg-grip');
                grip.addEventListener('mousedown', () => { if (!locked) row.draggable = true; });
                grip.addEventListener('mouseup', () => { row.draggable = false; });
                row.addEventListener('dragstart', (e) => { dragId = it.id; row.classList.add('ep-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(it.id)); });
                row.addEventListener('dragend', () => { dragId = null; row.draggable = false; listEl.querySelectorAll('.ep-dragging,.ep-drop-before,.ep-drop-after').forEach((n) => n.classList.remove('ep-dragging', 'ep-drop-before', 'ep-drop-after')); });
                row.addEventListener('dragover', (e) => {
                    if (dragId == null || dragId === it.id) return;
                    e.preventDefault();
                    const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                    row.classList.toggle('ep-drop-after', after);
                    row.classList.toggle('ep-drop-before', !after);
                });
                row.addEventListener('dragleave', () => row.classList.remove('ep-drop-before', 'ep-drop-after'));
                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (dragId == null || dragId === it.id) return;
                    const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                    const from = items.findIndex((x) => x.id === dragId);
                    if (from < 0) return;
                    const [moved] = items.splice(from, 1);
                    let to = items.findIndex((x) => x.id === it.id);
                    if (after) to++;
                    items.splice(to, 0, moved);
                    renderRows();
                });
                listEl.appendChild(row);
            });
            if (!items.length) listEl.appendChild(el('div', 'ep-mgr-empty', 'Listede dosya kalmadı. Pencereyi kapatıp yeniden dosya seçin.'));
        }

        const byName = (a, b) => a.file.name.localeCompare(b.file.name, 'tr', { numeric: true, sensitivity: 'base' });
        // Her buton kendi yönünü hatırlar; tıklayınca yön değişir.
        const SORTS = {
            name: { dir: 0, labels: ['A → Z', 'Z → A'],
                    cmp: (d) => (a, b) => d * byName(a, b) },
            date: { dir: 0, labels: ['Önce yeni', 'Önce eski'],
                    cmp: (d) => (a, b) => d * (a.file.lastModified - b.file.lastModified) || byName(a, b) },
        };
        // name: dir 0 → A-Z (d=1), dir 1 → Z-A (d=-1)
        // date: dir 0 → önce yeni (d=-1), dir 1 → önce eski (d=1)
        const sortDir = (key, dir) => (key === 'name' ? (dir === 0 ? 1 : -1) : (dir === 0 ? -1 : 1));

        modal.querySelectorAll('[data-sort]').forEach((b) => {
            const key = b.dataset.sort, s = SORTS[key];
            const base = key === 'name' ? 'Ada göre' : 'Tarihe göre';
            b.onclick = () => {
                if (running) return;
                items.sort(s.cmp(sortDir(key, s.dir)));
                b.textContent = `${base}: ${s.labels[s.dir]}`;
                s.dir = 1 - s.dir;                       // sonraki tıklamada ters yön
                // diğer butonun yönünü ve yazısını sıfırla
                modal.querySelectorAll('[data-sort]').forEach((o) => {
                    if (o === b) return;
                    SORTS[o.dataset.sort].dir = 0;
                    o.textContent = o.dataset.sort === 'name' ? 'Ada göre' : 'Tarihe göre';
                });
                renderRows();
            };
        });

        const onKey = (e) => { if (e.key === 'Escape' && !running) close(); };
        function close() { document.removeEventListener('keydown', onKey, true); overlay.remove(); }
        document.addEventListener('keydown', onKey, true);

        cancelBtn.onclick = () => {
            if (running) { stopped = true; cancelBtn.disabled = true; cancelBtn.textContent = 'Durduruluyor…'; }
            else close();
        };

        startBtn.onclick = async () => {
            const { over } = totals();
            if (running || over || !items.length) return;
            running = true; stopped = false;
            cancelBtn.textContent = 'Durdur';
            hintEl.textContent = 'Yükleniyor… lütfen pencereyi kapatmayın.';
            progBox.hidden = false;
            bar.style.width = '0%';
            label.textContent = `0 / ${items.length}`;
            renderRows(); updateButtons();

            await runMultiUpload(prefix, items, {
                isStopped: () => stopped,
                onRow: (i, status, msg) => { items[i].status = status; items[i].msg = msg || ''; renderRows(); },
                onProgress: (done, total) => {
                    bar.style.width = `${(done / total) * 100}%`;
                    label.textContent = `${done} / ${total}`;
                },
            });

            running = false; finished = true;
            const okN = items.filter((x) => x.status === 'ok').length;
            const errN = items.filter((x) => x.status === 'err').length;
            toast(stopped ? 'Çoklu ekleme durduruldu.' : errN ? `${okN} dosya eklendi, ${errN} dosyada hata oluştu.` : 'Çoklu dosya ekleme tamamlandı.',
                  stopped || errN ? 'info' : 'success');
            hintEl.textContent = stopped ? 'Yükleme durduruldu.' : `${okN} dosya eklendi${errN ? `, ${errN} hata` : ''}.`;
            startBtn.remove();                         // Yükle butonu kalkar
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Kapat';
            cancelBtn.className = 'ep-btn ep-btn-primary';
            cancelBtn.onclick = close;
            renderRows(); renderTop();
        };

        renderRows(); renderTop();
        setTimeout(() => startBtn.focus(), 30);
    }
















    function pickMultipleFiles(prefix) {
        let picker = document.getElementById('ep-multi-picker');
        if (!picker) {
            picker = el('input');
            picker.type = 'file';
            picker.id = 'ep-multi-picker';
            picker.multiple = true;
            picker.hidden = true;
            document.body.appendChild(picker);
        }
        picker.value = '';
        picker.accept = getAllowedExts().map((e) => `.${e}`).join(',');   // yalnızca izinli uzantılar seçilebilir
        picker.onchange = () => { if (picker.files.length) openMultiUploadModal(prefix, picker.files); };
        picker.click();
    }

    function syncMultiUploadButton() {
        EK_UPLOAD_PREFIXES.forEach((prefix) => {
            const btnId = `ep-multi-btn-${prefix.replace(/[^a-zA-Z0-9]/g, '')}`;
            const ekleBtn = document.getElementById(`${prefix}:dosyaEkleButton`);
            const existing = document.getElementById(btnId);
            if (!ekleBtn) { existing?.remove(); return; }
            if (existing) return;
            const btn = el('button', 'ep-btn ep-btn-secondary ep-multi-btn',
                '<svg viewBox="0 0 24 24"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg><span>Çoklu Dosya Ekle</span>');
            btn.type = 'button';
            btn.id = btnId;
            btn.onclick = (e) => { e.preventDefault(); pickMultipleFiles(prefix); };
            ekleBtn.parentElement.insertBefore(btn, ekleBtn);
        });
    }

    /* ============================ Şablon Plus ============================
       Her şablon: { id, text, fields:[{id,label,value}], content, builtin }
       content içinde {{alanId}} yer tutucuları, oluşturma sırasında girilen
       değerlerle (HTML-güvenli biçimde) değiştirilir. {{TAB}} sabit girinti
       görselini ekler. */

    const TAB = '<img data-cke-saved-src="/edys-web/images/blankTab.png" src="/edys-web/images/blankTab.png" style="height:1px;width:46px">';
    const bugun = () => { const t = new Date(); return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`; };

    const AY = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    const GUN = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtTarih = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

    function gunEkle(n, isGunu) {
        const d = new Date();
        if (!isGunu) { d.setDate(d.getDate() + n); return d; }
        const adim = n < 0 ? -1 : 1;
        let kalan = Math.abs(n);
        while (kalan > 0) { d.setDate(d.getDate() + adim); if (d.getDay() !== 0 && d.getDay() !== 6) kalan--; }
        return d;
    }

    const OZEL_SABIT = {
        BUGUN:      { label: '📅 Bugünün tarihi',   val: (d) => fmtTarih(d) },
        BUGUN_UZUN: { label: '📅 Uzun tarih',       val: (d) => `${d.getDate()} ${AY[d.getMonth()]} ${d.getFullYear()}` },
        GUN_ADI:    { label: '📅 Gün adı',          val: (d) => GUN[d.getDay()] },
        AY_ADI:     { label: '📅 Ay adı',           val: (d) => AY[d.getMonth()] },
        YIL:        { label: '📅 Yıl',              val: (d) => String(d.getFullYear()) },
        SAAT:       { label: '🕒 Saat',             val: (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}` },
        AY_BASI:    { label: '📅 Bu ayın ilk günü', val: (d) => fmtTarih(new Date(d.getFullYear(), d.getMonth(), 1)) },
        AY_SONU:    { label: '📅 Bu ayın son günü', val: (d) => fmtTarih(new Date(d.getFullYear(), d.getMonth() + 1, 0)) },
        GECEN_YIL:  { label: '📅 Geçen yıl',        val: (d) => String(d.getFullYear() - 1) },
    };
    const OZEL_MENU = [
        { grup: 'Tarih ve saat', ids: ['BUGUN', 'BUGUN_UZUN', 'GUN_ADI', 'AY_ADI', 'YIL', 'SAAT'] },
        { grup: 'Süre hesabı (bugün + …)', ids: ['BUGUN_P7', 'BUGUN_P15', 'BUGUN_P30', 'ISGUNU_P5', 'ISGUNU_P10', 'ISGUNU_P15', 'ISGUNU_P30'] },
        { grup: 'Dönem', ids: ['AY_BASI', 'AY_SONU', 'GECEN_YIL'] },
    ];
    // Örnekler: {{BUGUN_P7}} = bugün + 7 gün, {{ISGUNU_P15}} = bugün + 15 iş günü, {{BUGUN_M3}} = bugün - 3 gün
    function ozelDeger(id) {
        if (OZEL_SABIT[id]) return OZEL_SABIT[id].val(new Date());
        const m = /^(BUGUN|ISGUNU)_([PM])(\d{1,4})$/.exec(id);
        if (!m) return null;
        return fmtTarih(gunEkle(Number(m[3]) * (m[2] === 'M' ? -1 : 1), m[1] === 'ISGUNU'));
    }
    function ozelEtiket(id) {
        if (OZEL_SABIT[id]) return OZEL_SABIT[id].label;
        const m = /^(BUGUN|ISGUNU)_([PM])(\d{1,4})$/.exec(id);
        return m ? `📅 Bugün ${m[2] === 'P' ? '+' : '−'} ${m[3]} ${m[1] === 'ISGUNU' ? 'iş günü' : 'gün'}` : id;
    }

    const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
    function slugify(s) {
        return String(s || '').toLocaleLowerCase('tr').split('').map((ch) => TR_MAP[ch] ?? ch).join('')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'alan';
    }
    const genId = (p = 't') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    function uniqueFieldId(fields, base) {
        base = base || 'alan';
        let id = base, n = 1;
        while (fields.some((f) => f.id === id)) id = `${base}_${++n}`;
        return id;
    }

    function sanitizeHTML(html) {
        const t = document.createElement('template');
        t.innerHTML = String(html ?? '');
        t.content.querySelectorAll('script,iframe,object,embed,link,meta,style,base,form').forEach((n) => n.remove());
        t.content.querySelectorAll('*').forEach((n) => {
            Array.from(n.attributes).forEach((a) => {
                const name = a.name.toLowerCase();
                if (name.startsWith('on') ||
                    (['href', 'src', 'xlink:href', 'formaction'].includes(name) && /^\s*(javascript:|data:text\/html)/i.test(a.value))) {
                    n.removeAttribute(a.name);
                }
            });
        });
        return t.innerHTML;
    }

    // Not: yalnızca id/label/value saklanır; editördeki geçici _auto bayrağı burada kendiliğinden elenir.
    function normalizeTemplate(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const text = String(raw.text || '').trim();
        const content = String(raw.content ?? '');
        if (!text || !content) return null;
        const fields = [];
        if (Array.isArray(raw.fields)) {
            raw.fields.forEach((f) => {
                if (!f || typeof f !== 'object') return;
                const label = String(f.label || '').trim();
                if (!label) return;
                let id = String(f.id || slugify(label)).replace(/[^a-zA-Z0-9_]/g, '_') || slugify(label);
                id = uniqueFieldId(fields, id);
                fields.push({ id, label, value: String(f.value ?? '') });
            });
        }
        return { id: String(raw.id || genId()), text, fields, content, builtin: !!raw.builtin,
                category: String(raw.category || '').trim(), fav: !!raw.fav };
    }

    function catName(t) { return t.category || 'Genel'; }

    function renderContent(tpl, values) {
        return String(tpl.content || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, id) => {
            if (id === 'TAB') return TAB;
            { const o = ozelDeger(id); if (o !== null) return o; }
            return esc(Object.prototype.hasOwnProperty.call(values, id) ? values[id] : '');
        });
    }

    const DEFAULT_TEMPLATES = [
        {
            id: 'builtin_adres', builtin: true, text: 'Adres Kaydı', fields: [],
            content: `<p>{{TAB}}İlgi sayılı yazınızda, belirtilen İlgili kişiye ait adres bilgisi istenilmiş olup; <em><strong>Adres bilgilerinin kullanımından kaynaklı gizlilik kurallarına uyulması ve adres bilgisinin kullanımından kaynaklı hukuki sorumluluk&nbsp; Müdürlüğünüze ait olmak üzere </strong></em>istenilen bilgiler ilişikte sunulmuştur. Bilgilerinize arz olunur.</p>`,
        },
        {
            id: 'builtin_belediye_bagis', builtin: true, text: 'Belediye Bağış',
            fields: [
                { id: 'il', label: 'İl', value: 'Gaziantep' }, { id: 'ilce', label: 'İlçe', value: 'Nurdağı' },
                { id: 'mahalle', label: 'Mahalle', value: 'Yeni Mahallesi' }, { id: 'ada', label: 'Ada', value: '347' },
                { id: 'parsel', label: 'Parsel', value: '3460' }, { id: 'm2', label: 'M²', value: '136,64' },
                { id: 'hisse', label: 'Hisseli M²', value: '68,32' },
            ],
            content: `<p>{{TAB}}Aşağıya tapu kaydı çıkartılan {{il}} ili, {{ilce}} İlçesi, <em><strong>{{mahalle}}, {{ada}} Ada {{parsel}} parsel</strong></em> sayılı <em><strong>{{m2}} m²</strong></em> miktarındaki <em><strong>Avlulu Kargir Ev</strong></em> nitelikli gayrımenkulün <em><strong>hisseli Bağış</strong></em> esas olmak üzere;</p>
<p style="margin-left:20.95pt;text-align:justify">a) Üzerinde yapılaşma olup, olmadığının üzerinde yapılaşma mevcut ise 2981/3290 sayılı yasa kapsamında kalıp kalmadığının;</p>
<p style="margin-left:20.95pt;text-align:justify">b) Belediye hudutları veya mücavir alan dahilinde kalıp kalmadığının ve imar parseli olup olmadığının;</p>
<p style="margin-left:20.95pt;text-align:justify">c) İş bu taşınmaz malın imar planı (Nazım imar planı, uygulama imar planı) veya bölge planı ya da çevre düzeni planı kapsamında kalıp kalmadığının;</p>
<p style="margin-left:20.95pt;text-align:justify">d) Plan kapsamında kalmakta ise hangi amaca tahsis edildiğinin;</p>
<p style="margin-left:18pt;text-align:justify">e) Malik iş bu taşınmazda bulunan <em><strong>{{m2}}</strong></em> m² olan mülkiyetinin, <em><strong>{{hisse}} m²</strong></em> kısmının hisselendirerek <em><strong>Bağış yapılmasında</strong></em> sakınca olup olmadığının; Müdürlüğümüze bildirilmesini arz ederim.</p>`,
        },
        {
            id: 'builtin_hisseli_satis', builtin: true, text: 'Hisseli Satış',
            fields: [
                { id: 'il', label: 'İl', value: 'Gaziantep' }, { id: 'ilce', label: 'İlçe', value: 'Nurdağı' },
                { id: 'mahalle', label: 'Mahalle', value: 'Yeni Mahallesi' }, { id: 'ada', label: 'Ada', value: '347' },
                { id: 'parsel', label: 'Parsel', value: '3460' }, { id: 'm2', label: 'M²', value: '136,64' },
                { id: 'hisse', label: 'Hisseli M²', value: '68,32' },
            ],
            content: `<p>{{TAB}}Aşağıya tapu kaydı çıkartılan {{il}} ili, {{ilce}} İlçesi, <em><strong>{{mahalle}}, {{ada}} Ada {{parsel}} parsel</strong></em> sayılı <em><strong>{{m2}} m²</strong></em> miktarındaki <em><strong>Avlulu Kargir Ev</strong></em> nitelikli gayrımenkulün <em><strong>hisseli Satış</strong></em> esas olmak üzere;</p>
<p style="margin-left:20.95pt;text-align:justify">a) Üzerinde yapılaşma olup, olmadığının üzerinde yapılaşma mevcut ise 2981/3290 sayılı yasa kapsamında kalıp kalmadığının;</p>
<p style="margin-left:20.95pt;text-align:justify">b) Belediye hudutları veya mücavir alan dahilinde kalıp kalmadığının ve imar parseli olup olmadığının;</p>
<p style="margin-left:20.95pt;text-align:justify">c) İş bu taşınmaz malın imar planı (Nazım imar planı, uygulama imar planı) veya bölge planı ya da çevre düzeni planı kapsamında kalıp kalmadığının;</p>
<p style="margin-left:20.95pt;text-align:justify">d) Plan kapsamında kalmakta ise hangi amaca tahsis edildiğinin;</p>
<p style="margin-left:18pt;text-align:justify">e) Malik iş bu taşınmazda bulunan <em><strong>{{m2}}</strong></em> m² olan mülkiyetinin, <em><strong>{{hisse}} m²</strong></em> kısmının hisselendirerek <em><strong>Satış yapılmasında</strong></em> sakınca olup olmadığının; Müdürlüğümüze bildirilmesini arz ederim.</p>`,
        },
        {
            id: 'builtin_kanuni_ipotek', builtin: true, text: 'Kanuni İpotek',
            fields: [
                { id: 'il', label: 'İl', value: 'Gaziantep' }, { id: 'ilce', label: 'İlçe', value: 'Nurdağı' },
                { id: 'mahalle', label: 'Mahalle', value: 'Şatırhüyük' }, { id: 'ada', label: 'Ada', value: '321' },
                { id: 'parsel', label: 'Parsel', value: '123' }, { id: 'borclu', label: 'Borçlu', value: 'Ahmet Yılmaz' },
                { id: 'tarih', label: 'Tarih', value: '@today' }, { id: 'yevmiye', label: 'Yevmiye', value: '4567' },
            ],
            content: `<p>{{TAB}}İlgi yazıda bahsi geçen {{il}} ili, {{ilce}} ilçesi, {{mahalle}} Mahallesinde bulunan {{ada}} Ada {{parsel}} Parsel sayılı taşınmazda Malik olan; {{borclu}} adına kayıtlı taşınmaz hissesi üzerine <em><strong>{{tarih}} Tarih {{yevmiye}} Yevmiye </strong></em>numarası alınarak&nbsp; kanuni ipotek tesis edilip, ipotek belgesi ilişikte sunulmuştur. Bilgilerinize arz ederim.</p>`,
        },
        {
            id: 'builtin_mimari_proje', builtin: true, text: 'Mimari Proje',
            fields: [
                { id: 'il', label: 'İl', value: 'Gaziantep' }, { id: 'ilce', label: 'İlçe', value: 'Nurdağı' },
                { id: 'mahalle', label: 'Mahalle', value: 'Başpınar' }, { id: 'ada', label: 'Ada', value: '809' },
                { id: 'parsel', label: 'Parsel', value: '4' }, { id: 'eski', label: 'Eski', value: '110/23' },
            ],
            content: `<p>{{TAB}}İlgi yazıda belirtilen {{il}} ili, {{ilce}} ilçesi, {{mahalle}} Mahallesi, {{ada}} Ada {{parsel}} Parsel(Eski:{{eski}}) sayılı taşınmaza ait Mimari Proje ilişikte sunulmuştur. Bilgilerinize arz olunur.</p>`,
        },
        {
            id: 'builtin_mimari_proje_atkm', builtin: true, text: 'Mimari Proje At-Km',
            fields: [
                { id: 'il', label: 'İl', value: 'Gaziantep' }, { id: 'ilce', label: 'İlçe', value: 'Nurdağı' },
                { id: 'mahalle', label: 'Mahalle', value: 'Başpınar' }, { id: 'ada', label: 'Ada', value: '810' },
                { id: 'parsel', label: 'Parsel', value: '4' },
            ],
            content: `<p>{{TAB}}İlgi yazıda belirtilen {{il}} ili, {{ilce}} ilçesi, {{mahalle}} Mahallesi, {{ada}} Ada {{parsel}} Parsel sayılı taşınmazın Ana Taşınmaz vasfında olduğu herhangi bir Kat Mülkiyeti veya İrtifakı kurulmadığı sebebiyle Mimari Proje Kaydına <em><strong>rastlanılamamıştır</strong></em>. Bilgilerinize arz olunur.</p>`,
        },
    ];

    function loadTemplates() {
        const raw = store.get(KEYS.templates, '');
        if (raw) {
            try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    const norm = arr.map(normalizeTemplate).filter(Boolean);
                    if (norm.length || arr.length === 0) return norm;
                }
            } catch (_) { /* bozuksa varsayılana dön */ }
        }
        const defaults = DEFAULT_TEMPLATES.map(normalizeTemplate).filter(Boolean);
        saveTemplates(defaults);
        return defaults;
    }
    function saveTemplates(list) {
        if (!store.set(KEYS.templates, JSON.stringify(list))) {
            toast('Şablonlar kaydedilemedi (depolama alanı dolu olabilir).', 'error');
            return false;
        }
        return true;
    }

    function findEditor() {
        let body = null;
        document.querySelectorAll('iframe').forEach((f) => {
            if (!f.getClientRects().length) return;   // gizli pencereyi atla
            try { body = f.contentDocument?.querySelector('body[role="textbox"][contenteditable="true"].cke_editable') || body; }
            catch (_) { /* farklı origin */ }
        });
        return body;
    }

    function insertHTML(html) {
        const body = findEditor();
        if (!body) { toast('Editör alanı bulunamadı. Önce cevap evrakı ekranını açın.', 'error'); return; }
        const ck = window.CKEDITOR;
        const inst = ck && Object.values(ck.instances || {}).find((i) => { try { return i.document && i.document.$ === body.ownerDocument; } catch (_) { return false; } });
        if (inst) inst.setData(html);
        else {
            body.innerHTML = html;
            body.dispatchEvent(new Event('input', { bubbles: true }));
            body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
    }

    async function runTemplate(tpl) {
        if (!findEditor()) { toast('Editör alanı bulunamadı. Önce cevap evrakı ekranını açın.', 'error'); return; }
        if (!tpl.fields.length) { insertHTML(renderContent(tpl, {})); return; }
        const fields = tpl.fields.map((f) => ({ ...f, required: false, noTag: true, placeholder: `${f.label} yazın`, value: f.value === '@today' ? bugun() : f.value }));
        const v = await runWizard([{
            title: tpl.text,
            subtitle: 'Bilgileri kontrol edin, gerekirse değiştirin. Yazdıklarınız metindeki yerlerine otomatik yerleşir.',
            grid: true,
            fields,
        }], { submitLabel: 'Yazıya Ekle', modalClass: 'ep-modal-form' });
        if (!v) return;
        insertHTML(renderContent(tpl, v));
    }

    let closeTimer = null;
    const closeMenu = () => {
        document.getElementById('ep-template-menu')?.remove();
        document.getElementById('ep-template-sub')?.remove();
        document.getElementById('ep-template-btn')?.setAttribute('aria-expanded', 'false');
    };
    const scheduleClose = () => { clearTimeout(closeTimer); closeTimer = setTimeout(closeMenu, 600); };

    function openTemplateMenu(btn) {
        clearTimeout(closeTimer);
        if (document.getElementById('ep-template-menu')) return;
        btn.setAttribute('aria-expanded', 'true');
        const rect = btn.getBoundingClientRect();
        const menu = el('div');
        menu.id = 'ep-template-menu';
        menu.style.top = `${rect.bottom - 1}px`;
        menu.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 300))}px`;

        const search = el('input');
        search.type = 'text'; search.placeholder = 'Şablon veya kategori ara…'; search.setAttribute('aria-label', 'Şablon ara');
        const listBox = el('div');
        const manage = el('div', 'ep-cm-item ep-cm-manage', '<span class="ep-cm-name">✏️ Şablonları düzenle</span>');
        manage.tabIndex = 0;
        const goManage = () => { closeMenu(); openTemplateManager(); };
        manage.onclick = goManage;
        manage.onkeydown = (e) => { if (e.key === 'Enter') goManage(); };
        manage.addEventListener('mouseenter', () => closeSub());
        const manageWrap = el('div');
        manageWrap.append(el('div', 'ep-cm-sep'), manage);
        menu.append(search, listBox, manageWrap);

        const lower = (s) => String(s).toLocaleLowerCase('tr');
        const hl = (text, q) => {
            const i = (q && lower(text).length === text.length) ? lower(text).indexOf(q) : -1;
            if (i < 0) return esc(text);
            return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
        };

        let sub = null, activeCat = null;
        const rowMap = new Map();

        const closeSub = () => {
            sub?.remove(); sub = null; activeCat = null;
            menu.querySelectorAll('.ep-cm-item.active').forEach((n) => n.classList.remove('active'));
        };

        const mkItem = (tpl, q = '') => {
            const it = el('div', 'ep-tpl-item');
            it.tabIndex = 0;
            it.innerHTML = `<span class="ep-tpl-name">${hl(tpl.text, q)}</span>
                ${tpl.fields.length ? `<span class="ep-tpl-tag">${tpl.fields.length} alan</span>` : ''}
                <button type="button" class="ep-star${tpl.fav ? ' on' : ''}" title="${tpl.fav ? 'Öne çıkanlardan kaldır' : 'Öne çıkar'}" aria-label="Öne çıkar">${tpl.fav ? '★' : '☆'}</button>`;
            const go = () => { closeMenu(); runTemplate(tpl); };
            it.onclick = (e) => { if (!e.target.closest('.ep-star')) go(); };
            it.onkeydown = (e) => { if (e.key === 'Enter') go(); };
            it.querySelector('.ep-star').onclick = (e) => {
                e.stopPropagation();
                tpl.fav = !tpl.fav;
                saveTemplates(EP.templates);
                render(activeCat);
            };
            return it;
        };

        const openSub = (rowEl, cat, arr) => {
            if (sub && activeCat === cat) return;
            closeSub();
            activeCat = cat;
            rowEl.classList.add('active');
            sub = el('div');
            sub.id = 'ep-template-sub';
            if (!arr.length) {
                sub.appendChild(el('div', 'ep-tpl-empty', 'Henüz öne çıkan şablon yok. Diğer kategorilerde şablonun yanındaki ☆ simgesine tıklayın.'));
            } else {
                arr.forEach((t) => sub.appendChild(mkItem(t)));
            }
            sub.addEventListener('mouseenter', () => clearTimeout(closeTimer));
            sub.addEventListener('mouseleave', scheduleClose);
            document.body.appendChild(sub);

            const r = rowEl.getBoundingClientRect();
            const sw = sub.offsetWidth, sh = sub.offsetHeight;
            let left = r.right - 2;
            if (left + sw > window.innerWidth - 4) left = Math.max(4, r.left - sw - 2);
            let top = r.top - 6;
            top = Math.max(4, Math.min(top, window.innerHeight - sh - 8));
            sub.style.left = `${left}px`;
            sub.style.top = `${top}px`;
        };

        const mkCatRow = (label, count, cat, arr, cls = '') => {
            const row = el('div', `ep-cm-item ${cls}`.trim(),
                `<span class="ep-cm-name">${label}</span><span class="ep-cm-count">${count}</span><span class="ep-cm-arrow">›</span>`);
            row.tabIndex = 0;
            let hoverT = 0;
            row.addEventListener('mouseenter', () => {
                clearTimeout(hoverT);
                hoverT = setTimeout(() => openSub(row, cat, arr), sub ? 140 : 0);
            });
            row.addEventListener('mouseleave', () => clearTimeout(hoverT));
            row.addEventListener('click', () => openSub(row, cat, arr));
            row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'ArrowRight') openSub(row, cat, arr); });
            rowMap.set(cat, { row, arr });
            return row;
        };

        function render(keepCat = null) {
            const q = lower(search.value).trim();
            closeSub();
            rowMap.clear();
            listBox.innerHTML = '';
            if (!EP.templates.length) {
                listBox.appendChild(el('div', 'ep-tpl-empty', 'Henüz şablon yok. EBYS Plus panelinden ekleyebilirsiniz.'));
                return;
            }
            const groups = new Map();
            EP.templates.forEach((t) => { const c = catName(t); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(t); });

            if (!q) {
                const favs = EP.templates.filter((t) => t.fav);
                listBox.appendChild(mkCatRow('⭐ Öne Çıkanlar', favs.length, '__fav', favs, 'ep-cm-fav'));
                listBox.appendChild(el('div', 'ep-cm-sep'));
                groups.forEach((arr, cat) => listBox.appendChild(mkCatRow(`📁 ${esc(cat)}`, arr.length, cat, arr)));
                if (keepCat && rowMap.has(keepCat)) {
                    const { row, arr } = rowMap.get(keepCat);
                    openSub(row, keepCat, arr);
                }
            } else {
                let shown = 0;
                groups.forEach((arr, cat) => {
                    const catHit = lower(cat).includes(q);
                    const hits = catHit ? arr : arr.filter((t) => lower(t.text).includes(q));
                    if (!hits.length) return;
                    shown += hits.length;
                    listBox.appendChild(el('div', 'ep-tm-head', `📁 ${hl(cat, q)}`));
                    const wrap = el('div', 'ep-tm-sub');
                    hits.forEach((t) => wrap.appendChild(mkItem(t, catHit ? '' : q)));
                    listBox.appendChild(wrap);
                });
                if (!shown) listBox.appendChild(el('div', 'ep-tpl-empty', 'Sonuç yok'));
            }
        }

        search.addEventListener('input', () => render());
        search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
        search.addEventListener('focus', closeSub);
        menu.addEventListener('mouseenter', () => clearTimeout(closeTimer));
        menu.addEventListener('mouseleave', scheduleClose);
        document.body.appendChild(menu);
        render();
        setTimeout(() => search.focus(), 10);
    }

    const TEMPLATE_BTN_REFS = [
        'windowCevapEvrakForm:cevapEvrakTabMenuRight:cevapEvrakTabMenuRight',
        'inboxItemInfoForm:dialogTabMenuRight:dialogTabMenuRight',
        'yeniGidenEvrakForm:rightTab:rightTab',
    ];

    function syncTemplateButton() {
        const ref = TEMPLATE_BTN_REFS.map((id) => document.getElementById(id)).find(Boolean);
        const existing = document.getElementById('ep-template-btn');
        if (!ref) { if (existing) { existing.remove(); closeMenu(); } return; }
        if (existing) return;

        const btn = el('button', '', 'Şablon Plus');
        btn.id = 'ep-template-btn';
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('mouseenter', () => openTemplateMenu(btn));
        btn.addEventListener('mouseleave', scheduleClose);
        btn.addEventListener('click', (e) => { e.preventDefault(); openTemplateMenu(btn); });
        ref.parentNode.insertBefore(btn, ref.nextSibling);
    }

    /* ------------------------- Şablon Yönetim Paneli ------------------------- */

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.dispatchEvent(new Event('input'));
    }

    function confirmChoice(title, subtitle, options) {
        return new Promise((resolve) => {
            const overlay = el('div', 'ep-overlay ep-overlay-2');
            const modal = el('div', 'ep-modal');
            modal.style.width = '380px';
            modal.innerHTML = `<h3>${esc(title)}</h3><p class="ep-sub">${esc(subtitle)}</p>
                <div class="ep-actions" style="flex-direction:column"></div>`;
            const box = modal.querySelector('.ep-actions');
            options.forEach((o) => {
                const b = el('button', `ep-btn ${o.primary ? 'ep-btn-primary' : 'ep-btn-secondary'}`, esc(o.label));
                b.type = 'button';
                b.onclick = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(o.key); };
                box.appendChild(b);
            });
            const cancelBtn = el('button', 'ep-btn ep-btn-secondary', 'Vazgeç');
            cancelBtn.type = 'button';
            cancelBtn.onclick = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve('cancel'); };
            box.appendChild(cancelBtn);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve('cancel'); } };
            document.addEventListener('keydown', onKey, true);
        });
    }

    function openTemplateEditor(existing) {
        return new Promise((resolve) => {
            const isNew = !existing;
            const working = existing
                ? { ...JSON.parse(JSON.stringify(existing)), builtin: false }
                : { id: genId(), text: '', fields: [], content: '', builtin: false, category: '', fav: false };

            const overlay = el('div', 'ep-overlay ep-overlay-2');
            const modal = el('div', 'ep-modal ep-modal-xl');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            let asking = false, baseline = '';

            const close = (result) => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('selectionchange', refreshTools);
                overlay.remove();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape' && !asking) { e.stopPropagation(); tryClose(); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !asking) { e.preventDefault(); modal.querySelector('#ep-ed-save').click(); }
            };
            document.addEventListener('keydown', onKey, true);
            const TOOLS = [
                { cmd: 'bold', label: '<b>B</b>', title: 'Kalın (Ctrl+B)', state: 1 },
                { cmd: 'italic', label: '<i>I</i>', title: 'İtalik (Ctrl+I)', state: 1 },
                { cmd: 'underline', label: '<u>U</u>', title: 'Altı çizili (Ctrl+U)', state: 1 },
                { cmd: 'strikeThrough', label: '<s>S</s>', title: 'Üstü çizili', state: 1 },
                'sep',
                { cmd: 'justifyLeft', label: 'Sol', title: 'Sola hizala', state: 1 },
                { cmd: 'justifyCenter', label: 'Orta', title: 'Ortala', state: 1 },
                { cmd: 'justifyRight', label: 'Sağ', title: 'Sağa hizala', state: 1 },
                { cmd: 'justifyFull', label: 'Yasla', title: 'İki yana yasla', state: 1 },
                'sep',
                { cmd: 'insertUnorderedList', label: '• Liste', title: 'Madde işaretli liste', state: 1 },
                { cmd: 'insertOrderedList', label: '1. Liste', title: 'Numaralı liste', state: 1 },
                { cmd: 'item', label: 'a) Madde', title: 'Paragrafı madde girintisine al / geri al' },
                { cmd: 'outdent', label: '⇤', title: 'Girintiyi azalt' },
                { cmd: 'indent', label: '⇥', title: 'Girintiyi artır' },
                'sep',
                { cmd: 'superscript', label: 'x<sup>2</sup>', title: 'Üst simge (m² gibi)', state: 1 },
                { cmd: 'subscript', label: 'x<sub>2</sub>', title: 'Alt simge', state: 1 },
                'sep',
                { cmd: 'mkfield', label: '⚡ Seçimi alana çevir', title: 'Metinde seçili kelimeyi doldurulacak alana dönüştürür' },
                'sep',
                { cmd: 'undo', label: '↶', title: 'Geri al (Ctrl+Z)' },
                { cmd: 'redo', label: '↷', title: 'Yinele (Ctrl+Y)' },
                { cmd: 'removeFormat', label: 'Tx', title: 'Biçimi temizle' },
            ];
            const toolsHTML = TOOLS.map((t) => t === 'sep' ? '<span class="ep-tb-sep"></span>'
                : `<button type="button" class="ep-tb" data-cmd="${t.cmd}" ${t.state ? 'data-state="1"' : ''} title="${esc(t.title)}">${t.label}</button>`).join('');

            modal.innerHTML = `
                <div class="ep-ed-head">
                    <div class="ep-ed-titlebox">
                        <div class="ep-ed-kicker">${isNew ? 'YENİ ŞABLON' : 'ŞABLONU DÜZENLE'}</div>
                        <input id="ep-ed-name" class="ep-ed-name" type="text" value="${esc(working.text)}" placeholder="Şablon adı (örn. Tapu Kaydı Talebi)" autocomplete="off">
                    </div>
                    <div class="ep-ed-meta">
                        <input id="ep-ed-cat" type="text" list="ep-ed-catlist" value="${esc(working.category)}" placeholder="📁 Kategori (boşsa Genel)" autocomplete="off">
                        <datalist id="ep-ed-catlist">${[...new Set(EP.templates.map(catName).filter((c) => c !== 'Genel'))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
                        <button type="button" class="ep-fav-toggle${working.fav ? ' on' : ''}" id="ep-ed-fav" aria-pressed="${!!working.fav}">★ Öne çıkar</button>
                        <button type="button" class="ep-icon-btn" id="ep-ed-full" title="Tam ekran" aria-label="Tam ekran"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
                    </div>
                </div>
                <div class="ep-ed-grid">
                <div class="ep-ed-side">
                <div class="ep-ed-label">Doldurulacak alanlar (isteğe bağlı)</div>
                <div class="ep-ed-colhead"><span>Alan adı</span><span>Varsayılan değer</span><span></span></div>
                <div id="ep-ed-fields"></div>
                <button type="button" class="ep-btn ep-btn-secondary" id="ep-ed-addfield">+ Alan ekle</button>
                <div class="ep-ed-hint"><b>Nasıl çalışır?</b><br>1) “+ Alan ekle” ile bir alan oluşturun (örn. İl).<br>2) Metinde imleci istediğiniz yere koyup üstte beliren <b>+ İl</b> düğmesine tıklayın.<br>3) Şablonu kullanırken bu alanlar için bir form açılır. Varsayılan değere <code>@today</code> yazarsanız bugünün tarihi gelir.</div>
            </div>
            <div class="ep-ed-main">
                <div class="ep-ed-chips" id="ep-ed-chips"></div>
                <div class="ep-ed-tabs">
                    <button type="button" class="ep-ed-tab" data-mode="visual">Görsel</button>
                    <button type="button" class="ep-ed-tab" data-mode="code">HTML Kodu</button>
                    <button type="button" class="ep-ed-tab" data-mode="preview">Önizleme</button>
                </div>
                <div class="ep-ed-toolbar" id="ep-ed-toolbar">${toolsHTML}</div>
                <div class="ep-ed-stage">
                    <div class="ep-wys" id="ep-wys" contenteditable="true" spellcheck="true"></div>
                    <textarea id="ep-ed-content" class="ep-ed-content" spellcheck="false" hidden placeholder="HTML kodunu buraya yazın… örn. {{il}} ili, {{ilce}} ilçesi"></textarea>
                    <div class="ep-ed-preview" id="ep-ed-preview" hidden></div>
                </div>
                <div class="ep-ed-status" id="ep-ed-status"></div>
            </div>
        </div>
                <div class="ep-err" id="ep-ed-err" role="alert"></div>
                <div class="ep-actions">
                    <div class="ep-ed-foot-left">
                        <span class="ep-ed-dirty" id="ep-ed-dirty" hidden>● Kaydedilmemiş değişiklikler</span>
                        <span>Ctrl+Enter: kaydet · Esc: kapat</span>
                    </div>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-ed-cancel">Vazgeç</button>
                    <button type="button" class="ep-btn ep-btn-primary" id="ep-ed-save">${isNew ? 'Ekle' : 'Kaydet'}</button>
                </div>`;

            const nameEl = modal.querySelector('#ep-ed-name');
            const fieldsList = modal.querySelector('#ep-ed-fields');
            const addFieldBtn = modal.querySelector('#ep-ed-addfield');
            const wys = modal.querySelector('#ep-wys');
            const codeEl = modal.querySelector('#ep-ed-content');
            const previewEl = modal.querySelector('#ep-ed-preview');
            const chipsBox = modal.querySelector('#ep-ed-chips');
            const toolbar = modal.querySelector('#ep-ed-toolbar');
            const errEl = modal.querySelector('#ep-ed-err');

            const catEl = modal.querySelector('#ep-ed-cat');
            const statusEl = modal.querySelector('#ep-ed-status');
            const dirtyEl = modal.querySelector('#ep-ed-dirty');
            const fullBtn = modal.querySelector('#ep-ed-full');
            fullBtn.onclick = () => {
                const on = modal.classList.toggle('ep-modal-full');
                overlay.classList.toggle('ep-overlay-full', on);
                fullBtn.title = on ? 'Tam ekrandan çık' : 'Tam ekran';
                fullBtn.innerHTML = on
                    ? '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
                    : '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
            };
            const favBtn = modal.querySelector('#ep-ed-fav');
            favBtn.onclick = () => {
                working.fav = !working.fav;
                favBtn.classList.toggle('on', working.fav);
                favBtn.setAttribute('aria-pressed', String(working.fav));
            };

            const TAB_MARK = '<span class="ep-tabmark" contenteditable="false" data-ep-tab="1">&nbsp;</span>';
            const fieldMark = (id) => {
                if (id === 'TAB') return TAB_MARK;
                if (ozelDeger(id) !== null) return `<span class="ep-fieldmark ep-fm-special" contenteditable="false" data-ep-field="${esc(id)}">${esc(ozelEtiket(id))}</span>`;
                const f = working.fields.find((x) => x.id === id);
                return `<span class="ep-fieldmark${f ? '' : ' ep-fm-bad'}" contenteditable="false" data-ep-field="${esc(id)}">${esc(f ? (f.label.trim() || f.id) : id)}</span>`;
            };
            const toVisual = (h) => h.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, id) => fieldMark(id));
            const fromVisual = () => {
                const clone = wys.cloneNode(true);
                clone.querySelectorAll('[data-ep-tab]').forEach((n) => n.replaceWith(document.createTextNode('{{TAB}}')));
                clone.querySelectorAll('[data-ep-field]').forEach((n) => n.replaceWith(document.createTextNode(`{{${n.dataset.epField}}}`)));
                return clone.innerHTML.replace(/\u200b/g, '');
            };

            function insertToken(id) {
                if (mode === 'visual') { wys.focus(); document.execCommand('insertHTML', false, fieldMark(id) + '&#8203;'); onEdit(); }
                else if (mode === 'code') { insertAtCursor(codeEl, `{{${id}}}`); onEdit(); }
            }

            async function ozelGunEkle(isGunu) {
                const s = window.getSelection();
                const r = (s.rangeCount && wys.contains(s.anchorNode)) ? s.getRangeAt(0).cloneRange() : null;
                asking = true;
                const v = await runWizard([{ title: isGunu ? 'Bugün + iş günü' : 'Bugün + gün',
                    subtitle: 'Bugünün tarihine kaç gün eklensin? Geriye gitmek için başına eksi (-) koyun.',
                    fields: [{ id: 'n', label: 'Gün sayısı', placeholder: 'örn. 15',
                        validate: (x) => (/^-?\d{1,4}$/.test(x.trim()) ? null : 'Sadece sayı yazın.') }] }],
                    { submitLabel: 'Ekle', overlayClass: 'ep-overlay-2' });
                asking = false;
                if (!v) return;
                const n = parseInt(v.n, 10);
                if (r && mode === 'visual') { wys.focus(); const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(r); }
                insertToken(`${isGunu ? 'ISGUNU' : 'BUGUN'}_${n < 0 ? 'M' : 'P'}${Math.abs(n)}`);
            }

            function refreshPills() {
                if (mode !== 'visual') return;
                wys.querySelectorAll('[data-ep-field]').forEach((n) => {
                    const id = n.dataset.epField;
                    if (ozelDeger(id) !== null) return;
                    const f = working.fields.find((x) => x.id === id);
                    n.textContent = f ? (f.label.trim() || f.id) : id;
                    n.classList.toggle('ep-fm-bad', !f);
                });
            }

            function updateStatus() {
                const cur = mode === 'visual' ? fromVisual() : mode === 'code' ? codeEl.value : html;
                const text = cur.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                const used = new Set([...cur.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]));
                const unknown = [...used].filter((id) => id !== 'TAB' && ozelDeger(id) === null && !working.fields.some((f) => f.id === id));
                const unused = working.fields.filter((f) => f.label.trim() && !used.has(f.id));
                let out = `<span>${text ? text.split(' ').length : 0} kelime · ${text.length} karakter</span>`;
                if (unknown.length) out += `<span class="bad">⚠ Tanımsız alan: ${unknown.map((u) => `{{${u}}}`).join(', ')}</span>`;
                if (unused.length) out += `<span class="warn">Metinde kullanılmayan alan: ${unused.map((f) => esc(f.label)).join(', ')}</span>`;
                statusEl.innerHTML = out;
                if (dirtyEl) dirtyEl.hidden = !baseline || JSON.stringify([nameEl.value.trim(), catEl.value.trim(), !!working.fav, working.fields.map((f) => [f.label, f.value]), cur]) === baseline;
            }
            const onEdit = debounce(updateStatus, 200);
            wys.addEventListener('input', onEdit);
            codeEl.addEventListener('input', onEdit);

            let html = working.content || '';
            let mode = '';

            function pull() {
                if (mode === 'visual') html = fromVisual();
                else if (mode === 'code') html = codeEl.value;
            }

            function updatePreview() {
                const sample = {};
                working.fields.forEach((f) => { sample[f.id] = f.value === '@today' ? bugun() : (f.value || `[${f.label || f.id}]`); });
                const rendered = renderContent({ content: html }, sample);
                previewEl.innerHTML = rendered.trim() ? sanitizeHTML(rendered) : '<span class="ep-mgr-row-sub">Önizleme için içerik girin…</span>';
            }

            function setMode(m) {
                pull();
                mode = m;
                wys.hidden = m !== 'visual';
                codeEl.hidden = m !== 'code';
                previewEl.hidden = m !== 'preview';
                chipsBox.hidden = m === 'preview';
                toolbar.classList.toggle('ep-disabled', m !== 'visual');
                modal.querySelectorAll('.ep-ed-tab').forEach((t) => t.classList.toggle('on', t.dataset.mode === m));
                if (m === 'visual') { wys.innerHTML = toVisual(html) || '<p><br></p>'; wys.focus(); }
                if (m === 'code') { codeEl.value = html; codeEl.focus(); }
                if (m === 'preview') updatePreview();
                updateStatus();
            }
            modal.querySelectorAll('.ep-ed-tab').forEach((t) => { t.onclick = () => setMode(t.dataset.mode); });

            try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* yok say */ }
            toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('.ep-tb')) e.preventDefault(); });
            toolbar.addEventListener('click', (e) => {
                const b = e.target.closest('.ep-tb');
                if (!b || mode !== 'visual') return;
                wys.focus();
                const cmd = b.dataset.cmd;
                if (cmd === 'tab') { document.execCommand('insertHTML', false, TAB_MARK); return; }
                if (cmd === 'mkfield') {
                    const sel = window.getSelection();
                    const txt = (sel && sel.rangeCount && wys.contains(sel.anchorNode)) ? sel.toString().trim() : '';
                    if (!txt || txt.includes('\n')) { toast('Önce metinde, alana çevirmek istediğiniz kelime veya ifadeyi (tek satır) seçin.', 'info'); return; }
                    const label = txt.length > 24 ? `${txt.slice(0, 24)}…` : txt;
                    const id = uniqueFieldId(working.fields, slugify(label));
                    working.fields.push({ id, label, value: txt });
                    document.execCommand('insertHTML', false, fieldMark(id) + '&#8203;');
                    renderFieldRows(); renderChips(); onEdit();
                    toast(`“${label}” alan olarak eklendi. Adını sol panelden değiştirebilirsiniz.`, 'info');
                    return;
                }
                if (cmd === 'item') {
                    let n = window.getSelection().anchorNode;
                    while (n && n !== wys && !(n.nodeType === 1 && /^(P|DIV|LI)$/.test(n.nodeName))) n = n.parentNode;
                    if (n && n !== wys) n.style.marginLeft = n.style.marginLeft ? '' : '20.95pt';
                    return;
                }
                document.execCommand('styleWithCSS', false, /^(justify|indent|outdent)/.test(cmd));
                document.execCommand(cmd, false, null);
                refreshTools();
            });
            function refreshTools() {
                if (mode !== 'visual') return;
                toolbar.querySelectorAll('[data-state]').forEach((b) => {
                    let on = false;
                    try { on = document.queryCommandState(b.dataset.cmd); } catch (_) { /* yok say */ }
                    b.classList.toggle('on', !!on);
                });
            }
            document.addEventListener('selectionchange', refreshTools);

            wys.addEventListener('keydown', (e) => {
                if (e.key !== 'Tab') return;
                e.preventDefault();
                document.execCommand('insertHTML', false, TAB_MARK + '&#8203;');
                onEdit();
            });

            wys.addEventListener('paste', (e) => {
                e.preventDefault();
                const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r/g, '');
                const lines = t.split('\n');
                if (lines.length === 1) { document.execCommand('insertText', false, t); return; }
                document.execCommand('insertHTML', false, lines.map((l) => `<p>${l.trim() ? esc(l) : '<br>'}</p>`).join(''));
            });

            function renderFieldRows() {
                fieldsList.innerHTML = '';
                if (!working.fields.length) fieldsList.appendChild(el('div', 'ep-ed-nofield', 'Alan yok. Bu şablon sabit metin olarak eklenecek.'));
                working.fields.forEach((f, i) => {
                    const row = el('div', 'ep-ed-field-row');
                    row.innerHTML = `
                        <input type="text" data-k="label" placeholder="Alan adı" value="${esc(f.label)}">
                        <input type="text" data-k="value" placeholder="Varsayılan" value="${esc(f.value)}">
                        <button type="button" class="ep-icon-btn ep-icon-btn-danger" title="Alanı sil" aria-label="Alanı sil"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
                    row.querySelector('[data-k="label"]').addEventListener('input', (e) => {
                        f.label = e.target.value;
                        renderChips();
                    });
                    row.querySelector('[data-k="label"]').addEventListener('change', () => {
                        if (!f._auto) return;
                        pull();
                        if (html.includes(`{{${f.id}}}`)) return;
                        f.id = uniqueFieldId(working.fields.filter((x) => x !== f), slugify(f.label));
                        renderChips();
                    });
                    row.querySelector('[data-k="value"]').addEventListener('input', (e) => { f.value = e.target.value; onEdit(); });
                    row.querySelector('button').onclick = () => { working.fields.splice(i, 1); renderFieldRows(); renderChips(); };
                    fieldsList.appendChild(row);
                });
            }

            function renderChips() {
                chipsBox.innerHTML = '';
                refreshPills();
                chipsBox.appendChild(el('span', 'ep-ed-chips-title', 'Metne ekle:'));
                const add = (label, id, title) => {
                    const chip = el('span', 'ep-ed-chip', esc(label));
                    chip.title = title;
                    chip.onmousedown = (e) => e.preventDefault();
                    chip.onclick = () => insertToken(id);
                    chipsBox.appendChild(chip);
                };
                const pop = el('div', 'ep-ed-pop');
                pop.hidden = true;
                const openBtn = el('span', 'ep-ed-chip ep-ed-chip-main', '📌 Hazır bilgi ekle ▾');
                openBtn.onmousedown = (e) => e.preventDefault();
                openBtn.onclick = () => { pop.hidden = !pop.hidden; };
                pop.onmouseleave = () => { pop.hidden = true; };
                OZEL_MENU.forEach((g) => {
                    pop.appendChild(el('div', 'ep-ed-pop-head', esc(g.grup)));
                    g.ids.forEach((id) => {
                        const it = el('div', 'ep-ed-pop-item', `<span>${esc(ozelEtiket(id))}</span><small>${esc(ozelDeger(id))}</small>`);
                        it.onmousedown = (e) => e.preventDefault();
                        it.onclick = () => { pop.hidden = true; insertToken(id); };
                        pop.appendChild(it);
                    });
                });
                pop.appendChild(el('div', 'ep-ed-pop-head', 'Kendi sayınızı yazın'));
                [['+ … gün', false], ['+ … iş günü', true]].forEach(([t, w]) => {
                    const it = el('div', 'ep-ed-pop-item', `<span>✏️ Bugün ${t}</span>`);
                    it.onmousedown = (e) => e.preventDefault();
                    it.onclick = () => { pop.hidden = true; ozelGunEkle(w); };
                    pop.appendChild(it);
                });
                chipsBox.append(openBtn, pop);
                working.fields.forEach((f) => add(`+ ${f.label.trim() || f.id}`, f.id, 'İmlecin olduğu yere bu alanı ekler'));
                updateStatus();
            }

            addFieldBtn.onclick = () => {
                working.fields.push({ id: uniqueFieldId(working.fields, 'alan'), label: '', value: '', _auto: true });
                renderFieldRows(); renderChips();
                setTimeout(() => fieldsList.querySelector('.ep-ed-field-row:last-child input')?.focus(), 10);
            };

            const snap = () => { pull(); return JSON.stringify([nameEl.value.trim(), catEl.value.trim(), !!working.fav, working.fields.map((f) => [f.label, f.value]), html]); };
            async function tryClose() {
                if (snap() === baseline) return close(null);
                asking = true;
                const c = await confirmChoice('Değişiklikler kaydedilmedi', 'Çıkarsanız yaptığınız değişiklikler kaybolur.', [
                    { key: 'save', label: 'Kaydet', primary: true },
                    { key: 'discard', label: 'Kaydetmeden çık' },
                ]);
                asking = false;
                if (c === 'save') modal.querySelector('#ep-ed-save').click();
                else if (c === 'discard') close(null);
            }
            modal.querySelector('#ep-ed-cancel').onclick = tryClose;
            modal.querySelector('#ep-ed-save').onclick = () => {
                pull();
                const text = nameEl.value.trim();
                if (!text) { errEl.textContent = 'Şablon adı gerekli.'; nameEl.focus(); return; }
                if (!html.replace(/<br\s*\/?>|<\/?p>|&nbsp;|\s/gi, '')) { errEl.textContent = 'İçerik boş olamaz.'; return; }
                if (working.fields.some((f) => !f.label.trim())) { errEl.textContent = 'Tüm alanların bir adı olmalı (ya da boş alanı silin).'; return; }
                const known = new Set(working.fields.map((f) => f.id)); known.add('TAB');
                const unknown = [...html.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]).filter((id) => !known.has(id) && ozelDeger(id) === null);
                if (unknown.length) { errEl.textContent = `Metinde tanımsız alan var: {{${unknown[0]}}}. Alanı ekleyin ya da metinden silin.`; return; }
                working.text = text;
                working.category = catEl.value.trim();
                working.content = html;
                close(normalizeTemplate(working));
            };
            nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') modal.querySelector('#ep-ed-save').click(); });
            nameEl.addEventListener('input', onEdit);
            catEl.addEventListener('input', onEdit);
            favBtn.addEventListener('click', onEdit);

            renderFieldRows(); renderChips();
            setMode('visual');
            baseline = snap();
            setTimeout(() => nameEl.focus(), 30);
        });
    }

    function openTemplateManager() {
        return new Promise((resolve) => {
            let list = EP.templates.map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f })) }));
            let filtered = list.slice();
            let catFilter = '', selectedId = null, highlightId = null, dragId = null;
            const baseline = JSON.stringify(list);
            const isDirty = () => JSON.stringify(list) !== baseline;
            const lower = (s) => String(s).toLocaleLowerCase('tr');

            const IC = {
                search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
                grip: '<svg viewBox="0 0 14 18" fill="currentColor"><circle cx="4" cy="3" r="1.5"/><circle cx="10" cy="3" r="1.5"/><circle cx="4" cy="9" r="1.5"/><circle cx="10" cy="9" r="1.5"/><circle cx="4" cy="15" r="1.5"/><circle cx="10" cy="15" r="1.5"/></svg>',
                star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1 6L12 16.8 6.7 19.6l1-6L3.3 9.4l6-.9z"/></svg>',
                dup: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
                edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
                del: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
                close: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
            };

            const overlay = el('div', 'ep-overlay');
            const modal = el('div', 'ep-modal ep-modal-mgr');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = `
                <div class="ep-mg-head">
                    <div class="ep-mg-ico">🗂️</div>
                    <div class="ep-mg-titles">
                        <h3>Şablon Yönetimi</h3>
                        <p class="ep-sub">Şablonları ekleyin, düzenleyin, sürükleyerek sıralayın veya JSON olarak içe/dışa aktarın.</p>
                    </div>
                    <button type="button" class="ep-icon-btn" id="ep-mgr-x" title="Kapat (Esc)" aria-label="Kapat">${IC.close}</button>
                </div>
                <div class="ep-mg-stats" id="ep-mg-stats"></div>
                <div class="ep-mg-tools">
                    <div class="ep-mg-searchbox">${IC.search}<input type="text" id="ep-mgr-search" placeholder="Şablon adı veya kategori ara…" autocomplete="off"></div>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-sort" title="Kategori ve ada göre sırala">A→Z Sırala</button>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-import">İçe Aktar</button>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-export">Dışa Aktar</button>
                    <button type="button" class="ep-btn ep-btn-primary" id="ep-mgr-new">+ Yeni Şablon</button>
                </div>
                <div class="ep-mg-body">
                    <div class="ep-mg-chips" id="ep-mg-chips"></div>
                    <div class="ep-mg-list" id="ep-mgr-list"></div>
                    <aside class="ep-mg-preview" id="ep-mg-preview"></aside>
                </div>
                <div class="ep-mg-foot">
                    <span class="ep-mg-count" id="ep-mg-count"></span>
                    <span class="ep-mg-dirty" id="ep-mg-dirty" hidden>● Kaydedilmemiş değişiklikler var</span>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-cancel">Kapat</button>
                    <button type="button" class="ep-btn ep-btn-primary" id="ep-mgr-save">Kaydet ve Kapat</button>
                </div>`;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const fileInput = el('input');
            fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.hidden = true;
            document.body.appendChild(fileInput);

            const $ = (s) => modal.querySelector(s);
            const searchEl = $('#ep-mgr-search'), listEl = $('#ep-mgr-list'), chipsEl = $('#ep-mg-chips'),
                  statsEl = $('#ep-mg-stats'), previewEl = $('#ep-mg-preview'), countEl = $('#ep-mg-count'), dirtyEl = $('#ep-mg-dirty');

            const onKey = (e) => {
                if (document.querySelector('.ep-overlay-2')) return;
                if (e.key === 'Escape') { e.stopPropagation(); tryClose(); }
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#ep-mgr-save').click(); }
            };
            document.addEventListener('keydown', onKey, true);
            const doClose = () => { document.removeEventListener('keydown', onKey, true); fileInput.remove(); overlay.remove(); resolve(); };
            const tryClose = async () => {
                if (!isDirty()) return doClose();
                const c = await confirmChoice('Değişiklikler kaydedilmedi', 'Kapatırsanız şablonlarda yaptığınız değişiklikler kaybolur.', [
                    { key: 'save', label: 'Kaydet ve Kapat', primary: true },
                    { key: 'discard', label: 'Kaydetmeden kapat' },
                ]);
                if (c === 'save') $('#ep-mgr-save').click();
                else if (c === 'discard') doClose();
            };

            function renderStats() {
                statsEl.innerHTML = [
                    [list.length, 'Toplam şablon'],
                    [list.filter((t) => t.fav).length, 'Öne çıkan'],
                    [new Set(list.map(catName)).size, 'Kategori'],
                    [list.reduce((a, t) => a + t.fields.length, 0), 'Doldurulacak alan'],
                ].map(([n, l]) => `<div class="ep-mg-stat"><b>${n}</b><span>${l}</span></div>`).join('');
            }

            function renderChips() {
                const counts = new Map();
                list.forEach((t) => counts.set(catName(t), (counts.get(catName(t)) || 0) + 1));
                const chip = (key, label, n) => `<button type="button" class="ep-mg-chip${catFilter === key ? ' on' : ''}" data-cat="${esc(key)}"><span class="ep-mg-cl">${label}</span><i>${n}</i></button>`;
                chipsEl.innerHTML = chip('', 'Tümü', list.length) + chip('__fav', '⭐ Öne çıkanlar', list.filter((t) => t.fav).length)
                    + [...counts].map(([c, n]) => chip(c, `📁 ${esc(c)}`, n)).join('');
            }
            chipsEl.onclick = (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; catFilter = b.dataset.cat; applyFilter(); };

            function renderPreview() {
                const tpl = list.find((t) => t.id === selectedId);
                if (!tpl) {
                    previewEl.innerHTML = '<div class="ep-mg-pv-empty"><div>📄</div><b>Önizleme</b><span>Bir şablon seçin; örnek verilerle burada görünür.</span></div>';
                    return;
                }
                const sample = {};
                tpl.fields.forEach((f) => { sample[f.id] = f.value === '@today' ? bugun() : (f.value || `[${f.label}]`); });
                previewEl.innerHTML = `<div class="ep-mg-pv-head"><b>${esc(tpl.text)}</b><button type="button" class="ep-btn ep-btn-primary" data-pv="edit">Düzenle</button></div>
                    <div class="ep-paper">${sanitizeHTML(renderContent(tpl, sample))}</div>`;
                previewEl.querySelector('[data-pv="edit"]').onclick = () => editTpl(tpl);
            }

            const select = (id) => {
                selectedId = id;
                listEl.querySelectorAll('.ep-mg-row').forEach((r) => r.classList.toggle('ep-sel', r.dataset.id === id));
                renderPreview();
            };

            async function editTpl(tpl) {
                const edited = await openTemplateEditor(tpl);
                if (!edited) return;
                list[list.indexOf(tpl)] = edited;
                selectedId = highlightId = edited.id;
                applyFilter();
            }

            function move(tpl, d) {
                const i = list.indexOf(tpl), j = i + d;
                if (j < 0 || j >= list.length) return;
                [list[i], list[j]] = [list[j], list[i]];
                highlightId = tpl.id;
                applyFilter();
                listEl.querySelector(`.ep-mg-row[data-id="${CSS.escape(tpl.id)}"]`)?.focus({ preventScroll: true });
            }

            function renderRows() {
                const prevScroll = listEl.scrollTop;
                listEl.innerHTML = '';
                if (!filtered.length) {
                    listEl.appendChild(el('div', 'ep-mgr-empty', list.length ? 'Aramanızla eşleşen şablon yok.' : 'Henüz şablon yok.<br>“+ Yeni Şablon” ile ilk şablonunuzu oluşturun.'));
                    return;
                }
                filtered.forEach((tpl) => {
                    const row = el('div', 'ep-mg-row');
                    row.dataset.id = tpl.id;
                    row.tabIndex = 0;
                    row.draggable = true;
                    const snip = tpl.content.replace(/\{\{\s*TAB\s*\}\}/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
                    row.innerHTML = `
                        <span class="ep-mg-grip" title="Sürükleyerek sırala">${IC.grip}</span>
                        <div class="ep-mg-main">
                            <div class="ep-mg-title">${tpl.fav ? '<span class="ep-fav-mark">★</span>' : ''}<span class="ep-mg-name">${esc(tpl.text)}</span>${tpl.builtin ? '<span class="ep-badge">Varsayılan</span>' : ''}</div>
                            <div class="ep-mg-meta"><span class="ep-mg-pill">📁 ${esc(catName(tpl))}</span><span>${tpl.fields.length ? `${tpl.fields.length} alan` : 'Sabit metin'}</span></div>
                            <div class="ep-mgr-row-snip">${esc(snip)}${snip.length >= 100 ? '…' : ''}</div>
                        </div>
                        <div class="ep-mg-actions">
                            <button type="button" class="ep-icon-btn ep-icon-fav${tpl.fav ? ' on' : ''}" data-act="fav" title="${tpl.fav ? 'Öne çıkanlardan kaldır' : 'Öne çıkar'}" aria-label="Öne çıkar">${IC.star}</button>
                            <button type="button" class="ep-icon-btn" data-act="dup" title="Kopyala" aria-label="Kopyala">${IC.dup}</button>
                            <button type="button" class="ep-icon-btn" data-act="edit" title="Düzenle" aria-label="Düzenle">${IC.edit}</button>
                            <button type="button" class="ep-icon-btn ep-icon-btn-danger" data-act="del" title="Sil" aria-label="Sil">${IC.del}</button>
                        </div>`;

                    const act = (name) => {
                        if (name === 'fav') { tpl.fav = !tpl.fav; highlightId = tpl.id; applyFilter(); }
                        else if (name === 'dup') {
                            const copy = normalizeTemplate({ ...tpl, id: genId(), text: `${tpl.text} (kopya)`, builtin: false });
                            list.splice(list.indexOf(tpl) + 1, 0, copy);
                            selectedId = highlightId = copy.id;
                            applyFilter();
                        }
                        else if (name === 'edit') editTpl(tpl);
                        else if (name === 'del') {
                            const actions = row.querySelector('.ep-mg-actions');
                            const box = el('span', 'ep-mgr-confirm', 'Silinsin mi? <button type="button" class="yes">Evet</button><button type="button" class="no">Vazgeç</button>');
                            actions.replaceChildren(box);
                            actions.style.opacity = 1;
                            box.querySelector('.yes').onclick = (ev) => {
                                ev.stopPropagation();
                                row.classList.add('ep-row-out');
                                setTimeout(() => { list.splice(list.indexOf(tpl), 1); if (selectedId === tpl.id) selectedId = null; applyFilter(); }, 180);
                            };
                            box.querySelector('.no').onclick = (ev) => { ev.stopPropagation(); applyFilter(); };
                        }
                    };

                    row.addEventListener('click', (e) => {
                        const b = e.target.closest('[data-act]');
                        if (!b) { select(tpl.id); return; }
                        e.stopPropagation();
                        act(b.dataset.act);
                    });
                    row.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-act]')) editTpl(tpl); });
                    row.addEventListener('keydown', (e) => {
                        if (e.target !== row) return;
                        if (e.key === 'Enter') act('edit');
                        if (e.key === ' ') { e.preventDefault(); select(tpl.id); }
                        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(tpl, e.key === 'ArrowUp' ? -1 : 1); }
                    });

                    row.addEventListener('dragstart', (e) => { dragId = tpl.id; row.classList.add('ep-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tpl.id); });
                    row.addEventListener('dragend', () => { dragId = null; listEl.querySelectorAll('.ep-dragging,.ep-drop-before,.ep-drop-after').forEach((n) => n.classList.remove('ep-dragging', 'ep-drop-before', 'ep-drop-after')); });
                    row.addEventListener('dragover', (e) => {
                        if (!dragId || dragId === tpl.id) return;
                        e.preventDefault();
                        const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                        row.classList.toggle('ep-drop-after', after);
                        row.classList.toggle('ep-drop-before', !after);
                    });
                    row.addEventListener('dragleave', () => row.classList.remove('ep-drop-before', 'ep-drop-after'));
                    row.addEventListener('drop', (e) => {
                        e.preventDefault();
                        if (!dragId || dragId === tpl.id) return;
                        const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                        const from = list.findIndex((t) => t.id === dragId);
                        if (from < 0) return;
                        const [moved] = list.splice(from, 1);
                        let to = list.findIndex((t) => t.id === tpl.id);
                        if (after) to++;
                        list.splice(to, 0, moved);
                        highlightId = moved.id;
                        applyFilter();
                    });

                    if (tpl.id === selectedId) row.classList.add('ep-sel');
                    if (tpl.id === highlightId) row.classList.add('ep-row-hl');
                    listEl.appendChild(row);
                });
                listEl.scrollTop = prevScroll;
                listEl.querySelector('.ep-row-hl')?.scrollIntoView({ block: 'nearest' });
                highlightId = null;
            }

            function applyFilter() {
                if (catFilter && catFilter !== '__fav' && !list.some((t) => catName(t) === catFilter)) catFilter = '';
                const q = lower(searchEl.value).trim();
                filtered = list.filter((t) =>
                    (!q || lower(t.text).includes(q) || lower(catName(t)).includes(q)) &&
                    (!catFilter || (catFilter === '__fav' ? t.fav : catName(t) === catFilter)));
                renderStats(); renderChips(); renderRows(); renderPreview();
                countEl.textContent = `${filtered.length} / ${list.length} şablon gösteriliyor`;
                dirtyEl.hidden = !isDirty();
            }

            searchEl.addEventListener('input', debounce(applyFilter, 120));
            $('#ep-mgr-x').onclick = tryClose;
            $('#ep-mgr-cancel').onclick = tryClose;

            $('#ep-mgr-new').onclick = async () => {
                const created = await openTemplateEditor(null);
                if (created) { list.push(created); selectedId = highlightId = created.id; catFilter = ''; searchEl.value = ''; applyFilter(); }
            };

            $('#ep-mgr-sort').onclick = () => {
                list.sort((a, b) => catName(a).localeCompare(catName(b), 'tr') || a.text.localeCompare(b.text, 'tr'));
                applyFilter();
                toast('Şablonlar kategori ve ada göre sıralandı.', 'info');
            };

            $('#ep-mgr-export').onclick = () => {
                if (!list.length) return toast('Dışa aktarılacak şablon yok.', 'error');
                const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = el('a'); a.href = url; a.download = `ebys-plus-sablonlar-${bugun().replace(/\//g, '-')}.json`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
                toast(`${list.length} şablon dışa aktarıldı.`);
            };

            $('#ep-mgr-import').onclick = () => fileInput.click();
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                fileInput.value = '';
                if (!file) return;
                let parsed;
                try { parsed = JSON.parse(await file.text()); } catch (_) { toast('Dosya okunamadı, geçerli bir JSON olmalı.', 'error'); return; }
                const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.templates) ? parsed.templates : null);
                if (!arr) { toast('Dosya biçimi tanınmadı.', 'error'); return; }
                const incoming = arr.map((t) => normalizeTemplate({ ...t, content: sanitizeHTML(t && t.content), builtin: false, id: genId() })).filter(Boolean);
                if (!incoming.length) { toast('İçe aktarılabilir geçerli şablon bulunamadı.', 'error'); return; }
                const choice = await confirmChoice('Şablonlar içe aktarılıyor', `${incoming.length} geçerli şablon bulundu. Nasıl eklensin?`, [
                    { key: 'merge', label: 'Mevcutlara ekle', primary: true },
                    { key: 'replace', label: 'Hepsinin yerine geç' },
                ]);
                if (choice === 'cancel') return;
                if (choice === 'replace') list = incoming; else list.push(...incoming);
                selectedId = null;
                applyFilter();
                toast(`${incoming.length} şablon içe aktarıldı.`);
            };

            $('#ep-mgr-save').onclick = () => {
                if (saveTemplates(list)) {
                    EP.templates = list;
                    toast('Şablonlar kaydedildi.');
                    doClose();
                }
            };

            applyFilter();
            setTimeout(() => searchEl.focus(), 30);
        });
    }

    /* ============================ Başlatma ============================ */

    function tick() {
        watchLoginNotices();
        autoFill();
        if (!isLoginPage) { autoAciklama(); syncTemplateButton(); syncMultiUploadButton(); }
    }

    async function init() {
        injectStyles();
        EP.templates = loadTemplates();
        buildMenu();
        if (!isLoginPage) initAciklama();

        function leadingTrailing(fn, ms) {
            let last = 0, timer = null;
            return (...args) => {
                const now = Date.now();
                const run = () => { last = Date.now(); fn(...args); };
                if (now - last > ms) run();
                clearTimeout(timer);
                timer = setTimeout(run, ms);
            };
        }
        const fastTick = leadingTrailing(tick, 60);

        new MutationObserver(fastTick).observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'],
        });

        if (window.jsf && window.jsf.ajax && typeof window.jsf.ajax.addOnEvent === 'function') {
            window.jsf.ajax.addOnEvent((data) => { if (data.status === 'success') tick(); });
        }

        let creds = await loadCreds();
        if (creds === 'unavailable') {
            toast('Şifreleme deposuna şu an erişilemedi. Kayıtlı bilgiler silinmedi; sayfayı yenileyin.', 'error');
            creds = null;
        } else {
            if (creds === 'broken') {
                toast('Kayıtlı bilgiler bu tarayıcıda çözülemedi (tarayıcı verileri temizlenmiş olabilir). Yeniden kurulum gerekiyor.', 'error');
                store.remove(KEYS.vault);
                creds = null;
            }
            if (!creds) creds = await bootstrap();
        }

        EP.creds = creds;
        refreshStatus();
        tick();
    }

    init();
})();
}
