/**
 * GitHub API helpers for blog post management
 * 
 * Creates, updates, and deletes MDX files in the repository
 */

const GITHUB_API = 'https://api.github.com'

interface GitHubConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

function getConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'sadiq-codes/genpaper'
  const branch = process.env.GITHUB_BRANCH || 'main'
  
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required')
  }
  
  const [owner, repoName] = repo.split('/')
  
  return {
    token,
    owner,
    repo: repoName,
    branch,
  }
}

/**
 * Get file content from GitHub
 */
export async function getFileFromGitHub(path: string): Promise<{ content: string; sha: string } | null> {
  const config = getConfig()
  
  const response = await fetch(
    `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`,
    {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  )
  
  if (response.status === 404) {
    return null
  }
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub API error: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  const content = Buffer.from(data.content, 'base64').toString('utf-8')
  
  return { content, sha: data.sha }
}

/**
 * Create or update a file in GitHub
 */
export async function commitFileToGitHub(
  path: string,
  content: string,
  message: string,
  existingSha?: string
): Promise<{ commitUrl: string; sha: string }> {
  const config = getConfig()
  
  // Check if file exists to get SHA for update
  let sha = existingSha
  if (!sha) {
    const existing = await getFileFromGitHub(path)
    if (existing) {
      sha = existing.sha
    }
  }
  
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: config.branch,
  }
  
  if (sha) {
    body.sha = sha
  }
  
  const response = await fetch(
    `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    }
  )
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub API error: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  
  return {
    commitUrl: data.commit.html_url,
    sha: data.content.sha,
  }
}

/**
 * Delete a file from GitHub
 */
export async function deleteFileFromGitHub(
  path: string,
  message: string
): Promise<{ commitUrl: string }> {
  const config = getConfig()
  
  // Get current SHA
  const existing = await getFileFromGitHub(path)
  if (!existing) {
    throw new Error(`File not found: ${path}`)
  }
  
  const response = await fetch(
    `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${path}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message,
        sha: existing.sha,
        branch: config.branch,
      }),
    }
  )
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub API error: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  
  return {
    commitUrl: data.commit.html_url,
  }
}

/**
 * List files in a directory
 */
export async function listFilesInGitHub(path: string): Promise<string[]> {
  const config = getConfig()
  
  const response = await fetch(
    `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`,
    {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  )
  
  if (response.status === 404) {
    return []
  }
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub API error: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  
  if (!Array.isArray(data)) {
    return []
  }
  
  return data
    .filter((item: { type: string; name: string }) => item.type === 'file')
    .map((item: { name: string }) => item.name)
}
