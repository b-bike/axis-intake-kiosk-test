/* Axis PT Intake Kiosk — app logic
   Privacy: patient name and progress live in page memory. While the WebPT step is open,
   a copy is kept in sessionStorage (this tab only, never localStorage/cookies) so the
   patient can come back and continue even if the browser reloaded the page. Every reset
   clears it and reloads the page. */
(function () {
  "use strict";
  const C = window.KIOSK_CONFIG;
  // Defaults guard against a stale cached config.js missing newer settings.
  const T = Object.assign({ patientQuestionSec: 200, patientLockSec: 320, formQuestionSec: 200, staffResetSec: 120,
    lockAutoResetMin: 30, doneAutoResetSec: 90, iframeLoadSec: 20 }, C.timeouts || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PATIENT_SCREENS = ["hello", "form", "webpt", "webptframe"];
  const STAFF_SCREENS = ["setup", "scan", "summary"];

  let S = freshState();
  function freshState() { return { first: "", last: "", dob: "", steps: [], idx: 0, webptUrl: "", status: {}, pausedFrom: "" }; }

  /* ---------- Branding ---------- */
  document.querySelectorAll("[data-logo]").forEach((i) => {
    i.onerror = () => (i.style.visibility = "hidden"); // never show a broken-image icon to patients
    i.src = C.logo;
  });

  /* ---------- Screen routing ---------- */
  let current = "idle";
  function show(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $("s-" + name).classList.add("active");
    current = name;
    armIdle();
  }

  /* ---------- Modal ---------- */
  let modalOpen = false;
  function confirmBox(title, body, yes, no) {
    return new Promise((res) => {
      $("modalTitle").textContent = title; $("modalBody").textContent = body;
      $("modalYes").textContent = yes;
      $("modalNo").textContent = no || ""; $("modalNo").classList.toggle("hidden", !no);
      $("modal").classList.remove("hidden"); modalOpen = true;
      const done = (v) => { closeModal(); res(v); };
      $("modalYes").onclick = () => done(true); $("modalNo").onclick = () => done(false);
    });
  }
  function closeModal() { $("modal").classList.add("hidden"); modalOpen = false; $("modalYes").onclick = $("modalNo").onclick = null; }

  /* ---------- Staff PIN ---------- */
  let pin = "", pinNext = "setup", pinReturn = "idle", fails = 0, lockUntil = 0;
  const keys = ["1","2","3","4","5","6","7","8","9","⌫","0","OK"];
  $("keypad").innerHTML = keys.map((k) => `<button data-k="${k}" aria-label="${k === "⌫" ? "Delete" : k}">${k}</button>`).join("");
  $("keypad").addEventListener("click", async (e) => {
    const k = e.target.dataset.k; if (!k) return;
    if (Date.now() < lockUntil) { $("pinError").textContent = "Too many tries. Wait a minute."; return; }
    if (k === "⌫") pin = pin.slice(0, -1);
    else if (k === "OK") return checkPin();
    else if (pin.length < 8) pin += k;
    drawPin();
  });
  function drawPin() { $("pinDots").innerHTML = "<span></span>".repeat(pin.length); }
  async function sha256(t) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function checkPin() {
    const ok = (await sha256(pin)) === C.staffPinSha256;
    pin = ""; drawPin();
    if (ok) { fails = 0; $("pinError").textContent = ""; pinNext === "setup" ? openSetup() : openSummary(); }
    else { fails++; $("pinError").textContent = "Incorrect PIN"; if (fails >= 5) { lockUntil = Date.now() + 60000; fails = 0; } }
  }
  document.querySelectorAll("[data-staff]").forEach((b) => b.addEventListener("click", () => {
    pinReturn = current;
    pinNext = current === "idle" ? "setup" : "summary";
    pin = ""; drawPin(); $("pinError").textContent = ""; show("pin");
  }));
  $("pinCancel").addEventListener("click", () => show(pinReturn));

  /* ---------- Setup: patient name + one list of forms (WebPT first) ---------- */
  const WEBPT = { id: "webpt", title: "WebPT patient intake", desc: "You'll scan the patient's WebPT QR code next", minutes: 10, url: "webpt" };
  function choices() { return (C.webpt.enabled ? [WEBPT] : []).concat(C.forms); }

  function openSetup() {
    S = freshState();
    $("firstName").value = ""; $("lastName").value = ""; $("dob").value = ""; $("setupError").textContent = "";
    $("formChecklist").innerHTML = choices().map((f) => {
      const ready = !!f.url;
      const price = ready && f.priceParam
        ? `<div class="price hidden" data-price-row="${esc(f.id)}"><label>${esc(f.pricePrompt || "Price")}
             <input data-price="${esc(f.id)}" inputmode="decimal" autocomplete="off" placeholder="e.g. 45"></label></div>` : "";
      return `<div class="fitem"><label><input type="checkbox" value="${esc(f.id)}" ${ready && f.checkedByDefault ? "checked" : ""} ${ready ? "" : "disabled"}>
        <span class="ftitle">${esc(f.title)}${f.desc ? `<small>${esc(f.desc)}</small>` : ""}</span>
        ${ready ? "" : '<span class="muted">not set up yet</span>'}</label>${price}</div>`;
    }).join("");
    syncSetup();
    show("setup");
    setTimeout(() => $("firstName").focus(), 150);
  }
  function chosenIds() { return [...document.querySelectorAll("#formChecklist input:checked")].map((i) => i.value); }
  function syncSetup() {
    document.querySelectorAll("#formChecklist input[type=checkbox]").forEach((cb) => {
      const row = document.querySelector(`[data-price-row="${cb.value}"]`);
      if (row) row.classList.toggle("hidden", !cb.checked);
    });
    $("setupDone").textContent = chosenIds().includes("webpt") ? "Continue → scan WebPT code" : "Ready — hand to patient";
  }
  $("formChecklist").addEventListener("change", syncSetup);
  // Setup "Cancel" (and any other [data-go] button) goes back to that screen.
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.go === "idle") { S = freshState(); stopScan(); }
    show(b.dataset.go);
  }));
  // DOB: digits only, slashes added as staff type (MM/DD/YYYY).
  $("dob").addEventListener("input", () => {
    const d = $("dob").value.replace(/\D/g, "").slice(0, 8);
    $("dob").value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  });
  // "MM/DD/YYYY" -> "YYYY-MM-DD" (what Microsoft Forms accepts), "" if blank, null if invalid.
  function dobIso(v) {
    v = v.trim(); if (!v) return "";
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v); if (!m) return null;
    const mo = +m[1], d = +m[2], y = +m[3], dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d || y < 1900 || dt > new Date()) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  $("setupDone").addEventListener("click", () => {
    const first = $("firstName").value.trim(), last = $("lastName").value.trim();
    const chosen = chosenIds();
    if (!first || !last) return ($("setupError").textContent = "Enter the patient's first and last name.");
    const dob = dobIso($("dob").value);
    if (dob === null) return ($("setupError").textContent = "Date of birth should look like 04/23/1985 (or leave it blank).");
    if (!chosen.length) return ($("setupError").textContent = "Pick at least one form.");
    const prices = {};
    for (const id of chosen) {
      const inp = document.querySelector(`[data-price="${id}"]`);
      if (!inp) continue;
      const v = inp.value.trim().replace(/^\$/, "");
      if (!/^\d+(\.\d{1,2})?$/.test(v)) {
        const f = C.forms.find((x) => x.id === id);
        return ($("setupError").textContent = `Enter the ${f.pricePrompt || "price"} for ${f.title} (numbers only).`);
      }
      prices[id] = v;
    }
    S.first = first; S.last = last; S.dob = dob; S.webptUrl = "";
    const forms = C.forms.filter((f) => chosen.includes(f.id));
    S.steps = forms.map((f) => ({ type: "form", id: f.id, title: f.title, url: f.url, minutes: f.minutes || 3,
      nameParam: f.nameParam || "", dobParam: f.dobParam || "", priceParam: f.priceParam || "", price: prices[f.id] || "" }));
    if (chosen.includes("webpt")) {
      const w = { type: "webpt", id: "webpt", title: WEBPT.title, minutes: WEBPT.minutes };
      C.webpt.position === "last" ? S.steps.push(w) : S.steps.unshift(w);
    }
    S.status = {}; S.steps.forEach((st) => (S.status[st.id] = "pending"));
    $("setupError").textContent = "";
    chosen.includes("webpt") ? openScan() : goHello();
  });

  function goHello() {
    const n = S.steps.length;
    const mins = S.steps.reduce((a, s) => a + (s.minutes || 3), 0);
    $("helloName").textContent = S.first;
    $("helloSummary").textContent = `You have ${n} form${n > 1 ? "s" : ""} to complete. It takes about ${mins} minutes.`;
    $("helloYes").textContent = `Yes, I'm ${S.first} ${S.last.charAt(0)}. — Start`;
    show("hello");
  }

  /* ---------- WebPT QR scan (staff, after setup) ---------- */
  function validWebpt(u) {
    try {
      const url = new URL(String(u).trim());
      if (url.protocol !== "https:") return false;
      const hosts = C.webpt.allowedHosts || [];
      return hosts.length === 0 || hosts.some((h) => url.hostname === h || url.hostname.endsWith("." + h));
    } catch { return false; }
  }
  let stream = null, scanTimer = null;
  function openScan() {
    $("scanLive").classList.remove("hidden"); $("scanOk").classList.add("hidden");
    $("scanManual").classList.add("hidden"); $("webptUrl").value = ""; $("scanStatus").textContent = "";
    $("scanHand").disabled = true;
    show("scan");
    startCamera();
  }
  async function startCamera() {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices) {
      $("scanStatus").textContent = "Camera scanning isn't available on this browser. Type the link instead.";
      $("scanManual").classList.remove("hidden");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const v = $("scanVideo"); v.srcObject = stream; await v.play();
      const det = new BarcodeDetector({ formats: ["qr_code"] });
      scanTimer = setInterval(async () => {
        try {
          const codes = await det.detect(v);
          if (!codes.length) return;
          const val = codes[0].rawValue;
          if (validWebpt(val)) scanned(val);
          else $("scanStatus").textContent = "That QR code isn't a WebPT link.";
        } catch (_) {}
      }, 300);
    } catch (e) {
      $("scanStatus").textContent = "Couldn't open the camera. Allow camera access for this page in Chrome.";
      $("scanManual").classList.remove("hidden");
    }
  }
  function stopScan() {
    clearInterval(scanTimer); scanTimer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null;
  }
  function scanned(url) {
    stopScan();
    S.webptUrl = url.trim();
    $("scanLive").classList.add("hidden"); $("scanOk").classList.remove("hidden");
    $("scanHand").disabled = false;
  }
  $("scanManualToggle").addEventListener("click", () => $("scanManual").classList.toggle("hidden"));
  $("scanManualUse").addEventListener("click", () => {
    const v = $("webptUrl").value.trim();
    validWebpt(v) ? scanned(v) : ($("scanStatus").textContent = "That doesn't look like a WebPT link.");
  });
  $("scanBack").addEventListener("click", () => { stopScan(); show("setup"); });
  $("scanHand").addEventListener("click", goHello);

  /* ---------- Patient flow ---------- */
  $("helloNo").addEventListener("click", () => show("wrong"));
  $("helloYes").addEventListener("click", () => { S.idx = 0; nextStep(); });

  function nextStep() {
    const st = S.steps[S.idx];
    if (!st) { clearResume(); return show("done"); }
    if (st.type === "webpt") return showWebpt(false);
    loadForm(st);
  }
  function advance(status) { S.status[S.steps[S.idx].id] = status; S.idx++; nextStep(); }

  function buildFormUrl(f) {
    const full = `${S.first} ${S.last}`;
    let u = f.url.split(encodeURIComponent(C.namePlaceholder)).join(encodeURIComponent(full))
                 .split(C.namePlaceholder).join(encodeURIComponent(full));
    const add = (k, v) => { u += (u.includes("?") ? "&" : "?") + encodeURIComponent(k) + "=" + encodeURIComponent(v); };
    if (f.nameParam) add(f.nameParam, full);          // pre-fill by question ID
    if (f.dobParam && S.dob) add(f.dobParam, S.dob);    // YYYY-MM-DD
    if (f.priceParam && f.price) add(f.priceParam, f.price);
    if (!/[?&]embed=true/.test(u)) add("embed", "true");
    return u;
  }

  let slowTimer = null;
  function loadForm(f) {
    const total = S.steps.length;
    $("stepLabel").textContent = `Step ${S.idx + 1} of ${total}`;
    $("formTitle").textContent = f.title;
    $("progressFill").style.width = (S.idx / total) * 100 + "%";
    $("frameLoading").classList.remove("hidden"); $("frameSlow").classList.add("hidden");
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => $("frameSlow").classList.remove("hidden"), T.iframeLoadSec * 1000);
    $("formFrame").src = buildFormUrl(f);
    // requireSubmit: no "Done" button. The patient either submits (the form's thank-you
    // message links to done.html, which tells this page to move on) or skips.
    $("nextBtn").classList.toggle("hidden", !!C.requireSubmit);
    $("formStaffBtn").classList.toggle("hidden", !C.requireSubmit);
    if (C.requireSubmit) $("formHint").innerHTML = "Use the form's own <strong>Next</strong> buttons, then tap <strong>Submit</strong> at the end. When you see the thank-you message, tap <strong>Tap here to continue</strong>. Or tap <strong>Skip this form</strong>.";
    show("form");
  }
  if (C.testMode) $("testBanner").classList.remove("hidden");
  // v8: forms load in a credentialless iframe so unsubmitted Microsoft Forms drafts
  // never carry over to the next patient. Warn staff if this Chrome is too old.
  if (!("credentialless" in HTMLIFrameElement.prototype)) {
    const w = document.createElement("div");
    w.textContent = "Warning: this browser doesn't support private form frames. Update Chrome on this tablet, or clear site data for forms.cloud.microsoft after any unfinished form.";
    w.style.cssText = "background:#fff3cd;color:#664d03;padding:10px 14px;margin:8px 0;border-radius:8px;font-size:15px";
    const host = document.getElementById("s-setup") || document.body;
    host.insertBefore(w, host.firstChild);
  }
  $("formFrame").addEventListener("load", () => {
    if ($("formFrame").src && $("formFrame").src !== "about:blank") { clearTimeout(slowTimer); $("frameLoading").classList.add("hidden"); }
  });
  $("frameRetry").addEventListener("click", () => loadForm(S.steps[S.idx]));

  // One tap: no "did you submit?" pop-up. The staff summary shows "Next tapped" so
  // staff can check SharePoint for the PDF if anything looks off.
  $("nextBtn").addEventListener("click", () => { $("formFrame").src = "about:blank"; advance("next"); });
  $("skipBtn").addEventListener("click", async () => {
    const ok = await confirmBox("Skip this form?", "Our staff will go over it with you instead.", "Skip it", "Go back");
    if (!ok) return;
    $("formFrame").src = "about:blank"; advance("skipped");
  });

  /* ---------- Submission confirmation (requireSubmit) ----------
     The form's thank-you message contains a link to done.html?f=<form id>. When the patient
     taps it, done.html posts {type:"axis-form-submitted", f} to this page (or, if the link
     opened a new tab, over a BroadcastChannel). Only the thank-you screen shows that link,
     so receiving the message means the form was submitted. */
  function onFormSubmitted(fid) {
    const st = S.steps[S.idx];
    if (!st || st.type === "webpt" || current !== "form") return;
    if (fid && fid !== st.id) return;                 // message for a different form: ignore
    $("formFrame").src = "about:blank"; advance("submitted");
  }
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data && e.data.type === "axis-form-submitted") onFormSubmitted(e.data.f);
  });
  try {
    new BroadcastChannel("axis-kiosk").onmessage = (e) => {
      if (e.data && e.data.type === "axis-form-submitted") onFormSubmitted(e.data.f);
    };
  } catch (_) {}
  // Staff escape hatch: patient submitted but the continue link failed. Reached through the
  // normal staff PIN -> summary screen.
  $("formStaffBtn").addEventListener("click", () => { S.pausedFrom = "form"; });
  $("staffDoneBtn").addEventListener("click", () => {
    S.pausedFrom = ""; $("formFrame").src = "about:blank"; advance("staffdone");
  });

  /* ---------- WebPT step (patient) ----------
     mode "frame" (default): WebPT loads inside this page, under the kiosk's own header and
     Continue button, so finishing never depends on finding a browser ✕ or back arrow.
     If WebPT won't display in the frame, "Form not showing?" switches to mode "tab":
     WebPT opens on top of this page and the patient comes back to a Continue screen
     (state kept in sessionStorage in case the browser reloads this page). */
  const FRAME = (C.webpt.mode || "frame") === "frame";
  function showWebpt(waiting) {
    $("webptStep").textContent = `Step ${S.idx + 1} of ${S.steps.length}`;
    $("webptHowBack").innerHTML = FRAME
      ? "When you finish, tap the blue <strong>Continue</strong> button at the bottom of the screen."
      : "When you finish, come back to this screen to continue.";
    $("webptIntro").classList.toggle("hidden", !!waiting);
    $("webptWait").classList.toggle("hidden", !waiting);
    show("webpt");
  }
  function saveResume() { try { sessionStorage.setItem("axisResume", JSON.stringify(S)); } catch (_) {} }
  function clearResume() { try { sessionStorage.removeItem("axisResume"); } catch (_) {} }
  function closeWebptFrame() { $("webptFrame").src = "about:blank"; }

  function openWebptTab() {
    closeWebptFrame();
    S.status.webpt = "opened";
    saveResume();
    const w = window.open(S.webptUrl, "_blank");
    if (w) { try { w.opener = null; } catch (_) {} showWebpt(true); }
    else location.href = S.webptUrl; // fallback: same tab, resume on return
  }
  function openWebptFrame() {
    S.status.webpt = "opened";
    $("wfStep").textContent = `Step ${S.idx + 1} of ${S.steps.length}`;
    $("wfLoading").classList.remove("hidden");
    $("webptFrame").src = S.webptUrl;
    show("webptframe");
  }
  $("webptFrame").addEventListener("load", () => { if ($("webptFrame").src !== "about:blank") $("wfLoading").classList.add("hidden"); });
  $("webptGo").addEventListener("click", () => (FRAME ? openWebptFrame() : openWebptTab()));
  $("webptSkip").addEventListener("click", () => { clearResume(); advance("skipped"); });
  $("webptReopen").addEventListener("click", () => { const w = window.open(S.webptUrl, "_blank"); if (!w) location.href = S.webptUrl; });
  $("webptDone").addEventListener("click", () => { clearResume(); advance("done"); });
  $("webptNotDone").addEventListener("click", async () => {
    const ok = await confirmBox("Move on without finishing?", "Our staff will help you finish your intake.", "Move on", "Go back");
    if (ok) { clearResume(); advance("incomplete"); }
  });
  $("wfDone").addEventListener("click", () => { closeWebptFrame(); clearResume(); advance("done"); });
  $("wfNotDone").addEventListener("click", async () => {
    const ok = await confirmBox("Move on without finishing?", "Our staff will help you finish your intake.", "Move on", "Go back");
    if (ok) { closeWebptFrame(); clearResume(); advance("incomplete"); }
  });
  $("wfFull").addEventListener("click", async () => {
    const ok = await confirmBox("Open the intake full screen?", "Your intake will open on top of this page. When you finish, close it to come back here.", "Open full screen", "Stay here");
    if (ok) openWebptTab();
  });

  // v12: one "Enlarge" toggle (100% <-> 130%). The frame is drawn narrower and scaled up
// from the top-left corner, so Microsoft Forms reflows to the smaller width instead of being clipped.
const ZOOM = 1.3; let zoomed = false;
function applyZoom() {
const z = zoomed ? ZOOM : 1, f = $("formFrame");
f.style.transformOrigin = "0 0";
f.style.width = f.style.height = (100 / z) + "%";
f.style.transform = z === 1 ? "" : "scale(" + z + ")";
$("zoomBtn").textContent = zoomed ? "Normal size" : "Enlarge";
$("zoomBtn").setAttribute("aria-pressed", String(zoomed));
}
$("zoomBtn").addEventListener("click", () => { zoomed = !zoomed; applyZoom(); });
applyZoom();

  /* ---------- Staff summary / unlock / reset ---------- */
  function openSummary() {
    const label = { done: "Done", next: "Done tapped", submitted: "Submitted (confirmed)", staffdone: "Marked done by staff", skipped: "Skipped", pending: "Not reached", opened: "Opened, not confirmed", incomplete: "Not finished", inprogress: "In progress" };
    const cls = { done: "done", next: "done", submitted: "done", staffdone: "done", skipped: "skipped", pending: "pending", opened: "pending", incomplete: "skipped", inprogress: "pending" };
    const cur = S.steps[S.idx];
    $("staffDoneBtn").classList.toggle("hidden", !(C.requireSubmit && S.pausedFrom === "form" && cur && cur.type !== "webpt" && S.status[cur.id] === "pending"));
    $("summaryList").innerHTML = S.steps.length
      ? S.steps.map((st, i) => { const s = (S.pausedFrom && i === S.idx && S.status[st.id] === "pending") ? "inprogress" : S.status[st.id]; return `<li><span>${esc(st.title)}</span><span class="tag ${cls[s] || "pending"}">${label[s] || s}</span></li>`; }).join("")
      : "<li>No session data.</li>";
    $("resumeBtn").classList.toggle("hidden", !S.pausedFrom);
    show("summary");
  }
  $("resumeBtn").addEventListener("click", () => { const back = S.pausedFrom; S.pausedFrom = ""; show(back); });
  $("resetBtn").addEventListener("click", hardReset);
  // v9: wipe everything in-page FIRST (so the screen is clean even if the reload below is
  // blocked or slow), then reload. ?r= forces a fresh load instead of a cached copy.
  function hardReset() {
    try { clearTimers(); } catch (_) {}
    try { closeModal(); } catch (_) {}
    try { stopScan(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    S = freshState();
    ["formFrame", "webptFrame"].forEach((id) => { try { $(id).src = "about:blank"; } catch (_) {} });
    ["firstName", "lastName", "dob", "webptUrl"].forEach((id) => { try { $(id).value = ""; } catch (_) {} });
    try { $("summaryList").innerHTML = ""; } catch (_) {}
    try { show("idle"); } catch (_) {}
    setTimeout(() => { try { location.replace(location.pathname + "?r=" + Date.now()); } catch (_) { location.reload(); } }, 50);
  }

  /* ---------- Inactivity ----------
     Patient screens: "Are you still there?" after patientQuestionSec, then the tablet
     pauses (locks) at patientLockSec. Staff unlock with the PIN and can continue.
     Form pages: touches INSIDE a Microsoft Form can't be seen by this page, so the
     question waits longer there (formQuestionSec) to avoid interrupting people mid-form.
     Staff screens reset to the welcome screen when left alone. */
  let idleTimer = null, lockTimer = null;
  function clearTimers() { clearTimeout(idleTimer); clearTimeout(lockTimer); }
  function armIdle() {
    clearTimers();
    if (current === "done") { idleTimer = setTimeout(hardReset, T.doneAutoResetSec * 1000); return; }
    if (current === "lock") { idleTimer = setTimeout(hardReset, T.lockAutoResetMin * 60000); return; }
    if (current === "pin") { idleTimer = setTimeout(() => show(pinReturn), 60000); return; }
    if (STAFF_SCREENS.includes(current)) { idleTimer = setTimeout(() => (S.pausedFrom ? lockNow() : hardReset()), T.staffResetSec * 1000); return; }
    if (!PATIENT_SCREENS.includes(current)) return;
    const inFrame = current === "form" || current === "webptframe"; // taps inside a frame are invisible to this page
    const q = inFrame ? T.formQuestionSec : T.patientQuestionSec;
    const lockAfter = inFrame ? T.formQuestionSec + (T.patientLockSec - T.patientQuestionSec) : T.patientLockSec;
    idleTimer = setTimeout(async () => {
      lockTimer = setTimeout(lockNow, (lockAfter - q) * 1000);
      await confirmBox("Are you still there?", "Tap below to keep going.", "I'm still here", "");
      if (current !== "lock") armIdle();
    }, q * 1000);
  }
  function lockNow() {
    clearTimers(); closeModal(); stopScan();
    if (PATIENT_SCREENS.includes(current)) S.pausedFrom = current;
    show("lock");
  }
  // While WebPT is on top, this page is hidden: pause timers so it can't lock mid-intake.
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimers(); else armIdle(); });
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => { if (!modalOpen) armIdle(); }, { passive: true }));

  /* ---------- Connectivity ---------- */
  const net = () => $("offline").classList.toggle("hidden", navigator.onLine);
  addEventListener("online", net); addEventListener("offline", net); net();

  /* Returning from WebPT after a same-tab hop? Restore and show the Continue screen. */
  let resumed = null;
  try { resumed = JSON.parse(sessionStorage.getItem("axisResume") || "null"); } catch (_) {}
  if (resumed && resumed.steps && resumed.steps[resumed.idx] && resumed.steps[resumed.idx].type === "webpt") {
    S = resumed; showWebpt(true);
  } else { clearResume(); show("idle"); }
})();
