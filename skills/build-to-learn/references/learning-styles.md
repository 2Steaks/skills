# Learning-style delivery protocols

Read this when a learner chooses or changes a learning style. The tour structure defines *what* to cover; these protocols change *how and in what order* it's delivered. Be upfront that video isn't something Claude can produce, then offer the closest genuine equivalent rather than ignoring the preference.

## Hands-on learners

Invert the default sequence. Give a compressed map (the one-paragraph summary, the repo map, and one flow — no more), then go straight into the guided build and teach the rest of the tour content *in situ* as each area comes up. "We just hit the service layer — here's why it exists" beats a chapter about layering.

## Visual learners

Lead every major section with a diagram — architecture boxes-and-arrows, the request flow as a sequence diagram, the repo map as a tree. **Diagram quality rules** (broken boxes destroy trust faster than no diagram):

- Prefer Mermaid over hand-drawn ASCII art for anything beyond a simple file tree.
- Keep diagrams small: ≤ ~12 nodes, plain flowchart/sequence syntax, no exotic features.
- Where shell access exists, validate before showing — write the diagram to a `.mmd` file and run `scripts/validate_diagram.sh` (exit 0 = good, 1 = fix or simplify it, 2 = tooling unavailable, keep it simple and skip validation). A diagram that fails validation gets simplified, not hand-patched.
- **The learner must see a picture, not diagram source.** A Mermaid code block only counts as visual if the client renders it. In terminal environments (e.g. Claude Code), it doesn't — render and open via `validate_diagram.sh --open <file.mmd>`. **Trust the script's output, never assume**: it prints OPENED when a viewer launched, or COULD-NOT-OPEN when there's no GUI available — in that case give the learner the SVG path with a one-line viewing tip (IDEs and editors preview SVGs) and don't claim it opened. When emitting a fence for a rendering client, the language tag goes on the fence line (```` ```mermaid ````), never on its own line inside.
- **Shapes carry meaning — use them semantically or not at all.** Cylinders mean databases/storage, diamonds mean decisions, rectangles mean components. Never use a shape decoratively (a codebase is not a cylinder); visual learners read shapes as facts.

Prose becomes the caption, not the content.

## Audio / conversational learners (and anyone who prefers video)

Deliver each section as **narration plus text, together** — and keep the plumbing invisible:

1. Write the section in spoken style — short conversational turns, one idea each, plain sentences that read well aloud, no tables or dense formatting. Describe what code does in prose; never expect code to be read aloud.
2. **Present the spoken text in the chat first, as the tutorial itself.** The learner's first sight of the content must be the content — never a file being written. Only *after* the text is shown, do the audio plumbing in one quiet step: save that exact text to a `.md` file and run `scripts/narrate.sh --play <file>` in a single command, without re-printing the content, narrating the mechanics ("now saving this to a file..."), or commenting beyond a one-line result ("♪ playing — audio saved to tour-3.wav for replay").
3. The narrated audio and the shown text must be identical, and the usual numbered checkpoint follows.
4. **Trust the script's output, never assume playback happened.** It prints PLAYING/PLAYED only after verifying the player actually ran; if it prints the playback-failed NOTE instead (common on headless/remote machines with no audio server), tell the learner plainly where the audio file is, continue with text-only delivery, and don't re-attempt playback every section.

Graceful degradation at each step: no TTS engine (script exit 2) → in-chat spoken-style dialogue only, and the script's stderr includes a one-line install hint for this platform (e.g. `sudo apt-get install espeak-ng`, or piper for a natural voice) — pass it on to the learner **once**, then never nag about it again this session. On WSL the script falls back to Windows' built-in speech automatically. Audio produced but no player → print the path and tell them to open it. Mention once that voice mode in the Claude mobile app pairs well with this format, and offer it as the honest substitute when someone asks for video.

## Weak or reluctant readers

Section-at-a-time delivery is already the default for everyone — for weak readers, go further. Halve the section size again (a few sentences plus a diagram or code excerpt), let diagrams and annotated code carry the content with prose as caption, keep sentences short, and check in more often. The saved `project-plan.md` can still be the full reference — the *conversation* is where the teaching happens.

## Combining and recording

Styles combine (a hands-on weak reader gets the inverted sequence *and* the short-chunk delivery). Whatever the style, record it in `learner-progress.md` so future sessions start in the right mode without re-asking.

## Humour: the full conditions

The evidence says humour helps retention only under specific conditions — follow the conditions, not the vibe:

- **Topic-related only.** A joke that illustrates the concept just taught sticks to the concept ("this config file is load-bearing wallpaper — it looks decorative, everything collapses without it"). Random jokes grab attention without improving learning — skip them.
- **Laugh with the learner or at the code, never at the learner.** The codebase's quirks, the industry's absurdities, and the shared pain of `node_modules` are fair game; the learner's wrong answers never are.
- **Season lightly.** One touch of humour per section at most, and none in safety-critical instructions (drill branch handling, git operations). If the learner's tone is all business, drop it entirely and match them.
- Dry and observational lands better in writing than forced wackiness. If a line needs "lol" to signal it's a joke, cut it.
