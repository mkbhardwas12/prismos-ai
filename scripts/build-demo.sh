#!/usr/bin/env bash
# Build ~21-second demo MP4 + GIF from real app screenshots, using ffmpeg
# overlay filter with pre-rendered overlay PNGs (see render-overlays.py).
# No drawtext / libfreetype required.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOTS="$ROOT/docs/screenshots"
OUT="$ROOT/docs/media"
OVR="$OUT/_overlays"
mkdir -p "$OUT"
echo "» rendering overlays"
python3 "$ROOT/scripts/render-overlays.py"

SCENES=(
  "$ROOT/docs/screenshots/live/13-frame.png|$OVR/scene_01.png"
  "$SHOTS/intent-console.png|$OVR/scene_02.png"
  "$SHOTS/spectrum-graph.png|$OVR/scene_03.png"
  "$SHOTS/Spectrum-Explorer.png|$OVR/scene_04.png"
  "$SHOTS/Sandbox-Prisms.png|$OVR/scene_05.png"
  "$SHOTS/Spectral-Timeline.png|$OVR/scene_06.png"
)
TITLE_OVR="$OVR/scene_99_title.png"
SCENE_SECONDS=3
FADE_SECONDS=0.6
W=1280; H=720; FPS=24

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

i=0
for entry in "${SCENES[@]}"; do
  png="${entry%%|*}"
  ovr="${entry##*|}"
  out="$TMP/scene_$(printf '%02d' $i).mp4"
  echo "» scene $i: $(basename "$png")"
  ffmpeg -y -loglevel error \
    -loop 1 -t "$SCENE_SECONDS" -i "$png" \
    -loop 1 -t "$SCENE_SECONDS" -i "$ovr" \
    -filter_complex "[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a14,setsar=1,fps=${FPS}[bg];[1:v]scale=${W}:${H},format=rgba,setsar=1,fps=${FPS}[ovr];[bg][ovr]overlay=0:0:format=auto[v]" \
    -map "[v]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$out"
  i=$((i+1))
done

title_clip="$TMP/scene_99_title.mp4"
ffmpeg -y -loglevel error \
  -loop 1 -t "$SCENE_SECONDS" -i "$TITLE_OVR" \
  -filter_complex "[0:v]scale=${W}:${H},setsar=1,fps=${FPS}[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$title_clip"

clips=("$TMP"/scene_*.mp4)
total=${#clips[@]}
echo "» stitching $total clips"
inputs=()
for c in "${clips[@]}"; do inputs+=(-i "$c"); done
filter=""
prev="[0:v]"
offset_total=0
for ((k=1; k<total; k++)); do
  offset_total=$(awk "BEGIN { printf \"%.3f\", $offset_total + $SCENE_SECONDS - $FADE_SECONDS }")
  label="[v${k}]"
  filter+="${prev}[${k}:v]xfade=transition=fade:duration=${FADE_SECONDS}:offset=${offset_total}${label};"
  prev="${label}"
done
filter="${filter%;}"

MP4="$OUT/prismos-demo.mp4"
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" \
  -map "${prev}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$MP4"
echo "✓ wrote $MP4"

PALETTE="$TMP/palette.png"
GIF="$OUT/prismos-demo.gif"
ffmpeg -y -loglevel error -i "$MP4" \
  -vf "fps=8,scale=800:-1:flags=lanczos,palettegen=max_colors=64:reserve_transparent=0" \
  "$PALETTE"
ffmpeg -y -loglevel error -i "$MP4" -i "$PALETTE" \
  -lavfi "fps=8,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" \
  "$GIF"
echo "✓ wrote $GIF"
ls -lh "$MP4" "$GIF"
