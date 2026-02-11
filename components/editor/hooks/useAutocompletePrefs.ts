'use client'

import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'genpaper-autocomplete-prefs'

export interface AutocompletePrefs {
  /** Enable auto-suggestions (experimental) - default OFF */
  autoSuggestions: boolean
  /** Include citations in suggestions - default OFF */
  includeCitations: boolean
  /** Accept key: 'tab' or 'ctrlEnter' - default 'tab' */
  acceptKey: 'tab' | 'ctrlEnter'
  /** Use external sources (global database) for AI writing - default OFF */
  useExternalSources: boolean
}

const DEFAULT_PREFS: AutocompletePrefs = {
  autoSuggestions: false,
  includeCitations: false,
  acceptKey: 'tab',
  useExternalSources: false,
}

/**
 * Hook for managing autocomplete preferences in localStorage
 * 
 * Preferences:
 * - autoSuggestions: Enable automatic AI suggestions as you type
 * - includeCitations: Include citations in AI suggestions
 * - acceptKey: Keybinding to accept suggestions (Tab or Ctrl+Enter)
 */
export function useAutocompletePrefs() {
  const [prefs, setPrefs] = useState<AutocompletePrefs>(DEFAULT_PREFS)
  const [isLoaded, setIsLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setPrefs({
          ...DEFAULT_PREFS,
          ...parsed,
        })
      }
    } catch (error) {
      console.error('Failed to load autocomplete prefs:', error)
    }
    setIsLoaded(true)
  }, [])

  // Save to localStorage when prefs change
  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined') return
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch (error) {
      console.error('Failed to save autocomplete prefs:', error)
    }
  }, [prefs, isLoaded])

  const updatePrefs = useCallback((updates: Partial<AutocompletePrefs>) => {
    setPrefs(prev => ({ ...prev, ...updates }))
  }, [])

  const setAutoSuggestions = useCallback((value: boolean) => {
    setPrefs(prev => ({ ...prev, autoSuggestions: value }))
  }, [])

  const setIncludeCitations = useCallback((value: boolean) => {
    setPrefs(prev => ({ ...prev, includeCitations: value }))
  }, [])

  const setAcceptKey = useCallback((value: 'tab' | 'ctrlEnter') => {
    setPrefs(prev => ({ ...prev, acceptKey: value }))
  }, [])

  const setUseExternalSources = useCallback((value: boolean) => {
    setPrefs(prev => ({ ...prev, useExternalSources: value }))
  }, [])

  return {
    prefs,
    isLoaded,
    updatePrefs,
    setAutoSuggestions,
    setIncludeCitations,
    setAcceptKey,
    setUseExternalSources,
  }
}
