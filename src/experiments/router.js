// A/B test variant router: deterministic, stable assignment of users to variants.
//
// Algorithm: hash(user_id + exp_name) → 32-bit unsigned int → bucket into 0..9999
// → fall into traffic split. Same user always gets the same variant for the
// same experiment (sticky assignment).
//
// No external dependencies; uses Node's built-in crypto.createHash.

import crypto from 'node:crypto'

// Bucket space size — 10000 buckets gives 0.01% granularity in traffic split.
const BUCKET_SPACE = 10000

// Returns a 32-bit unsigned integer hash of (userId, expName) as a bucket [0, BUCKET_SPACE).
function hashToBucket(userId, expName) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('userId must be a non-empty string')
  }
  if (typeof expName !== 'string' || expName.length === 0) {
    throw new Error('expName must be a non-empty string')
  }
  // SHA-256(userId + ':' + expName) → first 4 bytes → unsigned 32-bit int
  const h = crypto.createHash('sha256').update(`${userId}:${expName}`).digest()
  // Read first 4 bytes as big-endian unsigned 32-bit
  const u32 = h.readUInt32BE(0)
  return u32 % BUCKET_SPACE
}

// Pick a variant from trafficSplit based on a bucket.
//
// trafficSplit: { 'control': 0.5, 'treatment': 0.5 } (must sum to 1.0)
//
// Returns the variant name.
//
// Strategy: cumulative ranges. We order keys by name for determinism (so
// the same input always produces the same variant even if key order differs).
export function pickVariant(bucket, trafficSplit) {
  if (!trafficSplit || typeof trafficSplit !== 'object') {
    throw new Error('trafficSplit must be an object')
  }
  const keys = Object.keys(trafficSplit)
  if (keys.length === 0) {
    throw new Error('trafficSplit must have at least one variant')
  }
  // Validate traffic split
  let total = 0
  for (const k of keys) {
    const v = trafficSplit[k]
    if (typeof v !== 'number' || isNaN(v) || v < 0 || v > 1) {
      throw new Error(`trafficSplit[${k}] must be a number in [0, 1]`)
    }
    total += v
  }
  // Allow small float error
  if (Math.abs(total - 1.0) > 1e-6) {
    throw new Error(`trafficSplit must sum to 1.0, got ${total}`)
  }
  // Sort keys for determinism
  const sorted = [...keys].sort()
  let cumulative = 0
  // bucket is in [0, BUCKET_SPACE), threshold is bucket / BUCKET_SPACE
  const threshold = bucket / BUCKET_SPACE
  for (const k of sorted) {
    cumulative += trafficSplit[k]
    if (threshold < cumulative) return k
  }
  // Floating point edge case: return last variant
  return sorted[sorted.length - 1]
}

// Force a specific variant (bypasses hashing). Used for:
//   - QA / debugging
//   - "Always on" experiments where 100% of a cohort is forced
//   - Manual user exclusion override
export function forcedVariant(forced, variants) {
  if (!variants.includes(forced)) {
    throw new Error(`forced variant "${forced}" not in experiment variants: [${variants.join(', ')}]`)
  }
  return forced
}

// Full pipeline: hash → pick variant. Pure function, easy to test.
export function assignVariant({ userId, expName, trafficSplit, forced = null }) {
  if (forced != null) {
    // forced must be a valid variant; pickVariant validates traffic split
    pickVariant(0, trafficSplit) // validates traffic split only
    const variantList = Object.keys(trafficSplit)
    return forcedVariant(forced, variantList)
  }
  const bucket = hashToBucket(userId, expName)
  return pickVariant(bucket, trafficSplit)
}

// Hash a user_id once and remember it. Used in tests for debugging.
export function debugBucket(userId, expName) {
  return hashToBucket(userId, expName)
}

// Constants
export const ROUTER_BUCKET_SPACE = BUCKET_SPACE
