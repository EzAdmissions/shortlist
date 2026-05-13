const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { cleanRoleTitle } = require('./resultExtractor');

function escapeLike(value) {
  return String(value || '').replace(/[%*_]/g, (char) => `\\${char}`);
}

async function readRawProfiles({ school, firm, role, limit = 25 }) {
  const maxRows = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const params = new URLSearchParams({
    select: '*',
    company_name: `ilike.*${escapeLike(firm)}*`,
    school_name: `ilike.*${escapeLike(school)}*`,
    order: 'confidence_score.desc,last_seen_at.desc',
    limit: String(maxRows),
  });

  if (role) {
    const escapedRole = escapeLike(role);
    params.set(
      'or',
      `(${
        [
        `role_keyword.ilike.*${escapedRole}*`,
        `title_guess.ilike.*${escapedRole}*`,
        `source_title.ilike.*${escapedRole}*`,
        `source_snippet.ilike.*${escapedRole}*`,
        ].join(',')
      })`
    );
  }

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/raw_profiles?${params}`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Supabase raw_profiles read error: ${response.status} ${JSON.stringify(data)}`);
  }

  return (data || []).map((record) => ({
    ...record,
    title_guess: cleanRoleTitle(record.title_guess || record.source_title, {
      firm: record.company_name,
      school: record.school_name,
      name: record.full_name_guess,
    }),
  }));
}

function groupRawProfiles(records) {
  const profiles = records.filter((record) => {
    if (record.source_type !== 'linkedin_profile') return false;
    if (!record.full_name_guess) return false;
    if (
      record.company_name &&
      record.full_name_guess.toLowerCase() === record.company_name.toLowerCase()
    ) {
      return false;
    }
    return true;
  });
  const evidence = records.filter((record) => !profiles.includes(record));

  return {
    profiles,
    evidence,
    data: records,
    total: records.length,
    profileCount: profiles.length,
    evidenceCount: evidence.length,
  };
}

module.exports = {
  readRawProfiles,
  groupRawProfiles,
};
