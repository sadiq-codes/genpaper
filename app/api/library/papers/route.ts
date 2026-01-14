import { getUserLibraryPapers } from '@/lib/db/library'
import {
  getAuthenticatedUser,
  unauthorized,
  serverError,
  success,
} from '@/lib/api/helpers'

export async function GET() {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return unauthorized()

    const papers = await getUserLibraryPapers(user.id, {
      sortBy: 'added_at',
      sortOrder: 'desc',
    })

    return success({
      papers,
      count: papers.length,
    })

  } catch (error) {
    console.error('Error in library papers endpoint:', error)
    return serverError()
  }
}
