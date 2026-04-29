const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const HISTORY_KEY_PREFIX = 'ptll:feedback-history:';
const HISTORY_LIMIT = 5;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function keyFor(email) {
  return HISTORY_KEY_PREFIX + email.trim().toLowerCase();
}

/**
 * Stores a feedback entry against a learner's email. Keeps the most recent
 * HISTORY_LIMIT entries so resubmissions can find the matching prior feedback
 * even when a learner has multiple submissions in flight across units.
 */
async function storeFeedback({ email, qual, units, submissionType, filename, feedbackText }) {
  if (!email) return;

  const k = keyFor(email);
  const existing = (await redis.get(k)) || [];

  const entry = {
    qual: qual || null,
    units: units || null,
    submissionType: submissionType || null,
    filename: filename || null,
    feedbackText,
    storedAt: new Date().toISOString(),
  };

  const next = [entry, ...existing].slice(0, HISTORY_LIMIT);
  await redis.set(k, next, { ex: HISTORY_TTL_SECONDS });
}

/**
 * Looks up the most relevant prior feedback for a resubmission.
 * Preference order:
 *   1. Same qual + same units (exact match)
 *   2. Same qual
 *   3. Most recent of any kind
 * Returns the entry or null.
 */
async function lookupPreviousFeedback({ email, qual, units }) {
  if (!email) return null;

  const history = (await redis.get(keyFor(email))) || [];
  if (history.length === 0) return null;

  const unitsKey = (units || []).join(',');

  if (qual && unitsKey) {
    const exact = history.find(
      h => h.qual === qual && (h.units || []).join(',') === unitsKey,
    );
    if (exact) return exact;
  }

  if (qual) {
    const qualMatch = history.find(h => h.qual === qual);
    if (qualMatch) return qualMatch;
  }

  return history[0];
}

module.exports = { storeFeedback, lookupPreviousFeedback };
