'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RealtimeCitationPanel } from '@/components/citation/RealtimeCitationPanel';
import { SmartCitationSearch } from '@/components/citation/SmartCitationSearch';
import { SmartBibliography } from '@/components/citation/SmartBibliography';
import { DocumentCitationManager } from '@/components/citation/DocumentCitationManager';
import { Citation } from '@/lib/ai/citation-function-schema';
import { CitationService } from '@/lib/citations/citation-service';

interface CitationSectionProps {
  projectId: string;
  editorRef?: React.RefObject<HTMLElement>;
}

export function CitationSection({ projectId, editorRef }: CitationSectionProps) {
  const [activeTab, setActiveTab] = useState('citations');
  const [isAddingCitation, setIsAddingCitation] = useState(false);

  const handleManualCitationAdd = async (citation: Citation, source: string) => {
    setIsAddingCitation(true);
    try {
      // Add citation without any specific text link
      const result = await CitationService.bulkUpsert({
        projectId,
        citations: [citation],
        links: [] // No links when manually adding
      });

      if (result.success) {
        // Show success feedback
        console.log('Citation added successfully');
      }
    } catch (error) {
      console.error('Error adding citation:', error);
    } finally {
      setIsAddingCitation(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Document Citation Manager - Always active for text selection */}
      <DocumentCitationManager 
        projectId={projectId}
        editorRef={editorRef}
      />

      {/* Citation Management Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="citations">Citations</TabsTrigger>
          <TabsTrigger value="search">Add Citation</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
        </TabsList>

        {/* Real-time Citations Panel */}
        <TabsContent value="citations" className="mt-4">
          <RealtimeCitationPanel 
            projectId={projectId}
            citationStyle="apa"
          />
        </TabsContent>

        {/* Manual Citation Search */}
        <TabsContent value="search" className="mt-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Add Citation Manually</h3>
            <p className="text-sm text-gray-600 mb-4">
              Search for citations to add to your library. You can also select text in your document and a citation menu will appear.
            </p>
            
            <SmartCitationSearch
              projectId={projectId}
              onSelect={handleManualCitationAdd}
            />
            
            {isAddingCitation && (
              <div className="mt-4 text-sm text-gray-500">
                Adding citation to your library...
              </div>
            )}
          </div>
        </TabsContent>

        {/* Smart Bibliography */}
        <TabsContent value="references" className="mt-4">
          <SmartBibliography
            projectId={projectId}
            initialStyle="apa"
            showExportOptions={true}
            showFilters={true}
          />
        </TabsContent>
      </Tabs>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">How to cite:</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Select any text in your document to add a citation for it</li>
          <li>• Use the "Add Citation" tab to manually search and add citations</li>
          <li>• View all your citations in the "Citations" tab with real-time updates</li>
          <li>• Generate and export your bibliography from the "References" tab</li>
        </ul>
      </div>
    </div>
  );
} 