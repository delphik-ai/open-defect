import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

function ok(result) {
  return result.status === 0
}

const checks = [
  run('harbor', ['--version']),
  run('docker', ['version', '--format', '{{.Server.Version}}']),
  run('git', ['lfs', 'version']),
]

let failed = false
for (const check of checks) {
  if (ok(check)) {
    console.log(`ok: ${check.command}`)
    if (check.stdout) console.log(check.stdout)
  } else {
    failed = true
    console.error(`failed: ${check.command}`)
    if (check.stdout) console.error(check.stdout)
    if (check.stderr) console.error(check.stderr)
  }
}

if (failed) {
  console.error('L3 Harbor preflight failed. Do not start L3 audit until every check passes.')
  process.exit(1)
}

