# Read Aloud Lite

A Manifest V3 Chrome extension that speaks the current page or any selected text using the speech voices already installed on your machine. No account, no API key, and no network traffic — as long as you pick a local voice. Some voices Chrome lists are marked "— network" in the Voice dropdown; picking one of those sends text to a remote synthesis service.

## Install (unpacked, no Web Store account needed)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Pin the extension from the puzzle-piece menu

Unpacked extensions survive browser restarts. Chrome shows a "Disable developer mode extensions" prompt on each startup — dismissing it is harmless.

## Use

| Action | How |
| --- | --- |
| Read selected text | Select text, right-click → **Read aloud** |
| Read the whole page | Right-click → **Read this page aloud**, or the popup button |
| Either, by keyboard | `Ctrl+Shift+U` — reads the selection if there is one, otherwise the page |
| Stop | `Ctrl+Shift+X`, or right-click → **Stop reading** |
| Pause / resume / speed / voice | Click the toolbar icon |

While speech is active the toolbar icon carries a badge — `▶` when reading, `II` when paused — and the popup greys out whichever transport buttons do not currently apply.

Shortcuts can be reassigned at `chrome://extensions/shortcuts`.

## Voices

The **Voice** dropdown lists every engine Chrome can see. Leave it on *Match the page language* and the extension picks Arabic for Arabic text and English otherwise.

To add voices on Windows 11: **Settings › Time & language › Language & region › Add a language**, then open the language's three-dot menu → **Language options** → install the **Speech** feature. Arabic (Kuwait / Saudi Arabia / Egypt) all ship SAPI voices.

Note that Windows' newer "Natural" neural voices are exposed to Edge but not always to Chrome's TTS layer, so Chrome may only offer the older-sounding SAPI set.

## Known limits

- Extensions cannot run on `chrome://` pages, the Web Store, or other extensions' pages.
- The Chrome PDF viewer does not expose text to `chrome.scripting`, so page-reading will not work on PDFs. Selection reading still works if the viewer lets you select.
- Long pages are split at sentence boundaries and queued, because local speech engines truncate very long utterances.

## Files

- `manifest.json` — permissions, context menus, keyboard commands
- `src/background.js` — service worker: text extraction, chunking, `chrome.tts` calls
- `src/popup.html` / `src/popup.css` / `src/popup.js` — toolbar controls
- `src/icons/` — `icon.svg` is the master artwork; the PNGs are exported from it, since Chrome does not accept SVG in the manifest
- `docs/ENHANCEMENTS.md` — proposed follow-up work

`manifest.json` stays at the root because Chrome requires it there; everything else lives under `src/`.
