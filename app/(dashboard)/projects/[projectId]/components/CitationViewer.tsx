interface CitationViewerProps {
  citations_identified?: string[] | null
}

export function CitationViewer({ citations_identified }: CitationViewerProps) {
  if (!citations_identified || citations_identified.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <div className="text-yellow-600">
          <p className="text-sm">No citations identified yet.</p>
          <p className="text-xs text-yellow-500 mt-1">
            Generate content with citation placeholders to see citation needs here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-yellow-100 border-b border-yellow-200 px-4 py-3">
        <h4 className="text-sm font-medium text-yellow-800">
          Citations Needed ({citations_identified.length})
        </h4>
      </div>
      
      {/* Citations List */}
      <div className="p-4">
        <ul className="space-y-2">
          {citations_identified.map((citation, index) => (
            <li key={index} className="flex items-start">
              <span className="flex-shrink-0 w-6 h-6 bg-yellow-200 text-yellow-800 rounded-full text-xs font-medium flex items-center justify-center mr-3 mt-0.5">
                {index + 1}
              </span>
              <span className="text-sm text-yellow-800 leading-relaxed">
                {citation}
              </span>
            </li>
          ))}
        </ul>
      </div>
      
      {/* Footer */}
      <div className="bg-yellow-100 border-t border-yellow-200 px-4 py-2">
        <p className="text-xs text-yellow-600">
          These concepts need proper academic citations in your research paper.
        </p>
      </div>
    </div>
  )
} 