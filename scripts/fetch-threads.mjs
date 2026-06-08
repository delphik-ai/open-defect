import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeRepo } from './lib/artifact-keys.mjs'

const root = process.cwd()
const apiBase = 'https://api.github.com'

function argValue(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function hasArg(name) {
  return process.argv.slice(2).includes(name)
}

function usage() {
  console.error([
    'Usage:',
    '  npm run fetch:threads -- --run=<YYMMDD_HHMMSS> --state-file=data/github-fetch-state.json',
    '  npm run fetch:threads -- --run=<YYMMDD_HHMMSS> --since=<ISO8601>',
    '  npm run fetch:threads -- --run=<YYMMDD_HHMMSS> --full-backfill',
  ].join('\n'))
  process.exit(1)
}

const runId = argValue('--run')
const sinceArg = argValue('--since')
const stateFile = argValue('--state-file') || 'data/github-fetch-state.json'
const watchMapPath = argValue('--watch-map') || 'config/repo-watch-map.json'
const repoFilter = argValue('--repo')
const fullBackfill = hasArg('--full-backfill')
const skipPrDiff = hasArg('--skip-pr-diff')
const metadataOnly = hasArg('--metadata-only')
const threadLimit = Number(argValue('--limit') || 0)
const maxPages = Number(argValue('--max-pages') || 10)
const token = process.env.GITHUB_TOKEN

if (!runId || !/^\d{6}_\d{6}$/.test(runId)) usage()

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(path.resolve(file), 'utf8'))
  } catch (error) {
    if (fallback !== null && error.code === 'ENOENT') return fallback
    throw error
  }
}

function readWatchMap(file) {
  const json = readJson(file)
  return new Map(Object.entries(json).map(([repo, benchmarks]) => [
    normalizeRepo(repo),
    [...new Set(benchmarks)].sort(),
  ]))
}

function fetchSince() {
  if (fullBackfill) return null
  if (sinceArg) return sinceArg
  const state = readJson(stateFile, {})
  if (state.last_synced_at) return state.last_synced_at
  throw new Error(`Missing fetch cursor. Provide --since=<ISO8601>, --full-backfill, or an existing ${stateFile}.`)
}

async function gh(url, opts = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  }
  const res = await fetch(url.startsWith('http') ? url : `${apiBase}${url}`, { ...opts, headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub ${res.status} ${url}: ${body.slice(0, 500)}`)
  }
  return res
}

async function ghPaginate(url, pages) {
  let next = url
  const out = []
  for (let page = 0; next && page < pages; page += 1) {
    const res = await gh(next)
    out.push(...await res.json())
    const link = res.headers.get('link') || ''
    const match = link.match(/<([^>]+)>;\s*rel="next"/)
    next = match ? match[1] : null
  }
  return out
}

async function fetchDiff(repo, number) {
  if (skipPrDiff) return null
  try {
    return await (await gh(`/repos/${repo}/pulls/${number}`, { headers: { Accept: 'application/vnd.github.v3.diff' } })).text()
  } catch (error) {
    if (!String(error.message || '').includes('GitHub 406')) throw error
    const files = await ghPaginate(`/repos/${repo}/pulls/${number}/files?per_page=100`, 10)
    return [
      'Diff omitted by GitHub because it exceeded the maximum file count.',
      `Changed files fetched via pulls/{pull_number}/files: ${files.length}`,
      '',
      ...files.map((file) => [
        `--- ${file.filename}`,
        `status=${file.status} additions=${file.additions} deletions=${file.deletions} changes=${file.changes}`,
        file.patch ? file.patch.slice(0, 4000) : '(patch omitted by GitHub)',
      ].join('\n')),
    ].join('\n\n')
  }
}

async function buildThread(repo, issue) {
  const sourceType = issue.pull_request ? 'github_pr' : 'github_issue'
  const comments = metadataOnly ? [] : await ghPaginate(`/repos/${repo}/issues/${issue.number}/comments?per_page=100`, 5)
  const linkedPrDiff = sourceType === 'github_pr' && !metadataOnly ? await fetchDiff(repo, issue.number) : null

  return {
    source_url: issue.html_url,
    repo,
    source_type: sourceType,
    github_number: issue.number,
    title: issue.title || '',
    body: issue.body || '',
    comments: comments.map((comment) => ({
      url: comment.html_url,
      user: comment.user?.login || null,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      body: comment.body || '',
    })),
    linked_pr_diff: linkedPrDiff,
    github_state: issue.state || '',
    github_created_at: issue.created_at || null,
    github_updated_at: issue.updated_at || null,
  }
}

const watchMap = readWatchMap(watchMapPath)
const since = fetchSince()
const repos = [...watchMap.keys()]
  .filter((repo) => !repoFilter || repo === normalizeRepo(repoFilter))
  .sort((a, b) => a.localeCompare(b))

const threads = []
let newestUpdatedAt = since
const fetchedAt = new Date().toISOString()

for (const repo of repos) {
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : ''
  const issues = await ghPaginate(`/repos/${repo}/issues?state=all${sinceParam}&sort=updated&direction=asc&per_page=100`, maxPages)
  let repoFetched = 0
  for (const issue of issues) {
    const thread = await buildThread(repo, issue)
    threads.push(thread)
    repoFetched += 1
    if (!newestUpdatedAt || thread.github_updated_at > newestUpdatedAt) newestUpdatedAt = thread.github_updated_at
    if (threadLimit && threads.length >= threadLimit) break
  }
  console.log(`[fetch] ${repo} fetched=${repoFetched}`)
  if (threadLimit && threads.length >= threadLimit) break
}

const outDir = path.join(root, 'data', 'raw', runId)
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'threads.json'), `${JSON.stringify(threads, null, 2)}\n`)
writeFileSync(path.join(outDir, 'next-fetch-state.json'), `${JSON.stringify({ last_synced_at: newestUpdatedAt || fetchedAt }, null, 2)}\n`)

console.log(`Fetched ${threads.length} thread(s) into ${path.relative(root, path.join(outDir, 'threads.json'))}`)
