#!/usr/bin/env bash
# Build ~21-second demo MP4 + GIF from real app screenshots, using ffmpeg
# overlay filter with pre-rendered overlay PNGs (see render-overlays.py).
# Now with: (a) animated live-app intro stitched from 13 capture frames,
# (b) macOS `say` voiceover muxed into the MP4.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOTS="$ROOT/docs/screenshots"
OUT="$ROOT/docs/media"
OVR="$OUT/_overlays"
LIVE="$SHOTS/live"
mkdir -p "$OUT"
echo "» rendering overlays"
python3 "$ROOT/scripts/render-overlays.py"
echo "» rendering voiceover"
bash "$ROOT/scripts/render-voice.sh"

W=1280; H=720; FPS=24
SCENE_SECONDS=3
FADE_SECONDS=0.6

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ----- Scene 01: ANIMATED live intro from all available live frames -----
LIVE_FRAMES=()
if [[ -d "$LIVE" ]]; then
  while IFS= read -r f; do LIVE_FRAMES+=("$f"); done < <(ls "$LIVE"/*.png 2>/dev/null | sort)
fi
if [[ ${#LIVE_FRAMES[@]} -eq 0 ]]; then
  echo "!! no live frames found, falling back to single static intro"
  LIVE_FRAMES=("$SHOTS/intent-console.png")
fi
N_LIVE=${#LIVE_FRAMES[@]}
PER_FRAME=$(awk "BEGIN{printf \"%.4f\", $SCENE_SECONDS / $N_LIVE}")
LIVE_LIST="$TMP/live_list.txt"
: > "$LIVE_LIST"
for f in "${LIVE_FRAMES[@]}"; do
  echo "file '$f'"               >> "$LIVE_LIST"
  echo "duration $PER_FRAME"     >> "$LIVE_LIST"
done
LAST_IDX=$(( ${#LIVE_FRAMES[@]} - 1 ))
echo "file '${LIVE_FRAMES[$LAST_IDX]}'" >> "$LIVE_LIST"

LIVE_RAW="$TMP/scene_00_live_raw.mp4"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIVE_LIST" \
  -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a14,setsar=1,fps=${FPS}" \
  -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$LIVE_RAW"

LIVE_OVR="$OVR/scene_01.png"
LIVE_OUT="$TMP/scene_00.mp4"
ffmpeg -y -loglevel error -i "$LIVE_RAW" -loop 1 -t "$SCENE_SECONDS" -i "$LIVE_OVR" \
  -filter_complex "[1:v]scale=${W}:${H},format=rgba,setsar=1,fps=${FPS}[ovr];[0:v][ovr]overlay=0:0:format=auto[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} "$LIVE_OUT"

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
