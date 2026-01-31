export function fmt(n, digits=0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

export function isoToday() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0,10);
}

export function startOfWeekISO(dateISO) {
  const d = new Date(dateISO + "T12:00:00");
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0,10);
}

export function minutesPerMile(distanceMi, durationMin) {
  if (!distanceMi || !durationMin) return null;
  return durationMin / distanceMi;
}

export function paceString(distanceMi, durationMin) {
  const mpm = minutesPerMile(distanceMi, durationMin);
  if (!mpm) return "—";
  const min = Math.floor(mpm);
  const sec = Math.round((mpm - min) * 60);
  return `${min}:${String(sec).padStart(2,"0")} /mi`;
}

export function runLoad(durationMin, rpe) {
  if (!durationMin || !rpe) return 0;
  return durationMin * rpe;
}

export function tonnageFromSets(sets) {
  return sets.reduce((sum, s) => sum + (Number(s.weight)||0) * (Number(s.reps)||0), 0);
}

export function rollingAvg(values, window=7) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i+1).filter(v => v !== null && v !== undefined);
    const avg = slice.length ? slice.reduce((a,b)=>a+b,0)/slice.length : null;
    out.push(avg);
  }
  return out;
}

export function prettyDate(dateISO) {
  if (!dateISO) return "";
  const d = new Date(dateISO + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dateISO;
  const weekday = d.toLocaleString("en-US", { weekday: "long" });
  const month = d.toLocaleString("en-US", { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  const suffix = (n) => {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    return n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  };
  return `${weekday}, ${month} ${day}${suffix(day)}, ${year}`;
}
