'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { 
  Upload, 
  FileText, 
  X, 
  CheckCircle, 
  AlertCircle,
  FilePlus
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface UploadedFile {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error'
  progress: number
  error?: string
  extractedData?: {
    title?: string
    authors?: string[]
    abstract?: string
    venue?: string
    doi?: string
    year?: string
  }
}

interface UploadedPaperWithData extends UploadedFile {
  extractedData: NonNullable<UploadedFile['extractedData']>
}

interface FileUploadProps {
  onUploadComplete?: (papers: Array<UploadedPaperWithData['extractedData']>) => void
  className?: string
}

export default function FileUpload({ onUploadComplete, className }: FileUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [globalProgress, setGlobalProgress] = useState(0)

  const generateId = () => Math.random().toString(36).substr(2, 9)

  const addFiles = useCallback((newFiles: File[]) => {
    const uploadedFiles: UploadedFile[] = newFiles.map(file => ({
      file,
      id: generateId(),
      status: 'pending',
      progress: 0
    }))
    
    setFiles(prev => [...prev, ...uploadedFiles])
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const droppedFiles = Array.from(e.dataTransfer.files)
    const pdfFiles = droppedFiles.filter(file => 
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    )
    
    if (pdfFiles.length > 0) {
      addFiles(pdfFiles)
    }
  }, [addFiles])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (selectedFiles) {
      const pdfFiles = Array.from(selectedFiles).filter(file => 
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      )
      if (pdfFiles.length > 0) {
        addFiles(pdfFiles)
      }
    }
  }, [addFiles])

  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const processFile = async (uploadedFile: UploadedFile): Promise<void> => {
    const { file, id } = uploadedFile
    
    try {
      // Update status to uploading
      setFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'uploading', progress: 10 } : f
      ))

      // Create FormData for file upload
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fileName', file.name)

      // Upload and process the file
      const response = await fetch('/api/library/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }

      // Update progress during processing
      setFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'processing', progress: 50 } : f
      ))

      const result = await response.json()

      // Update with success
      setFiles(prev => prev.map(f => 
        f.id === id ? { 
          ...f, 
          status: 'success', 
          progress: 100,
          extractedData: result.extractedData 
        } : f
      ))

    } catch (error) {
      console.error('File processing error:', error)
      setFiles(prev => prev.map(f => 
        f.id === id ? { 
          ...f, 
          status: 'error', 
          progress: 0,
          error: error instanceof Error ? error.message : 'Upload failed'
        } : f
      ))
    }
  }

  const handleUploadAll = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending')
    
    if (pendingFiles.length === 0) return

    // Process files sequentially to avoid overwhelming the server
    for (const file of pendingFiles) {
      await processFile(file)
    }

    // Calculate global progress
    const totalFiles = files.length
    const completedFiles = files.filter(f => f.status === 'success').length
    setGlobalProgress((completedFiles / totalFiles) * 100)

    // Notify parent of successful uploads
    const successfulUploads = files.filter((f): f is UploadedPaperWithData => f.status === 'success' && f.extractedData !== undefined)
    if (successfulUploads.length > 0 && onUploadComplete) {
      onUploadComplete(successfulUploads.map(f => f.extractedData))
    }
  }

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'success'))
    setGlobalProgress(0)
  }

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-4 w-4 text-muted-foreground" />
      case 'uploading':
      case 'processing':
        return <LoadingSpinner size="sm" className="h-4 w-4 text-gray-1000" />
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
    }
  }

  const getStatusColor = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return 'border-muted'
      case 'uploading':
      case 'processing':
        return 'border-gray-300 bg-gray-100'
      case 'success':
        return 'border-green-200 bg-green-50'
      case 'error':
        return 'border-red-200 bg-red-50'
    }
  }

  const pendingFiles = files.filter(f => f.status === 'pending')
  const processingFiles = files.filter(f => f.status === 'uploading' || f.status === 'processing')
  const completedFiles = files.filter(f => f.status === 'success' || f.status === 'error')

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Papers
        </CardTitle>
        <CardDescription>
          Upload PDF papers from your local system to add them to your library
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop Zone */}
        <div
          className={`
            border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
            ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <FilePlus className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">Drop PDF files here</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Or click to browse your computer
          </p>
          <Button variant="outline">
            Select Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-4">
            <Separator />
            
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                Selected Files ({files.length})
              </h3>
              <div className="flex gap-2">
                {pendingFiles.length > 0 && (
                  <Button 
                    onClick={handleUploadAll}
                    disabled={processingFiles.length > 0}
                    size="sm"
                  >
                    {processingFiles.length > 0 ? (
                      <LoadingSpinner size="sm" text="Processing..." />
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload All
                      </>
                    )}
                  </Button>
                )}
                {completedFiles.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearCompleted}>
                    Clear Completed
                  </Button>
                )}
              </div>
            </div>

            {/* Global Progress */}
            {processingFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall Progress</span>
                  <span>{Math.round(globalProgress)}%</span>
                </div>
                <Progress value={globalProgress} />
              </div>
            )}

            {/* Individual Files */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {files.map((uploadedFile) => (
                <div
                  key={uploadedFile.id}
                  className={`p-3 border rounded-lg ${getStatusColor(uploadedFile.status)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {getStatusIcon(uploadedFile.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {uploadedFile.file.name}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{(uploadedFile.file.size / 1024 / 1024).toFixed(1)} MB</span>
                          <Badge variant="secondary">
                            {uploadedFile.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(uploadedFile.id)}
                      disabled={uploadedFile.status === 'uploading' || uploadedFile.status === 'processing'}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Progress Bar */}
                  {(uploadedFile.status === 'uploading' || uploadedFile.status === 'processing') && (
                    <div className="mt-2">
                      <Progress value={uploadedFile.progress} className="h-2" />
                    </div>
                  )}

                  {/* Error Message */}
                  {uploadedFile.status === 'error' && uploadedFile.error && (
                    <div className="mt-2 text-xs text-red-600">
                      {uploadedFile.error}
                    </div>
                  )}

                  {/* Extracted Data Preview */}
                  {uploadedFile.status === 'success' && uploadedFile.extractedData && (
                    <div className="mt-2 text-xs text-green-700">
                      <p><strong>Title:</strong> {uploadedFile.extractedData.title || 'Not detected'}</p>
                      {uploadedFile.extractedData.authors && (
                        <p><strong>Authors:</strong> {uploadedFile.extractedData.authors.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
} 