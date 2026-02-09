'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Loader2, Download, Trash2, KeyRound, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface AccountSectionProps {
  user: {
    id: string
    email: string
    fullName: string | null
    createdAt: string
  }
}

export function AccountSection({ user: _user }: AccountSectionProps) {
  const router = useRouter()
  const [isExporting, setIsExporting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const response = await fetch('/api/user/export')
      
      if (!response.ok) {
        throw new Error('Failed to export data')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `genpaper-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('Data exported successfully')
    } catch (error) {
      console.error('Failed to export data:', error)
      toast.error('Failed to export data')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDeleteAccount = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch('/api/user/delete', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete account')
      }

      toast.success('Account deleted successfully')
      router.push('/login')
    } catch (error) {
      console.error('Failed to delete account:', error)
      toast.error('Failed to delete account')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleChangePassword = () => {
    router.push('/auth/forgot-password')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-instrument text-xl tracking-tight">Account & Security</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your account security and data
        </p>
      </div>

      {/* Security */}
      <div className="rounded-xl border border-border/40 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Security</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Update your password and security settings
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <Label className="flex items-center gap-2 text-xs">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              Password
            </Label>
            <p className="text-[11px] text-muted-foreground ml-[22px]">
              Change your account password
            </p>
          </div>
          <button
            onClick={handleChangePassword}
            className="h-8 px-3 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors w-full sm:w-auto"
          >
            Change Password
          </button>
        </div>
      </div>

      {/* Data Export */}
      <div className="rounded-xl border border-border/40 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Export Data</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Download a copy of all your data
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <Label className="flex items-center gap-2 text-xs">
              <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              Download Your Data
            </Label>
            <p className="text-[11px] text-muted-foreground ml-[22px]">
              Export all your projects, papers, and library as JSON
            </p>
          </div>
          <button
            onClick={handleExportData}
            disabled={isExporting}
            className="inline-flex items-center justify-center gap-2 h-8 px-3 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors disabled:opacity-50 w-full sm:w-auto"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-3 w-3" aria-hidden="true" />
                Export
              </>
            )}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-destructive/30 p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
          <div>
            <h3 className="font-instrument text-base tracking-tight text-destructive">Danger Zone</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Irreversible actions for your account
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <Label className="flex items-center gap-2 text-xs text-destructive">
              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Delete Account
            </Label>
            <p className="text-[11px] text-muted-foreground ml-[22px]">
              Permanently delete your account and all associated data
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="h-8 px-3 rounded-full bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors w-full sm:w-auto">
                Delete Account
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete your
                  account and remove all of your data from our servers, including:
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>All your projects and papers</li>
                    <li>Your research library</li>
                    <li>Your preferences and settings</li>
                    <li>Any uploaded documents</li>
                  </ul>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Deleting…
                    </>
                  ) : (
                    'Yes, delete my account'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}
