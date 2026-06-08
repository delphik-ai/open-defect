import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseGithubSourceUrl, taskPathKey } from './lib/artifact-keys.mjs'

const root = process.cwd()
const defectsDir = path.join(root, 'defects')
const candidatesDir = path.join(root, 'candidates')

const candidateStatuses = new Set([
  'confirmed',
  'duplicate_evidence',
  'unverified',
  'out_of_scope',
  'rejected',
])
const countingCandidateStatuses = new Set(['confirmed', 'duplicate_evidence'])
const scopes = new Set(['task_specific', 'benchmark_level', 'out_of_scope'])
const defectScopes = new Set(['task_specific', 'benchmark_level'])
const resolutions = new Set(['found', 'fixing', 'fixed'])
const auditLevels = new Set(['L1', 'L2', 'L3'])
const sourceTypes = new Set(['github_issue', 'github_pr'])
const runIdPattern = /^\d{6}_\d{6}$/
const sourceKeyPattern = /^[a-z0-9._-]+__[a-z0-9._-]+__(issue|pr)-\d+$/
const defectKeyPattern = /^[a-z0-9._-]+__[a-z0-9._-]+__(issue|pr)-\d+(?:__[a-z0-9][a-z0-9-]*)?$/

const errors = []
const ids = new Map()
const defectsById = new Map()

function walk(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return [full]
    })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function rel(file) {
  return path.relative(root, file)
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${rel(file)}: invalid JSON: ${error.message}`)
    return null
  }
}

function requireString(file, obj, field) {
  if (typeof obj[field] !== 'string' || obj[field].trim() === '') {
    errors.push(`${rel(file)}: missing or invalid string field "${field}"`)
  }
}

function requireArray(file, obj, field) {
  if (!Array.isArray(obj[field])) {
    errors.push(`${rel(file)}: missing or invalid array field "${field}"`)
  }
}

function requireUrl(file, obj, field) {
  requireString(file, obj, field)
  if (typeof obj[field] === 'string' && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(obj[field])) {
    errors.push(`${rel(file)}: "${field}" must be a GitHub issue or PR URL`)
  }
}

function requireIsoDate(file, obj, field) {
  requireString(file, obj, field)
  if (typeof obj[field] === 'string' && Number.isNaN(Date.parse(obj[field]))) {
    errors.push(`${rel(file)}: "${field}" must be an ISO date`)
  }
}

function validateDefect(file) {
  const item = readJson(file)
  if (!item) return

  for (const field of [
    'schema_version',
    'id',
    'benchmark_name',
    'scope',
    'resolution',
    'title',
    'summary',
    'canonical_source_url',
    'audit_level',
    'first_reported_at',
    'last_reviewed_at',
    'decision_note',
  ]) {
    requireString(file, item, field)
  }
  requireArray(file, item, 'task_names')
  requireArray(file, item, 'evidence_urls')

  if (item.schema_version !== 'v5.defect-artifact.1') {
    errors.push(`${rel(file)}: schema_version must be v5.defect-artifact.1`)
  }
  if (!defectScopes.has(item.scope)) {
    errors.push(`${rel(file)}: scope must be task_specific or benchmark_level`)
  }
  if (!resolutions.has(item.resolution)) {
    errors.push(`${rel(file)}: resolution must be found, fixing, or fixed`)
  }
  if (!auditLevels.has(item.audit_level)) {
    errors.push(`${rel(file)}: audit_level must be L1, L2, or L3`)
  }

  requireUrl(file, item, 'canonical_source_url')
  requireIsoDate(file, item, 'first_reported_at')
  requireIsoDate(file, item, 'last_reviewed_at')

  if (Array.isArray(item.evidence_urls)) {
    for (const url of item.evidence_urls) {
      if (typeof url !== 'string' || !url.startsWith('https://github.com/')) {
        errors.push(`${rel(file)}: evidence_urls must contain GitHub URLs`)
      }
    }
    if (typeof item.canonical_source_url === 'string' && !item.evidence_urls.includes(item.canonical_source_url)) {
      errors.push(`${rel(file)}: evidence_urls must include canonical_source_url`)
    }
  }

  if (item.scope === 'task_specific' && (!Array.isArray(item.task_names) || item.task_names.length === 0)) {
    errors.push(`${rel(file)}: task_specific defects require non-empty task_names`)
  }
  if (item.scope === 'benchmark_level' && Array.isArray(item.task_names) && item.task_names.length !== 0) {
    errors.push(`${rel(file)}: benchmark_level defects must use empty task_names`)
  }

  const parts = rel(file).split(path.sep)
  const benchmarkFromPath = parts[1]
  const areaFromPath = parts[2]
  const defectFilename = path.basename(file, '.json')
  const parsedCanonical = parseGithubSourceUrl(item.canonical_source_url)

  if (!defectKeyPattern.test(defectFilename)) {
    errors.push(`${rel(file)}: defect filename must be <owner>__<repo>__<issue|pr>-<number>[__<short-root-cause>].json`)
  }
  if (parsedCanonical && defectFilename !== parsedCanonical.key && !defectFilename.startsWith(`${parsedCanonical.key}__`)) {
    errors.push(`${rel(file)}: defect filename must be derived from canonical_source_url`)
  }
  if (item.id && benchmarkFromPath && item.id !== `${benchmarkFromPath}__${defectFilename}`) {
    errors.push(`${rel(file)}: id must be ${benchmarkFromPath}__${defectFilename}`)
  }

  if (benchmarkFromPath && item.benchmark_name && benchmarkFromPath !== item.benchmark_name) {
    errors.push(`${rel(file)}: benchmark_name must match path segment "${benchmarkFromPath}"`)
  }
  if (item.scope === 'benchmark_level' && areaFromPath !== 'common') {
    errors.push(`${rel(file)}: benchmark_level defects must live under defects/<benchmark>/common/`)
  }
  if (item.scope === 'task_specific' && areaFromPath !== 'tasks') {
    errors.push(`${rel(file)}: task_specific defects must live under defects/<benchmark>/tasks/<task_path_key>/`)
  }
  if (item.scope === 'task_specific' && Array.isArray(item.task_names)) {
    const taskDir = parts[3]
    if (item.task_names.length === 1 && taskDir !== taskPathKey(item.task_names[0])) {
      errors.push(`${rel(file)}: single-task defect directory must equal encodeURIComponent(task_names[0])`)
    }
    if (item.task_names.length > 1 && taskDir !== '_multi-task') {
      errors.push(`${rel(file)}: multi-task defects must live under defects/<benchmark>/tasks/_multi-task/`)
    }
  }

  if (item.id) {
    const previous = ids.get(item.id)
    if (previous) errors.push(`${rel(file)}: duplicate id also used by ${previous}`)
    ids.set(item.id, rel(file))
    defectsById.set(item.id, item)
  }
}

function validateCandidate(file) {
  const item = readJson(file)
  if (!item) return

  for (const field of [
    'schema_version',
    'source_url',
    'repo',
    'source_type',
    'title',
    'body',
    'github_state',
    'github_created_at',
    'github_updated_at',
  ]) {
    requireString(file, item, field)
  }
  requireArray(file, item, 'comments')
  requireArray(file, item, 'candidate_benchmark_names')
  if (item.linked_pr_diff !== null && typeof item.linked_pr_diff !== 'string') {
    errors.push(`${rel(file)}: linked_pr_diff must be a string or null`)
  }

  if (item.schema_version !== 'v5.source-candidate.1') {
    errors.push(`${rel(file)}: schema_version must be v5.source-candidate.1`)
  }
  requireUrl(file, item, 'source_url')
  const parts = rel(file).split(path.sep)
  const runId = parts[1]
  const candidateFilename = path.basename(file, '.json')
  const parsedSource = parseGithubSourceUrl(item.source_url)
  if (!runIdPattern.test(runId || '')) {
    errors.push(`${rel(file)}: candidate path must be candidates/<YYMMDD_HHMMSS>/<source_key>.json`)
  }
  if (!sourceKeyPattern.test(candidateFilename)) {
    errors.push(`${rel(file)}: candidate filename must be <owner>__<repo>__<issue|pr>-<number>.json`)
  }
  if (parsedSource && candidateFilename !== parsedSource.key) {
    errors.push(`${rel(file)}: candidate filename must be derived from source_url`)
  }
  if (parsedSource && item.source_type !== parsedSource.sourceType) {
    errors.push(`${rel(file)}: source_type must match source_url`)
  }
  if (parsedSource && item.github_number !== parsedSource.number) {
    errors.push(`${rel(file)}: github_number must match source_url`)
  }
  if (!sourceTypes.has(item.source_type)) {
    errors.push(`${rel(file)}: source_type must be github_issue or github_pr`)
  }
  if (!Number.isInteger(item.github_number)) {
    errors.push(`${rel(file)}: github_number must be an integer`)
  }
  requireIsoDate(file, item, 'github_created_at')
  requireIsoDate(file, item, 'github_updated_at')

  if (item.terminal_status !== undefined) {
    if (!candidateStatuses.has(item.terminal_status)) errors.push(`${rel(file)}: invalid terminal_status "${item.terminal_status}"`)
  } else {
    errors.push(`${rel(file)}: candidate must have terminal_status`)
  }

  for (const field of ['audit_level', 'decision_note', 'reviewed_at']) requireString(file, item, field)
  requireArray(file, item, 'checked_urls')
  if (!auditLevels.has(item.audit_level)) errors.push(`${rel(file)}: audit_level must be L1, L2, or L3`)
  requireIsoDate(file, item, 'reviewed_at')
  if (Array.isArray(item.checked_urls)) {
    for (const url of item.checked_urls) {
      if (typeof url !== 'string' || !url.startsWith('https://')) errors.push(`${rel(file)}: checked_urls must contain URLs`)
    }
  }

  if (countingCandidateStatuses.has(item.terminal_status)) {
    for (const field of ['benchmark_name', 'scope', 'linked_defect_id', 'resolution', 'summary']) requireString(file, item, field)
    requireArray(file, item, 'task_names')
    if (!['task_specific', 'benchmark_level'].includes(item.scope)) {
      errors.push(`${rel(file)}: confirmed/duplicate_evidence candidates require scope task_specific or benchmark_level`)
    }
    if (!resolutions.has(item.resolution)) errors.push(`${rel(file)}: resolution must be found, fixing, or fixed`)
    if (item.linked_defect_id && item.benchmark_name && !item.linked_defect_id.startsWith(`${item.benchmark_name}__`)) {
      errors.push(`${rel(file)}: linked_defect_id must start with benchmark_name__`)
    }
    const linkedDefect = defectsById.get(item.linked_defect_id)
    if (!linkedDefect) {
      errors.push(`${rel(file)}: linked_defect_id does not match a defects artifact id`)
    } else if (item.terminal_status === 'confirmed') {
      if (linkedDefect.canonical_source_url !== item.source_url) {
        errors.push(`${rel(file)}: confirmed candidate must link to a canonical defect with the same canonical_source_url`)
      }
    } else if (!linkedDefect.evidence_urls.includes(item.source_url)) {
      errors.push(`${rel(file)}: duplicate_evidence source_url must be present in linked defect evidence_urls`)
    }
  } else {
    if (item.scope !== undefined && !scopes.has(item.scope)) errors.push(`${rel(file)}: invalid scope "${item.scope}"`)
  }
}

const defectFiles = walk(defectsDir).filter((file) => file.endsWith('.json'))
const candidateFiles = walk(candidatesDir).filter((file) => file.endsWith('.json'))

for (const file of defectFiles) validateDefect(file)
for (const file of candidateFiles) validateCandidate(file)

if (errors.length) {
  console.error(`Artifact validation failed with ${errors.length} error(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Artifact validation passed: ${defectFiles.length} defect file(s), ${candidateFiles.length} candidate file(s).`)
