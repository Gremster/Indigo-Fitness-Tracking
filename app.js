import { db, upsertDaily, addWorkout, addSet, addRun, addFoodEntry, removeFoodEntry, updateFoodEntry, getFoodEntriesByDate, addFavorite, updateFavorite, removeFavorite, getFavorites, addVitamin, getVitamins, removeVitamin, removeVitaminLogsByVitaminId, setVitaminLog, getVitaminLogsByDate, getLatestWorkout, getSetsForWorkout, exportAll, importAll } from "./db.js";
import { fmt, isoToday, startOfWeekISO, paceString, tonnageFromSets, rollingAvg, prettyDate } from "./metrics.js";

let weightChartPulse = null;

const views = {
  dashboard: document.querySelector("#view-dashboard"),
  logDay: document.querySelector("#view-log-day"),
  foodLookup: document.querySelector("#view-food-lookup"),
  calorieTarget: document.querySelector("#view-calorie-target"),
  vitamins: document.querySelector("#view-vitamins"),
  logTraining: document.querySelector("#view-log-training"),
  backup: document.querySelector("#view-backup"),
};

function setNavOpen(isOpen) {
  const header = document.querySelector(".header");
  const toggle = document.getElementById("nav-toggle");
  if (!header || !toggle) return;
  header.classList.toggle("nav-open", isOpen);
  document.body.classList.toggle("nav-open", isOpen);
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function show(route) {
  Object.values(views).forEach(v => v.classList.add("hidden"));
  const normalizedRoute = (route === "/log-workout" || route === "/log-run") ? "/log-training" : route;
  const map = {
    "/dashboard": views.dashboard,
    "/log-day": views.logDay,
    "/food-lookup": views.foodLookup,
    "/calorie-target": views.calorieTarget,
    "/vitamins": views.vitamins,
    "/log-training": views.logTraining,
    "/log-workout": views.logTraining,
    "/log-run": views.logTraining,
    "/backup": views.backup
  };
  (map[normalizedRoute] || views.dashboard).classList.remove("hidden");

  document.querySelectorAll("[data-route]").forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === `#${normalizedRoute}`);
  });
  setNavOpen(false);
}

function getRoute() {
  const h = location.hash || "#/dashboard";
  return h.replace("#", "");
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeValue(value) {
  try { return decodeURIComponent(value || ""); } catch { return value || ""; }
}

function fmtNutrient(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function getCalorieTarget() {
  const stored = localStorage.getItem("Indigo.calorieTarget");
  if (!stored) return null;
  const num = Number(stored);
  return Number.isFinite(num) ? num : null;
}

function setCalorieTarget(value) {
  if (!Number.isFinite(value) || value <= 0) {
    localStorage.removeItem("Indigo.calorieTarget");
    return;
  }
  localStorage.setItem("Indigo.calorieTarget", String(Math.round(value)));
}

async function getLatestWeightValue() {
  const entries = await db.daily.orderBy("date").reverse().toArray();
  const latest = entries.find(d => Number(d.weight));
  return latest ? Number(latest.weight) : null;
}

function getProteinTargetFactor() {
  const stored = Number(localStorage.getItem("Indigo.protein.factor"));
  if (Number.isFinite(stored)) return Math.min(1.5, Math.max(0.8, stored));
  return 1.0;
}

function setProteinTargetFactor(value) {
  if (!Number.isFinite(value)) return;
  const clamped = Math.min(1.5, Math.max(0.8, value));
  localStorage.setItem("Indigo.protein.factor", String(clamped));
}

async function updateProteinTargetDisplay() {
  const slider = document.getElementById("target-protein-factor");
  const valueEl = document.getElementById("target-protein-factor-value");
  const gramsEl = document.getElementById("target-protein-grams");
  if (!slider || !valueEl || !gramsEl) return;
  const value = Number(slider.value);
  if (!Number.isFinite(value)) return;
  valueEl.textContent = value.toFixed(2);
  const latestWeight = await getLatestWeightValue();
  const grams = Number(latestWeight) ? Math.round(latestWeight * value) : null;
  gramsEl.textContent = grams !== null ? String(grams) : "—";
}

function initProteinTargetControl() {
  const form = document.getElementById("form-protein-target");
  const slider = document.getElementById("target-protein-factor");
  const valueEl = document.getElementById("target-protein-factor-value");
  const statusEl = document.getElementById("target-protein-status");
  if (!form || !slider || !valueEl) return;
  const stored = getProteinTargetFactor();
  slider.value = String(stored);
  updateProteinTargetDisplay();
  slider.addEventListener("input", async () => {
    if (statusEl) statusEl.textContent = "";
    await updateProteinTargetDisplay();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = Number(slider.value);
    if (!Number.isFinite(value)) return;
    setProteinTargetFactor(value);
    if (statusEl) statusEl.textContent = "Saved.";
    await updateProteinTargetDisplay();
    renderDashboard();
  });
}

async function updateTargetDisplay() {
  const display = document.getElementById("target-display");
  if (!display) return;
  const target = getCalorieTarget();
  display.textContent = target
    ? `Daily target: ${Math.round(target)} cal`
    : "Set a daily target to display it here.";
  await updateProteinTargetDisplay();
}

function getBodyfatTargets() {
  const current = Number(localStorage.getItem("Indigo.bodyfat.current"));
  const target = Number(localStorage.getItem("Indigo.bodyfat.target"));
  const weightStart = Number(localStorage.getItem("Indigo.weight.start"));
  const weightTarget = Number(localStorage.getItem("Indigo.weight.target"));
  return {
    current: Number.isFinite(current) ? current : null,
    target: Number.isFinite(target) ? target : null,
    weightStart: Number.isFinite(weightStart) ? weightStart : null,
    weightTarget: Number.isFinite(weightTarget) ? weightTarget : null
  };
}

function setBodyfatTargets(current, target, weightStart, weightTarget) {
  if (Number.isFinite(current)) localStorage.setItem("Indigo.bodyfat.current", String(current));
  if (Number.isFinite(target)) localStorage.setItem("Indigo.bodyfat.target", String(target));
  if (Number.isFinite(weightStart)) localStorage.setItem("Indigo.weight.start", String(weightStart));
  if (Number.isFinite(weightTarget)) localStorage.setItem("Indigo.weight.target", String(weightTarget));
}

function getWeightChartMode() {
  return localStorage.getItem("Indigo.weight.chartMode") || "full";
}

function setWeightChartMode(mode) {
  const next = mode === "7day" ? "7day" : "full";
  localStorage.setItem("Indigo.weight.chartMode", next);
}

function getWeightTargetDate() {
  return localStorage.getItem("Indigo.weight.targetDate") || "";
}

function setWeightTargetDate(value) {
  if (value) localStorage.setItem("Indigo.weight.targetDate", value);
  else localStorage.removeItem("Indigo.weight.targetDate");
}

function updateBodyfatForm() {
  const { current, target, weightStart, weightTarget } = getBodyfatTargets();
  const targetDate = getWeightTargetDate();
  const currentInput = document.getElementById("bodyfat-current");
  const targetInput = document.getElementById("bodyfat-target");
  const weightStartInput = document.getElementById("weight-start");
  const weightTargetInput = document.getElementById("weight-target");
  const targetDateInput = document.getElementById("weight-target-date");
  if (currentInput && Number.isFinite(current)) currentInput.value = current;
  if (targetInput && Number.isFinite(target)) targetInput.value = target;
  if (weightStartInput && Number.isFinite(weightStart)) weightStartInput.value = weightStart;
  if (weightTargetInput && Number.isFinite(weightTarget)) weightTargetInput.value = weightTarget;
  if (targetDateInput && targetDate) targetDateInput.value = targetDate;
}

function startOrbBackground() {
  const canvas = document.getElementById("bg-orb");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let centerX = 200;
  let centerY = 200;
  let velX = 120;
  let velY = 90;
  let radius = 170;
  let fov = 420;
  let rotY = 0;
  let rotX = 0.6;
  let lastTime = performance.now();
  const targetFrame = 1 / 30;
  let accum = 0;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    const minEdge = Math.min(width, height);
    const isSmall = minEdge <= 430;
    const smallBase = Math.max(60, Math.round(minEdge * 0.18));
    radius = isSmall ? Math.round((170 + smallBase) / 2) : 170;
    fov = isSmall ? 340 : 420;
    const speedScale = isSmall ? 0.8 : 1;
    velX = Math.sign(velX || 1) * 120 * speedScale;
    velY = Math.sign(velY || 1) * 90 * speedScale;
    centerX = Math.min(Math.max(radius, centerX), width - radius);
    centerY = Math.min(Math.max(radius, centerY), height - radius);
  }
  window.addEventListener("resize", resize);
  resize();

  function project(p) {
    const scale = fov / (fov + p.z);
    return {
      x: p.x * scale + centerX,
      y: p.y * scale + centerY,
      alpha: Math.max(0.2, Math.min(1, (p.z + radius) / (2 * radius)))
    };
  }

  function rotate(p) {
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    let x = p.x * cosY - p.z * sinY;
    let z = p.x * sinY + p.z * cosY;
    let y = p.y * cosX - z * sinX;
    z = p.y * sinX + z * cosX;
    return { x, y, z };
  }

  function drawSphere() {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = "lighter";

    const latLines = 12;
    const lonLines = 16;

    for (let i = 1; i < latLines; i++) {
      const lat = (i / latLines) * Math.PI - Math.PI / 2;
      const pts = [];
      for (let j = 0; j <= 64; j++) {
        const lon = (j / 64) * Math.PI * 2;
        const p = {
          x: radius * Math.cos(lat) * Math.cos(lon),
          y: radius * Math.sin(lat),
          z: radius * Math.cos(lat) * Math.sin(lon)
        };
        const rp = rotate(p);
        pts.push(project(rp));
      }
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k];
        if (k === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.stroke();
    }

    for (let i = 0; i < lonLines; i++) {
      const lon = (i / lonLines) * Math.PI * 2;
      const pts = [];
      for (let j = 0; j <= 64; j++) {
        const lat = (j / 64) * Math.PI - Math.PI / 2;
        const p = {
          x: radius * Math.cos(lat) * Math.cos(lon),
          y: radius * Math.sin(lat),
          z: radius * Math.cos(lat) * Math.sin(lon)
        };
        const rp = rotate(p);
        pts.push(project(rp));
      }
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k];
        if (k === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    const glow = ctx.createRadialGradient(centerX - 40, centerY - 50, 20, centerX - 40, centerY - 50, radius);
    glow.addColorStop(0, "rgba(255,255,255,0.15)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function tick(now) {
    if (document.visibilityState === "hidden") {
      lastTime = now;
      requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.032, (now - lastTime) / 1000);
    lastTime = now;
    accum += dt;
    if (accum < targetFrame) {
      requestAnimationFrame(tick);
      return;
    }
    accum = 0;

    centerX += velX * dt;
    centerY += velY * dt;

    const minX = radius;
    const maxX = width - radius;
    const minY = radius;
    const maxY = height - radius;

    if (centerX <= minX || centerX >= maxX) {
      velX = -velX * 0.98;
      centerX = Math.max(minX, Math.min(maxX, centerX));
      velY += (Math.random() - 0.5) * 10;
    }
    if (centerY <= minY || centerY >= maxY) {
      velY = -velY * 0.98;
      centerY = Math.max(minY, Math.min(maxY, centerY));
      velX += (Math.random() - 0.5) * 10;
    }

    rotY += dt * 0.6;
    rotX += dt * 0.2;

    drawSphere();
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function weekdayLabel(i) {
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][i] || "";
}

function shortDateLabel(dateISO) {
  if (!dateISO) return "";
  const parts = dateISO.split("-");
  if (parts.length !== 3) return dateISO;
  return String(Number(parts[2]));
}

function dateRangeISO(startISO, endISO) {
  const out = [];
  const d = new Date(startISO + "T12:00:00");
  const end = new Date(endISO + "T12:00:00");
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  while (d <= end) {
    out.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function ensureLogDayDateIsCurrent() {
  const input = document.getElementById("day-date");
  if (!input) return;
  const today = isoToday();
  if (!input.value || input.value < today) input.value = today;
}

function updateKpiValueSizing(container) {
  if (!container) return;
  container.querySelectorAll(".kpi .value").forEach(el => {
    const text = el.textContent?.trim() || "";
    if (!el.classList.contains("value-compact")) {
      el.classList.toggle("value-compact", text.length > 18);
    }
  });
}

async function renderDashboard() {
  const daily = await db.daily.orderBy("date").toArray();
  const runs = await db.runs.orderBy("date").toArray();
  const workouts = await db.workouts.orderBy("date").toArray();

  const today = isoToday();
  const vitamins = await getVitamins();
  const vitaminLogs = await getVitaminLogsByDate(today);
  const dayIndex = new Date(today + "T12:00:00").getDay();
  const scheduledVitamins = vitamins.filter(i => Array.isArray(i.days) && i.days.includes(dayIndex));
  const takenMap = new Map(vitaminLogs.map(l => [l.vitaminId, Boolean(l.taken)]));
  const takenCount = scheduledVitamins.filter(i => takenMap.get(i.id)).length;
  const remainingCount = Math.max(0, scheduledVitamins.length - takenCount);
  const vitaminStatusText = scheduledVitamins.length
    ? remainingCount ? `${takenCount}/${scheduledVitamins.length} taken` : "All taken"
    : "None scheduled";
  const vitaminStatusClass = scheduledVitamins.length
    ? (remainingCount ? "kpi-warning" : "kpi-success")
    : "";
  const weekStart = startOfWeekISO(today);
  const todayEntry = daily.find(d => d.date === today);
  const latestWeight = [...daily].reverse().find(d => Number(d.weight))?.weight || null;
  const proteinFactor = getProteinTargetFactor();
  const proteinTarget = Number(latestWeight) ? Math.round(Number(latestWeight) * proteinFactor) : null;
  const target = getCalorieTarget();
  const targetDate = getWeightTargetDate();

  // Weekly daily stats
  const dailyThisWeek = daily.filter(d => d.date >= weekStart && d.date <= today);
  const calAvg = dailyThisWeek.length ? dailyThisWeek.reduce((s,x)=>s+(Number(x.calories)||0),0)/dailyThisWeek.length : null;
  const proteinGoal = proteinTarget || 160;
  const proteinDaysHit = dailyThisWeek.filter(d => (Number(d.protein)||0) >= proteinGoal).length;

  // Weekly run stats
  const runsThisWeek = runs.filter(r => r.date >= weekStart && r.date <= today);
  const runMinutes = runsThisWeek.reduce((s,r)=>s+(Number(r.durationMin)||0),0);

  // Weekly workout tonnage
  const workoutsThisWeek = workouts.filter(w => w.date >= weekStart && w.date <= today);
  let tonnage = 0;
  for (const w of workoutsThisWeek) {
    const sets = await getSetsForWorkout(w.id);
    tonnage += tonnageFromSets(sets);
  }

  // Weight chart
  const weightEntries = daily.filter(d => d.weight !== null && d.weight !== undefined);
  const weightMap = new Map(weightEntries.map(d => [d.date, Number(d.weight)]));
  let labels = [];
  let weights = [];
  if (weightEntries.length) {
    const firstWeightDate = weightEntries[0].date;
    const lastWeightDate = weightEntries[weightEntries.length - 1].date;
    const targetDateValue = targetDate || "";
    const endDate = [lastWeightDate, today, targetDateValue].sort().slice(-1)[0] || today;
    labels = dateRangeISO(firstWeightDate, endDate);
    weights = labels.map(d => (weightMap.has(d) ? weightMap.get(d) : null));
  }
  const chartMode = getWeightChartMode();
  const weightAvg = rollingAvg(weights, 7);
  let chartLabels = labels;
  let chartWeights = weights;
  if (chartMode === "7day" && labels.length) {
    if (weightEntries.length) {
      const recent = weightEntries.slice(-7);
      chartLabels = recent.map(d => d.date);
      chartWeights = recent.map(d => Number(d.weight));
    } else {
      chartLabels = [];
      chartWeights = [];
    }
  }
  const chartAvg = chartMode === "7day" ? rollingAvg(chartWeights, 7) : weightAvg;
  const skipTicks = chartLabels.length > 31;

  const todayCalories = Number(todayEntry?.calories) || 0;
  const todayProtein = Number(todayEntry?.protein) || 0;
  const overCalories = target ? todayCalories - target : null;
  const proteinDelta = proteinTarget ? todayProtein - proteinTarget : null;
  const proteinTargetText = proteinTarget ? `${proteinTarget} g` : "Log a weight to set this";
  const proteinStatusText = proteinDelta === null
    ? "Log a weight to set this"
    : proteinDelta >= 0
      ? `Over by ${Math.round(proteinDelta)} g`
      : `Under by ${Math.abs(Math.round(proteinDelta))} g`;
  const proteinPctRaw = proteinTarget ? (todayProtein / proteinTarget) * 100 : null;
  const proteinMeterPercent = proteinPctRaw === null ? 0 : Math.min(100, Math.max(0, proteinPctRaw));
  const proteinMeterClass = proteinPctRaw === null
    ? "kpi-meter-empty"
    : "kpi-meter-indigo";
  const calorieStatusText = overCalories === null
    ? "Set a calorie target"
    : overCalories > 0
      ? `Over by ${Math.round(overCalories)} cal`
      : `Under by ${Math.abs(Math.round(overCalories))} cal`;
  const caloriePctRaw = target ? (todayCalories / target) * 100 : null;
  const calorieMeterPercent = caloriePctRaw === null ? 0 : Math.min(100, Math.max(0, caloriePctRaw));
  const calorieMeterClass = caloriePctRaw === null
    ? "kpi-meter-empty"
    : caloriePctRaw > 100
      ? "kpi-meter-over"
      : "kpi-meter-indigo";
  const proteinStatusClass = proteinDelta === null
    ? ""
    : proteinDelta >= 0 ? "kpi-success" : "";
  const proteinDirectionClass = proteinDelta !== null && proteinDelta < 0 ? "kpi-meter-under" : "";
  const calorieStatusClass = overCalories === null
    ? ""
    : overCalories > 0 ? "kpi-danger" : "kpi-success";
  const calorieDirectionClass = overCalories !== null && overCalories <= 0 ? "kpi-meter-under" : "";
  const todayCaloriesText = todayCalories ? `${Math.round(todayCalories)} cal` : "No intake logged";
  const todayIntakeValueClass = todayCaloriesText === "No intake logged"
    ? "value-wrap value-compact"
    : "value-wrap";
  const vitaminValueClass = vitaminStatusText === "None scheduled"
    ? "value-wrap value-compact"
    : "";
  const bodyfat = getBodyfatTargets();
  const bodyfatCurrentText = bodyfat.current !== null ? `${bodyfat.current}%` : "—";
  const bodyfatTargetText = bodyfat.target !== null ? `${bodyfat.target}%` : "—";
  const weightStartText = bodyfat.weightStart !== null ? `${bodyfat.weightStart} lb` : "—";
  const weightTargetText = bodyfat.weightTarget !== null ? `${bodyfat.weightTarget} lb` : "—";
  const weightTarget = bodyfat.weightTarget;
  const latestWeightDate = weightEntries.length ? weightEntries[weightEntries.length - 1].date : "";
  const latestWeightValue = weightEntries.length ? Number(weightEntries[weightEntries.length - 1].weight) : null;
  const targetDateMs = targetDate ? new Date(targetDate + "T12:00:00").getTime() : null;
  const todayMs = new Date(today + "T12:00:00").getTime();
  const weeksToTarget = targetDateMs && targetDateMs > todayMs
    ? (targetDateMs - todayMs) / (1000 * 60 * 60 * 24 * 7)
    : null;
  const requiredWeeklyLoss = (Number.isFinite(latestWeightValue) && Number.isFinite(weightTarget) && weeksToTarget)
    ? (latestWeightValue - weightTarget) / weeksToTarget
    : null;

  let actualWeeklyLoss = null;
  if (latestWeightDate && Number.isFinite(latestWeightValue)) {
    const back = new Date(latestWeightDate + "T12:00:00");
    back.setDate(back.getDate() - 14);
    const backISO = back.toISOString().slice(0,10);
    const backEntry = [...weightEntries].reverse().find(d => d.date <= backISO);
    const backWeight = Number(backEntry?.weight);
    if (Number.isFinite(backWeight)) {
      actualWeeklyLoss = (backWeight - latestWeightValue) / 2;
    }
  }

  const hasPaceData = Number.isFinite(requiredWeeklyLoss) && Number.isFinite(actualWeeklyLoss);
  const onTrack = hasPaceData ? actualWeeklyLoss >= requiredWeeklyLoss : null;
  const paceText = !targetDate
    ? "Set a target date"
    : !Number.isFinite(weightTarget) || !Number.isFinite(latestWeightValue)
      ? "Log weights to compare pace"
      : weeksToTarget === null
        ? "Target date passed"
        : hasPaceData
          ? onTrack
            ? `On track (${requiredWeeklyLoss.toFixed(1)} lb/wk)`
            : `Behind (${(requiredWeeklyLoss - actualWeeklyLoss).toFixed(1)} lb/wk)`
          : "Need two weeks of weigh-ins";
  const paceClass = hasPaceData ? (onTrack ? "kpi-success" : "kpi-warning") : "";
  const avgLineColor = hasPaceData ? (onTrack ? "#8b9bff" : "#ff6b8a") : "#6f7dff";

  let weeklyDelta = null;
  if (chartAvg.length >= 8) {
    const latestAvg = chartAvg[chartAvg.length - 1];
    const pastAvg = chartAvg[chartAvg.length - 8];
    if (Number.isFinite(latestAvg) && Number.isFinite(pastAvg)) {
      weeklyDelta = latestAvg - pastAvg;
    }
  }

  views.dashboard.innerHTML = `
    <h1 class="dashboard-title">Dashboard<span class="dashboard-date">${prettyDate(today)}</span></h1>

    <div class="card">
      <div class="kpi-grid" data-grid-id="overview">
        <div class="kpi" data-kpi-id="avg-calories" draggable="true"><div class="label">Avg Calories</div><div class="value">${fmt(calAvg,0)}</div></div>
        <div class="kpi" data-kpi-id="target-calories" draggable="true"><div class="label">Target Calories</div><div class="value">${target ? Math.round(target) : "—"}</div></div>
        <div class="kpi" data-kpi-id="run-minutes" draggable="true"><div class="label">Run Minutes</div><div class="value">${fmt(runMinutes,0)}</div></div>
        
      </div>
    </div>

    <div class="card">
      <h2>Today's Targets</h2>
      <div class="kpi-grid" data-grid-id="today-targets">
        <div class="kpi" data-kpi-id="protein-target" draggable="true">
          <div class="label">Protein Target (${proteinFactor.toFixed(2)}g/lb)</div>
          <div class="value">${proteinTargetText}</div>
        </div>
        <div class="kpi kpi-meter ${proteinStatusClass} ${proteinMeterClass} ${proteinDirectionClass}" data-kpi-id="protein-status" draggable="true" style="--kpi-fill:${proteinMeterPercent.toFixed(0)}%;">
          <div class="label">Protein Status</div>
          <div class="value">${proteinStatusText}</div>
        </div>
        <div class="kpi kpi-meter ${calorieStatusClass} ${calorieMeterClass} ${calorieDirectionClass}" data-kpi-id="calorie-status" draggable="true" style="--kpi-fill:${calorieMeterPercent.toFixed(0)}%;">
          <div class="label">Calorie Status</div>
          <div class="value">${calorieStatusText}</div>
        </div>
        <div class="kpi" data-kpi-id="today-intake" draggable="true">
          <div class="label">Today's Intake</div>
          <div class="value ${todayIntakeValueClass}">${todayCaloriesText}</div>
        </div>
        <div class="kpi" data-kpi-id="bodyfat-current" draggable="true">
          <div class="label">Body Fat (Est.)</div>
          <div class="value">${bodyfatCurrentText}</div>
        </div>
        <div class="kpi" data-kpi-id="bodyfat-target" draggable="true">
          <div class="label">Body Fat Target</div>
          <div class="value">${bodyfatTargetText}</div>
        </div>
        <div class="kpi" data-kpi-id="weight-start" draggable="true">
          <div class="label">Starting Weight</div>
          <div class="value">${weightStartText}</div>
        </div>
        <div class="kpi" data-kpi-id="weight-target" draggable="true">
          <div class="label">Target Weight</div>
          <div class="value">${weightTargetText}</div>
        </div>
      </div>
      <div class="muted">Protein target uses your latest logged weight.</div>
    </div>

    <div class="card">
      <h2>Notes</h2>
      <div class="kpi-grid" data-grid-id="notes">
        <div class="kpi ${vitaminStatusClass}" data-kpi-id="vitamins" draggable="true">
          <div class="label">Vitamins & Meds</div>
          <div class="value ${vitaminValueClass}">${vitaminStatusText}</div>
        </div>
        ${hasPaceData ? `
        <div class="kpi ${paceClass}" data-kpi-id="pace" draggable="true">
          <div class="label">Pace to Goal</div>
          <div class="value">${paceText}</div>
        </div>
        ` : ""}
      </div>
      <div class="notes-suggestions">
        <div class="muted" id="performance-suggestions-status">reviewing the last 7 days…</div>
        <div id="performance-suggestions"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Weight Trend</h2>
        <button class="btn-secondary btn-sm" id="weight-view-toggle">${chartMode === "7day" ? "Show full" : "Last 7 days"}</button>
      </div>
      <canvas id="weightChart" height="130"></canvas>
      <div class="muted">Tip: log weight in the morning for clean trends.</div>
    </div>

    
  `;

  // Build chart
  const ctx = document.getElementById("weightChart");
  if (ctx) {
    if (weightChartPulse) {
      cancelAnimationFrame(weightChartPulse);
      weightChartPulse = null;
    }
    const pulseIndex = chartLabels.indexOf(today);
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: "Weight",
            data: chartWeights,
            spanGaps: true,
            pointBackgroundColor: "#6f7dff",
            pointBorderColor: "rgba(120,134,255,0.6)",
            pointBorderWidth: 2,
            borderColor: "#6f7dff",
            segment: weightTarget && chartMode !== "7day" ? {
              borderColor: (ctx) => {
                const v0 = ctx.p0.parsed?.y;
                const v1 = ctx.p1.parsed?.y;
                if (!Number.isFinite(v0) || !Number.isFinite(v1)) return "#6f7dff";
                const d0 = Math.abs(v0 - weightTarget);
                const d1 = Math.abs(v1 - weightTarget);
                if (d1 < d0) return "#8b9bff";
                if (d1 > d0) return "#ff6b8a";
                return "#6f7dff";
              }
            } : undefined
          },
          { label: "7-day Avg", data: chartAvg, spanGaps: true, borderColor: avgLineColor, pointBackgroundColor: avgLineColor },
          ...(weightTarget && targetDate && latestWeightValue && chartMode !== "7day" ? [{
            label: "Goal Line",
            data: chartLabels.map(label => {
              if (!weightEntries.length) return null;
              const startDate = weightEntries[0].date;
              const startWeight = Number(weightEntries[0].weight);
              const endDate = targetDate;
              if (!startDate || !endDate || !Number.isFinite(startWeight)) return null;
              if (label < startDate || label > endDate) return null;
              const startMs = new Date(startDate + "T12:00:00").getTime();
              const endMs = new Date(endDate + "T12:00:00").getTime();
              const labelMs = new Date(label + "T12:00:00").getTime();
              const pct = (labelMs - startMs) / (endMs - startMs);
              return startWeight + (weightTarget - startWeight) * pct;
            }),
            spanGaps: true,
            borderDash: [6, 6],
            pointRadius: 0,
            borderColor: "rgba(176,186,255,0.45)"
          }] : []),
          ...(weightTarget && targetDate && Number.isFinite(actualWeeklyLoss) && latestWeightDate && chartMode !== "7day" ? [{
            label: "Projection",
            data: chartLabels.map(label => {
              if (label < latestWeightDate || label > targetDate) return null;
              const startMs = new Date(latestWeightDate + "T12:00:00").getTime();
              const labelMs = new Date(label + "T12:00:00").getTime();
              const weeks = (labelMs - startMs) / (1000 * 60 * 60 * 24 * 7);
              return latestWeightValue - (actualWeeklyLoss * weeks);
            }),
            spanGaps: true,
            pointRadius: 0,
            borderColor: onTrack ? "rgba(139,155,255,0.7)" : "rgba(255,107,138,0.7)"
          }] : []),
          ...(weightTarget && chartMode !== "7day" ? [{
            label: "Target",
            data: chartLabels.map((label, idx) => {
              if (targetDate) return label === targetDate ? weightTarget : null;
              return idx === chartLabels.length - 1 ? weightTarget : null;
            }),
            spanGaps: true,
            showLine: false,
            pointRadius: 6,
            pointHoverRadius: 7,
            pointBackgroundColor: "#8b9bff",
            pointBorderColor: "rgba(139,155,255,0.7)",
            pointBorderWidth: 2
          }] : [])
        ]
      },
      plugins: [{
        id: "pulseGlow",
        afterDatasetsDraw(chartInstance) {
          const idx = chartInstance.$pulseIndex;
          const radius = chartInstance.$pulseRadius;
          if (idx === null || radius === null) return;
          const meta = chartInstance.getDatasetMeta(0);
          const point = meta?.data?.[idx];
          if (!point) return;
          const { ctx } = chartInstance;
          ctx.save();
          ctx.shadowColor = "rgba(120,134,255,0.8)";
          ctx.shadowBlur = 18;
          ctx.fillStyle = "rgba(120,134,255,0.6)";
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }, {
        id: "weightCallouts",
        afterDatasetsDraw(chartInstance) {
          if (!Number.isFinite(weeklyDelta) && onTrack === null) return;
          const meta = chartInstance.getDatasetMeta(0);
          const point = meta?.data?.[chartInstance.$pulseIndex];
          if (!point) return;
          const { ctx } = chartInstance;
          ctx.save();
          ctx.font = "600 12px ui-sans-serif, system-ui";
          ctx.textBaseline = "bottom";
          let offsetY = -12;
          if (Number.isFinite(weeklyDelta)) {
            const sign = weeklyDelta > 0 ? "+" : "";
            const text = `7d: ${sign}${weeklyDelta.toFixed(1)} lb`;
            ctx.fillStyle = weeklyDelta <= 0 ? "#8b9bff" : "#ff6b8a";
            ctx.fillText(text, point.x + 8, point.y + offsetY);
            offsetY -= 16;
          }
          if (onTrack !== null) {
            const text = onTrack ? "On track" : "Behind pace";
            ctx.fillStyle = onTrack ? "#8b9bff" : "#ff6b8a";
            ctx.fillText(text, point.x + 8, point.y + offsetY);
          }
          ctx.restore();
        }
      }],
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        layout: { padding: { bottom: 16 } },
        scales: {
          x: {
            ticks: {
              color: "#aab0d6",
              display: true,
              autoSkip: skipTicks,
              maxTicksLimit: 14,
              maxRotation: 45,
              minRotation: 45,
              callback: (value) => {
                const label = typeof value === "string" ? value : chartLabels[value];
                return shortDateLabel(label);
              }
            },
            grid: { color: "#2a3148" }
          },
          y: { ticks: { color: "#aab0d6" }, grid: { color: "#2a3148" } }
        }
      }
    });
    if (chart?.data?.datasets?.[0]) {
      chart.data.datasets[0].pointRadius = 4;
      chart.update("none");
    }
    const hasPulsePoint = pulseIndex >= 0 && Number.isFinite(chartWeights[pulseIndex]);
    chart.$pulseIndex = hasPulsePoint ? pulseIndex : null;
    chart.$pulseRadius = hasPulsePoint ? 2 : null;
    if (hasPulsePoint) {
      const startTime = performance.now();
      const pulse = (now) => {
        const phase = ((now - startTime) % 4200) / 4200;
        const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
        chart.$pulseRadius = 2 + (3 * wave);
        chart.draw();
        weightChartPulse = requestAnimationFrame(pulse);
      };
      weightChartPulse = requestAnimationFrame(pulse);
    }
  }

  const toggleBtn = document.getElementById("weight-view-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const next = chartMode === "7day" ? "full" : "7day";
      setWeightChartMode(next);
      renderDashboard();
    });
  }

  // Recent rows (mix runs + workouts)
  const rec = [];
  for (const r of runs.slice(-5)) {
    rec.push({ date: r.date, type: `Run (${r.type})`, details: `${r.distanceMi} mi in ${r.durationMin} min (${paceString(r.distanceMi, r.durationMin)})` });
  }
  for (const w of workouts.slice(-5)) {
    rec.push({ date: w.date, type: `Workout (${w.type})`, details: `${w.durationMin||"—"} min, Session RPE ${w.rpe}` });
  }
  rec.sort((a,b) => a.date < b.date ? 1 : -1);

  updateKpiValueSizing(views.dashboard);
  initDashboardDrag();
}

function applyKpiOrder(grid, order) {
  if (!grid) return;
  const items = Array.from(grid.querySelectorAll(".kpi"));
  const map = new Map(items.map(item => [item.dataset.kpiId, item]));
  const fragment = document.createDocumentFragment();
  (order || []).forEach(id => {
    const item = map.get(id);
    if (item) {
      fragment.appendChild(item);
      map.delete(id);
    }
  });
  items.forEach(item => {
    if (map.has(item.dataset.kpiId)) {
      fragment.appendChild(item);
      map.delete(item.dataset.kpiId);
    }
  });
  grid.appendChild(fragment);
}

function initDashboardDrag() {
  const grids = document.querySelectorAll(".kpi-grid[data-grid-id]");
  grids.forEach(grid => {
    const gridId = grid.dataset.gridId;
    const storageKey = `Indigo.dashboardOrder.${gridId}`;
    const stored = localStorage.getItem(storageKey);
    let order = [];
    if (stored) {
      try { order = JSON.parse(stored); } catch {}
    }
    if (Array.isArray(order) && order.length) {
      applyKpiOrder(grid, order);
    } else {
      const defaultOrder = Array.from(grid.querySelectorAll(".kpi")).map(k => k.dataset.kpiId).filter(Boolean);
      localStorage.setItem(storageKey, JSON.stringify(defaultOrder));
    }

    grid.querySelectorAll(".kpi").forEach(kpi => {
      if (kpi.dataset.kpiId) kpi.setAttribute("draggable", "true");
      if (kpi.dataset.kpiId === "vitamins") {
        kpi.setAttribute("role", "link");
        kpi.tabIndex = 0;
        kpi.addEventListener("click", () => {
          location.hash = "#/vitamins";
        });
        kpi.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            location.hash = "#/vitamins";
          }
        });
      }
      kpi.addEventListener("dragstart", (e) => {
        kpi.classList.add("dragging");
        kpi.dataset.dragGrid = gridId;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", kpi.dataset.kpiId || "");
        }
      });
      kpi.addEventListener("dragend", () => {
        kpi.classList.remove("dragging");
        delete kpi.dataset.dragGrid;
      });
    });

    grid.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });

    grid.addEventListener("drop", (e) => {
      e.preventDefault();
      const dragging = document.querySelector(".kpi.dragging");
      if (!dragging || dragging.dataset.dragGrid !== gridId) return;
      const target = e.target.closest(".kpi");
      if (!target || target === dragging) return;
      const rect = target.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      grid.insertBefore(dragging, after ? target.nextSibling : target);
      const newOrder = Array.from(grid.querySelectorAll(".kpi")).map(k => k.dataset.kpiId).filter(Boolean);
      localStorage.setItem(storageKey, JSON.stringify(newOrder));
    });
  });
}

function setDefaultDates() {
  const today = isoToday();
  document.getElementById("day-date").value = today;
  document.getElementById("workout-date").value = today;
  document.getElementById("run-date").value = today;
}

function initNavToggle() {
  const header = document.querySelector(".header");
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("primary-nav");
  if (!header || !toggle) return;

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setNavOpen(!header.classList.contains("nav-open"));
  });

  nav?.addEventListener("click", (e) => {
    if (e.target.closest("a[data-route]")) setNavOpen(false);
  });

  document.addEventListener("click", (e) => {
    if (!header.contains(e.target)) setNavOpen(false);
  });
}

async function setWeightInputForDate(date) {
  const input = document.getElementById("day-weight");
  if (!input) return;
  const entry = await db.daily.get(date);
  if (entry?.weight !== null && entry?.weight !== undefined) {
    input.value = entry.weight;
    return;
  }
  if (input.value) return;
  const all = await db.daily.orderBy("date").reverse().toArray();
  const last = all.find(d => d.weight !== null && d.weight !== undefined);
  if (last?.weight !== undefined) input.value = last.weight;
}

async function refreshLatestWorkoutPanel() {
  const w = await getLatestWorkout();
  const summary = document.getElementById("latest-workout-summary");
  const list = document.getElementById("set-list");
  if (!summary || !list) return;

  if (!w) {
    summary.textContent = "No workout saved yet. Save a workout session first, then add sets.";
    list.innerHTML = "";
    return;
  }

  const sets = await getSetsForWorkout(w.id);
  const tonnage = tonnageFromSets(sets);

  summary.textContent = `Latest workout: ${w.date} • ${w.type} • ID ${w.id} • Sets: ${sets.length} • Tonnage: ${Math.round(tonnage)}`;

  if (!sets.length) {
    list.innerHTML = `<div class="muted">No sets logged yet.</div>`;
    return;
  }

  const grouped = sets.reduce((m,s)=>{
    (m[s.exercise] ||= []).push(s);
    return m;
  }, {});

  list.innerHTML = Object.entries(grouped).map(([ex, rows]) => {
    const lines = rows.map((s,i)=>`${i+1}) ${s.weight} × ${s.reps}`).join("<br/>");
    return `<div class="card" style="margin:10px 0;background:#0b1220"><b>${ex}</b><div class="muted">${lines}</div></div>`;
  }).join("");
}

async function searchFood(query) {
  const url = "https://world.openfoodfacts.org/cgi/search.pl" +
    `?search_terms=${encodeURIComponent(query)}` +
    "&search_simple=1&action=process&json=1&page_size=12";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

function renderFoodResults(products) {
  const results = document.getElementById("food-results");
  if (!results) return;

  if (!products.length) {
    results.innerHTML = `<div class="muted">No matches found. Try a brand name or a more specific item.</div>`;
    return;
  }

  results.innerHTML = products.map(p => {
    const rawName = p.product_name || p.generic_name || "Unknown item";
    const rawBrand = p.brands || "";
    const rawServing = p.serving_size || "";
    const name = escapeHTML(rawName);
    const brand = escapeHTML(rawBrand);
    const image = p.image_small_url || p.image_front_small_url || "";
    const serving = escapeHTML(rawServing);
    const n = p.nutriments || {};

    const kcal100Value = Number(n["energy-kcal_100g"]);
    const kcalServingValue = Number(n["energy-kcal_serving"]);
    const kcal100 = fmtNutrient(kcal100Value, 0);
    const kcalServing = fmtNutrient(kcalServingValue, 0);
    const protein100Value = Number(n["proteins_100g"]);
    const proteinServingValue = Number(n["proteins_serving"]);
    const protein100 = fmtNutrient(n.proteins_100g, 1);
    const carbs100 = fmtNutrient(n.carbohydrates_100g, 1);
    const fat100 = fmtNutrient(n.fat_100g, 1);
    const servingGrams = parseServingGrams(rawServing, p.serving_quantity, p.serving_unit);
    const gramsDefault = Number.isFinite(servingGrams) ? servingGrams : 100;

    const actions = [];
    if (Number.isFinite(kcalServingValue)) {
      actions.push(
        `<div class="food-action">
          <label>Servings
            <input type="number" class="food-qty" min="0" step="0.25" value="1" data-qty-basis="serving">
          </label>
          <button class="btn-secondary btn-sm" data-action="add-food" data-basis="serving" data-kcal="${kcalServingValue}" data-protein="${proteinServingValue}" data-name="${encodeURIComponent(rawName)}" data-brand="${encodeURIComponent(rawBrand)}" data-serving="${encodeURIComponent(rawServing)}">Add serving</button>
        </div>`
      );
    }
    if (Number.isFinite(kcal100Value)) {
      const kcalLbValue = per100gToLb(kcal100Value);
      const proteinLbValue = per100gToLb(protein100Value);
      actions.push(
        `<div class="food-action">
          <label>Grams
            <input type="number" class="food-qty" min="0" step="1" value="${gramsDefault}" data-qty-basis="100g">
          </label>
          <button class="btn-secondary btn-sm" data-action="add-food" data-basis="100g" data-kcal="${kcal100Value}" data-protein="${protein100Value}" data-name="${encodeURIComponent(rawName)}" data-brand="${encodeURIComponent(rawBrand)}">Add grams</button>
        </div>`
      );
      actions.push(
        `<div class="food-action">
          <label>Pounds
            <input type="number" class="food-qty" min="0" step="0.1" value="1" data-qty-basis="lb">
          </label>
          <button class="btn-secondary btn-sm" data-action="add-food" data-basis="lb" data-kcal="${kcalLbValue}" data-protein="${proteinLbValue}" data-name="${encodeURIComponent(rawName)}" data-brand="${encodeURIComponent(rawBrand)}">Add lbs</button>
        </div>`
      );
    }

    return `
      <article class="card food-card">
        ${image ? `<img class="food-img" src="${image}" alt="${name}">` : `<div class="food-img placeholder"></div>`}
        <div class="food-body">
          <div class="food-title">${name}</div>
          ${brand ? `<div class="food-meta">${brand}</div>` : ""}
          ${serving ? `<div class="food-meta">Serving: ${serving}</div>` : ""}
          <div class="food-macros">
            <div><span class="label">cal/100g</span>${kcal100}</div>
            <div><span class="label">cal/serv</span>${kcalServing}</div>
            <div><span class="label">protein/100g</span>${protein100} g</div>
            <div><span class="label">carbs</span>${carbs100} g</div>
            <div><span class="label">fat</span>${fat100} g</div>
          </div>
          ${actions.length ? `<div class="food-actions">${actions.join("")}</div>` : `<div class="muted">No calorie data available to add.</div>`}
        </div>
      </article>
    `;
  }).join("");
}

function parseNumberLoose(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseServingGrams(servingText, servingQty, servingUnit) {
  const unit = String(servingUnit || "").toLowerCase();
  const qty = parseNumberLoose(servingQty);
  if (Number.isFinite(qty) && unit && unit.includes("g")) {
    return qty;
  }
  if (!servingText) return null;
  const match = String(servingText).match(/(\d+(?:[.,]\d+)?)\s*(g|gram|grams)/i);
  if (!match) return null;
  const grams = parseNumberLoose(match[1]);
  return Number.isFinite(grams) ? grams : null;
}

function getActiveFoodDate() {
  const input = document.getElementById("day-date");
  if (!input) return isoToday();
  if (!input.value) input.value = isoToday();
  return input.value;
}

function amountFromBasis(perUnit, basis, qty) {
  if (!Number.isFinite(perUnit) || !Number.isFinite(qty)) return 0;
  return basis === "100g" ? perUnit * (qty / 100) : perUnit * qty;
}

const GRAMS_PER_LB = 453.592;
const GRAMS_PER_OZ = 28.3495;

function per100gToLb(perUnit) {
  if (!Number.isFinite(perUnit)) return 0;
  return perUnit * (GRAMS_PER_LB / 100);
}

function per100gToOz(perUnit) {
  if (!Number.isFinite(perUnit)) return 0;
  return perUnit * (GRAMS_PER_OZ / 100);
}

function per100gToCup(perUnit, cupGrams) {
  if (!Number.isFinite(perUnit) || !Number.isFinite(cupGrams)) return 0;
  return perUnit * (cupGrams / 100);
}

function per100gToServing(perUnit, servingGrams) {
  if (!Number.isFinite(perUnit) || !Number.isFinite(servingGrams)) return 0;
  return perUnit * (servingGrams / 100);
}

function basisLabel(basis, serving) {
  if (basis === "serving") return serving ? `Serving: ${escapeHTML(serving)}` : "Serving";
  if (basis === "lb") return "Per lb";
  if (basis === "oz") return "Per oz";
  if (basis === "cup") return "Per cup";
  return "Per 100g";
}

function basisAmountText(basis, qty) {
  if (basis === "serving") return `${qty} serving${qty === 1 ? "" : "s"}`;
  if (basis === "lb") return `${qty} lb`;
  if (basis === "oz") return `${qty} oz`;
  if (basis === "cup") return `${qty} cup${qty === 1 ? "" : "s"}`;
  return `${qty} g`;
}

function basisUnitLabel(basis) {
  if (basis === "serving") return "serving";
  if (basis === "lb") return "lb";
  if (basis === "oz") return "oz";
  if (basis === "cup") return "cup";
  return "100g";
}

function basisUnitShort(basis) {
  if (basis === "serving") return "serving";
  if (basis === "lb") return "lb";
  if (basis === "oz") return "oz";
  if (basis === "cup") return "cup";
  return "g";
}

function qtyDefaultsForBasis(basis) {
  if (basis === "serving") return { value: "1", step: "0.25" };
  if (basis === "lb") return { value: "1", step: "0.1" };
  if (basis === "oz") return { value: "1", step: "0.1" };
  if (basis === "cup") return { value: "1", step: "0.25" };
  return { value: "100", step: "1" };
}

function getRecentDates(count = 7) {
  const dates = [];
  const d = new Date(isoToday() + "T12:00:00");
  for (let i = 0; i < count; i += 1) {
    dates.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

function statusPill(text, variant) {
  const safeText = escapeHTML(text);
  const safeVariant = variant ? ` ${variant}` : "";
  return `<span class="status-pill${safeVariant}">${safeText}</span>`;
}

function foodEntryKey(entry) {
  const name = String(entry.name || "").trim().toLowerCase();
  const brand = String(entry.brand || "").trim().toLowerCase();
  const basis = entry.basis || "100g";
  const serving = entry.serving || "";
  return `${name}||${brand}||${basis}||${serving}`;
}

function perUnitFromEntry(entry, field) {
  const total = Number(entry[field]);
  const qty = Number(entry.quantity);
  if (!Number.isFinite(total) || !Number.isFinite(qty) || qty <= 0) return 0;
  const divisor = entry.basis === "100g" ? (qty / 100) : qty;
  if (!divisor) return 0;
  return total / divisor;
}

function readCustomFoodForm() {
  const name = document.getElementById("custom-food-name")?.value.trim();
  const brand = document.getElementById("custom-food-brand")?.value.trim();
  const basis = document.getElementById("custom-food-basis")?.value || "100g";
  const serving = document.getElementById("custom-food-serving")?.value.trim();
  const kcalPerUnit = Number(document.getElementById("custom-food-kcal")?.value);
  const proteinPerUnit = Number(document.getElementById("custom-food-protein")?.value);
  const qty = Number(document.getElementById("custom-food-qty")?.value);

  if (!name) return { error: "Enter a name for the custom item." };
  if (!Number.isFinite(kcalPerUnit) || kcalPerUnit < 0) return { error: "Enter calories per unit." };
  if (!Number.isFinite(proteinPerUnit) || proteinPerUnit < 0) return { error: "Enter protein per unit." };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter a quantity greater than 0." };

  return {
    name,
    brand: brand || "",
    basis,
    serving: basis === "serving" ? (serving || "") : "",
    kcalPerUnit,
    proteinPerUnit,
    qty
  };
}

function resetCustomFoodForm() {
  const form = document.getElementById("form-custom-food");
  if (!form) return;
  form.reset();
  const qtyInput = document.getElementById("custom-food-qty");
  if (qtyInput) qtyInput.value = "100";
  const servingInput = document.getElementById("custom-food-serving");
  if (servingInput) servingInput.disabled = true;
}

const genericFoods = [
  { name: "Baked ziti", kcalPerUnit: 150, proteinPerUnit: 7 },
  { name: "Baked chicken thighs", kcalPerUnit: 209, proteinPerUnit: 26 },
  { name: "Baked chicken drumsticks", kcalPerUnit: 189, proteinPerUnit: 28 },
  { name: "Baked salmon", kcalPerUnit: 208, proteinPerUnit: 20 },
  { name: "Baked cod", kcalPerUnit: 82, proteinPerUnit: 18 },
  { name: "Baked tofu", kcalPerUnit: 144, proteinPerUnit: 15 },
  { name: "Beef chili", kcalPerUnit: 120, proteinPerUnit: 9, cupGrams: 245 },
  { name: "Beef stew", kcalPerUnit: 90, proteinPerUnit: 8, cupGrams: 245 },
  { name: "Chicken chili", kcalPerUnit: 110, proteinPerUnit: 10, cupGrams: 245 },
  { name: "Chicken noodle soup", kcalPerUnit: 45, proteinPerUnit: 3, cupGrams: 245 },
  { name: "Chicken parmesan", kcalPerUnit: 200, proteinPerUnit: 14 },
  { name: "Chicken soup (clear)", kcalPerUnit: 25, proteinPerUnit: 2, cupGrams: 245 },
  { name: "Chicken stir-fry", kcalPerUnit: 120, proteinPerUnit: 10 },
  { name: "Chicken tikka masala", kcalPerUnit: 170, proteinPerUnit: 9 },
  { name: "Chili (vegetarian)", kcalPerUnit: 100, proteinPerUnit: 6, cupGrams: 245 },
  { name: "Cooked chicken breast", kcalPerUnit: 165, proteinPerUnit: 31 },
  { name: "Cooked salmon", kcalPerUnit: 208, proteinPerUnit: 20 },
  { name: "Cooked shrimp", kcalPerUnit: 99, proteinPerUnit: 24 },
  { name: "Cooked steak (ribeye)", kcalPerUnit: 291, proteinPerUnit: 24 },
  { name: "Cooked steak (sirloin)", kcalPerUnit: 217, proteinPerUnit: 26 },
  { name: "Cooked steak (strip)", kcalPerUnit: 271, proteinPerUnit: 25 },
  { name: "Cooked steak (filet mignon)", kcalPerUnit: 250, proteinPerUnit: 26 },
  { name: "Cooked steak (flank)", kcalPerUnit: 192, proteinPerUnit: 28 },
  { name: "Cooked steak (skirt)", kcalPerUnit: 253, proteinPerUnit: 26 },
  { name: "Cooked white rice", kcalPerUnit: 130, proteinPerUnit: 2.7, cupGrams: 186 },
  { name: "Cooked brown rice", kcalPerUnit: 123, proteinPerUnit: 2.6, cupGrams: 195 },
  { name: "Cooked quinoa", kcalPerUnit: 120, proteinPerUnit: 4.4, cupGrams: 185 },
  { name: "Cooked couscous", kcalPerUnit: 112, proteinPerUnit: 3.8, cupGrams: 157 },
  { name: "Cooked barley", kcalPerUnit: 123, proteinPerUnit: 2.3, cupGrams: 157 },
  { name: "Cooked farro", kcalPerUnit: 125, proteinPerUnit: 4.2, cupGrams: 185 },
  { name: "Cooked bulgur", kcalPerUnit: 83, proteinPerUnit: 3.1, cupGrams: 182 },
  { name: "Cottage pie", kcalPerUnit: 140, proteinPerUnit: 8 },
  { name: "Egg frittata", kcalPerUnit: 160, proteinPerUnit: 11 },
  { name: "Egg scramble", kcalPerUnit: 148, proteinPerUnit: 10 },
  { name: "Eggs (boiled)", kcalPerUnit: 155, proteinPerUnit: 13, servingGrams: 50, servingLabel: "1 egg (50g)", hideLb: true },
  { name: "Eggs (fried)", kcalPerUnit: 196, proteinPerUnit: 14, servingGrams: 50, servingLabel: "1 egg (50g)", hideLb: true },
  { name: "Enchiladas", kcalPerUnit: 180, proteinPerUnit: 9 },
  { name: "Fried rice", kcalPerUnit: 170, proteinPerUnit: 5 },
  { name: "Greek yogurt plain", kcalPerUnit: 59, proteinPerUnit: 10, cupGrams: 245 },
  { name: "Ground beef 90% cooked", kcalPerUnit: 217, proteinPerUnit: 26 },
  { name: "Ground chicken cooked", kcalPerUnit: 170, proteinPerUnit: 23 },
  { name: "Ground turkey cooked", kcalPerUnit: 180, proteinPerUnit: 22 },
  { name: "Homemade lasagna", kcalPerUnit: 170, proteinPerUnit: 10 },
  { name: "Homemade meatballs", kcalPerUnit: 200, proteinPerUnit: 14 },
  { name: "Homemade burger patty (beef)", kcalPerUnit: 254, proteinPerUnit: 17 },
  { name: "Homemade burger patty (turkey)", kcalPerUnit: 189, proteinPerUnit: 21 },
  { name: "Homemade veggie burger", kcalPerUnit: 177, proteinPerUnit: 7 },
  { name: "Mashed potatoes", kcalPerUnit: 110, proteinPerUnit: 2 },
  { name: "Lentil stew", kcalPerUnit: 90, proteinPerUnit: 6, cupGrams: 240 },
  { name: "Lentils (cooked)", kcalPerUnit: 116, proteinPerUnit: 9, cupGrams: 198 },
  { name: "Mac and cheese", kcalPerUnit: 180, proteinPerUnit: 7 },
  { name: "Meatloaf", kcalPerUnit: 190, proteinPerUnit: 12 },
  { name: "Mixed vegetables", kcalPerUnit: 65, proteinPerUnit: 3, cupGrams: 160 },
  { name: "Oatmeal cooked (water)", kcalPerUnit: 68, proteinPerUnit: 2.4, cupGrams: 234 },
  { name: "Olive oil", kcalPerUnit: 884, proteinPerUnit: 0, servingGrams: 13.5, servingLabel: "1 tbsp (13.5g)" },
  { name: "Pinto beans (cooked)", kcalPerUnit: 143, proteinPerUnit: 9, cupGrams: 171 },
  { name: "Black beans (cooked)", kcalPerUnit: 132, proteinPerUnit: 9, cupGrams: 172 },
  { name: "Chickpeas (cooked)", kcalPerUnit: 164, proteinPerUnit: 9, cupGrams: 164 },
  { name: "Kidney beans (cooked)", kcalPerUnit: 127, proteinPerUnit: 9, cupGrams: 177 },
  { name: "Split peas (cooked)", kcalPerUnit: 118, proteinPerUnit: 8, cupGrams: 196 },
  { name: "Pasta with marinara", kcalPerUnit: 140, proteinPerUnit: 5 },
  { name: "Pasta with pesto", kcalPerUnit: 180, proteinPerUnit: 5 },
  { name: "Pasta with olive oil", kcalPerUnit: 160, proteinPerUnit: 5 },
  { name: "Mashed cauliflower", kcalPerUnit: 35, proteinPerUnit: 2 },
  { name: "Roasted garlic", kcalPerUnit: 149, proteinPerUnit: 6.4 },
  { name: "Roasted bell peppers", kcalPerUnit: 31, proteinPerUnit: 1.0 },
  { name: "Pulled pork", kcalPerUnit: 200, proteinPerUnit: 23 },
  { name: "Pulled chicken", kcalPerUnit: 165, proteinPerUnit: 31 },
  { name: "Roasted chicken (mixed)", kcalPerUnit: 190, proteinPerUnit: 26 },
  { name: "Roasted turkey breast", kcalPerUnit: 135, proteinPerUnit: 29 },
  { name: "Roasted broccoli", kcalPerUnit: 55, proteinPerUnit: 3.7 },
  { name: "Roasted asparagus", kcalPerUnit: 22, proteinPerUnit: 2.4 },
  { name: "Roasted brussels sprouts", kcalPerUnit: 43, proteinPerUnit: 3.4 },
  { name: "Roasted cauliflower", kcalPerUnit: 25, proteinPerUnit: 1.9 },
  { name: "Roasted carrots", kcalPerUnit: 41, proteinPerUnit: 0.9 },
  { name: "Roasted green beans", kcalPerUnit: 31, proteinPerUnit: 1.8 },
  { name: "Roasted eggplant", kcalPerUnit: 35, proteinPerUnit: 0.8 },
  { name: "Roasted mushrooms", kcalPerUnit: 28, proteinPerUnit: 3.1 },
  { name: "Roasted onions", kcalPerUnit: 44, proteinPerUnit: 1.2 },
  { name: "Roasted parsnips", kcalPerUnit: 75, proteinPerUnit: 1.2 },
  { name: "Roasted beets", kcalPerUnit: 44, proteinPerUnit: 1.7 },
  { name: "Roasted squash (acorn)", kcalPerUnit: 56, proteinPerUnit: 1.1 },
  { name: "Roasted sweet potatoes", kcalPerUnit: 90, proteinPerUnit: 2 },
  { name: "Roasted butternut squash", kcalPerUnit: 45, proteinPerUnit: 1 },
  { name: "Roasted zucchini", kcalPerUnit: 20, proteinPerUnit: 1.2 },
  { name: "Sauteed spinach", kcalPerUnit: 41, proteinPerUnit: 5.4 },
  { name: "Sauteed kale", kcalPerUnit: 36, proteinPerUnit: 2.5 },
  { name: "Sauteed onions", kcalPerUnit: 40, proteinPerUnit: 1.1 },
  { name: "Sauteed bell peppers", kcalPerUnit: 31, proteinPerUnit: 1.0 },
  { name: "Sauteed zucchini", kcalPerUnit: 20, proteinPerUnit: 1.2 },
  { name: "Sauteed cabbage", kcalPerUnit: 25, proteinPerUnit: 1.3 },
  { name: "Sauteed mushrooms", kcalPerUnit: 28, proteinPerUnit: 2.9 },
  { name: "Steamed broccoli", kcalPerUnit: 35, proteinPerUnit: 2.8 },
  { name: "Steamed green beans", kcalPerUnit: 35, proteinPerUnit: 2 },
  { name: "Steamed carrots", kcalPerUnit: 35, proteinPerUnit: 0.8 },
  { name: "Steamed cauliflower", kcalPerUnit: 25, proteinPerUnit: 1.9 },
  { name: "Steamed asparagus", kcalPerUnit: 22, proteinPerUnit: 2.4 },
  { name: "Steamed spinach", kcalPerUnit: 23, proteinPerUnit: 2.9 },
  { name: "Roasted potatoes", kcalPerUnit: 93, proteinPerUnit: 2 },
  { name: "Baked potato", kcalPerUnit: 93, proteinPerUnit: 2 },
  { name: "Baked sweet potato", kcalPerUnit: 90, proteinPerUnit: 2 },
  { name: "Roasted corn", kcalPerUnit: 96, proteinPerUnit: 3.4 },
  { name: "Corn on the cob (boiled)", kcalPerUnit: 96, proteinPerUnit: 3.4 },
  { name: "Rice pilaf", kcalPerUnit: 150, proteinPerUnit: 3.1, cupGrams: 195 },
  { name: "Vegetable stir-fry", kcalPerUnit: 90, proteinPerUnit: 3 },
  { name: "Tofu stir-fry", kcalPerUnit: 120, proteinPerUnit: 10 },
  { name: "Chicken stir-fry (light)", kcalPerUnit: 110, proteinPerUnit: 12 },
  { name: "Shepherds pie", kcalPerUnit: 150, proteinPerUnit: 8 },
  { name: "Shrimp stir-fry", kcalPerUnit: 120, proteinPerUnit: 16 },
  { name: "Stuffed peppers", kcalPerUnit: 120, proteinPerUnit: 6 },
  { name: "Taco filling (beef)", kcalPerUnit: 210, proteinPerUnit: 14 },
  { name: "Taco filling (chicken)", kcalPerUnit: 170, proteinPerUnit: 24 },
  { name: "Taco filling (turkey)", kcalPerUnit: 180, proteinPerUnit: 23 },
  { name: "Turkey meatballs", kcalPerUnit: 170, proteinPerUnit: 16 },
  { name: "Turkey chili", kcalPerUnit: 105, proteinPerUnit: 10, cupGrams: 245 },
  { name: "Turkey meatloaf", kcalPerUnit: 170, proteinPerUnit: 14 },
  { name: "Vegetable casserole", kcalPerUnit: 90, proteinPerUnit: 4 },
  { name: "Vegetable soup", kcalPerUnit: 40, proteinPerUnit: 2, cupGrams: 245 },
  { name: "Chicken casserole", kcalPerUnit: 160, proteinPerUnit: 12 },
  { name: "Butter", kcalPerUnit: 717, proteinPerUnit: 0.9, servingGrams: 14, servingLabel: "1 tbsp (14g)" },
  { name: "Brownie (fudgy)", kcalPerUnit: 466, proteinPerUnit: 4.1, servingGrams: 60, servingLabel: "1 brownie (60g)", hideLb: true },
  { name: "Brownie (cake-like)", kcalPerUnit: 430, proteinPerUnit: 4.4, servingGrams: 60, servingLabel: "1 brownie (60g)", hideLb: true },
  { name: "Brownie (protein)", kcalPerUnit: 350, proteinPerUnit: 18, servingGrams: 50, servingLabel: "1 brownie (50g)", hideLb: true },
  { name: "Cookie (chocolate chip)", kcalPerUnit: 488, proteinPerUnit: 5.5, servingGrams: 30, servingLabel: "1 cookie (30g)", hideLb: true },
  { name: "Cookie (oatmeal)", kcalPerUnit: 450, proteinPerUnit: 6.0, servingGrams: 30, servingLabel: "1 cookie (30g)", hideLb: true },
  { name: "Cookie (peanut butter)", kcalPerUnit: 496, proteinPerUnit: 8.0, servingGrams: 30, servingLabel: "1 cookie (30g)", hideLb: true },
  { name: "Cookie (sugar)", kcalPerUnit: 466, proteinPerUnit: 5.0, servingGrams: 28, servingLabel: "1 cookie (28g)", hideLb: true },
  { name: "Avocado", kcalPerUnit: 160, proteinPerUnit: 2 },
  { name: "Guacamole (plain)", kcalPerUnit: 160, proteinPerUnit: 2 },
  { name: "Hummus", kcalPerUnit: 166, proteinPerUnit: 8 },
  { name: "Salsa", kcalPerUnit: 36, proteinPerUnit: 1.5, cupGrams: 240 },
  { name: "Cooked oats (milk)", kcalPerUnit: 94, proteinPerUnit: 3.4, cupGrams: 234 },
  { name: "Cooked oatmeal (milk)", kcalPerUnit: 94, proteinPerUnit: 3.4, cupGrams: 234 },
  { name: "Pancakes (plain)", kcalPerUnit: 227, proteinPerUnit: 6 },
  { name: "Waffles (plain)", kcalPerUnit: 291, proteinPerUnit: 6 },
  { name: "French toast", kcalPerUnit: 230, proteinPerUnit: 9 },
  { name: "Grilled cheese", kcalPerUnit: 330, proteinPerUnit: 12 },
  { name: "PB&J sandwich", kcalPerUnit: 300, proteinPerUnit: 9 },
  { name: "Apple", kcalPerUnit: 52, proteinPerUnit: 0.3, servingGrams: 182, servingLabel: "1 medium (182g)" },
  { name: "Banana", kcalPerUnit: 89, proteinPerUnit: 1.1, servingGrams: 118, servingLabel: "1 medium (118g)" },
  { name: "Cantaloupe", kcalPerUnit: 34, proteinPerUnit: 0.8 },
  { name: "Blueberries", kcalPerUnit: 57, proteinPerUnit: 0.7 },
  { name: "Grapes", kcalPerUnit: 69, proteinPerUnit: 0.7 },
  { name: "Mango", kcalPerUnit: 60, proteinPerUnit: 0.8 },
  { name: "Orange", kcalPerUnit: 47, proteinPerUnit: 0.9, servingGrams: 131, servingLabel: "1 medium (131g)" },
  { name: "Pineapple", kcalPerUnit: 50, proteinPerUnit: 0.5 },
  { name: "Strawberries", kcalPerUnit: 32, proteinPerUnit: 0.7 },
  { name: "Watermelon", kcalPerUnit: 30, proteinPerUnit: 0.6 },
  { name: "Bell pepper (red)", kcalPerUnit: 31, proteinPerUnit: 1.0 },
  { name: "Broccoli (raw)", kcalPerUnit: 34, proteinPerUnit: 2.8 },
  { name: "Carrots", kcalPerUnit: 41, proteinPerUnit: 0.9 },
  { name: "Cucumber", kcalPerUnit: 15, proteinPerUnit: 0.7 },
  { name: "Green beans", kcalPerUnit: 31, proteinPerUnit: 1.8 },
  { name: "Lettuce", kcalPerUnit: 15, proteinPerUnit: 1.4 },
  { name: "Spinach", kcalPerUnit: 23, proteinPerUnit: 2.9 },
  { name: "Tomato", kcalPerUnit: 18, proteinPerUnit: 0.9 },
  { name: "Zucchini", kcalPerUnit: 17, proteinPerUnit: 1.2 },
  { name: "Sweet potato", kcalPerUnit: 86, proteinPerUnit: 1.6 }
];

function renderGenericFoods(query = "") {
  const results = document.getElementById("generic-results");
  if (!results) return;

  const q = query.trim().toLowerCase();
  const items = q ? genericFoods.filter(f => f.name.toLowerCase().includes(q)) : [];

  if (!q) {
    results.innerHTML = `<div class="muted">Start typing to search homemade foods.</div>`;
    return;
  }

  if (!items.length) {
    results.innerHTML = `<div class="muted">No matches. Try another search.</div>`;
    return;
  }

  results.innerHTML = items.map(item => {
    const name = escapeHTML(item.name);
    const kcalLb = per100gToLb(item.kcalPerUnit);
    const proteinLb = per100gToLb(item.proteinPerUnit);
    const kcalOz = per100gToOz(item.kcalPerUnit);
    const proteinOz = per100gToOz(item.proteinPerUnit);
    const kcalCup = Number.isFinite(item.cupGrams) ? per100gToCup(item.kcalPerUnit, item.cupGrams) : null;
    const proteinCup = Number.isFinite(item.cupGrams) ? per100gToCup(item.proteinPerUnit, item.cupGrams) : null;
    const servingKcal = Number.isFinite(item.servingGrams) ? per100gToServing(item.kcalPerUnit, item.servingGrams) : null;
    const servingProtein = Number.isFinite(item.servingGrams) ? per100gToServing(item.proteinPerUnit, item.servingGrams) : null;
    const servingLabel = item.servingLabel ? escapeHTML(item.servingLabel) : "";
    const cupAction = Number.isFinite(kcalCup)
      ? `
            <div class="food-action">
              <label>Cups (approx)
                <input type="number" class="food-qty" min="0" step="0.25" value="1" data-qty-basis="cup">
              </label>
              <button class="btn-secondary btn-sm" data-action="add-generic" data-basis="cup" data-name="${encodeURIComponent(item.name)}" data-kcal="${kcalCup}" data-protein="${proteinCup}">Add cups</button>
            </div>
          `
      : "";
    const servingAction = Number.isFinite(servingKcal)
      ? `
            <div class="food-action">
              <label>Serving${servingLabel ? ` (${servingLabel})` : ""}
                <input type="number" class="food-qty" min="0" step="0.25" value="1" data-qty-basis="serving">
              </label>
              <button class="btn-secondary btn-sm" data-action="add-generic" data-basis="serving" data-name="${encodeURIComponent(item.name)}" data-serving="${encodeURIComponent(item.servingLabel || "")}" data-kcal="${servingKcal}" data-protein="${servingProtein}">Add serving</button>
            </div>
          `
      : "";
    const lbAction = item.hideLb
      ? ""
      : `
            <div class="food-action">
              <label>Pounds
                <input type="number" class="food-qty" min="0" step="0.1" value="1" data-qty-basis="lb">
              </label>
              <button class="btn-secondary btn-sm" data-action="add-generic" data-basis="lb" data-name="${encodeURIComponent(item.name)}" data-kcal="${kcalLb}" data-protein="${proteinLb}">Add lbs</button>
            </div>
          `;
    const ozAction = `
            <div class="food-action">
              <label>Ounces
                <input type="number" class="food-qty" min="0" step="0.1" value="1" data-qty-basis="oz">
              </label>
              <button class="btn-secondary btn-sm" data-action="add-generic" data-basis="oz" data-name="${encodeURIComponent(item.name)}" data-kcal="${kcalOz}" data-protein="${proteinOz}">Add oz</button>
            </div>
          `;
    return `
      <article class="card food-card">
        <div class="food-body">
          <div class="food-title">${name}</div>
          <div class="food-macros">
            <div><span class="label">cal/100g</span>${fmtNutrient(item.kcalPerUnit, 0)}</div>
            <div><span class="label">protein/100g</span>${fmtNutrient(item.proteinPerUnit, 1)} g</div>
          </div>
          <div class="food-actions">
            ${servingAction}
            <div class="food-action">
              <label>Grams
                <input type="number" class="food-qty" min="0" step="1" value="100" data-qty-basis="100g">
              </label>
              <button class="btn-secondary btn-sm" data-action="add-generic" data-basis="100g" data-name="${encodeURIComponent(item.name)}" data-kcal="${item.kcalPerUnit}" data-protein="${item.proteinPerUnit}">Add grams</button>
            </div>
            ${ozAction}
            ${lbAction}
            ${cupAction}
            <div class="food-action">
              <label>Favorite default (g)
                <input type="number" class="food-qty" min="0" step="1" value="100" data-qty-basis="favorite">
              </label>
              <button class="btn-secondary btn-sm" data-action="favorite-generic" data-name="${encodeURIComponent(item.name)}" data-kcal="${item.kcalPerUnit}" data-protein="${item.proteinPerUnit}">Add favorite</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

async function updateDailyCaloriesFromFood(date, total, entryCount) {
  const caloriesInput = document.getElementById("day-calories");
  const vitaminCalories = await getVitaminCaloriesForDate(date);
  const hasVitaminCalories = vitaminCalories > 0;
  const linked = caloriesInput?.dataset.foodLinked === "1";
  if (!entryCount && !linked && !hasVitaminCalories) return;

  const combined = (entryCount ? total : 0) + vitaminCalories;
  const rounded = (entryCount || hasVitaminCalories) ? Math.round(combined) : null;
  if (caloriesInput) {
    caloriesInput.value = rounded ?? "";
    if (entryCount) caloriesInput.dataset.foodLinked = "1";
    else caloriesInput.removeAttribute("data-food-linked");
  }
  const existing = await db.daily.get(date);
  const entry = existing ? { ...existing, date, calories: rounded } : { date, calories: rounded };
  await db.daily.put(entry);
}

async function getVitaminCaloriesForDate(date) {
  if (!date) return 0;
  const [items, logs] = await Promise.all([getVitamins(), getVitaminLogsByDate(date)]);
  if (!items.length || !logs.length) return 0;
  const caloriesById = new Map(items.map(i => [i.id, Number(i.calories) || 0]));
  return logs.reduce((sum, log) => {
    if (!log.taken) return sum;
    return sum + (caloriesById.get(log.vitaminId) || 0);
  }, 0);
}

async function refreshDailyCaloriesFromSources(date) {
  if (!date) return;
  const entries = await getFoodEntriesByDate(date);
  const total = entries.reduce((sum, e) => sum + (Number(e.calories) || 0), 0);
  await updateDailyCaloriesFromFood(date, total, entries.length);
}

async function updateDailyProteinFromFood(date, total, entryCount) {
  const proteinInput = document.getElementById("day-protein");
  const linked = proteinInput?.dataset.foodLinked === "1";
  if (!entryCount && !linked) return;

  const rounded = entryCount ? Math.round(total) : null;
  if (proteinInput) {
    proteinInput.value = rounded ?? "";
    if (entryCount) proteinInput.dataset.foodLinked = "1";
    else proteinInput.removeAttribute("data-food-linked");
  }
  const existing = await db.daily.get(date);
  const entry = existing ? { ...existing, date, protein: rounded } : { date, protein: rounded };
  await db.daily.put(entry);
}

async function renderFoodLog(date) {
  const list = document.getElementById("food-log-list");
  const totalEl = document.getElementById("food-log-total");
  if (!list || !totalEl) return;

  const entries = await getFoodEntriesByDate(date);
  const total = entries.reduce((sum, e) => sum + (Number(e.calories) || 0), 0);
  const proteinTotal = entries.reduce((sum, e) => sum + (Number(e.protein) || 0), 0);
  totalEl.textContent = entries.length
    ? `Food total: ${Math.round(total)} cal • ${Math.round(proteinTotal)} g protein`
    : "No foods added yet.";

  list.innerHTML = entries.map(e => {
    const name = escapeHTML(e.name || "Unknown item");
    const brand = escapeHTML(e.brand || "");
    const qty = Number(e.quantity) || 0;
    const basis = basisLabel(e.basis, e.serving);
    const amountText = basisAmountText(e.basis, qty);
    const proteinText = Number.isFinite(Number(e.protein)) ? `${Math.round(Number(e.protein))} g protein` : "—";
    return `
      <div class="food-log-item">
        <div>
          <div class="food-log-name">${name}</div>
          <div class="muted">${brand ? `${brand} • ` : ""}${basis} • ${amountText} • ${Math.round(Number(e.calories) || 0)} cal • ${proteinText}</div>
        </div>
        <div class="food-log-actions">
          <label class="food-log-edit">
            kcal
            <input type="number" class="food-edit-kcal" min="0" step="1" value="${Math.round(Number(e.calories) || 0)}" data-id="${e.id}">
          </label>
          <label class="food-log-edit">
            protein
            <input type="number" class="food-edit-protein" min="0" step="1" value="${Math.round(Number(e.protein) || 0)}" data-id="${e.id}">
          </label>
          <button class="btn-secondary btn-sm" data-action="update-food" data-id="${e.id}" title="Update" aria-label="Update">↻</button>
          <button class="btn-secondary btn-sm" data-action="duplicate-food" data-id="${e.id}" title="Duplicate" aria-label="Duplicate">⧉</button>
          <button class="btn-secondary btn-sm" data-action="favorite-food" data-id="${e.id}" title="Favorite" aria-label="Favorite">★</button>
          <button class="btn-secondary btn-sm" data-action="remove-food" data-id="${e.id}" title="Remove" aria-label="Remove">✕</button>
        </div>
      </div>
    `;
  }).join("");

  await updateDailyCaloriesFromFood(date, total, entries.length);
  await updateDailyProteinFromFood(date, proteinTotal, entries.length);
}

async function renderFavorites() {
  const list = document.getElementById("favorite-list");
  const status = document.getElementById("favorite-status");
  if (!list || !status) return;

  const favorites = await getFavorites();
  if (!favorites.length) {
    status.textContent = "No favorites yet.";
    list.innerHTML = "";
    return;
  }

  status.textContent = `${favorites.length} favorite${favorites.length === 1 ? "" : "s"}`;
  list.innerHTML = favorites.map(f => {
    const name = escapeHTML(f.name || "Unknown item");
    const brand = escapeHTML(f.brand || "");
    const basis = basisLabel(f.basis, f.serving);
    const kcalPer = Number(f.kcalPerUnit) || 0;
    const proteinPer = Number(f.proteinPerUnit) || 0;
    const defaultQty = Number(f.defaultQty) || (f.basis === "100g" ? 100 : 1);
    const defaultAmountText = basisAmountText(f.basis, defaultQty);
    const qtyStep = qtyDefaultsForBasis(f.basis).step;
    const qtyUnit = basisUnitShort(f.basis);
    return `
      <div class="food-log-item">
        <div>
          <div class="food-log-name">${name}</div>
          <div class="muted">${brand ? `${brand} • ` : ""}${basis} • Default add: ${defaultAmountText} • ${Math.round(kcalPer)} cal • ${Math.round(proteinPer)} g protein per ${basisUnitLabel(f.basis)}</div>
        </div>
        <div class="favorite-actions">
          <label class="qty-label">
            <span class="qty-unit">${qtyUnit}</span>
            <input type="number" class="favorite-qty" min="0" step="${qtyStep}" value="${defaultQty}" data-id="${f.id}">
          </label>
          <button class="btn-secondary btn-sm" data-action="add-favorite" data-id="${f.id}">Add</button>
          <button class="btn-secondary btn-sm" data-action="save-favorite" data-id="${f.id}">Save Qty</button>
          <button class="btn-secondary btn-sm" data-action="remove-favorite" data-id="${f.id}">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderRecentFoodRow(entry, options = {}) {
  const name = escapeHTML(entry.name || "Unknown item");
  const brand = escapeHTML(entry.brand || "");
  const basis = entry.basis || "100g";
  const serving = entry.serving || "";
  const qtyDefault = Number(entry.quantity) || (basis === "100g" ? 100 : 1);
  const qtyStep = qtyDefaultsForBasis(basis).step;
  const kcalPerUnit = perUnitFromEntry(entry, "calories");
  const proteinPerUnit = perUnitFromEntry(entry, "protein");
  const countText = Number.isFinite(options.count) ? ` • ${options.count}x logged` : "";
  const amountText = basisAmountText(basis, qtyDefault);
  const qtyUnit = basisUnitShort(basis);
  const perUnitText = Number.isFinite(kcalPerUnit) && kcalPerUnit > 0
    ? `${Math.round(kcalPerUnit)} cal • ${Math.round(proteinPerUnit)} g protein per ${basisUnitLabel(basis)}`
    : "Missing macro data";

  return `
    <div class="food-log-item">
      <div>
        <div class="food-log-name">${name}</div>
        <div class="muted">${brand ? `${brand} • ` : ""}${basisLabel(basis, serving)} • Default add: ${amountText} • ${perUnitText}${countText}</div>
      </div>
      <div class="favorite-actions">
        <label class="qty-label">
          <span class="qty-unit">${qtyUnit}</span>
          <input type="number" class="recent-qty" min="0" step="${qtyStep}" value="${qtyDefault}">
        </label>
        <button class="btn-secondary btn-sm" data-action="${options.action || "add-recent"}" data-name="${encodeURIComponent(entry.name || "Unknown item")}" data-brand="${encodeURIComponent(entry.brand || "")}" data-basis="${basis}" data-serving="${encodeURIComponent(serving || "")}" data-kcal="${kcalPerUnit}" data-protein="${proteinPerUnit}">Add</button>
        <button class="btn-secondary btn-sm" data-action="${options.favoriteAction || "favorite-recent"}" data-name="${encodeURIComponent(entry.name || "Unknown item")}" data-brand="${encodeURIComponent(entry.brand || "")}" data-basis="${basis}" data-serving="${encodeURIComponent(serving || "")}" data-kcal="${kcalPerUnit}" data-protein="${proteinPerUnit}" data-qty="${qtyDefault}">Favorite</button>
      </div>
    </div>
  `;
}

async function renderLoggedFoodSearch() {
  const list = document.getElementById("logged-food-list");
  const status = document.getElementById("logged-food-status");
  if (!list || !status) return;

  const rawQuery = (document.getElementById("logged-food-query")?.value || "").trim();
  const query = rawQuery.toLowerCase();
  const entries = await db.foodEntries.orderBy("id").reverse().toArray();
  if (!entries.length) {
    status.textContent = "No logged foods yet.";
    list.innerHTML = "";
    return;
  }
  if (!query) {
    status.textContent = "Type to search logged foods.";
    list.innerHTML = "";
    return;
  }

  const counts = new Map();
  const uniqueItems = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = foodEntryKey(entry);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(entry);
  }

  const filteredItems = uniqueItems.filter(entry => {
    const name = String(entry.name || "");
    const brand = String(entry.brand || "");
    const serving = String(entry.serving || "");
    const haystack = `${name} ${brand} ${serving}`.toLowerCase();
    return haystack.includes(query);
  });

  const rows = filteredItems.map(entry => renderRecentFoodRow(entry, {
    action: "add-logged",
    favoriteAction: "favorite-logged",
    count: counts.get(foodEntryKey(entry))
  }));

  if (!rows.length) {
    status.textContent = `No matches for "${rawQuery}".`;
    list.innerHTML = "";
    return;
  }

  status.textContent = `${rows.length} match${rows.length === 1 ? "" : "es"} from ${uniqueItems.length} logged item${uniqueItems.length === 1 ? "" : "s"}.`;
  list.innerHTML = rows.join("");
}

async function renderPerformanceReview() {
  const list = document.getElementById("performance-list");
  const status = document.getElementById("performance-status");
  const suggestionList = document.getElementById("performance-suggestions");
  const suggestionStatus = document.getElementById("performance-suggestions-status");
  const hasLog = Boolean(list && status);
  const hasSuggestions = Boolean(suggestionList && suggestionStatus);
  if (!hasLog && !hasSuggestions) return;

  const dates = getRecentDates(7);
  const entries = await db.daily.where("date").anyOf(dates).toArray();
  const entryMap = new Map(entries.map(e => [e.date, e]));
  const latestWeight = await getLatestWeightValue();
  const proteinFactor = getProteinTargetFactor();
  const proteinTarget = Number(latestWeight) ? Math.round(Number(latestWeight) * proteinFactor) : null;
  const calorieTargetValue = getCalorieTarget();
  const weights = dates
    .map(date => {
      const entry = entryMap.get(date);
      const weight = entry ? Number(entry.weight) : null;
      return Number.isFinite(weight) ? { date, weight } : null;
    })
    .filter(Boolean);
  const netWeightChange = weights.length >= 2
    ? weights[0].weight - weights[weights.length - 1].weight
    : null;

  let proteinLoggedDays = 0;
  let proteinUnderCount = 0;
  let proteinMetCount = 0;
  let calorieLoggedDays = 0;
  let calorieOverCount = 0;
  let calorieMetCount = 0;

  const rows = [];
  for (const date of dates) {
    const entry = entryMap.get(date);
    const calories = entry ? Number(entry.calories) : null;
    const protein = entry ? Number(entry.protein) : null;
    const calorieTarget = calorieTargetValue;
    const hasLog = entry && (Number.isFinite(calories) || Number.isFinite(protein));

    let calorieStatus = statusPill("No target", "neutral");
    if (!hasLog) {
      calorieStatus = statusPill("No log", "neutral");
    } else if (calorieTarget !== null && Number.isFinite(calories)) {
      calorieLoggedDays += 1;
      if (calories <= calorieTarget) {
        calorieStatus = statusPill("Calories met", "success");
        calorieMetCount += 1;
      } else {
        calorieStatus = statusPill(`Over by ${Math.round(calories - calorieTarget)} cal`, "danger");
        calorieOverCount += 1;
      }
    }

    let proteinStatus = statusPill("No target", "neutral");
    if (!hasLog) {
      proteinStatus = statusPill("No log", "neutral");
    } else if (proteinTarget !== null && Number.isFinite(protein)) {
      proteinLoggedDays += 1;
      if (protein >= proteinTarget) {
        proteinStatus = statusPill("Protein met", "success");
        proteinMetCount += 1;
      } else {
        proteinStatus = statusPill(`Under by ${Math.round(proteinTarget - protein)} g`, "danger");
        proteinUnderCount += 1;
      }
    }

    rows.push(`
      <div class="food-log-item">
        <div>
          <div class="food-log-name">${prettyDate(date)}</div>
          <div class="muted">${date}</div>
        </div>
        <div class="status-row">
          ${calorieStatus}
          ${proteinStatus}
        </div>
      </div>
    `);
  }

  const netText = netWeightChange === null
    ? "Net weight: log more days to calculate."
    : `Net weight: ${netWeightChange >= 0 ? "+" : ""}${netWeightChange.toFixed(1)} lb`;
  if (hasLog) {
    status.textContent = `Last 7 days • Goals met are based on your targets. • ${netText}`;
    list.innerHTML = rows.join("");
  }

  if (!hasSuggestions) return;
  const suggestions = [];
  const proteinThreshold = Math.max(2, Math.ceil(proteinLoggedDays * 0.6));
  const calorieThreshold = Math.max(2, Math.ceil(calorieLoggedDays * 0.6));

  if (proteinTarget === null) {
    suggestions.push({ text: "Set a protein target by logging a recent weight and adjusting the protein slider." });
  } else if (proteinLoggedDays && proteinUnderCount >= proteinThreshold) {
    suggestions.push({ text: "You missed protein on most logged days. Aim for a protein-rich anchor at each meal." });
    suggestions.push({ text: "Protein sources: Greek yogurt, eggs, chicken breast, tofu, lentils, whey or pea protein." });
    suggestions.push({
      text: "Harvard nutrition source: protein",
      href: "https://www.hsph.harvard.edu/nutritionsource/what-should-you-eat/protein/"
    });
  }

  if (calorieTargetValue === null) {
    suggestions.push({ text: "Set a daily calorie target in Targets to track goal adherence." });
  } else if (calorieLoggedDays && calorieOverCount >= calorieThreshold) {
    suggestions.push({ text: "You were over calories on most logged days. Try adding volume foods (vegetables, broth soups) and pre-portion snacks." });
  }

  if (!entries.length) {
    suggestions.length = 0;
    suggestions.push({ text: "Start logging meals and weights so the review can surface trends." });
  }

  suggestionStatus.textContent = suggestions.length ? "Suggestions" : "no suggestions right now.";
  suggestionList.innerHTML = suggestions.length
    ? `<ul class="suggestion-list">${suggestions.map(item => {
      if (item.href) {
        return `<li><a href="${item.href}" target="_blank" rel="noreferrer">${escapeHTML(item.text)}</a></li>`;
      }
      return `<li>${escapeHTML(item.text)}</li>`;
    }).join("")}</ul>`
    : "";
}

async function renderVitamins() {
  const list = document.getElementById("vitamin-list");
  const todayList = document.getElementById("vitamin-today-list");
  const todayStatus = document.getElementById("vitamin-today-status");
  if (!list || !todayList || !todayStatus) return;

  const items = await getVitamins();
  const today = isoToday();
  const dayIndex = new Date(today + "T12:00:00").getDay();
  const logs = await getVitaminLogsByDate(today);
  const takenMap = new Map(logs.map(l => [l.vitaminId, Boolean(l.taken)]));

  if (!items.length) {
    todayStatus.textContent = "No vitamins or meds yet.";
    todayList.innerHTML = "";
    list.innerHTML = "";
    return;
  }

  const todayItems = items.filter(i => Array.isArray(i.days) && i.days.includes(dayIndex));
  todayStatus.textContent = todayItems.length ? `Scheduled for ${weekdayLabel(dayIndex)}` : "Nothing scheduled today.";
  todayList.innerHTML = todayItems.map(i => {
    const checked = takenMap.get(i.id) ? "checked" : "";
    const calories = Number(i.calories) || 0;
    const caloriesText = calories ? ` • ${Math.round(calories)} cal` : "";
    return `
      <label class="vitamin-row">
        <span>${escapeHTML(i.name)}${caloriesText}</span>
        <input type="checkbox" data-action="vitamin-taken" data-id="${i.id}" ${checked} />
      </label>
    `;
  }).join("");

  list.innerHTML = items.map(i => {
    const days = (i.days || []).map(d => `<span class="day-pill">${weekdayLabel(d)}</span>`).join("");
    const calories = Number(i.calories) || 0;
    const calorieLine = calories ? `<div class="muted">${Math.round(calories)} cal</div>` : "";
    return `
      <div class="vitamin-item">
        <div>
          <div class="vitamin-name">${escapeHTML(i.name)}</div>
          ${calorieLine}
          <div class="vitamin-days">${days}</div>
        </div>
        <div class="vitamin-actions">
          <button class="btn-secondary btn-sm" data-action="remove-vitamin" data-id="${i.id}">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

async function renderRunLog() {
  const list = document.getElementById("run-log-list");
  const status = document.getElementById("run-log-status");
  if (!list || !status) return;

  const runs = await db.runs.orderBy("date").reverse().toArray();
  if (!runs.length) {
    status.textContent = "No runs logged yet.";
    list.innerHTML = "";
    return;
  }

  status.textContent = `${runs.length} run${runs.length === 1 ? "" : "s"} logged.`;
  list.innerHTML = runs.map(r => {
    const distance = Number(r.distanceMi);
    const duration = Number(r.durationMin);
    const distanceText = Number.isFinite(distance) ? fmt(distance, 2) : "—";
    const durationText = Number.isFinite(duration) ? fmt(duration, 0) : "—";
    const pace = paceString(distance, duration);
    const typeText = r.type ? ` • ${escapeHTML(r.type)}` : "";
    return `
      <div class="food-log-item">
        <div>
          <div class="food-log-name">${distanceText} mi • ${durationText} min • ${pace}</div>
          <div class="muted">${r.date}${typeText}</div>
        </div>
      </div>
    `;
  }).join("");
}

// Forms
document.getElementById("form-weight").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("weight-status");
  const date = getActiveFoodDate();
  if (!date) {
    status.textContent = "Pick a date first.";
    return;
  }

  const weightValue = Number(document.getElementById("day-weight").value);
  const existing = await db.daily.get(date);
  const entry = {
    ...(existing || {}),
    date,
    weight: Number.isFinite(weightValue) && weightValue > 0 ? weightValue : null
  };
  await upsertDaily(entry);
  status.textContent = `Weight saved for ${date}.`;
  await updateTargetDisplay();
  await renderDashboard();
});

document.getElementById("form-day").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = getActiveFoodDate();
  if (!date) {
    document.getElementById("day-status").textContent = "Pick a date first.";
    return;
  }

  const existing = await db.daily.get(date);
  const entry = {
    ...(existing || {}),
    date,
    calories: Number(document.getElementById("day-calories").value) || null,
    protein: Number(document.getElementById("day-protein").value) || null,
    notes: document.getElementById("day-notes").value || ""
  };
  await upsertDaily(entry);
  document.getElementById("day-status").textContent = "Saved.";
  await renderDashboard();
});

document.getElementById("day-date").addEventListener("change", async () => {
  await renderFoodLog(getActiveFoodDate());
  await updateTargetDisplay();
  await setWeightInputForDate(getActiveFoodDate());
});

document.getElementById("day-calories").addEventListener("input", () => {
  const input = document.getElementById("day-calories");
  if (input) input.removeAttribute("data-food-linked");
});

document.getElementById("day-protein").addEventListener("input", () => {
  const input = document.getElementById("day-protein");
  if (input) input.removeAttribute("data-food-linked");
});

document.getElementById("form-food").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("food-query");
  const status = document.getElementById("food-status");
  const query = input.value.trim();

  if (!query) {
    status.textContent = "Enter a food or brand to search.";
    return;
  }

  status.textContent = "Searching...";
  try {
    const data = await searchFood(query);
    const products = Array.isArray(data.products) ? data.products : [];
    renderFoodResults(products);
    status.textContent = `${products.length} result${products.length === 1 ? "" : "s"} found.`;
  } catch (err) {
    status.textContent = "Search failed. Check your connection and try again.";
  }
});

document.getElementById("generic-query").addEventListener("input", (e) => {
  renderGenericFoods(e.target.value);
});

const loggedFoodQuery = document.getElementById("logged-food-query");
if (loggedFoodQuery) {
  loggedFoodQuery.addEventListener("input", async () => {
    await renderLoggedFoodSearch();
  });
}

document.getElementById("generic-results").addEventListener("click", async (e) => {
  const addBtn = e.target.closest("[data-action='add-generic']");
  if (addBtn) {
    const card = addBtn.closest(".food-card");
    const basis = addBtn.dataset.basis || "100g";
    const serving = decodeValue(addBtn.dataset.serving) || "";
    const qtyInput = card?.querySelector(`.food-qty[data-qty-basis="${basis}"]`);
    const qty = Number(qtyInput?.value) || 0;
    const kcalPerUnit = Number(addBtn.dataset.kcal);
    const proteinPerUnit = Number(addBtn.dataset.protein);
    if (!Number.isFinite(kcalPerUnit) || qty <= 0) return;

    const date = getActiveFoodDate();
    await addFoodEntry({
      date,
      name: decodeValue(addBtn.dataset.name) || "Unknown item",
      brand: "",
      basis,
      serving,
      quantity: qty,
      calories: amountFromBasis(kcalPerUnit, basis, qty),
      protein: amountFromBasis(proteinPerUnit, basis, qty),
      addedAt: new Date().toISOString()
    });
    await renderFoodLog(date);
    await renderLoggedFoodSearch();
    return;
  }

  const favBtn = e.target.closest("[data-action='favorite-generic']");
  if (favBtn) {
    const card = favBtn.closest(".food-card");
    const qtyInput = card?.querySelector(`.food-qty[data-qty-basis="favorite"]`);
    const qty = Number(qtyInput?.value) || 0;
    const kcalPerUnit = Number(favBtn.dataset.kcal);
    const proteinPerUnit = Number(favBtn.dataset.protein);
    if (!Number.isFinite(kcalPerUnit) || qty <= 0) return;

    await addFavorite({
      name: decodeValue(favBtn.dataset.name) || "Unknown item",
      brand: "",
      basis: "100g",
      serving: "",
      kcalPerUnit,
      proteinPerUnit,
      defaultQty: qty,
      addedAt: new Date().toISOString()
    });
    await renderFavorites();
  }
});

document.getElementById("food-results").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='add-food']");
  if (!btn) return;

  const kcal = Number(btn.dataset.kcal);
  const proteinPerUnit = Number(btn.dataset.protein);
  const status = document.getElementById("food-status");
  if (!Number.isFinite(kcal)) {
    status.textContent = "This item is missing calorie data.";
    return;
  }

  const card = btn.closest(".food-card");
  const basis = btn.dataset.basis || "100g";
  let qty = 1;
  if (card) {
    const qtyInput = card.querySelector(`.food-qty[data-qty-basis="${basis}"]`);
    if (qtyInput) qty = Number(qtyInput.value) || 0;
  }
  if (qty <= 0) {
    status.textContent = "Enter an amount greater than 0.";
    return;
  }

  const date = getActiveFoodDate();
  const calories = amountFromBasis(kcal, basis, qty);
  const protein = amountFromBasis(proteinPerUnit, basis, qty);
  await addFoodEntry({
    date,
    name: decodeValue(btn.dataset.name) || "Unknown item",
    brand: decodeValue(btn.dataset.brand),
    basis,
    serving: decodeValue(btn.dataset.serving),
    quantity: qty,
    calories,
    protein,
    addedAt: new Date().toISOString()
  });

  status.textContent = `Added to ${date}.`;
  await renderFoodLog(date);
  await renderLoggedFoodSearch();
});

document.getElementById("food-log-list").addEventListener("click", async (e) => {
  const updateBtn = e.target.closest("[data-action='update-food']");
  if (updateBtn) {
    const id = Number(updateBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    const row = updateBtn.closest(".food-log-item");
    const kcalInput = row?.querySelector(".food-edit-kcal");
    const proteinInput = row?.querySelector(".food-edit-protein");
    const calories = Number(kcalInput?.value);
    const protein = Number(proteinInput?.value);
    if (!Number.isFinite(calories) || calories < 0) return;
    if (!Number.isFinite(protein) || protein < 0) return;
    await updateFoodEntry(id, { calories, protein });
    const entries = await getFoodEntriesByDate(getActiveFoodDate());
    const entry = entries.find(x => x.id === id);
    if (entry) {
      let qty = Number(entry.quantity) || 0;
      if (qty <= 0) {
        qty = entry.basis === "100g" ? 100 : 1;
        await updateFoodEntry(id, { quantity: qty });
      }
      const kcalPerUnit = calories / (entry.basis === "100g" ? (qty / 100) : qty);
      const proteinPerUnit = protein / (entry.basis === "100g" ? (qty / 100) : qty);
      if (Number.isFinite(kcalPerUnit) && kcalPerUnit > 0) {
        const favorites = await getFavorites();
        const matches = favorites.filter(f =>
          (f.name || "") === (entry.name || "") &&
          (f.brand || "") === (entry.brand || "") &&
          (f.basis || "") === (entry.basis || "") &&
          (f.serving || "") === (entry.serving || "")
        );
        await Promise.all(matches.map(f => updateFavorite(f.id, { kcalPerUnit, proteinPerUnit })));
        await renderFavorites();
      }
    }
    await renderFoodLog(getActiveFoodDate());
    return;
  }

  const btn = e.target.closest("[data-action='remove-food']");
  if (btn) {
    const id = Number(btn.dataset.id);
    if (!Number.isFinite(id)) return;
    await removeFoodEntry(id);
    await renderFoodLog(getActiveFoodDate());
    return;
  }

  const dupBtn = e.target.closest("[data-action='duplicate-food']");
  if (dupBtn) {
    const id = Number(dupBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    const entries = await getFoodEntriesByDate(getActiveFoodDate());
    const entry = entries.find(x => x.id === id);
    if (!entry) return;
    await addFoodEntry({
      ...entry,
      id: undefined,
      addedAt: new Date().toISOString()
    });
    await renderFoodLog(getActiveFoodDate());
    return;
  }

  const favBtn = e.target.closest("[data-action='favorite-food']");
  if (favBtn) {
    const id = Number(favBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    const entries = await getFoodEntriesByDate(getActiveFoodDate());
    const entry = entries.find(x => x.id === id);
    if (!entry) return;

    const qty = Number(entry.quantity) || 0;
    const calories = Number(entry.calories) || 0;
    const protein = Number(entry.protein) || 0;
    const kcalPerUnit = qty ? calories / (entry.basis === "100g" ? (qty / 100) : qty) : 0;
    const proteinPerUnit = qty ? protein / (entry.basis === "100g" ? (qty / 100) : qty) : 0;

    await addFavorite({
      name: entry.name || "Unknown item",
      brand: entry.brand || "",
      basis: entry.basis || "100g",
      serving: entry.serving || "",
      kcalPerUnit,
      proteinPerUnit,
      defaultQty: qty,
      addedAt: new Date().toISOString()
    });
    await renderFavorites();
  }
});

document.getElementById("favorite-list").addEventListener("click", async (e) => {
  const addBtn = e.target.closest("[data-action='add-favorite']");
  if (addBtn) {
    const id = Number(addBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    const row = addBtn.closest(".food-log-item");
    const qtyInput = row?.querySelector(".favorite-qty");
    const qty = Number(qtyInput?.value) || 0;
    if (qty <= 0) return;

    const favorites = await getFavorites();
    const fav = favorites.find(x => x.id === id);
    if (!fav) return;

    const calories = amountFromBasis(Number(fav.kcalPerUnit), fav.basis, qty);
    const protein = amountFromBasis(Number(fav.proteinPerUnit), fav.basis, qty);
    const date = getActiveFoodDate();
    await addFoodEntry({
      date,
      name: fav.name || "Unknown item",
      brand: fav.brand || "",
      basis: fav.basis || "100g",
      serving: fav.serving || "",
      quantity: qty,
      calories,
      protein,
      addedAt: new Date().toISOString()
    });
    await renderFoodLog(date);
    await renderLoggedFoodSearch();
    return;
  }

  const saveBtn = e.target.closest("[data-action='save-favorite']");
  if (saveBtn) {
    const id = Number(saveBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    const row = saveBtn.closest(".food-log-item");
    const qtyInput = row?.querySelector(".favorite-qty");
    const qty = Number(qtyInput?.value) || 0;
    if (qty <= 0) return;
    await updateFavorite(id, { defaultQty: qty });
    await renderFavorites();
    return;
  }

  const removeBtn = e.target.closest("[data-action='remove-favorite']");
  if (removeBtn) {
    const id = Number(removeBtn.dataset.id);
    if (!Number.isFinite(id)) return;
    await removeFavorite(id);
    await renderFavorites();
  }
});

async function handleLoggedFoodAdd(e) {
  const addBtn = e.target.closest("[data-action='add-logged'], [data-action='add-recent'], [data-action='add-frequent']");
  if (addBtn) {
    const row = addBtn.closest(".food-log-item");
    const qtyInput = row?.querySelector(".recent-qty");
    const qty = Number(qtyInput?.value) || 0;
    if (qty <= 0) return;

    const basis = addBtn.dataset.basis || "100g";
    const kcalPerUnit = Number(addBtn.dataset.kcal);
    const proteinPerUnit = Number(addBtn.dataset.protein);
    if (!Number.isFinite(kcalPerUnit) || kcalPerUnit <= 0) return;

    const date = getActiveFoodDate();
    await addFoodEntry({
      date,
      name: decodeValue(addBtn.dataset.name) || "Unknown item",
      brand: decodeValue(addBtn.dataset.brand) || "",
      basis,
      serving: decodeValue(addBtn.dataset.serving) || "",
      quantity: qty,
      calories: amountFromBasis(kcalPerUnit, basis, qty),
      protein: amountFromBasis(proteinPerUnit, basis, qty),
      addedAt: new Date().toISOString()
    });
    await renderFoodLog(date);
    await renderLoggedFoodSearch();
    return;
  }

  const favoriteBtn = e.target.closest("[data-action='favorite-logged'], [data-action='favorite-recent']");
  if (favoriteBtn) {
    const basis = favoriteBtn.dataset.basis || "100g";
    const kcalPerUnit = Number(favoriteBtn.dataset.kcal);
    const proteinPerUnit = Number(favoriteBtn.dataset.protein);
    const defaultQty = Number(favoriteBtn.dataset.qty) || (basis === "100g" ? 100 : 1);
    if (!Number.isFinite(kcalPerUnit) || kcalPerUnit <= 0) return;

    await addFavorite({
      name: decodeValue(favoriteBtn.dataset.name) || "Unknown item",
      brand: decodeValue(favoriteBtn.dataset.brand) || "",
      basis,
      serving: decodeValue(favoriteBtn.dataset.serving) || "",
      kcalPerUnit,
      proteinPerUnit,
      defaultQty,
      addedAt: new Date().toISOString()
    });
    await renderFavorites();
    return;
  }
}

const loggedFoodList = document.getElementById("logged-food-list");
if (loggedFoodList) loggedFoodList.addEventListener("click", handleLoggedFoodAdd);

const customForm = document.getElementById("form-custom-food");
const customFavoriteBtn = document.getElementById("custom-food-favorite");
const customBasis = document.getElementById("custom-food-basis");
const customStatus = document.getElementById("custom-food-status");
if (customBasis) {
  customBasis.addEventListener("change", () => {
    const basis = customBasis.value;
    const qtyInput = document.getElementById("custom-food-qty");
    const servingInput = document.getElementById("custom-food-serving");
    if (qtyInput) {
      const defaults = qtyDefaultsForBasis(basis);
      qtyInput.value = defaults.value;
      qtyInput.step = defaults.step;
    }
    if (servingInput) servingInput.disabled = basis !== "serving";
  });
}

if (customForm) {
  customForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (customStatus) customStatus.textContent = "";
    const data = readCustomFoodForm();
    if (data.error) {
      if (customStatus) customStatus.textContent = data.error;
      return;
    }
    const date = getActiveFoodDate();
    const calories = amountFromBasis(data.kcalPerUnit, data.basis, data.qty);
    const protein = amountFromBasis(data.proteinPerUnit, data.basis, data.qty);
    await addFoodEntry({
      date,
      name: data.name,
      brand: data.brand,
      basis: data.basis,
      serving: data.serving,
      quantity: data.qty,
      calories,
      protein,
      addedAt: new Date().toISOString()
    });
    if (customStatus) customStatus.textContent = `Added to ${date}.`;
    resetCustomFoodForm();
    await renderFoodLog(date);
    await renderLoggedFoodSearch();
  });
}

if (customFavoriteBtn) {
  customFavoriteBtn.addEventListener("click", async () => {
    if (customStatus) customStatus.textContent = "";
    const data = readCustomFoodForm();
    if (data.error) {
      if (customStatus) customStatus.textContent = data.error;
      return;
    }
    await addFavorite({
      name: data.name,
      brand: data.brand,
      basis: data.basis,
      serving: data.serving,
      kcalPerUnit: data.kcalPerUnit,
      proteinPerUnit: data.proteinPerUnit,
      defaultQty: data.qty,
      addedAt: new Date().toISOString()
    });
    if (customStatus) customStatus.textContent = "Saved as favorite.";
    resetCustomFoodForm();
    await renderFavorites();
  });
}

document.getElementById("vitamin-today-list").addEventListener("change", async (e) => {
  const checkbox = e.target.closest("[data-action='vitamin-taken']");
  if (!checkbox) return;
  const id = Number(checkbox.dataset.id);
  if (!Number.isFinite(id)) return;
  const date = isoToday();
  await setVitaminLog({ date, vitaminId: id, taken: checkbox.checked, updatedAt: new Date().toISOString() });
  await refreshDailyCaloriesFromSources(date);
  await renderDashboard();
});

document.getElementById("vitamin-list").addEventListener("click", async (e) => {
  const removeBtn = e.target.closest("[data-action='remove-vitamin']");
  if (!removeBtn) return;
  const id = Number(removeBtn.dataset.id);
  if (!Number.isFinite(id)) return;
  await removeVitaminLogsByVitaminId(id);
  await removeVitamin(id);
  await renderVitamins();
});

document.getElementById("form-workout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = {
    date: document.getElementById("workout-date").value,
    type: document.getElementById("workout-type").value,
    durationMin: Number(document.getElementById("workout-duration").value) || null,
    rpe: Number(document.getElementById("workout-rpe").value),
    hardSets: Number(document.getElementById("workout-hardsets").value) || 0,
    notes: document.getElementById("workout-notes").value || ""
  };
  const id = await addWorkout(session);
  document.getElementById("workout-status").textContent = `Saved workout (ID ${id}). You can now add sets below.`;
  await refreshLatestWorkoutPanel();
  await renderDashboard();
});

document.getElementById("form-set").addEventListener("submit", async (e) => {
  e.preventDefault();
  const w = await getLatestWorkout();
  if (!w) {
    document.getElementById("set-status").textContent = "Save a workout session first.";
    return;
  }
  const setRow = {
    workoutId: w.id,
    date: w.date,
    exercise: document.getElementById("set-exercise").value.trim(),
    weight: Number(document.getElementById("set-weight").value),
    reps: Number(document.getElementById("set-reps").value)
  };
  await addSet(setRow);
  document.getElementById("set-status").textContent = "Set added.";
  document.getElementById("form-set").reset();
  await refreshLatestWorkoutPanel();
  await renderDashboard();
});

document.getElementById("form-run").addEventListener("submit", async (e) => {
  e.preventDefault();
  const run = {
    date: document.getElementById("run-date").value,
    type: document.getElementById("run-type").value,
    durationMin: Number(document.getElementById("run-duration").value),
    distanceMi: Number(document.getElementById("run-distance").value),
    notes: document.getElementById("run-notes").value || ""
  };
  await addRun(run);
  document.getElementById("run-status").textContent =
    `Saved. Pace: ${paceString(run.distanceMi, run.durationMin)}`;
  await renderRunLog();
  await renderDashboard();
});

document.getElementById("form-target").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sex = document.getElementById("target-sex").value;
  const age = Number(document.getElementById("target-age").value);
  const heightIn = Number(document.getElementById("target-height").value);
  const weightLb = Number(document.getElementById("target-weight").value);
  const activity = Number(document.getElementById("target-activity").value);
  const deficit = Number(document.getElementById("target-deficit").value) || 0;
  const status = document.getElementById("target-status");

  if (!age || !heightIn || !weightLb || !activity) {
    status.textContent = "Enter age, height, weight, and activity level.";
    return;
  }

  const weightKg = weightLb * 0.45359237;
  const heightCm = heightIn * 2.54;
  const sexOffset = sex === "male" ? 5 : sex === "female" ? -161 : 0;
  const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + sexOffset;
  const maintenance = bmr * activity;
  const target = Math.max(0, maintenance - deficit);

  setCalorieTarget(target);
  status.textContent = `Estimated maintenance: ${Math.round(maintenance)} cal • Target: ${Math.round(target)} cal`;
  await updateTargetDisplay();
  renderDashboard();
});

document.getElementById("form-bodyfat").addEventListener("submit", (e) => {
  e.preventDefault();
  const current = Number(document.getElementById("bodyfat-current").value);
  const target = Number(document.getElementById("bodyfat-target").value);
  const weightStart = Number(document.getElementById("weight-start").value);
  const weightTarget = Number(document.getElementById("weight-target").value);
  const targetDate = document.getElementById("weight-target-date").value || "";
  const status = document.getElementById("bodyfat-status");

  if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(weightStart) || !Number.isFinite(weightTarget)) {
    status.textContent = "Enter all four values.";
    return;
  }

  setBodyfatTargets(current, target, weightStart, weightTarget);
  setWeightTargetDate(targetDate);
  status.textContent = "Saved.";
  renderDashboard();
});

document.getElementById("form-vitamin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("vitamin-name").value.trim();
  const caloriesRaw = Number(document.getElementById("vitamin-calories").value);
  const status = document.getElementById("vitamin-status");
  if (!name) return;
  if (Number.isFinite(caloriesRaw) && caloriesRaw < 0) {
    status.textContent = "Calories must be 0 or more.";
    return;
  }

  const dayChecks = Array.from(document.querySelectorAll("#form-vitamin input[type='checkbox']"));
  const days = dayChecks.filter(c => c.checked).map(c => Number(c.value));
  if (!days.length) {
    status.textContent = "Select at least one day.";
    return;
  }

  const calories = Number.isFinite(caloriesRaw) ? Math.max(0, Math.round(caloriesRaw)) : 0;
  await addVitamin({ name, days, calories, createdAt: new Date().toISOString() });
  document.getElementById("form-vitamin").reset();
  status.textContent = "Added.";
  await renderVitamins();
});

// Backup
document.getElementById("btn-export").addEventListener("click", async () => {
  const payload = await exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Indigo-backup-${isoToday()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("file-import").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  await importAll(data);
  document.getElementById("backup-status").textContent = "Import complete.";
  await renderDashboard();
});

// Router + init
window.addEventListener("hashchange", async () => {
  show(getRoute());
  const route = getRoute();
  const isTrainingRoute = route === "/log-training" || route === "/log-workout" || route === "/log-run";
  if (route === "/dashboard") {
    await renderDashboard();
    await renderPerformanceReview();
  }
  if (isTrainingRoute) {
    await refreshLatestWorkoutPanel();
    await renderRunLog();
  }
  if (route === "/log-day") {
    ensureLogDayDateIsCurrent();
    await renderFoodLog(getActiveFoodDate());
    await updateTargetDisplay();
    await setWeightInputForDate(getActiveFoodDate());
  }
  if (route === "/food-lookup") {
    renderGenericFoods(document.getElementById("generic-query")?.value || "");
    await renderFavorites();
    await renderLoggedFoodSearch();
  }
  if (route === "/calorie-target") {
    await updateTargetDisplay();
    updateBodyfatForm();
  }
  if (route === "/vitamins") await renderVitamins();
  if (route === "/backup") await renderPerformanceReview();
});

async function init() {
  // Register service worker (needs HTTPS or localhost)
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }
  const setPause = () => {
    document.body.classList.toggle("is-paused", document.visibilityState === "hidden");
  };
  document.addEventListener("visibilitychange", setPause);
  setPause();
  setDefaultDates();
  initNavToggle();
  initProteinTargetControl();
  show(getRoute());
  await renderDashboard();
  await renderFoodLog(getActiveFoodDate());
  await updateTargetDisplay();
  await setWeightInputForDate(getActiveFoodDate());
  updateBodyfatForm();
  renderGenericFoods("");
  await renderFavorites();
  await renderLoggedFoodSearch();
  await renderVitamins();
  await refreshLatestWorkoutPanel();
  await renderRunLog();
  await renderPerformanceReview();
  startOrbBackground();
}

init();
