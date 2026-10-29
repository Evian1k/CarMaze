#!/bin/bash
# CARMAZE seed/brand image generation (background task)
set -u
OUT="/home/z/my-project/public/images"
mkdir -p "$OUT"

gen() {
  local file="$1"; shift
  local prompt="$1"; shift
  local size="${1:-1344x768}"
  if [ -s "$OUT/$file" ]; then echo "[skip] $file exists"; return 0; fi
  for i in 1 2 3; do
    z-ai image -p "$prompt" -o "$OUT/$file" -s "$size" && echo "[ok] $file" && return 0
    echo "[retry $i] $file"; sleep 3
  done
  echo "[FAIL] $file"
}

gen hero.png "Cinematic luxury SUV driving on a smooth tarmac road at night in Kenya, warm champagne gold and silver light reflections on wet asphalt, acacia trees silhouettes far away, premium automotive commercial photography, dramatic moody lighting, photorealistic, high quality, no text"
gen intro-road.png "Dark night tarmac road vanishing point perspective, elegant champagne gold light trails streaking along the road, subtle silver reflections, premium automotive commercial, cinematic, minimal, photorealistic, high quality, no text"
gen prado.png "Professional photo of a white full-size luxury SUV similar to a Toyota Land Cruiser Prado, three-quarter front view, parked in a bright modern showroom, clean neutral background, soft studio lighting, photorealistic, high quality, no text, no logo"
gen harrier.png "Professional photo of a dark grey mid-size crossover SUV, three-quarter front view, parked on a clean city street, soft daylight, photorealistic, high quality, no text, no logo"
gen demio.png "Professional photo of a red compact hatchback city car, three-quarter front view, clean studio background, soft lighting, photorealistic, high quality, no text, no logo"
gen fit.png "Professional photo of a silver compact hatchback car, three-quarter front view, clean studio background, soft lighting, photorealistic, high quality, no text, no logo"
gen xtrail.png "Professional photo of a bronze family crossover SUV, three-quarter front view, on a scenic tarmac road with green hills, daylight, photorealistic, high quality, no text, no logo"
gen forester.png "Professional photo of a dark green rugged crossover SUV with roof rails, three-quarter front view, outdoors near a national park, daylight, photorealistic, high quality, no text, no logo"
gen c200.png "Professional photo of a black executive sedan, elegant three-quarter front view, modern office building background, soft evening light, photorealistic, high quality, no text, no logo"
gen dmax.png "Professional photo of a white double-cab pickup truck, three-quarter front view, on a worksite road with open sky, daylight, photorealistic, high quality, no text, no logo"
gen vitz.png "Professional photo of a pearl white compact hatchback car, three-quarter front view, clean urban background, daylight, photorealistic, high quality, no text, no logo"
gen noah.png "Professional photo of a silver family minivan MPV, three-quarter front view, suburban driveway, soft daylight, photorealistic, high quality, no text, no logo"
gen garage.png "Modern clean automotive garage workshop interior, professional mechanics bay with car on lift, warm lighting, organized tools, photorealistic, high quality, no text"
echo "ALL DONE"
