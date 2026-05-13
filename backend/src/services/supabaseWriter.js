const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const RAW_PROFILES_URL = `${process.env.SUPABASE_URL}/rest/v1/raw_profiles`;

function authHeaders(extra = {}) {
  return {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

function isSaveable(record) {
  return record.source_url && (
    record.source_type === 'linkedin_profile' ||
    Number(record.confidence_score) >= 70
  );
}

function mergeIncomingByUrl(records) {
  const byUrl = new Map();

  for (const record of records) {
    const existing = byUrl.get(record.source_url);

    if (!existing) {
      byUrl.set(record.source_url, record);
      continue;
    }

    byUrl.set(record.source_url, {
      ...existing,
      ...record,
      confidence_score: Math.max(
        Number(existing.confidence_score) || 0,
        Number(record.confidence_score) || 0
      ),
      source_title: record.source_title || existing.source_title,
      source_snippet: record.source_snippet || existing.source_snippet,
    });
  }

  return Array.from(byUrl.values());
}

async function getRawProfileBySourceUrl(sourceUrl) {
  const params = new URLSearchParams({
    select: '*',
    source_url: `eq.${sourceUrl}`,
    limit: '1',
  });

  const response = await fetch(`${RAW_PROFILES_URL}?${params}`, {
    headers: authHeaders(),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Supabase raw_profiles lookup error: ${response.status} ${JSON.stringify(data)}`);
  }

  return data?.[0] || null;
}

async function insertRawProfile(record) {
  const response = await fetch(RAW_PROFILES_URL, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }),
    body: JSON.stringify({
      ...record,
      last_seen_at: new Date().toISOString(),
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Supabase raw_profiles insert error: ${response.status} ${JSON.stringify(data)}`);
  }

  return data?.[0] || null;
}

async function updateRawProfile(existing, record) {
  const params = new URLSearchParams({
    source_url: `eq.${record.source_url}`,
  });

  const update = {
    last_seen_at: new Date().toISOString(),
    confidence_score: Math.max(
      Number(existing.confidence_score) || 0,
      Number(record.confidence_score) || 0
    ),
  };

  if (record.source_title) update.source_title = record.source_title;
  if (record.source_snippet) update.source_snippet = record.source_snippet;

  const response = await fetch(`${RAW_PROFILES_URL}?${params}`, {
    method: 'PATCH',
    headers: authHeaders({
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }),
    body: JSON.stringify(update),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Supabase raw_profiles update error: ${response.status} ${JSON.stringify(data)}`);
  }

  return data?.[0] || null;
}

async function saveRawProfiles(records) {
  const attempted = records.length;
  const eligibleRecords = mergeIncomingByUrl(records.filter(isSaveable));
  const savedRecords = [];

  for (const record of eligibleRecords) {
    const existing = await getRawProfileBySourceUrl(record.source_url);
    const saved = existing
      ? await updateRawProfile(existing, record)
      : await insertRawProfile(record);

    if (saved) savedRecords.push(saved);
  }

  return {
    attempted,
    saved: savedRecords.length,
    skipped: attempted - eligibleRecords.length,
    records: savedRecords,
  };
}

module.exports = {
  saveRawProfiles,
};
