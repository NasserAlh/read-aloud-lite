// Read Aloud Lite - service worker
// All speech goes through chrome.tts, which talks to the speech engines
// installed on the operating system. Nothing leaves the machine.

const DEFAULTS = { voiceName: "", rate: 1.0, pitch: 1.0 };

// --- playback state ----------------------------------------------------

const BADGE = {
  idle: { text: "", color: "#245ea8" },
  speaking: { text: "▶", color: "#245ea8" },
  paused: { text: "II", color: "#6b6f76" }
};

let state = "idle";

// Bumped on every new read and on stop, so callbacks belonging to an
// utterance that has since been superseded can be recognised and ignored.
let session = 0;

function setState(next) {
  state = next;
  chrome.action.setBadgeText({ text: BADGE[next].text });
  chrome.action.setBadgeBackgroundColor({ color: BADGE[next].color });
  chrome.runtime.sendMessage({ type: "state", state: next }).catch(() => {});
}

function stopSpeech() {
  session++;
  chrome.tts.stop();
  setState("idle");
}

// The service worker can be evicted mid-utterance while the speech engine
// keeps going, so trust the engine rather than the reset variable on startup.
chrome.tts.isSpeaking((speaking) => setState(speaking ? "speaking" : "idle"));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-selection",
    title: "Read aloud",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "read-page",
    title: "Read this page aloud",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "stop",
    title: "Stop reading",
    contexts: ["page", "selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "stop") return stopSpeech();
  if (info.menuItemId === "read-selection" && info.selectionText) {
    return speak(info.selectionText);
  }
  if (info.menuItemId === "read-page" && tab) {
    return readPage(tab.id);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "stop-reading") return stopSpeech();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const selection = await getSelection(tab.id);
  if (selection) return speak(selection);
  return readPage(tab.id);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Synchronous transport controls: answer immediately.
  if (msg.type === "get-state") {
    sendResponse({ state });
    return false;
  }
  if (msg.type === "stop") {
    stopSpeech();
    sendResponse({ state });
    return false;
  }
  if (msg.type === "pause") {
    chrome.tts.pause();
    setState("paused");
    sendResponse({ state });
    return false;
  }
  if (msg.type === "resume") {
    chrome.tts.resume();
    setState("speaking");
    sendResponse({ state });
    return false;
  }

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return sendResponse({ error: "No active tab." });
    if (msg.type === "read-page") {
      await readPage(tab.id);
      return sendResponse({ ok: true });
    }
    if (msg.type === "read-selection") {
      const selection = await getSelection(tab.id);
      if (!selection) return sendResponse({ error: "Nothing is selected on this page." });
      await speak(selection);
      return sendResponse({ ok: true });
    }
    sendResponse({ ok: true });
  })();
  return true; // keep the message channel open for the async reply
});

// --- page text ---------------------------------------------------------

async function getSelection(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection() || "").trim()
    });
    return result?.result || "";
  } catch (e) {
    return "";
  }
}

async function readPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractReadableText
  });
  const text = result?.result || "";
  if (text) speak(text);
}

// Runs inside the page. Prefers the article body, falls back to the body text,
// and drops chrome that would be noise when spoken.
function extractReadableText() {
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;
  if (!root) return "";
  const clone = root.cloneNode(true);
  clone
    .querySelectorAll("script, style, noscript, nav, header, footer, aside, form, svg, button")
    .forEach((el) => el.remove());
  return clone.innerText.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- speech ------------------------------------------------------------

async function speak(text) {
  const mine = ++session;
  chrome.tts.stop();
  const opts = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  if (mine !== session) return; // a newer request arrived while we loaded settings
  const chunks = chunk(text);
  if (!chunks.length) return;
  setState("speaking");
  const last = chunks.length - 1;
  chunks.forEach((part, i) => {
    const options = {
      rate: Number(opts.rate),
      pitch: Number(opts.pitch),
      enqueue: i > 0,
      onEvent: (e) => onSpeechEvent(e, mine, i === last)
    };
    if (opts.voiceName) options.voiceName = opts.voiceName;
    else options.lang = guessLang(part);
    chrome.tts.speak(part, options);
  });
}

// Only the final chunk's "end" means the queue has drained. Events from a
// superseded read carry a stale session and are dropped.
function onSpeechEvent(e, mine, isLast) {
  if (mine !== session) return;
  if (e.type === "error" || e.type === "interrupted" || e.type === "cancelled") {
    setState("idle");
  } else if (e.type === "end" && isLast) {
    setState("idle");
  }
}

// Local speech engines truncate or stall on very long utterances, so the text
// is broken at sentence boundaries and queued piece by piece.
function chunk(text, max = 240) {
  const sentences = text.match(/[^.!?\u061F\u06D4\n]+[.!?\u061F\u06D4]*\s*|\n+/g) || [text];
  const out = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > max && buf) {
      out.push(buf.trim());
      buf = "";
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

// Picks a language hint when no specific voice is pinned, so Arabic passages
// are not read by an English voice.
function guessLang(text) {
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabic > text.length * 0.2 ? "ar" : "en-US";
}
