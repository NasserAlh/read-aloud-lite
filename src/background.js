// Read Aloud Lite - service worker
// All speech goes through chrome.tts, which talks to the speech engines
// installed on the operating system. Nothing leaves the machine.

const DEFAULTS = { voiceName: "", rate: 1.0, pitch: 1.0 };

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
  if (info.menuItemId === "stop") return chrome.tts.stop();
  if (info.menuItemId === "read-selection" && info.selectionText) {
    return speak(info.selectionText);
  }
  if (info.menuItemId === "read-page" && tab) {
    return readPage(tab.id);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "stop-reading") return chrome.tts.stop();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const selection = await getSelection(tab.id);
  if (selection) return speak(selection);
  return readPage(tab.id);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (msg.type === "read-page" && tab) await readPage(tab.id);
    if (msg.type === "read-selection" && tab) {
      const selection = await getSelection(tab.id);
      if (selection) await speak(selection);
      else sendResponse({ error: "Nothing is selected on this page." });
    }
    if (msg.type === "stop") chrome.tts.stop();
    if (msg.type === "pause") chrome.tts.pause();
    if (msg.type === "resume") chrome.tts.resume();
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
  chrome.tts.stop();
  const opts = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  const chunks = chunk(text);
  chunks.forEach((part, i) => {
    const options = {
      rate: Number(opts.rate),
      pitch: Number(opts.pitch),
      enqueue: i > 0
    };
    if (opts.voiceName) options.voiceName = opts.voiceName;
    else options.lang = guessLang(part);
    chrome.tts.speak(part, options);
  });
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
