# ARV & Rehab — OLT module bundle for rebuilt-training

This directory contains a drop-in OLT module built from the arv-quiz sources
in the repo root.

## Files

- `olt_arv_rehab.html` — single self-contained module (matches the convention
  used by the other OLT modules in `mikespalding/rebuilt-training`; all CSS/JS
  inlined, `properties.json` and `performance-data.json` embedded as
  `<script type="application/json">` blobs, Supabase + jsPDF loaded from CDN).
- `rebuilt-training-index.patch` — 2-line insertion into
  `rebuilt-training/index.html` that registers the module in `OLT_MODULES`.

## How to install in rebuilt-training

```bash
git clone https://github.com/mikespalding/rebuilt-training.git
cd rebuilt-training
git checkout -b add-arv-rehab-module

# drop in the module file
cp /path/to/arv-quiz/dist/olt_arv_rehab.html .

# register it in the landing page
git apply /path/to/arv-quiz/dist/rebuilt-training-index.patch

git add olt_arv_rehab.html index.html
git commit -m "Add ARV & Rehab OLT module"
git push -u origin add-arv-rehab-module
```

Then open a PR in rebuilt-training.

## Rebuilding

The module is regenerated from `app.js`, `styles.css`, `properties.json`, and
`performance-data.json` in the repo root:

```bash
python3 build-olt-module.py
```

Rerun whenever the source files change.
