import { mkdir, unlink, writeFile } from 'fs/promises'
import path from 'path'

const LOCAL_BLOG_ROOT = 'content/blog/'

function getAbsoluteBlogPath(relativePath: string) {
  if (!relativePath.startsWith(LOCAL_BLOG_ROOT) || relativePath.includes('..')) {
    throw new Error(`Unsupported blog path: ${relativePath}`)
  }

  return path.join(process.cwd(), relativePath)
}

export async function mirrorBlogFileLocally(relativePath: string, content: string) {
  try {
    const absolutePath = getAbsoluteBlogPath(relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  } catch (error) {
    console.warn('[Blog API] Failed to mirror local blog file:', relativePath, error)
  }
}

export async function deleteLocalBlogFile(relativePath: string) {
  try {
    const absolutePath = getAbsoluteBlogPath(relativePath)
    await unlink(absolutePath)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
    if (code !== 'ENOENT') {
      console.warn('[Blog API] Failed to delete local blog file:', relativePath, error)
    }
  }
}
