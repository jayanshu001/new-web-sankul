#!/usr/bin/env python3
"""
Reconcile the shipped Postman collection with the REAL Express router tree.

  drop  — requests whose route no longer exists (drift)
  dedupe— duplicate method+path entries (keeps the richest copy)
  add   — routes the server serves that the collection never had

Existing bodies / tests / descriptions are preserved untouched; new items copy
their auth + headers from a sibling in the same folder so they look native.
"""
import json, re, sys
from pathlib import Path
from collections import defaultdict

ROOT_ = Path(__file__).resolve().parent.parent
ROOT = ROOT_
COLL = ROOT / "docs/postman/WebSankul-Complete-2026.postman_collection.json"

real = json.loads((ROOT / "docs/postman/routes.generated.json").read_text())

def norm(p: str) -> str:
    p = p.split("?")[0].rstrip("/")
    p = re.sub(r"^/api/v1", "", p)
    p = re.sub(r"\{\{[^}]+\}\}", ":p", p)
    p = re.sub(r":[A-Za-z0-9_]+", ":p", p)
    p = re.sub(r"//+", "/", p)
    return p or "/"

real_by_key = {}
for r in real:
    real_by_key[(r["method"], norm(r["path"]))] = r["path"]
real_set = set(real_by_key)

coll = json.loads(COLL.read_text())

def item_key(it):
    req = it.get("request") or {}
    url = req.get("url") or {}
    raw = url.get("raw") if isinstance(url, dict) else url
    if not raw:
        raw = "/" + "/".join(url.get("path") or [])
    raw = re.sub(r"^\{\{[^}]+\}\}", "", str(raw))
    raw = re.sub(r"^https?://[^/]+", "", raw)
    return ((req.get("method") or "GET").upper(), norm(raw))

def richness(it):
    """Prefer the copy carrying the most hand-written value."""
    req = it.get("request") or {}
    return (
        len(json.dumps(req.get("body") or "")),
        len(json.dumps(it.get("event") or "")),
        len(req.get("description") or ""),
        len((req.get("url") or {}).get("query") or []) if isinstance(req.get("url"), dict) else 0,
    )

# ── pass 1: drop stale + dedupe ────────────────────────────────────────────
seen = {}
dropped_stale, dropped_dupe = [], []

def prune(node, trail):
    keep = []
    for it in node:
        if "item" in it:
            prune(it["item"], trail + [it.get("name", "")])
            if it["item"]:
                keep.append(it)
            continue
        k = item_key(it)
        if k not in real_set:
            dropped_stale.append((k, " / ".join(trail), it.get("name", "")))
            continue
        if k in seen:
            prev_it, prev_node = seen[k]
            if richness(it) > richness(prev_it):
                prev_node[:] = [x for x in prev_node if x is not prev_it]
                dropped_dupe.append((k, it.get("name", "")))
                seen[k] = (it, keep)
                keep.append(it)
            else:
                dropped_dupe.append((k, it.get("name", "")))
            continue
        seen[k] = (it, keep)
        keep.append(it)
    node[:] = keep

prune(coll["item"], [])

# ── pass 2: add missing ────────────────────────────────────────────────────
missing = sorted(real_set - set(seen))

# index folders by the path prefixes their items already cover
folders = []
def index(node, trail):
    for it in node:
        if "item" in it:
            index(it["item"], trail + [it])
        else:
            if trail:
                folders.append((trail[-1], item_key(it)[1], trail[0]))
index(coll["item"], [])

folder_paths = defaultdict(list)
top_of = {}
for fobj, path, top in folders:
    folder_paths[id(fobj)].append(path)
    top_of[id(fobj)] = (fobj, top)

def common_len(a, b):
    sa, sb = [s for s in a.split("/") if s], [s for s in b.split("/") if s]
    n = 0
    for x, y in zip(sa, sb):
        if x != y: break
        n += 1
    return n

SURFACE = {"client": "CLIENT", "admin": "ADMIN", "educator": "EDUCATOR", "promoter": "PROMOTER"}

def pick_folder(path):
    seg = [s for s in path.split("/") if s]
    surface = SURFACE.get(seg[0]) if seg else None
    best, best_score = None, 0
    for fid, paths in folder_paths.items():
        fobj, top = top_of[fid]
        if surface and not top.get("name", "").startswith(surface):
            continue
        score = max(common_len(path, p) for p in paths)
        if score > best_score:
            best, best_score = fobj, score
    return best if best_score >= 2 else None

INFRA = {"name": "🌐 PUBLIC & INFRA (no /api/v1 prefix)",
         "description": "Health probes, metrics, deep-link association files, public share pages, "
                        "demo pages and the Razorpay payout webhook. These sit OUTSIDE /api/v1, so they "
                        "use {{host}} rather than {{base_url}}.",
         "item": []}

def sibling_template(folder):
    for it in folder.get("item", []):
        if "request" in it:
            return it
    return None

def make_item(method, npath, realpath, folder):
    tmpl = sibling_template(folder) if folder else None
    is_api = realpath.startswith("/api/v1")
    tail = re.sub(r"^/api/v1", "", realpath).lstrip("/")
    if is_api:
        raw = "{{base_url}}/" + tail
        host = ["{{base_url}}"]
        segs = tail.split("/")
    else:
        raw = "{{host}}" + realpath
        host = ["{{host}}"]
        segs = [s for s in realpath.split("/") if s]
    req = {
        "method": method,
        "header": [{"key": "Content-Type", "value": "application/json"}] if method in ("POST", "PUT", "PATCH") else [],
        "url": {"raw": raw, "host": host, "path": segs},
        "description": f"Auto-added from the live Express router tree ({method} {realpath}). "
                       "Request body not auto-derived — fill in from the Zod validator.",
    }
    if not is_api:
        req["auth"] = {"type": "noauth"}
    elif tmpl and (tmpl.get("request") or {}).get("auth"):
        req["auth"] = json.loads(json.dumps(tmpl["request"]["auth"]))
    if method in ("POST", "PUT", "PATCH"):
        req["body"] = {"mode": "raw", "raw": "{}", "options": {"raw": {"language": "json"}}}
    pretty = " ".join(w.capitalize() if not w.startswith(":") else f"<{w[1:]}>"
                      for w in (segs[-1] if segs else "root").replace("-", " ").split())
    return {"name": f"{method} {pretty or 'Root'}  ·  /{tail if is_api else realpath.lstrip('/')}",
            "request": req, "response": []}

# Surface folders, so a brand-new module gets a real home instead of INFRA.
surface_folder = {}
for top in coll["item"]:
    for k, v in SURFACE.items():
        if top.get("name", "").startswith(v):
            surface_folder[k] = top

NEW_FOLDER_NAME = {
    "cache": "🧹 Admin Cache",
    "downloads": "⬇️ Client Downloads",
    "webhooks": "🪝 Webhooks (HMAC, not Bearer)",
}
created = {}

def new_module_folder(npath):
    """No existing folder covers this path — make one under the right surface."""
    seg = [x for x in npath.split("/") if x]
    if not seg:
        return None
    surface, mod = seg[0], (seg[1] if len(seg) > 1 else seg[0])
    if surface == "webhooks":
        key = "webhooks"
        parent = coll
    elif surface in surface_folder:
        key = f"{surface}/{mod}"
        parent = surface_folder[surface]
    else:
        return None
    if key in created:
        return created[key]
    name = NEW_FOLDER_NAME.get(mod if surface != "webhooks" else "webhooks",
                               f"📁 {SURFACE.get(surface, surface).title()} {mod.replace('-', ' ').title()}")
    folder = {"name": name, "description": "Added from the live router tree.", "item": []}
    parent.setdefault("item", []).append(folder)
    created[key] = folder
    return folder

added = []
for method, npath in missing:
    realpath = real_by_key[(method, npath)]
    folder = pick_folder(npath)
    if folder is None and realpath.startswith("/api/v1"):
        folder = new_module_folder(npath)
    if folder is None:
        folder = INFRA
    folder.setdefault("item", []).append(make_item(method, npath, realpath, folder))
    added.append((method, realpath, folder.get("name", "?")))

if INFRA["item"]:
    coll["item"].append(INFRA)

# ── report + write ─────────────────────────────────────────────────────────
def count(items):
    return sum(count(i["item"]) if "item" in i else 1 for i in items)

print(f"real routes served : {len(real_set)}")
print(f"dropped stale      : {len(dropped_stale)}")
print(f"dropped duplicates : {len(dropped_dupe)}")
print(f"added missing      : {len(added)}")
print(f"final requests     : {count(coll['item'])}")

print("\n── DROPPED (stale) ──")
for (m, p), f, n in dropped_stale:
    print(f"  {m:6} {p:55} [{f}]")

print("\n── ADDED ──")
for m, p, f in added:
    print(f"  {m:6} {p:60} → {f}")

COLL.write_text(json.dumps(coll, indent=1, ensure_ascii=False))
print(f"\nwritten: {COLL}")
