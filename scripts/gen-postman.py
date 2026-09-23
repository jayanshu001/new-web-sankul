#!/usr/bin/env python3
"""
Generate a Postman v2.1 collection from src/{admin,client}/**/*.routes.ts.

Strategy:
  1. Walk every .routes.ts under src/admin and src/client.
  2. Resolve the mount path by tracing back through admin.routes.ts / client.routes.ts.
  3. For each `router.<verb>(path, ...handlers)` line, identify the controller
     handler name. Open the controller file, find the function body, and look
     for `<schemaName>.parse(req.body)` — open the schema's source file and
     extract the Zod object shape into a JSON-shaped placeholder body.
  4. Pull `req.query.<x>` / `req.params.<x>` / destructured `req.query` / `req.params`
     references to produce query params and confirm path params.
  5. Emit Postman v2.1 JSON with proper folder hierarchy, headers, body, and url
     blocks (raw + host + path + query + variable).
"""
from __future__ import annotations
import json
import os
import re
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "docs" / "web-sankul-postman-collection.json"

# ───────────────────────── helpers ─────────────────────────

def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""

def strip_comments(s: str) -> str:
    # remove /* ... */
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    # remove // ... (line)
    s = re.sub(r"(^|[^:\"'`])//[^\n]*", lambda m: m.group(1), s)
    return s

# ───────────────────── master mount resolution ─────────────────────

def parse_master(routes_file: Path):
    """Parse a master routes file (admin.routes.ts / client.routes.ts) returning
    list of (mount_prefix, imported_routes_file_relpath)."""
    text = strip_comments(read(routes_file))
    imports = {}
    for m in re.finditer(r'import\s+(\w+)\s+from\s+["\']([^"\']+)["\']', text):
        ident, rel = m.group(1), m.group(2)
        # resolve relative to routes_file
        candidate = (routes_file.parent / rel).resolve()
        if not candidate.exists():
            for ext in (".ts", ".js"):
                p = Path(str(candidate) + ext)
                if p.exists():
                    candidate = p; break
            else:
                # try index.ts inside dir
                if (candidate / "index.ts").exists():
                    candidate = candidate / "index.ts"
        imports[ident] = candidate
    mounts = []
    for m in re.finditer(r'router\.use\(\s*["\']([^"\']*)["\']\s*,\s*(\w+)\s*\)', text):
        prefix, ident = m.group(1), m.group(2)
        if ident in imports:
            mounts.append((prefix, imports[ident]))
    return mounts

# ───────────────────── per-routes-file parsing ─────────────────────

VERB_RE = re.compile(
    r'router\.(get|post|put|patch|delete)\(\s*["\']([^"\']*)["\']\s*,',
    re.S,
)

AUTH_MW_NAMES = {"authenticate","authMiddleware","verifyToken","requireAuth","auth","authenticateAdmin","authenticateClient","ensureAuth"}

def router_level_auth(text: str) -> bool:
    """True if router.use(authenticate, ...) — without a path arg — is set."""
    for m in re.finditer(r'router\.use\(', text):
        s = m.end() - 1
        depth = 0
        for i in range(s, len(text)):
            ch = text[i]
            if ch == "(": depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    args = text[s+1:i]
                    if re.match(r'\s*["\']', args):
                        break
                    if any(name in args for name in AUTH_MW_NAMES):
                        return True
                    break
    return False

UPLOAD_CONST_RE = re.compile(
    r'const\s+(\w+)\s*=\s*(?:upload\w*|multer\w*)\s*\.\s*(single|array|fields|any)\s*\(',
    re.S,
)

def collect_upload_aliases(text: str):
    """Find `const NAME = upload.single("x")` style declarations and capture
    a synthetic spec the analyzer can detect."""
    aliases = {}
    for m in UPLOAD_CONST_RE.finditer(text):
        name = m.group(1); kind = m.group(2)
        # capture the args (balanced parens)
        s = m.end() - 1
        depth = 0
        for i in range(s, len(text)):
            ch = text[i]
            if ch == "(": depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    args = text[s+1:i]
                    aliases[name] = f'upload.{kind}({args})'
                    break
    return aliases

def parse_routes(routes_file: Path):
    """Returns list of dicts: {method, path, handler_name, raw_handlers}"""
    text = strip_comments(read(routes_file))
    aliases = collect_upload_aliases(text)
    out = []
    for m in VERB_RE.finditer(text):
        method = m.group(1).upper()
        path = m.group(2)
        # walk balanced parens to find true end of router.<verb>(...)
        open_idx = text.rfind("(", 0, m.end())
        depth = 0
        end_idx = None
        for i in range(open_idx, len(text)):
            ch = text[i]
            if ch == "(": depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    end_idx = i; break
        if end_idx is None:
            continue
        comma_idx = m.end() - 1
        rest = text[comma_idx+1:end_idx].strip()
        # last identifier is the controller handler (or call expr)
        # rest is like: "authenticate, upload.single('img'), createBook"
        # take the final comma-separated chunk
        parts = [p.strip() for p in split_top_level_commas(rest)]
        last = parts[-1] if parts else ""
        # ignore inline arrow funcs in last position — fall back
        handler_name = None
        ident_match = re.match(r'([A-Za-z_$][\w$]*)\s*$', last)
        if ident_match:
            handler_name = ident_match.group(1)
        mw_list = parts[:-1] if handler_name else parts
        # expand alias references
        expanded_mw = []
        for mw in mw_list:
            ident_only = re.match(r'([A-Za-z_$][\w$]*)\s*$', mw)
            if ident_only and ident_only.group(1) in aliases:
                expanded_mw.append(aliases[ident_only.group(1)])
            else:
                expanded_mw.append(mw)
        out.append({
            "method": method,
            "path": path,
            "handler": handler_name,
            "middleware": expanded_mw,
            "all_args": parts,
        })
    return out

def split_top_level_commas(s: str):
    depth = 0
    buf = []
    out = []
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out

# ───────────────────── controller / validation introspection ─────────────────────

def find_controller_files(routes_file: Path):
    """Heuristic: any imported file in same module dir that ends in .controller.ts."""
    text = strip_comments(read(routes_file))
    files = []
    for m in re.finditer(r'from\s+["\']([^"\']+)["\']', text):
        rel = m.group(1)
        candidate = (routes_file.parent / rel).resolve()
        for ext in ("", ".ts", ".js"):
            p = Path(str(candidate) + ext)
            if p.exists() and p.suffix == ".ts":
                files.append(p)
                break
    return files

def extract_function_body(text: str, fn_name: str):
    """Return the source of `export const fn_name = ... { ... }` or `export function fn_name(...){...}`."""
    # arrow form
    m = re.search(rf'export\s+const\s+{re.escape(fn_name)}\s*=\s*async?\s*\([^)]*\)\s*(?::[^=]+)?=>\s*\{{', text)
    if not m:
        m = re.search(rf'export\s+const\s+{re.escape(fn_name)}\s*=\s*async\s*\([^)]*\)\s*=>\s*\{{', text)
    if not m:
        # function declaration
        m = re.search(rf'export\s+(?:async\s+)?function\s+{re.escape(fn_name)}\s*\([^)]*\)\s*(?::[^{{]+)?\{{', text)
    if not m:
        # also non-exported (re-exported via barrel)
        m = re.search(rf'(?:^|\n)\s*const\s+{re.escape(fn_name)}\s*=\s*async?\s*\([^)]*\)\s*=>\s*\{{', text)
    if not m:
        return ""
    start = m.end() - 1  # position of {
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start:i+1]
    return text[start:]

def extract_schema_object(schema_src: str, schema_name: str):
    """Resolve `export const <schema_name> = <expr>;` into a `{...}` object literal.
    Handles `z.object({...})`, `<other>.partial()`, `.extend({...})`, `.merge(other)`,
    `.pick({...})`, `.omit({...})` by recursively resolving referenced schemas."""
    pat = re.compile(rf'(?:export\s+)?const\s+{re.escape(schema_name)}\s*=\s*([^;]+);', re.S)
    m = pat.search(schema_src)
    if not m:
        return None
    expr = m.group(1).strip()
    return _resolve_schema_expr(expr, schema_src)

def _resolve_schema_expr(expr: str, schema_src: str):
    """Return a `{ ... }` literal source string for the given schema expression."""
    expr = expr.strip()
    # z.object(<ident>) — resolve referenced shape object
    sm = re.match(r'z\s*\.\s*object\s*\(\s*([A-Za-z_$][\w$]*)\s*\)', expr, re.S)
    if sm:
        ref = sm.group(1)
        # find `const <ref> = { ... }`
        rm = re.search(rf'const\s+{re.escape(ref)}\s*=\s*(\{{)', schema_src, re.S)
        if rm:
            s = rm.end() - 1
            depth = 0
            for i in range(s, len(schema_src)):
                ch = schema_src[i]
                if ch == "{": depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0: return schema_src[s:i+1]
    # direct z.object({...}) — allow whitespace/newlines between z, ., object
    om = re.match(r'z\s*\.\s*object\s*\(\s*(\{)', expr, re.S)
    if om:
        start = om.end() - 1
        depth = 0
        for i in range(start, len(expr)):
            c = expr[i]
            if c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0: return expr[start:i+1]
        return None
    # <ident>.method(...).method(...)  — resolve base ident then ignore mods (partial/extend stay structural)
    base = re.match(r'([A-Za-z_$][\w$]*)', expr)
    if base:
        ref = base.group(1)
        if ref != "z":
            inner = extract_schema_object(schema_src, ref)
            if inner:
                # if .extend({...}) present, merge keys
                em = re.search(r'\.extend\(\s*\{', expr)
                if em:
                    s = em.end() - 1
                    depth = 0
                    for i in range(s, len(expr)):
                        c = expr[i]
                        if c=="{": depth+=1
                        elif c=="}":
                            depth-=1
                            if depth==0:
                                ext = expr[s:i+1]
                                # merge: strip outer braces, concat
                                merged = "{" + inner.strip()[1:-1] + "," + ext.strip()[1:-1] + "}"
                                return merged
                                break
                return inner
    return None

def zod_object_to_example(obj_src: str, all_validation_text: str, depth=0):
    """Parse `{ key: z.string()..., key2: z.object({...}), ... }` into a dict."""
    if depth > 6:
        return {}
    # strip outer braces
    inner = obj_src.strip()
    if inner.startswith("{"):
        inner = inner[1:]
    if inner.endswith("}"):
        inner = inner[:-1]
    # split top-level commas
    parts = split_top_level_commas(inner)
    out = {}
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # `key: <expr>`
        km = re.match(r'([\'"]?)([A-Za-z_$][\w$]*)\1\s*:\s*(.+)$', p, re.S)
        if not km:
            continue
        key = km.group(2)
        expr = km.group(3).strip().rstrip(",")
        out[key] = zod_expr_to_example(expr, all_validation_text, depth+1)
    return out

def zod_expr_to_example(expr: str, all_validation_text: str, depth=0):
    e = expr.strip()
    # nested z.object({...})
    if e.startswith("z.object("):
        inner = balanced_extract(e, "z.object(", "(", ")")
        # strip outer { } from inner
        if inner is not None:
            return zod_object_to_example(inner.strip(), all_validation_text, depth+1)
    if e.startswith("z.array("):
        inner = balanced_extract(e, "z.array(", "(", ")")
        if inner is not None:
            return [zod_expr_to_example(inner.strip(), all_validation_text, depth+1)]
    if "z.enum(" in e:
        em = re.search(r'z\.enum\(\s*\[([^\]]+)\]', e)
        if em:
            vals = [v.strip().strip('\'"') for v in em.group(1).split(",") if v.strip()]
            return vals[0] if vals else ""
    # default value
    dm = re.search(r'\.default\(\s*([^)]+)\)', e)
    if dm:
        v = dm.group(1).strip()
        if v in ("true","false"): return v == "true"
        if re.match(r'^-?\d+(\.\d+)?$', v): return float(v) if "." in v else int(v)
        if v.startswith("'") or v.startswith('"'):
            return v[1:-1]
    # type-based default
    if "z.string" in e:
        if "email" in e: return "user@example.com"
        if "url" in e: return "https://example.com"
        if "uuid" in e: return "00000000-0000-0000-0000-000000000000"
        if "objectId" in e.lower() or "ObjectId" in e or "regex" in e and "0-9a-fA-F" in e:
            return "64f0c2a1b3e2a1c4d5e6f789"
        if "datetime" in e or "iso" in e.lower(): return "2026-01-01T00:00:00.000Z"
        return "string"
    if "z.number" in e or "z.coerce.number" in e:
        return 0
    if "z.boolean" in e: return True
    if "z.date" in e: return "2026-01-01T00:00:00.000Z"
    if "z.literal" in e:
        lm = re.search(r'z\.literal\(\s*([^)]+)\)', e)
        if lm:
            v = lm.group(1).strip()
            if v in ("true","false"): return v == "true"
            return v.strip('\'"')
    if "z.any" in e or "z.unknown" in e: return None
    if "z.record" in e: return {}
    # reference to another schema by name
    rm = re.match(r'([A-Za-z_$][\w$]*)\s*(?:\.\w+\([^)]*\))*\s*$', e)
    if rm:
        ref = rm.group(1)
        obj = extract_schema_object(all_validation_text, ref)
        if obj:
            return zod_object_to_example(obj, all_validation_text, depth+1)
    return ""

def balanced_extract(s: str, prefix: str, open_ch: str, close_ch: str):
    idx = s.find(prefix)
    if idx < 0: return None
    start = idx + len(prefix) - 1  # position of open paren
    depth = 0
    for i in range(start, len(s)):
        c = s[i]
        if c == open_ch: depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return s[start+1:i]
    return None

# ───────────────────── handler analysis ─────────────────────

SCHEMA_PARSE_RE = re.compile(r'(\w+Schema)(?:\s*\.\s*\w+\([^)]*\))*\s*\.\s*(?:parse|safeParse)\s*\(')
QUERY_DESTRUCT_RE = re.compile(r'(?:const|let|var)\s*\{\s*([^{}]+?)\s*\}\s*=\s*req\.query', re.S)
QUERY_DOT_RE = re.compile(r'req\.query\.(\w+)')
PARAMS_DESTRUCT_RE = re.compile(r'(?:const|let|var)\s*\{\s*([^{}]+?)\s*\}\s*=\s*req\.params', re.S)
PARAMS_DOT_RE = re.compile(r'req\.params\.(\w+)')
PARAMS_BRACKET_RE = re.compile(r'req\.params\[\s*[\'"](\w+)[\'"]\s*\]')
QUERY_SCHEMA_RE = re.compile(r'(\w+Schema)\.(?:parse|safeParse)\(\s*req\.query\s*\)')
UPLOAD_RE = re.compile(r'(?:upload\w*|multer\w*)\s*\.\s*(single|array|fields|any)\b')

def collect_validation_text(routes_dir: Path) -> str:
    """Concat all .validation.ts and .schema.ts in the same dir + ../shared dirs."""
    chunks = []
    for p in routes_dir.rglob("*.validation.ts"):
        chunks.append(read(p))
    for p in routes_dir.rglob("*.schema.ts"):
        chunks.append(read(p))
    # also any sibling validation
    return "\n".join(chunks)

def split_destructure(s: str):
    """`a, b = 'x', c: alias` -> ['a','b','c']"""
    parts = split_top_level_commas(s)
    names = []
    for p in parts:
        p = p.strip()
        # strip default `= ...`
        p = re.split(r'=', p, maxsplit=1)[0].strip()
        # rename `a: b`
        if ":" in p:
            p = p.split(":")[0].strip()
        if re.match(r'^[A-Za-z_$][\w$]*$', p):
            names.append(p)
    return names

FACTORY_ASSIGN_RE = re.compile(
    r'(?:export\s+)?const\s+(\w+)\s*=\s*(\w+)\s*\(([^)]*)\)\s*;'
)
BODY_DESTRUCT_RE = re.compile(r'(?:const|let|var)\s*\{\s*([^{}]+?)\s*\}\s*=\s*req\.body')

def analyze_handler(controller_text: str, validation_text: str, handler_name: str, middleware: list[str]):
    """Return {body, queryParams, pathParams, isMultipart, multipartFields}."""
    body = handler_name and extract_function_body(controller_text, handler_name)
    if not body:
        body = ""
    # factory pattern: const createFaq = genericCreate(Model, faqCreateSchema, ...)
    if handler_name and not body:
        fm = re.search(rf'(?:export\s+)?const\s+{re.escape(handler_name)}\s*=\s*\w+\s*\(', controller_text)
        if fm:
            s = fm.end() - 1
            depth = 0
            args_str = ""
            for i in range(s, len(controller_text)):
                ch = controller_text[i]
                if ch == "(": depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        args_str = controller_text[s+1:i]; break
            for a in split_top_level_commas(args_str):
                a = a.strip()
                if re.match(r'\w+Schema\b', a):
                    name = re.match(r'(\w+Schema)', a).group(1)
                    obj = extract_schema_object(validation_text, name)
                    if obj:
                        return {
                            "body": zod_object_to_example(obj, validation_text),
                            "query": [], "path": [], "multipart": False, "multipart_fields": [],
                        }
    info = {
        "body": None,
        "query": [],
        "path": [],
        "multipart": False,
        "multipart_fields": [],
    }
    # multipart from middleware
    for mw in middleware:
        um = UPLOAD_RE.search(mw)
        if um:
            info["multipart"] = True
            kind = um.group(1)
            if kind == "single":
                fm = re.search(r"single\(\s*['\"](\w+)['\"]", mw)
                if fm: info["multipart_fields"].append(("file", fm.group(1)))
            elif kind == "array":
                fm = re.search(r"array\(\s*['\"](\w+)['\"]", mw)
                if fm: info["multipart_fields"].append(("file", fm.group(1)))
            elif kind == "fields":
                for fm in re.finditer(r"name:\s*['\"](\w+)['\"]", mw):
                    info["multipart_fields"].append(("file", fm.group(1)))
    # body schema
    sm = SCHEMA_PARSE_RE.search(body)
    if sm:
        schema_name = sm.group(1)
        obj = extract_schema_object(validation_text, schema_name)
        if obj:
            info["body"] = zod_object_to_example(obj, validation_text)
    # query schema
    qm = QUERY_SCHEMA_RE.search(body)
    if qm:
        schema_name = qm.group(1)
        obj = extract_schema_object(validation_text, schema_name)
        if obj:
            example = zod_object_to_example(obj, validation_text)
            for k, v in example.items():
                info["query"].append((k, str(v) if not isinstance(v,(dict,list)) else ""))
    # query refs
    for qd in QUERY_DESTRUCT_RE.finditer(body):
        for n in split_destructure(qd.group(1)):
            if n not in [q[0] for q in info["query"]]:
                info["query"].append((n, ""))
    for qd in QUERY_DOT_RE.finditer(body):
        n = qd.group(1)
        if n not in [q[0] for q in info["query"]]:
            info["query"].append((n, ""))
    # path refs
    for pd in PARAMS_DESTRUCT_RE.finditer(body):
        for n in split_destructure(pd.group(1)):
            info["path"].append(n)
    for pd in PARAMS_DOT_RE.finditer(body):
        info["path"].append(pd.group(1))
    for pd in PARAMS_BRACKET_RE.finditer(body):
        info["path"].append(pd.group(1))
    info["path"] = list(dict.fromkeys(info["path"]))
    # fallback: destructure from req.body
    if info["body"] is None:
        keys = []
        for bd in BODY_DESTRUCT_RE.finditer(body):
            for n in split_destructure(bd.group(1)):
                if n not in keys: keys.append(n)
        if keys:
            info["body"] = {k: "" for k in keys}
    return info

# ───────────────────── postman emitters ─────────────────────

def url_block(base_var: str, full_path: str, query_params: list, path_params: list):
    # full_path like "/api/v1/admin/books/:id"
    # extract path segments
    segs = [s for s in full_path.strip("/").split("/") if s]
    raw_path = full_path
    # query string
    qs = ""
    if query_params:
        qs = "?" + "&".join(f"{k}={v}" for k,v in query_params)
    raw = "{{" + base_var + "}}" + raw_path + qs
    block = {
        "raw": raw,
        "host": ["{{" + base_var + "}}"],
        "path": segs,
    }
    if query_params:
        block["query"] = [{"key": k, "value": v} for k,v in query_params]
    # variable for :params
    var_segs = [s for s in segs if s.startswith(":")]
    if var_segs:
        block["variable"] = [{"key": s[1:], "value": ""} for s in var_segs]
    return block

def make_request(method: str, full_path: str, info: dict, token_var: str, base_var: str):
    headers = []
    needs_auth = token_var is not None
    if needs_auth:
        headers.append({"key":"Authorization","value":f"Bearer {{{{{token_var}}}}}","type":"text"})
    body = None
    if info.get("multipart"):
        formdata = []
        file_keys = {name for kind, name in info["multipart_fields"]}
        if info.get("body"):
            for k, v in info["body"].items():
                if k in file_keys:
                    continue  # will be added as file
                formdata.append({"key":k,"value":json.dumps(v) if isinstance(v,(dict,list)) else str(v),"type":"text"})
        for kind, name in info["multipart_fields"]:
            formdata.append({"key":name,"type":"file","src":[]})
        body = {"mode":"formdata","formdata":formdata}
    elif method in ("POST","PUT","PATCH") or info.get("body") is not None:
        if info.get("body") is not None:
            headers.append({"key":"Content-Type","value":"application/json","type":"text"})
            body = {"mode":"raw","raw":json.dumps(info["body"], indent=2),"options":{"raw":{"language":"json"}}}
        elif method in ("POST","PUT","PATCH"):
            headers.append({"key":"Content-Type","value":"application/json","type":"text"})
            body = {"mode":"raw","raw":"{}","options":{"raw":{"language":"json"}}}

    req = {"method": method, "header": headers, "url": url_block(base_var, full_path, info.get("query") or [], info.get("path") or [])}
    if body is not None:
        req["body"] = body
    return req

# ───────────────────── token + base var resolver ─────────────────────

def token_var_for(scope: str, full_path: str, has_auth_mw: bool):
    # Project rule: every route requires a Bearer token (admin + client + educator + promoter).
    # Always emit the auth header; never default to public.
    if scope == "admin": return "adminToken"
    if scope == "educator": return "educatorToken"
    if scope == "promoter": return "promoterToken"
    return "clientToken"

# ───────────────────── main ─────────────────────

def build():
    scopes = [
        ("admin", SRC / "admin" / "admin.routes.ts", "/api/v1/admin"),
        ("client", SRC / "client" / "client.routes.ts", "/api/v1/client"),
        ("educator", SRC / "educator" / "educator.routes.ts", "/api/v1/educator"),
        ("promoter", SRC / "promoter" / "promoter.routes.ts", "/api/v1/promoter"),
    ]
    folders = {s[0]: defaultdict(list) for s in scopes}
    counts = {s[0]: 0 for s in scopes}

    for scope, master, base in scopes:
        if not master.exists():
            print(f"missing {master}", file=sys.stderr); continue
        mounts = parse_master(master)
        for prefix, routes_file in mounts:
            if not routes_file.exists():
                print(f"  ! routes file missing: {routes_file}", file=sys.stderr); continue
            module_dir = routes_file.parent
            module_name = module_dir.name.replace("-"," ").title()
            controller_files = find_controller_files(routes_file)
            controller_text = "\n".join(read(p) for p in controller_files)
            validation_text = collect_validation_text(module_dir)
            # also pull validation files from sibling dirs of imported controllers
            seen_dirs = {module_dir}
            for cf in controller_files:
                if cf.parent not in seen_dirs:
                    validation_text += "\n" + collect_validation_text(cf.parent)
                    seen_dirs.add(cf.parent)
            # also pull all validation files project-wide as a last resort (cheap)
            for vp in (SRC).rglob("*.validation.ts"):
                if vp.parent not in seen_dirs:
                    validation_text += "\n" + read(vp)
            # include controller text too (schemas often defined inline)
            validation_text += "\n" + controller_text
            # also include validation from sibling shared dirs
            routes_text = strip_comments(read(routes_file))
            blanket_auth = router_level_auth(routes_text)
            for r in parse_routes(routes_file):
                method = r["method"]
                rel_path = r["path"]
                full_path = base + prefix + rel_path
                full_path = re.sub(r"/+", "/", full_path)
                info = analyze_handler(controller_text, validation_text, r["handler"] or "", r["middleware"])
                has_auth = blanket_auth or any(any(name in mw for name in AUTH_MW_NAMES) for mw in r["middleware"])
                tok = token_var_for(scope, full_path, has_auth)
                req = make_request(method, full_path, info, tok, "baseUrl")
                name = f"{method} {prefix.rstrip('/')}{rel_path}".strip()
                folders[scope][module_name].append({
                    "name": name,
                    "request": req,
                    "response": [],
                })
                counts[scope] += 1

    # build collection
    coll = {
        "info": {
            "name": "Web Sankul API",
            "description": (
                "Auto-generated from src/**/*.routes.ts. Body schemas are resolved from "
                "Zod validation files; query/path params are inferred from controller usage. "
                "All requests carry a Bearer token (project rule: every route requires auth).\n\n"
                "Variables: `baseUrl`, `adminToken`, `clientToken`, `educatorToken`, `promoterToken`.\n"
                "Set `baseUrl` (e.g. http://localhost:4001) and the relevant token, then any folder is ready to fire."
            ),
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "variable": [
            {"key":"baseUrl","value":"http://localhost:4001","type":"string"},
            {"key":"adminToken","value":"","type":"string"},
            {"key":"clientToken","value":"","type":"string"},
            {"key":"educatorToken","value":"","type":"string"},
            {"key":"promoterToken","value":"","type":"string"},
        ],
        "item": [],
    }
    for scope_name, scope_label in (("admin","Admin"),("client","Client"),("educator","Educator"),("promoter","Promoter")):
        items = []
        for module in sorted(folders[scope_name].keys()):
            items.append({
                "name": module,
                "item": folders[scope_name][module],
            })
        coll["item"].append({
            "name": scope_label,
            "description": f"{scope_label} routes ({counts[scope_name]} endpoints)",
            "item": items,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(coll, indent=2), encoding="utf-8")
    summary = " ".join(f"{k}={v}" for k, v in counts.items())
    print(f"wrote {OUT}  {summary}")

if __name__ == "__main__":
    build()
