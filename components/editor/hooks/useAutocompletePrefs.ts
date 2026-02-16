'use client'

import { useState, useCallback, useEffect } from 'react'

const SYNC_EVENT = 'genpaper-autocomplete-prefs-sync'

export interface AutocompletePrefs {
  /** Enable auto-suggestions - default ON */
  autoSuggestions: boolean
  /** Include citations in suggestions - default OFF */
  includeCitations: boolean
  /** Accept key: 'tab' | 'ctrlEnter' - default 'tab' */
  acceptKey: 'tab' | 'ctrlEnter'
  /** Use external sources (global database) for AI writing - default OFF */
  useExternalSources: boolean
}

export const DEFAULT_PREFS: AutocompletePrefs = {
  autoSuggestions: true,
  includeCitations: false,
  acceptKey: 'tab',
  useExternalSources: false,
}

/**
 * Persist prefs to the database via the user preferences API.
 * Fire-and-forget — callers handle optimistic state themselves.
 */
async function persistPrefsToAPI(prefs: Partial<AutocompletePrefs>): Promise<boolean> {
  try {
    const res = await fetch('/api/user/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Hook for managing autocomplete preferences.
 *
 * Source of truth: `user_preferences` table in the database.
 * Initial values come from server-provided props (see editor page).
 * All hook instances on the same page stay in sync via a CustomEvent.
 *
 * @param initialPrefs — values fetched server-side and passed as props
 */
export function useAutocompletePrefs(initialPrefs: AutocompletePrefs = DEFAULT_PREFS) {
  const [prefs, setPrefs] = useState<AutocompletePrefs>(initialPrefs)

  // Keep in sync if parent re-provides initialPrefs (e.g. after revalidation)
  useEffect(() => {
    setPrefs(initialPrefs)
  }, [
    initialPrefs.autoSuggestions,
    initialPrefs.includeCitations,
    initialPrefs.acceptKey,
    initialPrefs.useExternalSources,
  ])

  // Listen for sync events from other hook instances on the same page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AutocompletePrefs>).detail
      if (detail) setPrefs(detail)
    }
    window.addEventListener(SYNC_EVENT, handler)
    return () => window.removeEventListener(SYNC_EVENT, handler)
  }, [])

  /** Broadcast new prefs to other hook instances */
  const broadcast = useCallback((next: AutocompletePrefs) => {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: next }))
  }, [])

  // --- Individual setters (optimistic + persist) ---

  const updatePrefs = useCallback((updates: Partial<AutocompletePrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...updates }
      broadcast(next)
      persistPrefsToAPI(updates)
      return next
    })
  }, [broadcast])

  const setAutoSuggestions = useCallback((value: boolean) => {
    updatePrefs({ autoSuggestions: value })
  }, [updatePrefs])

  const setIncludeCitations = useCallback((value: boolean) => {
    updatePrefs({ includeCitations: value })
  }, [updatePrefs])

  const setAcceptKey = useCallback((value: 'tab' | 'ctrlEnter') => {
    updatePrefs({ acceptKey: value })
  }, [updatePrefs])

  const setUseExternalSources = useCallback((value: boolean) => {
    updatePrefs({ useExternalSources: value })
  }, [updatePrefs])

  return {
    prefs,
    updatePrefs,
    setAutoSuggestions,
    setIncludeCitations,
    setAcceptKey,
    setUseExternalSources,
  }
}
