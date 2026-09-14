# Enhancements

Proposed follow-up work, ordered by value. Nothing here is required for the
extension to function — v1.0.0 is complete against its original spec. Items 1
and 2 fix actual defects; the rest add capability.

## 1. Per-language voice pinning

**Problem.** Pinning a voice disables language detection entirely. In
[background.js:111-112](../src/background.js#L111-L112):

```js
if (opts.voiceName) options.voiceName = opts.voiceName;
else options.lang = guessLang(part);
```

Because `voiceName` and `lang` are mutually exclusive, choosing "Microsoft
David" means Arabic passages are handed to an English voice — they come out as
garbage or silence. The auto-detect path only works while no voice is pinned,
which is the one case where the user has expressed no preference.

**Fix.** Store two settings, `voiceEn` and `voiceAr`, and select per chunk
using the existing `guessLang()` result. Fall back to `lang` when the relevant
slot is empty. The popup needs a second dropdown, or one dropdown plus a
language toggle.

**Effort.** Small. ~20 lines across `background.js` and `popup.js`, plus markup.

## 2. Surface failures instead of going silent

**Problem.** `readPage()` at [background.js:75-82](../src/background.js#L75-L82) calls
`chrome.scripting.executeScript` with no try/catch, unlike `getSelection()`
which guards at [background.js:63-73](../src/background.js#L63-L73). On a `chrome://`
page, the Web Store, or a PDF, the rejection is swallowed by the async IIFE in
the message handler, `sendResponse` never runs, and the popup status line stays
blank. The user gets no speech and no explanation.

The empty-extraction case has the same shape: `if (text) speak(text)` at
[background.js:81](../src/background.js#L81) exits quietly when a page yields nothing.

**Fix.** Wrap the `executeScript` call, and return a message the popup can
display — "This page does not allow reading" for the restricted case, "No
readable text found on this page" for the empty case. Route the context-menu
and keyboard paths through the same handling so they are not silent either.

**Effort.** Small. Mostly error plumbing already modelled by `getSelection`.

## 3. Playback state in the popup

**Problem.** The popup has no idea whether speech is active. Pause and Resume
are always enabled, and reopening the popup mid-read shows a neutral panel with
no indication anything is playing.

**Fix.** Query `chrome.tts.isSpeaking()` on popup open and enable or disable the
transport buttons accordingly. Add a toolbar badge while speech is active, via
`chrome.action.setBadgeText`, so state is visible without opening the popup.

**Effort.** Small to medium. The badge needs `chrome.tts.speak`'s `onEvent`
callback to know when the queue drains.

## 4. Sentence highlighting

The flagship feature for a reading tool: highlight the sentence, or word, as it
is spoken. `chrome.tts.speak` accepts an `onEvent` callback that reports
`word` and `sentence` boundary events with a `charIndex` into the utterance.
Windows SAPI voices generally emit word events, though this is worth confirming
per voice before committing to the design.

**Cost.** The largest item here by a wide margin. It needs a persistent content
script rather than a one-shot `executeScript`, a way to map chunk-relative
`charIndex` values back to DOM ranges in the original document, and a
highlighting layer that survives the page's own styling. The current
architecture extracts `innerText` and discards all positional information, so
extraction would need to be rebuilt to retain node offsets.

**Effort.** Large. Treat as a v2 project, not an increment.

## 5. Skip back / forward one sentence

The most-wanted control when attention drifts, and cheap given the existing
design: `chunk()` at [background.js:119-136](../src/background.js#L119-L136) already
produces an ordered array. Track the active index through `onEvent`, then
re-queue from `index - 1` or `index + 1` on demand.

**Effort.** Medium. Requires holding chunk state in the service worker and
tolerating its termination between utterances.

## Cleanup

The message handler calls `sendResponse` twice on the nothing-selected path —
once at [background.js:51](../src/background.js#L51) and again at the unconditional
[background.js:56](../src/background.js#L56). It works today because Chrome ignores the
second call, but it is fragile and should be an early return.

## Notes on scope

A keyboard shortcut for pause/resume is tempting, but Chrome grants only four
suggested-key slots per extension and two are already spent. Any addition
should be weighed against that budget.

Windows' "Natural" neural voices remain out of reach regardless of design.
They are not exposed to Chrome's TTS layer, and the Web Speech API does not
reach them either, so no amount of restructuring recovers them.
