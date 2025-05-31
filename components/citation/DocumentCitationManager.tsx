'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Citation } from '@/lib/ai/citation-function-schema';
import { CitationService } from '@/lib/citations/citation-service';
import { SmartCitationSearch } from './SmartCitationSearch';
import { CitationStyleSelector } from './CitationStyleSelector';
import { formatInTextCitation } from '@/lib/citations/csl-manager';

interface DocumentCitationManagerProps {
  projectId: string;
  editorRef?: React.RefObject<HTMLElement>;
  defaultStyle?: string;
  onCitationInserted?: (citation: Citation, position: number) => void;
}

export function DocumentCitationManager({ 
  projectId,
  editorRef,
  defaultStyle = 'apa',
  onCitationInserted
}: DocumentCitationManagerProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<Range | null>(null);
  const [showCitationMenu, setShowCitationMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [citationStyle, setCitationStyle] = useState(defaultStyle);
  
  // Persist citation style preference
  useEffect(() => {
    const savedStyle = localStorage.getItem('preferred-citation-style');
    if (savedStyle) {
      setCitationStyle(savedStyle);
    }
  }, []);

  const handleStyleChange = useCallback((newStyle: string) => {
    setCitationStyle(newStyle);
    localStorage.setItem('preferred-citation-style', newStyle);
  }, []);
  
  // Handle text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      
      // Only show menu for substantial text selections
      if (text && text.length > 10 && text.length < 500) {
        const range = selection?.getRangeAt(0);
        if (range && isWithinEditor(range)) {
          setSelectedText(text);
          setSelectionRange(range.cloneRange());
          
          // Position menu near selection
          const rect = range.getBoundingClientRect();
          setMenuPosition({
            x: rect.left + (rect.width / 2),
            y: rect.bottom + 10
          });
          
          setShowCitationMenu(true);
        }
      } else if (!text) {
        // Close menu when selection is cleared
        setShowCitationMenu(false);
      }
    };
    
    const isWithinEditor = (range: Range): boolean => {
      if (!editorRef?.current) return true; // Allow anywhere if no editor ref
      return editorRef.current.contains(range.commonAncestorContainer);
    };
    
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('keyup', handleSelection);
    
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('keyup', handleSelection);
    };
  }, [editorRef]);
  
  // Close menu on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCitationMenu(false);
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);
  
  const handleCitationSelect = useCallback(async (citation: Citation, source: string) => {
    if (!selectedText || !selectionRange) return;
    
    setIsProcessing(true);
    try {
      // Convert to CSL-JSON format for citation-js
      const cslCitation = {
        id: citation.doi || citation.title.substring(0, 50),
        type: 'article-journal', // Default, should be mapped from citation.type
        title: citation.title,
        author: citation.authors.map(authorStr => {
          const [family, given] = authorStr.split(', ');
          return { family: family || authorStr, given: given || '' };
        }),
        issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
        'container-title': citation.journal,
        DOI: citation.doi,
        URL: citation.url
      };
      
      // Format in-text citation using CSL
      const inTextCitation = await formatInTextCitation(cslCitation, citationStyle);
      
      // Get position information
      const container = selectionRange.startContainer;
      const startOffset = selectionRange.startOffset;
      const endOffset = selectionRange.endOffset;
      
      // Prepare citation link data
      const link = {
        citationKey: citation.doi || citation.title.substring(0, 50),
        section: getCurrentSection(),
        start: startOffset,
        end: endOffset,
        textSegment: selectedText.substring(0, 300),
        reason: citation.reason || `Supporting: "${selectedText.substring(0, 100)}..."`
      };
      
      // Save citation to database
      const result = await CitationService.bulkUpsert({
        projectId,
        citations: [citation],
        links: [link]
      });
      
      if (result.success) {
        // Insert in-text citation at cursor position
        insertCitationAtRange(selectionRange, inTextCitation);
        
        // Notify parent component
        if (onCitationInserted) {
          onCitationInserted(citation, startOffset);
        }
        
        // Show success feedback
        showToast('Citation added successfully');
      } else {
        showToast('Failed to add citation', 'error');
      }
    } catch (error) {
      console.error('Error adding citation:', error);
      showToast('Error adding citation', 'error');
    } finally {
      setIsProcessing(false);
      setShowCitationMenu(false);
      setSelectedText(null);
    }
  }, [selectedText, selectionRange, citationStyle, projectId, onCitationInserted]);
  
  const getCurrentSection = (): string => {
    // Try to find current section from heading or data attribute
    if (!selectionRange) return 'unknown';
    
    let element: Node | null = selectionRange.commonAncestorContainer;
    while (element && element !== document.body) {
      if (element.nodeType === Node.ELEMENT_NODE) {
        const el = element as HTMLElement;
        
        // Check for section data attribute
        if (el.dataset.section) return el.dataset.section;
        
        // Check for heading
        const heading = el.closest('h1, h2, h3, h4, h5, h6');
        if (heading) return heading.textContent || 'unknown';
      }
      element = element.parentNode;
    }
    
    return 'document';
  };
  
  const insertCitationAtRange = (range: Range, citationText: string) => {
    // Delete the selected text
    range.deleteContents();
    
    // Insert citation text
    const textNode = document.createTextNode(` ${citationText}`);
    range.insertNode(textNode);
    
    // Move cursor after citation
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  
  return (
    <>
      {/* Floating Citation Menu */}
      {showCitationMenu && selectedText && createPortal(
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border w-96 p-4"
          style={{
            left: `${Math.min(menuPosition.x - 192, window.innerWidth - 400)}px`,
            top: `${Math.min(menuPosition.y, window.innerHeight - 300)}px`,
          }}
        >
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-sm font-medium">Add Citation</h3>
              <p className="text-xs text-gray-600 mt-1">for selected text</p>
            </div>
            <button
              onClick={() => setShowCitationMenu(false)}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="mb-3 p-2 bg-gray-50 rounded">
            <p className="text-xs text-gray-600 italic line-clamp-2">
              "{selectedText}"
            </p>
          </div>
          
          <SmartCitationSearch
            projectId={projectId}
            onSelect={handleCitationSelect}
          />
          
          {isProcessing && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
              <div className="text-sm text-gray-600">Adding citation...</div>
            </div>
          )}
        </div>,
        document.body
      )}
      
      {/* Citation Style Selector (floating) */}
      <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-3 z-40">
        <label className="text-xs text-gray-600 block mb-1">Citation Style</label>
        <CitationStyleSelector
          value={citationStyle}
          onChange={handleStyleChange}
          className="w-48"
        />
      </div>
    </>
  );
}

// Simple toast notification
function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-20 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg text-sm ${
    type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
} 