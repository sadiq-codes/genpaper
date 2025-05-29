import { SectionOutlineViewer } from './SectionOutlineViewer'

interface PaperEditorProps {
  outline?: string | null
  content?: string | null
}

export function PaperEditor({ outline, content }: PaperEditorProps) {
  return (
    <div className="space-y-6">
      {/* Outline Section */}
      {outline && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            Research Paper Outline
          </h3>
          <SectionOutlineViewer outline={outline} />
        </div>
      )}

      {/* Content Section */}
      {content && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            Paper Content
          </h3>
          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="prose prose-sm max-w-none">
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {content}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!outline && !content && (
        <div className="text-center py-12 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-gray-500">
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No Content Yet
            </h3>
            <p className="text-sm">
              Generate an outline and content to see your research paper here.
            </p>
          </div>
        </div>
      )}
    </div>
  )
} 