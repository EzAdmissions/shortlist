function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLimit(value, fallback = 25) {
  return Math.min(Math.max(Number(value) || fallback, 1), 100);
}

function normalizeSearchInput(input = {}, defaults = {}) {
  const school = normalizeText(input.school ?? defaults.school);
  const firm = normalizeText(input.firm ?? defaults.firm);
  const role = normalizeText(input.role ?? defaults.role);
  const limit = normalizeLimit(input.limit ?? defaults.limit);

  return {
    school,
    firm,
    role: role || undefined,
    limit,
  };
}

module.exports = {
  normalizeSearchInput,
};
