import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defectId, defectRelativePath, requireGithubSourceUrl } from './lib/artifact-keys.mjs'

const root = process.cwd()

function argValue(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function usage() {
  console.error('Usage: npm run apply:candidates -- --run=<YYMMDD_HHMMSS> [--input=candidates/<run_id>]')
  process.exit(1)
}

const runId = argValue('--run')
const inputPath = argValue('--input') || (runId ? `candidates/${runId}` : null)

if (!runId || !/^\d{6}_\d{6}$/.test(runId)) usage()
if (!inputPath) usage()

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function candidateFiles(dir) {
  const full = path.resolve(dir)
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(full, entry.name))
    .sort()
}

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

function requiredString(candidate, field) {
  if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') {
    throw new Error(`${candidate.source_url || 'candidate'} missing required string field ${field}`)
  }
}

function requiredArray(candidate, field) {
  if (!Array.isArray(candidate[field])) {
    throw new Error(`${candidate.source_url || 'candidate'} missing required array field ${field}`)
  }
}

function defectKeyFor(candidate) {
  const baseKey = requireGithubSourceUrl(candidate.source_url).key
  if (candidate.defect_key_suffix === undefined) return baseKey
  if (typeof candidate.defect_key_suffix !== 'string' || !/^__[a-z0-9][a-z0-9-]*$/.test(candidate.defect_key_suffix)) {
    throw new Error(`${candidate.source_url}: defect_key_suffix must match __<lowercase-kebab-case>`)
  }
  return `${baseKey}${candidate.defect_key_suffix}`
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function githubEvidenceUrls(candidate) {
  return unique([
    candidate.source_url,
    ...(Array.isArray(candidate.checked_urls) ? candidate.checked_urls : []),
  ]).filter((url) => typeof url === 'string' && url.startsWith('https://github.com/'))
}

function validateCountingCandidate(candidate) {
  for (const field of [
    'benchmark_name',
    'scope',
    'linked_defect_id',
    'resolution',
    'summary',
    'audit_level',
    'decision_note',
    'reviewed_at',
  ]) {
    requiredString(candidate, field)
  }
  requiredArray(candidate, 'task_names')
  requiredArray(candidate, 'checked_urls')
  if (!['task_specific', 'benchmark_level'].includes(candidate.scope)) {
    throw new Error(`${candidate.source_url}: scope must be task_specific or benchmark_level`)
  }
  if (candidate.scope === 'task_specific' && candidate.task_names.length === 0) {
    throw new Error(`${candidate.source_url}: task_specific candidate requires task_names`)
  }
  if (candidate.scope === 'benchmark_level' && candidate.task_names.length !== 0) {
    throw new Error(`${candidate.source_url}: benchmark_level candidate requires empty task_names`)
  }
}

function defectsById() {
  const result = new Map()
  for (const file of walk(path.join(root, 'defects')).filter((item) => item.endsWith('.json'))) {
    const defect = readJson(file)
    if (defect.id) result.set(defect.id, { file, defect })
  }
  return result
}

const candidates = candidateFiles(inputPath).map((file) => ({ file, candidate: readJson(file) }))
const existingDefects = defectsById()

let created = 0
let updated = 0
let skipped = 0

for (const { candidate } of candidates) {
  if (!['confirmed', 'duplicate_evidence'].includes(candidate.terminal_status)) {
    skipped += 1
    continue
  }

  validateCountingCandidate(candidate)

  if (candidate.terminal_status === 'confirmed') {
    const defectKey = defectKeyFor(candidate)
    const expectedId = defectId(candidate.benchmark_name, defectKey)
    if (candidate.linked_defect_id !== expectedId) {
      throw new Error(`${candidate.source_url}: linked_defect_id must be ${expectedId}`)
    }

    const relPath = defectRelativePath({
      benchmarkName: candidate.benchmark_name,
      scope: candidate.scope,
      taskNames: candidate.task_names,
      defectKey,
    })
    const outPath = path.join(root, relPath)
    if (existsSync(outPath)) {
      throw new Error(`${relPath}: confirmed candidate would overwrite an existing defect artifact`)
    }

    writeJson(outPath, {
      schema_version: 'v5.defect-artifact.1',
      id: expectedId,
      benchmark_name: candidate.benchmark_name,
      scope: candidate.scope,
      task_names: candidate.task_names,
      resolution: candidate.resolution,
      title: candidate.defect_title || candidate.title,
      summary: candidate.summary,
      ...(candidate.defect_type_main ? { defect_type_main: candidate.defect_type_main } : {}),
      ...(candidate.defect_type_sub ? { defect_type_sub: candidate.defect_type_sub } : {}),
      canonical_source_url: candidate.source_url,
      evidence_urls: githubEvidenceUrls(candidate),
      audit_level: candidate.audit_level,
      first_reported_at: candidate.github_created_at,
      last_reviewed_at: candidate.reviewed_at,
      decision_note: candidate.decision_note,
    })
    existingDefects.set(expectedId, { file: outPath, defect: readJson(outPath) })
    created += 1
    continue
  }

  const linked = existingDefects.get(candidate.linked_defect_id)
  if (!linked) {
    throw new Error(`${candidate.source_url}: linked_defect_id does not match an existing defect artifact`)
  }
  const next = {
    ...linked.defect,
    evidence_urls: unique([...linked.defect.evidence_urls, candidate.source_url]),
    resolution: candidate.resolution,
    last_reviewed_at: candidate.reviewed_at,
  }
  writeJson(linked.file, next)
  existingDefects.set(candidate.linked_defect_id, { file: linked.file, defect: next })
  updated += 1
}

console.log(`Applied ${created} new defect(s), updated ${updated} duplicate evidence artifact(s), skipped ${skipped} non-counting candidate(s).`)
