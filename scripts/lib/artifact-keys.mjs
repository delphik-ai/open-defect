export function parseGithubSourceUrl(url) {
  const match = String(url || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/)
  if (!match) return null
  const [, owner, repo, kind, number] = match
  const sourceType = kind === 'issues' ? 'github_issue' : 'github_pr'
  const sourceKind = kind === 'issues' ? 'issue' : 'pr'
  return {
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
    sourceKind,
    sourceType,
    number: Number(number),
    key: `${owner.toLowerCase()}__${repo.toLowerCase()}__${sourceKind}-${number}`,
    repoKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
  }
}

export function requireGithubSourceUrl(url) {
  const parsed = parseGithubSourceUrl(url)
  if (!parsed) throw new Error(`Invalid GitHub issue/PR URL: ${url}`)
  return parsed
}

export function normalizeRepo(repo) {
  return String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').toLowerCase()
}

export function taskPathKey(taskName) {
  return encodeURIComponent(taskName)
}

export function defectId(benchmarkName, defectKey) {
  return `${benchmarkName}__${defectKey}`
}

export function defectRelativePath({ benchmarkName, scope, taskNames, defectKey }) {
  if (scope === 'benchmark_level') {
    return `defects/${benchmarkName}/common/${defectKey}.json`
  }
  if (scope === 'task_specific') {
    const taskDir = taskNames.length === 1 ? taskPathKey(taskNames[0]) : '_multi-task'
    return `defects/${benchmarkName}/tasks/${taskDir}/${defectKey}.json`
  }
  throw new Error(`Invalid defect scope: ${scope}`)
}
