function buildQueries({ school, firm, role }) {
  const schoolNames = Array.from(new Set([
    school,
    String(school || '').replace(/\s+University$/i, '').trim(),
    String(school || '').replace(/\s+College$/i, '').trim(),
  ].filter(Boolean)));

  const queries = [];

  for (const schoolName of schoolNames) {
    queries.push(`site:linkedin.com/in "${schoolName}" "${firm}"`);
    queries.push(`site:linkedin.com/in "${firm}" "${schoolName}"`);
    queries.push(`"${schoolName}" "${firm}" LinkedIn`);
    queries.push(`"${schoolName}" alumni "${firm}"`);

    if (role) {
      queries.push(`site:linkedin.com/in "${schoolName}" "${firm}" "${role}"`);
      queries.push(`"${schoolName}" "${firm}" "${role}"`);
    }
  }

  return Array.from(new Set(queries));
}

module.exports = {
  buildQueries,
};
