const MODEL_URL = "./model.json";
let MODEL = null;
let latestPrediction = null;
const $ = (id) => document.getElementById(id);

async function loadModel() {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error("Could not load model.json");
  MODEL = await res.json();
}

function renderInputs() {
  const groups = {};
  MODEL.features.forEach(f => (groups[f.group] ||= []).push(f));
  const root = $("marketGroups");
  root.innerHTML = "";
  Object.entries(groups).forEach(([group, features], index) => {
    const details = document.createElement("details");
    details.className = "market";
    if (index === 0) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${group} · ${features.length} odds`;
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "marketbody";
    const grid = document.createElement("div");
    grid.className = "fieldgrid";
    features.forEach(f => {
      const field = document.createElement("div");
      field.className = "field";
      const label = document.createElement("label");
      label.htmlFor = `odds_${f.key}`;
      label.textContent = f.label;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1.01";
      input.step = "0.01";
      input.inputMode = "decimal";
      input.placeholder = "Decimal odds";
      input.id = `odds_${f.key}`;
      input.dataset.feature = f.key;
      input.autocomplete = "off";
      field.append(label, input);
      grid.appendChild(field);
    });
    body.appendChild(grid);
    details.appendChild(body);
    root.appendChild(details);
  });
}

function getOdds() {
  const vals = {};
  const missing = [];
  MODEL.features.forEach(f => {
    const raw = $(`odds_${f.key}`).value.trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n) || n <= 1) missing.push(f.label);
    vals[f.key] = n;
  });
  return { vals, missing };
}

function poisson(k, lambda) {
  if (lambda === 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function predict() {
  if (!MODEL) return;
  const { vals, missing } = getOdds();
  if (missing.length) {
    $("inputStatus").textContent = `Please enter valid decimal odds for all 14 inputs. Missing/invalid: ${missing.join(", ")}.`;
    $("inputStatus").classList.add("error");
    return;
  }
  $("inputStatus").textContent = "All 14 inputs validated.";
  $("inputStatus").classList.remove("error");

  const x = MODEL.features.map(f => vals[f.key]);
  const rawHome = MODEL.intercepts.home + x.reduce((sum, v, i) => sum + v * MODEL.coefficients.home[i], 0);
  const rawAway = MODEL.intercepts.away + x.reduce((sum, v, i) => sum + v * MODEL.coefficients.away[i], 0);

  // A goal rate cannot be negative. Keep the raw regression estimate visible in the note.
  const lambdaHome = Math.max(0, rawHome);
  const lambdaAway = Math.max(0, rawAway);

  let best = { home: 0, away: 0, probability: -1 };
  let gridTotal = 0;
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const probability = poisson(h, lambdaHome) * poisson(a, lambdaAway);
      gridTotal += probability;
      if (probability > best.probability) best = { home: h, away: a, probability };
    }
  }

  const homeTeam = $("homeTeam").value.trim() || "Home";
  const awayTeam = $("awayTeam").value.trim() || "Away";
  latestPrediction = {
    id: Date.now(),
    date: new Date().toISOString(),
    homeTeam, awayTeam,
    score: `${best.home}-${best.away}`,
    homeGoals: best.home, awayGoals: best.away,
    lambdaHome, lambdaAway, rawHome, rawAway,
    topProbability: best.probability,
    inputs: vals,
    actual: ""
  };

  $("fixtureName").textContent = `${homeTeam} vs ${awayTeam}`;
  $("score").textContent = latestPrediction.score;
  $("homeLambda").textContent = lambdaHome.toFixed(2);
  $("awayLambda").textContent = lambdaAway.toFixed(2);
  $("topProb").textContent = `${(best.probability * 100).toFixed(1)}%`;
  $("inputCount").textContent = "14 / 14";
  let note = `Single highest-probability score from the independent-Poisson grid. Raw Ridge estimates: home ${rawHome.toFixed(3)}, away ${rawAway.toFixed(3)}.`;
  if (rawHome < 0 || rawAway < 0) note += " A negative raw goal estimate was clipped to zero because goal rates cannot be negative.";
  if (gridTotal < 0.995) note += ` The 0–8 score grid captures ${(gridTotal*100).toFixed(1)}% of the model probability mass; scores above 8 are omitted.`;
  note += " Probability is experimental and not calibrated.";
  $("modelNote").textContent = note;
  $("resultCard").classList.add("visible");
  $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem("oddsMatrixHistory") || "[]"); }
  catch { return []; }
}
function writeHistory(items) {
  localStorage.setItem("oddsMatrixHistory", JSON.stringify(items));
  renderHistory();
}
function savePrediction() {
  if (!latestPrediction) {
    $("inputStatus").textContent = "Calculate a prediction first.";
    $("inputStatus").classList.add("error");
    return;
  }
  const items = readHistory();
  items.unshift(latestPrediction);
  writeHistory(items.slice(0, 100));
  $("saveBtn").textContent = "Saved ✓";
  setTimeout(() => $("saveBtn").textContent = "Save prediction", 1300);
}
function renderHistory() {
  const items = readHistory();
  $("historyCount").textContent = items.length;
  $("exactHits").textContent = items.filter(x => x.actual && x.actual === x.score).length;
  const host = $("historyList");
  host.innerHTML = "";
  if (!items.length) { host.textContent = "No saved predictions yet."; return; }
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "history-item";
    const left = document.createElement("div");
    const strong = document.createElement("b");
    strong.textContent = `${item.homeTeam} vs ${item.awayTeam}`;
    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = `${new Date(item.date).toLocaleString()} · λ ${item.lambdaHome.toFixed(2)}–${item.lambdaAway.toFixed(2)}`;
    left.append(strong, meta);
    const right = document.createElement("div");
    right.className = "history-score";
    right.textContent = item.score;
    row.append(left, right);
    const actualWrap = document.createElement("div");
    actualWrap.className = "actual-entry";
    const actual = document.createElement("input");
    actual.type = "text";
    actual.placeholder = "Actual score e.g. 2-1";
    actual.value = item.actual || "";
    actual.setAttribute("aria-label", `Actual score for ${item.homeTeam} vs ${item.awayTeam}`);
    const save = document.createElement("button");
    save.className = "mini";
    save.textContent = "Set result";
    save.addEventListener("click", () => {
      const m = actual.value.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (actual.value.trim() && !m) { actual.focus(); return; }
      const value = m ? `${+m[1]}-${+m[2]}` : "";
      const updated = readHistory();
      const found = updated.find(x => x.id === item.id);
      if (found) found.actual = value;
      writeHistory(updated);
    });
    actualWrap.append(actual, save);
    const container = document.createElement("div");
    container.append(row, actualWrap);
    host.appendChild(container);
  });
}
function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}
function downloadCsv() {
  const items = readHistory();
  if (!items.length) return alert("There are no saved predictions to export.");
  const headers = ["date","homeTeam","awayTeam","predictedScore","actualScore","lambdaHome","lambdaAway","topProbability"];
  const lines = [headers.join(",")];
  items.forEach(x => lines.push([
    x.date,x.homeTeam,x.awayTeam,x.score,x.actual,x.lambdaHome,x.lambdaAway,x.topProbability
  ].map(csvEscape).join(",")));
  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "odds-matrix-prediction-history.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function clearInputs() {
  document.querySelectorAll("#marketGroups input").forEach(i => i.value = "");
  $("homeTeam").value = ""; $("awayTeam").value = "";
  $("inputStatus").textContent = "Inputs cleared. Enter all 14 decimal odds.";
  $("inputStatus").classList.remove("error");
  $("resultCard").classList.remove("visible");
  latestPrediction = null;
  if ($("ocrReport")) { $("ocrReport").textContent = ""; $("ocrText").value = ""; }
}
function fillDemo() {
  const demo = [1.12,6.37,1.59,2.38,2.78,1.45,5.66,1.48,2.66,3.24,1.35,8.49,1.07,17.14];
  MODEL.features.forEach((f,i) => $(`odds_${f.key}`).value = demo[i]);
  $("homeTeam").value = "VIL";
  $("awayTeam").value = "RCD";
  $("inputStatus").textContent = "Demo values loaded. These are example inputs, not a live fixture feed.";
  $("inputStatus").classList.remove("error");
}
// Register the service worker immediately (the page "load" event has often
// already fired by the time the model is loaded, so waiting for it meant the
// worker was never registered and offline mode never worked).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});

// ============================================================
// Screenshot reading (uses ocr.js)
// ============================================================
let OCR_RESULT = null;

function showOcrReport(res) {
  const lines = [];
  const found = MODEL.features.filter(f => res.inputs[f.key]);
  const missing = MODEL.features.filter(f => !res.inputs[f.key]);
  const name = f => `${f.group === "Home team goals" ? "Home" : "Away"} ${f.label}`;
  lines.push(`Found ${found.length} of ${MODEL.features.length} inputs.` +
    (res.teams ? ` Match: ${res.teams.home} vs ${res.teams.away}.` : ""));
  const rep = found.filter(f => res.inputs[f.key].repaired);
  if (rep.length) {
    lines.push("", "CHECK THESE (OCR text was damaged and repaired):");
    rep.forEach(f => lines.push(`  ${name(f)}: ${res.inputs[f.key].odd.toFixed(2)}  (${res.inputs[f.key].why}; read "${res.inputs[f.key].repaired}")`));
  }
  if (missing.length) {
    lines.push("", "NOT FOUND (type these in, or add the Home/Away Team O/U screenshot):");
    missing.forEach(f => lines.push(`  ${name(f)}${res.problems[f.key] ? " - " + res.problems[f.key] : ""}`));
  }
  lines.push("", "Read:");
  found.forEach(f => lines.push(`  ${name(f)}: ${res.inputs[f.key].odd.toFixed(2)}`));
  $("ocrReport").textContent = lines.join("\n");
}

async function runOcr() {
  const files = [...($("ocrFiles").files || [])];
  if (!files.length) { $("ocrStatus").textContent = "Choose at least one screenshot first."; return; }
  $("runOcrBtn").disabled = true;
  try {
    const res = await readScreenshots(files, msg => $("ocrStatus").textContent = msg);
    OCR_RESULT = res;
    $("ocrText").value = res.text;
    showOcrReport(res);
    fillFromOcr(res);
  } catch (e) {
    $("ocrStatus").textContent = "OCR failed: " + e.message;
    $("ocrStatus").classList.add("error");
  } finally {
    $("runOcrBtn").disabled = false;
  }
}

// Fill the 14 fields straight away. Fields not found are cleared so odds from
// a previous match can never be mixed into this one.
function fillFromOcr(res) {
  MODEL.features.forEach(f => {
    const v = res.inputs[f.key];
    $(`odds_${f.key}`).value = v ? v.odd.toFixed(2) : "";
  });
  document.querySelectorAll("#marketGroups details").forEach(d => d.open = true);
  if (res.teams) { $("homeTeam").value = res.teams.home; $("awayTeam").value = res.teams.away; }
  const n = Object.keys(res.inputs).length;
  $("ocrStatus").classList.remove("error");
  $("ocrStatus").textContent = n === MODEL.features.length
    ? `All ${n} inputs filled${res.teams ? ` for ${res.teams.home} vs ${res.teams.away}` : ""}. Check any repaired values, then tap Predict score.`
    : `${n} of ${MODEL.features.length} inputs filled. Type the missing ones (see report), then tap Predict score.`;
  latestPrediction = null;
  $("resultCard").classList.remove("visible");
}

function setupOcr() {
  $("runOcrBtn").addEventListener("click", runOcr);
  $("copyOcrBtn").addEventListener("click", () => {
    if (!$("ocrText").value) return;
    navigator.clipboard?.writeText($("ocrText").value).then(
      () => alert("OCR text copied."), () => alert("Copy not available in this browser."));
  });
}

function init() {
  loadModel().then(() => {
    renderInputs();
    renderHistory();
    $("predictBtn").addEventListener("click", predict);
    $("clearBtn").addEventListener("click", clearInputs);
    $("demoBtn").addEventListener("click", fillDemo);
    $("saveBtn").addEventListener("click", savePrediction);
    $("exportBtn").addEventListener("click", downloadCsv);
    $("clearHistoryBtn").addEventListener("click", () => {
      if (confirm("Delete all saved predictions from this device?")) {
        localStorage.removeItem("oddsMatrixHistory"); renderHistory();
      }
    });
    setupOcr();
  }).catch(err => {
    $("inputStatus").textContent = `App could not load its model: ${err.message}`;
    $("inputStatus").classList.add("error");
  });
}
init();
