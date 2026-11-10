#!/usr/bin/env bash
# CARMAZE role × section coverage check.
# Signs in as every demo role and exercises every section endpoint that role
# should be able to read. Reports HTTP status + payload richness per endpoint.
set -u
BASE="http://localhost:3000"
JARDIR="/tmp/carmaze-jars"
mkdir -p "$JARDIR"

declare -A ROLES=(
  [customer]=cars
  [private-seller]=my-listings
  [showroom-owner]=dealer
  [showroom-staff]=dealer
  [garage-owner]=garage-dashboard
  [garage-staff]=garage-dashboard
  [supplier-owner]=supplier
  [logistics-owner]=logistics
  [platform-support]=admin
  [platform-admin]=admin
)

declare -A ENDPOINTS=(
  [customer]="/api/auth/me|/api/vehicles|/api/garages|/api/roadside?mine=1|/api/memberships|/api/mygarage/vehicles|/api/community/posts|/api/customizer/configs|/api/supply/catalogue|/api/supply/categories|/api/suppliers|/api/dealers|/api/partners|/api/saved-vehicles|/api/enquiries|/api/notifications|/api/loyalty"
  [private-seller]="/api/auth/me|/api/vehicles?mine=1|/api/enquiries?selling=1|/api/offers?incoming=1|/api/notifications"
  [showroom-owner]="/api/auth/me|/api/dealer/dashboard|/api/vehicles?mine=1|/api/enquiries|/api/test-drives|/api/billing/plans|/api/billing/invoices|/api/orgs/staff|/api/buying-requests|/api/offers?incoming=1|/api/orgs/me|/api/applications"
  [showroom-staff]="/api/auth/me|/api/dealer/dashboard|/api/enquiries|/api/test-drives"
  [garage-owner]="/api/auth/me|/api/bookings|/api/garage-services|/api/quotes|/api/service-requests|/api/custody|/api/orgs/me|/api/reviews|/api/applications"
  [garage-staff]="/api/auth/me|/api/bookings|/api/service-requests|/api/custody"
  [supplier-owner]="/api/auth/me|/api/supply/products|/api/supply/orders|/api/supply/branches|/api/orders|/api/suppliers|/api/orgs/me"
  [logistics-owner]="/api/auth/me|/api/logistics/jobs|/api/logistics/fleet"
  [platform-support]="/api/auth/me|/api/admin/tickets|/api/admin/overview"
  [platform-admin]="/api/auth/me|/api/admin/overview|/api/admin/listings|/api/applications|/api/admin/ops|/api/admin/campaigns|/api/admin/logistics|/api/admin/partners"
)

line() { printf "%-11s %-38s => %s\n" "$1" "$2" "$3"; }

for role in customer private-seller showroom-owner showroom-staff garage-owner garage-staff supplier-owner logistics-owner platform-support platform-admin; do
  jar="$JARDIR/$role.txt"
  code=$(curl -s -o /tmp/demo-login-$role.json -w "%{http_code}" -c "$jar" -X POST "$BASE/api/auth/demo" -H 'Content-Type: application/json' -d "{\"role\":\"$role\"}")
  dash=$(python3 -c "import json;d=json.load(open('/tmp/demo-login-$role.json'));print(d.get('data',{}).get('dashboard','?') if d.get('ok',d.get('success',True)) else d)" 2>/dev/null || echo "parse-fail")
  printf "%s login: %s dashboard=%s\n" "$role" "$code" "$dash"
  IFS='|' read -ra EPS <<< "${ENDPOINTS[$role]}"
  for ep in "${EPS[@]}"; do
    out=$(curl -s -b "$jar" "$BASE$ep" -w "\n%{http_code}" --max-time 15)
    http=$(echo "$out" | tail -1)
    body=$(echo "$out" | head -n -1)
    # measure richness: count array elements in data, or object keys
    stat=$(python3 - "$body" <<'PY'
import json,sys
raw=sys.argv[1]
try:
    d=json.loads(raw)
except Exception:
    print("non-json/empty"); raise SystemExit
data=d.get('data', d)
def count(x):
    if isinstance(x,list): return len(x)
    if isinstance(x,dict):
        # find first list value
        for v in x.values():
            if isinstance(v,list): return len(v)
        return len(x)
    return 1 if x is not None else 0
print(f"ok items={count(data)}")
PY
) 2>/dev/null || stat="err"
    line "$role" "$ep" "$http $stat"
  done
  echo "---------------------------------------------"
done
