// PrintPrompt web — versione essenziale dell'app.
// Stesso database dell'app Android (Supabase): esplora i maker sulla mappa,
// profili con vetrina e recensioni, ricerca per oggetto, accesso, chat e offerte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_KEY, PHOTO_BUCKET, PLAY_URL } from "./config.js";
import { initI18n } from "./i18n.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const view = document.getElementById("view");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let timers = [];
let cleanups = [];   // canali in tempo reale da chiudere cambiando pagina
let session = null;

// ---------------------------------------------------------------- utilità
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v) => (v == null ? "" : Number(v).toFixed(2).replace(".", ",") + " €");
const photo = (p) => (p ? `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}` : null);
const initials = (n) => esc(String(n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
const avatar = (name, path, big = false) =>
  path ? `<img class="avatar${big ? " big" : ""}" src="${esc(photo(path))}" alt="">` : `<div class="avatar${big ? " big" : ""}">${initials(name)}</div>`;
const stars = (r) => "★".repeat(Math.round(r || 0)) + "☆".repeat(5 - Math.round(r || 0));
const time = (iso) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const day = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
const km = (d) => (d == null ? "" : d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1).replace(".", ",") + " km");

function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3500);
}
function errText(e) {
  const m = String(e?.message || e || "");
  const i = m.indexOf("PP: ");
  if (i >= 0) return m.slice(i + 4);
  if (/fetch|network/i.test(m)) return "Connessione assente: riprova.";
  return "Qualcosa non ha funzionato: riprova.";
}
async function rpc(name, params = {}) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw error;
  return data;
}
const STATUS = {
  inquiry: "Domanda", sent: "In attesa di offerta", offered: "Offerta da confermare", accepted: "Confermata",
  printing: "In stampa", ready: "Pronta", completed: "Consegnata", declined: "Rifiutata", cancelled: "Annullata",
};
const isGuest = () => !session || session.user?.is_anonymous;

// Un visitatore entra come ospite (come "Continua senza account" nell'app) per poter leggere i dati
async function ensureSession() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) {
    const r = await sb.auth.signInAnonymously();
    if (!r.error) session = r.data.session;
  }
  updateNav();
}
function updateNav() {
  document.getElementById("nav-account").textContent = isGuest() ? "Accedi" : "Account";
}
function needAccount(reason) {
  if (!isGuest()) return false;
  toast(reason || "Serve un account gratuito.");
  location.hash = "#/accedi?next=" + encodeURIComponent(location.hash);
  return true;
}

// ---------------------------------------------------------------- router
const routes = [
  [/^#?\/?$/, explore],
  [/^#\/cerca$/, search],
  [/^#\/m\/([0-9a-f-]{36})$/i, makerPage],
  [/^#\/@([a-z0-9][a-z0-9-]{2,29})$/i, handlePage],
  [/^#\/richieste$/, requests],
  [/^#\/chat\/([0-9a-f-]{36})$/i, chat],
  [/^#\/accedi/, account],
  [/^#\/o\/([0-9a-f-]{36})$/i, itemPage],
  [/^#\/nuova\/([0-9a-f-]{36})$/i, newRequest],
  [/^#\/g\/([A-Z0-9]{6})$/i, (c) => groupPage(c.toUpperCase())],
];
async function route() {
  timers.forEach(clearInterval);
  timers = [];
  cleanups.forEach((f) => { try { f(); } catch (_) {} });
  cleanups = [];
  const hash = location.hash || "#/";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.remove("on"));
  const key = hash.startsWith("#/cerca") ? "search" : hash.startsWith("#/richieste") || hash.startsWith("#/chat") ? "requests"
    : hash.startsWith("#/accedi") ? "account" : hash.startsWith("#/m/") ? "" : "explore";
  document.querySelector(`[data-nav="${key}"]`)?.classList.add("on");
  for (const [re, fn] of routes) {
    const m = hash.split("?")[0].match(re);
    if (m) {
      view.innerHTML = `<p class="center muted">Carico…</p>`;
      try { await fn(...m.slice(1)); } catch (e) { view.innerHTML = `<p class="center">${esc(errText(e))}</p>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = `<p class="center">Pagina non trovata. <a href="#/">Torna a Esplora</a></p>`;
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- Esplora
async function explore() {
  view.innerHTML = `
    <h1>Stampa 3D vicino a te</h1>
    <p class="muted">Trova un maker, guarda vetrina e recensioni, scrivigli. Per caricare file e creare modelli con l'AI usa l'app.</p>
    <div class="banner"><span class="grow">📱 L'app Android ha tutto: file STL, stima del prezzo, AI, avvisi.</span>
      <a class="btn small" href="${PLAY_URL}" target="_blank" rel="noopener">Scarica l'app</a></div>
    <div id="map"></div>
    <div class="row"><h2 class="grow" id="count">Maker</h2><button class="btn ghost small" id="near">📍 Vicino a me</button></div>
    <div class="list" id="makers"><p class="muted">Carico i maker…</p></div>`;
  const map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/liberty", center: [12.5, 42.5], zoom: 5 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  let markers = [];
  async function load(lat, lng, radius) {
    const list = await rpc("nearby_makers", { p_lat: lat, p_lng: lng, p_radius_km: radius });
    markers.forEach((m) => m.remove());
    markers = list.map((m) => {
      const el = document.createElement("a");
      el.href = `#/m/${m.id}`;
      el.title = m.display_name;
      el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#000;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:block";
      return new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map);
    });
    document.getElementById("count").textContent = list.length === 1 ? "1 maker" : `${list.length} maker`;
    document.getElementById("makers").innerHTML = list.length ? list.map(makerRow).join("")
      : `<p class="muted">Nessun maker in questa zona. Prova "Vicino a me" o allarga la mappa.</p>`;
  }
  document.getElementById("near").onclick = () => {
    if (!navigator.geolocation) return toast("Il browser non dà la posizione.");
    navigator.geolocation.getCurrentPosition(
      (p) => { map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 11 }); load(p.coords.latitude, p.coords.longitude, 60).catch((e) => toast(errText(e))); },
      () => toast("Posizione non concessa: uso tutta Italia."));
  };
  await load(42.5, 12.5, 900);
}
function makerRow(m) {
  const rating = m.rating_avg ? `★ ${Number(m.rating_avg).toFixed(1).replace(".", ",")} (${m.rating_count})` : "Nuovo";
  const bits = [m.city, m.distance_km != null && m.distance_km < 800 ? km(m.distance_km) : null, rating,
    m.min_hourly_rate != null ? `da ${euro(m.min_hourly_rate)}/h` : null].filter(Boolean);
  return `<a class="maker" href="#/m/${esc(m.id || m.maker_id)}">${avatar(m.display_name, m.avatar || m.avatar_path)}
    <div class="grow"><strong>${esc(m.display_name)}</strong>${m.verified ? ' <span class="chip dark">✓ Verificato</span>' : ""}
    <div class="muted small">${esc(bits.join(" · "))}</div>
    ${m.materials?.length ? `<div class="small">${esc(m.materials.slice(0, 5).join(", "))}</div>` : ""}</div></a>`;
}

// ---------------------------------------------------------------- Cerca un oggetto
async function search() {
  view.innerHTML = `<h1>Cerca un oggetto</h1>
    <p class="muted">Cerchiamo nelle vetrine, nelle foto dei lavori e nelle descrizioni dei maker.</p>
    <form class="searchbar" id="f"><input type="search" id="q" placeholder="Es. portachiavi, ricambio lavatrice, vaso" required minlength="2">
    <button class="btn">Cerca</button></form><div class="list" id="res" style="margin-top:14px"></div>`;
  document.getElementById("f").onsubmit = async (ev) => {
    ev.preventDefault();
    const res = document.getElementById("res");
    res.innerHTML = `<p class="muted">Cerco…</p>`;
    try {
      const hits = await rpc("search_objects", { p_query: document.getElementById("q").value, p_lat: 42.5, p_lng: 12.5, p_radius_km: 900 });
      res.innerHTML = hits.length ? hits.map((h) => `<a class="maker" href="#/m/${esc(h.maker_id)}">
          ${h.photo_path ? `<img class="avatar" style="border-radius:10px" src="${esc(photo(h.photo_path))}" alt="">` : avatar(h.display_name, h.avatar_path)}
          <div class="grow"><strong>${esc(h.title || h.display_name)}</strong>
          <div class="muted small">${esc([h.display_name, h.city].filter(Boolean).join(" · "))} · ${h.match === "shop" ? "In vetrina" : h.match === "gallery" ? "Già stampato" : "Nella descrizione"}</div></div>
          ${h.price != null ? `<strong>${euro(h.price)}</strong>` : ""}</a>`).join("")
        : `<p class="muted">Nessun maker trovato. Prova con altre parole.</p>`;
    } catch (e) { res.innerHTML = `<p>${esc(errText(e))}</p>`; }
  };
}

// ---------------------------------------------------------------- Profilo del maker
async function makerPage(id) {
  id = id.toLowerCase();
  let { data: m, error } = await sb.from("makers")
    .select("id, display_name, city, bio, offers_pickup, offers_shipping, active, avatar_path, verified, eco, faq, first_order_pct, away_to")
    .eq("id", id).maybeSingle();
  if (error) ({ data: m } = await sb.from("makers").select("id, display_name, city, bio, offers_pickup, offers_shipping, active, avatar_path, verified").eq("id", id).maybeSingle());
  if (!m) { view.innerHTML = `<p class="center">Maker non trovato.</p>`; return; }
  document.title = `${m.display_name} – PrintPrompt`;
  const [stats, badges, shop, reviews, gallery] = await Promise.all([
    rpc("maker_public_stats", { p_maker: id }).catch(() => ({})),
    rpc("maker_badges", { p_maker: id }).catch(() => []),
    sb.from("shop_items").select("*").eq("maker_id", id).eq("active", true).then((r) => r.data || []),
    rpc("maker_reviews", { p_maker: id, p_limit: 20 }).catch(() => []),
    sb.from("maker_gallery").select("photo_path, caption").eq("maker_id", id).limit(12).then((r) => r.data || []),
  ]);
  const badgeText = { fast: "⚡ Risponde in fretta", top: "★ Top maker", pro50: "50+ stampe", pro10: "10+ stampe", new: "Nuovo" };
  const awayTo = m.away_to && new Date(m.away_to) >= new Date(new Date().toDateString()) ? m.away_to : null;
  view.innerHTML = `
    <div class="row" style="gap:16px;margin-top:8px">${avatar(m.display_name, m.avatar_path, true)}
      <div class="grow"><h1>${esc(m.display_name)}</h1>
      <div class="muted">${esc([m.city, stats?.rating_count ? `★ ${String(stats.rating_avg).replace(".", ",")} (${stats.rating_count})` : "Nuovo su PrintPrompt",
        stats?.completed_count ? `${stats.completed_count} stampe consegnate` : null].filter(Boolean).join(" · "))}</div></div></div>
    <div class="row" style="margin:12px 0">
      ${m.verified ? '<span class="chip dark">✓ Maker verificato</span>' : ""}
      ${(badges || []).map((b) => badgeText[b] ? `<span class="chip">${badgeText[b]}</span>` : "").join("")}
      ${m.eco ? '<span class="chip green">🌱 Filamento riciclato</span>' : ""}
      ${m.first_order_pct > 0 ? `<span class="chip dark">🎁 −${m.first_order_pct}% sulla prima stampa</span>` : ""}
      ${m.offers_pickup ? '<span class="chip">Ritiro</span>' : ""}${m.offers_shipping ? '<span class="chip">Spedizione</span>' : ""}
      ${awayTo ? `<span class="chip">🌴 In ferie fino al ${esc(day(awayTo))}</span>` : ""}
    </div>
    ${m.bio ? `<p>${esc(m.bio)}</p>` : ""}
    <div id="promo"></div>
    <div class="row">
      ${m.active ? `<a class="btn" href="#/nuova/${esc(id)}">📤 Manda un file STL</a><button class="btn ghost" id="ask">💬 Scrivi al maker</button>` : `<span class="chip">Il maker è in pausa</span>`}
      <a class="btn ghost" href="printprompt://maker/${esc(id)}">Apri nell'app</a>
      <button class="btn ghost" id="share">Condividi</button>
    </div>
    <p class="small muted">Per mandare un file STL e avere una stima del prezzo usa l'app.</p>
    ${shop.length ? `<h2>Vetrina</h2><div class="shop">${shop.map((it) => `<button class="item" data-item="${esc(it.id)}">
        ${it.photo_path ? `<img src="${esc(photo(it.photo_path))}" alt="">` : `<div class="ph"></div>`}
        <div><strong>${esc(it.title)}</strong><br>${euro(it.price)}</div></button>`).join("")}</div>` : ""}
    <div id="finish"></div>
    ${gallery.length ? `<h2>Lavori</h2><div class="photos">${gallery.map((g) => `<img src="${esc(photo(g.photo_path))}" alt="${esc(g.caption || "")}" loading="lazy">`).join("")}</div>` : ""}
    ${Array.isArray(m.faq) && m.faq.length ? `<h2>Domande frequenti</h2>${m.faq.map((f) => `<details class="review"><summary><strong>${esc(f.q)}</strong></summary><p>${esc(f.a)}</p></details>`).join("")}` : ""}
    <h2>Recensioni</h2>
    ${reviews.length ? reviews.filter((r) => !r.hidden).map((r) => `<div class="review"><span class="stars">${stars(r.rating)}</span>
      <strong> ${esc(r.author || "Cliente")}</strong> <span class="muted small">${esc(day(r.created_at))}</span>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}${r.reply ? `<p class="small muted">Risposta del maker: ${esc(r.reply)}</p>` : ""}</div>`).join("")
      : `<p class="muted">Ancora nessuna recensione.</p>`}`;
  document.getElementById("share").onclick = async () => {
    const url = `${location.origin}/m/?id=${id}`;
    if (navigator.share) navigator.share({ title: m.display_name, url }).catch(() => {});
    else { await navigator.clipboard?.writeText(url); toast("Link copiato"); }
  };
  const ask = document.getElementById("ask");
  if (ask) ask.onclick = async () => {
    if (needAccount("Per scrivere ai maker serve un account gratuito.")) return;
    try { const rid = await rpc("start_inquiry", { p_maker: id }); location.hash = `#/chat/${rid}`; } catch (e) { toast(errText(e)); }
  };
  view.querySelectorAll("[data-item]").forEach((b) => (b.onclick = () => orderDialog(shop.find((x) => x.id === b.dataset.item))));
  makerPromoWeb(id).catch(() => {});
}

// Link personale: printprompt.github.io/nome → #/@nome
async function handlePage(h) {
  const id = await rpc("maker_by_handle", { p_handle: h.toLowerCase() }).catch(() => null);
  if (!id) { view.innerHTML = `<p class="center">Nessun maker con il link /${esc(h)}.</p>`; return; }
  await makerPage(id);
}

// Offerta a tempo, fedeltà, regalo, servizi extra e rifiniture prima/dopo
async function makerPromoWeb(id) {
  const [res, services, pairs] = await Promise.all([
    sb.from("makers").select("handle, flash_pct, flash_until, flash_label, loyalty_every, loyalty_pct, gift_enabled, gift_price").eq("id", id).maybeSingle(),
    sb.from("maker_services").select("name, price, per_piece").eq("maker_id", id).then((r) => r.data || []),
    sb.from("finish_pairs").select("before_path, after_path, caption").eq("maker_id", id).then((r) => r.data || []),
  ]);
  const p = res && res.data;
  const box = document.getElementById("promo");
  if (box && p) {
    const flashOn = p.flash_pct > 0 && p.flash_until && new Date(p.flash_until) > new Date();
    const parts = [];
    if (flashOn) parts.push(`<div class="card" style="background:#ffe4e9;margin:8px 0"><strong>🔥 ${esc(p.flash_label || "Offerta a tempo")} · −${p.flash_pct}%</strong><br><span class="small" id="flash-left"></span></div>`);
    if (p.loyalty_every > 1 && p.loyalty_pct > 0) parts.push(`<p>🎯 Fedeltà: ogni ${p.loyalty_every} stampe, la ${p.loyalty_every}ª con −${p.loyalty_pct}%</p>`);
    if (p.gift_enabled) parts.push(`<p>🎁 Confezione regalo con biglietto${Number(p.gift_price) > 0 ? ": +" + euro(p.gift_price) : " gratis"}</p>`);
    if (services.length) parts.push(`<p>🧰 Servizi extra: ${services.map((s) => esc(s.name) + " " + euro(s.price) + (s.per_piece ? "/pezzo" : "")).join(" · ")}</p>`);
    if (p.handle) parts.push(`<p class="small">🔗 <a href="/${esc(p.handle)}">${esc(location.host)}/${esc(p.handle)}</a></p>`);
    box.innerHTML = parts.join("");
    if (flashOn) {
      const tick = () => {
        const el = document.getElementById("flash-left");
        if (!el) return;
        const s = Math.max(0, (new Date(p.flash_until) - new Date()) / 1000);
        const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60);
        el.textContent = "Finisce tra " + (d ? `${d} g ${h} h` : h ? `${h} h ${mi} min` : `${mi} min`);
      };
      tick();
      timers.push(setInterval(tick, 30000));
    }
  }
  const fin = document.getElementById("finish");
  if (fin && pairs.length) {
    fin.innerHTML = `<h2>Rifiniture: prima e dopo</h2><div class="row" style="overflow-x:auto;flex-wrap:nowrap;gap:12px;padding-bottom:6px">${pairs.map((x) => `
      <figure class="ba" style="margin:0;flex:none;width:260px">
        <div style="position:relative;width:260px;height:260px;border-radius:12px;overflow:hidden;background:#eee">
          <img src="${esc(photo(x.after_path))}" alt="Dopo" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
          <img src="${esc(photo(x.before_path))}" alt="Prima" loading="lazy" class="ba-before" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;clip-path:inset(0 50% 0 0)">
          <span class="chip dark" style="position:absolute;left:6px;top:6px">Prima</span><span class="chip dark" style="position:absolute;right:6px;top:6px">Dopo</span>
        </div>
        <input type="range" min="0" max="100" value="50" style="width:100%">
        ${x.caption ? `<figcaption class="small muted">${esc(x.caption)}</figcaption>` : ""}
      </figure>`).join("")}</div>`;
    fin.querySelectorAll(".ba").forEach((b) => {
      const r = b.querySelector("input"), im = b.querySelector(".ba-before");
      r.oninput = () => (im.style.clipPath = `inset(0 ${100 - r.value}% 0 0)`);
    });
  }
}

function orderDialog(it) {
  const variants = Array.isArray(it.variants) ? it.variants : [];
  const d = document.createElement("div");
  d.className = "dialog";
  d.innerHTML = `<div class="card">
    ${[it.photo_path, ...(it.photos || [])].filter(Boolean).length ? `<div class="photos">${[it.photo_path, ...(it.photos || [])].filter(Boolean)
      .map((p) => `<img src="${esc(photo(p))}" alt="" style="width:220px;height:180px">`).join("")}</div>` : ""}
    <h2 style="margin-top:8px">${esc(it.title)}</h2>
    ${it.description ? `<p>${esc(it.description)}</p>` : ""}
    ${it.bundle_items ? `<p>📦 Contiene: ${esc(it.bundle_items)}</p>` : ""}
    ${variants.length ? `<label>Variante</label><select id="v" style="width:100%;padding:10px;border-radius:12px">${variants.map((v, i) =>
      `<option value="${i}">${esc(v.name)}${v.extra > 0 ? " +" + euro(v.extra) : ""}</option>`).join("")}</select>` : ""}
    <label>Quantità</label><input type="number" id="qty" min="1" max="50" value="1">
    <p><strong id="tot"></strong></p>
    <p class="small muted">Il maker riceve l'ordine con il prezzo già pronto: lo confermi in chat.</p>
    <div class="row"><button class="btn" id="ok">Ordina</button><button class="btn ghost" id="no">Annulla</button></div></div>`;
  document.body.appendChild(d);
  const unit = () => Number(it.price) + Number(variants[d.querySelector("#v")?.value ?? -1]?.extra || 0);
  const upd = () => (d.querySelector("#tot").textContent = "Totale: " + euro(unit() * Math.max(1, Number(d.querySelector("#qty").value) || 1)));
  upd();
  d.querySelector("#qty").oninput = upd;
  if (d.querySelector("#v")) d.querySelector("#v").onchange = upd;
  d.querySelector("#no").onclick = () => d.remove();
  d.onclick = (e) => { if (e.target === d) d.remove(); };
  d.querySelector("#ok").onclick = async () => {
    if (needAccount("Per ordinare serve un account gratuito.")) return d.remove();
    try {
      const v = variants[d.querySelector("#v")?.value ?? -1];
      const rid = await rpc("shop_order", { p_item: it.id, p_quantity: Math.min(50, Math.max(1, Number(d.querySelector("#qty").value) || 1)), p_variant: v?.name ?? "" });
      d.remove();
      location.hash = `#/chat/${rid}`;
    } catch (e) { toast(errText(e)); }
  };
}

// ---------------------------------------------------------------- Oggetto della vetrina (link condivisi)
async function itemPage(id) {
  const { data: it } = await sb.from("shop_items").select("*").eq("id", id.toLowerCase()).maybeSingle();
  if (!it) { view.innerHTML = `<p class="center">Questo oggetto non è più disponibile.</p>`; return; }
  const { data: m } = await sb.from("makers").select("id, display_name, city, avatar_path").eq("id", it.maker_id).maybeSingle();
  document.title = `${it.title} – PrintPrompt`;
  const pics = [it.photo_path, ...(it.photos || [])].filter(Boolean);
  view.innerHTML = `
    ${pics.length ? `<div class="photos">${pics.map((p) => `<img src="${esc(photo(p))}" alt="" style="width:300px;height:240px">`).join("")}</div>` : ""}
    <h1>${esc(it.title)}</h1>
    <p style="font-size:26px;font-weight:800;margin:4px 0">${euro(it.price)}</p>
    ${it.description ? `<p>${esc(it.description)}</p>` : ""}
    ${it.bundle_items ? `<p>📦 Contiene: ${esc(it.bundle_items)}</p>` : ""}
    ${it.material ? `<p class="muted">Materiale: ${esc(it.material)}</p>` : ""}
    ${m ? `<a class="maker" href="#/m/${esc(m.id)}" style="margin:12px 0">${avatar(m.display_name, m.avatar_path)}
      <div class="grow"><strong>${esc(m.display_name)}</strong><div class="muted small">${esc(m.city || "")} · vedi la vetrina</div></div></a>` : ""}
    <div class="row"><button class="btn" id="buy" ${it.active ? "" : "disabled"}>${it.active ? "Ordina" : "Non disponibile"}</button>
      <button class="btn ghost" id="share">Condividi</button></div>`;
  document.getElementById("buy").onclick = () => orderDialog(it);
  document.getElementById("share").onclick = async () => {
    const url = location.href;
    if (navigator.share) navigator.share({ title: it.title, url }).catch(() => {});
    else { await navigator.clipboard?.writeText(url); toast("Link copiato"); }
  };
}

// ---------------------------------------------------------------- Le mie chat
async function requests() {
  if (isGuest()) {
    view.innerHTML = `<div class="center"><h1>Le tue chat</h1><p class="muted">Accedi per vedere richieste, offerte e messaggi.</p>
      <a class="btn" href="#/accedi?next=%23%2Frichieste">Accedi</a></div>`;
    return;
  }
  const list = await rpc("my_requests");
  view.innerHTML = `<h1>Le tue chat</h1><div class="list">${list.length ? list.map((r) => `
    <a class="maker" href="#/chat/${esc(r.id)}"><div class="avatar">${initials(r.other_name)}</div>
      <div class="grow"><strong>${esc(r.other_name)}</strong> ${r.unread ? '<span class="chip dark">nuovo</span>' : ""}
      <div class="muted small">${esc(r.file_name)} · ${esc(STATUS[r.status] || r.status)}${r.offer_price != null ? " · " + euro(r.offer_price) : ""}</div>
      ${r.last_message ? `<div class="small">${esc(r.last_message).slice(0, 90)}</div>` : ""}</div>
      <span class="muted small">${esc(day(r.updated_at))}</span></a>`).join("")
    : `<p class="muted">Nessuna chat. <a href="#/">Trova un maker</a> e scrivigli.</p>`}</div>`;
}

// ---------------------------------------------------------------- Chat
async function chat(id) {
  if (isGuest()) { location.hash = "#/accedi?next=" + encodeURIComponent("#/chat/" + id); return; }
  const me = session.user.id;
  let d = await rpc("request_detail", { p_id: id });
  if (!d) { view.innerHTML = `<p class="center">Chat non trovata.</p>`; return; }
  const isCustomer = d.role === "customer";
  const other = isCustomer ? d.maker_name : d.customer_name;
  view.innerHTML = `<div class="chat">
    <div class="chathead"><a href="#/richieste" class="btn ghost small">←</a><div class="avatar">${initials(other)}</div>
      <div class="grow"><strong>${esc(other)}</strong><div class="muted small" id="st"></div></div>
      ${isCustomer ? `<a class="btn ghost small" href="#/m/${esc(d.maker_id)}">Profilo</a>` : ""}</div>
    <div class="msgs" id="msgs"></div>
    <form class="composer" id="f"><input id="t" type="text" placeholder="Messaggio" maxlength="1000" autocomplete="off">
      <button class="btn">Invia</button></form></div>`;
  const box = document.getElementById("msgs");
  let lastKey = "";
  async function load(force) {
    d = await rpc("request_detail", { p_id: id });
    document.getElementById("st").textContent = `${d.file_name} · ${STATUS[d.status] || d.status}${d.offer_price != null ? " · " + euro(d.offer_price) : ""}`;
    const [{ data: msgs }, offers] = await Promise.all([
      sb.from("request_messages").select("*").eq("request_id", id).order("created_at"),
      rpc("chat_offers", { p_request: id }).catch(() => []),
    ]);
    const key = (msgs || []).length + "|" + d.updated_at + "|" + offers.map((o) => o.status).join();
    if (!force && key === lastKey) return;
    lastKey = key;
    const byId = Object.fromEntries(offers.map((o) => [o.id, o]));
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = (msgs || []).map((m) => {
      if (m.kind === "event") return `<div class="event">${esc(m.body)}</div>`;
      if (m.kind === "offer") {
        const o = byId[m.offer_id];
        if (!o) return `<div class="event">${esc(m.body)}</div>`;
        const mine = o.sender_id === me;
        const actions = o.status === "pending" && !mine
          ? `<div class="row" style="margin-top:8px"><button class="btn small" data-acc="${esc(o.id)}">Accetta</button><button class="btn ghost small" data-dec="${esc(o.id)}">Rifiuta</button></div>`
          : `<div class="small muted">${{ pending: "In attesa di risposta", accepted: "✓ Accettata", declined: "Rifiutata", withdrawn: "Ritirata", superseded: "Superata", expired: "Scaduta" }[o.status] || o.status}</div>`;
        return `<div class="offer"><div class="small muted">${mine ? "La tua offerta" : "Offerta ricevuta"}</div>
          <div class="price">${euro(o.price)}</div>${o.ready_date ? `<div class="small">Pronta entro il ${esc(day(o.ready_date))}</div>` : ""}
          ${o.note ? `<div>“${esc(o.note)}”</div>` : ""}${actions}</div>`;
      }
      const mine = m.sender_id === me;
      const file = m.attachment_name ? `<div>📎 ${esc(m.attachment_name)} <span class="small">(apri nell'app)</span></div>` : "";
      const text = m.attachment_path && (m.body.startsWith("📎") || m.body.startsWith("🎤")) ? (m.body.startsWith("🎤") ? "🎤 Messaggio vocale (ascoltalo nell'app)" : "") : esc(m.body);
      const scam = !mine && /\b[A-Z]{2}\d{2}(\s?[A-Z0-9]{4}){3,7}|paypal\.me|western\s*union|postepay|fuori\s+(dall'?\s*)?app|pagami\s+(su|con|tramite)/i.test(m.body);
      return `<div class="bubble ${mine ? "me" : "other"}">${file}${text}${scam ? `<div class="small" style="color:#d32f2f;margin-top:4px">⚠️ Non mandare soldi con bonifici, ricariche o link esterni.</div>` : ""}<span class="time">${time(m.created_at)}</span></div>`;
    }).join("") || `<p class="center muted small">Scrivi qui per accordarvi su dettagli, colori, ritiro e pagamento.</p>`;
    box.querySelectorAll("[data-acc],[data-dec]").forEach((b) => (b.onclick = async () => {
      try { await rpc("chat_offer_answer", { p_offer: b.dataset.acc || b.dataset.dec, p_accept: !!b.dataset.acc }); notify(id); load(true); }
      catch (e) { toast(errText(e)); }
    }));
    if (atBottom || force) box.scrollTop = box.scrollHeight;
    rpc("request_seen", { p_id: id }).catch(() => {});
  }
  document.getElementById("f").onsubmit = async (ev) => {
    ev.preventDefault();
    const t = document.getElementById("t");
    const body = t.value.trim();
    if (!body) return;
    t.value = "";
    try { await rpc("request_message", { p_id: id, p_body: body }); notify(id); await load(true); }
    catch (e) { t.value = body; toast(errText(e)); }
  };
  await load(true);
  // Tempo reale: i messaggi nuovi arrivano subito (il controllo ogni 15 s resta di riserva)
  const channel = sb.channel("web-chat-" + id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_messages", filter: `request_id=eq.${id}` },
      () => load(true).catch(() => {}))
    .subscribe();
  cleanups.push(() => sb.removeChannel(channel));
  timers.push(setInterval(() => load(false).catch(() => {}), 15000));
}

// Avvisa l'altra persona sul telefono (stessa funzione "push" usata dall'app)
function notify(requestId) {
  if (!session?.access_token) return;
  fetch(`${SUPABASE_URL}/functions/v1/push`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
  }).catch(() => {});
}

// ---------------------------------------------------------------- Account
async function account() {
  const next = decodeURIComponent((location.hash.split("next=")[1] || "").trim()) || "#/";
  if (!isGuest()) {
    const name = session.user.email || "account";
    view.innerHTML = `<h1>Account</h1><p>Hai fatto l'accesso come <strong>${esc(name)}</strong>.</p>
      <div class="row"><a class="btn" href="#/richieste">Le mie chat</a><button class="btn ghost" id="out">Esci</button></div>
      <p class="small muted">Profilo maker, stampanti, vetrina e impostazioni si gestiscono dall'app.</p>`;
    document.getElementById("out").onclick = async () => { await sb.auth.signOut(); session = null; await ensureSession(); location.hash = "#/"; };
    return;
  }
  let mode = "login";
  const render = () => {
    view.innerHTML = `<div class="card" style="max-width:420px;margin:20px auto">
      <h1>${mode === "login" ? "Accedi" : "Crea un account"}</h1>
      <p class="muted small">Lo stesso account dell'app.</p>
      <button class="gbtn" id="g"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Continua con Google</span></button>
      <form id="f">
        ${mode === "register" ? `<label for="n">Nome</label><input id="n" type="text" required minlength="2" maxlength="60">` : ""}
        <label for="e">Email</label><input id="e" type="email" required autocomplete="email">
        <label for="p">Password</label><input id="p" type="password" required minlength="8" autocomplete="${mode === "login" ? "current-password" : "new-password"}">
        <p><button class="btn" style="width:100%">${mode === "login" ? "Accedi" : "Registrati"}</button></p>
      </form>
      <p class="small"><a href="#" id="sw">${mode === "login" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}</a></p>
      ${mode === "register" ? `<p class="small muted">Registrandoti accetti <a href="../it/termini.html">condizioni</a> e <a href="../it/privacy.html">privacy</a>.</p>` : ""}</div>`;
    document.getElementById("sw").onclick = (e) => { e.preventDefault(); mode = mode === "login" ? "register" : "login"; render(); };
    document.getElementById("g").onclick = async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
      if (error) toast(errText(error));
    };
    document.getElementById("f").onsubmit = async (ev) => {
      ev.preventDefault();
      const email = document.getElementById("e").value.trim(), password = document.getElementById("p").value;
      try {
        if (mode === "login") {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error("PP: Email o password non corrette.");
        } else {
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: document.getElementById("n").value.trim() } } });
          if (error) throw error;
          if (!data.session) { toast("Ti abbiamo mandato un'email: conferma l'indirizzo e poi accedi."); mode = "login"; return render(); }
        }
        session = (await sb.auth.getSession()).data.session;
        updateNav();
        location.hash = next;
      } catch (e) { toast(errText(e)); }
    };
  };
  render();
}

// ---------------------------------------------------------------- Nuova richiesta con file STL
function parseStl(buf) {
  const dv = new DataView(buf);
  const bin = buf.byteLength >= 84 && 84 + dv.getUint32(80, true) * 50 === buf.byteLength;
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let vol = 0;
  const tri = (p) => {
    for (let i = 0; i < 9; i += 3) {
      for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p[i + k]); b[k + 3] = Math.max(b[k + 3], p[i + k]); }
    }
    vol += (p[0] * (p[4] * p[8] - p[5] * p[7]) - p[1] * (p[3] * p[8] - p[5] * p[6]) + p[2] * (p[3] * p[7] - p[4] * p[6])) / 6;
  };
  if (bin) {
    const n = dv.getUint32(80, true);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12, p = [];
      for (let k = 0; k < 9; k++) p.push(dv.getFloat32(o + k * 4, true));
      tri(p);
    }
  } else {
    const nums = [...new TextDecoder().decode(buf).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
    for (let i = 0; i + 2 < nums.length; i += 3) tri([...nums[i], ...nums[i + 1], ...nums[i + 2]]);
  }
  if (!isFinite(b[0])) throw new Error("PP: Il file non sembra un STL valido.");
  return { x: b[3] - b[0], y: b[4] - b[1], z: b[5] - b[2], cm3: Math.abs(vol) / 1000 };
}

async function newRequest(makerId) {
  if (isGuest()) { location.hash = "#/accedi?next=" + encodeURIComponent("#/nuova/" + makerId); return; }
  const { data: m } = await sb.from("makers").select("id, display_name, offers_pickup, offers_shipping, active").eq("id", makerId).maybeSingle();
  if (!m || !m.active) { view.innerHTML = `<p class="center">Il maker è in pausa</p>`; return; }
  const { data: printers } = await sb.from("maker_printers").select("id, nickname, model_id, materials").eq("maker_id", makerId).eq("active", true);
  if (!printers?.length) { view.innerHTML = `<p class="center">Il maker è in pausa</p>`; return; }
  view.innerHTML = `<div class="card" style="max-width:560px;margin:10px auto">
    <h1>Nuova richiesta</h1><p class="muted">${esc(m.display_name)} · Il maker ti manderà prezzo e data in chat.</p>
    <form id="f">
      <label for="file">File STL</label><input id="file" type="file" accept=".stl" required>
      <p class="small muted" id="info"></p>
      <label for="pr">Stampante</label><select id="pr" style="width:100%;padding:12px;border-radius:12px">${printers.map((p) =>
        `<option value="${esc(p.id)}">${esc(p.nickname || p.model_id)}</option>`).join("")}</select>
      <label for="mat">Materiale</label><select id="mat" style="width:100%;padding:12px;border-radius:12px"></select>
      <label for="col">Colore (facoltativo)</label><input id="col" type="text" maxlength="40">
      <label for="qty">Quantità</label><input id="qty" type="number" min="1" max="50" value="1">
      <label>Consegna</label>
      <div class="row">${m.offers_pickup ? `<label class="chip"><input type="radio" name="dl" value="pickup" checked> Ritiro di persona</label>` : ""}
        ${m.offers_shipping ? `<label class="chip"><input type="radio" name="dl" value="shipping" ${m.offers_pickup ? "" : "checked"}> Spedizione</label>` : ""}</div>
      <div id="addr" hidden>
        <label for="a1">Nome e cognome</label><input id="a1" type="text" maxlength="80">
        <label for="a2">Via e numero</label><input id="a2" type="text" maxlength="120">
        <div class="row"><div class="grow"><label for="a3">CAP</label><input id="a3" type="text" maxlength="5" inputmode="numeric"></div>
          <div class="grow"><label for="a4">Città</label><input id="a4" type="text" maxlength="60"></div>
          <div style="width:90px"><label for="a5">Provincia</label><input id="a5" type="text" maxlength="2"></div></div>
        <label for="a6">Telefono (facoltativo)</label><input id="a6" type="text" maxlength="20">
      </div>
      <label for="nt">Note per il maker (facoltative)</label><textarea id="nt" maxlength="1000"></textarea>
      <p><button class="btn" id="go" style="width:100%">Invia la richiesta</button></p>
    </form></div>`;
  const $ = (s) => document.getElementById(s);
  const fillMat = () => {
    const p = printers.find((x) => x.id === $("pr").value);
    $("mat").innerHTML = (p?.materials || []).map((x) => `<option>${esc(x)}</option>`).join("");
  };
  fillMat();
  $("pr").onchange = fillMat;
  const dl = () => view.querySelector("input[name=dl]:checked")?.value || "pickup";
  view.querySelectorAll("input[name=dl]").forEach((r) => (r.onchange = () => ($("addr").hidden = dl() !== "shipping")));
  $("addr").hidden = dl() !== "shipping";
  let stl = null;
  $("file").onchange = async () => {
    stl = null;
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast("Il file supera 50 MB."); $("file").value = ""; return; }
    try {
      stl = parseStl(await f.arrayBuffer());
      $("info").textContent = `${stl.x.toFixed(1)} × ${stl.y.toFixed(1)} × ${stl.z.toFixed(1)} mm · ${stl.cm3.toFixed(1)} cm³`;
    } catch (e) { $("info").textContent = errText(e); }
  };
  $("f").onsubmit = async (ev) => {
    ev.preventDefault();
    const f = $("file").files[0];
    if (!f || !stl) return toast("Carica il file STL del pezzo.");
    const shipping = dl() === "shipping";
    if (shipping && (!$("a1").value.trim() || !$("a2").value.trim() || !/^\d{5}$/.test($("a3").value.trim()) || !$("a4").value.trim())) {
      return toast("Completa l'indirizzo di spedizione (CAP di 5 cifre).");
    }
    $("go").disabled = true;
    $("go").textContent = "Invio in corso…";
    const rid = crypto.randomUUID();
    const path = `${session.user.id}/${rid}.stl`;
    try {
      const up = await sb.storage.from("request-files").upload(path, f, { contentType: "application/octet-stream" });
      if (up.error) throw up.error;
      try {
        await rpc("create_request", {
          p_id: rid, p_maker: makerId, p_printer: $("pr").value, p_file_path: path, p_file_name: f.name, p_file_size: f.size,
          p_material: $("mat").value, p_color: $("col").value.trim(), p_quantity: Math.min(50, Math.max(1, +$("qty").value || 1)),
          p_delivery: shipping ? "shipping" : "pickup", p_notes: $("nt").value.trim(),
          p_est_volume: +stl.cm3.toFixed(2), p_size_x: +stl.x.toFixed(2), p_size_y: +stl.y.toFixed(2), p_size_z: +stl.z.toFixed(2), p_est_total: null,
          p_address: shipping ? { full_name: $("a1").value.trim(), street: $("a2").value.trim(), zip: $("a3").value.trim(),
            city: $("a4").value.trim(), province: $("a5").value.trim().toUpperCase(), phone: $("a6").value.trim() } : null,
        });
      } catch (e) { await sb.storage.from("request-files").remove([path]); throw e; }
      notify(rid);
      location.hash = `#/chat/${rid}`;
    } catch (e) {
      toast(errText(e));
      $("go").disabled = false;
      $("go").textContent = "Invia la richiesta";
    }
  };
}

// ---------------------------------------------------------------- Ordine di gruppo (link condivisi)
async function groupPage(code) {
  const g = await rpc("group_info", { p_code: code });
  if (!g) { view.innerHTML = `<p class="center">Codice del gruppo non valido.</p>`; return; }
  const missing = Math.max(0, (g.discount_min || 0) - g.total);
  view.innerHTML = `<div class="card" style="max-width:520px;margin:10px auto">
    <h1>Ordine di gruppo</h1>
    ${g.photo_path ? `<img src="${esc(photo(g.photo_path))}" alt="" style="width:100%;max-height:240px;object-fit:cover;border-radius:12px">` : ""}
    <h2>${esc(g.title)}${g.variant ? " (" + esc(g.variant) + ")" : ""}</h2>
    <p>${euro(g.price)} · ${esc(g.maker_name)}</p>
    <p><strong>${g.total} pezzi da ${g.members} persone</strong></p>
    ${g.discount_pct > 0 ? `<p>${missing === 0 ? "🎉 −" + g.discount_pct + "%" : "−" + g.discount_pct + "% … " + missing}</p>` : ""}
    ${g.status === "open" ? `<label for="q">Quantità</label><input id="q" type="number" min="1" max="50" value="${g.my_quantity || 1}">
      <p><button class="btn" id="join" style="width:100%">Partecipa</button></p>` : `<p>Il gruppo è chiuso: gli ordini sono partiti.</p>`}
    <p class="small muted">${esc(g.code)}</p></div>`;
  const j = document.getElementById("join");
  if (j) j.onclick = async () => {
    if (needAccount()) return;
    try { await rpc("group_join", { p_code: g.code, p_quantity: Math.min(50, Math.max(1, +document.getElementById("q").value || 1)) }); toast("✓"); groupPage(code); }
    catch (e) { toast(errText(e)); }
  };
}

// ---------------------------------------------------------------- avvio
sb.auth.onAuthStateChange((_e, s) => { session = s; updateNav(); });
initI18n();
await ensureSession();
route();
