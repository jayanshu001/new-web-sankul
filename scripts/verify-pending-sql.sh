#!/usr/bin/env bash
# Hits each pending-module READ endpoint and prints HTTP status + a count hint from the envelope.
set -u
BASE="http://localhost:4001/api/v1"
ADMIN=$(python3 -c "import json;print(json.load(open('docs/migration/api-tests/.auth.json'))['admin'])")
CUST=$(python3 -c "import json;print(json.load(open('docs/migration/api-tests/.auth.json'))['customer'])")

hit() { # label method path token [extra]
  local label="$1" path="$2" tok="$3"
  local body code
  body=$(curl -s -w $'\n%{http_code}' -H "Authorization: Bearer $tok" "$BASE$path")
  code=$(printf '%s' "$body" | tail -1)
  json=$(printf '%s' "$body" | sed '$d')
  cnt=$(printf '%s' "$json" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
except Exception as e:
  print('parse-err'); sys.exit()
def n(x):
  if isinstance(x,list): return len(x)
  if isinstance(x,dict):
    for k in ('items','data','rows','docs','result','results'):
      if k in x and isinstance(x[k],list): return len(x[k])
    if 'total' in x: return 'total='+str(x['total'])
    return 'obj('+str(len(x))+'keys)'
  return x
dd=d.get('data') if isinstance(d,dict) else d
print('success='+str(d.get('success')) if isinstance(d,dict) else '', 'count='+str(n(dd)))
" 2>/dev/null)
  printf '%-26s %-46s -> HTTP %s | %s\n' "$label" "$path" "$code" "$cnt"
}

echo "===== CLIENT (customer JWT) ====="
hit client-wishlist       "/client/wishlist"            "$CUST"
hit client-testseries     "/client/test-series"         "$CUST"
hit client-free-tests     "/client/free-tests"          "$CUST"
hit client-free-courses   "/client/free-courses"        "$CUST"
hit client-free-ebooks    "/client/free-ebooks"         "$CUST"
hit client-live-reminders "/client/live-reminders"      "$CUST"
hit client-referral-terms "/client/referral/terms"      "$CUST"
hit client-referral-faqs  "/client/referral/faqs"       "$CUST"

echo "===== ADMIN (admin JWT) ====="
hit admin-testseries      "/admin/test-series"          "$ADMIN"
hit admin-promoters       "/admin/promoters"            "$ADMIN"
hit admin-perm-categories "/admin/permission-categories" "$ADMIN"
hit admin-perm-catalog    "/admin/permissions/catalog"  "$ADMIN"
hit admin-referral-terms  "/admin/referrals/terms"      "$ADMIN"
hit admin-referral-faqs   "/admin/referrals/faqs"       "$ADMIN"
hit admin-videos          "/admin/videos"               "$ADMIN"
hit admin-live-sessions   "/admin/live-sessions"        "$ADMIN"
hit admin-live-courses    "/admin/live-courses"         "$ADMIN"
hit admin-promocodes      "/admin/promocodes"           "$ADMIN"
