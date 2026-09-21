// ==UserScript==
// @name         EBYS Plus
// @namespace    http://tampermonkey.net/
// @version      2.0.1
// @description  Şifreli otomatik giriş (KEP / e-imza dahil), evrak açıklama otomasyonu ve gelişmiş şablon yönetim paneli (ekle / düzenle / sil / sırala / içe-dışa aktar). Ana parola yalnızca kayıtlı bilgiler değiştirilirken istenir.
// @author       Sen
// @match        https://ebys.tkgm.gov.tr/edys-web/sistemeGiris.xhtml*
// @match        https://ebys.tkgm.gov.tr/edys-web/mainInbox.xhtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gov.tr
// @grant        none
// @updateURL      https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/ebys-plus.user.js
// @downloadURL    https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/ebys-plus.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================================================
       Nasıl çalışır?
       - Bilgileriniz AES-GCM ile şifrelenip localStorage'a yazılır.
       - Şifreleme anahtarı bu tarayıcıya özeldir (dışarı çıkarılamayan CryptoKey, IndexedDB'de durur).
         Bu sayede giriş sırasında hiçbir parola sorulmaz.
       - "Ayar parolası" yalnızca kayıtlı bilgileri düzenlerken / silerken istenir (5 dk hatırlanır).
       - Şablonlar (evrak metinleri) ayrı, şifresiz olarak saklanır; EBYS Plus panelindeki
         "Şablonları düzenle" ile tamamen yönetilebilir, JSON olarak içe/dışa aktarılabilir.
       ========================================================================================= */

    const KEYS = {
        vault: 'ep_vault_v2',      // şifreli bilgiler
        pw: 'ep_pw_v2',            // ayar parolası doğrulayıcısı (PBKDF2 özeti)
        enabled: 'ep_enabled',     // otomatik doldurma açık/kapalı
        oldVault: 'ep_vault_v1',   // eski (ana parola ile şifreli) sürüm
        oldSession: 'ep_session_v1',
        templates: 'ep_templates_v1', // şablon Plus verileri
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

        .ep-btn{ font:600 13.5px var(--ep-font); border:1px solid transparent; border-radius:8px; padding:9px 16px; cursor:pointer;
            transition:background .15s, border-color .15s, opacity .15s, transform .1s; }
        .ep-btn:active{ transform:scale(.97); }
        .ep-btn:focus-visible,.ep-item:focus-visible,.ep-fab:focus-visible,.ep-eye:focus-visible,.ep-icon-btn:focus-visible{ outline:2px solid var(--ep-accent); outline-offset:2px; }
        .ep-btn:disabled{ opacity:.5; cursor:not-allowed; }
        .ep-btn-primary{ background:var(--ep-accent); color:#fff; }
        .ep-btn-primary:hover{ background:var(--ep-accent-hover); }
        .ep-btn-danger{ background:var(--ep-danger); color:#fff; }
        .ep-btn-secondary{ background:#fff; color:var(--ep-ink); border-color:var(--ep-line); }
        .ep-btn-secondary:hover{ background:var(--ep-soft); }

        /* Bildirimler */
        #ep-toasts{ position:fixed; top:14px; right:14px; z-index:100005; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
        .ep-toast{ background:var(--ep-ink); color:#fff; padding:10px 16px; border-radius:8px; font-size:13.5px; max-width:340px;
            border-left:4px solid var(--ep-ok); box-shadow:0 8px 24px rgba(0,0,0,.22); animation:ep-rise .25s ease; transition:opacity .3s, transform .3s; }
        .ep-toast-error{ border-left-color:#ef6b63; }
        .ep-toast-info{ border-left-color:#5aa9e0; }
        .ep-toast.ep-out{ opacity:0; transform:translateY(-6px); }

        /* Diyalog */
        .ep-overlay{ position:fixed; inset:0; z-index:100000; background:rgba(15,20,28,.5); display:flex; align-items:center;
            justify-content:center; animation:ep-fade .15s ease; padding:20px; }
        .ep-overlay.ep-overlay-2{ z-index:100002; background:rgba(15,20,28,.4); }
        .ep-modal{ background:var(--ep-bg); color:var(--ep-ink); width:390px; max-width:92vw; max-height:90vh; overflow:auto;
            padding:24px; border-radius:12px; box-shadow:0 20px 50px rgba(0,0,0,.3); animation:ep-rise .2s ease; }
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
        .ep-input-wrap input{ width:100%; padding:9px 12px; border:1px solid var(--ep-line); border-radius:8px; font:14px var(--ep-font);
            color:var(--ep-ink); background:#fff; outline:none; transition:border-color .15s, box-shadow .15s; }
        .ep-input-wrap input:focus{ border-color:var(--ep-accent); box-shadow:0 0 0 3px rgba(13,92,143,.15); }
        .ep-input-wrap input[data-secret]{ padding-right:64px; }
        .ep-input-wrap input[data-masked="1"]{ -webkit-text-security:disc; text-security:disc; }
        .ep-eye{ position:absolute; right:6px; border:0; background:none; color:var(--ep-accent); font:600 12px var(--ep-font); cursor:pointer; padding:5px 8px; border-radius:6px; }
        .ep-err{ min-height:18px; margin-top:2px; font-size:12.5px; color:var(--ep-danger); }
        .ep-err.ep-shake{ animation:ep-shake .35s ease; }
        .ep-actions{ display:flex; gap:10px; margin-top:14px; }
        .ep-actions .ep-btn{ flex:1; }

        /* Menü */
        .ep-fab{ position:fixed; left:248px; top:4px; z-index:99998; padding:7px 23px; color:#fff; border:1px solid rgba(255,255,255,.35);
            background:linear-gradient(135deg,#0d5c8f 0%,#1489c9 100%);
            border-radius:999px; font:600 12.5px var(--ep-font); letter-spacing:.02em; cursor:pointer;
            box-shadow:0 2px 8px rgba(13,92,143,.35); transition:box-shadow .15s, transform .1s, filter .15s; }
        .ep-fab:hover{ filter:brightness(1.08); box-shadow:0 4px 14px rgba(13,92,143,.45); }
        .ep-fab:active{ transform:scale(.96); }
        .ep-fab[aria-expanded="true"]{ background:linear-gradient(135deg,#0a4a75 0%,#0d5c8f 100%); }
        .ep-panel{ position:fixed; left:0px; top:0px; z-index:99999; width:240px; background:var(--ep-bg); color:var(--ep-ink);
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
        #ep-template-btn{ margin-left:6px; padding:6px 14px; background:#fff; color:var(--ep-accent); border:1.5px solid var(--ep-accent);
            border-radius:8px; font:600 13.5px var(--ep-font); cursor:pointer; transition:background .15s, color .15s; }
        #ep-template-btn:hover,#ep-template-btn[aria-expanded="true"]{ background:var(--ep-accent); color:#fff; }
        #ep-template-menu{ position:fixed; z-index:99999; width:230px; padding:8px 0; background:#fff; border:1px solid var(--ep-line);
            border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,.2); font-size:13.5px; animation:ep-rise .15s ease; max-height:70vh; overflow:auto; }
        #ep-template-menu input{ display:block; width:calc(100% - 20px); margin:2px 10px 6px; padding:7px 10px; border:1px solid var(--ep-line);
            border-radius:7px; font:13px var(--ep-font); outline:none; }
        #ep-template-menu input:focus{ border-color:var(--ep-accent); }
        .ep-tpl-item{ padding:8px 16px; cursor:pointer; color:var(--ep-ink); display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .ep-tpl-item:hover,.ep-tpl-item:focus{ background:var(--ep-soft); color:var(--ep-accent); outline:none; }
        .ep-tpl-empty{ padding:8px 16px; color:var(--ep-muted); font-size:12.5px; }
        .ep-tpl-tag{ font-size:10px; font-weight:700; color:var(--ep-muted); border:1px solid var(--ep-line); border-radius:5px; padding:1px 5px; flex:none; }

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

        @media (prefers-reduced-motion:reduce){ .ep-overlay,.ep-modal,.ep-body,.ep-toast,.ep-panel,#ep-template-menu,.ep-mgr-row,.ep-ed-field-row{ animation:none !important; } }
        `;
        document.head.appendChild(style);
    }

    /* ============================ Diyalog / Sihirbaz ============================
       Tek bileşen: 1 adım = form, çok adım = sihirbaz. Sonuçta {alanId: değer} döner, iptalde null. */

    function runWizard(steps, { submitLabel = 'Kaydet', cancelLabel = 'Vazgeç', danger = false, overlayClass = '' } = {}) {
        return new Promise((resolve) => {
            let idx = 0;
            const values = {};
            const multi = steps.length > 1;
            const overlay = el('div', `ep-overlay ${overlayClass}`.trim());
            const modal = el('div', 'ep-modal');
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
                const secret = f.type === 'password';
                return `
                <label class="ep-field"><span>${esc(f.label)}${f.required === false ? ' <em>(isteğe bağlı)</em>' : ''}</span>
                    <span class="ep-input-wrap">
                        <input id="ep-f-${esc(f.id)}" type="text" name="ep_${esc(f.id)}_${Math.random().toString(36).slice(2, 8)}"
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
                        ${(step.fields || []).map(fieldHTML).join('')}
                        <div class="ep-err" role="alert"></div>
                    </div>
                    <div class="ep-actions">
                        <button type="button" class="ep-btn ep-btn-secondary" data-act="back">${idx > 0 ? 'Geri' : esc(cancelLabel)}</button>
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
                        const raw = input.hasAttribute('data-secret') ? input.value : input.value.trim();
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

                modal.querySelector('[data-act="next"]').onclick = next;
                modal.querySelector('[data-act="back"]').onclick = goBack;
                modal.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); }));
                setTimeout(() => (modal.querySelector('input') || modal.querySelector('[data-act="next"]')).focus(), 30);
            }

            render();
        });
    }

    /* ============================ Şifreleme katmanı ============================ */

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const bufToB64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
    const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

    // -- IndexedDB: bu tarayıcıya özel, dışarı aktarılamayan AES anahtarı --
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
        try {
            const v = JSON.parse(raw);
            const key = await getDeviceKey(false);
            if (!key) throw new Error('anahtar yok');
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(v.iv) }, key, b64ToBuf(v.data));
            return JSON.parse(dec.decode(plain));
        } catch (_) { return 'broken'; }
    }

    // -- Ayar parolası: yalnızca düzenleme ekranını korur --
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

    // -- Eski sürüm (v4: ana parola ile şifreli) çözücü --
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
        { id: 'pw1', label: 'Ayar parolası', type: 'password', placeholder: 'En az 4 karakter',
          validate: (v) => (v.length < 4 ? 'En az 4 karakter olmalı.' : null) },
        { id: 'pw2', label: 'Ayar parolası (tekrar)', type: 'password',
          validate: (v, all) => (v !== all.pw1 ? 'Parolalar eşleşmiyor.' : null) },
    ];

    async function runSetup() {
        const v = await runWizard([
            { title: 'EBYS Plus - Kurulum', subtitle: 'EBYS sistemine ait giriş bilgilerinizi giriniz.', fields: CRED_FIELDS.slice(0, 2) },
            { title: 'e-İmza ve KEP', subtitle: 'Kullanmıyorsanız boş bırakabilirsiniz.', fields: CRED_FIELDS.slice(2) },
            { title: 'Ayarlar parolasını belirleyin',
              subtitle: 'kayıtlı bilgileri güncellemek için gerekir.',
              fields: passwordFields() },
        ], { submitLabel: 'Kurulumu tamamla' });
        if (!v) return null;
        const creds = pickCreds(v);
        await saveCreds(creds);
        await savePassword(v.pw1);
        toast('Kurulum tamamlandı. Bilgileriniz şifrelenerek kaydedildi.');
        return creds;
    }

    // Eski sürümlerden otomatik geçiş; yoksa ilk kurulum
    async function bootstrap() {
        if (sessionStorage.getItem('ep_skip_setup')) return null;

        const oldRaw = store.get(KEYS.oldVault, '');
        if (oldRaw) {
            let vault; try { vault = JSON.parse(oldRaw); } catch (_) { vault = null; }
            if (vault) {
                toast('Önceki sürümün kaydı bulundu. Son kez ana parolanız istenecek.', 'info');
                for (let i = 0; i < 3; i++) {
                    const r = await runWizard([{ title: 'Ana parolanız', subtitle: 'Bu parola bundan sonra "ayar parolası" olarak kullanılacak; girişte sorulmayacak.',
                        fields: [{ id: 'p', label: 'Ana parola', type: 'password' }] }], { submitLabel: 'Devam' });
                    if (!r) break;
                    try {
                        const creds = pickCreds(await legacyDecrypt(r.p, vault));
                        await saveCreds(creds);
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
            const r = await runWizard([{ title: 'Ayarlar parolasını belirleyin',
                subtitle: 'Yalnızca kayıtlı bilgileri değiştirmek veya silmek için gerekir.', fields: passwordFields() }],
                { submitLabel: 'Kaydet' });
            if (!r) { sessionStorage.setItem('ep_skip_setup', '1'); return null; }
            const creds = pickCreds(Object.fromEntries(LEGACY_PLAIN_KEYS.map((k) => [k, store.get(k)])));
            await saveCreds(creds);
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

    // Düzenleme / silme öncesi ayar parolası (5 dk hatırlanır)
    async function requireAccess() {
        if (Date.now() < EP.unlockedUntil || !store.get(KEYS.pw)) return true;
        for (let i = 0; i < 3; i++) {
            const r = await runWizard([{ title: 'Ayarlar parolası', subtitle: 'Lütfen Sistem Parolasını Giriniz.',
                fields: [{ id: 'p', label: 'Ayar parolası', type: 'password' }] }], { submitLabel: 'Onayla' });
            if (!r) return false;
            if (await verifyPassword(r.p)) { EP.unlockedUntil = Date.now() + UNLOCK_MS; return true; }
            toast(`Ayar parolası hatalı (${i + 1}/3).`, 'error');
        }
        return false;
    }

    /* ============================ Ayarlar menüsü ============================ */

    function buildMenu() {
        if (document.getElementById('ep-fab')) return;

        const fab = el('button', 'ep-fab', '📑 EBYS Plus');
        fab.id = 'ep-fab';
        fab.type = 'button';
        fab.setAttribute('aria-haspopup', 'true');

        const panel = el('div', 'ep-panel', `
            <div class="ep-panel-head"><strong>📑 EBYS Plus</strong><span class="ep-status" id="ep-status"></span></div>
            <label class="ep-switch"><span>🔌 Sistem Aktif</span><input type="checkbox" id="ep-auto"></label>
            <button type="button" class="ep-item" data-act="edit">📝 Kayıtlı bilgileri düzenle</button>
            <button type="button" class="ep-item" data-act="templates">🗂️ Şablonları düzenle</button>
            <button type="button" class="ep-item" data-act="password">🔑 Ayar parolasını değiştir</button>
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
                const v = await runWizard([{ title: 'Kayıtlı bilgileri düzenle', subtitle: 'Değişiklikler şifrelenerek kaydedilir.',
                    fields: CRED_FIELDS.map((f) => ({ ...f, value: EP.creds[f.id] })) }]);
                if (!v) return;
                EP.creds = pickCreds(v);
                await saveCreds(EP.creds);
                EP.clicked = {}; EP.halted = false; sessionStorage.removeItem('ep_attempts');
                toast('Bilgiler güncellendi.');
                refreshStatus();
            }

            if (act === 'templates') {
                await openTemplateManager();
            }

            if (act === 'password') {
                if (!EP.creds) return toast('Önce kurulum yapın.', 'error');
                if (!(await requireAccess())) return;
                const v = await runWizard([{ title: 'Yeni ayar parolası', fields: passwordFields() }]);
                if (!v) return;
                await savePassword(v.pw1);
                toast('Ayar parolası değiştirildi.');
            }

            if (act === 'wipe') {
                if (!(await requireAccess())) return;
                const ok = await runWizard([{ title: 'Tüm veriler silinsin mi?',
                    subtitle: 'Kayıtlı bilgiler, şifreleme anahtarı ve ayar parolası bu tarayıcıdan kaldırılır (şablonlarınız korunur). Bu işlem geri alınamaz.', fields: [] }],
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

    // Hatalı bilgiyle sonsuz yeniden yükleme döngüsünü engeller: 60 sn içinde en fazla 2 deneme
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
        if (!isLoginPage || !EP.creds || EP.halted || store.get(KEYS.enabled, '1') === '0') return;
        const c = EP.creds;

        // e-İmza PIN
        fill(document.getElementById('txtPinKod'), c.e_imza, true);

        // KEP
        const kepA = fill(document.getElementById('passwordParola'), c.kep_parola, true);
        const kepB = fill(document.getElementById('passwordSifre'), c.kep_sifre, true);
        if (kepA && kepB && !EP.clicked.kep) {
            const btn = document.querySelector('button[id="kepLogin2FormId:j_idt385"]') || document.querySelector('button[id^="kepLogin2FormId:"]');
            if (btn && canAttempt('kep')) { EP.clicked.kep = true; btn.click(); }
        }

        // EBYS kullanıcı adı / şifre
        const user = document.querySelector('input[name="parolaSertifikaAccordion:uForm:txtUKullaniciAdi"]');
        const pass = document.getElementById('loginUSifre');
        if (user && pass && c.kullanici_adi && c.sifre) {
            fill(user, c.kullanici_adi);
            fill(pass, c.sifre);
            if (!EP.clicked.login) {
                const btn = (pass.form && pass.form.querySelector('button[type="submit"]')) || document.querySelector('button[type="submit"]');
                if (btn && canAttempt('login')) { EP.clicked.login = true; btn.click(); }
            }
        }
    }

    /* ======================== Evrak açıklamasını otomatik doldur ======================== */

    const ACIKLAMA_PAIRS = [
        { label: 'windowCevapEvrakForm:evrakEkTabView:dosyaAdi', area: 'windowCevapEvrakForm:evrakEkTabView:dosyaAciklama' },
        { label: 'inboxItemInfoForm:evrakEkTabView:dosyaAdi', area: 'inboxItemInfoForm:evrakEkTabView:dosyaAciklama' },
    ];
    const aciklamaState = {}; // area id -> { seen, auto, edited }

    function initAciklama() {
        // Kullanıcı elle yazdıysa üzerine yazma (isTrusted: yalnızca gerçek kullanıcı girişi)
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
            const text = label.textContent.trim();
            if (!text) return;
            const st = (aciklamaState[p.area] ||= {});
            if (st.seen !== text) { st.seen = text; st.edited = false; }   // yeni dosya seçildi
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

    /* ============================ Şablon Plus ============================
       Her şablon: { id, text, fields:[{id,label,value}], content, builtin }
       content içinde {{alanId}} yer tutucuları, oluşturma sırasında girilen
       değerlerle (HTML-güvenli biçimde) değiştirilir. {{TAB}} sabit girinti
       görselini ekler. */

    const TAB = '<img data-cke-saved-src="/edys-web/images/blankTab.png" src="/edys-web/images/blankTab.png" style="height:1px;width:46px">';
    const bugun = () => { const t = new Date(); return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`; };

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
        return { id: String(raw.id || genId()), text, fields, content, builtin: !!raw.builtin };
    }

    function renderContent(tpl, values) {
        return String(tpl.content || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, id) => {
            if (id === 'TAB') return TAB;
            return esc(values[id] ?? '');
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
                if (Array.isArray(arr) && arr.length) {
                    const norm = arr.map(normalizeTemplate).filter(Boolean);
                    if (norm.length) return norm;
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
            try { body = f.contentDocument?.querySelector('body[role="textbox"][contenteditable="true"].cke_editable') || body; }
            catch (_) { /* farklı origin */ }
        });
        return body;
    }

    function insertHTML(html) {
        const body = findEditor();
        if (!body) { toast('Editör alanı bulunamadı. Önce cevap evrakı ekranını açın.', 'error'); return; }
        // CKEditor API'si varsa kullan: form gönderilirken içerik gerçekten kaydedilir
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
        if (!tpl.fields.length) { insertHTML(renderContent(tpl, {})); return; }
        const fields = tpl.fields.map((f) => ({ ...f, required: false, value: f.value === '@today' ? bugun() : f.value }));
        const v = await runWizard([{ title: `${tpl.text} bilgileri`, fields }], { submitLabel: 'Oluştur' });
        if (!v) return;
        insertHTML(renderContent(tpl, v));
    }

    let closeTimer = null;
    const closeMenu = () => {
        document.getElementById('ep-template-menu')?.remove();
        document.getElementById('ep-template-btn')?.setAttribute('aria-expanded', 'false');
    };
    const scheduleClose = () => { clearTimeout(closeTimer); closeTimer = setTimeout(closeMenu, 220); };

    function openTemplateMenu(btn) {
        clearTimeout(closeTimer);
        if (document.getElementById('ep-template-menu')) return;
        btn.setAttribute('aria-expanded', 'true');
        const rect = btn.getBoundingClientRect();
        const menu = el('div');
        menu.id = 'ep-template-menu';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 240))}px`;

        const search = el('input');
        search.type = 'text'; search.placeholder = 'Şablon ara…'; search.setAttribute('aria-label', 'Şablon ara');
        menu.appendChild(search);

        const empty = el('div', 'ep-tpl-empty', EP.templates.length ? 'Sonuç yok' : 'Henüz şablon yok. EBYS Plus panelinden ekleyebilirsiniz.');
        empty.hidden = EP.templates.length > 0;
        const items = EP.templates.map((tpl) => {
            const it = el('div', 'ep-tpl-item');
            it.innerHTML = `<span>${esc(tpl.text)}</span>${tpl.fields.length ? `<span class="ep-tpl-tag">${tpl.fields.length} alan</span>` : ''}`;
            it.tabIndex = 0;
            const go = () => { closeMenu(); runTemplate(tpl); };
            it.onclick = go;
            it.onkeydown = (e) => { if (e.key === 'Enter') go(); };
            menu.appendChild(it);
            return { it, key: tpl.text.toLocaleLowerCase('tr') };
        });
        menu.appendChild(empty);

        search.addEventListener('input', () => {
            const q = search.value.toLocaleLowerCase('tr').trim();
            let shown = 0;
            items.forEach(({ it, key }) => { const ok = key.includes(q); it.hidden = !ok; if (ok) shown++; });
            empty.hidden = shown > 0;
            empty.textContent = EP.templates.length ? 'Sonuç yok' : 'Henüz şablon yok. EBYS Plus panelinden ekleyebilirsiniz.';
        });
        search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
        menu.addEventListener('mouseenter', () => clearTimeout(closeTimer));
        menu.addEventListener('mouseleave', scheduleClose);
        document.body.appendChild(menu);
        setTimeout(() => search.focus(), 10);
    }

    function syncTemplateButton() {
        const ref = document.getElementById('windowCevapEvrakForm:cevapEvrakTabMenuRight:cevapEvrakTabMenuRight');
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
        // options: [{key,label,primary}]  -> tıklanan key ile veya 'cancel' ile döner
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
                b.onclick = () => { overlay.remove(); resolve(o.key); };
                box.appendChild(b);
            });
            const cancelBtn = el('button', 'ep-btn ep-btn-secondary', 'Vazgeç');
            cancelBtn.type = 'button';
            cancelBtn.onclick = () => { overlay.remove(); resolve('cancel'); };
            box.appendChild(cancelBtn);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve('cancel'); } };
            document.addEventListener('keydown', onKey, true);
        });
    }

        function openTemplateEditor(existing) {
        return new Promise((resolve) => {
            const isNew = !existing;
            const working = existing
                ? { ...JSON.parse(JSON.stringify(existing)), builtin: false }
                : { id: genId(), text: '', fields: [], content: '', builtin: false };

            const overlay = el('div', 'ep-overlay ep-overlay-2');
            const modal = el('div', 'ep-modal ep-modal-xl');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const close = (result) => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('selectionchange', refreshTools);
                overlay.remove();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); close(null); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); modal.querySelector('#ep-ed-save').click(); }
            };
            document.addEventListener('keydown', onKey, true);

            const TOOLS = [
                { cmd: 'bold', label: '<b>B</b>', title: 'Kalın (Ctrl+B)', state: 1 },
                { cmd: 'italic', label: '<i>I</i>', title: 'İtalik (Ctrl+I)', state: 1 },
                { cmd: 'underline', label: '<u>U</u>', title: 'Altı çizili (Ctrl+U)', state: 1 },
                'sep',
                { cmd: 'justifyLeft', label: 'Sol', title: 'Sola hizala', state: 1 },
                { cmd: 'justifyCenter', label: 'Orta', title: 'Ortala', state: 1 },
                { cmd: 'justifyRight', label: 'Sağ', title: 'Sağa hizala', state: 1 },
                { cmd: 'justifyFull', label: 'Yasla', title: 'İki yana yasla', state: 1 },
                'sep',
                { cmd: 'insertUnorderedList', label: '• Liste', title: 'Madde işaretli liste', state: 1 },
                { cmd: 'insertOrderedList', label: '1. Liste', title: 'Numaralı liste', state: 1 },
                { cmd: 'outdent', label: '⇤', title: 'Girintiyi azalt' },
                { cmd: 'indent', label: '⇥', title: 'Girintiyi artır' },
                { cmd: 'tab', label: 'Sekme', title: 'Paragraf başı girinti ({{TAB}}) ekle' },
                'sep',
                { cmd: 'undo', label: '↶', title: 'Geri al (Ctrl+Z)' },
                { cmd: 'redo', label: '↷', title: 'Yinele (Ctrl+Y)' },
                { cmd: 'removeFormat', label: 'Tx', title: 'Biçimi temizle' },
            ];
            const toolsHTML = TOOLS.map((t) => t === 'sep' ? '<span class="ep-tb-sep"></span>'
                : `<button type="button" class="ep-tb" data-cmd="${t.cmd}" ${t.state ? 'data-state="1"' : ''} title="${esc(t.title)}">${t.label}</button>`).join('');

            modal.innerHTML = `
                <h3>${isNew ? 'Yeni Şablon' : 'Şablonu Düzenle'}</h3>
                <p class="ep-sub">Metni Word gibi biçimlendirin; isterseniz “HTML Kodu” sekmesinden doğrudan kod yazın. Kaydetmek için Ctrl+Enter.</p>
                <div class="ep-ed-grid">
                    <div class="ep-ed-side">
                        <label class="ep-field"><span>Şablon adı</span>
                            <span class="ep-input-wrap"><input id="ep-ed-name" type="text" value="${esc(working.text)}" placeholder="Örn. Tapu Kaydı Talebi" autocomplete="off"></span>
                        </label>
                        <div class="ep-ed-label">Alanlar (isteğe bağlı)</div>
                        <div id="ep-ed-fields"></div>
                        <button type="button" class="ep-btn ep-btn-secondary" id="ep-ed-addfield">+ Alan ekle</button>
                        <div class="ep-ed-hint">Alan ekleyince altta beliren rozete tıklayarak metne yerleştirirsiniz. Varsayılan değere <code>@today</code> yazarsanız bugünün tarihi gelir.</div>
                    </div>
                    <div class="ep-ed-main">
                        <div class="ep-ed-tabs">
                            <button type="button" class="ep-ed-tab" data-mode="visual">Görsel</button>
                            <button type="button" class="ep-ed-tab" data-mode="code">HTML Kodu</button>
                            <button type="button" class="ep-ed-tab" data-mode="preview">Önizleme</button>
                        </div>
                        <div class="ep-ed-toolbar" id="ep-ed-toolbar">${toolsHTML}</div>
                        <div class="ep-wys" id="ep-wys" contenteditable="true" spellcheck="true"></div>
                        <textarea id="ep-ed-content" class="ep-ed-content" spellcheck="false" hidden placeholder="HTML kodunu buraya yazın… örn. {{il}} ili, {{ilce}} ilçesi"></textarea>
                        <div class="ep-ed-preview" id="ep-ed-preview" hidden></div>
                        <div class="ep-ed-chips" id="ep-ed-chips"></div>
                    </div>
                </div>
                <div class="ep-err" id="ep-ed-err" role="alert"></div>
                <div class="ep-actions">
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

            const TAB_MARK = '<span class="ep-tabmark" contenteditable="false" data-ep-tab="1">&nbsp;</span>';
            const toVisual = (html) => html.replace(/\{\{\s*TAB\s*\}\}/g, TAB_MARK);
            const fromVisual = () => {
                const clone = wys.cloneNode(true);
                clone.querySelectorAll('[data-ep-tab]').forEach((n) => n.replaceWith(document.createTextNode('{{TAB}}')));
                return clone.innerHTML;
            };

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
                previewEl.innerHTML = rendered.trim() ? rendered : '<span class="ep-mgr-row-sub">Önizleme için içerik girin…</span>';
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
            }
            modal.querySelectorAll('.ep-ed-tab').forEach((t) => { t.onclick = () => setMode(t.dataset.mode); });

            // --- Araç çubuğu ---
            try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* yok say */ }
            toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('.ep-tb')) e.preventDefault(); });
            toolbar.addEventListener('click', (e) => {
                const b = e.target.closest('.ep-tb');
                if (!b || mode !== 'visual') return;
                wys.focus();
                const cmd = b.dataset.cmd;
                if (cmd === 'tab') { document.execCommand('insertHTML', false, TAB_MARK); return; }
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

            // Word'den yapıştırılan gereksiz biçimleri temizle: düz metin olarak yapıştır
            wys.addEventListener('paste', (e) => {
                e.preventDefault();
                const t = (e.clipboardData || window.clipboardData).getData('text/plain');
                document.execCommand('insertText', false, t);
            });

            // --- Alanlar ---
            function renderFieldRows() {
                fieldsList.innerHTML = '';
                working.fields.forEach((f, i) => {
                    const row = el('div', 'ep-ed-field-row');
                    row.innerHTML = `
                        <input type="text" data-k="label" placeholder="Alan adı" value="${esc(f.label)}">
                        <input type="text" data-k="value" placeholder="Varsayılan" value="${esc(f.value)}">
                        <button type="button" class="ep-icon-btn ep-icon-btn-danger" title="Alanı sil" aria-label="Alanı sil"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
                    row.querySelector('[data-k="label"]').addEventListener('input', (e) => {
                        f.label = e.target.value;
                        f.id = uniqueFieldId(working.fields.filter((x) => x !== f), slugify(f.label) || f.id);
                        renderChips();
                    });
                    row.querySelector('[data-k="value"]').addEventListener('input', (e) => { f.value = e.target.value; });
                    row.querySelector('button').onclick = () => { working.fields.splice(i, 1); renderFieldRows(); renderChips(); };
                    fieldsList.appendChild(row);
                });
            }

            function renderChips() {
                chipsBox.innerHTML = '';
                working.fields.forEach((f) => {
                    const chip = el('span', 'ep-ed-chip', `{{${esc(f.id)}}}`);
                    chip.title = `Metne eklemek için tıklayın${f.label ? `: ${f.label}` : ''}`;
                    chip.onmousedown = (e) => e.preventDefault();
                    chip.onclick = () => {
                        const token = `{{${f.id}}}`;
                        if (mode === 'visual') { wys.focus(); document.execCommand('insertText', false, token); }
                        else if (mode === 'code') insertAtCursor(codeEl, token);
                    };
                    chipsBox.appendChild(chip);
                });
            }

            addFieldBtn.onclick = () => {
                working.fields.push({ id: uniqueFieldId(working.fields, 'alan'), label: '', value: '' });
                renderFieldRows(); renderChips();
                setTimeout(() => fieldsList.querySelector('.ep-ed-field-row:last-child input')?.focus(), 10);
            };

            modal.querySelector('#ep-ed-cancel').onclick = () => close(null);
            modal.querySelector('#ep-ed-save').onclick = () => {
                pull();
                const text = nameEl.value.trim();
                if (!text) { errEl.textContent = 'Şablon adı gerekli.'; nameEl.focus(); return; }
                if (!html.replace(/<br\s*\/?>|<\/?p>|&nbsp;|\s/gi, '')) { errEl.textContent = 'İçerik boş olamaz.'; return; }
                if (working.fields.some((f) => !f.label.trim())) { errEl.textContent = 'Tüm alanların bir adı olmalı (ya da boş alanı silin).'; return; }
                working.text = text;
                working.content = html;
                close(normalizeTemplate(working));
            };
            nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') modal.querySelector('#ep-ed-save').click(); });

            renderFieldRows(); renderChips();
            setMode('visual');
            setTimeout(() => nameEl.focus(), 30);
        });
    }

    function openTemplateManager() {
        return new Promise((resolve) => {
            let list = EP.templates.map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f })) })); // çalışma kopyası
            let filtered = list.slice();

            const overlay = el('div', 'ep-overlay');
            const modal = el('div', 'ep-modal ep-modal-wide');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = `
                <h3>Şablon Yönetimi</h3>
                <p class="ep-sub">Evrak açıklamalarında kullandığınız şablonları buradan ekleyin, düzenleyin, sıralayın veya JSON olarak içe/dışa aktarın.</p>
                <div class="ep-mgr-toolbar">
                    <input type="text" class="ep-mgr-search" id="ep-mgr-search" placeholder="Şablon ara…" autocomplete="off">
                    <button type="button" class="ep-btn ep-btn-primary" id="ep-mgr-new">+ Yeni Şablon</button>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-import">İçe Aktar</button>
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-export">Dışa Aktar</button>
                </div>
                <div class="ep-mgr-list" id="ep-mgr-list"></div>
                <div class="ep-actions">
                    <button type="button" class="ep-btn ep-btn-secondary" id="ep-mgr-cancel">Kapat</button>
                    <button type="button" class="ep-btn ep-btn-primary" id="ep-mgr-save">Kaydet ve Kapat</button>
                </div>`;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const fileInput = el('input');
            fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.hidden = true;
            document.body.appendChild(fileInput);

            const onKey = (e) => { if (e.key === 'Escape') doClose(); };
            document.addEventListener('keydown', onKey, true);
            const doClose = () => {
                document.removeEventListener('keydown', onKey, true);
                fileInput.remove();
                overlay.remove();
                resolve();
            };

            const searchEl = modal.querySelector('#ep-mgr-search');
            const listEl = modal.querySelector('#ep-mgr-list');

            function applyFilter() {
                const q = searchEl.value.toLocaleLowerCase('tr').trim();
                filtered = q ? list.filter((t) => t.text.toLocaleLowerCase('tr').includes(q)) : list.slice();
                renderRows();
            }

            let highlightId = null;
            function renderRows() {
                const prevScroll = listEl.scrollTop;
                listEl.innerHTML = '';
                if (!filtered.length) {
                    listEl.appendChild(el('div', 'ep-mgr-empty', list.length ? 'Aramanızla eşleşen şablon yok.' : 'Henüz şablon yok. “+ Yeni Şablon” ile ekleyin.'));
                    return;
                }
                filtered.forEach((tpl) => {
                    const idxInList = list.indexOf(tpl);
                    const row = el('div', 'ep-mgr-row');
                    row.innerHTML = `
                        <div class="ep-mgr-row-main">
                            <div class="ep-mgr-row-title">${esc(tpl.text)}${tpl.builtin ? '<span class="ep-badge">Varsayılan</span>' : ''}</div>
                            <div class="ep-mgr-row-sub">${tpl.fields.length ? `${tpl.fields.length} alan` : 'Sabit metin, alan yok'}</div>
                            <div class="ep-mgr-row-snip">${esc(tpl.content.replace(/\{\{\s*TAB\s*\}\}/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110))}…</div>
                        </div>
                        <div class="ep-mgr-row-actions">
                            <button type="button" class="ep-icon-btn" data-act="up" title="Yukarı taşı" aria-label="Yukarı taşı" ${idxInList === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
                            <button type="button" class="ep-icon-btn" data-act="down" title="Aşağı taşı" aria-label="Aşağı taşı" ${idxInList === list.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></button>
                            <button type="button" class="ep-icon-btn" data-act="dup" title="Kopyala" aria-label="Kopyala"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
                            <button type="button" class="ep-icon-btn" data-act="edit" title="Düzenle" aria-label="Düzenle"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
                            <button type="button" class="ep-icon-btn ep-icon-btn-danger" data-act="del" title="Sil" aria-label="Sil"><svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
                        </div>`;

                    row.querySelector('[data-act="up"]').onclick = () => {
                        if (idxInList > 0) {
                            [list[idxInList - 1], list[idxInList]] = [list[idxInList], list[idxInList - 1]];
                            highlightId = tpl.id; applyFilter();
                            const b = listEl.querySelector('.ep-row-hl [data-act="up"]:not(:disabled)') || listEl.querySelector('.ep-row-hl [data-act="down"]');
                            if (b) b.focus({ preventScroll: true });
                        }
                    };
                    row.querySelector('[data-act="down"]').onclick = () => {
                        if (idxInList < list.length - 1) {
                            [list[idxInList + 1], list[idxInList]] = [list[idxInList], list[idxInList + 1]];
                            highlightId = tpl.id; applyFilter();
                            const b = listEl.querySelector('.ep-row-hl [data-act="down"]:not(:disabled)') || listEl.querySelector('.ep-row-hl [data-act="up"]');
                            if (b) b.focus({ preventScroll: true });
                        }
                    };
                    row.querySelector('[data-act="dup"]').onclick = () => {
                        const copy = normalizeTemplate({ ...tpl, id: genId(), text: `${tpl.text} (kopya)`, builtin: false });
                        list.splice(idxInList + 1, 0, copy);
                        highlightId = copy.id;
                        applyFilter();
                    };
                    row.querySelector('[data-act="edit"]').onclick = async () => {
                        const edited = await openTemplateEditor(tpl);
                        if (edited) { list[idxInList] = edited; highlightId = edited.id; applyFilter(); }
                    };
                    row.querySelector('[data-act="del"]').onclick = () => {
                        const actions = row.querySelector('.ep-mgr-row-actions');
                        const confirmBox = el('span', 'ep-mgr-confirm');
                        confirmBox.innerHTML = `Silinsin mi? <button type="button" class="yes">Evet</button><button type="button" class="no">Vazgeç</button>`;
                        actions.replaceChildren(confirmBox);
                        confirmBox.querySelector('.yes').onclick = () => {
                            row.classList.add('ep-row-out');
                            setTimeout(() => { list.splice(idxInList, 1); applyFilter(); }, 180);
                        };
                        confirmBox.querySelector('.no').onclick = () => applyFilter();
                    };

                    if (tpl.id === highlightId) row.classList.add('ep-row-hl');
                    listEl.appendChild(row);
                });
                listEl.scrollTop = prevScroll;
                const hl = listEl.querySelector('.ep-row-hl');
                if (hl) hl.scrollIntoView({ block: 'nearest' });
                highlightId = null;
            }

            searchEl.addEventListener('input', debounce(applyFilter, 120));

            modal.querySelector('#ep-mgr-new').onclick = async () => {
                const created = await openTemplateEditor(null);
                if (created) { list.push(created); applyFilter(); }
            };

            modal.querySelector('#ep-mgr-export').onclick = () => {
                if (!list.length) return toast('Dışa aktarılacak şablon yok.', 'error');
                const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = el('a'); a.href = url; a.download = `ebys-plus-sablonlar-${bugun().replace(/\//g, '-')}.json`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
                toast(`${list.length} şablon dışa aktarıldı.`);
            };

            modal.querySelector('#ep-mgr-import').onclick = () => fileInput.click();
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                fileInput.value = '';
                if (!file) return;
                let parsed;
                try { parsed = JSON.parse(await file.text()); } catch (_) { toast('Dosya okunamadı, geçerli bir JSON olmalı.', 'error'); return; }
                const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.templates) ? parsed.templates : null);
                if (!arr) { toast('Dosya biçimi tanınmadı.', 'error'); return; }
                const incoming = arr.map((t) => normalizeTemplate({ ...t, builtin: false, id: genId() })).filter(Boolean);
                if (!incoming.length) { toast('İçe aktarılabilir geçerli şablon bulunamadı.', 'error'); return; }
                const choice = await confirmChoice('Şablonlar içe aktarılıyor', `${incoming.length} geçerli şablon bulundu. Nasıl eklensin?`, [
                    { key: 'merge', label: 'Mevcutlara ekle', primary: true },
                    { key: 'replace', label: 'Hepsinin yerine geç' },
                ]);
                if (choice === 'cancel') return;
                if (choice === 'replace') list = incoming; else list.push(...incoming);
                applyFilter();
                toast(`${incoming.length} şablon içe aktarıldı.`);
            };

            modal.querySelector('#ep-mgr-cancel').onclick = doClose;
            modal.querySelector('#ep-mgr-save').onclick = () => {
                if (saveTemplates(list)) {
                    EP.templates = list;
                    toast('Şablonlar kaydedildi.');
                    doClose();
                }
            };

            applyFilter();
        });
    }

    /* ============================ Başlatma ============================ */

    // Tek bir gözlemci: sayfa her değiştiğinde (JSF/PrimeFaces ajax) ilgili modülleri çalıştırır
    function tick() {
        autoFill();
        if (!isLoginPage) { autoAciklama(); syncTemplateButton(); }
    }

    async function init() {
        injectStyles();
        EP.templates = loadTemplates();
        buildMenu();
        if (!isLoginPage) initAciklama();

        new MutationObserver(debounce(tick, 150)).observe(document.body, { childList: true, subtree: true });

        let creds = await loadCreds();
        if (creds === 'broken') {
            toast('Kayıtlı bilgiler bu tarayıcıda çözülemedi (tarayıcı verileri temizlenmiş olabilir). Yeniden kurulum gerekiyor.', 'error');
            store.remove(KEYS.vault);
            creds = null;
        }
        if (!creds && isLoginPage) creds = await bootstrap();

        EP.creds = creds;
        refreshStatus();
        tick();
    }

    init();
})();
