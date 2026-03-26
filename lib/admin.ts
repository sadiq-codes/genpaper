const ADMIN_USER_IDS = [
  'e97fda5f-92d7-4087-be83-ca26aea7faaa',
]

export function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId)
}
