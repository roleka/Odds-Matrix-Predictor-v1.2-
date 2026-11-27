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

// Handicap rule: the side with more predicted goals gets the 2-goal start.
// Home (2:0) wins if home + 2 > away; Away (0:2) wins if away + 2 > home.
function handicapPick(predHome, predAway) {
  return predHome >= predAway ? "Home (2:0)" : "Away (0:2)";
}
function handicapWon(pick, h, a) {
  return pick.startsWith("Home") ? h + 2 > a : a + 2 > h;
}
function parseScore(text) {
  const m = String(text || "").trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  return m ? [+m[1], +m[2]] : null;
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

  // PCR (1 component) folded into one linear equation on the raw odds:
  // goals = intercept + sum(coefficient x odds)
  const x = MODEL.features.map(f => vals[f.key]);
  const rawHome = MODEL.intercepts.home + x.reduce((sum, v, i) => sum + v * MODEL.coefficients.home[i], 0);
  const rawAway = MODEL.intercepts.away + x.reduce((sum, v, i) => sum + v * MODEL.coefficients.away[i], 0);
  const lambdaHome = Math.max(0.05, rawHome);
  const lambdaAway = Math.max(0.05, rawAway);

  const pick = handicapPick(rawHome, rawAway);
  const gap = rawHome - rawAway;
  let pWin = 0, best = { home: 0, away: 0, probability: -1 };
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const p = poisson(h, lambdaHome) * poisson(a, lambdaAway);
      if (handicapWon(pick, h, a)) pWin += p;
      if (p > best.probability) best = { home: h, away: a, probability: p };
    }
  }
  const rounded = `${Math.max(0, Math.round(rawHome))}-${Math.max(0, Math.round(rawAway))}`;

  const homeTeam = $("homeTeam").value.trim() || "Home";
  const awayTeam = $("awayTeam").value.trim() || "Away";
  latestPrediction = {
    id: Date.now(), date: new Date().toISOString(), model: "PCR-1",
    homeTeam, awayTeam,
    pick, pickTeam: pick.startsWith("Home") ? homeTeam : awayTeam,
    pWin, gap,
    score: rounded, poissonScore: `${best.home}-${best.away}`,
    lambdaHome: rawHome, lambdaAway: rawAway,
    inputs: vals, actual: ""
  };

  $("fixtureName").textContent = `${homeTeam} vs ${awayTeam}`;
  $("pick").textContent = pick;
  $("pickTeam").textContent = `Back ${latestPrediction.pickTeam} with a 2-goal start`;
  $("pWin").textContent = `${(pWin * 100).toFixed(1)}%`;
  $("gap").textContent = (gap >= 0 ? "+" : "") + gap.toFixed(2);
  $("homeLambda").textContent = rawHome.toFixed(2);
  $("awayLambda").textContent = rawAway.toFixed(2);
  $("score").textContent = rounded;

  let note = `PCR (1 component) predicted goals: home ${rawHome.toFixed(3)}, away ${rawAway.toFixed(3)}. ` +
    `Win chance is the Poisson probability that the picked side does not lose by 2 or more; it runs cautious (about 90% on average while picks won 97% in testing).`;
  if (Math.abs(gap) < 0.10) note += " Close call: the model can barely separate the two teams.";
  if (rawHome < 0.05 || rawAway < 0.05) note += " A goal estimate below 0.05 was raised to 0.05 for the probability step.";
  note += " Experimental model (26 training matches); not calibrated.";
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
  const settled = items.filter(x => x.pick && parseScore(x.actual));
  const won = settled.filter(x => handicapWon(x.pick, ...parseScore(x.actual)));
  $("historyCount").textContent = items.length;
  $("hcHits").textContent = settled.length ? `${won.length} / ${settled.length}` : "0";
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
    const lh = Number(item.lambdaHome), la = Number(item.lambdaAway);
    meta.textContent = `${new Date(item.date).toLocaleString()} · goals ${lh.toFixed(2)}–${la.toFixed(2)}` +
      (item.pWin != null ? ` · win ${(item.pWin*100).toFixed(0)}%` : "");
    left.append(strong, meta);
    const right = document.createElement("div");
    right.className = "history-score";
    const sc = parseScore(item.actual);
    if (item.pick) {
      right.textContent = item.pick;
      if (sc) right.classList.add(handicapWon(item.pick, ...sc) ? "won" : "lost");
    } else {
      right.textContent = item.score; // older v1 record
    }
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
    save.textContent = sc && item.pick ? (handicapWon(item.pick, ...sc) ? "WON ✓" : "LOST ✗") : "Set result";
    save.addEventListener("click", () => {
      const m = parseScore(actual.value);
      if (actual.value.trim() && !m) { actual.focus(); return; }
      const value = m ? `${m[0]}-${m[1]}` : "";
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
  const headers = ["date","model","homeTeam","awayTeam","handicapPick","winChance","goalGap","predHomeGoals","predAwayGoals","roundedScore","actualScore","handicapResult"];
  const lines = [headers.join(",")];
  items.forEach(x => {
    const sc = parseScore(x.actual);
    const res = x.pick && sc ? (handicapWon(x.pick, ...sc) ? "WON" : "LOST") : "";
    lines.push([x.date,x.model||"Ridge v1",x.homeTeam,x.awayTeam,x.pick||"",x.pWin??"",x.gap??"",
      x.lambdaHome,x.lambdaAway,x.score,x.actual,res].map(csvEscape).join(","));
  });
  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "odds-matrix-handicap-history.csv";
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
  const demo = [1.15,5.44,1.73,2.11,3.24,1.35,6.94,1.71,2.15,4.46,1.21,12.40,1.03,19.33];
  MODEL.features.forEach((f,i) => $(`odds_${f.key}`).value = demo[i]);
  $("homeTeam").value = "MCI";
  $("awayTeam").value = "NEW";
  $("inputStatus").textContent = "Demo loaded: MCI vs NEW (finished 2:1). Example inputs, not a live feed.";
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
    ? `All ${n} inputs filled${res.teams ? ` for ${res.teams.home} vs ${res.teams.away}` : ""}. Check any repaired values, then tap Predict.`
    : `${n} of ${MODEL.features.length} inputs filled. Type the missing ones (see report), then tap Predict.`;
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
