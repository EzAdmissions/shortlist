function normalizeText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesIgnoreCase(text, value) {
  if (!value) return false;
  return text.toLowerCase().includes(String(value).toLowerCase());
}

function guessName(title) {
  const cleanTitle = normalizeText(title);
  return cleanTitle.split(/\s[-|]\s/)[0] || null;
}

function guessTitle(title) {
  const cleanTitle = normalizeText(title);
  const parts = cleanTitle.split(/\s[-|]\s/).slice(1);
  return cleanRoleTitle(parts.join(' - '));
}

function cleanRoleTitle(value, { firm, school, name } = {}) {
  let title = normalizeText(value);

  if (!title) return null;

  title = title
    .replace(/\s*\|\s*LinkedIn$/i, '')
    .replace(/\s*-\s*LinkedIn$/i, '');

  if (school && new RegExp(`${String(school).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+Student`, 'i').test(title)) {
    return 'Student';
  }

  for (const token of [firm, school, 'LinkedIn']) {
    if (!token) continue;
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title
      .replace(new RegExp(`^${escaped}\\s*-\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*-\\s*${escaped}$`, 'i'), '')
      .replace(new RegExp(`^${escaped}$`, 'i'), '');
  }

  title = title
    .replace(/^student at\s+.+$/i, 'Student')
    .replace(/^analyst at\s+.+$/i, 'Analyst')
    .replace(/^intern at\s+.+$/i, 'Intern')
    .replace(/^associate at\s+.+$/i, 'Associate')
    .replace(/^managing director at\s+.+$/i, 'Managing Director')
    .replace(/^executive director at\s+.+$/i, 'Executive Director')
    .trim();

  for (const token of [firm, school, 'LinkedIn']) {
    if (!token) continue;
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title
      .replace(new RegExp(`^${escaped}\\s*-\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*-\\s*${escaped}$`, 'i'), '')
      .replace(new RegExp(`\\s+${escaped}$`, 'i'), '')
      .replace(new RegExp(`^${escaped}$`, 'i'), '');
  }

  title = title
    .replace(/\s+at\s+.+$/i, '')
    .replace(/\s+at$/i, '')
    .replace(/\s*-\s*$/g, '')
    .replace(/\s+\.\.\.$/, '')
    .trim();

  if (!title || /^cornell university$/i.test(title)) return null;
  if (firm && new RegExp(`^${String(firm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(title)) return null;
  if (school && new RegExp(`^${String(school).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(title)) return null;
  if (name && title.toLowerCase() === normalizeText(name).toLowerCase()) return null;

  return title;
}

function extractRecords(results, { school, firm, role } = {}) {
  const seenUrls = new Set();

  return results
    .filter((result) => result.url && !seenUrls.has(result.url))
    .map((result) => {
      seenUrls.add(result.url);

      const sourceTitle = normalizeText(result.title);
      const sourceSnippet = normalizeText(result.description);
      const searchableText = `${sourceTitle} ${sourceSnippet}`;
      const sourceType = result.url.includes('linkedin.com/in')
        ? 'linkedin_profile'
        : 'search_result';

      let confidenceScore = sourceType === 'linkedin_profile' ? 0.4 : 0.1;
      if (includesIgnoreCase(searchableText, firm)) confidenceScore += 0.2;
      if (includesIgnoreCase(searchableText, school)) confidenceScore += 0.2;
      if (includesIgnoreCase(searchableText, role)) confidenceScore += 0.1;

      const fullNameGuess = sourceType === 'linkedin_profile' ? guessName(sourceTitle) : null;

      return {
        full_name_guess: fullNameGuess,
        title_guess: cleanRoleTitle(guessTitle(sourceTitle), { firm, school, name: fullNameGuess }),
        company_name: firm || null,
        school_name: school || null,
        role_keyword: role || null,
        source_url: result.url,
        source_title: sourceTitle,
        source_snippet: sourceSnippet,
        source_type: sourceType,
        confidence_score: Math.min(Math.round(confidenceScore * 100), 100),
      };
    });
}

module.exports = {
  extractRecords,
  cleanRoleTitle,
};
