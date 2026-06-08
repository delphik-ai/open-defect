import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()

function argValue(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

const defectsDir = argValue('--defects-dir') || 'defects'
const target = argValue('--target') || process.env.OPEN_DEFECT_SYNC_TARGET || null
const envFile = argValue('--env-file') || (target ? `.env.${target}` : null)

function loadEnvFile(file) {
  if (!file || !existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(envFile)

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  const hint = envFile ? ` in environment or ${envFile}` : ' in environment'
  throw new Error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY${hint}`)
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return [full]
  })
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

async function request(method, endpoint, body = null, query = '') {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${endpoint}${query}`
  const response = await fetch(url, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === null ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${method} ${endpoint}${query} failed: ${response.status} ${text}`)
  }
  return text ? JSON.parse(text) : null
}

async function insertRows(endpoint, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await request('POST', endpoint, rows.slice(i, i + 500))
  }
}

const files = walk(path.resolve(defectsDir)).filter((file) => file.endsWith('.json')).sort()
const artifacts = files.map((file) => {
  const artifact = readJson(file)
  const artifactPath = path.relative(root, file)
  return {
    id: artifact.id,
    benchmark_name: artifact.benchmark_name,
    scope: artifact.scope,
    task_names: artifact.task_names,
    resolution: artifact.resolution,
    title: artifact.title,
    summary: artifact.summary,
    defect_type_main: artifact.defect_type_main ?? null,
    defect_type_sub: artifact.defect_type_sub ?? null,
    canonical_source_url: artifact.canonical_source_url,
    evidence_urls: artifact.evidence_urls,
    audit_level: artifact.audit_level,
    first_reported_at: artifact.first_reported_at,
    last_reviewed_at: artifact.last_reviewed_at,
    decision_note: artifact.decision_note,
    artifact_path: artifactPath,
    artifact,
  }
})

const summary = artifacts.reduce((acc, artifact) => {
  acc.by_resolution[artifact.resolution] = (acc.by_resolution[artifact.resolution] || 0) + 1
  acc.by_scope[artifact.scope] = (acc.by_scope[artifact.scope] || 0) + 1
  return acc
}, { by_resolution: {}, by_scope: {}, target })

const [run] = await request('POST', 'open_defect_sync_runs', {
  source_commit: gitCommit(),
  artifact_count: artifacts.length,
  status: 'running',
  summary,
})

try {
  await request('DELETE', 'open_defect_artifact_tasks', null, '?artifact_id=not.is.null')
  await request('DELETE', 'open_defect_artifacts', null, '?id=not.is.null')

  const artifactRows = artifacts.map((artifact) => ({ ...artifact, sync_run_id: run.id }))
  await insertRows('open_defect_artifacts', artifactRows)

  const taskRows = []
  for (const artifact of artifacts) {
    if (artifact.scope !== 'task_specific') continue
    for (const taskName of artifact.task_names) {
      taskRows.push({
        artifact_id: artifact.id,
        benchmark_name: artifact.benchmark_name,
        task_name: taskName,
        resolution: artifact.resolution,
        artifact_path: artifact.artifact_path,
        sync_run_id: run.id,
      })
    }
  }
  await insertRows('open_defect_artifact_tasks', taskRows)

  await request('PATCH', 'open_defect_sync_runs', {
    status: 'completed',
    completed_at: new Date().toISOString(),
  }, `?id=eq.${run.id}`)

  console.log(JSON.stringify({
    sync_run_id: run.id,
    target,
    artifacts: artifactRows.length,
    task_links: taskRows.length,
    summary,
  }, null, 2))
} catch (error) {
  await request('PATCH', 'open_defect_sync_runs', {
    status: 'failed',
    completed_at: new Date().toISOString(),
    summary: { ...summary, error: error.message },
  }, `?id=eq.${run.id}`)
  throw error
}
