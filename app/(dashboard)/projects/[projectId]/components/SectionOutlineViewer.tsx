interface SectionOutlineViewerProps {
  outline: string | null
}

export function SectionOutlineViewer({ outline }: SectionOutlineViewerProps) {
  if (!outline) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <div className="text-gray-500">
          <p className="text-sm">No outline generated yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Generate an outline to see the structure of your research paper.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-100 border-b border-gray-200 px-4 py-3">
        <h4 className="text-sm font-medium text-gray-700">Paper Structure</h4>
      </div>
      
      {/* Outline Content */}
      <div className="p-4">
        <div className="prose prose-sm max-w-none">
          <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
            {outline}
          </pre>
        </div>
      </div>
      
      {/* Footer with outline info */}
      <div className="bg-gray-100 border-t border-gray-200 px-4 py-2">
        <p className="text-xs text-gray-500">
          This outline provides the structural framework for your research paper.
        </p>
      </div>
    </div>
  )
} 