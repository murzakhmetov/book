(function () {
"use strict";

/* ===================================================================== data */
// Catalog data lives in data/store.js (window.BL_STORE); translations in js/i18n.js (window.BL_I18N).
var S = JSON.parse(JSON.stringify(window.BL_STORE));
var I18N = window.BL_I18N;
var PREVIEWS = {};
var LANGS = ["ru", "kk", "en"];
var LANG_NAMES = { ru: "Русский", kk: "Қазақша", en: "English" };
var LANG_SHORT = { ru: "RU", kk: "KK", en: "EN" };
var FALLBACK = { ru: ["ru", "en", "kk"], kk: ["kk", "ru", "en"], en: ["en", "ru", "kk"] };
var STORE_TZ = "+05:00";
var app = document.getElementById("app");

function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
}
function sstore(key, value) {
  try { if (value === undefined) return sessionStorage.getItem(key); if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch (e) { return null; }
}

/* ===================================================================== auth & roles */
var AUTH_USER_KEY = "bl-auth-user";
var USERS_KEY = "bl-users";
var ORDERS_KEY = "bl-orders";
var FAVS_KEY = "bl-favorites";
var ADMIN_PASS_KEY = "bl-admin-pass";

function getAdminPass() {
  try { return localStorage.getItem(ADMIN_PASS_KEY) || "admin123"; } catch (e) { return "admin123"; }
}
function setAdminPass(newPass) {
  try { localStorage.setItem(ADMIN_PASS_KEY, newPass); } catch (e) {}
}

var DEFAULT_ADMIN = {
  id: "admin_master",
  username: "admin",
  email: "admin@booklovers.kz",
  phone: "+7 747 362 46 38",
  name: "Владелец магазина (Admin)",
  role: "admin"
};

function getUsers() {
  try {
    var raw = localStorage.getItem(USERS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveUsers(arr) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(arr)); } catch (e) {}
}

var CURRENT_USER = null;
try {
  var uRaw = localStorage.getItem(AUTH_USER_KEY);
  if (uRaw) {
    var parsed = JSON.parse(uRaw);
    if (parsed) CURRENT_USER = parsed;
  }
} catch (e) { CURRENT_USER = null; }

function isStoreAdmin() {
  return !!(CURRENT_USER && CURRENT_USER.role === "admin");
}
function isCustomer() {
  return !!(CURRENT_USER && CURRENT_USER.role === "customer");
}
function setAuthUser(user) {
  CURRENT_USER = user;
  try {
    if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_USER_KEY);
  } catch (e) {}
  if (isStoreAdmin()) {
    EDITOR = true;
    ASSETS = "local";
  } else if (!window.BL_ADMIN) {
    EDITOR = false;
  }
}

/* ===================================================================== favorites */
var FAVORITES = [];
try {
  var fRaw = localStorage.getItem(FAVS_KEY);
  FAVORITES = fRaw ? JSON.parse(fRaw) : [];
  if (!Array.isArray(FAVORITES)) FAVORITES = [];
} catch (e) { FAVORITES = []; }

function isFav(id) {
  return FAVORITES.indexOf(id) !== -1;
}
function toggleFav(id) {
  var idx = FAVORITES.indexOf(id);
  var adding = false;
  if (idx !== -1) {
    FAVORITES.splice(idx, 1);
    toast(t("fav.removed"));
  } else {
    FAVORITES.push(id);
    adding = true;
    toast(t("fav.added"));
  }
  try { localStorage.setItem(FAVS_KEY, JSON.stringify(FAVORITES)); } catch (e) {}
  if (CURRENT_USER && CURRENT_USER.id && window.BL_DB && window.BL_DB.isReady()) {
    if (adding) window.BL_DB.addFavorite(CURRENT_USER.id, id);
    else window.BL_DB.removeFavorite(CURRENT_USER.id, id);
  }
  render();
}

/* ===================================================================== store orders & supabase sync */
var SB_ORDERS_FETCHED = false;
function fetchSupabaseOrdersIfNeeded() {
  if (SB_ORDERS_FETCHED || !window.BL_DB || !window.BL_DB.isReady()) return;
  SB_ORDERS_FETCHED = true;
  window.BL_DB.getAllOrders().then(function(dbOrders) {
    if (Array.isArray(dbOrders) && dbOrders.length) {
      var localOrders = getOrders();
      var idMap = {};
      localOrders.forEach(function(o) { idMap[o.id] = true; });
      var changed = false;
      dbOrders.forEach(function(dbo) {
        if (!idMap[dbo.id]) {
          localOrders.push(dbo);
          changed = true;
        }
      });
      if (changed) {
        try { localStorage.setItem(ORDERS_KEY, JSON.stringify(localOrders)); } catch (e) {}
        render();
      }
    }
  });
}

function fetchUserOrdersIfNeeded(userId) {
  if (!window.BL_DB || !window.BL_DB.isReady() || !userId) return;
  window.BL_DB.getUserOrders(userId).then(function(dbOrders) {
    if (Array.isArray(dbOrders) && dbOrders.length) {
      var localOrders = getOrders();
      var idMap = {};
      localOrders.forEach(function(o) { idMap[o.id] = true; });
      var changed = false;
      dbOrders.forEach(function(dbo) {
        if (!idMap[dbo.id]) {
          localOrders.unshift(dbo);
          changed = true;
        }
      });
      if (changed) {
        try { localStorage.setItem(ORDERS_KEY, JSON.stringify(localOrders)); } catch (e) {}
        render();
      }
    }
  });
}

function syncUserData(userId) {
  if (!window.BL_DB || !window.BL_DB.isReady() || !userId) return;
  window.BL_DB.syncFavorites(userId, FAVORITES).then(function (merged) {
    if (Array.isArray(merged) && merged.length) {
      FAVORITES = merged;
      try { localStorage.setItem(FAVS_KEY, JSON.stringify(FAVORITES)); } catch (e) {}
      render();
    }
  });
  fetchUserOrdersIfNeeded(userId);
  window.BL_DB.getCart(userId).then(function (remoteCart) {
    if (remoteCart && Object.keys(remoteCart).length > 0 && Object.keys(CART).length === 0) {
      CART = remoteCart;
      saveCart();
      render();
    }
  });
}

function getOrders() {
  try {
    var oRaw = localStorage.getItem(ORDERS_KEY);
    var arr = oRaw ? JSON.parse(oRaw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveNewOrder(order) {
  var orders = getOrders();
  orders.unshift(order);
  try { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); } catch (e) {}
}
function setOrderStatus(orderId, st) {
  var orders = getOrders();
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].id === orderId) { orders[i].status = st; break; }
  }
  try { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); } catch (e) {}
}

/* ===================================================================== state */
var R = { lang: "ru", view: "home", arg: "" };
var F = { q: "", sort: "", min: "", max: "", stock: false, level: "", age: "", cat: "", genre: "", shown: 12 };
var UI = {
  menu: false, drawer: false, filters: false, search: false, suggest: "", toast: "", checkout: null, sent: null, reviewSent: false, consultSent: false,
  authModal: null, cabinetModal: null, authError: "", cabinetMsg: ""
};
var EDITOR = false, ASSETS = null, ARTIFACT = null, DIRTY = 0, ADMIN = { tab: "books", q: "", edit: null, promo: null, confirm: "", msg: "", busy: false, importPreview: null };

/* ===================================================================== i18n */
function lookup(key, lang) {
  var chain = FALLBACK[lang || R.lang];
  for (var i = 0; i < chain.length; i++) {
    var v = (I18N[chain[i]] || {})[key];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}
function fill(s, p) { return p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return p[k] !== undefined ? p[k] : m; }) : s; }
function t(key, p) { var v = lookup(key); if (v === undefined) return key; if (typeof v === "object") v = v.other || key; return fill(v, p); }
function pluralForm(n, lang) {
  n = Math.abs(n);
  if (lang === "ru") { if (n % 10 === 1 && n % 100 !== 11) return "one"; if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return "few"; return "many"; }
  if (lang === "en") return n === 1 ? "one" : "other";
  return "other";
}
function tn(key, n, p) {
  var v = lookup(key); p = Object.assign({ n: n }, p || {});
  if (v && typeof v === "object") return fill(v[pluralForm(n, R.lang)] || v.other, p);
  return fill(v === undefined ? key : v, p);
}
function loc(obj) { if (!obj) return ""; var c = FALLBACK[R.lang]; for (var i = 0; i < c.length; i++) if (obj[c[i]]) return obj[c[i]]; return ""; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function price(n) {
  n = Math.round(n || 0);
  var s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "−" : "") + s + " ₸";
}
function fold(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ё/g, "е"); }

/* ===================================================================== catalog */
function catBySlug(slug) { for (var i = 0; i < S.categories.length; i++) if (S.categories[i].slug === slug) return S.categories[i]; return null; }
function ageBySlug(slug) { for (var i = 0; i < S.ages.length; i++) if (S.ages[i].slug === slug) return S.ages[i]; return null; }
function topCats() { return S.categories.filter(function (c) { return !c.parent && c.visible !== false; }); }
function childCats(slug) { return S.categories.filter(function (c) { return c.parent === slug && c.visible !== false; }); }
function publicProducts() { return S.products.filter(function (p) { return p.status === "active"; }); }
function productBySlug(slug) { return S.products.filter(function (p) { return p.slug === slug; })[0] || null; }
function productById(id) { return S.products.filter(function (p) { return p.id === id; })[0] || null; }
function coverUrl(p) {
  if (!p.cover) return "";
  if (/^https:\/\//.test(p.cover)) return p.cover;
  if (PREVIEWS[p.cover]) return PREVIEWS[p.cover];
  if (/^images\/[\w.\/-]+$/.test(p.cover)) return p.cover;
  return "";
}
function stockState(p) { var low = S.settings.lowStock || 3; return p.stock <= 0 ? "out" : (p.stock <= low ? "low" : "in"); }
function countIn(cat) { return publicProducts().filter(function (p) { return p.cat === cat || p.genre === cat; }).length; }
function catName(p) { var g = catBySlug(p.genre) || catBySlug(p.cat); return g ? loc(g.name) : ""; }

/* ===================================================================== pricing */
function promoState(p) {
  if (!p.active) return "inactive";
  var now = Date.now();
  if (p.starts && Date.parse(p.starts) > now) return "scheduled";
  if (p.ends && Date.parse(p.ends) <= now) return "expired";
  return "active";
}
function activePromos() { return S.promotions.filter(function (p) { return promoState(p) === "active"; }); }
function applies(promo, prod) {
  if (promo.scope === "all") return true;
  if (promo.scope === "category") return promo.category === prod.cat || promo.category === prod.genre;
  return (promo.products || []).indexOf(prod.id) !== -1;
}
function rnd(x) { return Math.floor(x + 0.5); }
function priceInfo(prod) {
  var original = prod.price, best = original, source = null, used = null;
  if (prod.sale != null && prod.sale !== "" && +prod.sale < best) { best = +prod.sale; source = "sale"; }
  activePromos().forEach(function (pr) {
    if (pr.kind === "bundle" || !applies(pr, prod)) return;
    var c = pr.kind === "percent" ? original - rnd(original * Math.min(pr.value, 100) / 100) : original - pr.value;
    c = Math.max(c, 0);
    if (c < best) { best = c; source = "promo"; used = pr; }
  });
  var discount = original - best;
  return { original: original, final: best, discount: discount, percent: original && discount ? rnd(discount * 100 / original) : 0,
           badge: used ? loc(used.badge) : "", promoName: used ? used.name : (source === "sale" ? "sale" : "") };
}
function badgesFor(p) {
  var pi = priceInfo(p);
  if (pi.discount > 0) return [["promo", pi.badge || ("−" + pi.percent + "%")]];
  if (p.promo) return [["promo", t("badge.promo")]];
  if (p.isNew) return [["new", t("badge.new")]];
  if (p.trending) return [["trending", t("badge.trending")]];
  return [];
}
function computeCart(lines) {
  var priced = [], subtotal = 0, items = 0;
  lines.forEach(function (l) {
    var pi = priceInfo(l.p), total = pi.final * l.qty;
    subtotal += pi.original * l.qty; items += total;
    priced.push({ p: l.p, qty: l.qty, pi: pi, total: total });
  });
  var bundle = null, bdisc = 0, hint = null;
  activePromos().forEach(function (pr) {
    if (pr.kind !== "bundle" || !pr.min) return;
    var el = priced.filter(function (x) { return applies(pr, x.p); });
    var q = el.reduce(function (a, x) { return a + x.qty; }, 0);
    if (q >= pr.min) {
      var d = rnd(el.reduce(function (a, x) { return a + x.total; }, 0) * Math.min(pr.value, 100) / 100);
      if (d > bdisc) { bdisc = d; bundle = pr; }
    } else if (q > 0) {
      var miss = pr.min - q;
      if (!hint || miss < hint.missing) hint = { missing: miss, percent: pr.value };
    }
  });
  return { lines: priced, subtotal: subtotal, itemDiscount: subtotal - items, items: items, bundle: bundle,
           bundleDiscount: bdisc, hint: bundle ? null : hint, total: items - bdisc,
           qty: priced.reduce(function (a, x) { return a + x.qty; }, 0) };
}
function deliveryFee(method, itemsTotal) {
  var s = S.settings;
  if (method === "courier") return (s.freeFrom && itemsTotal >= s.freeFrom) ? 0 : (+s.feeCourier || 0);
  if (method === "post") return +s.feePost || 0;
  return 0;
}

/* ===================================================================== cart (this browser only) */
var CART = {};
try { CART = JSON.parse(store("bl-cart") || "{}") || {}; } catch (e) { CART = {}; }
function saveCart() {
  store("bl-cart", JSON.stringify(CART));
  if (CURRENT_USER && CURRENT_USER.id && window.BL_DB && window.BL_DB.isReady()) {
    window.BL_DB.saveCart(CURRENT_USER.id, CART);
  }
}
function cartLines() {
  var lines = [], out = [], changed = false;
  Object.keys(CART).forEach(function (id) {
    var p = productById(id);
    if (!p || p.status !== "active") { delete CART[id]; changed = true; return; }
    if (p.stock <= 0) { out.push(p); return; }
    var q = Math.min(CART[id], p.stock, 20);
    if (q !== CART[id]) { CART[id] = q; changed = true; }
    lines.push({ p: p, qty: q });
  });
  if (changed) saveCart();
  return { lines: lines, out: out };
}
function cartCount() { return cartLines().lines.reduce(function (a, l) { return a + l.qty; }, 0); }
function addToCart(id, qty) {
  var p = productById(id);
  if (!p || p.stock <= 0) return "out";
  var want = (CART[id] || 0) + (qty || 1), allowed = Math.min(want, p.stock, 20);
  CART[id] = allowed; saveCart();
  return allowed === want ? "added" : "limited";
}

/* ===================================================================== phone & WhatsApp */
function normKz(raw) {
  var d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 && /^[67]/.test(d)) d = "7" + d;
  else if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  return (d.length === 11 && d[0] === "7" && /[67]/.test(d[1])) ? d : null;
}
function normPhone(raw) {
  var kz = normKz(raw); if (kz) return "+" + kz;
  var d = String(raw || "").replace(/\D/g, "");
  return (String(raw || "").trim()[0] === "+" && d.length >= 8 && d.length <= 15) ? "+" + d : null;
}
function fmtPhone(e) { var d = String(e || "").replace(/\D/g, ""); return d.length === 11 && d[0] === "7" ? "+7 " + d.slice(1, 4) + " " + d.slice(4, 7) + " " + d.slice(7, 9) + " " + d.slice(9) : (e || ""); }
function waDigits() { return normKz(S.settings.whatsapp) || String(S.settings.whatsapp || "").replace(/\D/g, "") || ""; }
function waLink(text) { var d = waDigits(); return d ? "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "") : ""; }

/* ===================================================================== routing */
var VIEWS = ["home", "catalog", "popular", "new", "offers", "children", "book", "reviews", "help", "contact", "delivery", "cart", "checkout", "privacy", "terms", "admin", "account"];
function token(view, arg, lang) { return (lang || R.lang) + "-" + view + (arg ? "-" + arg : ""); }
function href(view, arg, lang) { return "#" + token(view, arg, lang); }
function parseToken(tok) {
  var out = { lang: null, view: "home", arg: "" };
  if (!tok) return out;
  var parts = tok.split("-");
  if (LANGS.indexOf(parts[0]) !== -1) { out.lang = parts.shift(); }
  if (parts.length && VIEWS.indexOf(parts[0]) !== -1) { out.view = parts.shift(); out.arg = parts.join("-"); }
  return out;
}
function go(tok, push) {
  var r = parseToken(tok);
  var lang = r.lang || R.lang;
  var sameView = r.view === R.view && r.arg === R.arg;
  R.lang = lang; R.view = r.view; R.arg = r.arg;
  store("bl-lang", lang);
  if (["catalog", "popular", "new", "offers"].indexOf(r.view) !== -1 && !sameView) {
    F = { q: r.view === "catalog" ? F.q : "", sort: "", min: "", max: "", stock: false, level: "", age: "", cat: "", genre: "", shown: 12 };
    if (r.view === "catalog" && r.arg) {
      if (r.arg.indexOf("age-") === 0) F.age = r.arg.slice(4);
      else { var c = catBySlug(r.arg); if (c) { if (c.parent) { F.genre = c.slug; F.cat = c.parent; } else F.cat = c.slug; } }
    }
  }
  if (r.view !== "checkout") UI.sent = null;
  UI.menu = false; UI.drawer = false; UI.filters = false; UI.suggest = ""; UI.search = false;
  if (push !== false) { try { history.pushState(null, "", "#" + token(R.view, R.arg)); } catch (e) { /* frame may refuse */ } }
  render();
  if (!sameView) window.scrollTo(0, 0);
}
window.addEventListener("popstate", function () { go(location.hash.slice(1), false); });

/* ===================================================================== small view helpers */
function icon(name, cls) { return '<svg class="icon ' + (cls || "") + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>'; }
function stars(n) {
  var s = '<span class="stars" role="img" aria-label="' + esc(t("reviews.stars", { n: n })) + '">';
  for (var i = 1; i <= 5; i++) s += '<svg class="icon' + (i > n ? " is-empty" : "") + '" aria-hidden="true"><use href="#i-star"/></svg>';
  return s + "</span>";
}
function priceBlock(p) {
  var pi = priceInfo(p);
  return '<div class="price"><span class="price__now' + (pi.discount ? " is-sale" : "") + '">' + price(pi.final) + "</span>" +
    (pi.discount ? '<span class="price__old"><span class="visually-hidden">' + esc(t("product.old_price")) + "</span>" + price(pi.original) + "</span>" : "") + "</div>";
}
function stockLabel(p) {
  var s = stockState(p);
  if (s === "out") return '<span class="stock stock--out">' + esc(t("product.out_of_stock")) + "</span>";
  if (s === "low") return '<span class="stock stock--low">' + esc(t("product.low_stock", { n: p.stock })) + "</span>";
  return '<span class="stock">' + esc(t("product.in_stock")) + "</span>";
}
function coverImg(p, w, h, extra) {
  var u = coverUrl(p);
  if (!u) return '<span class="cover-fallback" aria-hidden="true"><span>' + esc(p.title) + "</span><small>" + esc(p.author) + "</small></span>";
  return '<img src="' + esc(u) + '" alt="' + esc(extra || "") + '" width="' + w + '" height="' + h + '" loading="lazy" data-cover>';
}
function addBtn(p, label, cls) {
  return '<button class="' + (cls || "btn") + '" type="button" data-act="add" data-id="' + esc(p.id) + '">' + icon("bag") + "<span>" + esc(label || t("product.add_to_cart")) + "</span></button>";
}
function card(p) {
  var url = href("book", p.slug), b = badgesFor(p), s = stockState(p);
  var favActive = isFav(p.id);
  return '<article class="card">' +
    '<button class="fav-btn' + (favActive ? ' is-active' : '') + '" type="button" data-act="toggle-fav" data-id="' + esc(p.id) + '" aria-label="' + esc(t("nav.favorites")) + '" title="' + esc(t("nav.favorites")) + '">' + icon("heart") + '</button>' +
    '<a class="card__cover' + (s === "out" ? " is-out" : "") + '" href="' + url + '" tabindex="-1" aria-hidden="true">' +
    (b.length ? '<span class="badges"><span class="badge badge--' + b[0][0] + '">' + esc(b[0][1]) + "</span></span>" : "") + coverImg(p, 400, 600) + "</a>" +
    '<div class="card__meta"><span>' + esc(catName(p)) + "</span>" + (p.demo && S.settings.demoMode ? '<span class="card__demo">' + esc(t("demo.label")) + "</span>" : "") + "</div>" +
    '<a class="card__title" href="' + url + '" lang="en">' + esc(p.title) + "</a>" +
    '<div class="card__author" lang="en">' + esc(p.author) + "</div>" +
    '<div class="card__bottom">' + priceBlock(p) + stockLabel(p) +
    '<div class="card__actions">' + (s === "out" ? '<a class="btn btn--ghost" href="' + url + '">' + esc(t("product.details")) + "</a>" :
      addBtn(p) + '<a class="btn btn--details" href="' + url + '" aria-label="' + esc(t("product.details") + ": " + p.title) + '" title="' + esc(t("product.details")) + '">' + icon("eye") + "</a>") +
    "</div>" +
    (isStoreAdmin() ? '<button class="card-admin-action" type="button" data-act="admin-edit" data-id="' + esc(p.id) + '">' + icon("edit") + ' ' + esc(A("edit")) + '</button>' : '') +
    "</div></article>";
}
function rowBook(p) {
  return '<div class="row-book"><a href="' + href("book", p.slug) + '" tabindex="-1" aria-hidden="true">' + coverImg(p, 72, 108) + "</a><div>" +
    '<a class="row-book__title" href="' + href("book", p.slug) + '" lang="en">' + esc(p.title) + '</a><div class="row-book__author">' + esc(p.author) + "</div>" + priceBlock(p) + "</div>" +
    (stockState(p) !== "out" ? addBtn(p, t("product.add_short"), "btn btn--ghost btn--small") : '<span class="stock stock--out">' + esc(t("product.out_of_stock")) + "</span>") + "</div>";
}
function sectionHead(title, sub, linkHref, linkText, id) {
  return '<div class="section-head"><div><h2' + (id ? ' id="' + id + '"' : "") + ">" + esc(title) + "</h2>" + (sub ? '<div class="section-head__sub">' + sub + "</div>" : "") + "</div>" +
    (linkHref ? '<a class="section-head__link" href="' + linkHref + '">' + esc(linkText) + "</a>" : "") + "</div>";
}
function ageLabel(a) { return a.slug.replace("-plus", "+").replace("-", "–"); }
function crumbs(items) {
  return '<nav class="crumbs" aria-label="' + esc(t("nav.breadcrumbs")) + '">' + items.map(function (it, i) {
    return (i ? '<span aria-hidden="true">/</span>' : "") + (it[1] ? '<a href="' + it[1] + '">' + esc(it[0]) + "</a>" : "<span>" + esc(it[0]) + "</span>");
  }).join("") + "</nav>";
}

/* ===================================================================== header / footer */
function header() {
  var nav = [["home", "nav.home"], ["catalog", "nav.catalog"], ["popular", "nav.popular"], ["children", "nav.children"], ["reviews", "nav.reviews"], ["contact", "nav.contact"]];
  var cc = cartCount(), ann = loc(S.settings.announcement), demoHidden = store("bl-demo-hidden") === "1";
  var langs = LANGS.map(function (l) { return '<a href="' + href(R.view, R.arg, l) + '" lang="' + l + '" title="' + LANG_NAMES[l] + '"' + (l === R.lang ? ' aria-current="true"' : "") + ">" + LANG_SHORT[l] + "</a>"; }).join("");
  var h = "";
  if (isStoreAdmin() || (EDITOR && window.BL_ADMIN)) {
    h += '<div class="editbar"><div class="wrap"><span>👑 ' + esc(CURRENT_USER && CURRENT_USER.name ? CURRENT_USER.name : "Владелец магазина") + (DIRTY ? ", " + esc(A("unsaved", { n: DIRTY })) : "") + '</span><span class="editbar__actions">' +
      (DIRTY || window.BL_ADMIN ? '<button class="btn btn--small btn--light" type="button" data-act="publish"' + (ADMIN.busy ? " disabled" : "") + ">" + esc(A("publish")) + "</button>" : "") +
      (R.view !== "admin" ? '<a class="btn btn--small btn--ghost-light" href="' + href("admin") + '">' + esc(t("site.manage")) + "</a>" : '<a class="btn btn--small btn--ghost-light" href="' + href("home") + '">' + esc(A("preview")) + "</a>") +
      '<button class="btn btn--small btn--ghost-light" type="button" data-act="logout">' + icon("logout") + ' ' + esc(t("nav.logout")) + '</button>' +
      "</span></div></div>";
  }
  if (ann) h += '<div class="topbar">' + esc(ann) + "</div>";
  if (S.settings.demoMode && !demoHidden) h += '<div class="demo-bar"><div class="wrap">' + icon("info") + "<span>" + esc(t("demo.banner")) + '</span><button type="button" data-act="hide-demo" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + "</button></div></div>";
  h += '<header class="header"><div class="wrap header__row">' +
    '<button class="icon-btn mobile-only" type="button" data-act="menu" aria-label="' + esc(t("nav.menu")) + '" aria-expanded="' + UI.menu + '">' + icon("menu") + "</button>" +
    '<a class="wordmark" href="' + href("home") + '">book_lovers<span>.kz</span></a>' +
    '<nav class="nav" aria-label="' + esc(t("nav.main")) + '">' + nav.map(function (n) { return '<a href="' + href(n[0]) + '"' + (R.view === n[0] ? ' aria-current="page"' : "") + ">" + esc(t(n[1])) + "</a>"; }).join("") + "</nav>" +
    '<div class="header__tools">' + searchBox("desk") +
    '<nav class="langs desktop-only" aria-label="' + esc(t("nav.language")) + '">' + langs + "</nav>" +
    '<button class="icon-btn" type="button" data-act="cabinet-fav" aria-label="' + esc(t("nav.favorites")) + '" title="' + esc(t("nav.favorites")) + '">' + icon("heart") + (FAVORITES.length ? '<span class="fav-badge">' + FAVORITES.length + '</span>' : '') + '</button>' +
    (isStoreAdmin() ?
      '<a class="user-btn user-btn--admin" href="' + href("admin") + '" title="' + esc(t("site.manage")) + '"><span class="user-avatar">👑</span><span class="desktop-only">' + esc(CURRENT_USER.name || "Владелец") + '</span></a>' :
      (CURRENT_USER ?
        '<button class="user-btn" type="button" data-act="cabinet-open" title="' + esc(t("nav.account")) + '"><span class="user-avatar">👤</span><span class="desktop-only">' + esc(CURRENT_USER.name || t("nav.account")) + '</span></button>' :
        '<button class="user-btn" type="button" data-act="auth-open" title="' + esc(t("nav.login")) + '"><span class="user-avatar">👤</span><span class="desktop-only">' + esc(t("nav.login")) + '</span></button>')) +
    '<button class="icon-btn mobile-only" type="button" data-act="search-toggle" aria-label="' + esc(t("nav.search_label")) + '">' + icon("search") + "</button>" +
    '<details class="lang-pop mobile-only"><summary class="icon-btn" aria-label="' + esc(t("nav.language")) + '"><span class="lang-pop__current">' + LANG_SHORT[R.lang] + '</span></summary><div class="lang-pop__menu">' +
    LANGS.map(function (l) { return '<a href="' + href(R.view, R.arg, l) + '" lang="' + l + '"' + (l === R.lang ? ' aria-current="true"' : "") + ">" + LANG_NAMES[l] + "</a>"; }).join("") + "</div></details>" +
    '<a class="icon-btn" href="' + href("cart") + '" data-act="drawer" aria-label="' + esc(t("nav.cart")) + '">' + icon("bag") + (cc ? '<span class="cart-count">' + cc + "</span>" : "") + "</a>" +
    "</div></div>" + (UI.search ? '<div class="mobile-search"><div class="wrap">' + searchBox("mob") + "</div></div>" : "") + "</header>";
  h += '<div class="mobile-nav' + (UI.menu ? " is-open" : "") + '" aria-hidden="' + !UI.menu + '"><div class="mobile-nav__top"><a class="wordmark" href="' + href("home") + '">book_lovers<span>.kz</span></a>' +
    '<button class="icon-btn" type="button" data-act="menu" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + "</button></div><nav>" +
    nav.concat([["offers", "nav.offers"]]).map(function (n) { return '<a href="' + href(n[0]) + '">' + esc(t(n[1])) + "</a>"; }).join("") +
    '</nav>' +
    '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);">' +
    (isStoreAdmin() ?
      '<a class="btn btn--small btn--rose btn--block" style="margin-bottom:8px;text-align:center;" href="' + href("admin") + '">' + icon("shield") + ' ' + esc(t("site.manage")) + '</a>' +
      '<button class="btn btn--ghost btn--small btn--block" type="button" data-act="logout">' + icon("logout") + ' ' + esc(t("nav.logout")) + '</button>' :
      (CURRENT_USER ?
        '<button class="btn btn--small btn--rose btn--block" style="margin-bottom:8px;" type="button" data-act="cabinet-open">' + icon("user") + ' ' + esc(CURRENT_USER.name || t("nav.account")) + '</button>' +
        '<button class="btn btn--ghost btn--small btn--block" type="button" data-act="logout">' + icon("logout") + ' ' + esc(t("nav.logout")) + '</button>' :
        '<button class="btn btn--ghost btn--small btn--block" type="button" data-act="auth-open">' + icon("user") + ' ' + esc(t("nav.login")) + '</button>')) +
    '</div>' +
    '<div class="mobile-nav__langs langs">' + LANGS.map(function (l) { return '<a href="' + href(R.view, R.arg, l) + '"' + (l === R.lang ? ' aria-current="true"' : "") + ">" + LANG_NAMES[l] + "</a>"; }).join("") + "</div>" +
    (waLink() ? '<a class="btn btn--ghost" style="margin-top:20px" href="' + esc(waLink(t("consult.wa_text"))) + '" target="_blank" rel="noopener">' + icon("whatsapp") + " " + esc(t("social.write_whatsapp")) + "</a>" : "") + "</div>";
  return h;
}
function searchBox(id) {
  return '<form class="search" role="search" data-form="search"><label class="visually-hidden" for="q-' + id + '">' + esc(t("nav.search_label")) + "</label>" + icon("search", "search__icon") +
    '<input class="search__input" id="q-' + id + '" type="search" name="q" value="' + esc(F.q) + '" placeholder="' + esc(t("nav.search_placeholder")) + '" autocomplete="off" maxlength="100" data-search-input>' +
    '<div class="suggest" role="listbox"' + (UI.suggest && UI.suggestFor === id ? "" : " hidden") + ">" + (UI.suggestFor === id ? UI.suggest : "") + "</div></form>";
}
function footer() {
  var wa = waLink(t("consult.wa_text")), s = S.settings, ph = normPhone(s.phone);
  return '<footer class="footer"><div class="wrap"><div class="footer__grid"><div><a class="wordmark" href="' + href("home") + '">book_lovers<span>.kz</span></a><p class="footer__about">' + esc(t("footer.about")) + '</p><div class="footer__social">' +
    (s.instagram ? '<a href="' + esc(s.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram">' + icon("instagram") + "</a>" : "") +
    (wa ? '<a href="' + esc(wa) + '" target="_blank" rel="noopener" aria-label="WhatsApp">' + icon("whatsapp") + "</a>" : "") +
    (s.tiktok ? '<a href="' + esc(s.tiktok) + '" target="_blank" rel="noopener" aria-label="TikTok">' + icon("tiktok") + "</a>" : "") + "</div></div>" +
    "<div><h4>" + esc(t("footer.shop")) + "</h4><ul>" + [["catalog", "nav.catalog"], ["popular", "nav.popular"], ["new", "nav.new"], ["offers", "nav.offers"], ["children", "nav.children"]].map(function (n) { return '<li><a href="' + href(n[0]) + '">' + esc(t(n[1])) + "</a></li>"; }).join("") +
    '<li><a href="' + href("catalog", "english-learning") + '">' + esc(t("footer.english")) + "</a></li></ul></div>" +
    "<div><h4>" + esc(t("footer.help")) + "</h4><ul>" + [["delivery", "footer.delivery"], ["help", "footer.consultation"], ["reviews", "nav.reviews"], ["privacy", "footer.privacy"], ["terms", "footer.terms"]].map(function (n) { return '<li><a href="' + href(n[0]) + '">' + esc(t(n[1])) + "</a></li>"; }).join("") + "</ul></div>" +
    "<div><h4>" + esc(t("nav.contact")) + "</h4><ul>" + (ph ? '<li><span class="selectable">' + esc(fmtPhone(ph)) + "</span></li>" : "") + (wa ? '<li><a href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a></li>' : "") +
    (s.email ? '<li><span class="selectable">' + esc(s.email) + "</span></li>" : "") + '<li class="muted">' + esc(loc(s.hours)) + '</li><li class="muted">' + esc(loc(s.city)) + "</li></ul></div></div>" +
    '<div class="footer__bottom"><span>© ' + new Date().getFullYear() + " book_lovers.kz. " + esc(t("footer.rights")) + "</span><span>" + esc(t("footer.prices_note")) + "</span>" +
    '<a href="' + (isStoreAdmin() ? href("admin") : '#admin') + '"' + (isStoreAdmin() ? '' : ' data-act="auth-open"') + '>' + (isStoreAdmin() ? esc(t("site.manage")) : esc(t("auth.admin_tab"))) + "</a></div></div></footer>";
}

/* ===================================================================== pages */
function pageHome() {
  var prods = publicProducts();
  var byRank = function (a, b) { return a.rank - b.rank; };
  var trending = prods.filter(function (p) { return p.trending; }).sort(byRank).slice(0, 8);
  var hero = prods.filter(function (p) { return p.featured; }).sort(byRank).slice(0, 5);
  if (!hero.length) hero = trending.slice(0, 5);
  var news = prods.filter(function (p) { return p.isNew; }).sort(byRank).slice(0, 4);
  var sale = prods.filter(function (p) { return priceInfo(p).discount > 0 || p.promo; }).sort(function (a, b) { return priceInfo(b).percent - priceInfo(a).percent; }).slice(0, 2);
  var offers = activePromos().filter(function (p) { return p.home; });
  var reviews = S.reviews.filter(function (r) { return r.status === "approved"; });
  var wa = waLink(t("consult.wa_text"));
  var h = '<section class="hero"><div class="wrap hero__grid"><div><h1>' + esc(t("hero.title")) + '</h1><p class="hero__text">' + esc(t("hero.text")) + "</p>" +
    '<div class="hero__actions"><a class="btn" href="' + href("catalog") + '">' + esc(t("hero.cta_catalog")) + '</a><a class="btn btn--ghost" href="' + href("help") + '">' + esc(t("hero.cta_help")) + "</a></div>" +
    '<div class="hero__meta"><span>' + icon("book") + esc(t("hero.point_original")) + "</span><span>" + icon("truck") + esc(t("hero.point_delivery")) + "</span><span>" + icon("level") + esc(t("hero.point_levels")) + "</span></div></div>";
  if (hero.length) h += '<div class="shelf" aria-label="' + esc(t("hero.shelf_label")) + '"><div class="shelf__arch"></div><div class="shelf__books">' +
    hero.map(function (p) { return '<a class="shelf__book" href="' + href("book", p.slug) + '" title="' + esc(p.title + " — " + p.author) + '">' + coverImg(p, 200, 300, p.title + " — " + p.author) + "</a>"; }).join("") + '</div><div class="shelf__board"></div></div>';
  h += "</div></section>";
  if (trending.length) h += '<section class="section"><div class="wrap">' + sectionHead(t("home.trending_title"), '<span lang="en">Trending now</span>', href("popular"), t("home.see_all")) + '<div class="grid">' + trending.map(card).join("") + "</div></div></section>";
  h += '<section class="section"><div class="wrap">' + sectionHead(t("home.categories_title"), esc(t("home.categories_sub")), href("catalog"), t("home.full_catalog")) + '<div class="cats">' +
    topCats().map(function (c) {
      var covers = prods.filter(function (p) { return (p.cat === c.slug || p.genre === c.slug) && coverUrl(p); }).sort(function (a, b) { return (b.trending - a.trending) || (a.rank - b.rank); }).slice(0, 3);
      return '<a class="cat" href="' + href("catalog", c.slug) + '"><div class="cat__fan" aria-hidden="true">' + covers.map(function (p) { return '<img src="' + esc(coverUrl(p)) + '" alt="" loading="lazy">'; }).join("") + "</div><h3>" + esc(loc(c.name)) + "</h3><p>" + esc(loc(c.desc)) + '</p><span class="cat__count">' + esc(tn("catalog.books_count", countIn(c.slug))) + "</span></a>";
    }).join("") + "</div></div></section>";
  h += '<section class="section"><div class="wrap">' + sectionHead(t("home.ages_title"), esc(t("home.ages_sub")), href("children"), t("home.ages_all")) + '<div class="ages">' +
    S.ages.map(function (a) {
      var n = prods.filter(function (p) { return p.ages.indexOf(a.slug) !== -1; }).length;
      return '<div class="age"><div class="age__num">' + ageLabel(a) + '</div><div class="age__unit">' + esc(t("age.unit")) + "</div><p>" + esc(loc(a.desc)) + '</p><a class="age__link" href="' + href("catalog", "age-" + a.slug) + '">' + esc(t("home.ages_link")) + ' <span class="muted">(' + n + ")</span></a></div>";
    }).join("") + "</div></div></section>";
  h += '<section class="section"><div class="wrap split"><div>' + sectionHead(t("home.new_title"), esc(t("home.new_sub")), href("new"), t("home.see_all")) +
    (news.length ? '<div class="list-books">' + news.map(rowBook).join("") + "</div>" : '<p class="muted">' + esc(t("home.new_empty")) + "</p>") + "</div><div>" +
    sectionHead(t("home.offers_title"), esc(t("home.offers_sub")), href("offers"), t("home.see_all")) + '<div class="offer-panel">' +
    (offers.length ? offers.map(function (o) {
      return '<div class="offer"><span class="offer__badge">' + esc(loc(o.badge) || ("−" + o.value + (o.kind === "fixed" ? " ₸" : "%"))) + '</span><span class="offer__text">' + esc(loc(o.desc) || t("offers.generic")) +
        (o.ends ? '<span class="offer__until">' + esc(t("offers.until", { date: fmtDate(o.ends) })) + "</span>" : "") + "</span></div>";
    }).join("") : "<p>" + esc(t("home.offers_empty")) + "</p>") +
    (sale.length ? '<div class="list-books" style="margin-top:8px">' + sale.map(rowBook).join("") + "</div>" : "") + "</div></div></div></section>";
  if (reviews.length) {
    var avg = reviews.reduce(function (a, r) { return a + r.rating; }, 0) / reviews.length;
    h += '<section class="section"><div class="wrap"><div class="section-head"><div><h2>' + esc(t("reviews.title")) + '</h2><div class="rating-summary"><strong>' + avg.toFixed(1) + "</strong>" + stars(Math.round(avg)) + "<span>" + esc(tn("reviews.count", reviews.length)) + '</span></div></div><a class="section-head__link" href="' + href("reviews") + '">' + esc(t("reviews.all")) + '</a></div><div class="reviews">' +
      reviews.slice(0, 3).map(reviewCard).join("") + "</div></div></section>";
  }
  h += '<section class="consult"><div class="wrap consult__grid"><div><h2>' + esc(t("consult.title")) + "</h2><p>" + esc(t("consult.text")) + '</p><div class="consult__actions"><a class="btn btn--light" href="' + href("help") + '">' + esc(t("consult.cta")) + "</a>" +
    (wa ? '<a class="btn btn--ghost" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon("whatsapp") + " " + esc(t("social.write_whatsapp")) + "</a>" : "") + "</div></div>" +
    '<div class="consult__list"><div>' + icon("level") + "<span>" + esc(t("consult.point_level")) + "</span></div><div>" + icon("age") + "<span>" + esc(t("consult.point_age")) + "</span></div><div>" + icon("gift") + "<span>" + esc(t("consult.point_gift")) + "</span></div></div></div></section>";
  h += '<section class="section"><div class="wrap">' + sectionHead(t("social.title"), esc(t("social.sub"))) + socialBlock() + "</div></section>";
  return h;
}
function reviewCard(r) {
  return '<figure class="review">' + stars(r.rating) + '<blockquote lang="' + esc(r.lang) + '">' + esc(r.text) + '</blockquote><figcaption class="review__who"><strong>' + esc(r.name) + "</strong>" +
    (r.sample ? '<span class="sample-tag">' + esc(t("demo.review_label")) + "</span>" : "") + (r.book ? '<span class="review__book">' + esc(t("reviews.purchased", { title: r.book })) + "</span>" : "") + "</figcaption></figure>";
}
function socialBlock() {
  var s = S.settings, wa = waLink(t("consult.wa_text"));
  function item(url, ic, name, text) {
    return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + icon(ic) + '<span><span class="social__name">' + name + '</span><span class="social__handle">' + esc(text) + "</span></span></a>"
      : '<div class="social__soon">' + icon(ic) + '<span><span class="social__name">' + name + '</span><span class="social__handle">' + esc(t("social.soon")) + "</span></span></div>";
  }
  return '<div class="social">' + item(s.instagram, "instagram", "Instagram", t("social.instagram_text")) + item(wa, "whatsapp", "WhatsApp", fmtPhone("+" + waDigits())) + item(s.tiktok, "tiktok", "TikTok", t("social.tiktok_text")) + "</div>";
}
function fmtDate(iso) {
  var d = new Date(Date.parse(iso) + 5 * 3600 * 1000); // shown in store time (UTC+5)
  function p(n) { return n < 10 ? "0" + n : n; }
  return p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1) + "." + d.getUTCFullYear();
}

/* ---- catalog */
function searchScore(p, qf, terms) {
  var title = fold(p.title), author = fold(p.author), score = 0;
  if (title === qf) score += 100; else if (title.indexOf(qf) === 0) score += 60; else if (title.indexOf(qf) !== -1) score += 40;
  if (author.indexOf(qf) !== -1) score += 35;
  var cats = [catBySlug(p.cat), catBySlug(p.genre)].filter(Boolean).map(function (c) { return c.slug + " " + c.name.ru + " " + c.name.kk + " " + c.name.en; }).join(" ");
  var hay = [title, author, fold(p.tags), fold(cats), fold(p.desc.ru), fold(p.desc.kk), fold(p.desc.en)].join(" ");
  for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return 0;
  if (fold(cats).indexOf(qf) !== -1) score = Math.max(score, 20);
  return score + terms.length * 5;
}
function filterProducts(view) {
  var items = publicProducts();
  if (view === "popular") items = items.filter(function (p) { return p.trending; });
  if (view === "new") items = items.filter(function (p) { return p.isNew; });
  if (view === "offers") items = items.filter(function (p) { return priceInfo(p).discount > 0 || p.promo; });
  if (F.cat) items = items.filter(function (p) { return p.cat === F.cat || (catBySlug(p.genre) || {}).parent === F.cat; });
  if (F.genre) items = items.filter(function (p) { return p.genre === F.genre; });
  if (F.age) items = items.filter(function (p) { return p.ages.indexOf(F.age) !== -1; });
  if (F.stock) items = items.filter(function (p) { return p.stock > 0; });
  if (F.level) items = items.filter(function (p) { return p.level === F.level; });
  if (F.min !== "") items = items.filter(function (p) { return priceInfo(p).final >= +F.min; });
  if (F.max !== "") items = items.filter(function (p) { return priceInfo(p).final <= +F.max; });
  var qf = fold(F.q.trim()), terms = qf.split(/\s+/).filter(Boolean);
  var scores = {};
  if (terms.length) items = items.filter(function (p) { var s = searchScore(p, qf, terms); scores[p.id] = s; return s > 0; });
  var sort = F.sort || (terms.length ? "relevance" : (view === "new" ? "new" : "popular"));
  var instock = function (p) { return p.stock > 0 ? 0 : 1; };
  var cmp = {
    relevance: function (a, b) { return instock(a) - instock(b) || scores[b.id] - scores[a.id]; },
    popular: function (a, b) { return instock(a) - instock(b) || (b.trending - a.trending) || a.rank - b.rank; },
    "new": function (a, b) { return instock(a) - instock(b) || (b.isNew - a.isNew) || b.rank - a.rank; },
    price_asc: function (a, b) { return priceInfo(a).final - priceInfo(b).final; },
    price_desc: function (a, b) { return priceInfo(b).final - priceInfo(a).final; },
    title: function (a, b) { var k = function (s) { return fold(s.replace(/^(the|a|an)\s+/i, "")); }; return k(a.title) < k(b.title) ? -1 : 1; }
  }[sort];
  items.sort(cmp);
  return { items: items, sort: sort };
}
function pageCatalog(view) {
  var res = filterProducts(view), items = res.items;
  var titles = { catalog: "catalog.title", popular: "catalog.popular_title", "new": "catalog.new_title", offers: "catalog.offers_title" };
  var cat = catBySlug(F.cat), genre = catBySlug(F.genre), age = ageBySlug(F.age);
  var heading = genre ? loc(genre.name) : cat ? loc(cat.name) : age ? t("catalog.age_heading", { age: loc(age.name) }) : t(titles[view]);
  if (F.q.trim()) heading = t("catalog.search_for", { q: F.q.trim() });
  var intro = view === "popular" ? '<em lang="en">Trending now</em> — ' + esc(t("catalog.popular_text")) : view === "offers" ? esc(t("catalog.offers_text")) :
    genre && loc(genre.desc) ? esc(loc(genre.desc)) : cat && loc(cat.desc) ? esc(loc(cat.desc)) : age ? esc(loc(age.desc)) : "";
  var chips = [];
  if (genre) chips.push([loc(genre.name), "genre"]); else if (cat) chips.push([loc(cat.name), "cat"]);
  if (age) chips.push([loc(age.name), "age"]);
  if (F.min !== "" || F.max !== "") chips.push([(F.min || "0") + "–" + (F.max || "∞") + " ₸", "price"]);
  if (F.stock) chips.push([t("catalog.only_in_stock"), "stock"]);
  if (F.level) chips.push([F.level, "level"]);
  var prices = publicProducts().map(function (p) { return p.price; });
  var lo = Math.min.apply(null, prices.concat([0])), hi = Math.max.apply(null, prices.concat([0]));
  var shown = items.slice(0, F.shown);
  var h = '<div class="wrap"><div class="page-head">' + crumbs([[t("nav.home"), href("home")], [t("nav.catalog"), href("catalog")]]) + "<h1>" + esc(heading) + "</h1>" + (intro ? "<p>" + intro + "</p>" : "") + "</div>";
  h += '<div class="catalog"><aside class="filters' + (UI.filters ? " is-open" : "") + '" aria-label="' + esc(t("catalog.filters")) + '"><div class="sheet-head"><h2>' + esc(t("catalog.filters")) + '</h2><button class="icon-btn" type="button" data-act="filters" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + "</button></div>" +
    '<form class="filters__scroll" data-form="filters"><div class="filters__group"><span class="filters__title">' + esc(t("catalog.category")) + "</span><ul>" +
    '<li><a href="#" data-act="fcat" data-cat=""' + (!cat ? ' aria-current="true"' : "") + ">" + esc(t("catalog.all_categories")) + "</a></li>" +
    topCats().map(function (c) {
      var open = cat && cat.slug === c.slug;
      return '<li><a href="#" data-act="fcat" data-cat="' + c.slug + '"' + (open && !genre ? ' aria-current="true"' : "") + ">" + esc(loc(c.name)) + " <small>" + countIn(c.slug) + "</small></a>" +
        (open ? '<ul class="sub">' + childCats(c.slug).filter(function (g) { return countIn(g.slug); }).map(function (g) {
          return '<li><a href="#" data-act="fcat" data-cat="' + c.slug + '" data-genre="' + g.slug + '"' + (genre && genre.slug === g.slug ? ' aria-current="true"' : "") + ">" + esc(loc(g.name)) + " <small>" + countIn(g.slug) + "</small></a></li>";
        }).join("") + "</ul>" : "") + "</li>";
    }).join("") + "</ul></div>" +
    '<div class="filters__group"><span class="filters__title" id="age-label">' + esc(t("catalog.age")) + '</span><div class="chips" role="group" aria-labelledby="age-label">' +
    [["", t("catalog.any_age")]].concat(S.ages.map(function (a) { return [a.slug, loc(a.name)]; })).map(function (a) {
      return '<label class="chip' + (F.age === a[0] ? " is-active" : "") + '"><input class="visually-hidden" type="radio" name="age" value="' + a[0] + '"' + (F.age === a[0] ? " checked" : "") + ">" + esc(a[1]) + "</label>";
    }).join("") + "</div></div>" +
    '<div class="filters__group"><span class="filters__title">' + esc(t("catalog.price")) + '</span><div class="price-range"><label><span class="visually-hidden">' + esc(t("catalog.price_from")) + '</span><input class="input" id="f-min" type="number" inputmode="numeric" name="min" min="0" step="100" value="' + esc(F.min) + '" placeholder="' + esc(t("catalog.price_from") + " " + lo) + '"></label>' +
    '<label><span class="visually-hidden">' + esc(t("catalog.price_to")) + '</span><input class="input" id="f-max" type="number" inputmode="numeric" name="max" min="0" step="100" value="' + esc(F.max) + '" placeholder="' + esc(t("catalog.price_to") + " " + hi) + '"></label></div></div>' +
    '<div class="filters__group"><span class="filters__title">' + esc(t("catalog.availability")) + '</span><label class="check"><input type="checkbox" id="f-stock" name="stock" value="1"' + (F.stock ? " checked" : "") + ">" + esc(t("catalog.only_in_stock")) + "</label></div>" +
    '<div class="filters__group"><label class="filters__title" for="f-level">' + esc(t("catalog.level")) + '</label><select class="select" id="f-level" name="level"><option value="">' + esc(t("catalog.any_level")) + "</option>" +
    ["A1", "A2", "B1", "B2", "C1", "C2"].map(function (l) { return '<option value="' + l + '"' + (F.level === l ? " selected" : "") + ">" + l + " — " + esc(t("level." + l)) + "</option>"; }).join("") + "</select></div>" +
    '<div class="filters__group filters__apply"><button class="btn btn--block btn--small" type="submit">' + esc(t("catalog.apply")) + "</button></div></form>" +
    '<div class="sheet-foot"><button class="btn btn--ghost" type="button" data-act="fclear">' + esc(t("catalog.clear_short")) + '</button><button class="btn" type="button" data-act="fapply">' + esc(t("catalog.apply")) + "</button></div></aside>";
  h += '<div><div class="toolbar"><span class="toolbar__count" aria-live="polite">' + esc(tn("catalog.found", items.length)) + '</span><div class="toolbar__right">' +
    '<button class="btn btn--ghost btn--small filters-toggle" type="button" data-act="filters">' + icon("filter") + esc(t("catalog.filters")) + (chips.length ? " (" + chips.length + ")" : "") + "</button>" +
    '<label class="visually-hidden" for="f-sort">' + esc(t("catalog.sort")) + '</label><select class="select" id="f-sort" data-change="sort">' +
    (F.q.trim() ? ["relevance"] : []).concat(["popular", "new", "price_asc", "price_desc", "title"]).map(function (s) { return '<option value="' + s + '"' + (res.sort === s ? " selected" : "") + ">" + esc(t("catalog.sort_" + s)) + "</option>"; }).join("") + "</select></div></div>";
  if (chips.length || F.q.trim()) h += '<div class="active-filters">' + chips.map(function (c) { return '<button class="chip is-active" type="button" data-act="fremove" data-key="' + c[1] + '" aria-label="' + esc(t("catalog.remove_filter", { name: c[0] })) + '">' + esc(c[0]) + " " + icon("close") + "</button>"; }).join("") +
    '<button class="chip" type="button" data-act="fclear">' + esc(t("catalog.clear")) + "</button></div>";
  if (items.length) {
    h += '<div class="grid grid--3">' + shown.map(card).join("") + "</div>";
    if (items.length > shown.length) h += '<div class="more"><span class="more__count">' + esc(t("catalog.showing", { shown: shown.length, total: items.length })) + '</span><button class="btn btn--ghost" type="button" data-act="more">' + esc(t("catalog.load_more")) + "</button></div>";
  } else {
    h += '<div class="empty"><h2>' + esc(t("catalog.empty_title")) + "</h2><p>" + esc(F.q.trim() ? t("catalog.empty_search", { q: F.q.trim() }) : t("catalog.empty_text")) + '</p><div class="hero__actions" style="justify-content:center"><button class="btn" type="button" data-act="fclear">' + esc(t("catalog.clear")) + '</button><a class="btn btn--ghost" href="' + href("help") + '">' + esc(t("hero.cta_help")) + "</a></div></div>";
  }
  h += "</div></div></div>" + (UI.filters ? '<div class="backdrop" data-act="filters"></div>' : "");
  return h;
}

/* ---- product */
function pageBook() {
  var p = productBySlug(R.arg);
  if (!p || (p.status !== "active" && !EDITOR)) return pageNotFound();
  var pi = priceInfo(p), cat = catBySlug(p.cat), genre = catBySlug(p.genre), s = stockState(p), b = badgesFor(p);
  var bundles = activePromos().filter(function (pr) { return pr.kind === "bundle" && applies(pr, p); });
  var related = publicProducts().filter(function (x) { return x.id !== p.id && (x.genre === p.genre || x.cat === p.cat); })
    .sort(function (a, c) { return (c.genre === p.genre) - (a.genre === p.genre) || (c.stock > 0) - (a.stock > 0) || a.rank - c.rank; }).slice(0, 4);
  var wa = waLink(t("product.ask_text", { title: p.title, author: p.author }));
  var inCart = CART[p.id] || 0;
  var h = '<div class="wrap">' + crumbs([[t("nav.home"), href("home")], [t("nav.catalog"), href("catalog")]].concat(cat ? [[loc(cat.name), href("catalog", cat.slug)]] : []).concat(genre ? [[loc(genre.name), href("catalog", genre.slug)]] : [])).replace('class="crumbs"', 'class="crumbs" style="margin-top:28px"') +
    '<div class="product"><div class="product__media"><div class="card__cover' + (s === "out" ? " is-out" : "") + '">' + (b.length ? '<span class="badges"><span class="badge badge--' + b[0][0] + '">' + esc(b[0][1]) + "</span></span>" : "") + coverImg(p, 400, 600, t("product.cover_alt", { title: p.title })) + "</div></div>" +
    '<div><h1 lang="en">' + esc(p.title) + '</h1><div class="product__author" lang="en">' + esc(p.author) + "</div>" +
    (p.status !== "active" ? '<div class="note note--promo">' + esc(A("hidden_notice")) + "</div>" : "") +
    (p.demo && S.settings.demoMode ? '<div class="note">' + esc(t("demo.product_notice")) + "</div>" : "") +
    '<div class="product__buy"><div>' + priceBlock(p) + (pi.discount ? '<div class="save">' + esc(t("product.save", { amount: price(pi.discount) })) + "</div>" : "") + stockLabel(p) + "</div>";
  if (p.stock > 0) {
    h += '<form data-form="buy" data-id="' + esc(p.id) + '"><div class="buy-row"><div class="qty"><button type="button" data-act="qty" data-step="-1" aria-label="' + esc(t("cart.decrease")) + '">' + icon("minus") + "</button>" +
      '<input id="buy-qty" type="number" name="qty" value="1" min="1" max="' + Math.min(p.stock, 20) + '" inputmode="numeric" aria-label="' + esc(t("product.quantity")) + '"><button type="button" data-act="qty" data-step="1" aria-label="' + esc(t("cart.increase")) + '">' + icon("plus") + "</button></div>" +
      '<button class="btn" type="submit">' + icon("bag") + "<span>" + esc(t("product.add_to_cart")) + "</span></button>" +
      '<button class="btn btn--ghost" type="button" data-act="toggle-fav" data-id="' + esc(p.id) + '">' + icon("heart") + ' <span>' + (isFav(p.id) ? 'В избранном ❤️' : 'В избранное') + '</span></button>' +
      "</div></form>" +
      (inCart ? '<div class="small muted">' + esc(t("product.in_cart_already", { n: inCart })) + ' <a href="' + href("cart") + '">' + esc(t("cart.view")) + "</a></div>" : "");
  } else {
    h += '<div class="note">' + esc(t("product.out_note")) + "</div><div class=\"buy-row\">" +
      '<button class="btn btn--ghost" type="button" data-act="toggle-fav" data-id="' + esc(p.id) + '">' + icon("heart") + ' <span>' + (isFav(p.id) ? 'В избранном ❤️' : 'В избранное') + '</span></button>' +
      (wa ? '<a class="btn btn--ghost" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon("whatsapp") + " " + esc(t("product.ask_whatsapp")) + "</a>" : "") + "</div>";
  }
  bundles.forEach(function (bd) { h += '<div class="note note--promo">' + icon("tag") + " " + esc(loc(bd.desc) || t("product.bundle_note", { n: bd.min, percent: bd.value })) + "</div>"; });
  h += "</div>" + (loc(p.desc) ? '<div class="product__desc">' + esc(loc(p.desc)) + "</div>" : "") + '<dl class="specs" style="margin-top:28px"><dt>' + esc(t("product.category")) + "</dt><dd>" + esc(catName(p)) + "</dd>";
  var ages = p.ages.map(ageBySlug).filter(Boolean);
  if (ages.length) h += "<dt>" + esc(t("product.age")) + "</dt><dd>" + ages.map(function (a) { return '<a href="' + href("catalog", "age-" + a.slug) + '">' + esc(loc(a.name)) + "</a>"; }).join(", ") + "</dd>";
  if (p.level) h += "<dt>" + esc(t("product.level")) + "</dt><dd>" + p.level + " — " + esc(t("level." + p.level)) + "</dd>";
  h += "<dt>" + esc(t("product.language")) + "</dt><dd>" + esc(t("product.language_en")) + "</dd>";
  if (p.binding) h += "<dt>" + esc(t("product.binding")) + "</dt><dd>" + esc(t("binding." + p.binding.replace(" ", "_"))) + "</dd>";
  if (p.pages) h += "<dt>" + esc(t("product.pages")) + "</dt><dd>" + p.pages + "</dd>";
  h += '</dl><p class="small muted" style="margin-top:24px">' + icon("truck") + " " + esc(t("product.delivery_note")) + ' <a href="' + href("delivery") + '">' + esc(t("footer.delivery")) + "</a></p>" +
    (isStoreAdmin() || EDITOR ? '<p><button class="btn btn--small btn--ghost" type="button" data-act="admin-edit" data-id="' + esc(p.id) + '">' + icon("edit") + ' ' + esc(A("edit_book")) + "</button></p>" : "") + "</div></div>";
  if (related.length) h += '<section class="section">' + sectionHead(t("product.related")) + '<div class="grid">' + related.map(card).join("") + "</div></section>";
  return h + "</div>";
}
function pageNotFound() {
  return '<div class="wrap"><div class="empty" style="margin-top:56px"><p class="age__num">404</p><h1 style="font-size:34px;margin-bottom:10px">' + esc(t("error.404_title")) + "</h1><p>" + esc(t("error.404_text")) +
    '</p><div class="hero__actions" style="justify-content:center"><a class="btn" href="' + href("home") + '">' + esc(t("error.home")) + '</a><a class="btn btn--ghost" href="' + href("catalog") + '">' + esc(t("hero.cta_catalog")) + "</a></div></div></div>";
}

/* ---- children */
function pageChildren() {
  var h = '<div class="wrap"><div class="page-head">' + crumbs([[t("nav.home"), href("home")], [t("nav.children"), null]]) + "<h1>" + esc(t("children.title")) + "</h1><p>" + esc(t("children.text")) + "</p></div>";
  S.ages.forEach(function (a) {
    var list = publicProducts().filter(function (p) { return p.ages.indexOf(a.slug) !== -1; }).sort(function (x, y) { return (y.stock > 0) - (x.stock > 0) || (y.trending - x.trending) || x.rank - y.rank; });
    h += '<section class="age-section"><div class="age-section__head"><div><div class="age__num">' + ageLabel(a) + '</div><div class="age__unit">' + esc(t("age.unit")) + '</div></div><p class="muted" style="margin:0;max-width:60ch">' + esc(loc(a.desc)) + "</p>" +
      '<a class="section-head__link" href="' + href("catalog", "age-" + a.slug) + '">' + esc(t("children.see_age", { n: list.length })) + "</a></div>" +
      (list.length ? '<div class="grid">' + list.slice(0, 4).map(card).join("") + "</div>" : '<p class="muted">' + esc(t("children.empty")) + "</p>") + "</section>";
  });
  return h + "</div>";
}

/* ---- reviews, help, contact, delivery, legal */
function waForm(fields, note, submitKey, form) {
  return form + '<p class="small muted">' + esc(note) + '</p><button class="btn" type="submit">' + icon("whatsapp") + esc(t(submitKey)) + "</button>";
}
function pageReviews() {
  var list = S.reviews.filter(function (r) { return r.status === "approved"; }), samples = list.some(function (r) { return r.sample; });
  var avg = list.length ? list.reduce(function (a, r) { return a + r.rating; }, 0) / list.length : 0;
  var h = '<div class="wrap"><div class="page-head"><h1>' + esc(t("reviews.title")) + "</h1>" +
    (list.length ? '<div class="rating-summary" style="margin-top:14px"><strong>' + avg.toFixed(1) + "</strong>" + stars(Math.round(avg)) + "<span>" + esc(tn("reviews.count", list.length)) + "</span></div>" : "") +
    (samples ? "<p>" + esc(t("reviews.samples_note")) + "</p>" : "") + '</div><div class="form-page"><div>' +
    (list.length ? '<div class="reviews reviews--2">' + list.map(reviewCard).join("") + "</div>" : '<div class="empty"><h2>' + esc(t("reviews.empty")) + "</h2><p>" + esc(t("reviews.empty_text")) + "</p></div>") +
    '</div><aside class="aside-card"><h2>' + esc(t("reviews.write")) + "</h2>";
  if (UI.reviewSent) h += '<p class="pay-note">' + esc(t("reviews.thanks")) + "</p>";
  h += '<form data-form="review" novalidate><div class="field"><span class="label" id="rating-label">' + esc(t("reviews.rating")) + '</span><div class="rating-input" role="radiogroup" aria-labelledby="rating-label">' +
    [5, 4, 3, 2, 1].map(function (i) { return '<input type="radio" id="r' + i + '" name="rating" value="' + i + '"' + (i === 5 ? " checked" : "") + '><label for="r' + i + '" title="' + esc(t("reviews.stars", { n: i })) + '">' + icon("star") + '<span class="visually-hidden">' + esc(t("reviews.stars", { n: i })) + "</span></label>"; }).join("") + "</div></div>" +
    field("rv-name", "name", t("reviews.name"), "input") + field("rv-text", "text", t("reviews.text"), "textarea") + field("rv-book", "book", t("reviews.book"), "input") +
    '<p class="small muted">' + esc(t("reviews.send_note")) + '</p><button class="btn btn--block" type="submit">' + icon("whatsapp") + esc(t("reviews.submit_wa")) + "</button></form></aside></div></div>";
  return h;
}
function field(id, name, label, kind, value, extra) {
  var err = UI.errors && UI.errors[name];
  return '<div class="field' + (err ? " has-error" : "") + '"><label for="' + id + '">' + esc(label) + "</label>" +
    (kind === "textarea" ? '<textarea class="textarea" id="' + id + '" name="' + name + '" maxlength="1500"' + (extra || "") + ">" + esc(value || "") + "</textarea>"
      : '<input class="input" id="' + id + '" name="' + name + '" value="' + esc(value || "") + '"' + (extra || "") + ">") + (err ? '<span class="error">' + esc(t(err)) + "</span>" : "") + "</div>";
}
function chipGroup(name, labelKey, options, selected) {
  return '<div class="field"><span class="label" id="' + name + '-label">' + esc(t(labelKey)) + '</span><div class="chips" role="radiogroup" aria-labelledby="' + name + '-label">' +
    options.map(function (o) { return '<label class="chip' + (selected === o[0] ? " is-active" : "") + '"><input class="visually-hidden" type="radio" name="' + name + '" value="' + o[0] + '"' + (selected === o[0] ? " checked" : "") + ">" + o[2] + esc(o[1]) + "</label>"; }).join("") + "</div></div>";
}
function pageHelp() {
  var wa = waLink(t("consult.wa_text"));
  if (UI.consultSent) {
    return '<div class="wrap"><div class="order-head">' + icon("check-circle") + "<h1>" + esc(t("consult.done_title")) + '</h1><p class="muted" style="max-width:56ch">' + esc(t("consult.send_note")) + '</p><div class="hero__actions"><a class="btn" href="' + href("catalog") + '">' + esc(t("hero.cta_catalog")) + '</a><button class="btn btn--ghost" type="button" data-act="consult-again">' + esc(t("consult.cta")) + "</button></div></div></div>";
  }
  var v = UI.consultForm || {};
  return '<div class="wrap"><div class="page-head"><h1>' + esc(t("consult.title")) + "</h1><p>" + esc(t("consult.text")) + '</p></div><div class="form-page"><form data-form="consult" novalidate>' +
    (UI.errors ? '<div class="form-alert" role="alert">' + esc(t("form.has_errors")) + "</div>" : "") +
    '<fieldset class="fieldset"><legend>' + esc(t("consult.about_you")) + "</legend>" + field("c-name", "name", t("consult.name"), "input", v.name, ' autocomplete="name" maxlength="80"') +
    '<div class="two"><div class="field"><label for="c-method">' + esc(t("consult.contact_method")) + '</label><select class="select" id="c-method" name="method">' +
    ["whatsapp", "phone", "telegram", "email"].map(function (m) { return '<option value="' + m + '"' + (v.method === m ? " selected" : "") + ">" + esc(t("contact_method." + m)) + "</option>"; }).join("") + "</select></div>" +
    field("c-contact", "contact", t("consult.contact"), "input", v.contact, ' maxlength="120"') + "</div></fieldset>" +
    '<fieldset class="fieldset"><legend>' + esc(t("consult.about_reader")) + "</legend>" +
    chipGroup("reader", "consult.reader", ["self", "child", "gift", "student"].map(function (r) { return [r, t("consult.reader_" + r), ""]; }), v.reader) +
    '<div class="two"><div class="field"><label for="c-age">' + esc(t("consult.age")) + '</label><select class="select" id="c-age" name="age"><option value="">' + esc(t("consult.age_adult")) + "</option>" +
    S.ages.map(function (a) { return '<option value="' + a.slug + '"' + (v.age === a.slug ? " selected" : "") + ">" + esc(loc(a.name)) + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label for="c-level">' + esc(t("consult.level")) + '</label><select class="select" id="c-level" name="level">' +
    ["unknown", "A1", "A2", "B1", "B2", "C1", "C2"].map(function (l) { return '<option value="' + l + '"' + (v.level === l ? " selected" : "") + ">" + (l === "unknown" ? esc(t("consult.level_unknown")) : l + " — " + esc(t("level." + l))) + "</option>"; }).join("") + "</select></div></div>" +
    field("c-genres", "genres", t("consult.genres"), "input", v.genres, ' placeholder="' + esc(t("consult.genres_hint")) + '"') +
    chipGroup("budget", "consult.budget", ["lt5000", "5000_10000", "10000_20000", "gt20000"].map(function (b) { return [b, t("budget." + b), ""]; }), v.budget) +
    field("c-notes", "notes", t("consult.notes"), "textarea", v.notes, ' placeholder="' + esc(t("consult.notes_hint")) + '"') + "</fieldset>" +
    '<p class="small muted">' + esc(t("consult.send_note")) + '</p><button class="btn" type="submit">' + icon("whatsapp") + esc(t("consult.submit_wa")) + "</button></form>" +
    '<aside class="aside-card"><h2>' + esc(t("consult.fast_title")) + '</h2><p class="muted" style="margin:0">' + esc(t("consult.fast_text")) + "</p>" +
    (wa ? '<a class="btn btn--sage" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon("whatsapp") + " " + esc(t("social.write_whatsapp")) + "</a>" : "") +
    '<p class="small muted" style="margin:0">' + esc(loc(S.settings.hours)) + "</p></aside></div></div>";
}
function pageContact() {
  var s = S.settings, ph = normPhone(s.phone), wd = waDigits(), wa = waLink(t("consult.wa_text"));
  return '<div class="wrap"><div class="page-head"><h1>' + esc(t("contact.title")) + "</h1><p>" + esc(t("contact.text")) + '</p></div><div class="form-page"><div class="contact-list">' +
    (wa ? "<div>" + icon("whatsapp") + '<span><strong>WhatsApp</strong><a href="' + esc(wa) + '" target="_blank" rel="noopener">' + esc(fmtPhone("+" + wd)) + "</a></span></div>" : "") +
    (ph ? "<div>" + icon("phone") + "<span><strong>" + esc(t("contact.phone")) + '</strong><span class="selectable">' + esc(fmtPhone(ph)) + "</span></span></div>" : "") +
    (s.email ? "<div>" + icon("mail") + '<span><strong>E-mail</strong><span class="selectable">' + esc(s.email) + "</span></span></div>" : "") +
    "<div>" + icon("clock") + "<span><strong>" + esc(t("contact.hours")) + "</strong>" + esc(loc(s.hours)) + "</span></div>" +
    "<div>" + icon("pin") + "<span><strong>" + esc(t("contact.pickup")) + "</strong>" + esc(loc(s.pickup)) + '<br><span class="muted">' + esc(loc(s.city)) + "</span></span></div></div>" +
    '<aside class="aside-card"><h2>' + esc(t("consult.title")) + '</h2><p class="muted" style="margin:0">' + esc(t("consult.text")) + '</p><a class="btn" href="' + href("help") + '">' + esc(t("consult.cta")) + "</a></aside></div>" +
    '<section class="section section--tight">' + sectionHead(t("social.title"), esc(t("social.sub"))) + socialBlock() + "</section></div>";
}
function pageDelivery() {
  var s = S.settings;
  return '<div class="wrap"><div class="page-head"><h1>' + esc(t("footer.delivery")) + "</h1><p>" + esc(loc(s.deliveryInfo)) + '</p></div><div class="prose"><h2>' + esc(t("checkout.delivery")) + "</h2><ul>" +
    (s.pickupOn ? "<li><strong>" + esc(t("delivery.pickup")) + "</strong> — " + esc(t("checkout.free")) + ". " + esc(loc(s.pickup)) + "</li>" : "") +
    (s.courierOn ? "<li><strong>" + esc(t("delivery.courier")) + "</strong> — " + price(s.feeCourier) + (s.freeFrom ? "; " + esc(t("checkout.free_from", { amount: price(s.freeFrom) })) : "") + "</li>" : "") +
    (s.postOn ? "<li><strong>" + esc(t("delivery.post")) + "</strong> — " + price(s.feePost) + ". " + esc(t("delivery.post_text")) + "</li>" : "") +
    "</ul><h2>" + esc(t("checkout.payment")) + "</h2><p>" + esc(t("site.order_how")) + "</p><ul>" +
    (s.transferOn ? "<li><strong>" + esc(t("payment.transfer")) + "</strong> — " + esc(t("payment.transfer_text")) + "</li>" : "") +
    (s.onDeliveryOn ? "<li><strong>" + esc(t("payment.on_delivery")) + "</strong> — " + esc(t("payment.on_delivery_text")) + "</li>" : "") +
    "</ul><h2>" + esc(t("delivery_page.returns_title")) + "</h2><p>" + esc(t("delivery_page.returns_text")) + "</p></div></div>";
}
function pageLegal(doc) {
  var h = '<div class="wrap"><div class="page-head"><h1>' + esc(t("legal." + doc + "_title")) + '</h1></div><div class="prose"><p class="note">' + esc(t("legal.draft_note")) + "</p>";
  for (var i = 1; i <= 6; i++) {
    var hk = "legal." + doc + "_h" + i; if (lookup(hk) === undefined) continue;
    h += "<h2>" + esc(t(hk)) + "</h2><p>" + esc(t("legal." + doc + "_p" + i, { store: "book_lovers.kz", email: S.settings.email || t("legal.email_placeholder"), phone: fmtPhone(normPhone(S.settings.phone) || "") })) + "</p>";
  }
  return h + "</div></div>";
}

/* ---- cart & checkout */
function cartLinesHtml(c, out) {
  return c.lines.map(function (l) {
    var p = l.p, max = Math.min(p.stock, 20);
    return '<div class="line"><a href="' + href("book", p.slug) + '" tabindex="-1" aria-hidden="true">' + coverImg(p, 92, 138) + "</a><div>" +
      '<a class="line__title" href="' + href("book", p.slug) + '" lang="en">' + esc(p.title) + '</a><div class="line__author">' + esc(p.author) + "</div>" +
      '<div class="line__row"><div class="qty" role="group" aria-label="' + esc(t("product.quantity") + ": " + p.title) + '">' +
      '<button type="button" data-act="setqty" data-id="' + esc(p.id) + '" data-qty="' + (l.qty - 1) + '" aria-label="' + esc(t("cart.decrease")) + '">' + icon("minus") + "</button>" +
      '<span class="qty__n" aria-live="polite">' + l.qty + "</span>" +
      '<button type="button" data-act="setqty" data-id="' + esc(p.id) + '" data-qty="' + (l.qty + 1) + '" aria-label="' + esc(t("cart.increase")) + '"' + (l.qty >= max ? " disabled" : "") + ">" + icon("plus") + "</button></div>" +
      '<div class="line__total">' + price(l.total) + '<span class="line__unit">' + (l.pi.discount ? "<s>" + price(l.pi.original) + "</s> " : "") + price(l.pi.final) + " " + esc(t("cart.per_item")) + "</span></div></div>" +
      '<button class="line__remove" type="button" data-act="setqty" data-id="' + esc(p.id) + '" data-qty="0">' + esc(t("cart.remove")) + "</button></div></div>";
  }).join("") + (out.length ? '<p class="small" style="margin:18px 0 0"><strong>' + esc(t("cart.unavailable_title")) + "</strong></p>" + out.map(function (p) {
    return '<div class="line line--out">' + coverImg(p, 64, 96) + '<div><span class="line__title">' + esc(p.title) + '</span><span class="stock stock--out">' + esc(t("product.out_of_stock")) + '</span><br><button class="line__remove" type="button" data-act="setqty" data-id="' + esc(p.id) + '" data-qty="0">' + esc(t("cart.remove")) + "</button></div></div>";
  }).join("") : "");
}
function summaryHtml(c, fee) {
  var h = "";
  if (c.bundle) h += '<div class="bundle-hint is-applied">' + icon("check") + "<span>" + esc(t("cart.bundle_applied", { percent: c.bundle.value, n: c.bundle.min })) + "</span></div>";
  else if (c.hint) h += '<div class="bundle-hint">' + icon("tag") + "<span>" + esc(tn("cart.bundle_hint", c.hint.missing, { percent: c.hint.percent })) + "</span></div>";
  h += '<dl class="sum"><div><dt>' + esc(tn("cart.items", c.qty)) + '</dt><dd class="tnum">' + price(c.subtotal) + "</dd></div>" +
    (c.itemDiscount ? '<div class="is-discount"><dt>' + esc(t("cart.discount")) + "</dt><dd>" + price(-c.itemDiscount) + "</dd></div>" : "") +
    (c.bundleDiscount ? '<div class="is-discount"><dt>' + esc(t("cart.bundle_discount")) + "</dt><dd>" + price(-c.bundleDiscount) + "</dd></div>" : "") +
    (fee != null ? "<div><dt>" + esc(t("checkout.delivery_fee")) + "</dt><dd>" + (fee ? price(fee) : esc(t("checkout.free"))) + "</dd></div>" : "") +
    '<div class="sum__total"><dt>' + esc(t("cart.total")) + "</dt><dd>" + price(c.total + (fee || 0)) + "</dd></div></dl>" +
    (fee == null ? '<p class="small muted" style="margin:0">' + esc(t("cart.delivery_later")) + "</p>" : "");
  return h;
}
function emptyCart() {
  return '<div class="cart-empty">' + icon("bag") + "<h3>" + esc(t("cart.empty_title")) + "</h3><p>" + esc(t("cart.empty_text")) + '</p><a class="btn" href="' + href("catalog") + '">' + esc(t("hero.cta_catalog")) + "</a></div>";
}
function drawerHtml() {
  var cl = cartLines(), c = computeCart(cl.lines);
  var body = (cl.lines.length || cl.out.length) ? '<div class="drawer__body">' + cartLinesHtml(c, cl.out) + '</div><div class="drawer__foot">' + summaryHtml(c, null) +
    (cl.lines.length ? '<a class="btn btn--block" href="' + href("checkout") + '">' + esc(t("cart.checkout")) + "</a>" : "") + '<a class="btn btn--ghost btn--block" href="' + href("cart") + '">' + esc(t("cart.view")) + "</a></div>" : '<div class="drawer__body">' + emptyCart() + "</div>";
  return '<div class="backdrop' + (UI.drawer ? " is-open" : "") + '" data-act="drawer-close"' + (UI.drawer ? "" : " hidden") + '></div><aside class="drawer' + (UI.drawer ? " is-open" : "") + '" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-hidden="' + !UI.drawer + '">' +
    '<div class="drawer__head"><h2 id="drawer-title">' + esc(t("cart.title")) + '</h2><button class="icon-btn" type="button" data-act="drawer-close" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + "</button></div>" + body + "</aside>";
}
function pageCart() {
  var cl = cartLines(), c = computeCart(cl.lines);
  var h = '<div class="wrap"><div class="page-head"><h1>' + esc(t("cart.title")) + "</h1></div>";
  if (!cl.lines.length && !cl.out.length) {
    var sug = publicProducts().filter(function (p) { return p.trending && p.stock > 0; }).slice(0, 4);
    return h + '<div class="empty">' + emptyCart() + "</div>" + (sug.length ? '<section class="section">' + sectionHead(t("cart.you_may_like")) + '<div class="grid">' + sug.map(card).join("") + "</div></section>" : "") + "</div>";
  }
  return h + '<div class="cart-page"><div>' + cartLinesHtml(c, cl.out) + '<p style="margin-top:24px"><a href="' + href("catalog") + '">' + esc(t("cart.continue")) + '</a></p></div><aside class="summary-box"><h2>' + esc(t("cart.summary")) + "</h2>" + summaryHtml(c, null) +
    (cl.lines.length ? '<a class="btn btn--block" href="' + href("checkout") + '">' + esc(t("cart.checkout")) + "</a>" : "") + (cl.out.length ? '<p class="small muted" style="margin:0">' + esc(t("cart.remove_unavailable")) + "</p>" : "") + "</aside></div></div>";
}
function deliveryMethods() { var s = S.settings, m = []; if (s.pickupOn) m.push("pickup"); if (s.courierOn) m.push("courier"); if (s.postOn) m.push("post"); return m.length ? m : ["pickup"]; }
function paymentMethods() { var s = S.settings, m = []; if (s.transferOn) m.push("transfer"); if (s.onDeliveryOn) m.push("on_delivery"); return m.length ? m : ["transfer"]; }
function validateCheckout(v) {
  var e = {};
  if (!v.name || v.name.trim().length < 2) e.name = "form.error.name";
  if (!normPhone(v.phone)) e.phone = "form.error.phone";
  if (v.delivery !== "pickup") { if (!v.city || !v.city.trim()) e.city = "form.error.required"; if (!v.address || v.address.trim().length < 5) e.address = "form.error.address"; }
  if (!v.consent) e.consent = "form.error.consent";
  return e;
}
function orderNumber() {
  var d = new Date(Date.now() + 5 * 3600 * 1000);
  function p(n) { return n < 10 ? "0" + n : "" + n; }
  return "BL" + String(d.getUTCFullYear()).slice(2) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" + (1000 + Math.floor(Math.random() * 9000));
}
function orderText(v, c, fee, number) {
  var L = [t("wa.order_header", { number: number }), "", t("wa.items") + ":"];
  c.lines.forEach(function (l) { L.push("• " + l.p.title + " — " + l.p.author + " (" + l.p.id + "), " + l.qty + " × " + price(l.pi.final) + " = " + price(l.total)); });
  L.push("");
  if (c.itemDiscount || c.bundleDiscount) L.push(t("wa.discount") + ": " + price(-(c.itemDiscount + c.bundleDiscount)));
  L.push(t("wa.delivery") + ": " + t("delivery." + v.delivery) + " — " + (fee ? price(fee) : t("checkout.free")));
  L.push(t("wa.total") + ": " + price(c.total + fee));
  L.push(t("wa.payment") + ": " + t("payment." + v.payment), "");
  L.push(t("wa.name") + ": " + v.name.trim(), t("wa.phone") + ": " + fmtPhone(normPhone(v.phone)), t("wa.contact") + ": " + t("contact_method." + v.contact));
  if (v.delivery !== "pickup") L.push(t("wa.address") + ": " + v.city.trim() + ", " + v.address.trim());
  if (v.comment && v.comment.trim()) L.push(t("wa.comment") + ": " + v.comment.trim());
  return L.join("\n");
}
function pageCheckout() {
  if (UI.sent) {
    var wa = waLink(UI.sent.text);
    return '<div class="wrap"><div class="order-head">' + icon("check-circle") + "<h1>" + esc(t("checkout.sent_title")) + '</h1><p class="muted" style="max-width:62ch">' +
      esc(wa ? t("checkout.sent_text", { number: UI.sent.number, phone: fmtPhone("+" + waDigits()) }) : t("checkout.no_wa")) + "</p></div>" +
      '<div class="order-grid"><div><p class="small muted">' + esc(t("checkout.order_number")) + ": <strong>" + esc(UI.sent.number) + '</strong></p><pre class="order-text selectable" id="order-text">' + esc(UI.sent.text) + "</pre>" +
      '<div class="hero__actions" style="margin-top:16px">' + (wa ? '<a class="btn" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon("whatsapp") + " " + esc(t("checkout.open_wa_again")) + "</a>" : "") +
      '<button class="btn btn--ghost" type="button" data-act="copy-order">' + esc(t("checkout.copy")) + '</button><a class="btn btn--ghost" href="' + href("catalog") + '">' + esc(t("cart.continue")) + "</a></div></div>" +
      '<aside class="summary-box"><h2>' + esc(t("order.details")) + '</h2><p class="pay-note pay-note--warn" style="margin:0">' + esc(t("order.not_paid")) + " " + esc(t("site.order_how")) + "</p></aside></div></div>";
  }
  var cl = cartLines(), c = computeCart(cl.lines);
  if (!cl.lines.length) return pageCart();
  var v = UI.checkout || {
    contact: "whatsapp",
    delivery: deliveryMethods()[0],
    payment: paymentMethods()[0],
    name: CURRENT_USER ? (CURRENT_USER.name || "") : "",
    phone: CURRENT_USER ? (CURRENT_USER.phone || "") : "",
    address: CURRENT_USER ? (CURRENT_USER.address || "") : ""
  }, e = UI.errors || {};
  var fee = deliveryFee(v.delivery, c.items), review = UI.reviewStep && !Object.keys(e).length;
  var h = '<div class="wrap"><div class="page-head"><h1>' + esc(t(review ? "checkout.review_title" : "checkout.title")) + '</h1><ol class="steps"><li class="is-done">' + esc(t("checkout.step_cart")) + "</li><li" + (review ? ' class="is-done"' : ' aria-current="step"') + ">" + esc(t("checkout.step_details")) + "</li><li" + (review ? ' aria-current="step"' : "") + ">" + esc(t("checkout.step_review")) + "</li></ol></div>";
  var side = '<aside class="summary-box"><h2>' + esc(t("checkout.summary")) + '</h2><div class="mini-lines">' + c.lines.map(function (l) {
    return '<div class="mini-line">' + coverImg(l.p, 44, 66) + "<span><strong>" + esc(l.p.title) + '</strong><span class="muted">' + l.qty + " × " + price(l.pi.final) + '</span></span><span class="tnum">' + price(l.total) + "</span></div>";
  }).join("") + "</div>" + summaryHtml(c, fee);
  if (review) {
    h += '<div class="checkout"><div>' +
      '<div class="review-block"><h3>' + esc(t("checkout.customer")) + "</h3><div>" + esc(v.name) + "<br>" + esc(fmtPhone(normPhone(v.phone))) + '<br><span class="muted">' + esc(t("checkout.contact_method") + ": " + t("contact_method." + v.contact)) + '</span></div><button class="link-btn small" type="button" data-act="checkout-edit">' + esc(t("checkout.edit")) + "</button></div>" +
      '<div class="review-block"><h3>' + esc(t("checkout.delivery")) + "</h3><div>" + esc(t("delivery." + v.delivery)) + "<br>" + (v.delivery === "pickup" ? '<span class="muted">' + esc(loc(S.settings.pickup)) + "</span>" : esc(v.city + ", " + v.address)) + '</div><button class="link-btn small" type="button" data-act="checkout-edit">' + esc(t("checkout.edit")) + "</button></div>" +
      '<div class="review-block"><h3>' + esc(t("checkout.payment")) + "</h3><div>" + esc(t("payment." + v.payment)) + '</div><button class="link-btn small" type="button" data-act="checkout-edit">' + esc(t("checkout.edit")) + "</button></div>" +
      (v.comment ? '<div class="review-block"><h3>' + esc(t("checkout.comment")) + "</h3><div>" + esc(v.comment) + "</div><span></span></div>" : "") +
      "</div>" + side + '<p class="pay-note pay-note--warn">' + esc(t("site.order_how")) + '</p><button class="btn btn--block" type="button" data-act="send-order">' + icon("whatsapp") + esc(t("checkout.send")) + "</button></aside></div></div>";
    return h;
  }
  h += '<div class="checkout"><form data-form="checkout" novalidate>' + (Object.keys(e).length ? '<div class="form-alert" role="alert">' + esc(t("form.has_errors")) + "</div>" : "") +
    '<fieldset class="fieldset"><legend>' + esc(t("checkout.contacts")) + '</legend><div class="two">' + field("co-name", "name", t("checkout.name"), "input", v.name, ' autocomplete="name" maxlength="80"') +
    field("co-phone", "phone", t("checkout.phone"), "input", v.phone, ' type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 7__ ___ __ __" maxlength="30"') + "</div>" +
    chipGroup("contact", "checkout.contact_method", [["whatsapp", t("contact_method.whatsapp"), icon("whatsapp")], ["phone", t("contact_method.phone"), icon("phone")], ["telegram", t("contact_method.telegram"), icon("telegram")]], v.contact) + "</fieldset>" +
    '<fieldset class="fieldset"><legend>' + esc(t("checkout.delivery")) + '</legend><div class="choices">' + deliveryMethods().map(function (m) {
      var f = deliveryFee(m, c.items);
      return '<label class="choice"><input type="radio" name="delivery" value="' + m + '"' + (v.delivery === m ? " checked" : "") + '><span><span class="choice__title">' + esc(t("delivery." + m)) + '</span><span class="choice__text">' + esc(m === "pickup" ? loc(S.settings.pickup) : t("delivery." + m + "_text")) + '</span></span><span class="choice__price">' + (f ? price(f) : esc(t("checkout.free"))) + "</span></label>";
    }).join("") + "</div>" + (S.settings.freeFrom && S.settings.courierOn ? '<p class="small muted" style="margin-top:10px">' + esc(t("checkout.free_from", { amount: price(S.settings.freeFrom) })) + "</p>" : "") +
    '<div data-address' + (v.delivery === "pickup" ? " hidden" : "") + ' style="margin-top:18px"><div class="two">' + field("co-city", "city", t("checkout.city"), "input", v.city, ' autocomplete="address-level2" maxlength="80"') + field("co-address", "address", t("checkout.address"), "input", v.address, ' autocomplete="street-address" maxlength="300" placeholder="' + esc(t("checkout.address_hint")) + '"') + "</div></div></fieldset>" +
    '<fieldset class="fieldset"><legend>' + esc(t("checkout.payment")) + '</legend><div class="choices">' + paymentMethods().map(function (m) {
      return '<label class="choice"><input type="radio" name="payment" value="' + m + '"' + (v.payment === m ? " checked" : "") + '><span><span class="choice__title">' + esc(t("payment." + m)) + '</span><span class="choice__text">' + esc(t("payment." + m + "_text")) + "</span></span></label>";
    }).join("") + '</div><p class="pay-note" style="margin-top:14px">' + esc(t("checkout.no_charge_now")) + "</p></fieldset>" +
    '<fieldset class="fieldset"><legend>' + esc(t("checkout.comment_title")) + "</legend>" + field("co-comment", "comment", t("checkout.comment"), "textarea", v.comment) +
    '<div class="field' + (e.consent ? " has-error" : "") + '"><label class="check"><input type="checkbox" id="co-consent" name="consent" value="1"' + (v.consent ? " checked" : "") + "><span>" + esc(t("checkout.consent_before")) + ' <a href="' + href("privacy") + '">' + esc(t("checkout.consent_link")) + "</a>" + esc(t("checkout.consent_after")) + "</span></label>" + (e.consent ? '<span class="error">' + esc(t(e.consent)) + "</span>" : "") + "</div></fieldset>" +
    '<div class="checkout-submit"><button class="btn btn--block" type="submit">' + esc(t("checkout.to_review")) + "</button></div></form>" + side + '<a class="small" href="' + href("cart") + '">' + esc(t("checkout.edit_cart")) + "</a></aside></div></div>";
  return h;
}

/* ===================================================================== auth & cabinet views */
function authModalHtml() {
  if (!UI.authModal) return "";
  var tab = UI.authTab || "login";
  var err = UI.authError ? '<div class="form-alert" role="alert">' + esc(UI.authError) + '</div>' : "";
  var isSb = window.BL_DB && window.BL_DB.isReady();

  var sbBadge = isSb ?
    '<div class="pill pill--green" style="font-size:12px;margin-bottom:12px;display:inline-flex;align-items:center;gap:6px;">' + icon("database") + ' Supabase подключен</div>' :
    '<div class="pill pill--grey" style="font-size:12px;margin-bottom:12px;display:inline-flex;align-items:center;gap:6px;" title="Ключи Supabase можно указать в настройках админки">' + icon("database") + ' Локальный режим (без Supabase)</div>';

  var nav = '<div class="auth-tabs" role="tablist">' +
    '<button type="button" class="auth-tab' + (tab === "login" ? " is-active" : "") + '" data-act="auth-set-tab" data-tab="login">' + esc(t("auth.login_tab")) + '</button>' +
    '<button type="button" class="auth-tab' + (tab === "register" ? " is-active" : "") + '" data-act="auth-set-tab" data-tab="register">' + esc(t("auth.register_tab")) + '</button>' +
    '<button type="button" class="auth-tab auth-tab--admin' + (tab === "admin" ? " is-active" : "") + '" data-act="auth-set-tab" data-tab="admin">' + icon("shield") + ' ' + esc(t("auth.admin_tab")) + '</button>' +
  '</div>';

  var content = "";
  if (tab === "login") {
    content = '<form class="auth-form" data-form="auth-login">' + err +
      '<div class="field"><label for="auth-l-user">' + esc(t("auth.email_or_phone")) + '</label><input class="input" id="auth-l-user" name="login" required placeholder="name@example.com или +7 7__ ___ __ __" autocomplete="username"></div>' +
      '<div class="field"><label for="auth-l-pass">' + esc(t("auth.password")) + '</label><input class="input" id="auth-l-pass" name="password" type="password" required autocomplete="current-password"></div>' +
      '<button class="btn btn--block btn--rose" type="submit" ' + (UI.authBusy ? 'disabled' : '') + '>' + (UI.authBusy ? 'Входим…' : esc(t("auth.btn_login"))) + '</button>' +
      '<p class="auth-subtext" style="text-align:center;margin-top:14px;font-size:13.5px;">' + esc(t("auth.register_tab")) + '? <button class="link-btn" type="button" data-act="auth-set-tab" data-tab="register">' + esc(t("auth.btn_register")) + '</button></p>' +
      '<div class="auth-owner-hint" style="text-align:center;margin-top:12px;border-top:1px solid var(--line-light);padding-top:10px;"><button class="link-btn small muted" type="button" data-act="auth-set-tab" data-tab="admin">' + icon("shield") + ' ' + esc(t("auth.admin_tab")) + '</button></div>' +
    '</form>';
  } else if (tab === "register") {
    content = '<form class="auth-form" data-form="auth-register">' + err +
      '<div class="field"><label for="auth-r-name">' + esc(t("auth.name")) + '</label><input class="input" id="auth-r-name" name="name" required placeholder="Айгерим" autocomplete="name"></div>' +
      '<div class="two">' +
        '<div class="field"><label for="auth-r-phone">' + esc(t("auth.phone")) + '</label><input class="input" id="auth-r-phone" name="phone" type="tel" required placeholder="+7 747 000 00 00" autocomplete="tel"></div>' +
        '<div class="field"><label for="auth-r-email">Email</label><input class="input" id="auth-r-email" name="email" type="email" placeholder="aigerim@example.kz" autocomplete="email"></div>' +
      '</div>' +
      '<div class="field"><label for="auth-r-addr">' + esc(t("cabinet.address")) + '</label><input class="input" id="auth-r-addr" name="address" placeholder="Алматы, пр. Абая 44, кв. 12" autocomplete="street-address"></div>' +
      '<div class="field"><label for="auth-r-pass">' + esc(t("auth.password")) + '</label><input class="input" id="auth-r-pass" name="password" type="password" required minlength="4" placeholder="••••••••" autocomplete="new-password"></div>' +
      '<button class="btn btn--block btn--rose" type="submit" ' + (UI.authBusy ? 'disabled' : '') + '>' + (UI.authBusy ? 'Регистрация…' : esc(t("auth.btn_register"))) + '</button>' +
      '<p class="auth-subtext" style="text-align:center;margin-top:14px;font-size:13.5px;"><button class="link-btn" type="button" data-act="auth-set-tab" data-tab="login">' + esc(t("auth.btn_login")) + '</button></p>' +
    '</form>';
  } else {
    // Admin login
    content = '<form class="auth-form" data-form="auth-admin">' + err +
      '<div class="auth-admin-badge">' + icon("shield") + '<div><strong>' + esc(t("auth.admin_tab")) + '</strong><p class="small muted" style="margin:2px 0 0">' + esc(t("auth.admin_hint")) + '</p></div></div>' +
      '<div class="field"><label for="auth-a-login">' + esc(t("auth.email_or_phone")) + '</label><input class="input" id="auth-a-login" name="login" value="admin" required autocomplete="username"></div>' +
      '<div class="field"><label for="auth-a-pass">' + esc(t("auth.password")) + '</label><input class="input" id="auth-a-pass" name="password" type="password" value="' + esc(getAdminPass()) + '" required autocomplete="current-password"></div>' +
      '<button class="btn btn--block btn--rose" type="submit" style="margin-top:16px;">' + esc(t("auth.btn_admin_login")) + '</button>' +
    '</form>';
  }

  return '<div class="auth-modal-backdrop is-open" data-act="auth-backdrop">' +
    '<div class="auth-modal" role="dialog" aria-modal="true" style="max-width:480px;">' +
      '<div class="auth-modal-head">' +
        '<h2>' + esc(t(tab === "admin" ? "auth.admin_tab" : (tab === "register" ? "auth.register_tab" : "auth.login_tab"))) + '</h2>' +
        '<button class="icon-btn" type="button" data-act="auth-close" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + '</button>' +
      '</div>' +
      sbBadge +
      nav +
      '<div class="auth-modal-body">' + content + '</div>' +
    '</div>' +
  '</div>';
}

function customerCabinetHtml(isFullPage) {
  if (!CURRENT_USER) return "";
  var tab = UI.cabTab || "orders";
  var allOrders = getOrders();
  var myOrders = allOrders.filter(function(o) {
    if (isStoreAdmin()) return true;
    if (o.customer && o.customer.id && CURRENT_USER.id && o.customer.id === CURRENT_USER.id) return true;
    if (o.user_id && CURRENT_USER.id && o.user_id === CURRENT_USER.id) return true;
    if (o.customer && o.customer.phone && CURRENT_USER.phone && normPhone(o.customer.phone) === normPhone(CURRENT_USER.phone)) return true;
    if (o.customer && o.customer.email && CURRENT_USER.email && fold(o.customer.email) === fold(CURRENT_USER.email)) return true;
    return false;
  });

  if (tab === "orders" && CURRENT_USER.id) {
    fetchUserOrdersIfNeeded(CURRENT_USER.id);
  }

  var favBooks = FAVORITES.map(function(id) { return productById(id); }).filter(Boolean);

  var nav = '<div class="cab-tabs" role="tablist">' +
    '<button type="button" class="cab-tab' + (tab === "orders" ? " is-active" : "") + '" data-act="cab-tab" data-tab="orders">' + icon("bag") + ' ' + esc(t("cabinet.tab_orders")) + ' <span class="pill pill--xs">' + myOrders.length + '</span></button>' +
    '<button type="button" class="cab-tab' + (tab === "favs" ? " is-active" : "") + '" data-act="cab-tab" data-tab="favs">' + icon("heart") + ' ' + esc(t("cabinet.tab_favs")) + ' <span class="pill pill--xs">' + favBooks.length + '</span></button>' +
    '<button type="button" class="cab-tab' + (tab === "profile" ? " is-active" : "") + '" data-act="cab-tab" data-tab="profile">' + icon("user") + ' ' + esc(t("cabinet.tab_profile")) + '</button>' +
  '</div>';

  var body = "";
  if (tab === "orders") {
    if (!myOrders.length) {
      body = '<div class="cab-empty" style="text-align:center;padding:36px 16px;">' + icon("bag") + '<h3>' + esc(t("cabinet.no_orders")) + '</h3><p class="muted">' + esc(t("cart.empty_text")) + '</p><a class="btn btn--small" href="' + href("catalog") + '" data-act="cabinet-close">' + esc(t("hero.cta_catalog")) + '</a></div>';
    } else {
      body = '<div class="orders-list">' + myOrders.map(function(o) {
        var statusClass = { new: "order-status--new", processing: "order-status--confirmed", shipped: "order-status--shipped", completed: "order-status--delivered", cancelled: "order-status--cancelled" }[o.status || "new"] || "order-status--new";
        var statusName = t("orders.status_" + (o.status || "new"));
        var dateStr = (o.date || o.created_at) ? fmtDate(o.date || o.created_at) : "—";
        return '<div class="order-card">' +
          '<div class="order-card__head">' +
            '<div><span class="order-card__num">' + esc(o.id) + '</span><span class="order-card__date muted">' + esc(dateStr) + '</span></div>' +
            '<span class="order-status-badge ' + statusClass + '">' + esc(statusName) + '</span>' +
          '</div>' +
          '<div class="order-card__items">' +
            (o.items || []).map(function(it) {
              return '<div class="order-card__item"><span>' + esc(it.title) + ' <span class="muted">× ' + it.qty + '</span></span><span class="tnum">' + price(it.total || (it.price * it.qty)) + '</span></div>';
            }).join("") +
          '</div>' +
          '<div class="order-card__foot">' +
            '<div class="order-card__total"><strong>' + esc(t("cart.total")) + ': ' + price(o.total) + '</strong></div>' +
            '<div class="order-card__actions">' +
              '<button class="btn btn--ghost btn--xs" type="button" data-act="repeat-order" data-id="' + esc(o.id) + '">' + icon("bag") + ' ' + esc(t("cart.checkout")) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("") + '</div>';
    }
  } else if (tab === "favs") {
    if (!favBooks.length) {
      body = '<div class="cab-empty" style="text-align:center;padding:36px 16px;">' + icon("heart") + '<h3>' + esc(t("cabinet.no_favs")) + '</h3><p class="muted">' + esc(t("cart.empty_text")) + '</p><a class="btn btn--small" href="' + href("catalog") + '" data-act="cabinet-close">' + esc(t("hero.cta_catalog")) + '</a></div>';
    } else {
      body = '<div class="grid grid--cab" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:16px;">' + favBooks.map(card).join("") + '</div>';
    }
  } else {
    // Profile
    body = '<form class="cab-profile-form" data-form="cabinet-profile">' +
      '<div class="two">' +
        field("cp-name", "name", t("checkout.name"), "input", CURRENT_USER.name || "", ' autocomplete="name"') +
        field("cp-phone", "phone", t("checkout.phone"), "input", CURRENT_USER.phone || "", ' type="tel" autocomplete="tel"') +
      '</div>' +
      field("cp-email", "email", "Email", "input", CURRENT_USER.email || "", ' type="email" autocomplete="email" ' + (CURRENT_USER.id ? 'readonly style="opacity:0.8"' : '')) +
      field("cp-address", "address", t("cabinet.address"), "input", CURRENT_USER.address || "", ' autocomplete="street-address" placeholder="' + esc(t("checkout.address_hint")) + '"') +
      '<div class="cab-profile-foot" style="margin-top:16px;display:flex;align-items:center;gap:12px;">' +
        '<button class="btn btn--rose" type="submit">' + esc(t("cabinet.save_profile")) + '</button>' +
        (UI.cabinetMsg ? '<span class="cab-msg pill pill--green">' + esc(UI.cabinetMsg) + '</span>' : '') +
      '</div>' +
    '</form>';
  }

  var header = '<div class="cab-header">' +
    '<div class="cab-user-meta">' +
      '<div class="cab-avatar">' + (isStoreAdmin() ? icon("shield") : icon("user")) + '</div>' +
      '<div>' +
        '<h2>' + esc(CURRENT_USER.name || (isStoreAdmin() ? "Владелец магазина" : "Покупатель")) + '</h2>' +
        '<span class="muted small">' + esc(CURRENT_USER.email || CURRENT_USER.phone || "") + ' • </span>' +
        '<span class="pill ' + (isStoreAdmin() ? "pill--rose" : "pill--grey") + '">' + esc(isStoreAdmin() ? t("nav.admin_badge") : "Покупатель") + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="cab-header-actions">' +
      (isStoreAdmin() ? '<a class="btn btn--small btn--rose" href="' + href("admin") + '">' + icon("shield") + ' ' + esc(t("site.manage")) + '</a>' : '') +
      '<button class="btn btn--ghost btn--small" type="button" data-act="logout">' + icon("logout") + ' ' + esc(t("nav.logout")) + '</button>' +
    '</div>' +
  '</div>';

  if (isFullPage) {
    return '<div class="wrap"><div class="cabinet-page">' + header + nav + '<div class="cab-content">' + body + '</div></div></div>';
  }

  return '<div class="cab-modal-inner">' +
    '<div class="auth-modal-head">' +
      '<h3>' + esc(t("cabinet.title")) + '</h3>' +
      '<button class="icon-btn" type="button" data-act="cabinet-close" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + '</button>' +
    '</div>' +
    header + nav + '<div class="cab-content" style="max-height:75vh;overflow-y:auto;padding-right:4px;">' + body + '</div>' +
  '</div>';
}

function cabinetModalHtml() {
  if (!UI.cabinetModal || !CURRENT_USER) return "";
  return '<div class="auth-modal-backdrop is-open" data-act="cabinet-backdrop">' +
    '<div class="cabinet-modal" role="dialog" aria-modal="true" style="max-width:760px;">' +
      customerCabinetHtml(false) +
    '</div>' +
  '</div>';
}

function favModalHtml() {
  if (!UI.favModal) return "";
  var favBooks = FAVORITES.map(function(id) { return productById(id); }).filter(Boolean);
  var body = "";
  if (!favBooks.length) {
    body = '<div class="cab-empty">' + icon("heart") + '<h3>' + esc(t("cabinet.no_favs")) + '</h3><p class="muted">' + esc(t("cart.empty_text")) + '</p><a class="btn btn--small" href="' + href("catalog") + '" data-act="fav-close">' + esc(t("hero.cta_catalog")) + '</a></div>';
  } else {
    body = '<div class="grid grid--cab" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:16px;">' + favBooks.map(card).join("") + '</div>';
  }
  return '<div class="auth-modal-backdrop is-open" data-act="fav-backdrop">' +
    '<div class="cabinet-modal" role="dialog" aria-modal="true" style="max-width:760px;">' +
      '<div class="auth-modal-head">' +
        '<h2>' + icon("heart") + ' ' + esc(t("cabinet.tab_favs")) + ' <span class="pill pill--xs">' + favBooks.length + '</span></h2>' +
        '<button class="icon-btn" type="button" data-act="fav-close" aria-label="' + esc(t("nav.close")) + '">' + icon("close") + '</button>' +
      '</div>' +
      '<div class="cab-content" style="max-height:75vh;overflow-y:auto;padding-right:4px;">' + body + '</div>' +
    '</div>' +
  '</div>';
}

function pageAdminGate() {
  var err = UI.authError ? '<div class="form-alert" role="alert">' + esc(UI.authError) + '</div>' : '';
  return '<div class="wrap"><div class="admin-gate-wrap">' +
    '<div class="admin-gate-card">' +
      '<div class="admin-gate-head">' +
        '<div class="admin-gate-icon">' + icon("shield") + '</div>' +
        '<h1>' + esc(t("site.manage")) + '</h1>' +
        '<p class="muted">' + esc(t("auth.admin_hint")) + '</p>' +
      '</div>' +
      err +
      '<form data-form="admin-gate-login" class="admin-gate-form">' +
        '<div class="field"><label for="ag-user">' + esc(t("auth.email_or_phone")) + '</label><input class="input" id="ag-user" name="login" placeholder="admin" required autocomplete="username"></div>' +
        '<div class="field"><label for="ag-pass">' + esc(t("auth.password")) + '</label><input class="input" id="ag-pass" name="password" type="password" placeholder="' + esc(t("auth.password")) + '" required autocomplete="current-password"></div>' +
        '<button class="btn btn--block btn--rose" type="submit" style="margin-top:16px">' + esc(t("auth.btn_admin_login")) + '</button>' +
        '<p class="small muted" style="text-align:center;margin-top:16px"><a href="' + href("home") + '">← ' + esc(t("nav.home")) + '</a></p>' +
      '</form>' +
    '</div>' +
  '</div></div>';
}

/* ===================================================================== render */
function render() {
  document.documentElement.lang = R.lang;
  var v = R.view, body;
  UI.errorsView = UI.errorsView || v;
  if (UI.errorsView !== v) { UI.errors = null; UI.errorsView = v; }
  if (v === "home") body = pageHome();
  else if (v === "catalog" || v === "popular" || v === "new" || v === "offers") body = pageCatalog(v);
  else if (v === "book") body = pageBook();
  else if (v === "children") body = pageChildren();
  else if (v === "reviews") body = pageReviews();
  else if (v === "help") body = pageHelp();
  else if (v === "contact") body = pageContact();
  else if (v === "delivery") body = pageDelivery();
  else if (v === "privacy" || v === "terms") body = pageLegal(v);
  else if (v === "cart") body = pageCart();
  else if (v === "checkout") body = pageCheckout();
  else if (v === "account") body = isStoreAdmin() ? pageAdmin() : (CURRENT_USER ? customerCabinetHtml(true) : pageAdminGate());
  else if (v === "admin") body = isStoreAdmin() ? pageAdmin() : pageAdminGate();
  else body = pageNotFound();
  var active = document.activeElement, activeId = active && active.id, selStart = null;
  try { if (active && active.selectionStart != null) selStart = active.selectionStart; } catch (e) { /* not a text field */ }
  app.innerHTML = header() + '<main id="main">' + body + "</main>" + footer() + drawerHtml() + authModalHtml() + cabinetModalHtml() + favModalHtml() + (UI.toast ? '<div class="toast is-visible" role="status">' + esc(UI.toast) + "</div>" : "");
  if (activeId) {
    var el = document.getElementById(activeId);
    if (el && el.focus) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (e) { /* ignore */ } }
  }
  document.documentElement.style.overflow = (UI.drawer || UI.menu || UI.filters || UI.authModal || UI.cabinetModal || UI.favModal) ? "hidden" : "";
  document.title = "book_lovers.kz";
  wireImages();
}
function wireImages() {
  var imgs = app.querySelectorAll("img[data-cover]");
  for (var i = 0; i < imgs.length; i++) imgs[i].addEventListener("error", onImgError, { once: true });
}
function onImgError(e) { e.target.classList.add("is-broken"); e.target.alt = t("site.loading_fail"); }
var toastTimer;
function toast(msg) { UI.toast = msg; render(); clearTimeout(toastTimer); toastTimer = setTimeout(function () { UI.toast = ""; var el = app.querySelector(".toast"); if (el) el.classList.remove("is-visible"); }, 2400); }

/* ===================================================================== search suggestions */
var searchTimer;
function suggest(q, which) {
  q = q.trim();
  if (q.length < 2) { UI.suggest = ""; updateSuggest(which); return; }
  var save = F.q; F.q = q;
  var all = filterProducts("catalog").items; F.q = save;
  var qf = fold(q);
  var cats = S.categories.filter(function (c) { return fold(c.name.ru + " " + c.name.kk + " " + c.name.en).indexOf(qf) !== -1; }).slice(0, 3);
  var authors = []; publicProducts().forEach(function (p) { if (fold(p.author).indexOf(qf) !== -1 && authors.indexOf(p.author) === -1) authors.push(p.author); });
  var h = "";
  if (all.length) h += '<div class="suggest__group">' + esc(t("search.books")) + "</div>" + all.slice(0, 5).map(function (p) {
    return '<a class="suggest__item" role="option" href="' + href("book", p.slug) + '">' + coverImg(p, 38, 57) + '<span><span class="suggest__title">' + esc(p.title) + '</span><span class="suggest__meta">' + esc(p.author) + '</span></span><span class="suggest__price">' + price(priceInfo(p).final) + "</span></a>";
  }).join("");
  if (cats.length || authors.length) h += '<div class="suggest__group">' + esc(t("search.refine")) + "</div><div>" + cats.map(function (c) { return '<a class="suggest__chip" role="option" href="' + href("catalog", c.slug) + '">' + esc(loc(c.name)) + "</a>"; }).join("") +
    authors.slice(0, 3).map(function (a) { return '<button class="suggest__chip" type="button" role="option" data-act="search-for" data-q="' + esc(a) + '">' + esc(a) + "</button>"; }).join("") + "</div>";
  h = h ? h + '<button class="suggest__all" type="button" data-act="search-for" data-q="' + esc(q) + '">' + esc(t("search.all_results", { n: all.length })) + "</button>" : '<div class="suggest__empty">' + esc(t("search.nothing", { q: q })) + "</div>";
  UI.suggest = h; UI.suggestFor = which; updateSuggest(which);
}
function updateSuggest(which) {
  var boxes = app.querySelectorAll(".suggest");
  for (var i = 0; i < boxes.length; i++) { boxes[i].hidden = true; }
  if (!UI.suggest) return;
  var input = document.getElementById("q-" + which);
  if (input) { var box = input.parentNode.querySelector(".suggest"); box.innerHTML = UI.suggest; box.hidden = false; wireImages(); }
}
function runSearch(q) { F.q = q; F.shown = 12; F.sort = ""; UI.suggest = ""; go(token("catalog")); }

/* ===================================================================== events */
document.addEventListener("click", function (e) {
  var a = e.target.closest("a[href^='#']");
  if (a && !a.dataset.act) {
    e.preventDefault();
    var tok = a.getAttribute("href").slice(1);
    if (tok) go(tok);
    return;
  }
  var el = e.target.closest("[data-act]");
  if (!el) {
    if (UI.suggest && !e.target.closest(".search")) { UI.suggest = ""; updateSuggest(""); }
    return;
  }
  var act = el.dataset.act;
  if (el.tagName === "A") e.preventDefault();
  var handler = ACTIONS[act] || ADMIN_ACTIONS[act];
  if (handler) handler(el, e);
});
var ACTIONS = {
  "menu": function () { UI.menu = !UI.menu; render(); },
  "search-toggle": function () { UI.search = !UI.search; render(); var i = document.getElementById("q-mob"); if (i) i.focus(); },
  "hide-demo": function () { store("bl-demo-hidden", "1"); render(); },
  "drawer": function () { UI.drawer = true; render(); },
  "drawer-close": function () { UI.drawer = false; render(); },
  "add": function (el) {
    var st = addToCart(el.dataset.id, 1);
    if (st === "out") { toast(t("cart.msg_out")); return; }
    UI.drawer = true; if (st === "limited") toast(t("cart.msg_limited")); else render();
  },
  "setqty": function (el) {
    var id = el.dataset.id, q = +el.dataset.qty;
    if (q <= 0) delete CART[id]; else { var p = productById(id); CART[id] = Math.min(q, p ? p.stock : q, 20); }
    saveCart(); render();
  },
  "qty": function (el) {
    var i = document.getElementById("buy-qty"); var v = (+i.value || 1) + (+el.dataset.step);
    i.value = Math.max(1, Math.min(+i.max || 20, v));
  },
  "filters": function () { UI.filters = !UI.filters; render(); },
  "fcat": function (el) { F.cat = el.dataset.cat || ""; F.genre = el.dataset.genre || ""; F.shown = 12; render(); },
  "fclear": function () { F = { q: "", sort: "", min: "", max: "", stock: false, level: "", age: "", cat: "", genre: "", shown: 12 }; UI.filters = false; render(); },
  "fapply": function () { readFilters(); UI.filters = false; render(); },
  "fremove": function (el) {
    var k = el.dataset.key;
    if (k === "genre") F.genre = ""; else if (k === "cat") { F.cat = ""; F.genre = ""; } else if (k === "age") F.age = ""; else if (k === "price") { F.min = ""; F.max = ""; } else if (k === "stock") F.stock = false; else if (k === "level") F.level = "";
    render();
  },
  "more": function () { F.shown += 12; render(); },
  "search-for": function (el) { runSearch(el.dataset.q); },
  "auth-open": function () { UI.authModal = true; UI.authTab = "login"; UI.authError = ""; render(); },
  "auth-close": function () { UI.authModal = false; UI.authError = ""; render(); },
  "auth-backdrop": function (el, e) { if (e.target === el) { UI.authModal = false; UI.authError = ""; render(); } },
  "auth-set-tab": function (el) { UI.authTab = el.dataset.tab; UI.authError = ""; render(); },
  "cabinet-open": function (el) {
    if (!CURRENT_USER) { UI.authModal = true; UI.authTab = "login"; }
    else { UI.cabinetModal = true; UI.cabTab = (el && el.dataset.tab) || "orders"; }
    render();
  },
  "cabinet-close": function () { UI.cabinetModal = false; render(); },
  "cabinet-backdrop": function (el, e) { if (e.target === el) { UI.cabinetModal = false; render(); } },
  "cab-tab": function (el) { UI.cabTab = el.dataset.tab; render(); },
  "cabinet-fav": function () {
    if (CURRENT_USER) {
      UI.cabinetModal = true;
      UI.cabTab = "favs";
    } else {
      UI.favModal = true;
    }
    render();
  },
  "fav-close": function () { UI.favModal = false; render(); },
  "fav-backdrop": function (el, e) { if (e.target === el) { UI.favModal = false; render(); } },
  "toggle-fav": function (el) {
    var id = el.dataset.id;
    if (id) toggleFav(id);
  },
  "logout": function () {
    if (window.BL_DB) window.BL_DB.signOut();
    setAuthUser(null);
    UI.cabinetModal = false;
    toast(t("auth.logged_out"));
    if (window.BL_ADMIN) render();
    else go(token("home"));
  },
  "repeat-order": function (el) {
    var id = el.dataset.id;
    var order = getOrders().filter(function(o) { return o.id === id; })[0];
    if (order && order.items) {
      order.items.forEach(function(it) { addToCart(it.id, it.qty || 1); });
      UI.cabinetModal = false;
      UI.drawer = true;
      toast(t("cart.msg_added"));
      render();
    }
  },
  "checkout-edit": function () { UI.reviewStep = false; render(); window.scrollTo(0, 0); },
  "send-order": function () {
    var cl = cartLines(), c = computeCart(cl.lines), v = UI.checkout;
    if (!c.lines.length || !v) return;
    var fee = deliveryFee(v.delivery, c.items), number = orderNumber(), text = orderText(v, c, fee, number), wa = waLink(text);
    if (wa) { var link = document.createElement("a"); link.href = wa; link.target = "_blank"; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove(); }
    var orderRecord = {
      id: number,
      date: new Date().toISOString(),
      customer: {
        id: CURRENT_USER ? CURRENT_USER.id : null,
        name: v.name.trim(),
        phone: v.phone.trim(),
        contact: v.contact
      },
      delivery: {
        method: v.delivery,
        city: v.city ? v.city.trim() : "",
        address: v.address ? v.address.trim() : "",
        fee: fee
      },
      payment: v.payment,
      comment: v.comment ? v.comment.trim() : "",
      items: c.lines.map(function(l) { return { id: l.p.id, title: l.p.title, author: l.p.author, qty: l.qty, price: l.pi.final, total: l.total, cover: l.p.cover }; }),
      subtotal: c.subtotal,
      discount: c.itemDiscount + c.bundleDiscount,
      total: c.total + fee,
      status: "new"
    };
    saveNewOrder(orderRecord);
    if (window.BL_DB) {
      window.BL_DB.createOrder(orderRecord);
    }
    if (CURRENT_USER && CURRENT_USER.id && window.BL_DB && window.BL_DB.isReady()) {
      var addrToSave = v.delivery !== "pickup" ? (v.city ? v.city.trim() + ", " : "") + v.address.trim() : CURRENT_USER.address;
      window.BL_DB.updateProfile(CURRENT_USER.id, {
        name: v.name.trim(),
        phone: v.phone.trim(),
        address: addrToSave
      });
    }
    UI.sent = { number: number, text: text }; CART = {}; saveCart(); UI.reviewStep = false; UI.checkout = null; render(); window.scrollTo(0, 0);
  },
  "copy-order": function () {
    var text = UI.sent ? UI.sent.text : "";
    var ok = function () { toast(t("checkout.copied")); };
    var fail = function () { var pre = document.getElementById("order-text"); if (pre) { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } toast(t("checkout.copy_failed")); };
    try { navigator.clipboard.writeText(text).then(ok, fail); } catch (err) { fail(); }
  },
  "consult-again": function () { UI.consultSent = false; UI.consultForm = null; render(); }
};
function readFilters() {
  var f = app.querySelector("[data-form='filters']"); if (!f) return;
  var fd = new FormData(f);
  F.age = fd.get("age") || ""; F.min = (fd.get("min") || "").trim(); F.max = (fd.get("max") || "").trim(); F.stock = !!fd.get("stock"); F.level = fd.get("level") || ""; F.shown = 12;
}
document.addEventListener("change", function (e) {
  var el = e.target;
  if (el.closest("[data-form='filters']")) {
    if (el.type === "radio") { var grp = el.closest(".chips"); if (grp) grp.querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("is-active", c.querySelector("input").checked); }); }
    if (!window.matchMedia("(max-width: 1024px)").matches && el.type !== "number") { readFilters(); render(); }
    return;
  }
  if (el.dataset.change === "sort") { F.sort = el.value; render(); return; }
  if (el.type === "radio" && el.closest(".chips")) el.closest(".chips").querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("is-active", c.querySelector("input").checked); });
  if (el.name === "delivery" && el.closest("[data-form='checkout']")) { var box = app.querySelector("[data-address]"); if (box) box.hidden = el.value === "pickup"; }
  if (ADMIN_CHANGE[el.dataset.adminChange]) ADMIN_CHANGE[el.dataset.adminChange](el);
});
document.addEventListener("input", function (e) {
  if (e.target.matches("[data-search-input]")) {
    var which = e.target.id.slice(2); clearTimeout(searchTimer);
    var q = e.target.value; searchTimer = setTimeout(function () { suggest(q, which); }, 150);
  }
  if (e.target.matches("[data-admin-search]")) { ADMIN.q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 200); }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { if (UI.drawer || UI.menu || UI.filters || UI.suggest) { UI.drawer = UI.menu = UI.filters = false; UI.suggest = ""; render(); } }
});
document.addEventListener("submit", function (e) {
  var f = e.target, kind = f.dataset.form; if (!kind) return;
  e.preventDefault();
  var fd = new FormData(f), v = {}; fd.forEach(function (val, k) { v[k] = val; });
  if (kind === "search") { runSearch(v.q || ""); return; }
  if (kind === "filters") { readFilters(); UI.filters = false; render(); return; }
  if (kind === "buy") {
    var st = addToCart(f.dataset.id, Math.max(1, +v.qty || 1));
    if (st === "out") { toast(t("cart.msg_out")); return; }
    UI.drawer = true; if (st === "limited") toast(t("cart.msg_limited")); else render(); return;
  }
  if (kind === "checkout") {
    v.consent = !!v.consent; UI.checkout = v; var errs = validateCheckout(v);
    UI.errors = Object.keys(errs).length ? errs : null; UI.reviewStep = !UI.errors; render(); window.scrollTo(0, 0); return;
  }
  if (kind === "review") {
    var er = {}; if (!(v.name || "").trim()) er.name = "form.error.required"; if ((v.text || "").trim().length < 10) er.text = "form.error.review_short";
    if (Object.keys(er).length) { UI.errors = er; render(); return; }
    UI.errors = null;
    var msg = [t("wa.review_header"), "", t("wa.rating") + ": " + v.rating + "/5", t("wa.name") + ": " + v.name.trim()].concat(v.book ? [t("wa.book") + ": " + v.book.trim()] : []).concat(["", v.text.trim()]).join("\n");
    openWa(msg); UI.reviewSent = true; render(); return;
  }
  if (kind === "consult") {
    var ce = {}; UI.consultForm = v;
    if (!(v.name || "").trim()) ce.name = "form.error.required";
    if (!(v.contact || "").trim()) ce.contact = "form.error.required"; else if ((v.method === "whatsapp" || v.method === "phone") && !normPhone(v.contact)) ce.contact = "form.error.phone";
    if (Object.keys(ce).length) { UI.errors = ce; render(); return; }
    UI.errors = null;
    var lines = [t("wa.consult_header"), "", t("consult.name") + ": " + v.name.trim(), t("consult.contact_method") + ": " + t("contact_method." + v.method) + " — " + v.contact.trim()];
    if (v.reader) lines.push(t("consult.reader") + ": " + t("consult.reader_" + v.reader));
    lines.push(t("consult.age") + ": " + (v.age ? loc(ageBySlug(v.age).name) : t("consult.age_adult")));
    lines.push(t("consult.level") + ": " + (v.level === "unknown" ? t("consult.level_unknown") : v.level));
    if (v.genres) lines.push(t("consult.genres") + ": " + v.genres.trim());
    if (v.budget) lines.push(t("consult.budget") + ": " + t("budget." + v.budget));
    if (v.notes) lines.push(t("consult.notes") + ": " + v.notes.trim());
    openWa(lines.join("\n")); UI.consultSent = true; render(); window.scrollTo(0, 0); return;
  }
  if (kind === "auth-login") {
    var lUser = (v.login || "").trim().toLowerCase(), lPass = (v.password || "").trim();
    if (!lUser || !lPass) { UI.authError = t("auth.error_required"); render(); return; }
    if (window.BL_DB && window.BL_DB.isReady()) {
      UI.authBusy = true;
      render();
      window.BL_DB.signIn(lUser, lPass).then(function(res) {
        UI.authBusy = false;
        var p = res.profile || {};
        var userObj = {
          id: res.user.id,
          email: res.user.email,
          name: p.name || (res.user.user_metadata && res.user.user_metadata.name) || res.user.email,
          phone: p.phone || (res.user.user_metadata && res.user.user_metadata.phone) || "",
          address: p.address || (res.user.user_metadata && res.user.user_metadata.address) || "",
          role: p.role || "customer"
        };
        setAuthUser(userObj);
        UI.authModal = false;
        UI.authError = "";
        toast(t("auth.logged_in", { name: userObj.name }));
        syncUserData(userObj.id);
        render();
      }).catch(function(err) {
        UI.authBusy = false;
        var msg = err.message || t("auth.error_invalid");
        if (msg.indexOf("Invalid login credentials") !== -1) msg = t("auth.error_invalid");
        UI.authError = msg;
        render();
      });
      return;
    }
    // Local fallback
    var allU = getUsers();
    var found = allU.filter(function(u) {
      return (u.email && u.email.toLowerCase() === lUser) || (u.phone && normPhone(u.phone) === normPhone(lUser));
    })[0];
    if (found && found.password === lPass) {
      setAuthUser(found);
      UI.authModal = false;
      UI.authError = "";
      toast(t("auth.logged_in", { name: found.name }));
      render();
    } else {
      UI.authError = t("auth.error_invalid");
      render();
    }
    return;
  }
  if (kind === "auth-register") {
    var rName = (v.name || "").trim() || "Покупатель", rPhone = (v.phone || "").trim(), rEmail = (v.email || "").trim().toLowerCase(), rAddr = (v.address || "").trim(), rPass = (v.password || "").trim();
    if (!rPass || (!rEmail && !rPhone)) { UI.authError = t("auth.error_required"); render(); return; }
    if (!rEmail && rPhone) rEmail = "user_" + normPhone(rPhone) + "@booklovers.kz";
    if (window.BL_DB && window.BL_DB.isReady()) {
      UI.authBusy = true;
      render();
      window.BL_DB.signUp(rEmail, rPass, { name: rName, phone: rPhone, address: rAddr }).then(function(res) {
        UI.authBusy = false;
        if (res.user) {
          var userObj = { id: res.user.id, email: res.user.email, name: rName, phone: rPhone, address: rAddr, role: "customer" };
          setAuthUser(userObj);
          UI.authModal = false;
          UI.authError = "";
          toast(t("auth.logged_in", { name: userObj.name }));
          syncUserData(userObj.id);
          render();
        } else {
          UI.authError = "Не удалось завершить регистрацию";
          render();
        }
      }).catch(function(err) {
        UI.authBusy = false;
        UI.authError = err.message || t("auth.error_invalid");
        render();
      });
      return;
    }
    // Local fallback
    var users = getUsers();
    var newUser = { id: "u_" + Date.now(), name: rName, phone: rPhone, email: rEmail, address: rAddr, password: rPass, role: "customer", registeredAt: new Date().toISOString() };
    users.push(newUser);
    saveUsers(users);
    setAuthUser(newUser);
    UI.authModal = false;
    UI.authError = "";
    toast(t("auth.logged_in", { name: newUser.name }));
    render();
    return;
  }
  if (kind === "cabinet-profile") {
    if (!CURRENT_USER) return;
    CURRENT_USER.name = (v.name || "").trim() || CURRENT_USER.name;
    CURRENT_USER.phone = (v.phone || "").trim() || CURRENT_USER.phone;
    CURRENT_USER.email = (v.email || "").trim() || CURRENT_USER.email;
    CURRENT_USER.address = (v.address || "").trim() || CURRENT_USER.address;
    setAuthUser(CURRENT_USER);
    if (window.BL_DB && window.BL_DB.isReady() && CURRENT_USER.id) {
      window.BL_DB.updateProfile(CURRENT_USER.id, { name: CURRENT_USER.name, phone: CURRENT_USER.phone, address: CURRENT_USER.address });
    }
    UI.cabinetMsg = t("cabinet.profile_saved");
    toast(t("cabinet.profile_saved"));
    render();
    setTimeout(function() { UI.cabinetMsg = ""; render(); }, 2500);
    return;
  }
  if (kind === "auth-admin" || kind === "admin-gate-login") {
    var loginVal = (v.login || "").trim().toLowerCase();
    var passVal = (v.password || "").trim();
    var expectedPass = getAdminPass();
    if (!loginVal || !passVal) {
      UI.authError = t("auth.error_required");
      render();
      return;
    }
    if (loginVal === "admin" && passVal === expectedPass) {
      setAuthUser(DEFAULT_ADMIN);
      UI.authModal = false;
      UI.authError = "";
      toast(t("auth.logged_in", { name: "Владелец магазина" }));
      if (R.view !== "admin") go(token("admin"));
      else render();
    } else {
      UI.authError = t("auth.error_invalid");
      render();
    }
    return;
  }
  if (ADMIN_SUBMIT[kind]) ADMIN_SUBMIT[kind](f, v, fd);
});
function openWa(text) {
  var wa = waLink(text); if (!wa) { toast(t("checkout.no_wa")); return; }
  var link = document.createElement("a"); link.href = wa; link.target = "_blank"; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove();
}

/* ===================================================================== admin (owner & editors only) */
var AD = {
  ru: {
    unsaved: "несохранённых изменений: {n}", publish: "Скачать store.js", publishing: "Публикуем…", view_site: "К сайту", preview: "Предпросмотр сайта", draft_restored: "Открыты ваши последние правки из этого браузера. Если вы уже загрузили новый store.js на хостинг, всё в порядке; если нет — нажмите «Скачать store.js».", reset_draft: "Сбросить правки",
    title: "Управление магазином", intro: "Это редактор каталога. Изменения видны только вам, пока вы не нажмёте «Скачать store.js» и не замените этим файлом data/store.js на хостинге.",
    tab_orders: "Заказы", tab_books: "Книги", tab_promos: "Акции", tab_reviews: "Отзывы", tab_settings: "Настройки", tab_import: "Импорт и экспорт",
    search: "Название, автор или артикул", add_book: "Добавить книгу", edit_book: "Редактировать книгу", book: "Книга", price: "Цена", stock: "Остаток", showcase: "Витрина", status: "Статус",
    active: "На сайте", hidden: "Скрыта", hide: "Скрыть", show: "Показать", edit: "Изменить", del: "Удалить", del_confirm: "Точно удалить?", yes_del: "Да, удалить", cancel: "Отмена",
    f_trending: "Популярное", f_new: "Новинка", f_featured: "Полка на главной", f_promo: "Акция", hidden_notice: "Эта книга скрыта — покупатели её не видят.",
    f_title: "Название (оригинальное, на английском)", f_author: "Автор", f_desc: "Описание", f_price: "Цена, ₸", f_sale: "Цена со скидкой, ₸ (необязательно)", f_stock: "Остаток, шт.",
    f_sku: "Артикул", f_cat: "Раздел", f_genre: "Жанр", f_ages: "Возраст читателя", f_level: "Уровень английского", f_pages: "Страниц", f_binding: "Переплёт", f_tags: "Ключевые слова",
    f_rank: "Порядок на витрине (меньше — выше)", f_cover: "Обложка", f_upload: "Загрузить обложку", f_cover_hint: "JPG, PNG или WebP до 8 МБ, вертикальная 2:3.", f_cover_url: "Путь к обложке (images/covers/…) или ссылка https://",
    uploading: "Загружаем…", upload_fail: "Не удалось загрузить файл: {err}", upload_na: "Загрузка файлов здесь недоступна — укажите ссылку на изображение.",
    save_book: "Сохранить книгу", none: "Не указано", choose: "Выберите…", required: "Обязательное поле", bad_price: "Целое число от 0", bad_sale: "Должна быть меньше обычной цены",
    saved_draft: "Сохранено. Не забудьте опубликовать изменения.", demo_tag: "Демо",
    promos_intro: "Скидки применяются автоматически. Даты — по времени Казахстана (UTC+5). Скидки не суммируются: книга получает самую выгодную цену.",
    add_promo: "Новая акция", p_name: "Название (для вас)", p_kind: "Тип", k_percent: "Процент", k_fixed: "Сумма, ₸", k_bundle: "За комплект (процент)", p_value: "Размер скидки",
    p_min: "Минимум книг в корзине", p_scope: "На что", s_all: "Все книги", s_category: "Раздел или жанр", s_products: "Выбранные книги", p_badge: "Бейдж на обложке", p_desc: "Описание в «Акциях»",
    p_starts: "Начало", p_ends: "Окончание", p_active: "Акция включена", p_home: "Показывать в «Акциях» на главной", save_promo: "Сохранить акцию",
    st_active: "Действует", st_scheduled: "Запланирована", st_expired: "Завершена", st_inactive: "Выключена", bad_percent: "Процент от 1 до 90", bad_amount: "Сумма от 1 ₸", bad_min: "Минимум 2", bad_dates: "Окончание должно быть позже начала", need_products: "Выберите книги",
    reviews_intro: "Покупатели присылают отзывы в WhatsApp. Добавьте настоящий отзыв здесь, и он появится на сайте.", add_review: "Добавить отзыв", r_name: "Имя", r_text: "Текст", r_rating: "Оценка", r_book: "Книга", r_lang: "Язык", r_sample: "Пример (на сайте будет пометка «Пример отзыва»)",
    publish_r: "Опубликовать", hide_r: "Скрыть", save_review: "Сохранить отзыв", r_hidden: "скрыт",
    s_contacts: "Контакты и соцсети", s_whatsapp: "WhatsApp", s_wa_ok: "Ссылка: wa.me/{d} ({p})", s_wa_bad: "Нужен номер Казахстана, например 87473624638", s_phone: "Телефон", s_email: "E-mail",
    s_ig: "Instagram (https://…)", s_tt: "TikTok (https://…)", s_url_bad: "Ссылка должна начинаться с https://", s_city: "Город / регион", s_pickup: "Адрес самовывоза", s_hours: "Часы работы",
    s_delivery: "Доставка", s_courier: "Курьер по городу, ₸", s_post: "По Казахстану, ₸", s_free: "Бесплатный курьер от суммы, ₸ (0 — нет)", s_methods: "Способы", s_payment: "Оплата",
    s_site: "Сайт", s_announce: "Строка объявления вверху (пусто — скрыта)", s_delivery_info: "Текст о доставке", s_demo: "Показывать пометки «Демо»", s_low: "«Осталось мало», если остаток не больше",
    save_settings: "Сохранить настройки", demo_title: "Демо-данные", demo_text: "Сейчас на сайте {p} демо-книг, {r} примеров отзывов и {a} демо-акций. Когда добавите свои книги, удалите их.",
    demo_remove: "Удалить демо-данные", demo_confirm: "Удалить все демо-книги, примеры отзывов и демо-акции?", demo_done: "Демо-данные удалены. Опубликуйте изменения.",
    import_intro: "Загрузите таблицу CSV (Excel: «Сохранить как» → CSV UTF-8). Книги с тем же артикулом обновятся, пустые ячейки не стирают данные.", import_file: "Файл CSV",
    import_cols: "Колонки: sku, title, author, description_ru, description_kk, description_en, price, discount_price, category, genre, age_group, cover_image, stock, featured, popular, new, promo, english_level, pages, status",
    import_preview: "Новых: {c}, обновлений: {u}, ошибок: {e}", import_apply: "Добавить в каталог", import_done: "Готово: добавлено {c}, обновлено {u}. Опубликуйте изменения.",
    import_row: "Строка {n}: {msg}", import_bad_head: "Нужны колонки title и price.", export: "Скачать каталог (CSV)", export_na: "Скачивание здесь недоступно.", template: "Скачать шаблон",
    pub_ok: "Файл store.js скачан. Замените им файл data/store.js в папке сайта на хостинге — после этого покупатели увидят изменения.", cover_copy: "Скопируйте файл {name} в папку images/covers на хостинге.", pub_conflict: "Пока вы редактировали, сайт обновили в другом окне. Страница перезагружена — повторите изменения.", pub_denied: "У вас нет прав публиковать этот сайт.",
    pub_fail: "Не удалось опубликовать: {err}", orders_note: "Заказы приходят вам в WhatsApp с номером заказа и составом. После продажи уменьшите остаток здесь и скачайте новый store.js."
  }
};
AD.en = {
  unsaved: "unsaved changes: {n}", publish: "Download store.js", publishing: "Publishing…", view_site: "Back to site", preview: "Preview the site", draft_restored: "Your latest edits from this browser are open. If you already uploaded the new store.js, all is well; if not, press “Download store.js”.", reset_draft: "Discard edits",
  title: "Manage the shop", intro: "This is the catalog editor. Changes are visible only to you until you press “Download store.js” and replace data/store.js on the hosting with that file.",
  tab_orders: "Orders", tab_books: "Books", tab_promos: "Promotions", tab_reviews: "Reviews", tab_settings: "Settings", tab_import: "Import & export",
  search: "Title, author or SKU", add_book: "Add a book", edit_book: "Edit book", book: "Book", price: "Price", stock: "Stock", showcase: "Showcase", status: "Status",
  active: "On site", hidden: "Hidden", hide: "Hide", show: "Show", edit: "Edit", del: "Delete", del_confirm: "Delete for good?", yes_del: "Yes, delete", cancel: "Cancel",
  f_trending: "Popular", f_new: "New", f_featured: "Home shelf", f_promo: "Sale", hidden_notice: "This book is hidden — customers can't see it.",
  f_title: "Title (original English)", f_author: "Author", f_desc: "Description", f_price: "Price, ₸", f_sale: "Sale price, ₸ (optional)", f_stock: "Stock",
  f_sku: "SKU", f_cat: "Section", f_genre: "Genre", f_ages: "Reader's age", f_level: "English level", f_pages: "Pages", f_binding: "Binding", f_tags: "Keywords",
  f_rank: "Showcase order (lower first)", f_cover: "Cover", f_upload: "Upload cover", f_cover_hint: "JPG, PNG or WebP up to 8 MB, portrait 2:3.", f_cover_url: "Cover path (images/covers/…) or https:// link",
  uploading: "Uploading…", upload_fail: "Upload failed: {err}", upload_na: "File upload isn't available here — use an image link.",
  save_book: "Save book", none: "Not set", choose: "Choose…", required: "Required", bad_price: "Whole number from 0", bad_sale: "Must be lower than the regular price",
  saved_draft: "Saved. Remember to publish your changes.", demo_tag: "Demo",
  promos_intro: "Discounts apply automatically. Dates are Kazakhstan time (UTC+5). Discounts don't stack: each book gets its best price.",
  add_promo: "New promotion", p_name: "Name (for you)", p_kind: "Type", k_percent: "Percent", k_fixed: "Amount, ₸", k_bundle: "Bundle (percent)", p_value: "Discount",
  p_min: "Minimum books in cart", p_scope: "Applies to", s_all: "All books", s_category: "Section or genre", s_products: "Selected books", p_badge: "Cover badge", p_desc: "Description in Offers",
  p_starts: "Starts", p_ends: "Ends", p_active: "Promotion on", p_home: "Show in Offers on the home page", save_promo: "Save promotion",
  st_active: "Active", st_scheduled: "Scheduled", st_expired: "Ended", st_inactive: "Off", bad_percent: "Percent 1–90", bad_amount: "Amount from 1 ₸", bad_min: "At least 2", bad_dates: "End must be after start", need_products: "Choose books",
  reviews_intro: "Customers send reviews on WhatsApp. Add a real review here and it appears on the site.", add_review: "Add review", r_name: "Name", r_text: "Text", r_rating: "Rating", r_book: "Book", r_lang: "Language", r_sample: "Sample (the site marks it “Sample review”)",
  publish_r: "Publish", hide_r: "Hide", save_review: "Save review", r_hidden: "hidden",
  s_contacts: "Contacts & social", s_whatsapp: "WhatsApp", s_wa_ok: "Link: wa.me/{d} ({p})", s_wa_bad: "Enter a Kazakhstan number, e.g. 87473624638", s_phone: "Phone", s_email: "E-mail",
  s_ig: "Instagram (https://…)", s_tt: "TikTok (https://…)", s_url_bad: "The link must start with https://", s_city: "City / region", s_pickup: "Pickup address", s_hours: "Opening hours",
  s_delivery: "Delivery", s_courier: "City courier, ₸", s_post: "Across Kazakhstan, ₸", s_free: "Free courier from, ₸ (0 = never)", s_methods: "Methods", s_payment: "Payment",
  s_site: "Site", s_announce: "Announcement bar (empty hides it)", s_delivery_info: "Delivery text", s_demo: "Show “Demo” labels", s_low: "“Only a few left” at or below",
  save_settings: "Save settings", demo_title: "Demo data", demo_text: "The site has {p} demo books, {r} sample reviews and {a} demo promotions. Remove them once your own books are in.",
  demo_remove: "Remove demo data", demo_confirm: "Remove all demo books, sample reviews and demo promotions?", demo_done: "Demo data removed. Publish your changes.",
  import_intro: "Upload a CSV spreadsheet (Excel: Save As → CSV UTF-8). Books with the same SKU are updated; empty cells never erase data.", import_file: "CSV file",
  import_cols: AD.ru.import_cols.replace("Колонки", "Columns"),
  import_preview: "New: {c}, updates: {u}, errors: {e}", import_apply: "Add to catalog", import_done: "Done: {c} added, {u} updated. Publish your changes.",
  import_row: "Row {n}: {msg}", import_bad_head: "The file needs title and price columns.", export: "Download catalog (CSV)", export_na: "Downloads aren't available here.", template: "Download template",
  pub_ok: "store.js downloaded. Replace data/store.js in the site folder on the hosting with it, and customers will see the changes.", cover_copy: "Copy the file {name} into the images/covers folder on the hosting.", pub_conflict: "The site was updated in another window while you were editing. The page reloaded — please redo your changes.", pub_denied: "You don't have permission to publish this site.",
  pub_fail: "Couldn't publish: {err}", orders_note: "Orders reach you on WhatsApp with the order number and items. Update stock here by hand after a sale."
};
function A(key, p) { var d = AD[R.lang === "en" ? "en" : "ru"]; return fill(d[key] !== undefined ? d[key] : (AD.ru[key] || key), p); }
function markDirty() { DIRTY++; if (window.BL_ADMIN) { try { localStorage.setItem("bl-admin-draft", JSON.stringify(S)); } catch (e) { /* ignore */ } } }

function adminOrders() {
  fetchSupabaseOrdersIfNeeded();
  var orders = getOrders();
  var isSb = window.BL_DB && window.BL_DB.isReady();
  var totalRevenue = orders.reduce(function(sum, o) { return sum + (o.total || 0); }, 0);
  var newCount = orders.filter(function(o) { return !o.status || o.status === "new"; }).length;

  var stats = '<div class="admin-stats-grid">' +
    '<div class="admin-stat-card"><span class="admin-stat-label">' + esc(t("orders.tab")) + '</span><span class="admin-stat-val">' + orders.length + '</span></div>' +
    '<div class="admin-stat-card"><span class="admin-stat-label">' + esc(t("orders.status_new")) + '</span><span class="admin-stat-val is-accent">' + newCount + '</span></div>' +
    '<div class="admin-stat-card"><span class="admin-stat-label">' + esc(t("cart.total")) + '</span><span class="admin-stat-val">' + price(totalRevenue) + '</span></div>' +
    '<div class="admin-stat-card"><span class="admin-stat-label">База данных</span><span class="admin-stat-val" style="font-size:16px;padding-top:4px;">' +
      (isSb ? '<span class="pill pill--green" style="font-size:13px;">● Supabase</span>' : '<span class="pill pill--grey" style="font-size:13px;">○ Локально</span>') +
    '</span></div>' +
  '</div>';

  if (!orders.length) {
    return stats + '<div class="panel" style="text-align:center;padding:48px 20px">' + icon("bag") + '<h3>' + esc(t("orders.no_orders")) + '</h3><p class="muted">Заказы покупателей из корзины автоматически сохраняются здесь и отправляются в WhatsApp.</p></div>';
  }

  var list = '<div class="admin-orders-list">' + orders.map(function(o) {
    var c = o.customer || {};
    var d = o.delivery || {};
    var rawPhone = normPhone(c.phone || "");
    var waHref = rawPhone ? "https://wa.me/" + (rawPhone.startsWith("8") ? "7" + rawPhone.slice(1) : rawPhone.replace(/\+/g, "")) + "?text=" + encodeURIComponent("Здравствуйте, " + (c.name || "покупатель") + "! По поводу вашего заказа " + o.id + " в магазине book_lovers.kz:") : "";

    return '<div class="admin-order-box">' +
      '<div class="admin-order-box__head">' +
        '<div>' +
          '<strong>' + esc(o.id) + '</strong> &nbsp;•&nbsp; <span class="muted">' + esc(o.date ? fmtDate(o.date) : "—") + '</span>' +
          '<div class="small" style="margin-top:4px"><strong>' + esc(c.name || "Покупатель") + '</strong> — <span class="selectable">' + esc(fmtPhone(c.phone || "")) + '</span>' + (d.address ? ' • <span class="muted">' + esc((d.city ? d.city + ", " : "") + d.address) + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="admin-order-box__status">' +
          '<select class="select select--small" data-admin-change="order-status" data-id="' + esc(o.id) + '">' +
            ["new", "processing", "shipped", "completed", "cancelled"].map(function(st) {
              return '<option value="' + st + '"' + ((o.status || "new") === st ? " selected" : "") + '>' + esc(t("orders.status_" + st)) + '</option>';
            }).join("") +
          '</select>' +
          (ADMIN.confirm === o.id ? '<button class="btn btn--danger btn--xs" type="button" data-act="a-del-order" data-id="' + esc(o.id) + '">' + esc(A("yes_del")) + '</button> <button class="link-btn small" type="button" data-act="a-del-cancel">' + esc(A("cancel")) + '</button>'
            : '<button class="link-btn small" type="button" data-act="a-del-ask" data-id="' + esc(o.id) + '">' + esc(A("del")) + '</button>') +
        '</div>' +
      '</div>' +
      '<div class="admin-order-box__items">' +
        (o.items || []).map(function(it) {
          return '<div class="admin-order-item"><span>' + esc(it.title) + ' (' + esc(it.author || "") + ') — ' + it.qty + ' × ' + price(it.price) + '</span><span class="tnum">' + price(it.total || (it.price * it.qty)) + '</span></div>';
        }).join("") +
      '</div>' +
      '<div class="admin-order-box__foot">' +
        '<div>' +
          '<span>' + esc(t("checkout.delivery")) + ': ' + esc(t("delivery." + (d.method || "pickup"))) + (d.fee ? ' (' + price(d.fee) + ')' : ' (' + esc(t("checkout.free")) + ')') + '</span>' +
          ' &nbsp;|&nbsp; <span>' + esc(t("checkout.payment")) + ': ' + esc(t("payment." + (o.payment || "transfer"))) + '</span>' +
          (o.comment ? '<div class="small muted" style="margin-top:2px">' + esc(t("checkout.comment")) + ': ' + esc(o.comment) + '</div>' : '') +
        '</div>' +
        '<div class="admin-order-box__actions">' +
          '<strong>' + esc(t("cart.total")) + ': ' + price(o.total) + '</strong>' +
          (waHref ? '<a class="btn btn--small btn--sage" href="' + esc(waHref) + '" target="_blank" rel="noopener">' + icon("whatsapp") + ' ' + esc(t("orders.write_wa")) + '</a>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("") + '</div>';

  return stats + list;
}

function pageAdmin() {
  var tabs = [["orders", "tab_orders"], ["books", "tab_books"], ["promos", "tab_promos"], ["reviews", "tab_reviews"], ["settings", "tab_settings"], ["import", "tab_import"]];
  var h = '<div class="wrap admin"><div class="page-head">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px"><h1>' + esc(A("title")) + '</h1>' +
    '<button class="btn btn--ghost btn--small" type="button" data-act="a-admin-logout">' + icon("logout") + ' ' + esc(t("nav.logout")) + '</button></div>' +
    '<p>' + esc(A("intro")) + '</p>' + (ADMIN.msg ? '<p class="pay-note">' + esc(ADMIN.msg) + '</p>' : '') + '</div>' +
    '<div class="admin-tabs" role="tablist">' + tabs.map(function (tb) { return '<button type="button" role="tab" aria-selected="' + (ADMIN.tab === tb[0]) + '" data-act="a-tab" data-tab="' + tb[0] + '">' + esc(A(tb[1])) + '</button>'; }).join("") + '</div>';
  if (ADMIN.tab === "orders") h += adminOrders();
  else if (ADMIN.tab === "books") h += ADMIN.edit ? adminBookForm() : adminBooks();
  else if (ADMIN.tab === "promos") h += ADMIN.promo ? adminPromoForm() : adminPromos();
  else if (ADMIN.tab === "reviews") h += adminReviews();
  else if (ADMIN.tab === "settings") h += adminSettings();
  else h += adminImport();
  return h + "</div>";
}
function adminBooks() {
  var q = fold(ADMIN.q), list = S.products.filter(function (p) { return !q || fold(p.title + " " + p.author + " " + p.id).indexOf(q) !== -1; }).sort(function (a, b) { return a.rank - b.rank; });
  var flags = [["trending", "f_trending"], ["isNew", "f_new"], ["featured", "f_featured"], ["promo", "f_promo"]];
  return '<p class="small muted">' + esc(A("orders_note")) + '</p><div class="filters-bar"><label class="visually-hidden" for="a-q">' + esc(A("search")) + '</label><input class="input" id="a-q" type="search" placeholder="' + esc(A("search")) + '" value="' + esc(ADMIN.q) + '" data-admin-search>' +
    '<button class="btn btn--small" type="button" data-act="a-new-book">' + icon("plus") + esc(A("add_book")) + '</button></div><div class="table-wrap"><table class="table"><thead><tr><th></th><th>' + esc(A("book")) + '</th><th class="num">' + esc(A("price")) + "</th><th>" + esc(A("stock")) + "</th><th>" + esc(A("showcase")) + "</th><th>" + esc(A("status")) + "</th><th></th></tr></thead><tbody>" +
    list.map(function (p) {
      var pi = priceInfo(p);
      return "<tr><td>" + (coverUrl(p) ? '<img class="thumb" src="' + esc(coverUrl(p)) + '" alt="">' : "") + '</td><td><button class="link-btn title" type="button" data-act="a-edit" data-id="' + esc(p.id) + '">' + esc(p.title) + '</button><div class="sub">' + esc(p.author) + ", " + esc(p.id) + (p.demo ? ' <span class="pill pill--grey">' + esc(A("demo_tag")) + "</span>" : "") + "</div></td>" +
        '<td class="num">' + (pi.discount ? '<span class="is-sale">' + price(pi.final) + '</span><div class="sub"><s>' + price(p.price) + "</s></div>" : price(p.price)) + "</td>" +
        '<td><input class="input input--stock" type="number" min="0" value="' + p.stock + '" aria-label="' + esc(A("stock") + ": " + p.title) + '" data-admin-change="stock" data-id="' + esc(p.id) + '" id="stock-' + esc(p.id) + '"></td>' +
        '<td><div class="flags">' + flags.map(function (f) { return '<button class="flag-btn' + (p[f[0]] ? " is-on" : "") + '" type="button" aria-pressed="' + !!p[f[0]] + '" data-act="a-flag" data-id="' + esc(p.id) + '" data-flag="' + f[0] + '">' + esc(A(f[1])) + "</button>"; }).join("") + "</div></td>" +
        '<td><span class="pill ' + (p.status === "active" ? "pill--green" : "pill--amber") + '">' + esc(A(p.status === "active" ? "active" : "hidden")) + "</span></td>" +
        '<td class="nowrap"><button class="btn btn--ghost btn--xs" type="button" data-act="a-status" data-id="' + esc(p.id) + '">' + esc(A(p.status === "active" ? "hide" : "show")) + "</button> " +
        (ADMIN.confirm === p.id ? '<button class="btn btn--danger btn--xs" type="button" data-act="a-del" data-id="' + esc(p.id) + '">' + esc(A("yes_del")) + '</button> <button class="link-btn small" type="button" data-act="a-del-cancel">' + esc(A("cancel")) + "</button>"
          : '<button class="link-btn small" type="button" data-act="a-del-ask" data-id="' + esc(p.id) + '">' + esc(A("del")) + "</button>") + "</td></tr>";
    }).join("") + "</tbody></table></div>";
}
function langFields(prefix, values, label, textarea) {
  return '<div class="field"><span class="label">' + esc(label) + '</span><div class="lang-stack">' + LANGS.map(function (l) {
    var id = prefix + "-" + l, val = (values || {})[l] || "";
    return '<label class="lang-row" for="' + id + '"><span class="lang-row__tag">' + LANG_SHORT[l] + "</span>" + (textarea ? '<textarea class="textarea" id="' + id + '" name="' + prefix + "_" + l + '" rows="3" lang="' + l + '">' + esc(val) + "</textarea>" : '<input class="input" id="' + id + '" name="' + prefix + "_" + l + '" value="' + esc(val) + '" lang="' + l + '">') + "</label>";
  }).join("") + "</div></div>";
}
function adminErr(name) { var e = ADMIN.errors && ADMIN.errors[name]; return e ? '<span class="error">' + esc(A(e)) + "</span>" : ""; }
function adminBookForm() {
  var p = ADMIN.edit.draft, isNew = ADMIN.edit.isNew;
  var genres = S.categories.filter(function (c) { return c.parent === p.cat; });
  return '<form class="admin-form" data-form="a-book" novalidate><div class="form-grid"><div><div class="panel"><h2>' + esc(isNew ? A("add_book") : A("edit_book")) + "</h2>" +
    '<div class="field' + (ADMIN.errors && ADMIN.errors.title ? " has-error" : "") + '"><label for="ab-title">' + esc(A("f_title")) + '</label><input class="input" id="ab-title" name="title" value="' + esc(p.title) + '" lang="en">' + adminErr("title") + "</div>" +
    '<div class="field"><label for="ab-author">' + esc(A("f_author")) + '</label><input class="input" id="ab-author" name="author" value="' + esc(p.author) + '" lang="en"></div>' +
    langFields("desc", p.desc, A("f_desc"), true) + "</div>" +
    '<div class="panel"><div class="two"><div class="field' + (ADMIN.errors && ADMIN.errors.price ? " has-error" : "") + '"><label for="ab-price">' + esc(A("f_price")) + '</label><input class="input" id="ab-price" name="price" inputmode="numeric" value="' + esc(p.price) + '">' + adminErr("price") + "</div>" +
    '<div class="field' + (ADMIN.errors && ADMIN.errors.sale ? " has-error" : "") + '"><label for="ab-sale">' + esc(A("f_sale")) + '</label><input class="input" id="ab-sale" name="sale" inputmode="numeric" value="' + esc(p.sale == null ? "" : p.sale) + '">' + adminErr("sale") + "</div></div>" +
    '<div class="two"><div class="field' + (ADMIN.errors && ADMIN.errors.stock ? " has-error" : "") + '"><label for="ab-stock">' + esc(A("f_stock")) + '</label><input class="input" id="ab-stock" name="stock" type="number" min="0" value="' + esc(p.stock) + '">' + adminErr("stock") + "</div>" +
    '<div class="field"><label for="ab-sku">' + esc(A("f_sku")) + '</label><input class="input" id="ab-sku" name="id" value="' + esc(p.id) + '"' + (isNew ? "" : " readonly") + "></div></div></div>" +
    '<div class="panel"><div class="two"><div class="field"><label for="ab-cat">' + esc(A("f_cat")) + '</label><select class="select" id="ab-cat" name="cat" data-admin-change="book-cat">' + topCats().map(function (c) { return '<option value="' + c.slug + '"' + (p.cat === c.slug ? " selected" : "") + ">" + esc(loc(c.name)) + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label for="ab-genre">' + esc(A("f_genre")) + '</label><select class="select" id="ab-genre" name="genre"><option value="">' + esc(A("none")) + "</option>" + genres.map(function (g) { return '<option value="' + g.slug + '"' + (p.genre === g.slug ? " selected" : "") + ">" + esc(loc(g.name)) + "</option>"; }).join("") + "</select></div></div>" +
    '<div class="field"><span class="label">' + esc(A("f_ages")) + '</span><div class="check-grid">' + S.ages.map(function (a) { return '<label class="check"><input type="checkbox" name="ages" value="' + a.slug + '"' + (p.ages.indexOf(a.slug) !== -1 ? " checked" : "") + ">" + esc(loc(a.name)) + "</label>"; }).join("") + "</div></div>" +
    '<div class="two"><div class="field"><label for="ab-level">' + esc(A("f_level")) + '</label><select class="select" id="ab-level" name="level"><option value="">' + esc(A("none")) + "</option>" + ["A1", "A2", "B1", "B2", "C1", "C2"].map(function (l) { return '<option value="' + l + '"' + (p.level === l ? " selected" : "") + ">" + l + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label for="ab-binding">' + esc(A("f_binding")) + '</label><select class="select" id="ab-binding" name="binding"><option value="">' + esc(A("none")) + "</option>" + ["paperback", "hardcover", "board book"].map(function (b) { return '<option value="' + b + '"' + (p.binding === b ? " selected" : "") + ">" + esc(t("binding." + b.replace(" ", "_"))) + "</option>"; }).join("") + "</select></div></div>" +
    '<div class="two"><div class="field"><label for="ab-pages">' + esc(A("f_pages")) + '</label><input class="input" id="ab-pages" name="pages" type="number" min="1" value="' + esc(p.pages || "") + '"></div><div class="field"><label for="ab-tags">' + esc(A("f_tags")) + '</label><input class="input" id="ab-tags" name="tags" value="' + esc(p.tags || "") + '"></div></div></div></div>' +
    '<div><div class="panel"><h2>' + esc(A("f_cover")) + "</h2>" + (coverUrl(p) ? '<img class="cover-preview" src="' + esc(coverUrl(p)) + '" alt="">' : '<div class="cover-preview cover-fallback"><span>' + esc(p.title || "—") + "</span></div>") +
    (ASSETS ? '<div class="field"><label for="ab-file">' + esc(A("f_upload")) + '</label><input class="input" id="ab-file" type="file" accept="image/jpeg,image/png,image/webp" data-admin-change="cover"><span class="hint">' + esc(ADMIN.uploading ? A("uploading") : A("f_cover_hint")) + "</span></div>" : '<p class="small muted">' + esc(A("upload_na")) + "</p>") +
    '<div class="field"><label for="ab-cover-url">' + esc(A("f_cover_url")) + '</label><input class="input" id="ab-cover-url" name="coverUrl" value="' + esc(p.cover || "") + '" placeholder="images/covers/book.webp"></div></div>' +
    '<div class="panel"><h2>' + esc(A("showcase")) + '</h2><div class="stack-8">' + [["trending", "f_trending"], ["isNew", "f_new"], ["featured", "f_featured"], ["promo", "f_promo"]].map(function (f) { return '<label class="check"><input type="checkbox" name="' + f[0] + '" value="1"' + (p[f[0]] ? " checked" : "") + ">" + esc(A(f[1])) + "</label>"; }).join("") +
    '<label class="check"><input type="checkbox" name="active" value="1"' + (p.status === "active" ? " checked" : "") + ">" + esc(A("active")) + "</label></div>" +
    '<div class="field" style="margin-top:14px"><label for="ab-rank">' + esc(A("f_rank")) + '</label><input class="input" id="ab-rank" name="rank" type="number" value="' + esc(p.rank) + '"></div>' +
    '<button class="btn btn--block" type="submit">' + esc(A("save_book")) + '</button><button class="btn btn--ghost btn--block" type="button" data-act="a-cancel" style="margin-top:8px">' + esc(A("cancel")) + "</button></div></div></div></form>";
}
function adminPromos() {
  return '<p class="small muted">' + esc(A("promos_intro")) + '</p><div class="filters-bar"><button class="btn btn--small" type="button" data-act="a-new-promo">' + icon("plus") + esc(A("add_promo")) + '</button></div><div class="table-wrap"><table class="table"><tbody>' +
    S.promotions.map(function (p) {
      var st = promoState(p), cls = { active: "pill--green", scheduled: "pill--amber", expired: "pill--grey", inactive: "pill--grey" }[st];
      var what = p.scope === "all" ? A("s_all") : p.scope === "category" ? loc((catBySlug(p.category) || { name: {} }).name) : tn("catalog.books_count", (p.products || []).length);
      return '<tr><td><button class="link-btn title" type="button" data-act="a-edit-promo" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button><div class="sub">' + esc(what) + "</div></td><td>" + (p.kind === "fixed" ? "−" + price(p.value) : p.kind === "bundle" ? esc(tn("catalog.books_count", p.min)) + ": −" + p.value + "%" : "−" + p.value + "%") + "</td>" +
        '<td class="sub">' + (p.starts ? fmtDate(p.starts) : "—") + " → " + (p.ends ? fmtDate(p.ends) : "—") + '</td><td><span class="pill ' + cls + '">' + esc(A("st_" + st)) + "</span></td>" +
        '<td class="nowrap"><button class="btn btn--ghost btn--xs" type="button" data-act="a-toggle-promo" data-id="' + esc(p.id) + '">' + esc(p.active ? A("hide") : A("show")) + "</button> " +
        (ADMIN.confirm === p.id ? '<button class="btn btn--danger btn--xs" type="button" data-act="a-del-promo" data-id="' + esc(p.id) + '">' + esc(A("yes_del")) + "</button>" : '<button class="link-btn small" type="button" data-act="a-del-ask" data-id="' + esc(p.id) + '">' + esc(A("del")) + "</button>") + "</td></tr>";
    }).join("") + "</tbody></table></div>";
}
function toLocalInput(iso) { if (!iso) return ""; var d = new Date(Date.parse(iso) + 5 * 3600 * 1000); return d.toISOString().slice(0, 16); }
function adminPromoForm() {
  var p = ADMIN.promo.draft, e = ADMIN.errors || {};
  return '<form class="admin-form" data-form="a-promo" novalidate><div class="form-grid"><div><div class="panel">' +
    '<div class="field' + (e.name ? " has-error" : "") + '"><label for="ap-name">' + esc(A("p_name")) + '</label><input class="input" id="ap-name" name="name" value="' + esc(p.name) + '">' + adminErr("name") + "</div>" +
    '<div class="two"><div class="field"><label for="ap-kind">' + esc(A("p_kind")) + '</label><select class="select" id="ap-kind" name="kind">' + ["percent", "fixed", "bundle"].map(function (k) { return '<option value="' + k + '"' + (p.kind === k ? " selected" : "") + ">" + esc(A("k_" + k)) + "</option>"; }).join("") + "</select></div>" +
    '<div class="field' + (e.value ? " has-error" : "") + '"><label for="ap-value">' + esc(A("p_value")) + '</label><input class="input" id="ap-value" name="value" inputmode="numeric" value="' + esc(p.value) + '">' + adminErr("value") + "</div></div>" +
    '<div class="field' + (e.min ? " has-error" : "") + '"><label for="ap-min">' + esc(A("p_min")) + '</label><input class="input" id="ap-min" name="min" type="number" min="2" value="' + esc(p.min || "") + '">' + adminErr("min") + "</div>" +
    '<div class="two"><div class="field"><label for="ap-scope">' + esc(A("p_scope")) + '</label><select class="select" id="ap-scope" name="scope">' + ["all", "category", "products"].map(function (s) { return '<option value="' + s + '"' + (p.scope === s ? " selected" : "") + ">" + esc(A("s_" + s)) + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label for="ap-cat">' + esc(A("s_category")) + '</label><select class="select" id="ap-cat" name="category"><option value="">' + esc(A("choose")) + "</option>" + S.categories.map(function (c) { return '<option value="' + c.slug + '"' + (p.category === c.slug ? " selected" : "") + ">" + (c.parent ? "— " : "") + esc(loc(c.name)) + "</option>"; }).join("") + "</select></div></div>" +
    '<div class="field' + (e.products ? " has-error" : "") + '"><span class="label">' + esc(A("s_products")) + '</span><div class="product-picker">' + S.products.map(function (b) { return '<label><input type="checkbox" name="products" value="' + esc(b.id) + '"' + ((p.products || []).indexOf(b.id) !== -1 ? " checked" : "") + "><span>" + esc(b.title) + ' <span class="muted">' + esc(b.author) + "</span></span></label>"; }).join("") + "</div>" + adminErr("products") + "</div></div>" +
    '<div class="panel">' + langFields("badge", p.badge, A("p_badge"), false) + langFields("pdesc", p.desc, A("p_desc"), true) + "</div></div>" +
    '<div><div class="panel"><div class="field"><label for="ap-starts">' + esc(A("p_starts")) + '</label><input class="input" id="ap-starts" name="starts" type="datetime-local" value="' + esc(toLocalInput(p.starts)) + '"></div>' +
    '<div class="field' + (e.ends ? " has-error" : "") + '"><label for="ap-ends">' + esc(A("p_ends")) + '</label><input class="input" id="ap-ends" name="ends" type="datetime-local" value="' + esc(toLocalInput(p.ends)) + '">' + adminErr("ends") + "</div>" +
    '<div class="stack-8"><label class="check"><input type="checkbox" name="active" value="1"' + (p.active ? " checked" : "") + ">" + esc(A("p_active")) + '</label><label class="check"><input type="checkbox" name="home" value="1"' + (p.home ? " checked" : "") + ">" + esc(A("p_home")) + "</label></div>" +
    '<button class="btn btn--block" type="submit" style="margin-top:16px">' + esc(A("save_promo")) + '</button><button class="btn btn--ghost btn--block" type="button" data-act="a-cancel" style="margin-top:8px">' + esc(A("cancel")) + "</button></div></div></div></form>";
}
function adminReviews() {
  return '<p class="small muted">' + esc(A("reviews_intro")) + '</p><div class="form-grid"><div class="table-wrap"><table class="table"><tbody>' + S.reviews.map(function (r) {
    return '<tr><td style="max-width:520px"><strong>' + esc(r.name) + "</strong> " + stars(r.rating) + (r.sample ? ' <span class="pill pill--grey">' + esc(t("demo.review_label")) + "</span>" : "") + (r.status !== "approved" ? ' <span class="pill pill--amber">' + esc(A("r_hidden")) + "</span>" : "") +
      '<div class="sub">' + esc(r.text) + "</div></td>" + '<td class="nowrap"><button class="btn btn--ghost btn--xs" type="button" data-act="a-review-status" data-id="' + esc(r.id) + '">' + esc(r.status === "approved" ? A("hide_r") : A("publish_r")) + "</button> " +
      (ADMIN.confirm === r.id ? '<button class="btn btn--danger btn--xs" type="button" data-act="a-del-review" data-id="' + esc(r.id) + '">' + esc(A("yes_del")) + "</button>" : '<button class="link-btn small" type="button" data-act="a-del-ask" data-id="' + esc(r.id) + '">' + esc(A("del")) + "</button>") + "</td></tr>";
  }).join("") + '</tbody></table></div><form class="panel" data-form="a-review" novalidate><h2>' + esc(A("add_review")) + "</h2>" +
    '<div class="field"><label for="ar-name">' + esc(A("r_name")) + '</label><input class="input" id="ar-name" name="name" required></div><div class="field"><label for="ar-text">' + esc(A("r_text")) + '</label><textarea class="textarea" id="ar-text" name="text" required></textarea></div>' +
    '<div class="two"><div class="field"><label for="ar-rating">' + esc(A("r_rating")) + '</label><select class="select" id="ar-rating" name="rating">' + [5, 4, 3, 2, 1].map(function (i) { return "<option>" + i + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label for="ar-lang">' + esc(A("r_lang")) + '</label><select class="select" id="ar-lang" name="lang">' + LANGS.map(function (l) { return '<option value="' + l + '">' + LANG_NAMES[l] + "</option>"; }).join("") + "</select></div></div>" +
    '<div class="field"><label for="ar-book">' + esc(A("r_book")) + '</label><input class="input" id="ar-book" name="book"></div><label class="check" style="margin-bottom:14px"><input type="checkbox" name="sample" value="1">' + esc(A("r_sample")) + "</label>" +
    '<button class="btn btn--block" type="submit">' + esc(A("save_review")) + "</button></form></div>";
}
function adminSettings() {
  var s = S.settings, e = ADMIN.errors || {}, wd = normKz(s.whatsapp);
  var demoP = S.products.filter(function (p) { return p.demo; }).length, demoR = S.reviews.filter(function (r) { return r.sample; }).length, demoA = S.promotions.filter(function (p) { return p.demo; }).length;
  function inp(name, label, val, type) { return '<div class="field' + (e[name] ? " has-error" : "") + '"><label for="as-' + name + '">' + esc(A(label)) + '</label><input class="input" id="as-' + name + '" name="' + name + '" value="' + esc(val == null ? "" : val) + '"' + (type ? ' type="' + type + '"' : "") + ">" + adminErr(name) + "</div>"; }
  function chk(name, label) { return '<label class="check"><input type="checkbox" name="' + name + '" value="1"' + (s[name] ? " checked" : "") + ">" + esc(label) + "</label>"; }
  return '<form data-form="a-settings" novalidate><div class="form-grid"><div><div class="panel"><h2>' + esc(A("s_contacts")) + "</h2>" +
    '<div class="two"><div class="field' + (e.whatsapp ? " has-error" : "") + '"><label for="as-whatsapp">' + esc(A("s_whatsapp")) + '</label><input class="input" id="as-whatsapp" name="whatsapp" value="' + esc(s.whatsapp) + '"><span class="hint">' + esc(wd ? A("s_wa_ok", { d: wd, p: fmtPhone("+" + wd) }) : A("s_wa_bad")) + "</span>" + adminErr("whatsapp") + "</div>" +
    inp("phone", "s_phone", s.phone) + "</div>" + inp("email", "s_email", s.email, "email") + '<div class="two">' + inp("instagram", "s_ig", s.instagram) + inp("tiktok", "s_tt", s.tiktok) + "</div>" +
    langFields("city", s.city, A("s_city")) + langFields("pickup", s.pickup, A("s_pickup")) + langFields("hours", s.hours, A("s_hours")) + "</div>" +
    '<div class="panel"><h2>' + esc(A("s_delivery")) + '</h2><div class="stack-8" style="margin-bottom:14px">' + chk("pickupOn", t("delivery.pickup")) + chk("courierOn", t("delivery.courier")) + chk("postOn", t("delivery.post")) + "</div>" +
    '<div class="two">' + inp("feeCourier", "s_courier", s.feeCourier, "number") + inp("feePost", "s_post", s.feePost, "number") + "</div>" + inp("freeFrom", "s_free", s.freeFrom, "number") + langFields("deliveryInfo", s.deliveryInfo, A("s_delivery_info"), true) +
    "<h2>" + esc(A("s_payment")) + '</h2><div class="stack-8">' + chk("transferOn", t("payment.transfer")) + chk("onDeliveryOn", t("payment.on_delivery")) + "</div></div></div>" +
    '<div><div class="panel"><h2>' + esc(A("s_site")) + "</h2>" + langFields("announcement", s.announcement, A("s_announce")) + '<div class="stack-8" style="margin:12px 0">' + chk("demoMode", A("s_demo")) + "</div>" + inp("lowStock", "s_low", s.lowStock, "number") + "</div>" +
    '<div class="panel"><h2>' + icon("database") + ' База данных Supabase</h2>' +
    '<div style="margin-bottom:12px"><span class="pill ' + (window.BL_DB && window.BL_DB.isReady() ? 'pill--green' : 'pill--grey') + '">' +
    (window.BL_DB && window.BL_DB.isReady() ? '● Подключено к Supabase' : '○ Supabase не настроен (локальный режим)') + '</span></div>' +
    '<p class="small muted">Сохраняет всех пользователей, профили, корзины, избранное и заказы в облачной базе данных Supabase (PostgreSQL).</p>' +
    '<div class="field"><label for="as-sb-url">Supabase Project URL</label><input class="input" id="as-sb-url" name="supabaseUrl" value="' + esc((window.BL_DB ? window.BL_DB.getConfig().url : "") || "") + '" placeholder="https://xxxxxxxxxxxx.supabase.co"></div>' +
    '<div class="field"><label for="as-sb-key">Supabase Anon Key</label><input class="input" id="as-sb-key" name="supabaseAnonKey" value="' + esc((window.BL_DB ? window.BL_DB.getConfig().anonKey : "") || "") + '" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."></div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
      '<button class="btn btn--secondary btn--small" type="button" data-act="a-test-supabase">' + icon("database") + ' Проверить подключение</button>' +
      '<button class="btn btn--small btn--rose" type="button" data-act="a-save-supabase">Сохранить ключи Supabase</button>' +
    '</div>' +
    '<p class="small muted" style="margin-top:12px;">SQL-скрипт создания таблиц находится в репозитории: <code>supabase/schema.sql</code>.</p>' +
    '</div>' +
    '<div class="panel"><h2>Пароль владельца (Admin)</h2>' +
    '<div class="field"><label for="as-admin-pass">Новый пароль учетной записи admin</label>' +
    '<input class="input" id="as-admin-pass" name="adminPassword" type="password" placeholder="Введите новый пароль (минимум 4 символа)" autocomplete="new-password">' +
    '<span class="hint">Оставьте пустым, если не хотите менять текущий пароль.</span></div>' +
    '<button class="btn btn--block btn--rose" type="submit">' + esc(A("save_settings")) + "</button></div>" +
    ((demoP || demoR || demoA) ? '<div class="panel danger-zone"><h2>' + esc(A("demo_title")) + '</h2><p class="small muted">' + esc(A("demo_text", { p: demoP, r: demoR, a: demoA })) + "</p>" +
      (ADMIN.confirm === "demo" ? '<p class="small">' + esc(A("demo_confirm")) + '</p><button class="btn btn--danger btn--small" type="button" data-act="a-remove-demo">' + esc(A("yes_del")) + '</button> <button class="link-btn small" type="button" data-act="a-del-cancel">' + esc(A("cancel")) + "</button>"
        : '<button class="btn btn--ghost btn--small" type="button" data-act="a-del-ask" data-id="demo">' + esc(A("demo_remove")) + "</button>") + "</div>" : "") + "</div></div></form>";
}
function adminImport() {
  var pv = ADMIN.importPreview;
  return '<div class="form-grid"><div class="panel"><p class="small muted">' + esc(A("import_intro")) + '</p><div class="field"><label for="ai-file">' + esc(A("import_file")) + '</label><input class="input" id="ai-file" type="file" accept=".csv,text/csv" data-admin-change="import"></div>' +
    '<p class="small muted">' + esc(A("import_cols")) + "</p>" +
    (pv ? '<p class="pay-note">' + esc(A("import_preview", { c: pv.create.length, u: pv.update.length, e: pv.errors.length })) + "</p>" + (pv.errors.length ? '<ul class="small">' + pv.errors.slice(0, 30).map(function (er) { return '<li class="error">' + esc(er) + "</li>"; }).join("") + "</ul>" : "") +
      ((pv.create.length || pv.update.length) ? '<button class="btn" type="button" data-act="a-import-apply">' + esc(A("import_apply")) + "</button>" : "") : "") + "</div>" +
    '<div class="panel"><button class="btn btn--ghost btn--block" type="button" data-act="a-export">' + esc(A("export")) + '</button><button class="btn btn--ghost btn--block" type="button" data-act="a-template" style="margin-top:8px">' + esc(A("template")) + "</button></div></div>";
}
function intOrNull(v) { v = String(v == null ? "" : v).replace(/[\s  ]/g, ""); if (v === "") return null; var n = Number(v); return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : NaN; }
function slugify(s) { return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "book"; }
function uniqueSlug(base, selfId) { var s = base, n = 2; while (S.products.some(function (p) { return p.slug === s && p.id !== selfId; })) s = base + "-" + n++; return s; }
function nextSku() { var n = 1; while (S.products.some(function (p) { return p.id === "BL-" + String(n).padStart(4, "0"); })) n++; return "BL-" + String(n).padStart(4, "0"); }
function readLang(v, prefix) { var o = {}; LANGS.forEach(function (l) { o[l] = (v[prefix + "_" + l] || "").trim(); }); return o; }

var ADMIN_ACTIONS = {
  "publish": function () { publishSite(); },
  "admin-edit": function (el) { var p = productById(el.dataset.id); ADMIN.tab = "books"; ADMIN.edit = { isNew: false, draft: JSON.parse(JSON.stringify(p)) }; ADMIN.errors = null; go(token("admin")); },
  "a-tab": function (el) { ADMIN.tab = el.dataset.tab; ADMIN.edit = null; ADMIN.promo = null; ADMIN.errors = null; ADMIN.confirm = ""; ADMIN.msg = ""; render(); },
  "a-new-book": function () {
    ADMIN.edit = { isNew: true, draft: { id: nextSku(), slug: "", title: "", author: "", desc: { ru: "", kk: "", en: "" }, price: "", sale: null, cat: "fiction", genre: "", ages: [], level: "", pages: null, binding: "paperback", stock: 1, status: "active", trending: false, isNew: true, featured: false, promo: false, rank: 100, demo: false, cover: "", tags: "" } };
    ADMIN.errors = null; render(); window.scrollTo(0, 0);
  },
  "a-edit": function (el) { var p = productById(el.dataset.id); ADMIN.edit = { isNew: false, draft: JSON.parse(JSON.stringify(p)) }; ADMIN.errors = null; render(); window.scrollTo(0, 0); },
  "a-cancel": function () { ADMIN.edit = null; ADMIN.promo = null; ADMIN.errors = null; render(); },
  "a-flag": function (el) { var p = productById(el.dataset.id); p[el.dataset.flag] = !p[el.dataset.flag]; markDirty(); render(); },
  "a-status": function (el) { var p = productById(el.dataset.id); p.status = p.status === "active" ? "hidden" : "active"; markDirty(); render(); },
  "a-del-ask": function (el) { ADMIN.confirm = el.dataset.id; render(); },
  "a-del-cancel": function () { ADMIN.confirm = ""; render(); },
  "a-del": function (el) { S.products = S.products.filter(function (p) { return p.id !== el.dataset.id; }); ADMIN.confirm = ""; markDirty(); render(); },
  "a-new-promo": function () {
    ADMIN.promo = { isNew: true, draft: { id: "p" + Date.now(), name: "", kind: "percent", value: 10, min: null, scope: "products", category: null, products: [], badge: { ru: "", kk: "", en: "" }, desc: { ru: "", kk: "", en: "" }, starts: null, ends: null, active: true, home: true, demo: false } };
    ADMIN.errors = null; render(); window.scrollTo(0, 0);
  },
  "a-edit-promo": function (el) { var p = S.promotions.filter(function (x) { return x.id === el.dataset.id; })[0]; ADMIN.promo = { isNew: false, draft: JSON.parse(JSON.stringify(p)) }; ADMIN.errors = null; render(); window.scrollTo(0, 0); },
  "a-toggle-promo": function (el) { var p = S.promotions.filter(function (x) { return x.id === el.dataset.id; })[0]; p.active = !p.active; markDirty(); render(); },
  "a-del-promo": function (el) { S.promotions = S.promotions.filter(function (x) { return x.id !== el.dataset.id; }); ADMIN.confirm = ""; markDirty(); render(); },
  "a-review-status": function (el) { var r = S.reviews.filter(function (x) { return x.id === el.dataset.id; })[0]; r.status = r.status === "approved" ? "hidden" : "approved"; markDirty(); render(); },
  "a-del-review": function (el) { S.reviews = S.reviews.filter(function (x) { return x.id !== el.dataset.id; }); ADMIN.confirm = ""; markDirty(); render(); },
  "a-remove-demo": function () {
    S.products = S.products.filter(function (p) { return !p.demo; }); S.reviews = S.reviews.filter(function (r) { return !r.sample; }); S.promotions = S.promotions.filter(function (p) { return !p.demo; });
    S.settings.demoMode = false; ADMIN.confirm = ""; ADMIN.msg = A("demo_done"); markDirty(); render();
  },
  "a-import-apply": function () {
    var pv = ADMIN.importPreview; if (!pv) return;
    pv.create.forEach(function (p) { S.products.push(p); });
    pv.update.forEach(function (u) { var p = productById(u.id); Object.keys(u.changes).forEach(function (k) { p[k] = u.changes[k]; }); });
    ADMIN.msg = A("import_done", { c: pv.create.length, u: pv.update.length }); ADMIN.importPreview = null; markDirty(); render();
  },
  "a-export": function () { downloadCsv("book_lovers-catalog.csv", exportCsv()); },
  "a-template": function () { downloadCsv("book_lovers-template.csv", CSV_COLS.join(";") + "\nBL-0100;Example Title;Author Name;Описание;Сипаттама;Description;5900;;fiction;classics;16+;https://example.com/cover.jpg;3;no;yes;yes;no;B1;320;active\n"); },
  "a-del-order": function (el) {
    var id = el.dataset.id;
    var orders = getOrders().filter(function(o) { return o.id !== id; });
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); } catch (e) {}
    if (window.BL_DB && window.BL_DB.isReady()) {
      window.BL_DB.deleteOrder(id);
    }
    ADMIN.confirm = "";
    toast("Заказ удален");
    render();
  },
  "a-test-supabase": function () {
    var urlEl = document.getElementById("as-sb-url");
    var keyEl = document.getElementById("as-sb-key");
    var u = urlEl ? urlEl.value : "";
    var k = keyEl ? keyEl.value : "";
    if (u || k) {
      if (window.BL_DB) window.BL_DB.saveConfig(u, k);
    }
    if (!window.BL_DB) {
      toast("Модуль Supabase не загружен");
      return;
    }
    toast("Проверяем подключение к Supabase…");
    window.BL_DB.testConnection().then(function (res) {
      if (res.ok) {
        toast("✓ " + res.message);
        render();
      } else {
        toast("✗ Ошибка: " + res.message);
      }
    });
  },
  "a-save-supabase": function () {
    var urlEl = document.getElementById("as-sb-url");
    var keyEl = document.getElementById("as-sb-key");
    var u = urlEl ? urlEl.value : "";
    var k = keyEl ? keyEl.value : "";
    if (!window.BL_DB) return;
    window.BL_DB.saveConfig(u, k);
    toast("Настройки Supabase сохранены в браузере!");
    window.BL_DB.testConnection().then(function (res) {
      if (res.ok) toast("✓ " + res.message);
      else toast("Предупреждение: " + res.message);
      render();
    });
  },
  "a-admin-logout": function () {
    setAuthUser(null);
    toast(t("auth.logged_out"));
    if (window.BL_ADMIN) render();
    else go(token("home"));
  }
};
var ADMIN_CHANGE = {
  "order-status": function (el) {
    setOrderStatus(el.dataset.id, el.value);
    if (window.BL_DB && window.BL_DB.isReady()) {
      window.BL_DB.updateOrderStatus(el.dataset.id, el.value);
    }
    toast(t("orders.change_status") + " " + t("orders.status_" + el.value));
    render();
  },
  "stock": function (el) { var p = productById(el.dataset.id), n = intOrNull(el.value); if (p && n != null && !isNaN(n)) { p.stock = n; markDirty(); render(); } },
  "book-cat": function (el) { readBookForm(); ADMIN.edit.draft.cat = el.value; ADMIN.edit.draft.genre = ""; render(); },
  "cover": function (el) {
    var file = el.files && el.files[0]; if (!file) return;
    readBookForm();
    var name = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    var path = "images/covers/" + name;
    try { PREVIEWS[path] = URL.createObjectURL(file); } catch (e) { /* preview unavailable */ }
    ADMIN.edit.draft.cover = path; ADMIN.msg = A("cover_copy", { name: name }); render();
  },
  "import": function (el) {
    var file = el.files && el.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result, text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("windows-1251").decode(buf); }
      ADMIN.importPreview = parseImport(text.replace(/^﻿/, "")); render();
    };
    reader.readAsArrayBuffer(file);
  }
};
function readBookForm() {
  var f = app.querySelector("[data-form='a-book']"); if (!f || !ADMIN.edit) return null;
  var fd = new FormData(f), v = {}; fd.forEach(function (val, k) { if (k !== "ages") v[k] = val; });
  var d = ADMIN.edit.draft;
  d.title = (v.title || "").trim(); d.author = (v.author || "").trim(); d.desc = readLang(v, "desc");
  d.price = v.price; d.sale = v.sale; d.stock = v.stock; if (ADMIN.edit.isNew) d.id = (v.id || "").trim();
  d.cat = v.cat; d.genre = v.genre || ""; d.ages = fd.getAll("ages"); d.level = v.level || ""; d.binding = v.binding || ""; d.pages = v.pages ? +v.pages : null; d.tags = v.tags || "";
  var cu = (v.coverUrl || "").trim(); if (/^https:\/\//.test(cu) || /^images\/[\w.\/-]+$/.test(cu)) d.cover = cu; else if (!cu) d.cover = "";
  ["trending", "isNew", "featured", "promo"].forEach(function (k) { d[k] = !!v[k]; }); d.status = v.active ? "active" : "hidden"; d.rank = +v.rank || 100;
  return d;
}
var ADMIN_SUBMIT = {
  "a-book": function () {
    var d = readBookForm(), e = {};
    if (!d.title) e.title = "required";
    var pr = intOrNull(d.price); if (pr == null || isNaN(pr)) e.price = "bad_price";
    var sl = intOrNull(d.sale); if (sl != null && (isNaN(sl) || sl >= pr)) e.sale = isNaN(sl) ? "bad_price" : "bad_sale";
    var st = intOrNull(d.stock); if (st == null || isNaN(st)) e.stock = "bad_price";
    if (ADMIN.edit.isNew && (!d.id || S.products.some(function (p) { return p.id === d.id; }))) d.id = nextSku();
    if (Object.keys(e).length) { ADMIN.errors = e; render(); return; }
    d.price = pr; d.sale = sl; d.stock = st; d.slug = uniqueSlug(slugify(d.title + " " + d.author), d.id);
    if (ADMIN.edit.isNew) S.products.push(d); else S.products = S.products.map(function (p) { return p.id === d.id ? d : p; });
    ADMIN.edit = null; ADMIN.errors = null; ADMIN.msg = A("saved_draft"); markDirty(); render(); window.scrollTo(0, 0);
  },
  "a-promo": function (f, v, fd) {
    var d = ADMIN.promo.draft, e = {};
    d.name = (v.name || "").trim(); d.kind = v.kind; d.value = intOrNull(v.value); d.min = v.kind === "bundle" ? intOrNull(v.min) : null; d.scope = v.scope; d.category = v.category || null;
    d.products = fd.getAll("products"); d.badge = readLang(v, "badge"); d.desc = readLang(v, "pdesc");
    d.starts = v.starts ? v.starts + ":00" + STORE_TZ : null; d.ends = v.ends ? v.ends + ":00" + STORE_TZ : null; d.active = !!v.active; d.home = !!v.home;
    if (!d.name) e.name = "required";
    if (d.kind === "fixed") { if (!(d.value >= 1)) e.value = "bad_amount"; } else if (!(d.value >= 1 && d.value <= 90)) e.value = "bad_percent";
    if (d.kind === "bundle" && !(d.min >= 2)) e.min = "bad_min";
    if (d.scope === "products" && !d.products.length) e.products = "need_products";
    if (d.scope === "category" && !d.category) e.products = "required";
    if (d.starts && d.ends && Date.parse(d.ends) <= Date.parse(d.starts)) e.ends = "bad_dates";
    if (Object.keys(e).length) { ADMIN.errors = e; render(); return; }
    if (ADMIN.promo.isNew) S.promotions.push(d); else S.promotions = S.promotions.map(function (p) { return p.id === d.id ? d : p; });
    ADMIN.promo = null; ADMIN.errors = null; ADMIN.msg = A("saved_draft"); markDirty(); render();
  },
  "a-review": function (f, v) {
    if (!(v.name || "").trim() || !(v.text || "").trim()) return;
    S.reviews.unshift({ id: "r" + Date.now(), name: v.name.trim(), text: v.text.trim(), rating: +v.rating || 5, book: (v.book || "").trim(), lang: v.lang, sample: !!v.sample, status: "approved", date: new Date().toISOString().slice(0, 10) });
    ADMIN.msg = A("saved_draft"); markDirty(); render();
  },
  "a-settings": function (f, v) {
    var s = S.settings, e = {};
    if (v.whatsapp && !normKz(v.whatsapp)) e.whatsapp = "s_wa_bad";
    ["instagram", "tiktok"].forEach(function (k) { if (v[k] && !/^https:\/\//.test(v[k].trim())) e[k] = "s_url_bad"; });
    if (Object.keys(e).length) { ADMIN.errors = e; render(); return; }
    s.whatsapp = (v.whatsapp || "").trim(); s.phone = (v.phone || "").trim(); s.email = (v.email || "").trim(); s.instagram = (v.instagram || "").trim(); s.tiktok = (v.tiktok || "").trim();
    s.city = readLang(v, "city"); s.pickup = readLang(v, "pickup"); s.hours = readLang(v, "hours"); s.deliveryInfo = readLang(v, "deliveryInfo"); s.announcement = readLang(v, "announcement");
    ["pickupOn", "courierOn", "postOn", "transferOn", "onDeliveryOn", "demoMode"].forEach(function (k) { s[k] = !!v[k]; });
    if (!s.pickupOn && !s.courierOn && !s.postOn) s.pickupOn = true;
    ["feeCourier", "feePost", "freeFrom", "lowStock"].forEach(function (k) { var n = intOrNull(v[k]); s[k] = (n == null || isNaN(n)) ? 0 : n; });
    if (v.adminPassword && v.adminPassword.trim().length >= 4) {
      setAdminPass(v.adminPassword.trim());
    }
    if (v.supabaseUrl !== undefined || v.supabaseAnonKey !== undefined) {
      if (window.BL_DB) window.BL_DB.saveConfig(v.supabaseUrl, v.supabaseAnonKey);
    }
    ADMIN.errors = null; ADMIN.msg = A("saved_draft"); markDirty(); render(); window.scrollTo(0, 0);
  }
};

/* ---- CSV */
var CSV_COLS = ["sku", "title", "author", "description_ru", "description_kk", "description_en", "price", "discount_price", "category", "genre", "age_group", "cover_image", "stock", "featured", "popular", "new", "promo", "english_level", "pages", "status"];
function csvCell(v) { v = v == null ? "" : String(v); return /[;"\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCsv() {
  var yn = function (b) { return b ? "yes" : "no"; };
  return "﻿" + CSV_COLS.join(";") + "\n" + S.products.map(function (p) {
    return [p.id, p.title, p.author, p.desc.ru, p.desc.kk, p.desc.en, p.price, p.sale == null ? "" : p.sale, p.cat, p.genre, p.ages.map(function (a) { return a.replace("-plus", "+"); }).join("|"),
      p.cover || "", p.stock, yn(p.featured), yn(p.trending), yn(p.isNew), yn(p.promo), p.level, p.pages || "", p.status].map(csvCell).join(";");
  }).join("\n");
}
function downloadCsv(name, text) { downloadFile(name, text, "text/csv"); }
function downloadFile(name, text, type) {
  var url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}
function parseCsv(text) {
  var delim = (text.split("\n")[0].match(/;/g) || []).length >= (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  var rows = [], row = [], cell = "", q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
}
function parseImport(text) {
  var rows = parseCsv(text), out = { create: [], update: [], errors: [] };
  if (!rows.length) return out;
  var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  if (head.indexOf("title") === -1 || head.indexOf("price") === -1) { out.errors.push(A("import_bad_head")); return out; }
  var yes = function (v) { return /^(1|yes|y|да|иә|true|\+)$/i.test(String(v).trim()); };
  var seen = {};
  rows.slice(1).forEach(function (r, i) {
    var line = i + 2, v = {}; head.forEach(function (h, j) { v[h] = (r[j] || "").trim(); });
    var errs = [], sku = v.sku, existing = sku ? productById(sku) : null;
    if (sku && seen[sku]) errs.push("SKU " + sku + " ×2"); if (sku) seen[sku] = 1;
    var ch = {};
    if (v.title) ch.title = v.title; if (v.author) ch.author = v.author;
    if (v.price) { var pr = intOrNull(v.price); if (pr == null || isNaN(pr)) errs.push("price"); else ch.price = pr; }
    if (v.discount_price) { var sl = intOrNull(v.discount_price); if (isNaN(sl)) errs.push("discount_price"); else ch.sale = sl; }
    if (v.stock) { var st = intOrNull(v.stock); if (isNaN(st) || st == null) errs.push("stock"); else ch.stock = st; }
    if (v.category) { var c = S.categories.filter(function (x) { return !x.parent && (x.slug === v.category.toLowerCase() || fold(x.name.ru) === fold(v.category) || fold(x.name.en) === fold(v.category) || fold(x.name.kk) === fold(v.category)); })[0]; if (c) ch.cat = c.slug; else errs.push("category «" + v.category + "»"); }
    if (v.genre) { var g = S.categories.filter(function (x) { return x.parent && (x.slug === v.genre.toLowerCase() || fold(x.name.ru) === fold(v.genre) || fold(x.name.en) === fold(v.genre)); })[0]; if (g) { ch.genre = g.slug; if (!ch.cat) ch.cat = g.parent; } else errs.push("genre «" + v.genre + "»"); }
    if (v.age_group) { var ag = v.age_group.split(/[|,]/).map(function (a) { a = a.trim().replace("–", "-"); return a.slice(-1) === "+" ? a.slice(0, -1) + "-plus" : a; }); var bad = ag.filter(function (a) { return !ageBySlug(a); }); if (bad.length) errs.push("age_group «" + bad.join(", ") + "»"); else ch.ages = ag; }
    if (v.cover_image) { if (/^https:\/\//.test(v.cover_image) || /^images\/[\w.\/-]+$/.test(v.cover_image)) ch.cover = v.cover_image; else if (/^[\w.-]+\.(webp|jpe?g|png)$/i.test(v.cover_image)) ch.cover = "images/covers/" + v.cover_image; else errs.push("cover_image"); }
    var desc = {}; ["ru", "kk", "en"].forEach(function (l) { if (v["description_" + l]) desc[l] = v["description_" + l]; });
    if (Object.keys(desc).length) ch.desc = Object.assign({}, existing ? existing.desc : { ru: "", kk: "", en: "" }, desc);
    [["featured", "featured"], ["popular", "trending"], ["new", "isNew"], ["promo", "promo"]].forEach(function (m) { if (v[m[0]]) ch[m[1]] = yes(v[m[0]]); });
    if (v.english_level) ch.level = v.english_level.toUpperCase(); if (v.pages) ch.pages = +v.pages || null;
    if (v.status) ch.status = v.status === "active" ? "active" : "hidden";
    if (!existing && (!ch.title || ch.price == null || !ch.cat)) errs.push("title / price / category");
    if (errs.length) { out.errors.push(A("import_row", { n: line, msg: errs.join(", ") })); return; }
    if (existing) { out.update.push({ id: existing.id, changes: ch }); return; }
    var p = Object.assign({ id: sku || nextSku() + "-" + line, title: "", author: "", desc: { ru: "", kk: "", en: "" }, price: 0, sale: null, cat: "fiction", genre: "", ages: [], level: "", pages: null, binding: "", stock: 0, status: "active", trending: false, isNew: false, featured: false, promo: false, rank: 100, demo: false, cover: "", tags: "" }, ch);
    p.slug = uniqueSlug(slugify(p.title + " " + p.author), p.id);
    out.create.push(p);
  });
  return out;
}

/* ---- save: download a new data/store.js to upload to the hosting */
function publishSite() {
  S.updated = new Date().toISOString().slice(0, 10);
  var text = "/* book_lovers.kz catalog data. Edit with admin.html, then replace this file on the hosting. */\n" +
    "window.BL_STORE = " + JSON.stringify(S, null, 1) + ";\n";
  downloadFile("store.js", text, "text/javascript");
  try { localStorage.setItem("bl-admin-draft", JSON.stringify(S)); } catch (e) { /* ignore */ }
  DIRTY = 0; ADMIN.msg = A("pub_ok"); render();
}
window.addEventListener("beforeunload", function (e) { if (DIRTY) { e.preventDefault(); e.returnValue = ""; } });

/* ===================================================================== start */
if (window.BL_ADMIN) {
  EDITOR = true; ASSETS = "local";
  try {
    var draft = JSON.parse(localStorage.getItem("bl-admin-draft") || "null");
    if (draft && JSON.stringify(draft.products) !== JSON.stringify(S.products) || draft && JSON.stringify(draft.settings) !== JSON.stringify(S.settings) || draft && JSON.stringify(draft.promotions) !== JSON.stringify(S.promotions) || draft && JSON.stringify(draft.reviews) !== JSON.stringify(S.reviews)) {
      S = draft; ADMIN.msg = A("draft_restored");
    }
  } catch (e) { /* ignore */ }
}
window.addEventListener("hashchange", function () { var h = location.hash.slice(1); if (h && h !== token(R.view, R.arg)) go(h, false); });
function initSupabaseIntegration() {
  if (!window.BL_DB) return;
  window.BL_DB.getSession().then(function (session) {
    if (session && session.user) {
      window.BL_DB.getProfile(session.user.id).then(function (profile) {
        var userObj = {
          id: session.user.id,
          email: session.user.email,
          name: (profile && profile.name) || (session.user.user_metadata && session.user.user_metadata.name) || session.user.email,
          phone: (profile && profile.phone) || (session.user.user_metadata && session.user.user_metadata.phone) || "",
          address: (profile && profile.address) || (session.user.user_metadata && session.user.user_metadata.address) || "",
          role: (profile && profile.role) || "customer"
        };
        setAuthUser(userObj);
        syncUserData(userObj.id);
        render();
      });
    }
  });

  window.BL_DB.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_IN" && session && session.user) {
      window.BL_DB.getProfile(session.user.id).then(function (profile) {
        var userObj = {
          id: session.user.id,
          email: session.user.email,
          name: (profile && profile.name) || (session.user.user_metadata && session.user.user_metadata.name) || session.user.email,
          phone: (profile && profile.phone) || (session.user.user_metadata && session.user.user_metadata.phone) || "",
          address: (profile && profile.address) || (session.user.user_metadata && session.user.user_metadata.address) || "",
          role: (profile && profile.role) || "customer"
        };
        setAuthUser(userObj);
        syncUserData(userObj.id);
        render();
      });
    } else if (event === "SIGNED_OUT") {
      if (CURRENT_USER && CURRENT_USER.role === "customer") {
        setAuthUser(null);
        render();
      }
    }
  });
}

(function start() {
  var saved = store("bl-lang");
  if (LANGS.indexOf(saved) !== -1) R.lang = saved;
  if (window.BL_ADMIN) R.view = "admin";
  var h = location.hash.slice(1);
  if (h && !window.BL_ADMIN) { var r = parseToken(h); if (r.lang) R.lang = r.lang; R.view = r.view; R.arg = r.arg; if (r.view === "catalog" && r.arg) { R.view = "x"; go(h, false); return; } }
  render();
  initSupabaseIntegration();
})();
/* editor mode is switched on only by admin.html */
})();
