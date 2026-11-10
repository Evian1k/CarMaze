#!/usr/bin/env bash
# CARMAZE faithful role × section coverage check — v2
# Uses the EXACT same endpoints (incl. query params) that each view uses,
# after resolving the active org id from /api/orgs/me where the view does.
set -u
BASE="http://localhost:3000"
JARDIR="/tmp/carmaze-jars"
mkdir -p "$JARDIR"

login() { # role -> jar
  curl -s -o "/tmp/demo-login-$1.json" -c "$JARDIR/$1.txt" -X POST "$BASE/api/auth/demo" \
    -H 'Content-Type: application/json' -d "{\"role\":\"$1\"}" -w "%{http_code}"
}

hit() { # role endpoint
  local jar="$JARDIR/$1.txt" ep="$2"
  local out=$(curl -s -b "$jar" "$BASE$ep" -w "\n%{http_code}" --max-time 15)
  local http=$(echo "$out" | tail -1)
  local body=$(echo "$out" | sed '$d')
  local stat=$(python3 - "$body" <<'PY'
import json,sys
raw=sys.argv[1]
try: d=json.loads(raw)
except Exception: print("non-json"); raise SystemExit
data=d.get('data',d)
def count(x):
    if isinstance(x,list): return len(x)
    if isinstance(x,dict):
        best=0
        for v in x.values():
            if isinstance(v,list): best=max(best,len(v))
        return best if best else (len(x) if x else 0)
    return 1 if x is not None else 0
print(f"{count(data)} items")
PY
) 2>/dev/null || stat="err"
  printf "  %-34s => %s (%s)\n" "$ep" "$http" "$stat"
}

orgid_for() { # role -> first org id from /api/orgs/me
  python3 - "$JARDIR/$1.txt" <<'PY'
import json,subprocess,sys
jar=sys.argv[1]
out=subprocess.run(['curl','-s','-b',jar,'http://localhost:3000/api/orgs/me'],capture_output=True,text=True).stdout
try:
    d=json.loads(out)
    orgs=d.get('data',{}).get('orgs',[])
    print(orgs[0]['id'] if orgs else '')
except Exception:
    print('')
PY
}

echo "=== customer ==="; login customer >/dev/null
for ep in "/api/vehicles" "/api/garages" "/api/roadside?mine=1" "/api/memberships" "/api/mygarage/vehicles" "/api/mygarage/reminders" "/api/mygarage/records" "/api/community/posts" "/api/customizer/configs" "/api/supply/catalogue" "/api/suppliers" "/api/dealers" "/api/partners" "/api/partners/requests/mine" "/api/saved-vehicles" "/api/saved-searches" "/api/enquiries" "/api/notifications" "/api/account/profile"; do hit customer "$ep"; done

echo "=== private-seller ==="; login private-seller >/dev/null
for ep in "/api/vehicles?mine=1" "/api/enquiries?selling=1" "/api/offers?incoming=1" "/api/billing/invoices?mine=1" "/api/notifications"; do hit private-seller "$ep"; done

echo "=== showroom-owner ==="; login showroom-owner >/dev/null
OID=$(orgid_for showroom-owner); echo "  orgId=$OID"
for ep in "/api/dealer/dashboard" "/api/vehicles?mine=1" "/api/enquiries?forOrg=1" "/api/test-drives?org=1" "/api/billing/plans" "/api/billing/invoices?org=1" "/api/orgs/staff?orgId=$OID" "/api/buying-requests?mine=1&orgId=$OID" "/api/buying-requests?board=1" "/api/offers?org=1" "/api/orgs/me" "/api/applications" "/api/dealer/copilot"; do hit showroom-owner "$ep"; done

echo "=== showroom-staff ==="; login showroom-staff >/dev/null
OID2=$(orgid_for showroom-staff); echo "  orgId=$OID2"
for ep in "/api/dealer/dashboard" "/api/enquiries?forOrg=1" "/api/test-drives?org=1" "/api/orgs/staff?orgId=$OID2"; do hit showroom-staff "$ep"; done

echo "=== garage-owner ==="; login garage-owner >/dev/null
OID3=$(orgid_for garage-owner); echo "  orgId=$OID3"
for ep in "/api/bookings?org=1&orgId=$OID3" "/api/garage-services?orgId=$OID3" "/api/quotes" "/api/service-requests?org=1&orgId=$OID3" "/api/custody?org=1" "/api/reviews?orgId=$OID3" "/api/orgs/me" "/api/applications" "/api/supply/catalogue"; do hit garage-owner "$ep"; done

echo "=== garage-staff ==="; login garage-staff >/dev/null
OID4=$(orgid_for garage-staff); echo "  orgId=$OID4"
for ep in "/api/bookings?org=1&orgId=$OID4" "/api/service-requests?org=1&orgId=$OID4" "/api/custody?org=1" "/api/quotes"; do hit garage-staff "$ep"; done

echo "=== supplier-owner ==="; login supplier-owner >/dev/null
OID5=$(orgid_for supplier-owner); echo "  orgId=$OID5"
for ep in "/api/supply/products?orgId=$OID5" "/api/supply/orders?orgId=$OID5" "/api/supply/branches?orgId=$OID5" "/api/orders?scope=supplier&orgId=$OID5" "/api/suppliers" "/api/orgs/me" "/api/billing/invoices?org=1"; do hit supplier-owner "$ep"; done

echo "=== logistics-owner ==="; login logistics-owner >/dev/null
for ep in "/api/logistics/jobs?scope=self" "/api/logistics/jobs?scope=open" "/api/logistics/jobs?scope=partner" "/api/logistics/fleet" "/api/notifications"; do hit logistics-owner "$ep"; done

echo "=== platform-support ==="; login platform-support >/dev/null
for ep in "/api/admin/tickets" "/api/admin/overview" "/api/reports"; do hit platform-support "$ep"; done

echo "=== platform-admin ==="; login platform-admin >/dev/null
for ep in "/api/admin/overview" "/api/admin/listings" "/api/applications" "/api/admin/ops" "/api/admin/campaigns" "/api/admin/logistics" "/api/admin/partners" "/api/admin/users" "/api/admin/staff" "/api/admin/settings" "/api/admin/revenue" "/api/admin/audit"; do hit platform-admin "$ep"; done
