/**
 * Generate OG Image for GenPaper
 * 
 * This script creates a dark-themed OG image (1200x630px)
 * Run with: node scripts/generate-og-image.js
 * 
 * Requires: npm install sharp (already available in project via pdf processing)
 */

const fs = require('fs');
const path = require('path');

// SVG template for the OG image
const svgContent = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0a;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#171717;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGradient)"/>
  
  <!-- Subtle grid pattern -->
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" stroke-width="0.5" stroke-opacity="0.03"/>
  </pattern>
  <rect width="1200" height="630" fill="url(#grid)"/>
  
  <!-- Accent line at top -->
  <rect x="0" y="0" width="1200" height="4" fill="url(#accentGradient)"/>
  
  <!-- Logo/Brand name -->
  <text x="600" y="260" 
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
        font-size="72" 
        font-weight="700" 
        fill="#ffffff" 
        text-anchor="middle">
    GenPaper
  </text>
  
  <!-- Tagline -->
  <text x="600" y="330" 
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
        font-size="32" 
        font-weight="400" 
        fill="#a1a1aa" 
        text-anchor="middle">
    AI Research Paper Generator
  </text>
  
  <!-- Description -->
  <text x="600" y="400" 
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
        font-size="22" 
        font-weight="400" 
        fill="#71717a" 
        text-anchor="middle">
    Literature Reviews  |  Theses  |  Dissertations  |  Research Articles
  </text>
  
  <!-- Bottom accent elements -->
  <circle cx="540" cy="520" r="6" fill="#3b82f6" opacity="0.6"/>
  <circle cx="580" cy="520" r="6" fill="#8b5cf6" opacity="0.6"/>
  <circle cx="620" cy="520" r="6" fill="#3b82f6" opacity="0.6"/>
  <circle cx="660" cy="520" r="6" fill="#8b5cf6" opacity="0.6"/>
</svg>
`;

// Write SVG file
const svgPath = path.join(__dirname, '..', 'public', 'og-image.svg');
fs.writeFileSync(svgPath, svgContent.trim());
console.log('Created SVG at:', svgPath);

// Try to convert to PNG if sharp is available
async function convertToPng() {
  try {
    const sharp = require('sharp');
    const pngPath = path.join(__dirname, '..', 'public', 'og-image.png');
    
    await sharp(Buffer.from(svgContent))
      .png()
      .toFile(pngPath);
    
    console.log('Created PNG at:', pngPath);
    
    // Remove SVG after PNG is created (optional)
    // fs.unlinkSync(svgPath);
    // console.log('Removed SVG file');
    
  } catch (error) {
    console.log('Sharp not available or conversion failed:', error.message);
    console.log('SVG file created. You can convert it to PNG manually or use the SVG directly.');
    console.log('\nTo convert manually:');
    console.log('1. Open the SVG in a browser');
    console.log('2. Take a screenshot at 1200x630');
    console.log('3. Or use an online SVG to PNG converter');
  }
}

convertToPng();
