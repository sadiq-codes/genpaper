interface ReferenceViewerProps {
  references_list?: string[] | null
}

export function ReferenceViewer({ references_list }: ReferenceViewerProps) {
  if (!references_list || references_list.length === 0) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
        <div className="text-blue-600">
          <p className="text-sm">No references generated yet.</p>
          <p className="text-xs text-blue-500 mt-1">
            Generate placeholder references to see your bibliography here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-blue-100 border-b border-blue-200 px-4 py-3">
        <h4 className="text-sm font-medium text-blue-800">
          References ({references_list.length})
        </h4>
      </div>
      
      {/* References List */}
      <div className="p-4">
        <ol className="space-y-3">
          {references_list.map((reference, index) => (
            <li key={index} className="flex items-start">
              <span className="flex-shrink-0 w-8 h-6 bg-blue-200 text-blue-800 rounded text-xs font-medium flex items-center justify-center mr-3 mt-0.5">
                {index + 1}.
              </span>
              <span className="text-sm text-blue-800 leading-relaxed">
                {reference}
              </span>
            </li>
          ))}
        </ol>
      </div>
      
      {/* Footer */}
      <div className="bg-blue-100 border-t border-blue-200 px-4 py-2">
        <p className="text-xs text-blue-600">
          These are placeholder references that should be replaced with proper academic citations.
        </p>
      </div>
    </div>
  )
} 