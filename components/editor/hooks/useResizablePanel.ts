'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

interface UseResizablePanelOptions {
  /** Minimum width in pixels */
  minWidth?: number
  /** Maximum width in pixels */
  maxWidth?: number
  /** Default width in pixels */
  defaultWidth?: number
  /** Storage key for persisting width */
  storageKey?: string
}

interface UseResizablePanelReturn {
  /** Current width in pixels */
  width: number
  /** Whether currently dragging */
  isDragging: boolean
  /** Props to spread on the resize handle */
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void
    onTouchStart: (e: React.TouchEvent) => void
  }
  /** Reset width to default */
  resetWidth: () => void
}

/**
 * Hook for creating resizable panels with drag handles
 * 
 * Usage:
 * ```tsx
 * const { width, isDragging, handleProps } = useResizablePanel({
 *   minWidth: 280,
 *   maxWidth: 600,
 *   defaultWidth: 380,
 *   storageKey: 'sidebar-width'
 * })
 * 
 * return (
 *   <div style={{ width }}>
 *     {content}
 *     <div className="resize-handle" {...handleProps} />
 *   </div>
 * )
 * ```
 */
export function useResizablePanel({
  minWidth = 280,
  maxWidth = 600,
  defaultWidth = 380,
  storageKey,
}: UseResizablePanelOptions = {}): UseResizablePanelReturn {
  // Initialize width from localStorage if available
  const [width, setWidth] = useState(() => {
    if (typeof window !== 'undefined' && storageKey) {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = parseInt(stored, 10)
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed
        }
      }
    }
    return defaultWidth
  })
  
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  
  // Save width to localStorage when it changes
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, width.toString())
    }
  }, [width, storageKey])
  
  // Handle mouse/touch move
  const handleMove = useCallback((clientX: number) => {
    const delta = clientX - startXRef.current
    const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta))
    setWidth(newWidth)
  }, [minWidth, maxWidth])
  
  // Handle mouse/touch end
  const handleEnd = useCallback(() => {
    setIsDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])
  
  // Set up global event listeners when dragging
  useEffect(() => {
    if (!isDragging) return
    
    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      handleMove(e.clientX)
    }
    
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientX)
      }
    }
    
    const onMouseUp = () => handleEnd()
    const onTouchEnd = () => handleEnd()
    
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('touchmove', onTouchMove)
    document.addEventListener('touchend', onTouchEnd)
    
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [isDragging, handleMove, handleEnd])
  
  // Start dragging
  const startDrag = useCallback((clientX: number) => {
    startXRef.current = clientX
    startWidthRef.current = width
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])
  
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startDrag(e.clientX)
  }, [startDrag])
  
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      startDrag(e.touches[0].clientX)
    }
  }, [startDrag])
  
  const resetWidth = useCallback(() => {
    setWidth(defaultWidth)
  }, [defaultWidth])
  
  return {
    width,
    isDragging,
    handleProps: {
      onMouseDown,
      onTouchStart,
    },
    resetWidth,
  }
}
