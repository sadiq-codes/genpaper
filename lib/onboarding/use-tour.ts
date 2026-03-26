'use client'

import { useCallback, useRef } from 'react'
import type { DriveStep } from 'driver.js'

const STORAGE_PREFIX = 'genpaper:tour:'

function isTourCompleted(tourId: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(`${STORAGE_PREFIX}${tourId}`) === 'done'
}

function markTourCompleted(tourId: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(`${STORAGE_PREFIX}${tourId}`, 'done')
}

export function useTour(tourId: string, steps: DriveStep[]) {
  const driverRef = useRef<ReturnType<typeof import('driver.js').driver> | null>(null)

  const startTour = useCallback(async () => {
    if (isTourCompleted(tourId)) return
    if (driverRef.current) return

    const { driver } = await import('driver.js')

    const d = driver({
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      steps,
      onDestroyStarted: () => {
        markTourCompleted(tourId)
        d.destroy()
        driverRef.current = null
      },
    })

    driverRef.current = d

    // Small delay to let the DOM settle after hydration
    requestAnimationFrame(() => {
      d.drive()
    })
  }, [tourId, steps])

  const resetTour = useCallback(() => {
    if (typeof window === 'undefined') return
    localStorage.removeItem(`${STORAGE_PREFIX}${tourId}`)
  }, [tourId])

  return { startTour, resetTour }
}
