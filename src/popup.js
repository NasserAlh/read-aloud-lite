const $ = (id) => document.getElementById(id);
const status = $("status");

const LABEL = { idle: "", speaking: "Reading…", paused: "Paused" };

let playback = "idle";
let error = "";

// Called both from the reply to an action and from the worker's broadcasts,
// which can arrive in either order, so the last known state is kept locally.
function render(next) {
  if (next) playback = next;
  $("pause").disabled = playback !== "speaking";
  $("resume").disabled = playback !== "paused";
  $("stop").disabled = playback === "idle";
  status.textContent = error || LABEL[playback];
}

async function init() {
  const saved = await chrome.storage.local.get({ voiceName: "", rate: 1, pitch: 1 });
  $("rate").value = saved.rate;
  $("pitch").value = saved.pitch;
  $("rate-out").textContent = Number(saved.rate).toFixed(1) + "×";
  $("pitch-out").textContent = Number(saved.pitch).toFixed(1);

  chrome.tts.getVoices((voices) => {
    const select = $("voice");
    voices
      .filter((v) => v.voiceName)
      .sort((a, b) => (a.lang || "").localeCompare(b.lang || ""))
      .forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.voiceName;
        opt.textContent = `${v.voiceName} (${v.lang || "?"})${v.remote ? " — network" : ""}`;
        select.appendChild(opt);
      });
    select.value = saved.voiceName;
    if (voices.length === 0) {
      error = "No speech voices found. Install a voice in Windows Settings › Time & language › Speech.";
    }
    render();
  });

  chrome.runtime.sendMessage({ type: "get-state" }, (res) => {
    if (chrome.runtime.lastError) return;
    render(res?.state);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state") render(msg.state);
});

$("rate").addEventListener("input", (e) => {
  $("rate-out").textContent = Number(e.target.value).toFixed(1) + "×";
  chrome.storage.local.set({ rate: Number(e.target.value) });
});

$("pitch").addEventListener("input", (e) => {
  $("pitch-out").textContent = Number(e.target.value).toFixed(1);
  chrome.storage.local.set({ pitch: Number(e.target.value) });
});

$("voice").addEventListener("change", (e) => {
  chrome.storage.local.set({ voiceName: e.target.value });
});

const send = (type) => chrome.runtime.sendMessage({ type }, (res) => {
  if (chrome.runtime.lastError) return;
  error = res?.error || "";
  render(res?.state);
});

$("read-selection").addEventListener("click", () => send("read-selection"));
$("read-page").addEventListener("click", () => send("read-page"));
$("pause").addEventListener("click", () => send("pause"));
$("resume").addEventListener("click", () => send("resume"));
$("stop").addEventListener("click", () => send("stop"));

init();
