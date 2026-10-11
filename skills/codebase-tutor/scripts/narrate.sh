#!/usr/bin/env bash
# narrate.sh [--play] <section.md> [output-basename]
# Best-effort text-to-speech: turns a tour section written for the ear into an
# audio file the learner can listen to. Tries local TTS engines in quality order.
# With --play, also plays the audio immediately via the first available player
# (afplay/paplay/aplay/mpv/ffplay); if none exists, it just prints the file path.
#
# IMPORTANT: feed this SPOKEN-STYLE text (short sentences, no tables). The script
# strips markdown syntax and REMOVES fenced code blocks entirely — code must be
# described in prose before this runs, never read aloud symbol-by-symbol.
#
# Exit codes:
#   0 = audio written (path printed)
#   1 = input problem
#   2 = no TTS engine available — fall back to in-chat spoken-style delivery
set -uo pipefail

play=0
if [ "${1:-}" = "--play" ]; then play=1; shift; fi

in="${1:?usage: narrate.sh [--play] <section.md> [output-basename]}"
base="${2:-${in%.*}}"
[ -f "$in" ] || { echo "FAIL: $in not found" >&2; exit 1; }

# Markdown -> speakable plain text: drop code fences, headings markers,
# emphasis, links (keep link text), list bullets, tables, checkpoint menus.
txt="$(mktemp)"
awk '
  /^```/ { infence = !infence; next }
  infence { next }
  /^\s*\|/ { next }              # tables do not speak well
  /^──/ { next }                 # checkpoint separators
  { print }
' "$in" \
  | sed -E 's/^#+ +//; s/\*\*([^*]*)\*\*/\1/g; s/\*([^*]*)\*/\1/g; s/`([^`]*)`/\1/g; s/\[([^]]*)\]\([^)]*\)/\1/g; s/^ *[-*+] +//; s/^ *[0-9]+\. +//' \
  > "$txt"

[ -s "$txt" ] || { echo "FAIL: nothing speakable after stripping markdown" >&2; rm -f "$txt"; exit 1; }

# Test/debug hook: print the stripped speakable text and exit (no TTS).
if [ "${NARRATE_TEXT_ONLY:-0}" = "1" ]; then cat "$txt"; rm -f "$txt"; exit 0; fi

done_msg() { # $1 = audio file, $2 = engine name
  rm -f "$txt"
  echo "OK: $1 ($2)"
  if [ "$play" = 1 ]; then
    played=0
    for p in afplay paplay aplay mpv ffplay; do
      command -v "$p" >/dev/null 2>&1 || continue
      case "$p" in
        mpv)    mpv --really-quiet "$1" >/dev/null 2>&1 & ;;
        ffplay) ffplay -nodisp -autoexit -loglevel quiet "$1" >/dev/null 2>&1 & ;;
        *)      "$p" "$1" >/dev/null 2>&1 & ;;
      esac
      pid=$!
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        # still running after 1s = genuinely playing
        echo "PLAYING: via $p (backgrounded)"
        played=1; break
      fi
      # exited within 1s: either finished a very short clip (rc 0) or died (no audio device/server)
      wait "$pid" 2>/dev/null
      if [ "$?" -eq 0 ]; then
        echo "PLAYED: via $p"
        played=1; break
      fi
      # rc != 0 → this player can't reach an audio device; try the next one
    done
    if [ "$played" = 0 ]; then
      echo "NOTE: audio saved to $1 but playback failed (no audio device/server reachable?) — tell the learner to open the file manually" >&2
    fi
  fi
  exit 0
}

if command -v piper >/dev/null 2>&1; then                    # local neural TTS, best quality
  piper --output_file "$base.wav" < "$txt" >/dev/null 2>&1 && done_msg "$base.wav" piper
fi
if command -v say >/dev/null 2>&1; then                      # macOS built-in
  say -f "$txt" -o "$base.aiff" >/dev/null 2>&1 && done_msg "$base.aiff" say
fi
if command -v espeak-ng >/dev/null 2>&1; then                # robotic but universal fallback
  espeak-ng -f "$txt" -w "$base.wav" >/dev/null 2>&1 && done_msg "$base.wav" espeak-ng
fi
if command -v powershell.exe >/dev/null 2>&1; then           # WSL: Windows built-in speech (speaks live, no file)
  if powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak([IO.File]::ReadAllText('$(wslpath -w "$txt" 2>/dev/null || echo "$txt")'))" >/dev/null 2>&1; then
    rm -f "$txt"
    echo "OK: spoken via Windows speech (WSL) — no audio file produced"
    exit 0
  fi
fi

rm -f "$txt"
hint="install a TTS engine"
if command -v apt-get >/dev/null 2>&1; then hint="try: sudo apt-get install espeak-ng   (or, for a much better voice: pipx install piper-tts)"
elif command -v dnf >/dev/null 2>&1; then hint="try: sudo dnf install espeak-ng   (or, for a much better voice: pipx install piper-tts)"
elif command -v pacman >/dev/null 2>&1; then hint="try: sudo pacman -S espeak-ng   (or, for a much better voice: pipx install piper-tts)"
elif command -v brew >/dev/null 2>&1; then hint="try: brew install espeak-ng"
fi
echo "SKIP: no TTS engine found (piper/say/espeak-ng) — deliver the spoken-style tour in chat instead. To enable audio: $hint" >&2
exit 2
