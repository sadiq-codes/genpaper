# CSL Citation Styles Setup Guide

## Overview

The GenPaper citation system supports over 9,000 citation styles through the Citation Style Language (CSL) ecosystem. This guide explains how to set up and use CSL styles in the application.

## Quick Start

### 1. Download CSL Styles

Download the citation styles repository:

```bash
# Clone the official CSL styles repository
git clone https://github.com/citation-style-language/styles.git public/csl

# Or download as ZIP and extract to public/csl/
wget https://github.com/citation-style-language/styles/archive/refs/heads/master.zip
unzip master.zip -d public/
mv public/styles-master public/csl
```

### 2. (Optional) Use Only Common Styles

If you want to include only the most common styles to reduce bundle size:

```bash
# Create directory for common styles
mkdir -p public/csl

# Copy only popular styles
cd public/csl
wget https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl
wget https://raw.githubusercontent.com/citation-style-language/styles/master/modern-language-association.csl
wget https://raw.githubusercontent.com/citation-style-language/styles/master/chicago-author-date.csl
wget https://raw.githubusercontent.com/citation-style-language/styles/master/ieee.csl
wget https://raw.githubusercontent.com/citation-style-language/styles/master/nature.csl
wget https://raw.githubusercontent.com/citation-style-language/styles/master/vancouver.csl
# Add more as needed...
```

### 3. Alternative: Use CDN (Recommended for Production)

The application will automatically fall back to loading styles from GitHub's CDN if not found locally. This is the recommended approach for production to avoid large bundle sizes.

## Architecture

### CSL Manager (`lib/citations/csl-manager.ts`)

The CSL manager handles:
- Dynamic loading of CSL style files
- Caching in localStorage and memory
- Formatting citations and bibliographies
- Locale support for non-English citations

### Key Features

1. **Dynamic Style Loading**: Styles are loaded on-demand, not bundled
2. **Automatic Fallback**: If a style isn't found locally, it's fetched from GitHub
3. **Persistent Caching**: Styles are cached in localStorage to avoid re-downloading
4. **Multi-language Support**: Automatic locale loading for non-English citations

### Popular Styles Included

The system comes pre-configured with these popular citation styles:
- APA 7th Edition
- MLA 9th Edition  
- Chicago (Author-Date & Notes)
- IEEE
- Nature, Science, Cell
- Vancouver
- Harvard
- AMA (American Medical Association)
- Many more...

## Usage

### In Components

```typescript
import { formatCitations, formatInTextCitation } from '@/lib/citations/csl-manager';

// Format a bibliography
const bibliography = await formatCitations(citations, 'apa', 'bibliography');

// Format in-text citation
const inText = await formatInTextCitation(citation, 'chicago-author-date');
```

### Citation Style Selector

The `CitationStyleSelector` component provides:
- Dropdown with popular styles
- Search functionality for all 9,000+ styles
- Automatic style name resolution
- User preference persistence

```typescript
<CitationStyleSelector
  value={currentStyle}
  onChange={handleStyleChange}
  showSearch={true}
/>
```

## Adding Custom Styles

### 1. Create Your Style

Use the [CSL Visual Editor](https://editor.citationstyles.org/visualEditor/) to create or modify a style.

### 2. Save to Project

Save your custom `.csl` file to `public/csl/your-custom-style.csl`

### 3. Add to Popular Styles (Optional)

Edit `lib/citations/csl-manager.ts` to add your style to `POPULAR_STYLES`:

```typescript
export const POPULAR_STYLES = [
  // ... existing styles
  { id: 'your-custom-style', name: 'Your Lab Style' }
];
```

## Performance Considerations

### Bundle Size
- Don't commit all 9,000+ CSL files to your repository
- Use CDN loading for production
- Only include commonly used styles locally

### Caching Strategy
- Styles are cached in localStorage (limited to ~5MB)
- Memory cache for current session
- Automatic cleanup of old cached styles

### Loading Time
- First load of a style: ~100-500ms (from CDN)
- Subsequent loads: <10ms (from cache)

## Troubleshooting

### Style Not Found
- Check the style ID matches the filename (without .csl)
- Verify the CSL file is valid XML
- Check browser console for loading errors

### Formatting Errors
- Ensure citations have required fields for the style
- Check citation type matches style expectations
- Verify CSL file isn't corrupted

### Cache Issues
```javascript
// Clear all cached styles
import { clearStyleCache } from '@/lib/citations/csl-manager';
clearStyleCache();
```

## Resources

- [CSL Project](https://citationstyles.org/)
- [Style Repository](https://github.com/citation-style-language/styles)
- [CSL Documentation](https://docs.citationstyles.org/)
- [Visual Style Editor](https://editor.citationstyles.org/)
- [Zotero Style Repository](https://www.zotero.org/styles) 