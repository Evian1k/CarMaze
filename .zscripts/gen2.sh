#!/bin/bash
cd /home/z/my-project
declare -A IMGS=(
  [prado]="Professional photo of a white full-size luxury SUV, three-quarter front view, parked in a bright modern showroom, clean neutral background, soft studio lighting, photorealistic, high quality, no text, no logo"
  [harrier]="Professional photo of a dark grey mid-size crossover SUV, three-quarter front view, parked on a clean city street, soft daylight, photorealistic, high quality, no text, no logo"
  [demio]="Professional photo of a red compact hatchback city car, three-quarter front view, clean studio background, soft lighting, photorealistic, high quality, no text, no logo"
  [fit]="Professional photo of a silver compact hybrid hatchback car, three-quarter front view, clean studio background, soft lighting, photorealistic, high quality, no text, no logo"
  [xtrail]="Professional photo of a bronze family crossover SUV, three-quarter front view, on a scenic tarmac road with green hills, daylight, photorealistic, high quality, no text, no logo"
  [forester]="Professional photo of a dark green rugged crossover SUV with roof rails, three-quarter front view, outdoors near a national park, daylight, photorealistic, high quality, no text, no logo"
  [c200]="Professional photo of a black executive sedan, elegant three-quarter front view, modern building background, soft evening light, photorealistic, high quality, no text, no logo"
  [dmax]="Professional photo of a white double-cab pickup truck, three-quarter front view, on a worksite road with open sky, daylight, photorealistic, high quality, no text, no logo"
  [vitz]="Professional photo of a pearl white compact hatchback car, three-quarter front view, clean urban background, daylight, photorealistic, high quality, no text, no logo"
  [noah]="Professional photo of a silver family minivan MPV, three-quarter front view, suburban driveway, soft daylight, photorealistic, high quality, no text, no logo"
  [garage]="Modern clean automotive garage workshop interior, professional mechanics bay with car on lift, warm lighting, organized tools, photorealistic, high quality, no text"
)
for name in prado harrier demio fit xtrail forester c200 dmax vitz noah garage; do
  f="public/images/$name.png"
  [ -s "$f" ] && echo "[skip] $name" && continue
  for i in 1 2; do
    timeout 150 z-ai image -p "${IMGS[$name]}" -o "$f" -s 1344x768 > /dev/null 2>&1 && echo "[ok] $name" && break
    echo "[retry $i] $name"; sleep 2
  done
done
echo "ALL DONE"
