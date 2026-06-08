import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

function argValue(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function usage() {
  console.error('Usage: npm run update:fetch-state -- --run=<YYMMDD_HHMMSS> --state-file=data/github-fetch-state.json')
  process.exit(1)
}

const runId = argValue('--run')
const stateFile = argValue('--state-file') || 'data/github-fetch-state.json'

if (!runId || !/^\d{6}_\d{6}$/.test(runId)) usage()

const from = path.resolve('data', 'raw', runId, 'next-fetch-state.json')
const to = path.resolve(stateFile)

mkdirSync(path.dirname(to), { recursive: true })
copyFileSync(from, to)

console.log(`Updated fetch state: ${path.relative(process.cwd(), to)}`)
