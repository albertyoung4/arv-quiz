#!/usr/bin/env python3
"""
Build a single-file OLT module HTML from the split arv-quiz sources.

Inputs (repo root):
  - styles.css
  - app.js
  - properties.json
  - performance-data.json

Output:
  - dist/olt_arv_rehab.html

The output is a drop-in module for mikespalding/rebuilt-training: inline CSS,
inline JSON (via <script type="application/json">), inline JS. External CDN
scripts (Supabase, jsPDF) and Google Fonts are kept, matching the convention
used by existing OLT modules in that repo.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

MODULE_TITLE = "ARV & Rehab — Rebuilt Training"


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def sanitize_for_script(text: str) -> str:
    # Defensive: prevent an early </script> from closing the host <script> tag.
    return text.replace("</script", "<\\/script")


styles_css = read("styles.css")
app_js = sanitize_for_script(read("app.js"))
properties_json = sanitize_for_script(read("properties.json"))
performance_json = sanitize_for_script(read("performance-data.json"))

HEADER_MARKUP = """  <header class="site-header">
    <div class="header-inner">
      <div class="header-logo">
        <svg viewBox="104.2 2 277.4 497.8" width="20" height="35" xmlns="http://www.w3.org/2000/svg">
          <polygon fill="#22a9e1" points="104.2,490.8 185.8,409.2 185.8,262.3 104.2,335.7"/>
          <polygon fill="#22a9e1" points="300,2 300,409.2 381.6,490.7 381.6,74.6"/>
          <polygon fill="#22a9e1" points="202.1,172.5 202.1,392.8 242.9,352 283.7,392.8 284,91.7"/>
          <rect x="202.1" y="467.2" fill="#22a9e1" width="32.6" height="32.6"/>
          <rect x="251" y="467.2" fill="#22a9e1" width="32.6" height="32.6"/>
          <rect x="202.1" y="418.2" fill="#22a9e1" width="32.6" height="32.6"/>
          <rect x="251" y="418.2" fill="#22a9e1" width="32.6" height="32.6"/>
        </svg>
        <span class="header-brand">rebuilt</span>
      </div>
      <nav class="main-nav" id="main-nav"></nav>
      <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu" aria-expanded="false">
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>
    </div>
    <div class="mobile-nav-panel" id="mobile-nav-panel"></div>
  </header>"""

FETCH_SHIM = """  <script>
    // Fetch shim: serve the embedded JSON blobs for the two data files the
    // quiz normally loads over HTTP. Everything else falls through to the real
    // fetch (Supabase, HouseCanary photos, etc).
    (function () {
      var origFetch = window.fetch.bind(window);
      var cache = {};
      function payload(id) {
        if (cache[id] !== undefined) return cache[id];
        var el = document.getElementById(id);
        cache[id] = el ? el.textContent : null;
        return cache[id];
      }
      var mapping = [
        { match: 'performance-data.json', id: 'embedded-performance-data' },
        { match: 'properties.json',       id: 'embedded-properties' }
      ];
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        for (var i = 0; i < mapping.length; i++) {
          if (url.indexOf(mapping[i].match) !== -1) {
            var body = payload(mapping[i].id);
            if (body != null) {
              return Promise.resolve(new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              }));
            }
          }
        }
        return origFetch(input, init);
      };
    })();
  </script>"""

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{MODULE_TITLE}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#127968;</text></svg>">
  <style>
{styles_css}
  </style>
</head>
<body>
{HEADER_MARKUP}

  <div id="app"></div>

  <script id="embedded-properties" type="application/json">
{properties_json}
  </script>
  <script id="embedded-performance-data" type="application/json">
{performance_json}
  </script>

{FETCH_SHIM}

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>

  <script>
{app_js}
  </script>
</body>
</html>
"""

out = DIST / "olt_arv_rehab.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size:,} bytes)")
