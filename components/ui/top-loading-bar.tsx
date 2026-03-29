'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

const INITIAL_PROGRESS = 12
const MIN_VISIBLE_PROGRESS = 18
const MAX_PROGRESS_BEFORE_COMPLETE = 92
const COMPLETE_PROGRESS = 100
const TRICKLE_INTERVAL_MS = 160
const HIDE_DELAY_MS = 220
const STALE_NAVIGATION_TIMEOUT_MS = 12000

function getHrefFromTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('a[href]')
}

export function TopLoadingBar() {
  const pathname = usePathname()

  const [isVisible, setIsVisible] = useState(false)
  const [progress, setProgress] = useState(0)

  const activeRef = useRef(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trickleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isFirstRenderRef = useRef(true)

  const clearTimers = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    if (staleTimeoutRef.current) {
      clearTimeout(staleTimeoutRef.current)
      staleTimeoutRef.current = null
    }
    if (trickleIntervalRef.current) {
      clearInterval(trickleIntervalRef.current)
      trickleIntervalRef.current = null
    }
  }, [])

  const finish = useCallback(() => {
    if (!activeRef.current) return

    activeRef.current = false
    clearTimers()
    setProgress(COMPLETE_PROGRESS)

    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false)
      setProgress(0)
      hideTimeoutRef.current = null
    }, HIDE_DELAY_MS)
  }, [clearTimers])

  const start = useCallback(() => {
    clearTimers()
    activeRef.current = true
    setIsVisible(true)
    setProgress((current) => Math.max(current, INITIAL_PROGRESS))

    trickleIntervalRef.current = setInterval(() => {
      setProgress((current) => {
        const baseline = current < MIN_VISIBLE_PROGRESS ? MIN_VISIBLE_PROGRESS : current
        if (baseline >= MAX_PROGRESS_BEFORE_COMPLETE) {
          return baseline
        }

        const remaining = MAX_PROGRESS_BEFORE_COMPLETE - baseline
        const step = Math.max(1.5, remaining * 0.12)
        return Math.min(MAX_PROGRESS_BEFORE_COMPLETE, baseline + step)
      })
    }, TRICKLE_INTERVAL_MS)

    staleTimeoutRef.current = setTimeout(() => {
      finish()
    }, STALE_NAVIGATION_TIMEOUT_MS)
  }, [clearTimers, finish])

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }

    finish()
  }, [finish, pathname])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = getHrefFromTarget(event.target)
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return

      const nextUrl = new URL(anchor.href, window.location.href)
      if (nextUrl.origin !== window.location.origin) return

      const currentUrl = new URL(window.location.href)
      const currentKey = `${currentUrl.pathname}?${currentUrl.searchParams.toString()}`
      const nextKey = `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`

      if (nextKey === currentKey) return

      start()
    }

    const onPopState = () => {
      start()
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)

    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
      clearTimers()
    }
  }, [clearTimers, start])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-100"
    >
      <div
        className="h-[2px] origin-left bg-brand transition-[transform,opacity] duration-200 ease-out"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: `scaleX(${progress / 100})`,
          boxShadow: isVisible ? '0 0 14px color-mix(in oklch, var(--brand) 70%, transparent)' : 'none',
        }}
      />
    </div>
  )
}
