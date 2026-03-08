'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Loader2, Check, User, Mail, Calendar } from 'lucide-react'
import { toast } from 'sonner'

interface ProfileSectionProps {
  user: {
    id: string
    email: string
    fullName: string | null
    createdAt: string
  }
}

export function ProfileSection({ user }: ProfileSectionProps) {
  const [fullName, setFullName] = useState(user.fullName || '')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const handleNameChange = (value: string) => {
    setFullName(value)
    setHasChanges(value !== (user.fullName || ''))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName }),
      })

      if (!response.ok) {
        throw new Error('Failed to save profile')
      }

      toast.success('Profile updated')
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save profile:', error)
      toast.error('Failed to save profile')
    } finally {
      setIsSaving(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(new Date(dateString))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-instrument text-xl tracking-tight">Profile</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Your account information
        </p>
      </div>

      <div className="rounded-xl border border-border/70 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Personal Information</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Update your profile details
          </p>
        </div>

        <div className="space-y-4 sm:space-y-5">
          {/* Full Name */}
          <div className="space-y-2">
            <Label htmlFor="fullName" className="flex items-center gap-2 text-xs">
              <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Full Name
            </Label>
            <Input
              id="fullName"
              name="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter your name…"
              className="w-full sm:max-w-md"
            />
          </div>

          {/* Email (read-only) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Email
            </Label>
            <Input
              value={user.email}
              disabled
              className="w-full sm:max-w-md bg-muted/50"
            />
            <p className="text-[11px] text-muted-foreground">
              Contact support to change your email address
            </p>
          </div>

          {/* Member Since */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Member Since
            </Label>
            <p className="text-sm text-foreground">
              {formatDate(user.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-foreground/80 text-background text-sm font-medium hover:bg-foreground transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Save Changes
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
