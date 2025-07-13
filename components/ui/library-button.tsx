'use client'

import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGlobalLibrary } from '@/components/GlobalLibraryProvider'

interface LibraryButtonProps {
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default' | 'lg'
  className?: string
  children?: React.ReactNode
  query?: string
}

export default function LibraryButton({ 
  variant = 'outline', 
  size = 'default',
  className = '',
  children,
  query = ''
}: LibraryButtonProps) {
  const { openLibraryDrawer } = useGlobalLibrary()

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => openLibraryDrawer(query)}
    >
      <BookOpen className="h-4 w-4 mr-2" />
      {children || 'Open Library'}
    </Button>
  )
} 