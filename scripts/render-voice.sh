#!/usr/bin/env bash
# Generate the demo voiceover with macOS `say`, one AAC track aligned
# to scripts/build-demo.sh scene timing (SCENE_SECONDS=3, FADE=0.6).
# Output: docs/media/_overlays/voice.m4a
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/media/_overlays"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

VOICE="${PRISMOS_VOICE:-Samantha}"
RATE="${PRISMOS_RATE:-185}"

LINES=(
  "Prism O S. Local first. Explicit privacy controls."
  "Chat uses loopback model inference by default."
  "Approved knowledge and chats build your local graph."
  "Searchable on your device."
  "Modeled actions pass a bounded policy gate."
  "See how your interaction profile changes over time."
  "Open source. M I T. Runs on your laptop."
)

# Each scene is 3.0s; xfade overlaps 0.6s with the next.
# Speak ~1.6s starting 0.4s into each scene → ends well before the fade.
SCENE_SECONDS=3.0
START_OFFSET=0.4
SCENE_COUNT=${#LINES[@]}

i=0
for line in "${LINES[@]}"; do
  base="$TMP/v$(printf '%02d' $i)"
  say -v "$VOICE" -r "$RATE" -o "$base.aiff" "$line"
  # Convert to wav for predictable concat
  ffmpeg -y -loglevel error -i "$base.aiff" -ar 44100 -ac 2 "$base.wav"
  i=$((i+1))
done

# Build a silent base track for the full duration, then mix each voice clip
# in at its scene offset.
TOTAL=$(awk "BEGIN{printf \"%.2f\", $SCENE_COUNT * $SCENE_SECONDS - ($SCENE_COUNT - 1) * 0.6}")
ffmpeg -y -loglevel error -f lavfi -t "$TOTAL" -i "anullsrc=r=44100:cl=stereo" \
  -c:a pcm_s16le "$TMP/silence.wav"

# Build complex filter: [0] silence base, [1..N] voice clips with adelay.
inputs=( -i "$TMP/silence.wav" )
filter=""
mix_inputs="[0:a]"
for ((k=0; k<SCENE_COUNT; k++)); do
  inputs+=( -i "$TMP/v$(printf '%02d' $k).wav" )
  # scene k starts at k*(SCENE_SECONDS - 0.6) seconds
  offset=$(awk "BEGIN{printf \"%.3f\", $k * ($SCENE_SECONDS - 0.6) + $START_OFFSET}")
  ms=$(awk "BEGIN{printf \"%d\", $offset * 1000}")
  filter+="[$((k+1)):a]adelay=${ms}|${ms},volume=0.95[a${k}];"
  mix_inputs+="[a${k}]"
done
filter+="${mix_inputs}amix=inputs=$((SCENE_COUNT+1)):normalize=0:dropout_transition=0[aout]"

ffmpeg -y -loglevel error "${inputs[@]}" \
  -filter_complex "$filter" -map "[aout]" \
  -c:a aac -b:a 128k "$OUT/voice.m4a"

echo "✓ wrote $OUT/voice.m4a (duration ${TOTAL}s)"
