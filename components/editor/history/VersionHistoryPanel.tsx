'use client'

import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import dynamic from 'next/dynamic'
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns'
import { 
  History, 
  Clock, 
  Save, 
  RotateCcw, 
  Eye, 
  Loader2,
  AlertCircle,
  Bookmark,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { ProjectPaper } from '../types'
import { useVersionHistory, type Version, type VersionWithContent } from './useVersionHistory'
import { toast } from 'sonner'

// bundle-dynamic-imports: VersionPreview is only shown when a version is selected
const VersionPreview = dynamic(
  () => import('./VersionPreview').then(m => m.VersionPreview),
  { ssr: false }
)

// rendering-hoist-jsx: Static JSX hoisted outside the component
const LoadingState = (
  <div className="flex items-center justify-center py-12 text-muted-foreground">
    <Loader2 className="h-4.5 w-4.5 animate-spin mr-2" />
    <span className="text-sm">Loading versions...</span>
  </div>
)

const EmptyState = (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
      <History className="h-5 w-5 text-muted-foreground/50" />
    </div>
    <p className="text-sm font-medium text-foreground/80">No versions yet</p>
    <p className="text-xs text-muted-foreground mt-1">Versions are created automatically when you save.</p>
  </div>
)

// rerender-memo: Extract badge rendering into a memoized component
const TriggerBadge = memo(function TriggerBadge({ triggerType }: { triggerType: string }) {
  switch (triggerType) {
    case 'manual':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <Bookmark className="h-3 w-3" />
          Manual
        </span>
      )
    case 'restore':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <RotateCcw className="h-3 w-3" />
          Backup
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          <Clock className="h-3 w-3" />
          Auto
        </span>
      )
  }
})

const LatestBadge = (
  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
    Latest
  </span>
)

/** Group versions by day for section headers */
function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'MMMM d, yyyy')
}

interface VersionGroup {
  label: string
  versions: Version[]
  /** Index offset within the global list (for "Latest" badge on index 0) */
  startIndex: number
}

interface VersionHistoryPanelProps {
  projectId: string | undefined
  papers: ProjectPaper[]
  citationStyle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestore: (content: string) => void
}

export function VersionHistoryPanel({
  projectId,
  papers,
  citationStyle,
  open,
  onOpenChange,
  onRestore,
}: VersionHistoryPanelProps) {
  const {
    versions,
    isLoading,
    error,
    fetchVersions,
    getVersionContent,
    restoreVersion,
    createSavePoint,
    clearError,
  } = useVersionHistory(projectId)

  const [previewVersion, setPreviewVersion] = useState<VersionWithContent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoreConfirmVersion, setRestoreConfirmVersion] = useState<Version | null>(null)
  const [savePointLabel, setSavePointLabel] = useState('')
  const [showSavePointInput, setShowSavePointInput] = useState(false)
  const [isCreatingSavePoint, setIsCreatingSavePoint] = useState(false)

  // Group versions by day
  const groupedVersions = useMemo<VersionGroup[]>(() => {
    if (versions.length === 0) return []
    const groups: VersionGroup[] = []
    let currentLabel = ''
    let offset = 0
    for (const version of versions) {
      const label = getDayLabel(version.created_at)
      if (label !== currentLabel) {
        currentLabel = label
        groups.push({ label, versions: [], startIndex: offset })
      }
      groups[groups.length - 1].versions.push(version)
      offset++
    }
    return groups
  }, [versions])

  // Fetch versions when panel opens
  useEffect(() => {
    if (open && projectId) {
      fetchVersions()
    }
  }, [open, projectId, fetchVersions])

  // rerender-functional-setstate: Stable callback references
  const handlePreview = useCallback(async (version: Version) => {
    setPreviewLoading(true)
    const versionWithContent = await getVersionContent(version.id)
    setPreviewLoading(false)
    
    if (versionWithContent) {
      setPreviewVersion(versionWithContent)
    } else {
      toast.error('Failed to load version preview')
    }
  }, [getVersionContent])

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoreConfirmVersion) return

    const restoredContent = await restoreVersion(restoreConfirmVersion.id)
    setRestoreConfirmVersion(null)

    if (restoredContent) {
      onRestore(restoredContent)
      toast.success('Version restored successfully', {
        description: 'A backup of your previous content was created.',
      })
      onOpenChange(false)
    } else {
      toast.error('Failed to restore version')
    }
  }, [restoreConfirmVersion, restoreVersion, onRestore, onOpenChange])

  const handleCreateSavePoint = useCallback(async () => {
    setIsCreatingSavePoint(true)
    const success = await createSavePoint(savePointLabel || undefined)
    setIsCreatingSavePoint(false)
    
    if (success) {
      toast.success('Save point created')
      setSavePointLabel('')
      setShowSavePointInput(false)
    } else {
      toast.error('Failed to create save point')
    }
  }, [createSavePoint, savePointLabel])

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[400px] sm:w-[450px] flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
            <SheetTitle className="flex items-center gap-2.5 font-instrument text-lg tracking-tight">
              <History className="h-4.5 w-4.5 text-muted-foreground" />
              Version History
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground/80">
              Browse and restore previous versions. Up to 20 are kept.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 flex flex-col min-h-0 px-6 pt-4">
            {/* Create Save Point Section */}
            <div className="pb-4 border-b border-border/40">
              {showSavePointInput ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="Save point label (optional)"
                    value={savePointLabel}
                    onChange={(e) => setSavePointLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateSavePoint()
                      if (e.key === 'Escape') {
                        setShowSavePointInput(false)
                        setSavePointLabel('')
                      }
                    }}
                    className="flex-1 rounded-lg"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    className="rounded-lg"
                    onClick={handleCreateSavePoint}
                    disabled={isCreatingSavePoint}
                  >
                    {isCreatingSavePoint ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-lg"
                    onClick={() => {
                      setShowSavePointInput(false)
                      setSavePointLabel('')
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 rounded-lg border-border/50 hover:border-border hover:bg-muted/50 transition-colors"
                  onClick={() => setShowSavePointInput(true)}
                >
                  <Save className="h-4 w-4 text-muted-foreground" />
                  Create Save Point
                </Button>
              )}
            </div>

            {/* Error display */}
            {error && (
              <div className="flex items-center gap-2 p-3 mt-4 rounded-2xl bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 rounded-full"
                  onClick={clearError}
                >
                  Dismiss
                </Button>
              </div>
            )}

            {/* Versions list */}
            <div className="flex-1 min-h-0 mt-4 overflow-y-auto">
              {isLoading && versions.length === 0 ? (
                LoadingState
              ) : versions.length === 0 ? (
                EmptyState
              ) : (
                <div className="pb-6">
                  {groupedVersions.map((group) => (
                    <div key={group.label} className="mb-4">
                      {/* Day header */}
                      <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/60 mb-2 px-1">
                        {group.label}
                      </p>

                      <div className="space-y-2">
                        {group.versions.map((version, i) => {
                          const globalIndex = group.startIndex + i
                          return (
                            <div
                              key={version.id}
                              className={cn(
                                "p-3 rounded-2xl border transition-all duration-300",
                                globalIndex === 0
                                  ? "border-foreground/10 bg-card shadow-sm"
                                  : "border-border/50 bg-card hover:border-border hover:shadow-lg hover:shadow-black/3 dark:hover:shadow-black/20"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <TriggerBadge triggerType={version.trigger_type} />
                                    {globalIndex === 0 ? LatestBadge : null}
                                  </div>
                                  {version.label && (
                                    <p className="text-sm font-medium mt-1.5 truncate text-foreground/90">
                                      {version.label}
                                    </p>
                                  )}
                                  <p className="text-xs text-muted-foreground mt-1.5">
                                    {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                                  </p>
                                  {version.word_count ? (
                                    <p className="text-xs text-muted-foreground/70">
                                      {version.word_count.toLocaleString()} words
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={() => handlePreview(version)}
                                    disabled={previewLoading}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={() => setRestoreConfirmVersion(version)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Preview Modal */}
      <VersionPreview
        version={previewVersion}
        papers={papers}
        citationStyle={citationStyle}
        open={!!previewVersion}
        onOpenChange={(isOpen: boolean) => !isOpen && setPreviewVersion(null)}
        onRestore={() => {
          if (previewVersion) {
            setRestoreConfirmVersion(previewVersion)
            setPreviewVersion(null)
          }
        }}
      />

      {/* Restore Confirmation Dialog */}
      <AlertDialog 
        open={!!restoreConfirmVersion} 
        onOpenChange={(open) => !open && setRestoreConfirmVersion(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-instrument text-lg tracking-tight">Restore this version?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              This will replace your current document with the selected version.
              A backup of your current content will be created automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-full" onClick={handleRestoreConfirm}>
              Restore Version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
