/**
 * Shared list of banned phrases for academic writing.
 * Used by both autocomplete filtering and system prompt templates.
 */

export const BANNED_PHRASES = [
  'encompasses a diverse array',
  'plays a crucial role',
  'a wide range of',
  'various aspects of',
  'it is important to note',
  'it should be noted',
  'in recent years',
  'has gained significant attention',
  'has been widely studied',
  'is of paramount importance',
  'a plethora of',
  'myriad of',
] as const

export type BannedPhrase = (typeof BANNED_PHRASES)[number]
