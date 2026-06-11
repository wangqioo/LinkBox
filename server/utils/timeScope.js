const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function currentYear(now) {
  return now.getFullYear();
}

function normalizeDateValue(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function chineseNumberToInt(value) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  const map = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (text === '十') return 10;
  if (text.length === 1) return map[text] || NaN;
  if (text.startsWith('十')) return 10 + (map[text.slice(1)] || 0);
  if (text.endsWith('十')) return (map[text[0]] || 0) * 10;
  if (text.includes('十')) {
    const [tens, ones] = text.split('十');
    return (map[tens] || 0) * 10 + (map[ones] || 0);
  }
  return NaN;
}

function validDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseExplicitDate(text, now) {
  const iso = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|号)?/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (validDateParts(year, month, day)) return formatLocalDate(new Date(year, month - 1, day));
  }

  const md = text.match(/(?:^|[^\d])(\d{1,2})月(\d{1,2})(?:日|号)?/);
  if (md) {
    const year = currentYear(now);
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (validDateParts(year, month, day)) return formatLocalDate(new Date(year, month - 1, day));
  }

  return '';
}

export function resolveTimeScope({ question = '', scope = {}, now = new Date() } = {}) {
  const scopedDate = normalizeDateValue(scope.date);
  if (scopedDate) return { dateFrom: scopedDate, dateTo: scopedDate };

  const scopedFrom = normalizeDateValue(scope.dateFrom || scope.from);
  const scopedTo = normalizeDateValue(scope.dateTo || scope.to);
  if (scopedFrom || scopedTo) {
    return {
      dateFrom: scopedFrom || scopedTo,
      dateTo: scopedTo || scopedFrom,
    };
  }

  const text = String(question || '').replace(/\s+/g, '');
  const today = formatLocalDate(now);

  if (/今天|今日|当天/.test(text)) return { dateFrom: today, dateTo: today };
  if (/昨天|昨日/.test(text)) {
    const date = formatLocalDate(addDays(now, -1));
    return { dateFrom: date, dateTo: date };
  }
  if (/前天/.test(text)) {
    const date = formatLocalDate(addDays(now, -2));
    return { dateFrom: date, dateTo: date };
  }

  const recent = text.match(/最近([一二两三四五六七八九十\d]+)天/);
  if (recent) {
    const days = chineseNumberToInt(recent[1]);
    if (Number.isFinite(days) && days >= 1) {
      return {
        dateFrom: formatLocalDate(addDays(now, -(days - 1))),
        dateTo: today,
      };
    }
  }

  if (/上周|上一周/.test(text)) {
    const day = now.getDay() || 7;
    const thisMonday = addDays(now, 1 - day);
    return {
      dateFrom: formatLocalDate(addDays(thisMonday, -7)),
      dateTo: formatLocalDate(addDays(thisMonday, -1)),
    };
  }

  if (/本周|这周|这一周/.test(text)) {
    const day = now.getDay() || 7;
    const monday = addDays(now, 1 - day);
    return {
      dateFrom: formatLocalDate(monday),
      dateTo: today,
    };
  }

  const explicit = parseExplicitDate(text, now);
  if (explicit) return { dateFrom: explicit, dateTo: explicit };

  return {};
}

export function normalizeTimeScope(scope = {}) {
  const date = normalizeDateValue(scope.date);
  const dateFrom = normalizeDateValue(scope.dateFrom);
  const dateTo = normalizeDateValue(scope.dateTo);
  return {
    ...scope,
    date: '',
    dateFrom: dateFrom || date,
    dateTo: dateTo || date,
  };
}

export function addTimeScopeConditions(scope, params, column = 'l.imported_at') {
  const conditions = [];
  const normalized = normalizeTimeScope(scope);
  if (normalized.dateFrom) {
    conditions.push(`substr(${column}, 1, 10) >= ?`);
    params.push(normalized.dateFrom);
  }
  if (normalized.dateTo) {
    conditions.push(`substr(${column}, 1, 10) <= ?`);
    params.push(normalized.dateTo);
  }
  return conditions;
}
