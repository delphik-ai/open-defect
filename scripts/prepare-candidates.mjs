import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeRepo, requireGithubSourceUrl } from './lib/artifact-keys.mjs'

const root = process.cwd()

function argValue(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function usage() {
  console.error('Usage: npm run prepare:candidates -- --run=<YYMMDD_HHMMSS> --input=<file-or-dir> [--watch-map=config/repo-watch-map.json]')
  process.exit(1)
}

const runId = argValue('--run')
const inputPath = argValue('--input')
const watchMapPath = argValue('--watch-map') || 'config/repo-watch-map.json'

if (!runId || !/^\d{6}_\d{6}$/.test(runId)) usage()
if (!inputPath) usage()

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readWatchMap(file) {
  const json = readJson(path.resolve(file))
  return new Map(Object.entries(json).map(([repo, benchmarks]) => [
    normalizeRepo(repo),
    [...new Set(benchmarks)].sort(),
  ]))
}

function inputFiles(target) {
  const full = path.resolve(target)
  const stat = statSync(full)
  if (stat.isFile()) return [full]
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(full, entry.name))
    .sort()
}

function candidateItemsFromFile(file) {
  const json = readJson(file)
  if (Array.isArray(json)) return json
  if (Array.isArray(json.threads)) return json.threads
  if (Array.isArray(json.items)) return json.items
  return [json]
}

function normalizeCandidate(raw) {
  const sourceUrl = raw.source_url || raw.html_url || raw.url
  const parsed = requireGithubSourceUrl(sourceUrl)
  const sourceType = raw.source_type || raw.kind || parsed.sourceType
  const normalizedSourceType = sourceType === 'pull_request'
    ? 'github_pr'
    : sourceType === 'issue'
      ? 'github_issue'
      : sourceType
  if (normalizedSourceType !== parsed.sourceType) {
    throw new Error(`source_type does not match source_url for ${sourceUrl}`)
  }

  const candidateBenchmarks = watchMap.get(`${parsed.owner}/${parsed.repo}`) || []
  if (!candidateBenchmarks.length) {
    throw new Error(`Repo is missing from ${watchMapPath}: ${parsed.owner}/${parsed.repo}`)
  }

  return {
    schema_version: 'v5.source-candidate.1',
    source_url: sourceUrl,
    repo: `${parsed.owner}/${parsed.repo}`,
    source_type: parsed.sourceType,
    github_number: parsed.number,
    title: raw.title || '',
    body: raw.body || '',
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    linked_pr_diff: raw.linked_pr_diff ?? null,
    github_state: raw.github_state || raw.state || '',
    github_created_at: raw.github_created_at || raw.created_at,
    github_updated_at: raw.github_updated_at || raw.updated_at,
    candidate_benchmark_names: [...new Set(candidateBenchmarks.filter(Boolean))].sort(),
  }
}

const outDir = path.join(root, 'candidates', runId)
mkdirSync(outDir, { recursive: true })
const watchMap = readWatchMap(watchMapPath)

let written = 0
for (const file of inputFiles(inputPath)) {
  for (const item of candidateItemsFromFile(file)) {
    const candidate = normalizeCandidate(item)
    const key = requireGithubSourceUrl(candidate.source_url).key
    const outPath = path.join(outDir, `${key}.json`)
    writeFileSync(outPath, `${JSON.stringify(candidate, null, 2)}\n`)
    written += 1
  }
}

console.log(`Prepared ${written} candidate file(s) in ${path.relative(root, outDir)}`)
