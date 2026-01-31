export const db = new Dexie("Indigo");

db.version(1).stores({
  daily: "date",                 // primary key = YYYY-MM-DD
  workouts: "++id, date, type",   // workout sessions
  sets: "++id, workoutId, date",  // sets associated to a workoutId
  runs: "++id, date, type"        // runs
});

db.version(2).stores({
  daily: "date",
  workouts: "++id, date, type",
  sets: "++id, workoutId, date",
  runs: "++id, date, type",
  foodEntries: "++id, date, name"
});

db.version(3).stores({
  daily: "date",
  workouts: "++id, date, type",
  sets: "++id, workoutId, date",
  runs: "++id, date, type",
  foodEntries: "++id, date, name",
  favorites: "++id, name"
});

db.version(4).stores({
  daily: "date",
  workouts: "++id, date, type",
  sets: "++id, workoutId, date",
  runs: "++id, date, type",
  foodEntries: "++id, date, name",
  favorites: "++id, name",
  vitamins: "++id, name",
  vitaminLogs: "++id, date, vitaminId"
});

db.version(5).stores({
  daily: "date",
  workouts: "++id, date, type",
  sets: "++id, workoutId, date",
  runs: "++id, date, type",
  foodEntries: "++id, date, name",
  favorites: "++id, name",
  vitamins: "++id, name",
  vitaminLogs: "++id, date, vitaminId, [date+vitaminId]"
});

export async function upsertDaily(entry) {
  return db.daily.put(entry);
}

export async function addWorkout(session) {
  return db.workouts.add(session);
}

export async function addSet(setRow) {
  return db.sets.add(setRow);
}

export async function addRun(run) {
  return db.runs.add(run);
}

export async function addFoodEntry(entry) {
  return db.foodEntries.add(entry);
}

export async function removeFoodEntry(id) {
  return db.foodEntries.delete(id);
}

export async function getFoodEntriesByDate(date) {
  return db.foodEntries.where("date").equals(date).toArray();
}

export async function updateFoodEntry(id, changes) {
  return db.foodEntries.update(id, changes);
}

export async function addFavorite(entry) {
  return db.favorites.add(entry);
}

export async function updateFavorite(id, entry) {
  return db.favorites.update(id, entry);
}

export async function removeFavorite(id) {
  return db.favorites.delete(id);
}

export async function getFavorites() {
  return db.favorites.toArray();
}

export async function addVitamin(item) {
  return db.vitamins.add(item);
}

export async function getVitamins() {
  return db.vitamins.toArray();
}

export async function removeVitamin(id) {
  return db.vitamins.delete(id);
}

export async function removeVitaminLogsByVitaminId(vitaminId) {
  return db.vitaminLogs.where("vitaminId").equals(vitaminId).delete();
}

export async function setVitaminLog(entry) {
  const existing = await db.vitaminLogs.where("[date+vitaminId]").equals([entry.date, entry.vitaminId]).first();
  if (existing) {
    return db.vitaminLogs.update(existing.id, entry);
  }
  return db.vitaminLogs.add(entry);
}

export async function getVitaminLogsByDate(date) {
  return db.vitaminLogs.where("date").equals(date).toArray();
}

export async function getLatestWorkout() {
  return db.workouts.orderBy("id").reverse().first();
}

export async function getSetsForWorkout(workoutId) {
  return db.sets.where("workoutId").equals(workoutId).toArray();
}

export async function exportAll() {
  const [daily, workouts, sets, runs, foodEntries, favorites, vitamins, vitaminLogs] = await Promise.all([
    db.daily.toArray(),
    db.workouts.toArray(),
    db.sets.toArray(),
    db.runs.toArray(),
    db.foodEntries.toArray(),
    db.favorites.toArray(),
    db.vitamins.toArray(),
    db.vitaminLogs.toArray()
  ]);
  return { daily, workouts, sets, runs, foodEntries, favorites, vitamins, vitaminLogs, exportedAt: new Date().toISOString() };
}

export async function importAll(data) {
  await db.transaction("rw", db.daily, db.workouts, db.sets, db.runs, db.foodEntries, db.favorites, db.vitamins, db.vitaminLogs, async () => {
    if (Array.isArray(data.daily)) await db.daily.bulkPut(data.daily);
    if (Array.isArray(data.workouts)) await db.workouts.bulkPut(data.workouts);
    if (Array.isArray(data.sets)) await db.sets.bulkPut(data.sets);
    if (Array.isArray(data.runs)) await db.runs.bulkPut(data.runs);
    if (Array.isArray(data.foodEntries)) await db.foodEntries.bulkPut(data.foodEntries);
    if (Array.isArray(data.favorites)) await db.favorites.bulkPut(data.favorites);
    if (Array.isArray(data.vitamins)) await db.vitamins.bulkPut(data.vitamins);
    if (Array.isArray(data.vitaminLogs)) await db.vitaminLogs.bulkPut(data.vitaminLogs);
  });
}
