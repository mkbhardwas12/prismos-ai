#!/usr/bin/env bash
# Build the public demo MP4 + GIF exclusively from reviewed synthetic
# screenshots, using ffmpeg overlays (see render-overlays.py). Local live
# captures are deliberately excluded because they can contain private data or
# stale claims. A macOS `say` voiceover is muxed into the MP4 when available.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOTS="$ROOT/docs/screenshots"
OUT="$ROOT/docs/media"
OVR="$OUT/_overlays"
mkdir -p "$OUT"
echo "» rendering privacy-safe illustrated screenshots"
python3 "$ROOT/scripts/render-public-screenshots.py"
echo "» rendering overlays"
python3 "$ROOT/scripts/render-overlays.py"
echo "» rendering voiceover"
bash "$ROOT/scripts/render-voice.sh"

W=1280; H=720; FPS=24
SCENE_SECONDS=3
FADE_SECONDS=0.6

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ----- Scene 01: reviewed synthetic intro only -----
INTRO_RAW="$TMP/intro_raw.mp4"
ffmpeg -y -loglevel error -loop 1 -t "$SCENE_SECONDS" -i "$SHOTS/intent-console.png" \
  -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a14,setsar=1,fps=${FPS}" \
  -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$INTRO_RAW"

INTRO_OVR="$OVR/scene_01.png"
INTRO_OUT="$TMP/scene_00.mp4"
ffmpeg -y -loglevel error -i "$INTRO_RAW" -loop 1 -t "$SCENE_SECONDS" -i "$INTRO_OVR" \
  -filter_complex "[1:v]scale=${W}:${H},format=rgba,setsar=1,fps=${FPS}[ovr];[0:v][ovr]overlay=0:0:format=auto[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$INTRO_OUT"

# ----- Static scenes -----
SCENES=(
  "$SHOTS/intent-console.png|$OVR/scene_02.png"
  "$SHOTS/spectrum-graph.png|$OVR/scene_03.png"
  "$SHOTS/Spectrum-Explorer.png|$OVR/scene_04.png"
  "$SHOTS/Sandbox-Prisms.png|$OVR/scene_05.png"
  "$SHOTS/Spectral-Timeline.png|$OVR/scene_06.png"
)

i=1
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

# ----- Title card -----
TITLE_OVR="$OVR/scene_99_title.png"
title_clip="$TMP/scene_$(printf '%02d' $i).mp4"
ffmpeg -y -loglevel error \
  -loop 1 -t "$SCENE_SECONDS" -i "$TITLE_OVR" \
  -filter_complex "[0:v]scale=${W}:${H},setsar=1,fps=${FPS}[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$title_clip"

# ----- Stitch with xfade -----
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

SILENT_MP4="$TMP/silent.mp4"
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" \
  -map "${prev}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$SILENT_MP4"

# ----- Mux voiceover -----
MP4="$OUT/prismos-demo.mp4"
if [[ -f "$OVR/voice.m4a" ]]; then
  ffmpeg -y -loglevel error -i "$SILENT_MP4" -i "$OVR/voice.m4a" \
    -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest \
    -movflags +faststart "$MP4"
else
  cp "$SILENT_MP4" "$MP4"
fi
echo "✓ wrote $MP4"

# ----- GIF (silent, smaller) -----
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
