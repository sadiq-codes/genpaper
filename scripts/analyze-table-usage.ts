#!/usr/bin/env tsx

/**
 * Analyze Database Table Usage
 * Scans codebase to see which tables are actually being used
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// All tables from schema
const TABLES = [
  'authors', 'collection_papers', 'failed_chunks', 'library_collections',
  'library_paper_tags', 'library_papers', 'paper_authors', 'paper_chunks',
  'paper_references', 'papers', 'papers_api_cache', 'pdf_processing_logs',
  'profiles', 'project_citations', 'research_projects', 'tags',
  'user_quotas', 'vector_search_performance'
]

function scanDirectory(dir: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): string[] {
  const files: string[] = []
  
  try {
    const items = readdirSync(dir, { withFileTypes: true })
    
    for (const item of items) {
      const fullPath = join(dir, item.name)
      
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
        files.push(...scanDirectory(fullPath, extensions))
      } else if (item.isFile() && extensions.some(ext => item.name.endsWith(ext))) {
        files.push(fullPath)
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }
  
  return files
}

function analyzeTableUsage() {
  console.log('🔍 Analyzing Database Table Usage in Codebase')
  console.log('=' .repeat(50))
  
  // Scan relevant directories
  const directories = ['app', 'lib', 'components', 'supabase']
  const allFiles: string[] = []
  
  for (const dir of directories) {
    allFiles.push(...scanDirectory(dir))
  }
  
  console.log(`📁 Scanning ${allFiles.length} files...`)
  
  // Track usage for each table
  const tableUsage: Record<string, {
    count: number,
    files: string[],
    contexts: string[]
  }> = {}
  
  for (const table of TABLES) {
    tableUsage[table] = { count: 0, files: [], contexts: [] }
  }
  
  // Scan files for table references
  for (const file of allFiles) {
    try {
      const content = readFileSync(file, 'utf-8')
      const relativePath = file.replace(process.cwd(), '').replace(/^\//, '')
      
      for (const table of TABLES) {
        // Look for table references in various contexts
        const patterns = [
          new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)`, 'gi'),
          new RegExp(`\\.table\\(['"\`]${table}['"\`]\\)`, 'gi'),
          new RegExp(`${table}\\s*:`, 'gi'), // TypeScript types
          new RegExp(`CREATE\\s+TABLE.*${table}`, 'gi'),
          new RegExp(`INSERT\\s+INTO\\s+${table}`, 'gi'),
          new RegExp(`UPDATE\\s+${table}`, 'gi'),
          new RegExp(`DELETE\\s+FROM\\s+${table}`, 'gi')
        ]
        
        let found = false
        for (const pattern of patterns) {
          const matches = content.match(pattern)
          if (matches) {
            if (!found) {
              tableUsage[table].count++
              tableUsage[table].files.push(relativePath)
              found = true
            }
            tableUsage[table].contexts.push(...matches.map(m => m.trim()))
          }
        }
      }
    } catch (error) {
      // Skip files we can't read
    }
  }
  
  // Sort tables by usage
  const sortedTables = Object.entries(tableUsage)
    .sort(([,a], [,b]) => b.count - a.count)
  
  console.log('\n📊 TABLE USAGE ANALYSIS')
  console.log('-' .repeat(50))
  
  // High usage tables
  console.log('\n🔥 HEAVILY USED TABLES (Keep):')
  const heavyTables = sortedTables.filter(([,usage]) => usage.count >= 5)
  for (const [table, usage] of heavyTables) {
    console.log(`   ${table}: ${usage.count} files`)
    console.log(`      Files: ${usage.files.slice(0, 3).join(', ')}${usage.files.length > 3 ? '...' : ''}`)
  }
  
  // Medium usage tables  
  console.log('\n⚡ MODERATELY USED TABLES (Consider simplifying):')
  const mediumTables = sortedTables.filter(([,usage]) => usage.count >= 2 && usage.count < 5)
  for (const [table, usage] of mediumTables) {
    console.log(`   ${table}: ${usage.count} files`)
    console.log(`      Files: ${usage.files.join(', ')}`)
  }
  
  // Low/unused tables
  console.log('\n❌ RARELY/NEVER USED TABLES (Safe to remove/simplify):')
  const lowTables = sortedTables.filter(([,usage]) => usage.count < 2)
  for (const [table, usage] of lowTables) {
    if (usage.count === 0) {
      console.log(`   ${table}: NEVER USED`)
    } else {
      console.log(`   ${table}: ${usage.count} file(s) - ${usage.files.join(', ')}`)
    }
  }
  
  // Summary
  console.log('\n📋 SIMPLIFICATION RECOMMENDATIONS:')
  console.log('=' .repeat(50))
  
  const neverUsed = lowTables.filter(([,usage]) => usage.count === 0)
  const rarelyUsed = lowTables.filter(([,usage]) => usage.count === 1)
  
  if (neverUsed.length > 0) {
    console.log(`🗑️  REMOVE IMMEDIATELY: ${neverUsed.map(([table]) => table).join(', ')}`)
  }
  
  if (rarelyUsed.length > 0) {
    console.log(`🔄 CONSIDER SIMPLIFYING: ${rarelyUsed.map(([table]) => table).join(', ')}`)
  }
  
  console.log(`✅ KEEP AS CORE: ${heavyTables.map(([table]) => table).join(', ')}`)
  
  const totalTables = TABLES.length
  const safeToDrop = neverUsed.length + rarelyUsed.length
  const reduction = Math.round((safeToDrop / totalTables) * 100)
  
  console.log(`\n🎯 POTENTIAL COMPLEXITY REDUCTION: ${reduction}% (${safeToDrop}/${totalTables} tables)`)
}

if (require.main === module) {
  analyzeTableUsage()
}
