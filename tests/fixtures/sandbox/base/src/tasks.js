'use strict';
// Tasks: validation, storage, listing, summaries, and working-day math for due dates.
const { HttpError } = require('./lib/http.js');
const { isDay, addDays, weekday, daysBetween } = require('./lib/dates.js');
const { csvField, truncate } = require('./lib/text.js');

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = { 1: 'high', 2: 'normal', 3: 'low' };
const TITLE_MAX = 200;
const EDITABLE = ['title', 'priority', 'assignee_id', 'due_date'];

// ---------------------------------------------------------------------------------------------
// Validation

function checkTitle(value, problems) {
  if (typeof value !== 'string' || !value.trim()) problems.push('title is required');
  else if (value.trim().length > TITLE_MAX) problems.push(`title must be at most ${TITLE_MAX} characters`);
}

function checkPriority(value, problems) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || !PRIORITIES[value]) problems.push('priority must be 1, 2 or 3');
}

function checkStatus(value, problems) {
  if (value === undefined) return;
  if (!STATUSES.includes(value)) problems.push(`status must be one of ${STATUSES.join(', ')}`);
}

function checkAssignee(db, value, problems) {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value <= 0) {
    problems.push('assignee_id must be a positive integer');
    return;
  }
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(value)) problems.push(`user ${value} does not exist`);
}

function checkDueDate(value, problems) {
  if (value === undefined || value === null) return;
  if (!isDay(value)) problems.push('due_date must be a date like 2026-10-31');
}

function validateNew(db, input) {
  const problems = [];
  checkTitle(input.title, problems);
  checkPriority(input.priority, problems);
  checkStatus(input.status, problems);
  checkAssignee(db, input.assignee_id, problems);
  checkDueDate(input.due_date, problems);
  return problems;
}

function validateChanges(db, changes) {
  const problems = [];
  const unknown = Object.keys(changes).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) problems.push(`cannot change ${unknown.join(', ')}`);
  if ('title' in changes) checkTitle(changes.title, problems);
  if ('priority' in changes) checkPriority(changes.priority, problems);
  if ('assignee_id' in changes) checkAssignee(db, changes.assignee_id, problems);
  if ('due_date' in changes) checkDueDate(changes.due_date, problems);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Storage

function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assignee_id: row.assignee_id,
    due_date: row.due_date,
    created_at: row.created_at,
  };
}

function projectExists(db, projectId) {
  return Boolean(db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId));
}

function getProject(db, projectId) {
  const row = db.prepare('SELECT id, name, owner_id FROM projects WHERE id = ?').get(projectId);
  if (!row) return null;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?').get(projectId);
  return { ...row, task_count: n };
}

function createTask(db, projectId, input, now = new Date()) {
  if (!projectExists(db, projectId)) throw new HttpError(404, `project ${projectId} not found`);
  const problems = validateNew(db, input);
  if (problems.length) throw new HttpError(400, 'invalid task', problems);
  const result = db.prepare(
    'INSERT INTO tasks (project_id, title, status, priority, assignee_id, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    projectId,
    input.title.trim(),
    input.status || 'todo',
    input.priority || 2,
    input.assignee_id ?? null,
    input.due_date ?? null,
    now.toISOString(),
  );
  return getTask(db, Number(result.lastInsertRowid));
}

function getTask(db, id) {
  return toTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function updateTask(db, id, changes) {
  const task = getTask(db, id);
  if (!task) throw new HttpError(404, `task ${id} not found`);
  const problems = validateChanges(db, changes);
  if (problems.length) throw new HttpError(400, 'invalid change', problems);
  const keys = Object.keys(changes);
  if (!keys.length) return task;
  const values = keys.map((k) => (k === 'title' ? changes.title.trim() : changes[k]));
  db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  return getTask(db, id);
}

// Tasks of a project, newest first. filters: { status, assignee, limit, offset }.
function listTasks(db, projectId, filters = {}) {
  const where = ['project_id = ?'];
  const args = [projectId];
  if (filters.status) {
    if (!STATUSES.includes(filters.status)) throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
    where.push('status = ?');
    args.push(filters.status);
  }
  if (filters.assignee !== undefined) {
    where.push('assignee_id = ?');
    args.push(filters.assignee);
  }
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...args, limit, offset);
  return rows.map(toTask);
}

// Open tasks due within `days` days from today (today included), soonest first.
function dueSoon(db, projectId, today, days) {
  const rows = db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ? ORDER BY due_date, id",
  ).all(projectId, today, addDays(today, days));
  return rows.map(toTask);
}

// ---------------------------------------------------------------------------------------------
// Summaries

function priorityName(priority) {
  return PRIORITIES[priority] || 'unknown';
}

// Open tasks per assignee: [{ assignee_id, open }], unassigned last.
function assigneeLoad(db, projectId) {
  const rows = db.prepare(
    "SELECT assignee_id, COUNT(*) AS open FROM tasks WHERE project_id = ? AND status != 'done' GROUP BY assignee_id",
  ).all(projectId);
  return rows.sort((a, b) => (a.assignee_id === null) - (b.assignee_id === null) || b.open - a.open);
}

function priorityBreakdown(tasks) {
  const out = { high: 0, normal: 0, low: 0 };
  for (const t of tasks) out[priorityName(t.priority)] += 1;
  return out;
}

// One line per task for chat notifications.
function describe(task) {
  const due = task.due_date ? `, due ${task.due_date}` : '';
  return `#${task.id} ${truncate(task.title, 60)} [${task.status}, ${priorityName(task.priority)}${due}]`;
}

const CSV_COLUMNS = ['id', 'title', 'status', 'priority', 'assignee_id', 'due_date', 'created_at'];

function toCsv(tasks) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const t of tasks) lines.push(CSV_COLUMNS.map((c) => csvField(c === 'priority' ? priorityName(t.priority) : t[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// Working days

const holidaySets = new Map();

function holidaysOf(country) {
  if (!holidaySets.has(country)) {
    holidaySets.set(country, new Set(HOLIDAYS.filter((h) => h[0] === country).map((h) => h[1])));
  }
  return holidaySets.get(country);
}

function countries() {
  return [...new Set(HOLIDAYS.map((h) => h[0]))].sort();
}

function holidayName(country, day) {
  const h = HOLIDAYS.find((x) => x[0] === country && x[1] === day);
  return h ? h[2] : null;
}

function isWorkday(country, day) {
  const wd = weekday(day);
  return wd !== 0 && wd !== 6 && !holidaysOf(country).has(day);
}

// The day `n` working days after `day` (n >= 0; n = 0 gives the next working day from `day` on).
function addWorkdays(country, day, n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  let current = day;
  while (!isWorkday(country, current)) current = addDays(current, 1);
  for (let left = n; left > 0;) {
    current = addDays(current, 1);
    if (isWorkday(country, current)) left -= 1;
  }
  return current;
}

// Working days from a (excluded) to b (included); negative when b is earlier.
function workdaysBetween(country, a, b) {
  const sign = daysBetween(a, b) < 0 ? -1 : 1;
  const [from, to] = sign > 0 ? [a, b] : [b, a];
  let count = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkday(country, d)) count += 1;
  return sign * count;
}

// Fixed-date public holidays per country (ISO 3166 code). Moving feasts such as Easter are not
// listed, and substitute days for holidays on a weekend are not applied.
const HOLIDAYS = [
  ['CA', '2025-01-01', "New Year's Day"],
  ['CA', '2025-07-01', 'Canada Day'],
  ['CA', '2025-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2025-11-11', 'Remembrance Day'],
  ['CA', '2025-12-25', 'Christmas Day'],
  ['CA', '2025-12-26', 'Boxing Day'],
  ['CA', '2026-01-01', "New Year's Day"],
  ['CA', '2026-07-01', 'Canada Day'],
  ['CA', '2026-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2026-11-11', 'Remembrance Day'],
  ['CA', '2026-12-25', 'Christmas Day'],
  ['CA', '2026-12-26', 'Boxing Day'],
  ['CA', '2027-01-01', "New Year's Day"],
  ['CA', '2027-07-01', 'Canada Day'],
  ['CA', '2027-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2027-11-11', 'Remembrance Day'],
  ['CA', '2027-12-25', 'Christmas Day'],
  ['CA', '2027-12-26', 'Boxing Day'],
  ['CA', '2028-01-01', "New Year's Day"],
  ['CA', '2028-07-01', 'Canada Day'],
  ['CA', '2028-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2028-11-11', 'Remembrance Day'],
  ['CA', '2028-12-25', 'Christmas Day'],
  ['CA', '2028-12-26', 'Boxing Day'],
  ['CA', '2029-01-01', "New Year's Day"],
  ['CA', '2029-07-01', 'Canada Day'],
  ['CA', '2029-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2029-11-11', 'Remembrance Day'],
  ['CA', '2029-12-25', 'Christmas Day'],
  ['CA', '2029-12-26', 'Boxing Day'],
  ['CA', '2030-01-01', "New Year's Day"],
  ['CA', '2030-07-01', 'Canada Day'],
  ['CA', '2030-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2030-11-11', 'Remembrance Day'],
  ['CA', '2030-12-25', 'Christmas Day'],
  ['CA', '2030-12-26', 'Boxing Day'],
  ['CA', '2031-01-01', "New Year's Day"],
  ['CA', '2031-07-01', 'Canada Day'],
  ['CA', '2031-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2031-11-11', 'Remembrance Day'],
  ['CA', '2031-12-25', 'Christmas Day'],
  ['CA', '2031-12-26', 'Boxing Day'],
  ['CA', '2032-01-01', "New Year's Day"],
  ['CA', '2032-07-01', 'Canada Day'],
  ['CA', '2032-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2032-11-11', 'Remembrance Day'],
  ['CA', '2032-12-25', 'Christmas Day'],
  ['CA', '2032-12-26', 'Boxing Day'],
  ['CA', '2033-01-01', "New Year's Day"],
  ['CA', '2033-07-01', 'Canada Day'],
  ['CA', '2033-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2033-11-11', 'Remembrance Day'],
  ['CA', '2033-12-25', 'Christmas Day'],
  ['CA', '2033-12-26', 'Boxing Day'],
  ['CA', '2034-01-01', "New Year's Day"],
  ['CA', '2034-07-01', 'Canada Day'],
  ['CA', '2034-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2034-11-11', 'Remembrance Day'],
  ['CA', '2034-12-25', 'Christmas Day'],
  ['CA', '2034-12-26', 'Boxing Day'],
  ['CA', '2035-01-01', "New Year's Day"],
  ['CA', '2035-07-01', 'Canada Day'],
  ['CA', '2035-09-30', 'National Day for Truth and Reconciliation'],
  ['CA', '2035-11-11', 'Remembrance Day'],
  ['CA', '2035-12-25', 'Christmas Day'],
  ['CA', '2035-12-26', 'Boxing Day'],
  ['DE', '2025-01-01', 'Neujahr'],
  ['DE', '2025-05-01', 'Tag der Arbeit'],
  ['DE', '2025-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2025-12-25', 'Erster Weihnachtstag'],
  ['DE', '2025-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2026-01-01', 'Neujahr'],
  ['DE', '2026-05-01', 'Tag der Arbeit'],
  ['DE', '2026-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2026-12-25', 'Erster Weihnachtstag'],
  ['DE', '2026-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2027-01-01', 'Neujahr'],
  ['DE', '2027-05-01', 'Tag der Arbeit'],
  ['DE', '2027-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2027-12-25', 'Erster Weihnachtstag'],
  ['DE', '2027-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2028-01-01', 'Neujahr'],
  ['DE', '2028-05-01', 'Tag der Arbeit'],
  ['DE', '2028-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2028-12-25', 'Erster Weihnachtstag'],
  ['DE', '2028-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2029-01-01', 'Neujahr'],
  ['DE', '2029-05-01', 'Tag der Arbeit'],
  ['DE', '2029-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2029-12-25', 'Erster Weihnachtstag'],
  ['DE', '2029-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2030-01-01', 'Neujahr'],
  ['DE', '2030-05-01', 'Tag der Arbeit'],
  ['DE', '2030-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2030-12-25', 'Erster Weihnachtstag'],
  ['DE', '2030-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2031-01-01', 'Neujahr'],
  ['DE', '2031-05-01', 'Tag der Arbeit'],
  ['DE', '2031-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2031-12-25', 'Erster Weihnachtstag'],
  ['DE', '2031-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2032-01-01', 'Neujahr'],
  ['DE', '2032-05-01', 'Tag der Arbeit'],
  ['DE', '2032-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2032-12-25', 'Erster Weihnachtstag'],
  ['DE', '2032-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2033-01-01', 'Neujahr'],
  ['DE', '2033-05-01', 'Tag der Arbeit'],
  ['DE', '2033-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2033-12-25', 'Erster Weihnachtstag'],
  ['DE', '2033-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2034-01-01', 'Neujahr'],
  ['DE', '2034-05-01', 'Tag der Arbeit'],
  ['DE', '2034-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2034-12-25', 'Erster Weihnachtstag'],
  ['DE', '2034-12-26', 'Zweiter Weihnachtstag'],
  ['DE', '2035-01-01', 'Neujahr'],
  ['DE', '2035-05-01', 'Tag der Arbeit'],
  ['DE', '2035-10-03', 'Tag der Deutschen Einheit'],
  ['DE', '2035-12-25', 'Erster Weihnachtstag'],
  ['DE', '2035-12-26', 'Zweiter Weihnachtstag'],
  ['ES', '2025-01-01', 'Año Nuevo'],
  ['ES', '2025-01-06', 'Epifanía del Señor'],
  ['ES', '2025-05-01', 'Fiesta del Trabajo'],
  ['ES', '2025-08-15', 'Asunción de la Virgen'],
  ['ES', '2025-10-12', 'Fiesta Nacional de España'],
  ['ES', '2025-11-01', 'Todos los Santos'],
  ['ES', '2025-12-06', 'Día de la Constitución'],
  ['ES', '2025-12-08', 'Inmaculada Concepción'],
  ['ES', '2025-12-25', 'Natividad del Señor'],
  ['ES', '2026-01-01', 'Año Nuevo'],
  ['ES', '2026-01-06', 'Epifanía del Señor'],
  ['ES', '2026-05-01', 'Fiesta del Trabajo'],
  ['ES', '2026-08-15', 'Asunción de la Virgen'],
  ['ES', '2026-10-12', 'Fiesta Nacional de España'],
  ['ES', '2026-11-01', 'Todos los Santos'],
  ['ES', '2026-12-06', 'Día de la Constitución'],
  ['ES', '2026-12-08', 'Inmaculada Concepción'],
  ['ES', '2026-12-25', 'Natividad del Señor'],
  ['ES', '2027-01-01', 'Año Nuevo'],
  ['ES', '2027-01-06', 'Epifanía del Señor'],
  ['ES', '2027-05-01', 'Fiesta del Trabajo'],
  ['ES', '2027-08-15', 'Asunción de la Virgen'],
  ['ES', '2027-10-12', 'Fiesta Nacional de España'],
  ['ES', '2027-11-01', 'Todos los Santos'],
  ['ES', '2027-12-06', 'Día de la Constitución'],
  ['ES', '2027-12-08', 'Inmaculada Concepción'],
  ['ES', '2027-12-25', 'Natividad del Señor'],
  ['ES', '2028-01-01', 'Año Nuevo'],
  ['ES', '2028-01-06', 'Epifanía del Señor'],
  ['ES', '2028-05-01', 'Fiesta del Trabajo'],
  ['ES', '2028-08-15', 'Asunción de la Virgen'],
  ['ES', '2028-10-12', 'Fiesta Nacional de España'],
  ['ES', '2028-11-01', 'Todos los Santos'],
  ['ES', '2028-12-06', 'Día de la Constitución'],
  ['ES', '2028-12-08', 'Inmaculada Concepción'],
  ['ES', '2028-12-25', 'Natividad del Señor'],
  ['ES', '2029-01-01', 'Año Nuevo'],
  ['ES', '2029-01-06', 'Epifanía del Señor'],
  ['ES', '2029-05-01', 'Fiesta del Trabajo'],
  ['ES', '2029-08-15', 'Asunción de la Virgen'],
  ['ES', '2029-10-12', 'Fiesta Nacional de España'],
  ['ES', '2029-11-01', 'Todos los Santos'],
  ['ES', '2029-12-06', 'Día de la Constitución'],
  ['ES', '2029-12-08', 'Inmaculada Concepción'],
  ['ES', '2029-12-25', 'Natividad del Señor'],
  ['ES', '2030-01-01', 'Año Nuevo'],
  ['ES', '2030-01-06', 'Epifanía del Señor'],
  ['ES', '2030-05-01', 'Fiesta del Trabajo'],
  ['ES', '2030-08-15', 'Asunción de la Virgen'],
  ['ES', '2030-10-12', 'Fiesta Nacional de España'],
  ['ES', '2030-11-01', 'Todos los Santos'],
  ['ES', '2030-12-06', 'Día de la Constitución'],
  ['ES', '2030-12-08', 'Inmaculada Concepción'],
  ['ES', '2030-12-25', 'Natividad del Señor'],
  ['ES', '2031-01-01', 'Año Nuevo'],
  ['ES', '2031-01-06', 'Epifanía del Señor'],
  ['ES', '2031-05-01', 'Fiesta del Trabajo'],
  ['ES', '2031-08-15', 'Asunción de la Virgen'],
  ['ES', '2031-10-12', 'Fiesta Nacional de España'],
  ['ES', '2031-11-01', 'Todos los Santos'],
  ['ES', '2031-12-06', 'Día de la Constitución'],
  ['ES', '2031-12-08', 'Inmaculada Concepción'],
  ['ES', '2031-12-25', 'Natividad del Señor'],
  ['ES', '2032-01-01', 'Año Nuevo'],
  ['ES', '2032-01-06', 'Epifanía del Señor'],
  ['ES', '2032-05-01', 'Fiesta del Trabajo'],
  ['ES', '2032-08-15', 'Asunción de la Virgen'],
  ['ES', '2032-10-12', 'Fiesta Nacional de España'],
  ['ES', '2032-11-01', 'Todos los Santos'],
  ['ES', '2032-12-06', 'Día de la Constitución'],
  ['ES', '2032-12-08', 'Inmaculada Concepción'],
  ['ES', '2032-12-25', 'Natividad del Señor'],
  ['ES', '2033-01-01', 'Año Nuevo'],
  ['ES', '2033-01-06', 'Epifanía del Señor'],
  ['ES', '2033-05-01', 'Fiesta del Trabajo'],
  ['ES', '2033-08-15', 'Asunción de la Virgen'],
  ['ES', '2033-10-12', 'Fiesta Nacional de España'],
  ['ES', '2033-11-01', 'Todos los Santos'],
  ['ES', '2033-12-06', 'Día de la Constitución'],
  ['ES', '2033-12-08', 'Inmaculada Concepción'],
  ['ES', '2033-12-25', 'Natividad del Señor'],
  ['ES', '2034-01-01', 'Año Nuevo'],
  ['ES', '2034-01-06', 'Epifanía del Señor'],
  ['ES', '2034-05-01', 'Fiesta del Trabajo'],
  ['ES', '2034-08-15', 'Asunción de la Virgen'],
  ['ES', '2034-10-12', 'Fiesta Nacional de España'],
  ['ES', '2034-11-01', 'Todos los Santos'],
  ['ES', '2034-12-06', 'Día de la Constitución'],
  ['ES', '2034-12-08', 'Inmaculada Concepción'],
  ['ES', '2034-12-25', 'Natividad del Señor'],
  ['ES', '2035-01-01', 'Año Nuevo'],
  ['ES', '2035-01-06', 'Epifanía del Señor'],
  ['ES', '2035-05-01', 'Fiesta del Trabajo'],
  ['ES', '2035-08-15', 'Asunción de la Virgen'],
  ['ES', '2035-10-12', 'Fiesta Nacional de España'],
  ['ES', '2035-11-01', 'Todos los Santos'],
  ['ES', '2035-12-06', 'Día de la Constitución'],
  ['ES', '2035-12-08', 'Inmaculada Concepción'],
  ['ES', '2035-12-25', 'Natividad del Señor'],
  ['FR', '2025-01-01', "Jour de l'an"],
  ['FR', '2025-05-01', 'Fête du Travail'],
  ['FR', '2025-05-08', 'Victoire 1945'],
  ['FR', '2025-07-14', 'Fête nationale'],
  ['FR', '2025-08-15', 'Assomption'],
  ['FR', '2025-11-01', 'Toussaint'],
  ['FR', '2025-11-11', 'Armistice 1918'],
  ['FR', '2025-12-25', 'Noël'],
  ['FR', '2026-01-01', "Jour de l'an"],
  ['FR', '2026-05-01', 'Fête du Travail'],
  ['FR', '2026-05-08', 'Victoire 1945'],
  ['FR', '2026-07-14', 'Fête nationale'],
  ['FR', '2026-08-15', 'Assomption'],
  ['FR', '2026-11-01', 'Toussaint'],
  ['FR', '2026-11-11', 'Armistice 1918'],
  ['FR', '2026-12-25', 'Noël'],
  ['FR', '2027-01-01', "Jour de l'an"],
  ['FR', '2027-05-01', 'Fête du Travail'],
  ['FR', '2027-05-08', 'Victoire 1945'],
  ['FR', '2027-07-14', 'Fête nationale'],
  ['FR', '2027-08-15', 'Assomption'],
  ['FR', '2027-11-01', 'Toussaint'],
  ['FR', '2027-11-11', 'Armistice 1918'],
  ['FR', '2027-12-25', 'Noël'],
  ['FR', '2028-01-01', "Jour de l'an"],
  ['FR', '2028-05-01', 'Fête du Travail'],
  ['FR', '2028-05-08', 'Victoire 1945'],
  ['FR', '2028-07-14', 'Fête nationale'],
  ['FR', '2028-08-15', 'Assomption'],
  ['FR', '2028-11-01', 'Toussaint'],
  ['FR', '2028-11-11', 'Armistice 1918'],
  ['FR', '2028-12-25', 'Noël'],
  ['FR', '2029-01-01', "Jour de l'an"],
  ['FR', '2029-05-01', 'Fête du Travail'],
  ['FR', '2029-05-08', 'Victoire 1945'],
  ['FR', '2029-07-14', 'Fête nationale'],
  ['FR', '2029-08-15', 'Assomption'],
  ['FR', '2029-11-01', 'Toussaint'],
  ['FR', '2029-11-11', 'Armistice 1918'],
  ['FR', '2029-12-25', 'Noël'],
  ['FR', '2030-01-01', "Jour de l'an"],
  ['FR', '2030-05-01', 'Fête du Travail'],
  ['FR', '2030-05-08', 'Victoire 1945'],
  ['FR', '2030-07-14', 'Fête nationale'],
  ['FR', '2030-08-15', 'Assomption'],
  ['FR', '2030-11-01', 'Toussaint'],
  ['FR', '2030-11-11', 'Armistice 1918'],
  ['FR', '2030-12-25', 'Noël'],
  ['FR', '2031-01-01', "Jour de l'an"],
  ['FR', '2031-05-01', 'Fête du Travail'],
  ['FR', '2031-05-08', 'Victoire 1945'],
  ['FR', '2031-07-14', 'Fête nationale'],
  ['FR', '2031-08-15', 'Assomption'],
  ['FR', '2031-11-01', 'Toussaint'],
  ['FR', '2031-11-11', 'Armistice 1918'],
  ['FR', '2031-12-25', 'Noël'],
  ['FR', '2032-01-01', "Jour de l'an"],
  ['FR', '2032-05-01', 'Fête du Travail'],
  ['FR', '2032-05-08', 'Victoire 1945'],
  ['FR', '2032-07-14', 'Fête nationale'],
  ['FR', '2032-08-15', 'Assomption'],
  ['FR', '2032-11-01', 'Toussaint'],
  ['FR', '2032-11-11', 'Armistice 1918'],
  ['FR', '2032-12-25', 'Noël'],
  ['FR', '2033-01-01', "Jour de l'an"],
  ['FR', '2033-05-01', 'Fête du Travail'],
  ['FR', '2033-05-08', 'Victoire 1945'],
  ['FR', '2033-07-14', 'Fête nationale'],
  ['FR', '2033-08-15', 'Assomption'],
  ['FR', '2033-11-01', 'Toussaint'],
  ['FR', '2033-11-11', 'Armistice 1918'],
  ['FR', '2033-12-25', 'Noël'],
  ['FR', '2034-01-01', "Jour de l'an"],
  ['FR', '2034-05-01', 'Fête du Travail'],
  ['FR', '2034-05-08', 'Victoire 1945'],
  ['FR', '2034-07-14', 'Fête nationale'],
  ['FR', '2034-08-15', 'Assomption'],
  ['FR', '2034-11-01', 'Toussaint'],
  ['FR', '2034-11-11', 'Armistice 1918'],
  ['FR', '2034-12-25', 'Noël'],
  ['FR', '2035-01-01', "Jour de l'an"],
  ['FR', '2035-05-01', 'Fête du Travail'],
  ['FR', '2035-05-08', 'Victoire 1945'],
  ['FR', '2035-07-14', 'Fête nationale'],
  ['FR', '2035-08-15', 'Assomption'],
  ['FR', '2035-11-01', 'Toussaint'],
  ['FR', '2035-11-11', 'Armistice 1918'],
  ['FR', '2035-12-25', 'Noël'],
  ['GB', '2025-01-01', "New Year's Day"],
  ['GB', '2025-12-25', 'Christmas Day'],
  ['GB', '2025-12-26', 'Boxing Day'],
  ['GB', '2026-01-01', "New Year's Day"],
  ['GB', '2026-12-25', 'Christmas Day'],
  ['GB', '2026-12-26', 'Boxing Day'],
  ['GB', '2027-01-01', "New Year's Day"],
  ['GB', '2027-12-25', 'Christmas Day'],
  ['GB', '2027-12-26', 'Boxing Day'],
  ['GB', '2028-01-01', "New Year's Day"],
  ['GB', '2028-12-25', 'Christmas Day'],
  ['GB', '2028-12-26', 'Boxing Day'],
  ['GB', '2029-01-01', "New Year's Day"],
  ['GB', '2029-12-25', 'Christmas Day'],
  ['GB', '2029-12-26', 'Boxing Day'],
  ['GB', '2030-01-01', "New Year's Day"],
  ['GB', '2030-12-25', 'Christmas Day'],
  ['GB', '2030-12-26', 'Boxing Day'],
  ['GB', '2031-01-01', "New Year's Day"],
  ['GB', '2031-12-25', 'Christmas Day'],
  ['GB', '2031-12-26', 'Boxing Day'],
  ['GB', '2032-01-01', "New Year's Day"],
  ['GB', '2032-12-25', 'Christmas Day'],
  ['GB', '2032-12-26', 'Boxing Day'],
  ['GB', '2033-01-01', "New Year's Day"],
  ['GB', '2033-12-25', 'Christmas Day'],
  ['GB', '2033-12-26', 'Boxing Day'],
  ['GB', '2034-01-01', "New Year's Day"],
  ['GB', '2034-12-25', 'Christmas Day'],
  ['GB', '2034-12-26', 'Boxing Day'],
  ['GB', '2035-01-01', "New Year's Day"],
  ['GB', '2035-12-25', 'Christmas Day'],
  ['GB', '2035-12-26', 'Boxing Day'],
  ['IT', '2025-01-01', 'Capodanno'],
  ['IT', '2025-01-06', 'Epifania'],
  ['IT', '2025-04-25', 'Festa della Liberazione'],
  ['IT', '2025-05-01', 'Festa del Lavoro'],
  ['IT', '2025-06-02', 'Festa della Repubblica'],
  ['IT', '2025-08-15', 'Ferragosto'],
  ['IT', '2025-11-01', 'Ognissanti'],
  ['IT', '2025-12-08', 'Immacolata Concezione'],
  ['IT', '2025-12-25', 'Natale'],
  ['IT', '2025-12-26', 'Santo Stefano'],
  ['IT', '2026-01-01', 'Capodanno'],
  ['IT', '2026-01-06', 'Epifania'],
  ['IT', '2026-04-25', 'Festa della Liberazione'],
  ['IT', '2026-05-01', 'Festa del Lavoro'],
  ['IT', '2026-06-02', 'Festa della Repubblica'],
  ['IT', '2026-08-15', 'Ferragosto'],
  ['IT', '2026-11-01', 'Ognissanti'],
  ['IT', '2026-12-08', 'Immacolata Concezione'],
  ['IT', '2026-12-25', 'Natale'],
  ['IT', '2026-12-26', 'Santo Stefano'],
  ['IT', '2027-01-01', 'Capodanno'],
  ['IT', '2027-01-06', 'Epifania'],
  ['IT', '2027-04-25', 'Festa della Liberazione'],
  ['IT', '2027-05-01', 'Festa del Lavoro'],
  ['IT', '2027-06-02', 'Festa della Repubblica'],
  ['IT', '2027-08-15', 'Ferragosto'],
  ['IT', '2027-11-01', 'Ognissanti'],
  ['IT', '2027-12-08', 'Immacolata Concezione'],
  ['IT', '2027-12-25', 'Natale'],
  ['IT', '2027-12-26', 'Santo Stefano'],
  ['IT', '2028-01-01', 'Capodanno'],
  ['IT', '2028-01-06', 'Epifania'],
  ['IT', '2028-04-25', 'Festa della Liberazione'],
  ['IT', '2028-05-01', 'Festa del Lavoro'],
  ['IT', '2028-06-02', 'Festa della Repubblica'],
  ['IT', '2028-08-15', 'Ferragosto'],
  ['IT', '2028-11-01', 'Ognissanti'],
  ['IT', '2028-12-08', 'Immacolata Concezione'],
  ['IT', '2028-12-25', 'Natale'],
  ['IT', '2028-12-26', 'Santo Stefano'],
  ['IT', '2029-01-01', 'Capodanno'],
  ['IT', '2029-01-06', 'Epifania'],
  ['IT', '2029-04-25', 'Festa della Liberazione'],
  ['IT', '2029-05-01', 'Festa del Lavoro'],
  ['IT', '2029-06-02', 'Festa della Repubblica'],
  ['IT', '2029-08-15', 'Ferragosto'],
  ['IT', '2029-11-01', 'Ognissanti'],
  ['IT', '2029-12-08', 'Immacolata Concezione'],
  ['IT', '2029-12-25', 'Natale'],
  ['IT', '2029-12-26', 'Santo Stefano'],
  ['IT', '2030-01-01', 'Capodanno'],
  ['IT', '2030-01-06', 'Epifania'],
  ['IT', '2030-04-25', 'Festa della Liberazione'],
  ['IT', '2030-05-01', 'Festa del Lavoro'],
  ['IT', '2030-06-02', 'Festa della Repubblica'],
  ['IT', '2030-08-15', 'Ferragosto'],
  ['IT', '2030-11-01', 'Ognissanti'],
  ['IT', '2030-12-08', 'Immacolata Concezione'],
  ['IT', '2030-12-25', 'Natale'],
  ['IT', '2030-12-26', 'Santo Stefano'],
  ['IT', '2031-01-01', 'Capodanno'],
  ['IT', '2031-01-06', 'Epifania'],
  ['IT', '2031-04-25', 'Festa della Liberazione'],
  ['IT', '2031-05-01', 'Festa del Lavoro'],
  ['IT', '2031-06-02', 'Festa della Repubblica'],
  ['IT', '2031-08-15', 'Ferragosto'],
  ['IT', '2031-11-01', 'Ognissanti'],
  ['IT', '2031-12-08', 'Immacolata Concezione'],
  ['IT', '2031-12-25', 'Natale'],
  ['IT', '2031-12-26', 'Santo Stefano'],
  ['IT', '2032-01-01', 'Capodanno'],
  ['IT', '2032-01-06', 'Epifania'],
  ['IT', '2032-04-25', 'Festa della Liberazione'],
  ['IT', '2032-05-01', 'Festa del Lavoro'],
  ['IT', '2032-06-02', 'Festa della Repubblica'],
  ['IT', '2032-08-15', 'Ferragosto'],
  ['IT', '2032-11-01', 'Ognissanti'],
  ['IT', '2032-12-08', 'Immacolata Concezione'],
  ['IT', '2032-12-25', 'Natale'],
  ['IT', '2032-12-26', 'Santo Stefano'],
  ['IT', '2033-01-01', 'Capodanno'],
  ['IT', '2033-01-06', 'Epifania'],
  ['IT', '2033-04-25', 'Festa della Liberazione'],
  ['IT', '2033-05-01', 'Festa del Lavoro'],
  ['IT', '2033-06-02', 'Festa della Repubblica'],
  ['IT', '2033-08-15', 'Ferragosto'],
  ['IT', '2033-11-01', 'Ognissanti'],
  ['IT', '2033-12-08', 'Immacolata Concezione'],
  ['IT', '2033-12-25', 'Natale'],
  ['IT', '2033-12-26', 'Santo Stefano'],
  ['IT', '2034-01-01', 'Capodanno'],
  ['IT', '2034-01-06', 'Epifania'],
  ['IT', '2034-04-25', 'Festa della Liberazione'],
  ['IT', '2034-05-01', 'Festa del Lavoro'],
  ['IT', '2034-06-02', 'Festa della Repubblica'],
  ['IT', '2034-08-15', 'Ferragosto'],
  ['IT', '2034-11-01', 'Ognissanti'],
  ['IT', '2034-12-08', 'Immacolata Concezione'],
  ['IT', '2034-12-25', 'Natale'],
  ['IT', '2034-12-26', 'Santo Stefano'],
  ['IT', '2035-01-01', 'Capodanno'],
  ['IT', '2035-01-06', 'Epifania'],
  ['IT', '2035-04-25', 'Festa della Liberazione'],
  ['IT', '2035-05-01', 'Festa del Lavoro'],
  ['IT', '2035-06-02', 'Festa della Repubblica'],
  ['IT', '2035-08-15', 'Ferragosto'],
  ['IT', '2035-11-01', 'Ognissanti'],
  ['IT', '2035-12-08', 'Immacolata Concezione'],
  ['IT', '2035-12-25', 'Natale'],
  ['IT', '2035-12-26', 'Santo Stefano'],
  ['PL', '2025-01-01', 'Nowy Rok'],
  ['PL', '2025-01-06', 'Trzech Króli'],
  ['PL', '2025-05-01', 'Święto Pracy'],
  ['PL', '2025-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2025-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2025-11-01', 'Wszystkich Świętych'],
  ['PL', '2025-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2025-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2025-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2025-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2026-01-01', 'Nowy Rok'],
  ['PL', '2026-01-06', 'Trzech Króli'],
  ['PL', '2026-05-01', 'Święto Pracy'],
  ['PL', '2026-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2026-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2026-11-01', 'Wszystkich Świętych'],
  ['PL', '2026-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2026-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2026-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2026-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2027-01-01', 'Nowy Rok'],
  ['PL', '2027-01-06', 'Trzech Króli'],
  ['PL', '2027-05-01', 'Święto Pracy'],
  ['PL', '2027-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2027-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2027-11-01', 'Wszystkich Świętych'],
  ['PL', '2027-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2027-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2027-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2027-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2028-01-01', 'Nowy Rok'],
  ['PL', '2028-01-06', 'Trzech Króli'],
  ['PL', '2028-05-01', 'Święto Pracy'],
  ['PL', '2028-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2028-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2028-11-01', 'Wszystkich Świętych'],
  ['PL', '2028-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2028-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2028-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2028-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2029-01-01', 'Nowy Rok'],
  ['PL', '2029-01-06', 'Trzech Króli'],
  ['PL', '2029-05-01', 'Święto Pracy'],
  ['PL', '2029-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2029-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2029-11-01', 'Wszystkich Świętych'],
  ['PL', '2029-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2029-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2029-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2029-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2030-01-01', 'Nowy Rok'],
  ['PL', '2030-01-06', 'Trzech Króli'],
  ['PL', '2030-05-01', 'Święto Pracy'],
  ['PL', '2030-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2030-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2030-11-01', 'Wszystkich Świętych'],
  ['PL', '2030-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2030-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2030-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2030-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2031-01-01', 'Nowy Rok'],
  ['PL', '2031-01-06', 'Trzech Króli'],
  ['PL', '2031-05-01', 'Święto Pracy'],
  ['PL', '2031-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2031-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2031-11-01', 'Wszystkich Świętych'],
  ['PL', '2031-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2031-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2031-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2031-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2032-01-01', 'Nowy Rok'],
  ['PL', '2032-01-06', 'Trzech Króli'],
  ['PL', '2032-05-01', 'Święto Pracy'],
  ['PL', '2032-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2032-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2032-11-01', 'Wszystkich Świętych'],
  ['PL', '2032-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2032-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2032-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2032-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2033-01-01', 'Nowy Rok'],
  ['PL', '2033-01-06', 'Trzech Króli'],
  ['PL', '2033-05-01', 'Święto Pracy'],
  ['PL', '2033-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2033-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2033-11-01', 'Wszystkich Świętych'],
  ['PL', '2033-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2033-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2033-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2033-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2034-01-01', 'Nowy Rok'],
  ['PL', '2034-01-06', 'Trzech Króli'],
  ['PL', '2034-05-01', 'Święto Pracy'],
  ['PL', '2034-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2034-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2034-11-01', 'Wszystkich Świętych'],
  ['PL', '2034-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2034-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2034-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2034-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['PL', '2035-01-01', 'Nowy Rok'],
  ['PL', '2035-01-06', 'Trzech Króli'],
  ['PL', '2035-05-01', 'Święto Pracy'],
  ['PL', '2035-05-03', 'Święto Konstytucji 3 Maja'],
  ['PL', '2035-08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['PL', '2035-11-01', 'Wszystkich Świętych'],
  ['PL', '2035-11-11', 'Narodowe Święto Niepodległości'],
  ['PL', '2035-12-24', 'Wigilia Bożego Narodzenia'],
  ['PL', '2035-12-25', 'Boże Narodzenie (pierwszy dzień)'],
  ['PL', '2035-12-26', 'Boże Narodzenie (drugi dzień)'],
  ['US', '2025-01-01', "New Year's Day"],
  ['US', '2025-06-19', 'Juneteenth National Independence Day'],
  ['US', '2025-07-04', 'Independence Day'],
  ['US', '2025-11-11', 'Veterans Day'],
  ['US', '2025-12-25', 'Christmas Day'],
  ['US', '2026-01-01', "New Year's Day"],
  ['US', '2026-06-19', 'Juneteenth National Independence Day'],
  ['US', '2026-07-04', 'Independence Day'],
  ['US', '2026-11-11', 'Veterans Day'],
  ['US', '2026-12-25', 'Christmas Day'],
  ['US', '2027-01-01', "New Year's Day"],
  ['US', '2027-06-19', 'Juneteenth National Independence Day'],
  ['US', '2027-07-04', 'Independence Day'],
  ['US', '2027-11-11', 'Veterans Day'],
  ['US', '2027-12-25', 'Christmas Day'],
  ['US', '2028-01-01', "New Year's Day"],
  ['US', '2028-06-19', 'Juneteenth National Independence Day'],
  ['US', '2028-07-04', 'Independence Day'],
  ['US', '2028-11-11', 'Veterans Day'],
  ['US', '2028-12-25', 'Christmas Day'],
  ['US', '2029-01-01', "New Year's Day"],
  ['US', '2029-06-19', 'Juneteenth National Independence Day'],
  ['US', '2029-07-04', 'Independence Day'],
  ['US', '2029-11-11', 'Veterans Day'],
  ['US', '2029-12-25', 'Christmas Day'],
  ['US', '2030-01-01', "New Year's Day"],
  ['US', '2030-06-19', 'Juneteenth National Independence Day'],
  ['US', '2030-07-04', 'Independence Day'],
  ['US', '2030-11-11', 'Veterans Day'],
  ['US', '2030-12-25', 'Christmas Day'],
  ['US', '2031-01-01', "New Year's Day"],
  ['US', '2031-06-19', 'Juneteenth National Independence Day'],
  ['US', '2031-07-04', 'Independence Day'],
  ['US', '2031-11-11', 'Veterans Day'],
  ['US', '2031-12-25', 'Christmas Day'],
  ['US', '2032-01-01', "New Year's Day"],
  ['US', '2032-06-19', 'Juneteenth National Independence Day'],
  ['US', '2032-07-04', 'Independence Day'],
  ['US', '2032-11-11', 'Veterans Day'],
  ['US', '2032-12-25', 'Christmas Day'],
  ['US', '2033-01-01', "New Year's Day"],
  ['US', '2033-06-19', 'Juneteenth National Independence Day'],
  ['US', '2033-07-04', 'Independence Day'],
  ['US', '2033-11-11', 'Veterans Day'],
  ['US', '2033-12-25', 'Christmas Day'],
  ['US', '2034-01-01', "New Year's Day"],
  ['US', '2034-06-19', 'Juneteenth National Independence Day'],
  ['US', '2034-07-04', 'Independence Day'],
  ['US', '2034-11-11', 'Veterans Day'],
  ['US', '2034-12-25', 'Christmas Day'],
  ['US', '2035-01-01', "New Year's Day"],
  ['US', '2035-06-19', 'Juneteenth National Independence Day'],
  ['US', '2035-07-04', 'Independence Day'],
  ['US', '2035-11-11', 'Veterans Day'],
  ['US', '2035-12-25', 'Christmas Day'],
];

module.exports = {
  STATUSES,
  PRIORITIES,
  validateNew,
  validateChanges,
  projectExists,
  getProject,
  createTask,
  getTask,
  updateTask,
  listTasks,
  dueSoon,
  assigneeLoad,
  priorityBreakdown,
  describe,
  toCsv,
  countries,
  holidayName,
  isWorkday,
  addWorkdays,
  workdaysBetween,
};
