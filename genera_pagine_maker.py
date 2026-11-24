"""
PrintPrompt · pagine web dei maker (per farsi trovare su Google).

Legge dal database i maker attivi (solo i dati già pubblici nell'app) e crea:
  sito/maker/index.html          elenco dei maker per città
  sito/maker/<id>.html           una pagina per maker, con link per aprirlo nell'app
  sito/citta/<città>.html        "Stampa 3D a <città>": i maker di quella città (per Google)
  sito/sitemap.xml, sito/robots.txt

Uso (dalla cartella PrintPrompt):   python sito/genera_pagine_maker.py
Poi pubblica la cartella "sito" come al solito su GitHub Pages.
Rifallo ogni tanto (per esempio una volta alla settimana) per aggiornare le pagine.
Serve aver eseguito supabase/14_migliorie.sql.
"""
import datetime
import html
import json
import os
import re
import sys
import urllib.request

BASE = "https://printprompt.github.io"
PLAY = "https://play.google.com/store/apps/details?id=com.printprompt.app"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(ROOT, "app/src/main/java/com/printprompt/app/data/SupabaseConfig.kt")


def config():
    text = open(CONFIG, encoding="utf-8").read()
    url = re.search(r'URL\s*=\s*"([^"]+)"', text).group(1)
    key = re.search(r'PUBLISHABLE_KEY\s*=\s*"([^"]+)"', text).group(1)
    return url, key


def rpc_post(url, key, name):
    req = urllib.request.Request(
        url + "/rest/v1/rpc/" + name,
        data=b"{}",
        headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def handle_pages(makers, url, key):
    """Link personali: sito/<nome>/index.html per ogni maker che ha scelto un nome."""
    listing = os.path.join(HERE, ".link_personali")
    old = set(open(listing, encoding="utf-8").read().split()) if os.path.exists(listing) else set()
    try:
        handles = rpc_post(url, key, "public_maker_handles")
    except Exception:  # noqa: BLE001
        handles = []
    by_id = {m["id"]: m for m in makers}
    taken = set(os.listdir(HERE)) - old
    made = set()
    for h in handles:
        name = (h.get("handle") or "").lower()
        m = by_id.get(h.get("id"))
        if not m or not re.match(r"^[a-z0-9][a-z0-9-]{2,29}$", name) or name in taken:
            continue
        folder = os.path.join(HERE, name)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "index.html"), "w", encoding="utf-8") as f:
            f.write(maker_page(m, url))
        made.add(name)
    for name in old - made:
        page = os.path.join(HERE, name, "index.html")
        if os.path.exists(page):
            os.remove(page)
        try:
            os.rmdir(os.path.join(HERE, name))
        except OSError:
            pass
    with open(listing, "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(made)))
    return sorted(made)


def fetch_makers(url, key):
    req = urllib.request.Request(
        url + "/rest/v1/rpc/public_maker_pages",
        data=b"{}",
        headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


E = html.escape


def head(title, desc, path, extra=""):
    return f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{BASE}/{path}">
<link rel="icon" href="../icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../style.css">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
{extra}
</head>
<body>
<header class="top">
  <div class="bar">
    <a class="brand" href="../it/index.html"><img src="../icon.svg" alt="" width="32" height="32"><span>PrintPrompt</span></a>
  </div>
  <nav class="menu"><a href="../it/index.html">Home</a><a href="index.html">Maker</a></nav>
</header>
<main id="main" class="page">
"""


FOOT = """</main>
<footer class="page small"><p>PrintPrompt · stampe 3D vicino a te</p></footer>
</body>
</html>
"""


def maker_page(m, url):
    name = m["display_name"]
    city = m.get("city") or ""
    techs = ", ".join("filamento (FDM)" if t == "FDM" else "resina" for t in (m.get("technologies") or []))
    mats = ", ".join(m.get("materials") or [])
    rating = m.get("rating_avg")
    count = m.get("rating_count") or 0
    delivery = " e ".join(x for x, ok in (("ritiro di persona", m.get("offers_pickup")), ("spedizione", m.get("offers_shipping"))) if ok)
    title = f"{name} · stampa 3D a {city}" if city else f"{name} · stampa 3D"
    desc = f"{name} stampa in 3D{(' a ' + city) if city else ''}: {techs or 'stampa 3D'}" + (f", materiali {mats}" if mats else "") + ". Chiedi un preventivo con PrintPrompt."
    avatar = f"{url}/storage/v1/object/public/printer-photos/{m['avatar_path']}" if m.get("avatar_path") else None
    ld = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": name,
        "description": (m.get("bio") or desc)[:300],
        "url": f"{BASE}/maker/{m['id']}.html",
    }
    if city:
        ld["address"] = {"@type": "PostalAddress", "addressLocality": city, "addressCountry": "IT"}
    if avatar:
        ld["image"] = avatar
    if rating and count:
        ld["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": float(rating), "reviewCount": int(count)}
    extra = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'

    out = [head(title, desc, f"maker/{m['id']}.html", extra), '<section class="card">']
    if avatar:
        out.append(f'<img src="{E(avatar)}" alt="" width="96" height="96" style="border-radius:50%;object-fit:cover">')
    out.append(f"<h1>{E(name)}{' ✔' if m.get('verified') else ''}</h1>")
    if city:
        out.append(f"<p><strong>{E(city)}</strong></p>")
    if rating and count:
        out.append(f"<p>★ {float(rating):.1f} su 5 · {int(count)} recensioni</p>")
    if m.get("bio"):
        out.append(f"<p>{E(m['bio'])}</p>")
    out.append("<ul>")
    out.append(f"<li>Stampanti: {int(m.get('printer_count') or 0)}{(' · ' + E(techs)) if techs else ''}</li>")
    if mats:
        out.append(f"<li>Materiali: {E(mats)}</li>")
    if delivery:
        out.append(f"<li>Consegna: {E(delivery)}</li>")
    out.append("</ul>")
    out.append(f'<p><a class="btn" href="../app/#/m/{E(m["id"])}">Scrivi a {E(name)} o mandagli un file STL</a></p>')
    out.append(f'<p><a href="../m/?id={E(m["id"])}">Apri {E(name)} nell\'app</a></p>')
    out.append(f'<p class="small">Non hai l\'app? <a href="{PLAY}">Scaricala da Google Play</a>: carichi il file STL e vedi subito prezzo e tempi.</p>')
    out.append("</section>")
    out.append(FOOT)
    return "\n".join(out)


def slug(text):
    import unicodedata
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-") or "altre"


def city_groups(makers):
    by_city = {}
    for m in makers:
        c = (m.get("city") or "").strip()
        if c:
            by_city.setdefault(c.title(), []).append(m)
    return by_city


def city_page(city, makers, url):
    n = len(makers)
    title = f"Stampa 3D a {city} · {n} maker vicino a te | PrintPrompt"
    desc = (f"Cerchi chi stampa in 3D a {city}? {n} maker con stampanti a filamento e resina: "
            "manda il file STL, ricevi prezzo e data, ritira di persona o in spedizione.")
    ld = {"@context": "https://schema.org", "@type": "ItemList", "name": f"Stampa 3D a {city}",
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{BASE}/maker/{m['id']}.html", "name": m["display_name"]}
                              for i, m in enumerate(makers)]}
    out = [head(title, desc, f"citta/{slug(city)}.html", f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'),
           f'<section class="card"><h1>Stampa 3D a {E(city)}</h1>',
           f"<p>{n} maker di PrintPrompt {'stampa' if n == 1 else 'stampano'} a {E(city)} o nei dintorni. Scegline uno, mandagli il file STL "
           "(o chiedi all'AI di disegnare il pezzo nell'app) e accordatevi in chat su prezzo, colori e ritiro.</p><ul>"]
    for m in sorted(makers, key=lambda x: (-(x.get("rating_count") or 0), x["display_name"].lower())):
        mats = ", ".join((m.get("materials") or [])[:5])
        rating = f" · ★ {float(m['rating_avg']):.1f} ({int(m['rating_count'])})" if m.get("rating_avg") and m.get("rating_count") else ""
        out.append(f'<li><a href="../maker/{E(m["id"])}.html"><strong>{E(m["display_name"])}</strong></a>{rating}'
                   f'{(" · " + E(mats)) if mats else ""} · <a href="../app/#/m/{E(m["id"])}">scrivigli</a></li>')
    out.append("</ul>")
    out.append('<p><a class="btn" href="../app/">Cerca sulla mappa</a></p>')
    out.append(f'<p class="small">Con l\'app Android vedi subito una stima del prezzo: <a href="{PLAY}">scaricala da Google Play</a>.</p>')
    out.append("</section>")
    out.append(FOOT)
    return "\n".join(out).replace('href="index.html">Maker', 'href="../maker/index.html">Maker')


def index_page(makers):
    by_city = {}
    for m in makers:
        by_city.setdefault((m.get("city") or "Altre città").strip() or "Altre città", []).append(m)
    out = [head("Maker di stampa 3D in Italia · PrintPrompt",
                "Trova chi stampa in 3D vicino a te: maker con stampanti a filamento e resina, prezzi e recensioni.",
                "maker/index.html"),
           '<section class="card"><h1>Maker di stampa 3D</h1>']
    for city in sorted(by_city, key=str.lower):
        link = f' · <a href="../citta/{slug(city)}.html">tutti i maker di {E(city)}</a>' if city != "Altre città" else ""
        out.append(f"<h2>{E(city)}</h2><p class=\"small\">{link.lstrip(' ·')}</p><ul>" if link else f"<h2>{E(city)}</h2><ul>")
        for m in by_city[city]:
            out.append(f'<li><a href="{E(m["id"])}.html">{E(m["display_name"])}</a></li>')
        out.append("</ul>")
    out.append("</section>")
    out.append(FOOT)
    return "\n".join(out)


def main():
    url, key = config()
    try:
        makers = fetch_makers(url, key)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Non riesco a leggere i maker: {e}\nHai eseguito supabase/14_migliorie.sql?")

    out_dir = os.path.join(HERE, "maker")
    os.makedirs(out_dir, exist_ok=True)
    keep = set()
    for m in makers:
        name = f"{m['id']}.html"
        keep.add(name)
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            f.write(maker_page(m, url))
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(index_page(makers))
    # pagine di maker non più attivi: via
    for f in os.listdir(out_dir):
        if f.endswith(".html") and f != "index.html" and f not in keep:
            os.remove(os.path.join(out_dir, f))

    city_dir = os.path.join(HERE, "citta")
    os.makedirs(city_dir, exist_ok=True)
    cities = city_groups(makers)
    keep_c = set()
    for city, ms in cities.items():
        name = slug(city) + ".html"
        keep_c.add(name)
        with open(os.path.join(city_dir, name), "w", encoding="utf-8") as f:
            f.write(city_page(city, ms, url))
    for f in os.listdir(city_dir):
        if f.endswith(".html") and f not in keep_c:
            os.remove(os.path.join(city_dir, f))

    handles = handle_pages(makers, url, key)

    today = datetime.date.today().isoformat()
    urls = [f"{BASE}/{lang}/{p}" for lang in ("it", "en", "es") for p in ("index.html", "privacy.html", "termini.html")]
    urls.append(f"{BASE}/maker/index.html")
    urls += [f"{BASE}/maker/{m['id']}.html" for m in makers]
    urls += [f"{BASE}/citta/{slug(c)}.html" for c in cities]
    urls += [f"{BASE}/{h}/" for h in handles]
    urls.append(f"{BASE}/app/")
    with open(os.path.join(HERE, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u in urls:
            f.write(f"  <url><loc>{E(u)}</loc><lastmod>{today}</lastmod></url>\n")
        f.write("</urlset>\n")
    with open(os.path.join(HERE, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: {BASE}/sitemap.xml\n")
    print(f"Fatto: {len(makers)} pagine maker, {len(cities)} pagine città, {len(handles)} link personali, sitemap con {len(urls)} indirizzi.")


if __name__ == "__main__":
    main()
