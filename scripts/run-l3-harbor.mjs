import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

const root = process.cwd()

function argValue(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name)
}

function usage() {
  console.error(`Usage:
  npm run l3:harbor -- --defect=<defect_json> --harbor-root=<harbor_repo> [options]

Options:
  --adapter-path=<path>     Override adapter path.
  --output-dir=<path>       Generated Harbor dataset path. Default: tmp/l3-harbor/<defect_id>
  --jobs-dir=<path>         Harbor jobs output path. Default: tmp/l3-harbor-jobs
  --job-name=<name>         Harbor job name. Default includes defect id and sample mode.
  --org=<org>               Local Harbor task package org. Default: delphik
  --swebench-package=<spec> Package spec passed to uv --with for swebench. Default: swebench>=4.1.0
  --agent=<agent>           Harbor agent. Default: oracle
  --model=<model>           Harbor model. Omit for oracle.
  --env=<env>               Harbor environment. Default: docker
  --n-concurrent=<n>        Harbor concurrent trials. Default: 1
  --timeout-multiplier=<n>  Harbor task timeout multiplier.
  --verifier-timeout-multiplier=<n>
                           Harbor verifier timeout multiplier.
  --sample-size=<n>         Deterministic random sample size. Default: 5
  --seed=<seed>             Sampling seed. Default: defect id
  --all-tasks               Run every task instead of sampling.
  --skip-generate           Use an existing generated task directory.
  --dry-run                 Print commands without running.
  --generate-only           Generate tasks without running Harbor.

Supported benchmark mappings:
  swebench-verified         Uses adapters/swebench/adapter.py
  swebench_multilingual     Uses adapters/swebench_multilingual/run_adapter.py`)
  process.exit(1)
}

const defectPath = argValue('--defect')
const harborRoot = argValue('--harbor-root')
const adapterPathOverride = argValue('--adapter-path')
const outputDirOverride = argValue('--output-dir')
const jobsDir = argValue('--jobs-dir') || 'tmp/l3-harbor-jobs'
const jobNameOverride = argValue('--job-name')
const org = argValue('--org') || 'delphik'
const swebenchPackage = argValue('--swebench-package') || 'swebench>=4.1.0'
const agent = argValue('--agent') || 'oracle'
const model = argValue('--model')
const env = argValue('--env') || 'docker'
const nConcurrent = argValue('--n-concurrent') || '1'
const timeoutMultiplier = argValue('--timeout-multiplier')
const verifierTimeoutMultiplier = argValue('--verifier-timeout-multiplier')
const sampleSize = Number.parseInt(argValue('--sample-size') || '5', 10)
const seedOverride = argValue('--seed')
const allTasks = hasFlag('--all-tasks')
const skipGenerate = hasFlag('--skip-generate')
const dryRun = hasFlag('--dry-run')
const generateOnly = hasFlag('--generate-only')

if (!defectPath || !harborRoot) usage()
if (!Number.isInteger(sampleSize) || sampleSize <= 0) usage()

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`
}

function run(command, args, options = {}) {
  const printable = [command, ...args].map(shellQuote).join(' ')
  console.log(`$ ${printable}`)
  if (dryRun) return
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`)
  }
}

function requireTaskSpecific(defect) {
  if (defect.schema_version !== 'v5.defect-artifact.1') {
    throw new Error('defect must use schema_version v5.defect-artifact.1')
  }
  if (defect.scope !== 'task_specific') {
    throw new Error('L3 Harbor runs require a task_specific defect artifact')
  }
  if (!Array.isArray(defect.task_names) || defect.task_names.length === 0) {
    throw new Error('task_specific defect artifact must contain task_names')
  }
}

function normalizeTaskToml(taskDir, benchmarkName, taskName) {
  const taskToml = path.join(taskDir, 'task.toml')
  const taskYaml = path.join(taskDir, 'task.yaml')
  if (!existsSync(taskToml) && existsSync(taskYaml)) {
    return
  }
  if (!existsSync(taskToml)) {
    throw new Error(`generated task is missing task.toml: ${taskDir}`)
  }
  const content = readFileSync(taskToml, 'utf8')
  if (/^\[task\]\s*$/m.test(content) && /^\s*name\s*=/m.test(content)) return
  const sanitizedTaskName = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const taskBlock = `[task]\nname = "${benchmarkName}/${sanitizedTaskName}"\n\n`
  writeFileSync(taskToml, `${taskBlock}${content}`)
}

function patchHarborTaskTomls(dir, defect) {
  if (!['swebench-verified', 'swebench_multilingual'].includes(defect.benchmark_name)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const taskToml = path.join(dir, entry.name, 'task.toml')
    if (!existsSync(taskToml)) continue
    let content = readFileSync(taskToml, 'utf8')
    if (!/^\[environment\]\s*$/m.test(content)) continue
    if (!/^\s*workdir\s*=/m.test(content)) {
      content = content.replace(/^\[environment\]\s*$/m, '[environment]\nworkdir = "/testbed"')
      writeFileSync(taskToml, content)
    }

    const testSh = path.join(dir, entry.name, 'tests', 'test.sh')
    if (existsSync(testSh)) {
      let testContent = readFileSync(testSh, 'utf8')
      if (!testContent.includes('/root/.local/bin')) {
        testContent = testContent.replace(
          /(#!\/bin\/bash\n)/,
          '$1export PATH="/root/.local/bin:$HOME/.local/bin:$PATH"\n',
        )
        writeFileSync(testSh, testContent)
      }
    }
  }
}

function deterministicSample(values, size, seed) {
  if (size >= values.length) return [...values]
  return [...values]
    .map((value) => ({
      value,
      digest: crypto.createHash('sha256').update(`${seed}\0${value}`).digest('hex'),
    }))
    .sort((a, b) => a.digest.localeCompare(b.digest) || a.value.localeCompare(b.value))
    .slice(0, size)
    .map((item) => item.value)
    .sort()
}

function adapterConfig(defect) {
  if (defect.benchmark_name === 'swebench-verified') {
    const adapterPath = adapterPathOverride || path.join(harborRoot, 'adapters', 'swebench')
    return {
      adapterPath,
      generateTask(taskName, outputDir) {
        run(
          'uv',
          [
            'run',
            '--with',
            swebenchPackage,
            '--with',
            'datasets>=4.0.0',
            'python',
            '-c',
            [
              'import pathlib, sys',
              'from adapter import SWEBenchAdapter',
              'task_name = sys.argv[1]',
              'output_dir = pathlib.Path(sys.argv[2])',
              'adapter = SWEBenchAdapter(task_dir=output_dir)',
              'adapter.generate_task(task_name, task_name)',
            ].join('; '),
            taskName,
            outputDir,
          ],
          { cwd: adapterPath },
        )
        if (!dryRun) normalizeTaskToml(path.join(outputDir, taskName), 'swebench-verified', taskName)
      },
    }
  }

  if (defect.benchmark_name === 'swebench_multilingual') {
    const adapterPath = adapterPathOverride || path.join(harborRoot, 'adapters', 'swebench')
    const generatorPath = path.join(root, 'scripts', 'l3-generate-swebench-multilingual-task.py')
    return {
      adapterPath,
      generateTask(taskName, outputDir) {
        run(
          'uv',
          [
            'run',
            '--with',
            swebenchPackage,
            '--with',
            'datasets>=4.0.0',
            'python',
            generatorPath,
            taskName,
            outputDir,
          ],
          { cwd: adapterPath },
        )
        if (!dryRun) normalizeTaskToml(path.join(outputDir, taskName), 'swebench-multilingual', taskName)
      },
    }
  }

  throw new Error(`No L3 Harbor adapter mapping for benchmark_name=${defect.benchmark_name}`)
}

const defectFullPath = path.resolve(root, defectPath)
const defect = readJson(defectFullPath)
requireTaskSpecific(defect)

const harborRootFullPath = path.resolve(root, harborRoot)
if (!existsSync(harborRootFullPath)) {
  throw new Error(`harbor root does not exist: ${harborRootFullPath}`)
}

const outputDir = path.resolve(root, outputDirOverride || path.join('tmp', 'l3-harbor', defect.id, 'terminal-bench'))
const harborTaskDir = path.resolve(root, path.join(path.dirname(outputDir), 'harbor'))
const jobsDirFullPath = path.resolve(root, jobsDir)
const config = adapterConfig(defect)

if (!existsSync(config.adapterPath)) {
  throw new Error(`adapter path does not exist: ${config.adapterPath}`)
}

mkdirSync(outputDir, { recursive: true })
mkdirSync(jobsDirFullPath, { recursive: true })

const allTaskNames = [...new Set(defect.task_names)].sort()
const seed = seedOverride || defect.id
const taskNames = allTasks ? allTaskNames : deterministicSample(allTaskNames, sampleSize, seed)
console.log(`L3 Harbor run`)
console.log(`defect: ${defect.id}`)
console.log(`benchmark: ${defect.benchmark_name}`)
console.log(`tasks: ${taskNames.length} selected of ${allTaskNames.length}`)
console.log(`sample: ${allTasks ? 'all-tasks' : `sha256(seed + task), seed=${seed}, sample_size=${sampleSize}`}`)
for (const taskName of taskNames) console.log(`- ${taskName}`)
console.log(`dataset: ${outputDir}`)
console.log(`harbor dataset: ${harborTaskDir}`)
console.log(`jobs: ${jobsDirFullPath}`)
console.log('note: default oracle Harbor runs are execution-health checks. L3 confirmation still requires observing the claimed defect behavior.')

const manifest = {
  defect_id: defect.id,
  benchmark_name: defect.benchmark_name,
  sample_method: allTasks ? 'all_tasks' : 'sha256_seeded_sort',
  seed,
  sample_size: allTasks ? allTaskNames.length : sampleSize,
  total_task_count: allTaskNames.length,
  selected_task_count: taskNames.length,
  selected_task_names: taskNames,
}
writeFileSync(path.join(outputDir, 'l3-sample-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

if (!skipGenerate) {
  for (const taskName of taskNames) {
    config.generateTask(taskName, outputDir)
  }
} else {
  for (const taskName of taskNames) {
    const taskDir = path.join(outputDir, taskName)
    if (!existsSync(taskDir)) {
      throw new Error(`--skip-generate requires existing task directory: ${taskDir}`)
    }
  }
}

if (generateOnly) {
  console.log('Generated Harbor tasks only; skipping harbor run because --generate-only was set.')
  process.exit(0)
}

if (!dryRun && existsSync(harborTaskDir)) {
  rmSync(harborTaskDir, { recursive: true, force: true })
}
run('harbor', ['task', 'migrate', '-i', outputDir, '-o', harborTaskDir])
run('harbor', ['task', 'update', harborTaskDir, '--org', org, '--scan', '--overwrite'])
if (!dryRun) patchHarborTaskTomls(harborTaskDir, defect)
run('harbor', ['dataset', 'init', `${org}/l3-${defect.id}`, '--output-dir', harborTaskDir, '--description', `L3 sample for ${defect.id}`])
run('harbor', ['add', '--scan', harborTaskDir, '--to', harborTaskDir])

const runArgs = [
  'run',
  '-p',
  harborTaskDir,
  '-a',
  agent,
  '-e',
  env,
  '-o',
  jobsDirFullPath,
  '-n',
  nConcurrent,
  '--job-name',
  jobNameOverride || `l3-${defect.id}-${allTasks ? 'all' : `sample${taskNames.length}`}`,
]
if (model) runArgs.push('-m', model)
if (timeoutMultiplier) runArgs.push('--timeout-multiplier', timeoutMultiplier)
if (verifierTimeoutMultiplier) runArgs.push('--verifier-timeout-multiplier', verifierTimeoutMultiplier)

run('harbor', runArgs)
