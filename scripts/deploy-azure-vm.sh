#!/bin/bash
# Deploy bulk ingestion to Azure VM (no Docker required)
#
# Usage:
#   ./scripts/deploy-azure-vm.sh                                              # Default: 500K papers
#   ./scripts/deploy-azure-vm.sh --limit 10000 --query "microbiology"         # Custom
#
# This script:
#   1. Creates an Azure VM (Ubuntu 22.04)
#   2. Copies necessary files directly (no git clone needed)
#   3. Installs Node.js and dependencies
#   4. Runs the ingestion script in background

set -e

# Configuration
RESOURCE_GROUP="genpaper-rg"
LOCATION="eastus"
VM_NAME="genpaper-ingest-$(date +%Y%m%d%H%M)"
VM_SIZE="Standard_B2s"  # 2 vCPU, 4GB RAM - ~$30/month
VM_IMAGE="Ubuntu2204"

# Parse arguments - everything after script name is passed to ingestion
INGEST_ARGS="${@:---limit 500000}"

echo "=============================================="
echo "🚀 Azure VM Deployment for Paper Ingestion"
echo "=============================================="
echo "VM Name:     $VM_NAME"
echo "VM Size:     $VM_SIZE"
echo "Region:      $LOCATION"
echo "Ingest Args: $INGEST_ARGS"
echo "=============================================="

# Check if logged in
if ! az account show &>/dev/null; then
    echo "❌ Not logged in to Azure. Run: az login"
    exit 1
fi

# Check for .env.local
if [ ! -f .env.local ]; then
    echo "❌ .env.local not found"
    exit 1
fi

# Create resource group if needed
echo "📦 Ensuring resource group exists..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none 2>/dev/null || true

# Create VM
echo "🖥️  Creating VM (this takes ~2 minutes)..."
az vm create \
    --resource-group $RESOURCE_GROUP \
    --name $VM_NAME \
    --image $VM_IMAGE \
    --size $VM_SIZE \
    --admin-username azureuser \
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --output none

# Get VM IP
VM_IP=$(az vm show --resource-group $RESOURCE_GROUP --name $VM_NAME --show-details --query publicIps -o tsv)
echo "✅ VM created with IP: $VM_IP"

# Wait for VM to be ready
echo "⏳ Waiting for VM to be ready..."
sleep 30

# Install Node.js on VM
echo "📦 Installing Node.js on VM..."
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=60 azureuser@$VM_IP << 'INSTALL_EOF'
set -e
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
mkdir -p ~/genpaper/scripts ~/genpaper/lib
INSTALL_EOF

# Copy necessary files
echo "📤 Copying files to VM..."

# Create a minimal package.json for the ingestion script
ssh azureuser@$VM_IP "cat > ~/genpaper/package.json" << 'PKG_EOF'
{
  "name": "genpaper-ingest",
  "type": "module",
  "dependencies": {
    "@supabase/supabase-js": "^2.49.1",
    "@ai-sdk/azure": "^1.2.1",
    "ai": "^4.1.0",
    "dotenv": "^17.0.0",
    "uuid": "^11.0.5",
    "zod": "^3.24.1"
  }
}
PKG_EOF

# Copy the bulk-ingest-core.ts script
scp scripts/bulk-ingest-core.ts azureuser@$VM_IP:~/genpaper/scripts/

# Copy lib files needed by the script
scp lib/supabase/service.ts azureuser@$VM_IP:~/genpaper/lib/supabase-service.ts 2>/dev/null || true
scp lib/utils/embedding.ts azureuser@$VM_IP:~/genpaper/lib/embedding.ts 2>/dev/null || true

# Create a standalone version of the script that doesn't need path aliases
echo "📝 Creating standalone ingestion script..."
ssh azureuser@$VM_IP "cat > ~/genpaper/ingest.ts" << 'SCRIPT_EOF'
/**
 * Standalone CORE ingestion script for Azure VM
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { createAzure } from '@ai-sdk/azure'
import { embedMany } from 'ai'
import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import fs from 'fs'

// Config
const CORE_API_BASE = 'https://api.core.ac.uk/v3'
const PAGE_SIZE = 100
const EMBED_BATCH = 50
const DB_BATCH = 100
const PROGRESS_FILE = '.bulk-ingest-core-progress.json'
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const MIN_DELAY_MS = 100
const FETCH_TIMEOUT_MS = 60000

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Azure OpenAI for embeddings
const azure = createAzure({
  resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME!,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
})

const embeddingModel = azure.textEmbeddingModel(
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small'
)

// Schemas
const CoreWorkSchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  abstract: z.string().nullable(),
  authors: z.array(z.object({ name: z.string().nullable() })).nullable(),
  doi: z.string().nullable(),
  publishedDate: z.string().nullable(),
  yearPublished: z.number().nullable(),
  publisher: z.string().nullable(),
  journals: z.array(z.object({ title: z.string().nullable() })).nullable(),
  downloadUrl: z.string().nullable(),
  documentType: z.string().nullable(),
  language: z.object({ code: z.string().nullable() }).nullable(),
  citationCount: z.number().nullable(),
  fieldOfStudy: z.string().nullable(),
})

const CoreResponseSchema = z.object({
  totalHits: z.number(),
  limit: z.number(),
  offset: z.number(),
  results: z.array(CoreWorkSchema),
})

type CoreWork = z.infer<typeof CoreWorkSchema>

// Helpers
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function generatePaperId(doi: string | null, title: string, year: number | null, authors: string[]): string {
  if (doi) {
    const normalized = doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
    return uuidv5(normalized, PAPER_NAMESPACE)
  }
  const firstAuthor = authors[0]?.toLowerCase().trim() || ''
  const key = [title.toLowerCase().trim(), firstAuthor, year ? String(year) : ''].filter(Boolean).join('|')
  return uuidv5(key, PAPER_NAMESPACE)
}

function createChunkId(paperId: string, content: string, index: number): string {
  const key = `${paperId}:${index}:${content.slice(0, 100)}`
  return uuidv5(key, PAPER_NAMESPACE)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    limit: 500000,
    offset: 0,
    dryRun: false,
    resume: false,
    query: '_exists_:doi AND _exists_:abstract',
  }
  let i = 0
  while (i < args.length) {
    switch (args[i]) {
      case '--limit': opts.limit = parseInt(args[++i], 10); break
      case '--offset': opts.offset = parseInt(args[++i], 10); break
      case '--resume': opts.resume = true; break
      case '--dry-run': opts.dryRun = true; break
      case '--query': opts.query = args[++i]; break
    }
    i++
  }
  return opts
}

// Generate embeddings
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  })
  return embeddings
}

// Check existing DOIs
async function getExistingDois(dois: string[]): Promise<Set<string>> {
  if (dois.length === 0) return new Set()
  const normalizedDois = dois.map(d => d.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim())
  const { data } = await supabase.from('papers').select('doi').in('doi', normalizedDois)
  return new Set((data || []).map(p => p.doi?.toLowerCase()).filter(Boolean))
}

// Fetch from CORE
async function fetchCorePage(query: string, offset: number): Promise<{ totalHits: number, results: CoreWork[] }> {
  const apiKey = process.env.CORE_API_KEY!
  const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), offset: String(offset) })
  const url = `${CORE_API_BASE}/search/works/?${params}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'GenPaper-BulkIngest/1.0' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.status === 429) {
      console.warn('⏳ Rate limited, waiting 60s...')
      await sleep(60000)
      return fetchCorePage(query, offset)
    }
    if (!res.ok) throw new Error(`CORE API error ${res.status}`)

    const json = await res.json()
    const parsed = CoreResponseSchema.safeParse(json)
    return parsed.success ? parsed.data : json
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

// Main
async function main() {
  const opts = parseArgs()
  
  console.log('='.repeat(60))
  console.log('📚 Bulk Paper Ingestion (CORE) - Azure VM')
  console.log('='.repeat(60))
  console.log(`Target:    ${opts.limit.toLocaleString()} papers`)
  console.log(`Query:     ${opts.query}`)
  console.log(`Offset:    ${opts.offset}`)
  console.log('='.repeat(60))

  let progress = { offset: opts.offset, totalIngested: 0, totalDuplicates: 0, totalErrors: 0 }
  
  if (opts.resume && fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
    console.log(`📂 Resuming from offset ${progress.offset}, ${progress.totalIngested} ingested`)
  }

  const startTime = Date.now()
  const firstPage = await fetchCorePage(opts.query, 0)
  console.log(`\n📊 CORE reports ${firstPage.totalHits.toLocaleString()} matching papers\n`)

  while (progress.totalIngested < opts.limit) {
    try {
      const page = await fetchCorePage(opts.query, progress.offset)
      if (!page.results?.length) { console.log('📭 No more results'); break }

      // Filter valid works with DOI
      const validWorks = page.results.filter(w => w.doi && w.title && w.abstract)
      const existingDois = await getExistingDois(validWorks.map(w => w.doi!))
      const newWorks = validWorks.filter(w => {
        const norm = w.doi!.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
        return !existingDois.has(norm)
      })

      progress.totalDuplicates += validWorks.length - newWorks.length

      if (newWorks.length > 0 && !opts.dryRun) {
        // Process in batches
        for (let b = 0; b < newWorks.length; b += EMBED_BATCH) {
          const batch = newWorks.slice(b, b + EMBED_BATCH)
          const texts = batch.map(w => `${w.title}\n${w.abstract}`)
          
          try {
            const embeddings = await generateEmbeddings(texts)
            
            const paperRows = batch.map((w, i) => {
              const doi = w.doi?.replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
              const authors = w.authors?.map(a => a.name).filter(Boolean) as string[] || []
              const id = generatePaperId(doi || null, w.title!, w.yearPublished, authors)
              return {
                id, title: w.title!, abstract: w.abstract!, authors,
                publication_date: w.publishedDate || (w.yearPublished ? `${w.yearPublished}-01-01` : null),
                venue: w.journals?.[0]?.title || w.publisher || null,
                doi, pdf_url: w.downloadUrl || null, source: 'core',
                citation_count: w.citationCount || 0, embedding: embeddings[i],
                metadata: { coreId: w.id, documentType: w.documentType },
                owner_id: null, is_public: false, processing_status: 'full_text_ready',
              }
            })

            const chunkRows = batch.map((w, i) => {
              const doi = w.doi?.replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
              const authors = w.authors?.map(a => a.name).filter(Boolean) as string[] || []
              const paperId = generatePaperId(doi || null, w.title!, w.yearPublished, authors)
              return {
                id: createChunkId(paperId, w.abstract!, 0),
                paper_id: paperId, chunk_index: 0, content: w.abstract!, embedding: embeddings[i],
              }
            })

            await supabase.from('papers').upsert(paperRows, { onConflict: 'id', ignoreDuplicates: true })
            await supabase.from('paper_chunks').upsert(chunkRows, { onConflict: 'id', ignoreDuplicates: true })
            
            progress.totalIngested += batch.length
          } catch (err) {
            console.error(`  ❌ Batch error:`, err)
            progress.totalErrors += batch.length
          }
        }
      }

      progress.offset += PAGE_SIZE
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress))

      // Log progress
      const elapsed = (Date.now() - startTime) / 1000
      const rate = progress.totalIngested / elapsed
      const eta = (opts.limit - progress.totalIngested) / rate / 3600

      console.log(
        `📊 ${progress.totalIngested.toLocaleString()} ingested | ` +
        `${progress.totalDuplicates.toLocaleString()} dupes | ` +
        `${progress.totalErrors} errors | ` +
        `${rate.toFixed(1)} papers/s | ETA: ${eta.toFixed(1)}h`
      )

      await sleep(MIN_DELAY_MS)
    } catch (err) {
      console.error('Page error:', err)
      await sleep(5000)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary')
  console.log('='.repeat(60))
  console.log(`Ingested:   ${progress.totalIngested.toLocaleString()}`)
  console.log(`Duplicates: ${progress.totalDuplicates.toLocaleString()}`)
  console.log(`Errors:     ${progress.totalErrors}`)
  console.log(`Time:       ${((Date.now() - startTime) / 60000).toFixed(1)} minutes`)
}

main().catch(console.error)
SCRIPT_EOF

# Copy env vars
echo "🔐 Setting up environment..."
scp .env.local azureuser@$VM_IP:~/genpaper/.env.local

# Install dependencies and run
echo "📦 Installing dependencies and starting ingestion..."
ssh azureuser@$VM_IP << RUNEOF
cd ~/genpaper
npm install
echo "🚀 Starting ingestion with args: $INGEST_ARGS"
nohup npx tsx ingest.ts $INGEST_ARGS > ~/ingestion.log 2>&1 &
echo "Process started with PID: \$!"
RUNEOF

echo ""
echo "=============================================="
echo "✅ Deployment Complete!"
echo "=============================================="
echo ""
echo "VM IP:       $VM_IP"
echo "VM Name:     $VM_NAME"
echo ""
echo "📊 Monitor progress:"
echo "   ssh azureuser@$VM_IP 'tail -f ~/ingestion.log'"
echo ""
echo "📊 Check database locally:"
echo "   npx tsx scripts/check-progress.ts"
echo ""
echo "🔍 SSH into VM:"
echo "   ssh azureuser@$VM_IP"
echo ""
echo "🛑 Stop and delete VM when done:"
echo "   az vm delete -g $RESOURCE_GROUP -n $VM_NAME --yes --no-wait"
echo "=============================================="

# Save VM info
echo "$VM_NAME $VM_IP $(date)" >> .azure-vms.txt
echo "VM info saved to .azure-vms.txt"
