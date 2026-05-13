require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { discoveryQueue } = require('./src/queues/discoveryQueue');
const { readRawProfiles, groupRawProfiles } = require('./src/services/profileReader');
const { normalizeSearchInput } = require('./src/services/searchInput');

const app = express();

app.use(cors({
  origin: [
    'https://ezadmissions.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'null',
  ],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const PDL_KEY      = process.env.PDL_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use service key server-side (not anon)
const PORT         = process.env.PORT || 3001;

// Cache TTL: refresh firm data after 7 days
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Supabase helpers ──────────────────────────────────────────────────────────
// Using raw fetch — no extra supabase-js dependency needed server-side
async function supabaseGet(table, column, value) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  const rows = await res.json();
  return rows?.[0] || null;
}

async function supabaseUpsert(table, data) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data)
  });
  return res.ok;
}

// ── PDL fetch (one credit per call) ──────────────────────────────────────────
async function fetchFromPDL(firm, size = 100) {
  const response = await fetch('https://api.peopledatalabs.com/v5/person/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': PDL_KEY
    },
    body: JSON.stringify({
      query: {
        bool: {
          must: [{ term: { 'job_company_name': firm } }]
        }
      },
      size,
      pretty: true
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || 'PDL API error');
  }

  return { profiles: data.data || [], total: data.total || 0 };
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Shortlist backend running' });
});

app.post('/api/test-job', async (req, res) => {
  try {
    const { school, firm, role } = normalizeSearchInput(req.body, {
      school: 'Cornell University',
      firm: 'Goldman Sachs',
      role: 'analyst',
    });

    const job = await Promise.race([
      discoveryQueue.add('test', {
        school,
        firm,
        role,
        createdAt: new Date().toISOString(),
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out while queueing test job')), 10000);
      }),
    ]);

    res.json({
      queued: true,
      jobId: job.id,
    });
  } catch (err) {
    console.error('Test job enqueue error:', err.message);
    res.status(500).json({
      queued: false,
      error: err.message,
    });
  }
});

app.get('/api/discovered-profiles', async (req, res) => {
  const { school, firm, role, limit } = normalizeSearchInput(req.query);

  if (!school || !firm) {
    return res.status(400).json({ error: 'school and firm are required' });
  }

  try {
    const profiles = await readRawProfiles({ school, firm, role, limit });
    const grouped = groupRawProfiles(profiles);

    res.json({
      ...grouped,
    });
  } catch (err) {
    console.error('Discovered profiles read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/search-v2', async (req, res) => {
  const { school, firm, role, limit } = normalizeSearchInput(req.body);
  const refresh = req.body?.refresh === true;

  if (!school || !firm) {
    return res.status(400).json({ error: 'school and firm are required' });
  }

  try {
    const profiles = await readRawProfiles({ school, firm, role, limit });
    const grouped = groupRawProfiles(profiles);
    console.log('[search-v2] cache lookup:', {
      school,
      firm,
      role,
      limit,
      matches: grouped.total,
    });

    if (grouped.total && !refresh) {
      return res.json({
        ...grouped,
        fromCache: true,
      });
    }

    const job = await discoveryQueue.add('discovery', {
      school,
      firm,
      role,
      createdAt: new Date().toISOString(),
    });

    res.json({
      status: 'processing',
      fromCache: false,
      jobId: job.id,
    });
  } catch (err) {
    console.error('Search v2 error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await discoveryQueue.getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }

    const state = await job.getState();
    const returnValue = job.returnvalue || null;

    res.json({
      id: job.id,
      name: job.name,
      state,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason || null,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null,
      result: returnValue,
      count: returnValue?.count ?? returnValue?.saved ?? 0,
    });
  } catch (err) {
    console.error('Job status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Search with cache ─────────────────────────────────────────────────────────
//
// Cache strategy: cache by FIRM only, not by school+firm.
// A single PDL query for "Goldman Sachs" returns profiles with full education
// history for everyone at that firm. We store all of them, then filter by
// school in memory — zero additional PDL credits per school.
//
// School A searches "Goldman" → 1 PDL credit, result cached
// School B searches "Goldman" → 0 credits, filtered from cache
// School C searches "Goldman" → 0 credits, filtered from cache
//
app.post('/api/search', async (req, res) => {
  const { school, firm, role, size = 25 } = req.body;

  if (!school || !firm) {
    return res.status(400).json({ error: 'School and firm are required.' });
  }

  try {
    let profiles  = [];
    let total     = 0;
    let fromCache = false;

    // 1. Check Supabase cache
    const cached = await supabaseGet('firm_cache', 'firm_name', firm);

    if (cached && new Date(cached.refresh_after) > new Date()) {
      // Cache hit — free
      profiles  = cached.profiles;
      total     = cached.total_found;
      fromCache = true;
      console.log(`[cache hit]  ${firm} — ${profiles.length} profiles`);
    } else {
      // Cache miss — costs 1 PDL credit, fetch max 100 for best cache coverage
      console.log(`[cache miss] ${firm} — querying PDL`);
      const pdl = await fetchFromPDL(firm, 100);
      profiles  = pdl.profiles;
      total     = pdl.total;

      // Upsert into Supabase (firm_name is primary key)
      await supabaseUpsert('firm_cache', {
        firm_name:     firm,
        profiles:      profiles,
        total_found:   total,
        cached_at:     new Date().toISOString(),
        refresh_after: new Date(Date.now() + CACHE_TTL_MS).toISOString()
      });
    }

    // 2. Filter by school in memory — no PDL cost
    let filtered = profiles.filter(p =>
      p.education && p.education.some(e =>
        e.school && e.school.name &&
        e.school.name.toLowerCase().includes(school.toLowerCase())
      )
    );

    // 3. Optional role keyword filter
    if (role) {
      const roleLower = role.toLowerCase();
      filtered = filtered.filter(p =>
        p.job_title && p.job_title.toLowerCase().includes(roleLower)
      );
    }

    // 4. Trim to requested size
    const sliced = filtered.slice(0, size);

    res.json({
      data:      sliced,
      total:     filtered.length,
      fromCache: fromCache
    });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cache status — useful for admin dashboard later ───────────────────────────
app.get('/api/cache-status', async (req, res) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/firm_cache?select=firm_name,total_found,cached_at,refresh_after&order=cached_at.desc`;
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const rows = await response.json();
    res.json({ cached_firms: rows.length, firms: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cache invalidation — force a fresh PDL pull for a specific firm ───────────
app.post('/api/cache-invalidate', async (req, res) => {
  const { firm } = req.body;
  if (!firm) return res.status(400).json({ error: 'firm required' });

  try {
    const url = `${SUPABASE_URL}/rest/v1/firm_cache?firm_name=eq.${encodeURIComponent(firm)}`;
    await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    res.json({ deleted: firm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Seed preview — costs exactly 1 PDL credit, returns count only ─────────────
//
// Call this BEFORE running the full seed to know how many credits it will cost.
// Response tells you the total profiles in PDL and estimated credits needed.
// Only proceed with /api/seed-school if you're comfortable with the numbers.
//
app.post('/api/seed-preview', async (req, res) => {
  const { school = 'Cornell University', grad_year_min = 2010 } = req.body;

  try {
    const response = await fetch('https://api.peopledatalabs.com/v5/person/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PDL_KEY
      },
      body: JSON.stringify({
        query: {
          bool: {
            must: [
              { term:  { 'education.school.name': school.toLowerCase() } },
              { range: { 'education.end_date': { gte: `${grad_year_min}-01-01` } } }
            ]
          }
        },
        size: 1,      // fetch only 1 profile — costs 1 credit total
        pretty: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'PDL error' });
    }

    const total          = data.total || 0;
    const pages          = Math.ceil(total / 100);
    const estimatedCost  = pages; // 1 credit per page of 100
    const freeTierLeft   = 500;   // PDL free tier
    const safe           = estimatedCost <= freeTierLeft;

    res.json({
      school,
      grad_year_min,
      total_in_pdl:     total,
      profiles_per_page: 100,
      estimated_pages:   pages,
      estimated_credits: estimatedCost,
      free_tier_limit:   freeTierLeft,
      safe_to_seed:      safe,
      warning: safe
        ? null
        : `This would cost ${estimatedCost} credits, exceeding your free tier of ${freeTierLeft}. Consider raising grad_year_min to reduce results.`
    });

  } catch (err) {
    console.error('Seed preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Top finance firms to seed ─────────────────────────────────────────────────
const TOP_FIRMS = [
  'Goldman Sachs',
  'Morgan Stanley',
  'JPMorgan Chase',
  'Bank of America',
  'Blackstone',
  'KKR',
  'Apollo Global Management',
  'Carlyle Group',
  'Citadel',
  'Two Sigma',
  'D.E. Shaw',
  'Jane Street',
  'McKinsey & Company',
  'Boston Consulting Group',
  'Bain & Company',
  'Evercore',
  'Lazard',
  'Centerview Partners',
  'PJT Partners',
  'Moelis & Company'
];

// ── Seed firms endpoint ───────────────────────────────────────────────────────
//
// Loops through TOP_FIRMS, skips any already cached, fetches from PDL and
// stores in Supabase. Costs 1 credit per firm not already cached.
// Returns a full log so you can see exactly what happened.
//
// POST /api/seed-firms
// Optional body: { "dry_run": true } — shows what would be fetched without
// actually hitting PDL (0 credits used).
//
app.post('/api/seed-firms', async (req, res) => {
  const { dry_run = false } = req.body || {};

  const log     = [];
  let credits   = 0;
  let cached    = 0;
  let errors    = 0;

  for (const firm of TOP_FIRMS) {
    // Check if already cached and fresh
    const existing = await supabaseGet('firm_cache', 'firm_name', firm);
    if (existing && new Date(existing.refresh_after) > new Date()) {
      log.push({ firm, status: 'skipped', reason: 'already cached', profiles: existing.profiles.length });
      cached++;
      continue;
    }

    if (dry_run) {
      log.push({ firm, status: 'would_fetch', reason: 'not cached' });
      credits++;
      continue;
    }

    // Fetch from PDL — costs 1 credit
    try {
      const response = await fetch('https://api.peopledatalabs.com/v5/person/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': PDL_KEY
        },
        body: JSON.stringify({
          query: {
            bool: {
              must: [{ term: { 'job_company_name': firm } }]
            }
          },
          size: 100,
          pretty: true
        })
      });

      const data = await response.json();

      if (!response.ok) {
        log.push({ firm, status: 'error', reason: data?.error?.message || 'PDL error' });
        errors++;
        continue;
      }

      const profiles = data.data || [];
      const total    = data.total || 0;

      // Store in Supabase
      await supabaseUpsert('firm_cache', {
        firm_name:     firm,
        profiles:      profiles,
        total_found:   total,
        cached_at:     new Date().toISOString(),
        refresh_after: new Date(Date.now() + CACHE_TTL_MS).toISOString()
      });

      log.push({ firm, status: 'seeded', profiles: profiles.length, total_in_pdl: total });
      credits++;

      // Small delay between requests to be respectful to PDL rate limits
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      log.push({ firm, status: 'error', reason: err.message });
      errors++;
    }
  }

  res.json({
    summary: {
      total_firms:   TOP_FIRMS.length,
      seeded:        credits,
      already_cached: cached,
      errors,
      credits_used:  dry_run ? 0 : credits,
      dry_run
    },
    log
  });
});

app.listen(PORT, () => {
  console.log(`Shortlist backend running on port ${PORT}`);
});
