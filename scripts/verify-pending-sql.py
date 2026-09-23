#!/usr/bin/env python3
"""Hit each pending-module READ endpoint; report HTTP, count, and whether the
payload is SQL-shaped (no Mongoose __v marker) or still Mongo-shaped (has __v)."""
import json, subprocess, urllib.request

BASE = "http://localhost:4001/api/v1"
auth = json.load(open("docs/migration/api-tests/.auth.json"))
TOK = {"admin": auth["admin"], "customer": auth["customer"]}

def get(path, who):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOK[who]})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return "ERR:" + str(e)[:40], None

def first_items(data):
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for k in ("items","data","rows","docs","results","sessions","modules"):
            if isinstance(data.get(k), list): return data[k]
    return []

def shape(items):
    if not items: return "n/a(empty)"
    s = items[0]
    if not isinstance(s, dict): return "scalar"
    has_v = "__v" in s
    idv = s.get("_id") or s.get("id")
    mongoish = has_v or (isinstance(idv, str) and len(idv) == 24 and all(c in "0123456789abcdef" for c in idv))
    return ("MONGO ⚠ (__v=%s id=%s)" % (has_v, idv)) if mongoish else ("SQL ✅ (id=%s)" % idv)

def cnt(data):
    if isinstance(data, dict):
        p = data.get("pagination") or {}
        if "total" in p: return "total=%s" % p["total"]
        if "total" in data: return "total=%s" % data["total"]
        items = first_items(data)
        if items or any(isinstance(v,list) for v in data.values()): return "len=%s" % len(items)
        return "obj"
    if isinstance(data, list): return "len=%s" % len(data)
    return str(data)

CASES = [
    # label, path, who
    ("client-wishlist",        "/client/wishlist", "customer"),
    ("client-testseries",      "/client/test-series", "customer"),
    ("client-free-tests",      "/client/free-tests", "customer"),
    ("client-free-courses",    "/client/free-courses", "customer"),
    ("client-free-ebooks",     "/client/free-ebooks", "customer"),
    ("client-live-reminders",  "/client/live-reminders", "customer"),
    ("client-referral-terms",  "/client/referral/terms", "customer"),
    ("client-referral-faqs",   "/client/referral/faqs", "customer"),
    ("admin-testseries",       "/admin/test-series?limit=100", "admin"),
    ("admin-promoters",        "/admin/promoters?limit=200", "admin"),
    ("admin-perm-categories",  "/admin/permission-categories?per_page=100", "admin"),
    ("admin-perm-catalog",     "/admin/permissions/catalog", "admin"),
    ("admin-referral-terms",   "/admin/referrals/terms", "admin"),
    ("admin-referral-faqs",    "/admin/referrals/faqs", "admin"),
    ("admin-videos",           "/admin/videos?limit=1", "admin"),
    ("admin-live-sessions",    "/admin/live-sessions?limit=100", "admin"),
    ("admin-live-courses",     "/admin/live-courses?limit=100", "admin"),
    ("admin-promocodes",       "/admin/promocodes", "admin"),
]

for label, path, who in CASES:
    code, body = get(path, who)
    if body is None:
        print("%-24s %-44s HTTP %s" % (label, path[:44], code)); continue
    data = body.get("data", body) if isinstance(body, dict) else body
    items = first_items(data)
    print("%-24s %-44s HTTP %s | %-12s | %s" % (label, path[:44], code, cnt(data), shape(items)))
