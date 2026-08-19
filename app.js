// ── ShopPOS Engine & UI Controller v3.1 — Professional Retail POS ──

// ── FIREBASE INTEGRATION ─────────────────────────
const FB = {
  apiKey: "AIzaSyCNJDhEnnTu7bwbSv7F0loK_o138Xm8Xyw",
  authDomain: "project-1a18b653-3b65-4a41-aeb.firebaseapp.com",
  projectId: "project-1a18b653-3b65-4a41-aeb",
  storageBucket: "project-1a18b653-3b65-4a41-aeb.firebasestorage.app",
  messagingSenderId: "416088254477",
  appId: "1:416088254477:web:915c0274da7f3168964d44",
  measurementId: "G-XWDQ302GFK"
};
let db = null, fbOn = false, fbUser = null;

function initFB() {
  if (typeof firebase === 'undefined' || !FB.apiKey) return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    firebase.auth().onAuthStateChanged(user => {
      fbUser = user;
      fbOn = Boolean(user);
      syncStatus(Boolean(user));
      if (user) cloudPull();
    });
    if (!firebase.auth().currentUser) {
      firebase.auth().signInAnonymously().catch(() => {
        fbOn = false; syncStatus(false); toast('Cloud backup requires Firebase setup');
      });
    }
  } catch (e) { console.log('FB:', e); }
}

async function cloudPush() {
  if (!fbOn || !db || !fbUser) return;
  const sid = ST.settings.shopId;
  try {
    ST.settings.ownerUid = ST.settings.ownerUid || fbUser.uid;
    const shop = db.collection('shops').doc(sid);
    await shop.set({
      ownerUid: ST.settings.ownerUid,
      settings: ST.settings, products: ST.products, credits: ST.credits,
      suppliers: ST.suppliers, restocks: ST.restocks, staff: ST.staff,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await shop.collection('members').doc(fbUser.uid).set({
      role: ST.settings.ownerUid === fbUser.uid ? 'owner' : 'cashier', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const synced = new Set(ST.settings.syncedSaleIds || []);
    const pending = ST.sales.filter(s => !synced.has(String(s.id))).slice(0, 300);
    if (pending.length) {
      const b = db.batch();
      pending.forEach(s => b.create(shop.collection('sales').doc(String(s.id)), { ...s, cashierUid: fbUser.uid }));
      await b.commit();
      ST.settings.syncedSaleIds = [...synced, ...pending.map(s => String(s.id))].slice(-1000);
    }
    syncStatus(true);
  } catch (e) { syncStatus(false); }
}

async function cloudPull() {
  if (!fbOn || !db || !fbUser) return;
  const sid = ST.settings.shopId;
  try {
    const doc = await db.collection('shops').doc(sid).get();
    if (doc.exists) {
      const d = doc.data();
      if (d.products?.length) ST.products = d.products;
      if (d.credits?.length) ST.credits = d.credits;
      if (d.suppliers?.length) ST.suppliers = d.suppliers;
      if (d.restocks?.length) ST.restocks = d.restocks;
      if (d.staff?.length) ST.staff = d.staff;
      ST.settings = Object.assign({}, ST.settings, d.settings || {});
    }
    const ss = await db.collection('shops').doc(sid).collection('sales').orderBy('time', 'desc').limit(500).get();
    if (!ss.empty) {
      ST.sales = []; ss.forEach(d => ST.sales.push(d.data()));
      ST.settings.syncedSaleIds = ST.sales.map(s => String(s.id)).slice(0, 1000);
    }
    persist(); syncStatus(true);
  } catch (e) { syncStatus(false); }
}

function syncStatus(ok) {
  const d = document.getElementById('sync-dot'), l = document.getElementById('sync-lbl');
  const cd = document.getElementById('cloud-dot'), cs = document.getElementById('cloud-sub');
  const l2 = document.getElementById('sync-lbl2');
  if (d) d.style.background = ok ? '#10b981' : '#f59e0b';
  if (l) l.textContent = ok ? 'Live' : 'Offline';
  if (l2) { l2.textContent = ok && fbOn ? 'Synced' : ok ? 'Online' : 'Offline'; l2.className = 'badge ' + (ok && fbOn ? 'bg-green' : ok ? 'bg-blue' : 'bg-yellow'); }
  if (cd) cd.style.background = ok && fbOn ? '#10b981' : '#6b7280';
  if (cs) cs.textContent = ok && fbOn ? 'Cloud Backup Synced ✓' : fbOn ? 'Syncing…' : 'Configure Cloud Backup';
}

// ── SECURITY & PIN HASHING (SHA-256) ─────────────
async function hashPIN(pin) {
  if (!pin) return '';
  if (pin.length === 64 && /^[0-9a-f]{64}$/i.test(pin)) return pin.toLowerCase();
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode('shoppos_salt_v1_' + pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let h = 0; for (let i = 0; i < pin.length; i++) h = ((h << 5) - h) + pin.charCodeAt(i);
    return 'fallback_' + Math.abs(h);
  }
}

// ── STATE MANAGEMENT & STORAGE ───────────────────
const SK = 'shoppos_v3';
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const cleanText = v => String(v ?? '').replace(/[\u0000<>'"]/g, '').trim();

function sanitizeState(v) {
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map(sanitizeState);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, sanitizeState(val)]));
  return v;
}

function ensureOwnerAccess() {
  const owner = ST.staff.find(s => s.id === 'owner');
  if (owner) { owner.role = 'admin'; owner.active = true; }
}

function currentStaff() {
  return ST.staff.find(s => s.name === ST.settings.currentCashier && s.active !== false) || null;
}

function requireRole(...roles) {
  const staff = currentStaff();
  if (!staff || !roles.includes(staff.role)) {
    toast('This action requires ' + roles.join(' or ') + ' access');
    return false;
  }
  return true;
}

const DSETS = {
  shopName: 'Family Shop', shopAddr: 'Lusaka, Zambia', shopPhone: '', shopEmail: '',
  receiptMsg: 'Thank you for your purchase!', receiptSubheader: '',
  pin: '1234', shopId: 'shop_' + Date.now(), currentCashier: 'Owner',
  tpin: '', branchId: '', mrcNo: '', sdcId: '', vatRate: '16', taxType: 'none', catalogInitialized: false, categories: [], units: [], categoryIcons: {},
  receiptToggles: { tpin: true, mrc: true, sdc: true, tax: true, sig: true, qr: true, cashier: true, change: true, units: true, cust: true }
};

let ST = {
  products: [], sales: [], credits: [], suppliers: [], restocks: [], audit: [],
  staff: [{ id: 'owner', name: 'Owner', pin: '1234', role: 'admin', active: true }],
  settings: { ...DSETS }
};

// Shift Session Trackers
let sessionSalesCount = 0;
let sessionSalesTotal = 0;
let sessionCashTotal = 0;
let sessionMobileTotal = 0;

function persist() {
  ST = sanitizeState(ST); ensureOwnerAccess();
  try {
    localStorage.setItem(SK, JSON.stringify(ST));
  } catch (e) {
    console.warn('Storage error:', e);
    toast('Local storage full! Clear history or export CSV');
  }
  clearTimeout(persist._t);
  persist._t = setTimeout(cloudPush, 2500);
}

async function loadState() {
  try {
    const raw = localStorage.getItem(SK);
    if (raw) {
      const p = JSON.parse(raw);
      ST.products = p.products || []; ST.sales = p.sales || [];
      ST.credits = p.credits || []; ST.suppliers = p.suppliers || []; ST.restocks = p.restocks || [];
      ST.audit = p.audit || []; ST.staff = p.staff || ST.staff;
      ST.settings = Object.assign({}, DSETS, p.settings || {});
      ST.settings.receiptToggles = Object.assign({}, DSETS.receiptToggles, p.settings?.receiptToggles || {});
    }
  } catch (e) {}

  ST = sanitizeState(ST); ensureOwnerAccess();

  // One-time security migration of plaintext PINs
  for (let s of ST.staff) {
    if (s.pin && s.pin.length !== 64) {
      s.pin = await hashPIN(s.pin);
    }
  }

  if (!ST.products.length && !ST.settings.catalogInitialized) seedProds();
}

function addAudit(act, det, who) {
  ST.audit.unshift({ id: Date.now(), time: new Date().toISOString(), action: act, detail: det, cashier: who || ST.settings.currentCashier });
  if (ST.audit.length > 1000) ST.audit = ST.audit.slice(0, 1000);
}

// ── SEED DATA ───────────────────────────────────
const CEMOJI = { '🍺 Beer': '🍺', '🍷 Wine': '🍷', '🥃 Spirits': '🥃', '🥤 Soft Drinks': '🥤', '🛒 Groceries': '🛒', '🍿 Snacks': '🍿', '🚬 Cigarettes': '🚬', '🥩 Meat': '🥩', '🧴 Toiletries': '🧴', '📦 Other': '📦' };
const ICON_HINTS = [[/cloth|uniform|fashion/i, '👕'], [/shoe|footwear/i, '👟'], [/hardware|tool|build/i, '🔧'], [/phone|electronic|accessor/i, '📱'], [/pharm|medicine|health/i, '💊'], [/furniture|home/i, '🛋️'], [/food|bakery/i, '🍞'], [/service|salon/i, '💇']];
function GE(cat) { return ST.settings.categoryIcons?.[cat] || CEMOJI[cat] || ICON_HINTS.find(([pattern]) => pattern.test(cat))?.[1] || '📦'; }
function categoryLabel(cat) { return CEMOJI[cat] || /^[\u{1F000}-\u{1FAFF}]/u.test(cat) ? cat : `${GE(cat)} ${cat}`; }
const DEFAULT_CATEGORIES = ['🍺 Beer', '🍷 Wine', '🥃 Spirits', '🥤 Soft Drinks', '🛒 Groceries', '🍿 Snacks', '🚬 Cigarettes', '🥩 Meat', '🧴 Toiletries', '👕 Clothes', '👟 Shoes', '🔧 Hardware', '💊 Pharmacy', '💇 Services', '📦 Other'];
const DEFAULT_UNITS = ['each', 'pair', 'piece', 'bottle', 'pack', 'kg', 'gram', 'litre', 'metre', 'box', 'crate', 'dozen', 'bag', 'carton'];

function populateCategoryOptions() {
  const list = document.getElementById('pm-cat-list'); if (!list) return;
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...(ST.settings.categories || []), ...ST.products.map(p => p.cat)])].filter(Boolean);
  list.innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
}
function populateUnitOptions() {
  const list = document.getElementById('pm-unit-list'); if (!list) return;
  const units = [...new Set([...DEFAULT_UNITS, ...(ST.settings.units || []), ...ST.products.map(p => p.unit)])].filter(Boolean);
  list.innerHTML = units.map(u => `<option value="${esc(u)}"></option>`).join('');
}

function seedProds() {
  ST.settings.catalogInitialized = true;
  ST.products = [
    { id: 'p1', name: 'Castle Lager 330ml', cat: '🍺 Beer', price: 15, cost: 10, qty: 48, low: 10, unit: 'bottle', barcode: '', image: '' },
    { id: 'p2', name: 'Hunters Dry 330ml', cat: '🍺 Beer', price: 15, cost: 10, qty: 36, low: 10, unit: 'bottle', barcode: '', image: '' },
    { id: 'p3', name: 'Black Label 750ml', cat: '🍺 Beer', price: 28, cost: 18, qty: 24, low: 6, unit: 'bottle', barcode: '', image: '' },
    { id: 'p4', name: 'Flying Fish 330ml', cat: '🍺 Beer', price: 16, cost: 11, qty: 24, low: 8, unit: 'bottle', barcode: '', image: '' },
    { id: 'p5', name: 'Mosi Lager 500ml', cat: '🍺 Beer', price: 20, cost: 13, qty: 30, low: 8, unit: 'bottle', barcode: '', image: '' },
    { id: 'p6', name: 'Savanna Dry 330ml', cat: '🍺 Beer', price: 18, cost: 12, qty: 20, low: 5, unit: 'bottle', barcode: '', image: '' },
    { id: 'p7', name: 'Klipdrift 750ml', cat: '🥃 Spirits', price: 180, cost: 120, qty: 6, low: 2, unit: 'bottle', barcode: '', image: '' },
    { id: 'p8', name: 'Jameson 750ml', cat: '🥃 Spirits', price: 350, cost: 240, qty: 4, low: 1, unit: 'bottle', barcode: '', image: '' },
    { id: 'p9', name: 'Coca-Cola 500ml', cat: '🥤 Soft Drinks', price: 10, cost: 6, qty: 48, low: 12, unit: 'bottle', barcode: '', image: '' },
    { id: 'p10', name: 'Fanta Orange 500ml', cat: '🥤 Soft Drinks', price: 10, cost: 6, qty: 36, low: 12, unit: 'bottle', barcode: '', image: '' },
    { id: 'p11', name: 'Bread (loaf)', cat: '🛒 Groceries', price: 28, cost: 20, qty: 15, low: 5, unit: 'each', barcode: '', image: '' },
    { id: 'p12', name: 'Eggs (tray 30)', cat: '🛒 Groceries', price: 85, cost: 65, qty: 8, low: 2, unit: 'each', barcode: '', image: '' },
    { id: 'p13', name: 'Sugar 2kg', cat: '🛒 Groceries', price: 55, cost: 42, qty: 10, low: 3, unit: 'each', barcode: '', image: '' },
    { id: 'p14', name: 'Cooking Oil 2L', cat: '🛒 Groceries', price: 95, cost: 72, qty: 6, low: 2, unit: 'each', barcode: '', image: '' },
    { id: 'p15', name: 'Mealie Meal 10kg', cat: '🛒 Groceries', price: 130, cost: 100, qty: 8, low: 2, unit: 'each', barcode: '', image: '' },
    { id: 'p16', name: 'Simba Chips', cat: '🍿 Snacks', price: 8, cost: 5, qty: 40, low: 10, unit: 'each', barcode: '', image: '' },
    { id: 'p17', name: 'Marlboro (pack)', cat: '🚬 Cigarettes', price: 55, cost: 42, qty: 15, low: 5, unit: 'pack', barcode: '', image: '' }
  ]; persist();
}

// ── CLOCK & CALENDAR ─────────────────────────────
function updateClock() {
  const n = new Date();
  const hh = String(n.getHours()).padStart(2, '0'), mm = String(n.getMinutes()).padStart(2, '0'), ss = String(n.getSeconds()).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ds = `${DAYS[n.getDay()]}, ${n.getDate()} ${MONTHS[n.getMonth()]} ${n.getFullYear()}`;
  const pc = document.getElementById('pin-clock'), ps = document.getElementById('pin-sec'), pd = document.getElementById('pin-date'), tc = document.getElementById('tb-clock');
  if (pc) pc.textContent = `${hh}:${mm}`;
  if (ps) ps.textContent = ss;
  if (pd) pd.textContent = ds;
  if (tc) tc.textContent = `${hh}:${mm} · ${ds}`;
}
setInterval(updateClock, 1000); updateClock();

// ── BACKGROUND CUSTOMIZATION ─────────────────────
function setBG(inp) {
  const f = inp.files[0]; if (!f) return;
  resizeImageToThumbnail(f, 600, 0.7, (u) => {
    const bg = document.getElementById('pin-bg');
    bg.style.cssText = `position:fixed;inset:0;background-image:url(${u});background-size:cover;background-position:center;z-index:0`;
    try { localStorage.setItem('sppos_bg', u); } catch (err) { toast('Image too large to save persistently'); }
    toast('Background updated ✓');
  });
}
function loadBG() {
  const s = localStorage.getItem('sppos_bg');
  if (s) { const bg = document.getElementById('pin-bg'); bg.style.cssText = `position:fixed;inset:0;background-image:url(${s});background-size:cover;background-position:center;z-index:0`; }
}

// ── STAFF SELECTION & CHIPS ───────────────────────
let pinSel = null;
function renderChips() {
  const el = document.getElementById('staff-chips'); if (!el) return;
  el.innerHTML = ST.staff.filter(s => s.active !== false).map(s => `<button type="button" class="schip${s.name === pinSel ? ' sel' : ''}" data-staff="${esc(s.name)}">${esc(s.name)}</button>`).join('');
  el.querySelectorAll('[data-staff]').forEach(btn => btn.addEventListener('click', () => selChip(btn.dataset.staff)));
}
function selChip(n) { pinSel = n; renderChips(); document.getElementById('pin-lbl').textContent = `Enter PIN for ${n}`; }

// ── AUTHENTICATION & PIN ENTRY ───────────────────
let pinBuf = '', pinFails = 0, pinLockedUntil = 0;
function PK(k) {
  if (Date.now() < pinLockedUntil) { toast('PIN entry temporarily locked. Please wait.'); return; }
  if (k === 'C') { pinBuf = ''; } else if (k === 'D') { pinBuf = pinBuf.slice(0, -1); }
  else if (pinBuf.length < 4) pinBuf += k;
  for (let i = 0; i < 4; i++) { const d = document.getElementById('pd' + i); if (d) d.classList.toggle('filled', i < pinBuf.length); }
  if (pinBuf.length === 4) setTimeout(checkPIN, 120);
}

async function checkPIN() {
  const enteredHash = await hashPIN(pinBuf);
  let m = null;

  if (pinSel) {
    m = ST.staff.find(s => s.name === pinSel && (s.pin === enteredHash || s.pin === pinBuf) && s.active !== false);
  } else {
    m = ST.staff.find(s => (s.pin === enteredHash || s.pin === pinBuf) && s.active !== false);
  }

  if (m) {
    if (m.pin !== enteredHash) {
      m.pin = enteredHash;
      persist();
    }
    pinFails = 0; pinBuf = '';
    for (let i = 0; i < 4; i++) { const d = document.getElementById('pd' + i); if (d) d.classList.remove('filled'); }
    pinSel = null; loginAs(m);
  } else {
    pinFails++;
    if (pinFails >= 5) { pinLockedUntil = Date.now() + 30000; pinFails = 0; toast('Too many attempts. Locked for 30 seconds.'); }
    const lbl = document.getElementById('pin-lbl');
    lbl.textContent = pinFails >= 3 ? `Wrong PIN (${pinFails} attempts)` : 'Wrong PIN — try again';
    lbl.style.color = '#ef4444';
    const dots = document.getElementById('pin-dots');
    if (dots) { dots.style.animation = 'shake .35s'; setTimeout(() => dots.style.animation = '', 400); }
    pinBuf = ''; for (let i = 0; i < 4; i++) { const d = document.getElementById('pd' + i); if (d) d.classList.remove('filled'); }
    setTimeout(() => { lbl.textContent = pinSel ? `Enter PIN for ${pinSel}` : 'Enter PIN to sign in'; lbl.style.color = ''; }, 900);
  }
}

function loginAs(s) {
  ST.settings.currentCashier = s.name; persist();
  addAudit('LOGIN', `${s.name} signed in`, s.name); persist();
  sessionSalesCount = 0; sessionSalesTotal = 0; sessionCashTotal = 0; sessionMobileTotal = 0;

  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  const init = s.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('ca-av').textContent = init;
  document.getElementById('ca-name').textContent = s.name;
  document.getElementById('cm-name').textContent = s.name;
  document.getElementById('cm-role').textContent = ({ admin: '👑 Owner/Admin', supervisor: '🎯 Supervisor', cashier: '🏷️ Cashier' })[s.role] || s.role;
  document.getElementById('tb-shop').textContent = ST.settings.shopName;
  document.getElementById('pin-shopsub').textContent = ST.settings.shopName || 'Powered by ZhenchStacks';
  const h = new Date().getHours();
  toast(`${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${s.name}! 👋`);
  updCM(); goTab('pos'); initFB(); setTimeout(reqNotif, 2000);

  // Trigger PWA install banner if prompt captured or show browser guide
  if (deferredInstallPrompt) {
    showInstBanner();
  }
}

function doLogout() {
  document.getElementById('sess-cnt').textContent = sessionSalesCount;
  document.getElementById('sess-tot').textContent = fmt(sessionSalesTotal);
  document.getElementById('sess-cash').textContent = fmt(sessionCashTotal);
  document.getElementById('sess-mob').textContent = fmt(sessionMobileTotal);
  openOV('session-ov');
}

function confirmLogout() {
  closeOV('session-ov');
  addAudit('LOGOUT', `${ST.settings.currentCashier} signed out (Session: ${sessionSalesCount} sales, ${fmt(sessionSalesTotal)})`); persist();
  closeCM(); ST.settings.currentCashier = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('pin-screen').style.display = 'flex';
  pinBuf = ''; for (let i = 0; i < 4; i++) { const d = document.getElementById('pd' + i); if (d) d.classList.remove('filled'); }
  pinSel = null; renderChips();
  const lbl = document.getElementById('pin-lbl'); lbl.textContent = 'Enter PIN to sign in'; lbl.style.color = '';
}

function toggleCM() { const m = document.getElementById('cashier-menu'); m.style.display = m.style.display === 'none' ? 'block' : 'none'; if (m.style.display === 'block') updCM(); }
function closeCM() { document.getElementById('cashier-menu').style.display = 'none'; }
function updCM() {
  const td = ST.sales.filter(s => new Date(s.time).toDateString() === new Date().toDateString() && !s.voided);
  const tt = td.reduce((a, s) => a + s.total, 0);
  const el = document.getElementById('cm-today');
  if (el) el.innerHTML = `Today: <strong style="color:var(--accent)">${fmt(tt)}</strong> &bull; <strong>${td.length}</strong> sale${td.length !== 1 ? 's' : ''}`;
}
document.addEventListener('click', e => { if (!e.target.closest('#cashier-menu') && !e.target.closest('.cashier-pill')) closeCM(); });

// ── NAVIGATION & TAB CONTROLLER ──────────────────
const TABS = ['pos', 'stock', 'reports', 'credit', 'more'];
function goTab(t) {
  const access = { pos: ['admin', 'supervisor', 'cashier'], stock: ['admin', 'supervisor'], reports: ['admin', 'supervisor'], credit: ['admin', 'supervisor', 'cashier'], more: ['admin'] };
  if (!requireRole(...access[t])) return;
  TABS.forEach(x => {
    document.getElementById('screen-' + x)?.classList.toggle('active', x === t);
    document.getElementById('nav-' + x)?.classList.toggle('active', x === t);
  });
  if (t === 'pos') renderPOS();
  if (t === 'stock') renderStock();
  if (t === 'reports') renderReports();
  if (t === 'credit') renderCredit();
  if (t === 'more') renderMore();
}

let posMTab = 'prod';
function switchPosTab(w) {
  posMTab = w;
  document.getElementById('ptab-prod')?.classList.toggle('active', w === 'prod');
  document.getElementById('ptab-cart')?.classList.toggle('active', w === 'cart');
  document.getElementById('pcol-prod').className = 'pcol-products' + (w === 'prod' ? ' show' : '');
  document.getElementById('pcol-cart').className = 'pcol-cart' + (w === 'cart' ? ' show' : '');
}

// ── POS & SHOPPING CART ───────────────────────────
let cart = [], payMode = 'cash', activeCat = 'All', posSearchQuery = '', editProdId = null;
let cartDiscountPct = 0;
let splitCashVal = 0, splitMobVal = 0;

function renderPOS() {
  const cats = ['All', ...new Set(ST.products.map(p => p.cat))];
  document.getElementById('cat-strip').innerHTML = cats.map(c => `<div class="cat-chip${c === activeCat ? ' active' : ''}" onclick="setCat('${esc(c).replace(/'/g, "\\'")}')">${c === 'All' ? '🔢 All' : categoryLabel(c)}</div>`).join('');
  
  let filtered = activeCat === 'All' ? ST.products : ST.products.filter(p => p.cat === activeCat);
  if (posSearchQuery) {
    const q = posSearchQuery.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q)));
  }

  const grid = document.getElementById('prod-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-st"><p>No products found</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const out = p.qty <= 0, low = !out && p.qty <= (p.low || 5);
    const media = p.image ? `<img src="${p.image}" class="prod-photo-sm" alt="${esc(p.name)}">` : `<span class="pemoji">${GE(p.cat)}</span>`;
    return `<div class="pcard${out ? ' pout' : ''}" onclick="addToCart('${p.id}')">
      ${low ? '<div class="lowbadge">Low</div>' : ''}
      ${media}
      <div class="pname">${esc(p.name)}</div>
      <div class="pprice">${fmt(p.price)}</div>
      <div class="pstock">${out ? 'Out of stock' : p.qty + ' ' + p.unit}</div>
    </div>`;
  }).join('');
}

function setCat(c) { activeCat = c; renderPOS(); }

function filterPOSProducts(q) {
  posSearchQuery = q;
  const btn = document.getElementById('pos-srch-clear');
  if (btn) btn.style.display = q ? 'block' : 'none';
  renderPOS();
}

function clearPOSSearch() {
  const inp = document.getElementById('pos-srch');
  if (inp) inp.value = '';
  filterPOSProducts('');
}

function addToCart(id) {
  const p = ST.products.find(x => x.id === id); if (!p || p.qty <= 0) return;
  const ci = cart.find(x => x.id === id);
  if (ci) { if (ci.qty >= p.qty) { toast('Not enough stock available'); return; } ci.qty++; }
  else cart.push({ id, name: p.name, price: p.price, qty: 1, unit: p.unit || 'each', isManual: false });
  renderCart();
}

function addManual() {
  const n = document.getElementById('man-name').value.trim(), pr = parseFloat(document.getElementById('man-price').value) || 0;
  if (!n) { toast('Enter manual item name'); return; } if (pr <= 0) { toast('Enter price'); return; }
  cart.push({ id: 'm' + Date.now(), name: n, price: pr, qty: 1, unit: 'each', isManual: true });
  document.getElementById('man-name').value = ''; document.getElementById('man-price').value = '';
  renderCart(); toast('Item added ✓');
}

function chgQty(id, d) {
  const ci = cart.find(x => x.id === id); if (!ci) return;
  if (!ci.isManual && d > 0) { const p = ST.products.find(x => x.id === id); if (p && ci.qty >= p.qty) { toast('Not enough stock'); return; } }
  ci.qty += d; if (ci.qty <= 0) cart = cart.filter(x => x.id !== id);
  renderCart();
}

function rmItem(id) { cart = cart.filter(x => x.id !== id); renderCart(); }

function clearCart() {
  cart = []; cartDiscountPct = 0; splitCashVal = 0; splitMobVal = 0;
  ['cash-in', 'cart-disc', 'pos-srch'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  posSearchQuery = '';
  const clearBtn = document.getElementById('pos-srch-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  document.getElementById('chg-ok').style.display = 'none';
  document.getElementById('chg-err').style.display = 'none';
  renderCart(); renderPOS();
}

function applyDiscount(pctStr) {
  const val = parseFloat(pctStr) || 0;
  cartDiscountPct = Math.min(100, Math.max(0, val));
  renderCart();
}

function renderCart() {
  const discInp = document.getElementById('cart-disc');
  if (discInp && discInp.value) {
    cartDiscountPct = Math.min(100, Math.max(0, parseFloat(discInp.value) || 0));
  }

  const cnt = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const discountAmt = (subtotal * cartDiscountPct) / 100;
  const grandTotal = Math.max(0, subtotal - discountAmt);

  document.getElementById('cart-cnt').textContent = cnt;
  document.getElementById('mob-cnt').textContent = cnt;
  document.getElementById('cart-total').textContent = fmt(grandTotal);
  document.getElementById('item-cnt').textContent = `${cnt} item${cnt !== 1 ? 's' : ''}`;
  const wrap = document.getElementById('citems');
  if (!cart.length) {
    wrap.innerHTML = '<div class="empty-st" style="padding:20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="40" height="40"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>Cart is empty</p></div>';
  } else {
    wrap.innerHTML = cart.map(ci => `<div class="citem">
      <div class="ci-info"><div class="ci-name">${esc(ci.name)}${ci.isManual ? '<span style="font-size:9px;color:var(--warn);margin-left:4px">MANUAL</span>' : ''}</div><div class="ci-unit">${fmt(ci.price)} / ${ci.unit}</div></div>
      <div class="ci-qty"><div class="qbtn" onclick="chgQty('${ci.id}',-1)">&#8722;</div><div class="qval">${ci.qty}</div><div class="qbtn" onclick="chgQty('${ci.id}',1)">+</div></div>
      <div class="ci-price">${fmt(ci.price * ci.qty)}</div>
      <div onclick="rmItem('${ci.id}')" style="font-size:15px;color:var(--text3);cursor:pointer;padding:0 2px">&#10005;</div>
    </div>`).join('');
  }
  updQAmts(grandTotal);
  if (document.getElementById('cash-in').value) calcChange();
}

function selPay(m) {
  payMode = m;
  document.getElementById('pb-cash').className = 'paybtn' + (m === 'cash' ? ' scash' : '');
  document.getElementById('pb-mob').className = 'paybtn' + (m === 'mobile' ? ' smobile' : '');
  document.getElementById('pb-split').className = 'paybtn' + (m === 'split' ? ' ssplit' : '');
  
  document.getElementById('cash-sec').style.display = m === 'cash' ? 'block' : 'none';

  if (m === 'split') {
    const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const tot = Math.max(0, subtotal - (subtotal * cartDiscountPct) / 100);
    document.getElementById('split-tot-val').textContent = fmt(tot);
    document.getElementById('sp-cash').value = (tot / 2).toFixed(2);
    document.getElementById('sp-mob').value = (tot / 2).toFixed(2);
    openOV('split-ov');
  } else {
    document.getElementById('chg-ok').style.display = 'none';
    document.getElementById('chg-err').style.display = 'none';
  }
}

function confirmSplitPayment() {
  const c = parseFloat(document.getElementById('sp-cash').value) || 0;
  const m = parseFloat(document.getElementById('sp-mob').value) || 0;
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const tot = Math.max(0, subtotal - (subtotal * cartDiscountPct) / 100);

  if (c + m < tot - 0.01) {
    toast(`Short by ${fmt(tot - (c + m))}. Split total must equal ${fmt(tot)}`);
    return;
  }
  splitCashVal = c;
  splitMobVal = m;
  closeOV('split-ov');
  toast(`Split payment configured: ${fmt(c)} Cash + ${fmt(m)} Mobile`);
}

function calcChange() {
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const tot = Math.max(0, subtotal - (subtotal * cartDiscountPct) / 100);
  const gvn = parseFloat(document.getElementById('cash-in').value) || 0;
  const ok = document.getElementById('chg-ok'), err = document.getElementById('chg-err');
  if (gvn <= 0) { ok.style.display = 'none'; err.style.display = 'none'; return; }
  if (gvn >= tot) { document.getElementById('chg-val').textContent = fmt(gvn - tot); ok.style.display = 'flex'; err.style.display = 'none'; }
  else { document.getElementById('chg-short').textContent = fmt(tot - gvn); err.style.display = 'flex'; ok.style.display = 'none'; }
}

function updQAmts(tot) {
  if (tot <= 0) { document.getElementById('qamts').innerHTML = ''; return; }
  const rounds = [5, 10, 20, 50, 100, 200, 500, 1000], opts = [tot];
  for (const r of rounds) { const v = Math.ceil(tot / r) * r; if (v > tot && opts.length < 5) opts.push(v); }
  document.getElementById('qamts').innerHTML = [...new Set(opts)].slice(0, 5).map(v => `<button class="qamt" onclick="setTen(${v})">${v === tot ? 'Exact' : fmt(v)}</button>`).join('');
}
function setTen(v) { document.getElementById('cash-in').value = v.toFixed(2); calcChange(); }

function completeSale() {
  if (!requireRole('admin', 'supervisor', 'cashier') || completeSale._busy) return;
  if (!cart.length) { toast('Add items first'); return; }

  const discInp = document.getElementById('cart-disc');
  if (discInp) cartDiscountPct = Math.min(100, Math.max(0, parseFloat(discInp.value) || 0));

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const discountAmt = (subtotal * cartDiscountPct) / 100;
  const tot = Math.max(0, subtotal - discountAmt);

  let gvn = 0;
  if (payMode === 'cash') {
    gvn = parseFloat(document.getElementById('cash-in').value) || 0;
    if (gvn < tot) { toast('Enter cash received (at least the total)'); return; }
  } else if (payMode === 'split') {
    if (splitCashVal + splitMobVal < tot - 0.01) {
      splitCashVal = tot / 2;
      splitMobVal = tot / 2;
    }
  }

  completeSale._busy = true;
  try {
    const sale = {
      id: Date.now(), time: new Date().toISOString(), items: cart.map(c => ({ ...c })),
      subtotal: subtotal, discountPct: cartDiscountPct, discountAmt: discountAmt,
      total: tot, payment: payMode, cashier: ST.settings.currentCashier,
      splitCash: payMode === 'split' ? splitCashVal : 0,
      splitMob: payMode === 'split' ? splitMobVal : 0,
      cashTendered: payMode === 'cash' ? gvn : (payMode === 'split' ? splitCashVal : 0),
      changeGiven: payMode === 'cash' && gvn > 0 ? Math.max(0, gvn - tot) : 0,
      customerName: document.getElementById('cust-name').value.trim(),
      customerPhone: document.getElementById('cust-phone').value.trim(),
      customNote: document.getElementById('cust-note').value.trim(),
      shopId: ST.settings.shopId,
      voided: false
    };

    sale.items.forEach(ci => { if (!ci.isManual) { const p = ST.products.find(x => x.id === ci.id); if (p) p.qty = Math.max(0, p.qty - ci.qty); } });
    ST.sales.unshift(sale);

    // Track shift session metrics
    sessionSalesCount++;
    sessionSalesTotal += tot;
    if (payMode === 'cash') sessionCashTotal += tot;
    else if (payMode === 'mobile') sessionMobileTotal += tot;
    else if (payMode === 'split') { sessionCashTotal += splitCashVal; sessionMobileTotal += splitMobVal; }

    addAudit('SALE', `${fmt(sale.total)} — ${sale.items.length} item(s) — ${payMode}`, sale.cashier);
    persist(); curSale = sale; showReceipt(sale);
    clearCart(); ['cust-name', 'cust-phone', 'cust-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderPOS(); updCM(); toast('Sale complete — ' + fmt(sale.total));
  } catch (err) {
    console.error('Sale error:', err);
    toast('Error completing sale');
  } finally {
    setTimeout(() => completeSale._busy = false, 400);
  }
}

// ── STOCK MANAGEMENT & QUICK ADJUST ───────────────
let stCat = 'All';
function renderStock(srch = '') {
  const cats = ['All', ...new Set(ST.products.map(p => p.cat))];
  document.getElementById('stock-cats').innerHTML = cats.map(c => `<div class="cat-chip${c === stCat ? ' active' : ''}" style="padding:5px 10px;font-size:11px" onclick="setStCat('${esc(c).replace(/'/g, "\\'")}')">${c === 'All' ? '🔢 All' : categoryLabel(c)}</div>`).join('');
  let list = ST.products;
  if (srch) list = list.filter(p => p.name.toLowerCase().includes(srch.toLowerCase()) || (p.barcode && p.barcode.includes(srch)));
  if (stCat !== 'All') list = list.filter(p => p.cat === stCat);
  const el = document.getElementById('stock-list');
  if (!list.length) { el.innerHTML = '<div class="empty-st"><p>No products found</p></div>'; return; }

  el.innerHTML = list.map(p => {
    const st = p.qty <= 0 ? 'bg-red' : p.qty <= p.low ? 'bg-yellow' : 'bg-green';
    const stT = p.qty <= 0 ? 'Out' : p.qty <= p.low ? 'Low' : 'OK';
    const mg = p.cost ? (((p.price - p.cost) / p.price) * 100).toFixed(0) + '%' : '—';
    const media = p.image ? `<img src="${p.image}" class="prod-photo-sm" style="width:38px;height:38px;margin:0" alt="${esc(p.name)}">` : `<div class="semoji">${GE(p.cat)}</div>`;

    return `<div class="scard">
      ${media}
      <div class="sinfo"><div class="sname">${esc(p.name)}</div><div class="ssub">${categoryLabel(p.cat)} &bull; Margin: ${mg} &bull; ${p.unit}</div></div>
      <div class="sright">
        <div class="sprice">${fmt(p.price)}</div>
        <div class="adj-btns">
          <button class="adj-btn" onclick="quickAdjustQty('${p.id}',-1)">&#8722;</button>
          <span class="adj-qty">${p.qty}</span>
          <button class="adj-btn" onclick="quickAdjustQty('${p.id}',1)">+</button>
        </div>
        <span class="badge ${st}" style="margin-top:4px">${stT}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;margin-left:6px">
        <button class="btn btn-primary btn-sm" onclick="openRestock('${p.id}')">Restock</button>
        <button class="btn btn-ghost btn-sm" onclick="openProdModal('${p.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="showQR('${p.id}')">QR</button>
      </div>
    </div>`;
  }).join('');
}

function setStCat(c) { stCat = c; renderStock(document.getElementById('stock-srch')?.value || ''); }

function quickAdjustQty(id, delta) {
  if (!requireRole('admin', 'supervisor')) return;
  const p = ST.products.find(x => x.id === id); if (!p) return;
  const old = p.qty;
  p.qty = Math.max(0, p.qty + delta);
  addAudit('STOCK_ADJUST', `${p.name}: ${old} → ${p.qty} (${delta > 0 ? '+' + delta : delta})`);
  persist(); renderStock(document.getElementById('stock-srch')?.value || ''); renderPOS();
  toast(`${p.name}: stock is now ${p.qty}`);
}

let restockProdId = null;
function openRestock(id) {
  if (!requireRole('admin', 'supervisor')) return;
  const p = ST.products.find(x => x.id === id); if (!p) return;
  restockProdId = id;
  document.getElementById('restock-product').textContent = `${GE(p.cat)} ${p.name} · Current stock: ${p.qty} ${p.unit || 'each'}`;
  ['rs-qty', 'rs-cost', 'rs-supplier', 'rs-note'].forEach(id => document.getElementById(id).value = '');
  const recent = ST.restocks.filter(r => r.productId === id).slice(0, 3);
  document.getElementById('restock-history').textContent = recent.length ? `Recent: ${recent.map(r => `+${r.quantity} on ${new Date(r.time).toLocaleDateString('en-GB')}`).join(' · ')}` : 'No previous restocks recorded.';
  openOV('restock-ov');
}

function saveRestock() {
  if (!requireRole('admin', 'supervisor')) return;
  const p = ST.products.find(x => x.id === restockProdId); if (!p) return;
  const quantity = parseInt(document.getElementById('rs-qty').value, 10);
  if (!Number.isInteger(quantity) || quantity <= 0) { toast('Enter a quantity received'); return; }
  const enteredCost = document.getElementById('rs-cost').value;
  const unitCost = enteredCost === '' ? p.cost : parseFloat(enteredCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) { toast('Enter a valid unit cost'); return; }
  const supplier = cleanText(document.getElementById('rs-supplier').value);
  const note = cleanText(document.getElementById('rs-note').value);
  const previous = p.qty;
  p.qty += quantity;
  if (enteredCost !== '') p.cost = unitCost;
  ST.restocks.unshift({ id: 'r' + Date.now(), productId: p.id, productName: p.name, quantity, previousQty: previous, newQty: p.qty, unit: p.unit || 'each', unitCost, supplier, note, time: new Date().toISOString(), cashier: ST.settings.currentCashier });
  if (ST.restocks.length > 1000) ST.restocks = ST.restocks.slice(0, 1000);
  addAudit('RESTOCK', `${p.name}: +${quantity} ${p.unit || 'each'} (${previous} → ${p.qty})`);
  persist(); closeOV('restock-ov'); renderStock(document.getElementById('stock-srch')?.value || ''); renderPOS(); toast(`${p.name} restocked: +${quantity}`);
}

// ── PHOTO THUMBNAIL RESIZER (SAFE LOCALSTORAGE) ─
let tempProductPhoto = '';

function resizeImageToThumbnail(file, maxDimension = 160, quality = 0.75, callback) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      callback(dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function previewProductPhoto(inp) {
  const f = inp.files[0]; if (!f) return;
  resizeImageToThumbnail(f, 160, 0.75, (thumbUrl) => {
    tempProductPhoto = thumbUrl;
    const box = document.getElementById('pm-photo-box');
    if (box) box.innerHTML = `<img src="${tempProductPhoto}" alt="Photo">`;
    toast('Photo compressed ✓');
  });
}

function openProdModal(id = null) {
  if (!requireRole('admin', 'supervisor')) return;
  populateCategoryOptions();
  populateUnitOptions();
  editProdId = id; tempProductPhoto = '';
  document.getElementById('prod-modal-title').textContent = id ? 'Edit Product' : 'Add Product';
  const box = document.getElementById('pm-photo-box');

  if (id) {
    const p = ST.products.find(x => x.id === id);
    if (p) {
      document.getElementById('pm-name').value = p.name;
      document.getElementById('pm-cat').value = p.cat;
      document.getElementById('pm-unit').value = p.unit || 'each';
      document.getElementById('pm-cat-icon').value = GE(p.cat);
      document.getElementById('pm-price').value = p.price;
      document.getElementById('pm-cost').value = p.cost || '';
      document.getElementById('pm-qty').value = p.qty;
      document.getElementById('pm-low').value = p.low || 5;
      document.getElementById('pm-barcode').value = p.barcode || '';
      tempProductPhoto = p.image || '';
      if (box) box.innerHTML = tempProductPhoto ? `<img src="${tempProductPhoto}" alt="Photo">` : GE(p.cat);
    }
  } else {
    ['pm-name', 'pm-price', 'pm-cost', 'pm-qty', 'pm-barcode'].forEach(x => document.getElementById(x).value = '');
    document.getElementById('pm-low').value = 5;
    document.getElementById('pm-cat').value = '📦 Other';
    document.getElementById('pm-unit').value = 'each';
    document.getElementById('pm-cat-icon').value = '📦';
    if (box) box.innerHTML = '📦';
  }
  openOV('prod-ov');
}

function saveProd() {
  if (!requireRole('admin', 'supervisor')) return;
  const name = document.getElementById('pm-name').value.trim();
  if (!name) { toast('Enter product name'); return; }
  const cat = cleanText(document.getElementById('pm-cat').value);
  if (!cat) { toast('Enter or choose a category'); return; }
  const unit = cleanText(document.getElementById('pm-unit').value);
  if (!unit) { toast('Enter or choose a unit'); return; }
  const icon = document.getElementById('pm-cat-icon').value.trim() || GE(cat);
  ST.settings.categories = Array.isArray(ST.settings.categories) ? ST.settings.categories : [];
  if (!ST.settings.categories.includes(cat)) ST.settings.categories.push(cat);
  ST.settings.units = Array.isArray(ST.settings.units) ? ST.settings.units : [];
  if (!ST.settings.units.includes(unit)) ST.settings.units.push(unit);
  ST.settings.categoryIcons = ST.settings.categoryIcons && typeof ST.settings.categoryIcons === 'object' ? ST.settings.categoryIcons : {};
  ST.settings.categoryIcons[cat] = icon;

  const prod = {
    id: editProdId || 'p' + Date.now(), name, cat, unit,
    price: parseFloat(document.getElementById('pm-price').value) || 0,
    cost: parseFloat(document.getElementById('pm-cost').value) || 0,
    qty: parseInt(document.getElementById('pm-qty').value) || 0,
    low: parseInt(document.getElementById('pm-low').value) || 5,
    barcode: document.getElementById('pm-barcode').value.trim(),
    image: tempProductPhoto || (editProdId ? (ST.products.find(x => x.id === editProdId)?.image || '') : '')
  };

  if (editProdId) {
    const i = ST.products.findIndex(x => x.id === editProdId);
    if (i >= 0) ST.products[i] = prod;
    addAudit('EDIT_PRODUCT', `${prod.name} updated`); toast('Product updated ✓');
  } else {
    ST.products.push(prod);
    addAudit('ADD_PRODUCT', `${prod.name} added at ${fmt(prod.price)}`); toast('Product added ✓');
  }
  persist(); closeOV('prod-ov'); renderStock(document.getElementById('stock-srch')?.value || ''); renderPOS();
  setTimeout(() => showQR(prod.id), 400);
}

// ── QR CODE GENERATOR & PRINT LABELS ──────────────
function showQR(id) {
  if (!requireRole('admin', 'supervisor')) return;
  const p = ST.products.find(x => x.id === id);
  if (!p) return;
  const wrap = document.getElementById('qr-label-wrap');
  wrap.innerHTML = '';

  const payload = p.barcode || `SHOPPOS:${p.id}:${p.name}:${p.price}`;

  const box = document.createElement('div');
  box.id = 'qr-print-label';
  box.style.cssText = 'background:#fff;color:#000;padding:16px 14px;border-radius:8px;display:inline-flex;flex-direction:column;align-items:center;gap:6px;font-family:Courier New,monospace;border:2px dashed #333;text-align:center;min-width:150px;max-width:200px';

  const shopEl = document.createElement('div');
  shopEl.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.08em;color:#555;text-transform:uppercase;border-bottom:1px solid #ddd;padding-bottom:5px;width:100%;text-align:center';
  shopEl.textContent = ST.settings.shopName || 'ShopPOS';
  box.appendChild(shopEl);

  const qrDiv = document.createElement('div');
  qrDiv.style.cssText = 'margin:4px 0';
  box.appendChild(qrDiv);

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:12px;font-weight:700;max-width:170px;word-wrap:break-word;line-height:1.3;margin-top:2px';
  nameEl.textContent = p.name;
  box.appendChild(nameEl);

  const priceEl = document.createElement('div');
  priceEl.style.cssText = 'font-size:20px;font-weight:900;color:#000;margin:2px 0;letter-spacing:-0.5px';
  priceEl.textContent = fmt(p.price);
  box.appendChild(priceEl);

  const unitEl = document.createElement('div');
  unitEl.style.cssText = 'font-size:9px;color:#888;border-top:1px solid #ddd;padding-top:4px;width:100%;text-align:center;word-break:break-all';
  unitEl.textContent = `${p.unit || 'each'} · ${payload.slice(0, 20)}`;
  box.appendChild(unitEl);

  wrap.appendChild(box);

  try {
    new QRCode(qrDiv, {
      text: payload, width: 130, height: 130,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
    setTimeout(() => {
      const img = qrDiv.querySelector('img'), canvas = qrDiv.querySelector('canvas');
      if (!img && !canvas) {
        qrDiv.innerHTML = '<div style="width:130px;height:130px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999">QR generating...</div>';
      }
    }, 300);
  } catch (e) {
    qrDiv.innerHTML = `<div style="width:130px;height:130px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:9px;color:#666;text-align:center;padding:8px">Barcode: ${payload}</div>`;
  }
  openOV('qrlabel-ov');
}

function printLabel() {
  const label = document.getElementById('qr-print-label');
  if (!label) { toast('No label to print'); return; }
  const clone = label.cloneNode(true);
  const origCanvas = label.querySelector('canvas');
  if (origCanvas) {
    const cloneCanvas = clone.querySelector('canvas');
    if (cloneCanvas) {
      const img = document.createElement('img');
      img.src = origCanvas.toDataURL('image/png');
      img.style.cssText = 'width:130px;height:130px;margin:0 auto;display:block;';
      cloneCanvas.parentNode.replaceChild(img, cloneCanvas);
    }
  }

  const win = window.open('', '_blank', 'width=400,height=500');
  if (!win) { toast('Allow popups to print'); window.print(); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Product Label</title>
  <style>
    body { margin: 0; padding: 20px; font-family: 'Courier New', monospace; background: #fff; }
    @page { size: 80mm auto; margin: 5mm; }
    .label { background: #fff; color: #000; padding: 12px; border: 2px dashed #333;
      border-radius: 6px; display: inline-block; text-align: center; max-width: 70mm; }
    img, canvas { display: block; margin: 6px auto; }
  </style></head><body>
  <div class="label">${clone.innerHTML}</div>
  <script>setTimeout(() => { window.print(); window.close(); }, 500);<\/script>
  </body></html>`);
  win.document.close();
}

// ── RECEIPT FORMATTER & EXPORTS ───────────────────
let curSale = null;
const fmt = n => 'K' + Number(n).toFixed(2);
const fmtR = n => 'ZMW ' + Number(n).toFixed(2);
const invNo = id => { const d = new Date(id); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(id).slice(-6)}`; };
const genSig = (id, tot, tp) => { let h = 0; const r = `${tp || ''}${id}${Math.round(tot * 100)}`; for (let i = 0; i < r.length; i++) h = ((h << 5) - h) + r.charCodeAt(i), h |= 0; const s = Math.abs(h).toString(36).toUpperCase().padStart(8, '0'); return `${s.slice(0, 4)}-${s.slice(4, 8)}-${String(id).slice(-4)}`; };

function showReceipt(sale) {
  const S = ST.settings, tog = S.receiptToggles || {};
  const isVAT = S.taxType === 'VAT' && S.tpin;
  const vatR = parseFloat(S.vatRate) || 16;
  const vatAmt = isVAT ? sale.total * vatR / 100 / (1 + vatR / 100) : 0;
  const sig = genSig(sale.id, sale.total, S.tpin);
  const inv = invNo(sale.id);
  const iData = btoa(`${sale.id}|${sale.total.toFixed(2)}|${S.tpin || ''}`).slice(0, 24);
  const row = (l, v, sz = '10px') => `<div style="display:flex;justify-content:space-between;font-size:${sz};margin:2px 0"><span>${l}</span><span>${v}</span></div>`;
  const dd = '<div style="border-top:1px dashed #ccc;margin:7px 0"></div>';

  let payDesc = sale.payment === 'mobile' ? 'Mobile Money' : sale.payment === 'split' ? `Split: ${fmt(sale.splitCash || 0)} Cash + ${fmt(sale.splitMob || 0)} Mobile` : 'Cash';

  let html = `
<div style="text-align:center;margin-bottom:10px">
  <div style="font-size:17px;font-weight:700;letter-spacing:1px">${(S.shopName || 'SHOP').toUpperCase()}</div>
  ${S.receiptSubheader ? `<div style="font-size:10px;color:#555;margin-top:1px">${S.receiptSubheader}</div>` : ''}
  ${S.shopAddr ? `<div style="font-size:10px;color:#666">${S.shopAddr}</div>` : ''}
  ${S.shopPhone ? `<div style="font-size:10px;color:#666">Tel: ${S.shopPhone}</div>` : ''}
  ${S.shopEmail ? `<div style="font-size:10px;color:#666">${S.shopEmail}</div>` : ''}
</div>
<div style="text-align:center;padding:4px;margin-bottom:8px;background:${sale.voided ? '#ffebee' : isVAT ? '#e8f5e9' : '#f5f5f5'};border-radius:3px">
  <span style="font-size:10px;font-weight:800;letter-spacing:.07em;color:${sale.voided ? '#c62828' : isVAT ? '#1b5e20' : '#444'}">${sale.voided ? '❌ VOIDED / REFUNDED RECEIPT' : isVAT ? '✓ ZRA TAX INVOICE' : S.taxType === 'TOT' ? '✓ ZRA TOT INVOICE' : 'SALES RECEIPT'}</span>
</div>
${dd}
${row('Invoice No.', inv, '10px')}
${row('Receipt No.', String(sale.id).slice(-6), '10px')}
${row('Date', new Date(sale.time).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), '10px')}
${row('Time', new Date(sale.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), '10px')}
${tog.cashier !== false ? row('Cashier', sale.cashier || 'Staff', '10px') : ''}
${tog.cust !== false && sale.customerName ? row('Customer', sale.customerName, '10px') : ''}
${tog.cust !== false && sale.customerPhone ? row('Phone', sale.customerPhone, '10px') : ''}
${dd}
<div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;color:#555;margin-bottom:5px"><span>ITEM DESCRIPTION</span><span>AMOUNT</span></div>
${sale.items.map(i => `<div style="margin-bottom:6px">
  <div style="font-size:11px;font-weight:700">${esc(i.name)}${i.isManual ? ' *' : ''}</div>
  <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;padding-left:8px">
    <span>${tog.units !== false ? `${i.qty} ${i.unit || 'unit(s)'}` : i.qty + ' unit(s)'} @ ${fmtR(i.price)}</span>
    <span style="font-weight:700;color:#000">${fmtR(i.price * i.qty)}</span>
  </div>
</div>`).join('')}
<div style="border-top:1px solid #999;margin:7px 0"></div>
${sale.discountAmt ? row('Subtotal', fmtR(sale.subtotal || sale.total), '10px') : ''}
${sale.discountAmt ? row(`Discount (${sale.discountPct}%)`, '-' + fmtR(sale.discountAmt), '10px') : ''}
${isVAT && tog.tax !== false ? row(`Net excl. VAT (${vatR}%)`, fmtR(sale.total - vatAmt), '10px') : ''}
${isVAT && tog.tax !== false ? row(`VAT @ ${vatR}%`, fmtR(vatAmt), '10px') : ''}
<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;border-top:1px solid #000;padding-top:5px;margin:5px 0 3px"><span>TOTAL (ZMW)</span><span>${fmtR(sale.total)}</span></div>
${row('Payment', payDesc, '10px')}
${tog.change !== false && sale.cashTendered > 0 ? row('Cash Received', fmtR(sale.cashTendered), '10px') : ''}
${tog.change !== false && sale.cashTendered > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:#16a34a;margin:2px 0"><span>Change Given</span><span>${fmtR(Math.max(0, sale.cashTendered - sale.total))}</span></div>` : ''}
${S.tpin ? `
${dd}
<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#333;margin-bottom:3px">ZRA Smart Invoice</div>
${tog.tpin !== false && S.tpin ? row('TPIN', S.tpin, '9px') : ''}
${S.branchId ? row('Branch ID', S.branchId, '9px') : ''}
${tog.mrc !== false && S.mrcNo ? row('MRC No.', S.mrcNo, '9px') : ''}
${tog.sdc !== false && S.sdcId ? row('SDC ID', S.sdcId, '9px') : ''}
${row('ZRA Invoice No.', inv, '9px')}
${tog.sig !== false ? `<div style="display:flex;justify-content:space-between;font-size:8px;margin:2px 0;word-break:break-all"><span>Fiscal Sig.</span><span style="font-family:monospace;margin-left:8px;text-align:right">${sig}</span></div>` : ''}
${tog.sig !== false ? `<div style="display:flex;justify-content:space-between;font-size:7px;color:#aaa;margin:1px 0;word-break:break-all"><span>Internal Data</span><span style="font-family:monospace;margin-left:8px;text-align:right">${iData}</span></div>` : ''}
${tog.qr !== false ? `<div id="r-qr-slot" style="text-align:center;margin:9px 0 3px"></div><div style="font-size:8px;color:#888;text-align:center;margin-bottom:2px">Scan to verify with ZRA portal</div>` : ''}
` : ''}
${sale.customNote ? `${dd}<div style="font-size:11px;font-style:italic;text-align:center;color:#444">${sale.customNote}</div>` : ''}
${dd}
<div style="text-align:center;font-size:11px;font-weight:600">${S.receiptMsg || 'Thank you for your purchase!'}</div>
<div style="text-align:center;font-size:8px;color:#bbb;margin-top:8px;border-top:1px dotted #ddd;padding-top:6px">Software by <strong>ZhenchStacks</strong> &bull; ShopPOS v3.1</div>`;

  document.getElementById('rbox').innerHTML = html;
  document.getElementById('receipt-ov').classList.add('open');

  if (tog.qr !== false && S.tpin) {
    setTimeout(() => {
      const slot = document.getElementById('r-qr-slot');
      if (slot) {
        slot.innerHTML = '';
        const qrUrl = `https://portal.zra.org.zm/common/link/ebm/receipt/indexEbmReceiptData?Data=${S.tpin}${(S.branchId || '000').padStart(3, '0')}${sig.replace(/-/g, '')}`;
        try {
          new QRCode(slot, { text: qrUrl, width: 100, height: 100, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
        } catch (e) {
          slot.innerHTML = '<div style="font-size:8px;color:#aaa;text-align:center">Verify at portal.zra.org.zm</div>';
        }
      }
    }, 200);
  }
}

function closeReceipt() { document.getElementById('receipt-ov').classList.remove('open'); }

async function savePDF() {
  if (!curSale) { toast('No receipt to save'); return; }
  toast('Generating PDF…');
  try {
    const el = document.getElementById('rbox');
    const { jsPDF } = window.jspdf;
    const cv = await html2canvas(el, { scale: 2, backgroundColor: '#fff', useCORS: true, logging: false });
    const pw = 80, ph = cv.height * pw / cv.width;
    const pdf = new jsPDF({ unit: 'mm', format: [pw, Math.max(ph, 60)] });
    pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, pw, ph);
    pdf.save(`Receipt_${invNo(curSale.id)}.pdf`);
    toast('PDF saved ✓');
  } catch (e) { toast('PDF error — try WhatsApp'); }
}

function doPrint() { window.print(); }

async function sendWA() {
  if (!curSale) return;
  const S = ST.settings, sale = curSale;
  const isVAT = S.taxType === 'VAT' && S.tpin;
  const vatR = parseFloat(S.vatRate) || 16;
  const vatAmt = isVAT ? sale.total * vatR / 100 / (1 + vatR / 100) : 0;
  const sig = genSig(sale.id, sale.total, S.tpin);
  const lines = [
    `🏪 *${(S.shopName || 'SHOP').toUpperCase()}*`,
    S.receiptSubheader || '', S.shopAddr || '', S.shopPhone ? `📞 ${S.shopPhone}` : '',
    '', sale.voided ? '❌ *VOIDED / REFUNDED RECEIPT*' : isVAT ? '✅ *ZRA TAX INVOICE*' : '🧾 *SALES RECEIPT*',
    `📋 Invoice: *${invNo(sale.id)}*`,
    `📅 ${new Date(sale.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    `👤 Cashier: ${sale.cashier || 'Staff'}`,
    sale.customerName ? `🛒 Customer: ${sale.customerName}` : '',
    '', '─────────────────',
    ...sale.items.map(i => `• ${i.name}\n  ${i.qty} ${i.unit || 'unit(s)'} @ ${fmt(i.price)} = *${fmt(i.qty * i.price)}*`),
    '─────────────────',
    sale.discountAmt ? `Subtotal: ${fmt(sale.subtotal)}` : '',
    sale.discountAmt ? `Discount (${sale.discountPct}%): -${fmt(sale.discountAmt)}` : '',
    isVAT ? `Net: ${fmt(sale.total - vatAmt)}` : '',
    isVAT ? `VAT @ ${vatR}%: ${fmt(vatAmt)}` : '',
    `💰 *TOTAL: ${fmt(sale.total)} ZMW*`,
    `💳 ${sale.payment === 'mobile' ? 'Mobile Money' : sale.payment === 'split' ? 'Split Cash & Mobile' : 'Cash'}`,
    sale.cashTendered > 0 ? `Cash: ${fmt(sale.cashTendered)}` : '',
    sale.cashTendered > 0 ? `Change: ${fmt(Math.max(0, sale.cashTendered - sale.total))}` : '',
    S.tpin ? `\n🇿🇲 TPIN: ${S.tpin}` : '', S.mrcNo ? `MRC: ${S.mrcNo}` : '',
    S.sdcId ? `SDC: ${S.sdcId}` : '', S.tpin ? `Sig: ${sig}` : '',
    sale.customNote ? `\n_${sale.customNote}_` : '',
    '', `_${S.receiptMsg || 'Thank you!'}_`, '_ShopPOS by ZhenchStacks_'
  ].filter(Boolean).join('\n');

  try {
    const el = document.getElementById('rbox');
    const { jsPDF } = window.jspdf;
    const cv = await html2canvas(el, { scale: 2, backgroundColor: '#fff', useCORS: true, logging: false });
    const pw = 80, ph = cv.height * pw / cv.width;
    const pdf = new jsPDF({ unit: 'mm', format: [pw, Math.max(ph, 60)] });
    pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, pw, ph);
    const blob = pdf.output('blob');
    const file = new File([blob], `Receipt_${String(sale.id).slice(-6)}.pdf`, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: `Receipt — ${S.shopName}`, text: lines, files: [file] });
      toast('Receipt PDF shared ✓'); return;
    }
  } catch (e) {}
  const phone = sale.customerPhone || '';
  window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(lines)}`, '_blank');
  toast('Opening WhatsApp…');
}

// ── REPORTS & VOID SALES ──────────────────────────
let period = 'today';
function setPeriod(p) {
  period = p;
  document.querySelectorAll('.ptab').forEach((el, i) => el.classList.toggle('active', ['today', 'week', 'month', 'all'][i] === p));
  renderReports();
}

function filtSales() {
  const now = new Date();
  return ST.sales.filter(s => {
    const d = new Date(s.time);
    if (period === 'today') return d.toDateString() === now.toDateString();
    if (period === 'week') return (now - d) < 7 * 86400000;
    if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return true;
  });
}

function renderReports() {
  const list = filtSales();
  const validList = list.filter(s => !s.voided);

  const tot = validList.reduce((s, x) => s + x.total, 0);
  const txns = validList.length;
  const profit = validList.reduce((s, x) => s + x.items.reduce((a, i) => { const p = ST.products.find(pr => pr.id === i.id); return a + (p && p.cost ? (i.price - p.cost) * i.qty : 0); }, 0), 0);
  const cash = validList.filter(s => s.payment === 'cash').reduce((s, x) => s + x.total, 0);
  const mob = validList.filter(s => s.payment === 'mobile').reduce((s, x) => s + x.total, 0);

  document.getElementById('sgrid').innerHTML = `
    <div class="sstat"><div class="slbl">Total Income</div><div class="sval" style="color:var(--accent)">${fmt(tot)}</div><div class="ssub2">${txns} sale${txns !== 1 ? 's' : ''}</div></div>
    <div class="sstat"><div class="slbl">Est. Profit</div><div class="sval" style="color:var(--accent)">${fmt(profit)}</div><div class="ssub2">Based on cost prices</div></div>
    <div class="sstat"><div class="slbl">Cash Sales</div><div class="sval" style="color:var(--info)">${fmt(cash)}</div></div>
    <div class="sstat"><div class="slbl">Mobile Money</div><div class="sval" style="color:var(--purple)">${fmt(mob)}</div></div>`;

  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const ds = ST.sales.filter(s => !s.voided && new Date(s.time).toDateString() === d.toDateString()); days.push({ l: d.toLocaleDateString('en', { weekday: 'short' }), v: ds.reduce((s, x) => s + x.total, 0) }); }
  const mx = Math.max(...days.map(d => d.v), 1);
  document.getElementById('bar-chart').innerHTML = days.map(d => `<div class="bar-col"><div style="font-size:8px;color:var(--text3);margin-bottom:2px">${d.v > 0 ? 'K' + Math.round(d.v / 1000) + 'k' : ''}</div><div class="bar-fill" style="height:${Math.max(3, (d.v / mx) * 70)}px"></div><div class="bar-lbl">${d.l}</div></div>`).join('');

  const el = document.getElementById('sale-log');
  if (!list.length) { el.innerHTML = '<div class="empty-st"><p>No sales in this period</p></div>'; return; }

  el.innerHTML = list.slice(0, 100).map(s => `<div class="sentry${s.voided ? ' voided' : ''}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
      <span style="font-size:11px;color:var(--text3)">${new Date(s.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      <span style="font-size:15px;font-weight:800;color:${s.voided ? 'var(--danger)' : 'var(--accent)'}">${s.voided ? 'VOIDED ' + fmt(s.total) : fmt(s.total)}</span>
    </div>
    <div style="font-size:12px;color:var(--text2);line-height:1.5">${s.items.map(i => i.name + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <span style="font-size:11px;color:var(--text3)">${s.cashier || ''}${s.customerName ? ' &bull; ' + s.customerName : ''}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge ${s.payment === 'mobile' ? 'bg-purple' : s.payment === 'split' ? 'bg-yellow' : 'bg-blue'}">${s.payment === 'mobile' ? 'Mobile' : s.payment === 'split' ? 'Split' : 'Cash'}</span>
        <button class="btn btn-ghost btn-sm" style="padding:3px 9px;font-size:10px" onclick="viewSale('${s.id}')">Receipt</button>
        ${!s.voided ? `<button class="btn btn-danger btn-sm" style="padding:3px 9px;font-size:10px" onclick="voidSale('${s.id}')">Void</button>` : ''}
      </div>
    </div>
  </div>`).join('');
}

function viewSale(id) { const s = ST.sales.find(x => String(x.id) === String(id)); if (s) { curSale = s; showReceipt(s); } }

function voidSale(id) {
  if (!requireRole('admin', 'supervisor')) return;
  const s = ST.sales.find(x => String(x.id) === String(id));
  if (!s || s.voided) return;

  askConfirm(
    'Void & Refund Sale?',
    `This will void invoice #${invNo(s.id)} (${fmt(s.total)}) and automatically restore item stock back to inventory.`,
    'Void Sale',
    () => {
      s.voided = true;
      s.voidedBy = ST.settings.currentCashier;
      s.voidedTime = new Date().toISOString();

      s.items.forEach(ci => {
        if (!ci.isManual) {
          const p = ST.products.find(x => x.id === ci.id);
          if (p) p.qty += ci.qty;
        }
      });

      addAudit('VOID_SALE', `Voided sale #${invNo(s.id)} — ${fmt(s.total)} (Stock restored)`);
      persist(); renderReports(); renderStock(document.getElementById('stock-srch')?.value || ''); renderPOS();
      toast(`Sale voided & ${s.items.length} items restored to stock ✓`);
    }
  );
}

let confirmTask = null;
function askConfirm(title, message, buttonLabel, onApprove) {
  confirmTask = onApprove;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-button').textContent = buttonLabel || 'Confirm';
  openOV('confirm-ov');
}
function closeConfirm() { confirmTask = null; closeOV('confirm-ov'); }
function approveConfirm() { const task = confirmTask; closeConfirm(); if (task) task(); }

function exportCSV() {
  if (!requireRole('admin', 'supervisor')) return;
  const rows = [['Date', 'Time', 'Invoice No', 'Items', 'Total ZMW', 'Payment', 'Cashier', 'Customer', 'Voided']];
  ST.sales.forEach(s => {
    const d = new Date(s.time);
    rows.push([
      d.toLocaleDateString('en-GB'), d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      invNo(s.id), s.items.map(i => i.name + (i.qty > 1 ? 'x' + i.qty : '')).join('|'),
      s.total.toFixed(2), s.payment, s.cashier || '', s.customerName || '',
      s.voided ? 'YES' : 'NO'
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `ShopPOS_${ST.settings.shopName}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  toast('CSV exported ✓');
}

function clearSalesHist() {
  if (!requireRole('admin')) return;
  askConfirm('Clear sales history?', 'This permanently removes all sales records from this device. Products and stock quantities will remain unchanged.', 'Clear sales', () => {
    ST.sales = []; addAudit('CLEAR_SALES', 'Sales history cleared'); persist(); renderReports(); toast('Sales history cleared');
  });
}
function clearProducts() {
  if (!requireRole('admin')) return;
  askConfirm('Clear product catalogue?', 'This removes all products, including the demo stock. Sales history and shop settings will remain. You can then add your real products from Stock.', 'Clear products', () => {
    ST.products = []; ST.settings.catalogInitialized = true; cart = []; addAudit('CLEAR_PRODUCTS', 'Product catalogue cleared'); persist(); renderPOS(); renderStock(); renderCart(); toast('Product catalogue cleared');
  });
}

// ── CUSTOMER CREDIT MANAGEMENT ────────────────────
function renderCredit() {
  const owed = ST.credits.filter(c => !c.paid).reduce((s, c) => s + c.amount, 0);
  document.getElementById('cr-total').textContent = fmt(owed);
  const el = document.getElementById('cr-list');
  if (!ST.credits.length) { el.innerHTML = '<div class="empty-st"><p>No credit records</p></div>'; return; }
  el.innerHTML = ST.credits.map((c, i) => `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:8px;${c.paid ? 'opacity:.5' : ''}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:14px;font-weight:700">${esc(c.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${c.phone || 'No phone'}</div>
        ${c.notes ? `<div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(c.notes)}</div>` : ''}
        <div style="font-size:10px;color:var(--text3);margin-top:3px">${new Date(c.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:800;color:${c.paid ? 'var(--accent)' : 'var(--danger)'}">${c.paid ? '✓ Paid' : fmt(c.amount)}</div>
        <div style="display:flex;gap:5px;margin-top:5px;justify-content:flex-end;flex-wrap:wrap">
          ${!c.paid ? `<button class="btn btn-primary btn-sm" onclick="markPaid(${i})">Paid</button>` : ''}
          ${c.phone && !c.paid ? `<button class="btn btn-ghost btn-sm" onclick="crRemind('${esc(c.name).replace(/'/g, "\\'")}' ,'${esc(c.phone)}',${c.amount})">Remind</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="delCredit(${i})">Del</button>
        </div>
      </div>
    </div>
  </div>`).join('');
}

function saveCredit() {
  if (!requireRole('admin', 'supervisor', 'cashier')) return;
  const name = document.getElementById('cr-name').value.trim(); if (!name) { toast('Enter customer name'); return; }
  const amount = parseFloat(document.getElementById('cr-amt').value);
  if (!Number.isFinite(amount) || amount <= 0) { toast('Enter a valid credit amount'); return; }
  ST.credits.unshift({
    name, phone: document.getElementById('cr-phone').value.trim(),
    amount, notes: document.getElementById('cr-notes').value.trim(),
    date: new Date().toISOString(), paid: false, by: ST.settings.currentCashier
  });
  addAudit('CREDIT', `${name} — ${fmt(ST.credits[0].amount)}`);
  persist(); closeOV('credit-ov');
  ['cr-name', 'cr-phone', 'cr-amt', 'cr-notes'].forEach(id => document.getElementById(id).value = '');
  renderCredit(); toast('Credit recorded ✓');
}

function markPaid(i) { if (!requireRole('admin', 'supervisor')) return; ST.credits[i].paid = true; ST.credits[i].paidDate = new Date().toISOString(); addAudit('CREDIT_PAID', `${ST.credits[i].name}`); persist(); renderCredit(); toast('Marked paid ✓'); }
function delCredit(i) { if (!requireRole('admin')) return; askConfirm('Delete credit record?', 'This removes the selected credit record permanently.', 'Delete record', () => { ST.credits.splice(i, 1); addAudit('DELETE_CREDIT', 'Credit record deleted'); persist(); renderCredit(); }); }
function crRemind(n, ph, amt) {
  const msg = `Hello ${n}! Friendly reminder from ${ST.settings.shopName}. Outstanding balance: ${fmt(amt)}. Please settle when convenient. Thank you!`;
  window.open(`https://wa.me/${ph.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── MORE & SETTINGS INLINE PANEL ──────────────────
function showInline(title, html) {
  const panel = document.getElementById('inline-settings');
  const titleEl = document.getElementById('inline-title');
  const body = document.getElementById('inline-body');
  if (!panel || !titleEl || !body) return;
  titleEl.textContent = title;
  body.innerHTML = html;
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
}

function closeInline() {
  const panel = document.getElementById('inline-settings');
  if (panel) panel.style.display = 'none';
}

function openShopSettings() {
  if (!requireRole('admin')) return;
  const S = ST.settings, tog = S.receiptToggles || {};
  const html = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="background:#0a2419;border:1.5px solid #10b981;border-radius:12px;padding:14px">
        <div style="font-size:10px;font-weight:800;color:#10b981;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Business Details</div>
        <div style="margin-bottom:10px"><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Shop Name</label><input id="s-name" value="${esc(S.shopName || '')}" placeholder="Shop name" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
        <div style="margin-bottom:10px"><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Address</label><input id="s-addr" value="${esc(S.shopAddr || '')}" placeholder="Plot, Street, Town" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Phone / WhatsApp</label><input id="s-phone" type="tel" value="${esc(S.shopPhone || '')}" placeholder="260 97..." style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Email</label><input id="s-email" type="email" value="${esc(S.shopEmail || '')}" placeholder="shop@email.com" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
        </div>
      </div>
      <div style="background:#091429;border:1.5px solid #3b82f6;border-radius:12px;padding:14px">
        <div style="font-size:10px;font-weight:800;color:#3b82f6;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">ZRA Smart Invoice</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">TPIN (10 digits)</label><input id="s-tpin" value="${esc(S.tpin || '')}" placeholder="0000000000" maxlength="10" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Branch ID</label><input id="s-branch" value="${esc(S.branchId || '')}" placeholder="000" maxlength="3" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">MRC Number</label><input id="s-mrc" value="${esc(S.mrcNo || '')}" placeholder="ZM12345..." style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">SDC ID</label><input id="s-sdc" value="${esc(S.sdcId || '')}" placeholder="SD00001234" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Tax Type</label>
            <select id="s-taxtype" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none;appearance:none">
              <option value="none" ${S.taxType === 'none' ? 'selected' : ''}>None / Not Registered</option>
              <option value="VAT" ${S.taxType === 'VAT' ? 'selected' : ''}>VAT</option>
              <option value="TOT" ${S.taxType === 'TOT' ? 'selected' : ''}>Turnover Tax (TOT)</option>
            </select>
          </div>
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">VAT Rate</label>
            <select id="s-vatrate" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none;appearance:none">
              <option value="16" ${S.vatRate === '16' ? 'selected' : ''}>16% Standard</option>
              <option value="0" ${S.vatRate === '0' ? 'selected' : ''}>0% Zero Rated</option>
              <option value="exempt" ${S.vatRate === 'exempt' ? 'selected' : ''}>Exempt</option>
            </select>
          </div>
        </div>
      </div>
      <div style="background:#1e293b;border:1.5px solid #475569;border-radius:12px;padding:14px">
        <div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Receipt Field Toggles</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${['tpin', 'mrc', 'sdc', 'tax', 'sig', 'qr', 'cashier', 'change', 'units', 'cust'].map(f => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#f1f5f9;cursor:pointer">
            <input type="checkbox" id="rt-${f}" ${tog[f] !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#10b981">
            ${({ tpin: 'TPIN', mrc: 'MRC No.', sdc: 'SDC ID', tax: 'Tax Breakdown', sig: 'Fiscal Signature', qr: 'QR Code', cashier: 'Cashier Name', change: 'Change Given', units: 'Item Units', cust: 'Customer Name' })[f]}
          </label>`).join('')}
        </div>
      </div>
      <div style="background:#1e293b;border:1.5px solid #475569;border-radius:12px;padding:14px">
        <div style="margin-bottom:10px"><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Thank You Message</label><input id="s-footer" value="${esc(S.receiptMsg || '')}" placeholder="Thank you for your purchase!" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
        <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Receipt Sub-header</label><input id="s-subhdr" value="${esc(S.receiptSubheader || '')}" placeholder="Your neighbourhood shop since 2010" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:11px 13px;color:#f1f5f9;font-size:14px;outline:none"></div>
      </div>
      <button onclick="saveShopSettings()" style="width:100%;padding:16px;border-radius:12px;border:none;background:#10b981;color:#000;font-size:16px;font-weight:800;cursor:pointer;letter-spacing:.01em">Save All Settings</button>
      <div style="height:20px"></div>
    </div>`;
  showInline('Shop & ZRA Settings', html);
}

function openStaffInline() { openOV('staff-ov'); }

function openSupInline() {
  if (!requireRole('admin', 'supervisor')) return;
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div id="sup-inline-list" style="display:flex;flex-direction:column;gap:8px"></div>
      <div style="background:#1a0d3e;border:1.5px solid #8b5cf6;border-radius:12px;padding:14px">
        <div style="font-size:11px;font-weight:800;color:#8b5cf6;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Record New Order</div>
        <div style="margin-bottom:10px"><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Supplier Name</label><input id="sup-name" placeholder="e.g. Zambia Breweries" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:10px 12px;color:#f1f5f9;font-size:14px;outline:none"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Items Bought</label><input id="sup-items" placeholder="2 crates Castle" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:10px 12px;color:#f1f5f9;font-size:14px;outline:none"></div>
          <div><label style="font-size:11px;color:#94a3b8;font-weight:700;display:block;margin-bottom:4px">Amount Paid (K)</label><input id="sup-amt" type="number" placeholder="0.00" style="width:100%;background:#334155;border:1.5px solid #475569;border-radius:8px;padding:10px 12px;color:#f1f5f9;font-size:14px;outline:none"></div>
        </div>
        <button onclick="saveSupplier();openSupInline()" style="width:100%;padding:13px;border-radius:8px;border:none;background:#8b5cf6;color:#fff;font-size:14px;font-weight:800;cursor:pointer">Record Order</button>
      </div>
      <div style="height:20px"></div>
    </div>`;
  showInline('Supplier Orders', html);
  setTimeout(() => {
    const listEl = document.getElementById('sup-inline-list');
    if (!listEl) return;
    if (!ST.suppliers.length) { listEl.innerHTML = '<div style="color:#64748b;font-size:13px;text-align:center;padding:12px">No orders recorded yet.</div>'; return; }
    listEl.innerHTML = ST.suppliers.slice(0, 10).map(s => `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:14px;font-weight:700;color:#f1f5f9">${esc(s.name)}</div><div style="font-size:11px;color:#64748b">${esc(s.items)} &bull; ${new Date(s.date).toLocaleDateString('en-GB')}</div></div>
        <div style="font-size:16px;font-weight:800;color:#ef4444">${fmt(s.amount)}</div>
      </div>`).join('');
  }, 50);
}

function openAuditInline() {
  if (!requireRole('admin')) return;
  const html = ST.audit.length === 0 ?
    '<div style="color:#64748b;text-align:center;padding:24px">No audit entries yet.</div>' :
    ST.audit.slice(0, 200).map(a => `
      <div style="padding:10px 0;border-bottom:1px solid #1e293b">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;font-weight:700;color:#10b981">${a.action}</span>
          <span style="font-size:10px;color:#64748b">${new Date(a.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(a.detail)} &bull; ${esc(a.cashier || '')}</div>
      </div>`).join('');
  showInline('Audit Log', `<div>${html}<div style="height:20px"></div></div>`);
}

function renderMore() {
  const S = ST.settings;
  const shopEl = document.getElementById('more-shopname');
  if (shopEl) shopEl.textContent = S.shopName || 'Family Shop';
  const summary = document.getElementById('more-summary-meta');
  if (summary) summary.textContent = `${S.currentCashier || 'No cashier'} · ${fbOn ? 'Cloud backup connected' : 'Local data available'}`;
  const business = document.getElementById('more-business-sub');
  if (business) business.textContent = [S.shopAddr, S.shopPhone].filter(Boolean).join(' · ') || 'Add address, contacts, receipt details and tax settings';
  const staff = document.getElementById('more-staff-sub');
  if (staff) staff.textContent = `${ST.staff.filter(s => s.active !== false).length} active staff member${ST.staff.filter(s => s.active !== false).length === 1 ? '' : 's'}`;
  const has = S.tpin && S.taxType && S.taxType !== 'none';
  const zraSub = document.getElementById('zra-sub');
  const zraBadge = document.getElementById('zra-badge');
  if (zraSub) zraSub.textContent = has ? `TPIN: ${S.tpin} · ${S.taxType.toUpperCase()}` : 'Not configured — tap Edit above';
  if (zraBadge) {
    zraBadge.textContent = has ? '✓ Active' : 'Setup';
    zraBadge.className = 'badge ' + (has ? 'bg-green' : 'bg-yellow');
  }
  const syncBadge = document.getElementById('sync-lbl2');
  if (syncBadge) {
    syncBadge.textContent = fbOn ? 'Synced ✓' : 'Offline';
    syncBadge.className = 'badge ' + (fbOn ? 'bg-green' : 'bg-yellow');
  }
  const cloudSub = document.getElementById('cloud-sub');
  if (cloudSub) cloudSub.textContent = fbOn ? 'Firebase synced ✓' : 'Configure Firebase for backup';
}

function saveShopSettings() {
  if (!requireRole('admin')) return;
  const S = ST.settings;
  S.shopName = document.getElementById('s-name').value.trim() || 'Family Shop';
  S.shopAddr = document.getElementById('s-addr').value.trim();
  S.shopPhone = document.getElementById('s-phone').value.trim();
  S.shopEmail = document.getElementById('s-email').value.trim();
  S.tpin = document.getElementById('s-tpin').value.trim();
  S.branchId = document.getElementById('s-branch').value.trim();
  S.mrcNo = document.getElementById('s-mrc').value.trim();
  S.sdcId = document.getElementById('s-sdc').value.trim();
  S.taxType = document.getElementById('s-taxtype').value;
  S.vatRate = document.getElementById('s-vatrate').value;
  S.receiptMsg = document.getElementById('s-footer').value.trim();
  S.receiptSubheader = document.getElementById('s-subhdr').value.trim();
  const f = ['tpin', 'mrc', 'sdc', 'tax', 'sig', 'qr', 'cashier', 'change', 'units', 'cust'];
  S.receiptToggles = {}; f.forEach(x => { const el = document.getElementById('rt-' + x); if (el) S.receiptToggles[x] = el.checked; });
  persist();
  document.getElementById('tb-shop').textContent = S.shopName;
  document.getElementById('pin-shopsub').textContent = S.shopName;
  closeInline(); renderMore();
  addAudit('SETTINGS', 'Shop settings updated'); toast('Settings saved ✓');
}

// ── STAFF & PIN MANAGEMENT ────────────────────────
function renderStaffList() {
  document.getElementById('staff-list').innerHTML = ST.staff.map((s, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:700;font-size:14px">${esc(s.name)} ${s.active === false ? '<span style="color:var(--text3);font-size:11px">(disabled)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text3)">Role: ${s.role}</div>
      </div>
      <div style="display:flex;gap:5px">
        ${i > 0 ? `<button class="btn btn-ghost btn-sm" onclick="toggleStaff(${i})">${s.active === false ? 'Enable' : 'Disable'}</button><button class="btn btn-danger btn-sm" onclick="rmStaff(${i})">Remove</button>` : '<span class="badge bg-green">Owner</span>'}
      </div>
    </div>`).join('');
}

async function addStaff() {
  if (!requireRole('admin')) return;
  const name = document.getElementById('sf-name').value.trim(), pin = document.getElementById('sf-pin').value.trim(), role = document.getElementById('sf-role').value;
  if (!name || pin.length !== 4) { toast('Enter name & 4-digit PIN'); return; }

  const hashed = await hashPIN(pin);
  if (ST.staff.find(s => s.pin === hashed || s.pin === pin)) { toast('PIN already in use'); return; }

  ST.staff.push({ id: 's' + Date.now(), name, pin: hashed, role, active: true });
  addAudit('ADD_STAFF', `${name} added as ${role}`);
  persist(); renderChips();
  const sfn = document.getElementById('sf-name'); if (sfn) sfn.value = '';
  const sfp = document.getElementById('sf-pin'); if (sfp) sfp.value = '';
  renderStaffList();
  toast('Staff added ✓');
}

function toggleStaff(i) { if (!requireRole('admin')) return; ST.staff[i].active = ST.staff[i].active === false; addAudit('TOGGLE_STAFF', `${ST.staff[i].name} ${ST.staff[i].active ? 'enabled' : 'disabled'}`); persist(); renderStaffList(); renderChips(); toast(ST.staff[i].name + ' ' + (ST.staff[i].active ? 'enabled' : 'disabled')); }

function rmStaff(i) {
  if (!requireRole('admin')) return;
  const name = ST.staff[i].name;
  askConfirm('Remove staff member?', `${name} will lose access. Their historical sales records will remain.`, 'Remove staff', () => {
    addAudit('REMOVE_STAFF', `${name} removed — records kept`);
    ST.staff[i].active = false; ST.staff[i].name = '[Removed] ' + name;
    persist(); renderStaffList(); renderChips(); toast('Staff access removed');
  });
}

async function changePIN() {
  if (!requireRole('admin')) return;
  const old = document.getElementById('pc-old').value, nw = document.getElementById('pc-new').value, cf = document.getElementById('pc-conf').value;
  const oldHash = await hashPIN(old);
  if (oldHash !== ST.staff[0].pin && old !== ST.staff[0].pin) { toast('Wrong current PIN'); return; }
  if (nw.length !== 4) { toast('PIN must be 4 digits'); return; }
  if (nw !== cf) { toast('PINs do not match'); return; }

  const nwHash = await hashPIN(nw);
  ST.staff[0].pin = nwHash;
  addAudit('CHANGE_PIN', 'Owner PIN changed');
  persist();
  ['pc-old', 'pc-new', 'pc-conf'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  toast('PIN updated ✓');
}

// ── SUPPLIERS ─────────────────────────────────────
function renderSupList() {
  const el = document.getElementById('sup-list');
  if (!ST.suppliers.length) { el.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px">No orders yet.</div>'; return; }
  el.innerHTML = ST.suppliers.slice(0, 10).map(s => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between"><span style="font-weight:700;font-size:13px">${esc(s.name)}</span><span style="font-weight:800;color:var(--danger)">${fmt(s.amount)}</span></div><div style="font-size:11px;color:var(--text3)">${esc(s.items)} &bull; ${new Date(s.date).toLocaleDateString('en-GB')}</div></div>`).join('');
}

function saveSupplier() {
  if (!requireRole('admin', 'supervisor')) return;
  const name = document.getElementById('sup-name').value.trim(); if (!name) { toast('Enter supplier name'); return; }
  ST.suppliers.unshift({ name, items: document.getElementById('sup-items').value.trim(), amount: parseFloat(document.getElementById('sup-amt').value) || 0, date: new Date().toISOString() });
  addAudit('SUPPLIER', `Order from ${name} — ${fmt(ST.suppliers[0].amount)}`);
  persist();
  ['sup-name', 'sup-items', 'sup-amt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  toast('Supplier order recorded ✓');
}

// ── AUDIT LOG ─────────────────────────────────────
function openAudit() {
  if (!requireRole('admin')) return;
  const el = document.getElementById('audit-list');
  if (!ST.audit.length) { el.innerHTML = '<div style="padding:16px;color:var(--text3);text-align:center">No entries yet</div>'; openOV('audit-ov'); return; }
  el.innerHTML = ST.audit.slice(0, 300).map(a => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:700;color:var(--text2)">${a.action}</span><span style="font-size:10px;color:var(--text3)">${new Date(a.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div><div style="font-size:11px;color:var(--text3)">${esc(a.detail)} &bull; ${esc(a.cashier || '')}</div></div>`).join('');
  openOV('audit-ov');
}

// ── DAILY REPORT ──────────────────────────────────
function sendDailyReport() {
  if (!requireRole('admin', 'supervisor')) return;
  const td = new Date().toDateString(), ts = ST.sales.filter(s => !s.voided && new Date(s.time).toDateString() === td);
  const tot = ts.reduce((s, x) => s + x.total, 0), cash = ts.filter(s => s.payment === 'cash').reduce((s, x) => s + x.total, 0), mob = ts.filter(s => s.payment === 'mobile').reduce((s, x) => s + x.total, 0);
  const low = ST.products.filter(p => p.qty <= p.low && p.qty > 0), out = ST.products.filter(p => p.qty <= 0);
  const msg = [`📊 *Daily Report — ${ST.settings.shopName}*`, `📅 ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}`, ``, `💰 *Total: ${fmt(tot)}*`, `  • Cash: ${fmt(cash)}`, `  • Mobile: ${fmt(mob)}`, `  • Transactions: ${ts.length}`, ``, low.length ? `⚠️ *Low (${low.length}):*\n${low.map(p => `  • ${p.name} (${p.qty})`).join('\n')}` : '✅ Stock OK', out.length ? `\n❌ *Out:*\n${out.map(p => `  • ${p.name}`).join('\n')}` : '', ``, `_ShopPOS by ZhenchStacks_`].filter(Boolean).join('\n');
  const ph = ST.settings.shopPhone ? ST.settings.shopPhone.replace(/\D/g, '') : '';
  window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── BARCODE SCANNER ───────────────────────────────
let scanStrm = null, scanAnim = null;
function openScan() {
  if (!requireRole('admin', 'supervisor')) return;
  document.getElementById('scan-ov').classList.add('open');
  navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
    .then(s => {
      scanStrm = s;
      const vid = document.getElementById('scan-vid');
      vid.srcObject = s;
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'] });
        const processFrame = () => {
          if (!scanStrm) return;
          detector.detect(vid).then(barcodes => {
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              closeScan();
              handleScannedCode(code);
            } else {
              scanAnim = requestAnimationFrame(processFrame);
            }
          }).catch(() => scanAnim = requestAnimationFrame(processFrame));
        };
        vid.onloadedmetadata = () => scanAnim = requestAnimationFrame(processFrame);
      } else {
        toast('Camera active. Point camera at barcode.');
      }
    })
    .catch(() => { toast('Camera not available'); closeScan(); });
}

function handleScannedCode(code) {
  const match = ST.products.find(p => p.barcode === code || p.id === code || code.includes(p.id));
  if (match) {
    addToCart(match.id);
    toast(`Found & added: ${match.name}`);
  } else {
    const srch = document.getElementById('stock-srch');
    if (srch) { srch.value = code; renderStock(code); goTab('stock'); }
    toast(`Scanned code: ${code}`);
  }
}

function closeScan() {
  if (scanAnim) cancelAnimationFrame(scanAnim);
  if (scanStrm) { scanStrm.getTracks().forEach(t => t.stop()); scanStrm = null; }
  document.getElementById('scan-ov').classList.remove('open');
}

// ── OVERLAYS & MODALS ─────────────────────────────
function openOV(id) {
  const el = document.getElementById(id);
  if (!el) { console.warn('Modal not found:', id); return; }
  el.classList.add('open');
  if (id === 'staff-ov') setTimeout(renderStaffList, 50);
  if (id === 'sup-ov') setTimeout(renderSupList, 50);
}
function closeOV(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
document.querySelectorAll('.overlay').forEach(el => {
  el.addEventListener('click', e => {
    if (e.target === el) {
      if (el.id === 'confirm-ov') closeConfirm();
      else el.classList.remove('open');
    }
  });
});

// ── NOTIFICATIONS ─────────────────────────────────
function reqNotif() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') chkNotifs(); }); else if ('Notification' in window && Notification.permission === 'granted') chkNotifs(); }
function chkNotifs() { const out = ST.products.filter(p => p.qty <= 0), low = ST.products.filter(p => p.qty > 0 && p.qty <= p.low); if (out.length) new Notification('ShopPOS — Out of Stock!', { body: out.slice(0, 3).map(p => p.name).join(', '), icon: '/icons/icon-192.png', tag: 'out' }); else if (low.length) new Notification('ShopPOS — Low Stock', { body: low.slice(0, 3).map(p => `${p.name} (${p.qty})`).join(', '), icon: '/icons/icon-192.png', tag: 'low' }); }
setInterval(() => { if ('Notification' in window && Notification.permission === 'granted') chkNotifs(); }, 30 * 60 * 1000);

// ── NETWORK MONITORING ────────────────────────────
window.addEventListener('online', () => { syncStatus(true); if (fbOn) cloudPull(); });
window.addEventListener('offline', () => syncStatus(false));
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => toast('Offline mode active'));
  }
});

// ── TOAST MESSAGES ────────────────────────────────
function toast(msg, dur = 2600) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), dur); }

// ── PWA INSTALL CONTROLLER (ANDROID & IOS GUIDE) ──
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (document.getElementById('app').style.display === 'flex') {
    showInstBanner();
  }
});

function showInstBanner() {
  if (document.getElementById('inst-b')) return;
  const b = document.createElement('div');
  b.id = 'inst-b';
  b.style.cssText = 'position:fixed;bottom:calc(var(--nav-h) + 12px);left:12px;right:12px;background:var(--bg2);border:1.5px solid var(--accent);border-radius:14px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;z-index:9000;box-shadow:0 8px 32px rgba(0,0,0,.6)';
  b.innerHTML = `
    <div>
      <div style="font-size:14px;font-weight:800;color:var(--text)">📲 Install ShopPOS App</div>
      <div style="font-size:11px;color:var(--text3)">Offline ready &bull; Quick home screen access</div>
    </div>
    <div style="display:flex;gap:6px">
      <button id="pwa-later-btn" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text3);font-size:12px;font-weight:700;cursor:pointer">Later</button>
      <button id="pwa-inst-btn" style="padding:8px 14px;border-radius:8px;border:none;background:var(--accent);color:#000;font-size:12px;font-weight:800;cursor:pointer">Install</button>
    </div>`;
  document.body.appendChild(b);

  document.getElementById('pwa-later-btn')?.addEventListener('click', () => b.remove());
  document.getElementById('pwa-inst-btn')?.addEventListener('click', doInst);
}

async function doInst() {
  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        toast('ShopPOS installing… ✓');
      }
      deferredInstallPrompt = null;
      document.getElementById('inst-b')?.remove();
      return;
    } catch (err) {}
  }

  // Fallback: Show explicit step-by-step instructions for Android vs iOS
  openOV('pwa-guide-ov');
}

window.addEventListener('appinstalled', () => {
  toast('ShopPOS installed successfully ✓');
  document.getElementById('inst-b')?.remove();
});

// ── KEYBOARD SHORTCUTS ────────────────────────────
document.addEventListener('keydown', e => {
  if (document.getElementById('pin-screen').style.display === 'none' && !e.target.matches('input,select,textarea')) {
    if (e.key === '1') goTab('pos'); if (e.key === '2') goTab('stock'); if (e.key === '3') goTab('reports');
    if (e.key === '4') goTab('credit'); if (e.key === '5') goTab('more');
    if (e.key === 'Escape') { document.querySelectorAll('.overlay').forEach(el => el.classList.remove('open')); closeReceipt(); }
  }
});

// ── INITIALIZATION ────────────────────────────────
(async function initApp() {
  await loadState();
  loadBG();
  renderChips();
  document.getElementById('pin-hint').textContent = 'Select your profile and enter your PIN';
  document.getElementById('pin-shopsub').textContent = ST.settings.shopName || 'Powered by ZhenchStacks';
  syncStatus(navigator.onLine);
  setInterval(() => persist(), 10 * 60 * 1000);
})();
