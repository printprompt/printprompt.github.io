// PrintPrompt · cruscotto admin sul sito (miglioria 83).
// Usa la stessa chiave pubblica dell'app: i dati li proteggono le funzioni del database,
// che rispondono solo a chi è amministratore (e, se attivo, ha inserito il codice a due fattori).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_KEY } from "../app/config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: "pp-admin" } });
const view = document.getElementById("view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const euro = (n) => (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

async function rpc(name, params = {}) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw new Error(String(error.message || error).replace(/^PP:\s*/, ""));
  return data;
}

// ---------- Accesso ----------
function loginForm(msg = "") {
  view.innerHTML = `
    <div class="card" style="max-width:420px;margin:30px auto">
      <h1>Cruscotto admin</h1>
      <p class="muted small">Entra con l'account amministratore dell'app.</p>
      ${msg ? `<p class="small" style="color:var(--bad)">${esc(msg)}</p>` : ""}
      <form id="f">
        <label for="e">Email</label><input id="e" type="email" autocomplete="username" required>
        <label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>
        <p><button class="btn" type="submit">Entra</button></p>
      </form>
    </div>`;
  document.getElementById("f").onsubmit = async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: document.getElementById("e").value.trim(), password: document.getElementById("p").value });
    if (error) return loginForm("Email o password sbagliate.");
    start();
  };
}

function mfaForm(factorId, msg = "") {
  view.innerHTML = `
    <div class="card" style="max-width:420px;margin:30px auto">
      <h1>Codice a due fattori</h1>
      <p class="muted small">Scrivi il codice di 6 cifre dell'app di autenticazione.</p>
      ${msg ? `<p class="small" style="color:var(--bad)">${esc(msg)}</p>` : ""}
      <form id="f"><input id="c" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required>
      <p><button class="btn" type="submit">Verifica</button></p></form>
    </div>`;
  document.getElementById("f").onsubmit = async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: document.getElementById("c").value.trim() });
    if (error) return mfaForm(factorId, "Codice non valido: riprova.");
    start();
  };
}

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginForm();
  document.getElementById("logout").hidden = false;
  let me;
  try { me = await rpc("me"); } catch (e) { return loginForm(e.message); }
  if (me.admin_mfa === "needed") {
    const { data } = await sb.auth.mfa.listFactors();
    const f = (data?.totp ?? []).find((x) => x.status === "verified");
    if (f) return mfaForm(f.id);
  }
  if (!me.is_admin) {
    view.innerHTML = `<div class="card center"><h1>Accesso negato</h1><p class="muted">Questo account non è amministratore.</p></div>`;
    return;
  }
  dashboard();
}

document.getElementById("logout").onclick = async (ev) => { ev.preventDefault(); await sb.auth.signOut(); location.reload(); };

// ---------- Cruscotto ----------
const TABS = [
  ["overview", "Panoramica"], ["growth", "Crescita"], ["users", "Utenti"],
  ["disputes", "Contestazioni"], ["flags", "Funzioni"], ["log", "Registro"],
];

function dashboard(tab = location.hash.slice(1) || "overview") {
  view.innerHTML = `<h1>Cruscotto</h1>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <section id="body"><p class="muted">Carico…</p></section>`;
  view.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { location.hash = b.dataset.t; dashboard(b.dataset.t); }));
  const body = document.getElementById("body");
  const run = { overview, growth, users, disputes, flags, log }[tab] ?? overview;
  run(body).catch((e) => (body.innerHTML = `<p style="color:var(--bad)">${esc(e.message)}</p>`));
}

function kpi(label, value) { return `<div class="kpi"><span class="muted small">${esc(label)}</span><b>${esc(value)}</b></div>`; }

function bars(title, points, fmt = (v) => v) {
  const max = Math.max(1, ...points.map((p) => p.v));
  const w = 100 / Math.max(points.length, 1);
  const rects = points.map((p, i) => {
    const h = Math.max(1, (p.v / max) * 130);
    return `<rect x="${i * w + w * 0.12}" y="${140 - h}" width="${w * 0.76}" height="${h}" rx="1"><title>${esc(p.label)}: ${esc(fmt(p.v))}</title></rect>`;
  }).join("");
  const last = points.at(-1);
  return `<div class="card chart"><b>${esc(title)}</b>
    <svg viewBox="0 0 100 142" preserveAspectRatio="none" role="img" aria-label="${esc(title)}">${rects}</svg>
    <div class="row small muted"><span>${esc(points[0]?.label ?? "")}</span><span class="grow"></span><span>ultima settimana: ${esc(fmt(last?.v ?? 0))}</span></div></div>`;
}

async function overview(body) {
  const [s, f] = await Promise.all([rpc("admin_stats"), rpc("admin_funnel", { p_days: 30 })]);
  const steps = [["Hanno aperto l'app", f.opened], ["Hanno cercato", f.searched], ["Hanno visto un maker", f.viewed_maker],
    ["Hanno caricato un file", f.loaded_file], ["Hanno inviato una richiesta", f.sent_request], ["Hanno ricevuto un'offerta", f.got_offer],
    ["Hanno accettato", f.accepted], ["Hanno ricevuto la stampa", f.completed]];
  const top = Math.max(1, steps[0][1]);
  body.innerHTML = `
    <div class="kpis">
      ${kpi("Iscritti", s.users_total)}${kpi("Nuovi in 7 giorni", s.users_7d)}${kpi("Nuovi in 30 giorni", s.users_30d)}
      ${kpi("Maker visibili", s.makers_visible)}${kpi("Maker in pausa", s.makers_paused)}${kpi("Stampanti", s.printers_total)}
      ${kpi("Modelli da approvare", s.models_pending)}${kpi("Account sospesi", s.users_suspended)}
    </div>
    <h2>Imbuto degli ultimi 30 giorni</h2>
    <div class="card">${steps.map(([l, v]) => `
      <div class="row small" style="margin:6px 0"><span style="width:220px">${esc(l)}</span>
      <span class="grow" style="background:var(--chip);border-radius:6px;height:14px;position:relative">
        <span style="position:absolute;inset:0 auto 0 0;width:${(100 * v) / top}%;background:var(--accent);border-radius:6px"></span></span>
      <b style="width:60px;text-align:right">${esc(v)}</b></div>`).join("")}</div>`;
}

async function growth(body) {
  const weeks = await rpc("admin_growth", { p_weeks: 12 });
  const lab = (w) => w.week.slice(5).replace("-", "/");
  const g = (k) => weeks.map((w) => ({ label: lab(w), v: Number(w[k]) || 0 }));
  const req = weeks.reduce((a, w) => a + w.requests, 0), acc = weeks.reduce((a, w) => a + w.accepted, 0), done = weeks.reduce((a, w) => a + w.completed, 0);
  body.innerHTML = `
    <div class="charts">
      ${bars("Iscritti", g("signups"))}${bars("Persone attive", g("active_users"))}${bars("Nuovi maker", g("new_makers"))}
      ${bars("Richieste", g("requests"))}${bars("Consegnate", g("completed"))}${bars("Valore consegnato", g("value_eur"), euro)}
      ${bars("Creazioni AI", g("ai_creations"))}
    </div>
    <h2>Conversione in 12 settimane</h2>
    <p>${req} richieste → ${acc} accettate (${req ? Math.round((100 * acc) / req) : 0}%) → ${done} consegnate (${req ? Math.round((100 * done) / req) : 0}%)</p>
    <div class="scroll"><table><thead><tr><th>Settimana</th><th class="num">Iscritti</th><th class="num">Attivi</th><th class="num">Richieste</th>
      <th class="num">Accettate</th><th class="num">Consegnate</th><th class="num">Valore</th></tr></thead><tbody>
      ${weeks.map((w) => `<tr><td>${esc(w.week)}</td><td class="num">${w.signups}</td><td class="num">${w.active_users}</td><td class="num">${w.requests}</td>
        <td class="num">${w.accepted}</td><td class="num">${w.completed}</td><td class="num">${euro(w.value_eur)}</td></tr>`).join("")}
    </tbody></table></div>`;
}

async function users(body, q = "") {
  const list = await rpc("admin_users", { p_query: q || null, p_limit: 200 });
  body.innerHTML = `
    <form id="s" class="searchbar"><input type="search" id="q" placeholder="Cerca per email o nome" value="${esc(q)}"><button class="btn">Cerca</button></form>
    <p class="muted small">${list.length} risultati (al massimo 200, dai più recenti).</p>
    <div class="scroll"><table><thead><tr><th>Nome</th><th>Email</th><th>Iscritto</th><th>Ultima apertura</th><th>Ruolo</th><th class="num">Richieste</th><th>Stato</th></tr></thead><tbody>
      ${list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${fmtDate(u.created_at)}</td><td>${esc(u.last_seen ?? "—")}</td>
        <td>${u.is_maker ? '<span class="chip dark">Maker</span>' : '<span class="chip">Cliente</span>'}</td><td class="num">${u.requests}</td>
        <td>${u.suspended ? '<span class="chip" style="color:var(--bad)">Sospeso</span>' : ""}</td></tr>`).join("")}
    </tbody></table></div>`;
  document.getElementById("s").onsubmit = (ev) => { ev.preventDefault(); users(body, document.getElementById("q").value.trim()); };
}

const KIND = { defect: "Pezzo difettoso", not_delivered: "Non consegnato", not_as_described: "Diverso dal concordato", late: "In ritardo",
  no_show: "Non presentato al ritiro", payment: "Pagamento", other: "Altro" };

async function disputes(body) {
  const list = await rpc("admin_disputes", { p_open: true });
  body.innerHTML = `<p class="muted small">Contestazioni aperte. Per decidere usa l'app (Admin → Contestazioni): lì vedi anche la chat della richiesta.</p>
    ${list.length === 0 ? '<p class="muted">Nessuna contestazione aperta.</p>' : ""}
    <div class="list">${list.map((d) => `<div class="card"><b>${esc(KIND[d.kind] ?? d.kind)} · ${esc(d.file_name)}</b>
      <p>${esc(d.description)}</p>
      <p class="small muted">Aperta da ${esc(d.opened_by_name)} (${esc(d.opened_by_role)}) · ${fmtDate(d.created_at)}<br>
      Cliente: ${esc(d.customer_name)} ${esc(d.customer_email ?? "")} · Maker: ${esc(d.maker_name)} ${esc(d.maker_email ?? "")}<br>
      Offerta: ${d.offer_price != null ? euro(d.offer_price) : "—"} · stato: ${esc(d.request_status)}</p></div>`).join("")}</div>`;
}

async function flags(body) {
  const list = await rpc("admin_flags");
  body.innerHTML = `<p class="muted small">Accendi o spegni parti dell'app per tutti, senza pubblicare un aggiornamento: i telefoni le leggono quando l'app si apre.</p>
    <div class="card">${list.map((f) => `<div class="flag">
      <div class="grow"><b>${esc(f.key)}</b><div class="small muted">${esc(f.note)}</div>
        ${["min_version", "app_notice"].includes(f.key) ? `<input type="text" data-v="${esc(f.key)}" value="${esc(f.value)}" placeholder="valore" style="margin-top:6px">` : ""}</div>
      <label class="row small" style="margin:0"><input type="checkbox" data-k="${esc(f.key)}" ${f.enabled ? "checked" : ""}> attiva</label></div>`).join("")}</div>`;
  body.querySelectorAll("input[data-k]").forEach((cb) => (cb.onchange = async () => {
    const v = body.querySelector(`input[data-v="${cb.dataset.k}"]`);
    try { await rpc("admin_flag_set", { p_key: cb.dataset.k, p_enabled: cb.checked, p_value: v ? v.value.trim() : null }); toast("Salvato"); }
    catch (e) { toast(e.message); cb.checked = !cb.checked; }
  }));
  body.querySelectorAll("input[data-v]").forEach((inp) => (inp.onchange = async () => {
    try { await rpc("admin_flag_set", { p_key: inp.dataset.v, p_enabled: null, p_value: inp.value.trim() }); toast("Valore salvato"); }
    catch (e) { toast(e.message); }
  }));
}

async function log(body) {
  const list = await rpc("admin_log_list", { p_limit: 300 });
  body.innerHTML = `<p class="muted small">Ogni modifica fatta da un admin, dalla più recente.</p>
    <div class="scroll"><table><thead><tr><th>Quando</th><th>Chi</th><th>Azione</th><th>Su cosa</th><th>Dettagli</th></tr></thead><tbody>
    ${list.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td>${esc(r.admin_name)}</td><td>${esc(r.action)}</td><td><code>${esc(r.target)}</code></td>
      <td><code>${esc(JSON.stringify(r.details)).slice(0, 400)}</code></td></tr>`).join("")}
    </tbody></table></div>`;
}

start();
