#!/usr/bin/env bun

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

type Source = 'openalex' | 'core' | 'disciplines'

const DEFAULT_SOURCE: Source = 'openalex'

const SOURCE_ALIASES: Record<string, Source> = {
  openalex: 'openalex',
  default: 'openalex',
  general: 'openalex',
  core: 'core',
  disciplines: 'disciplines',
}

const SOURCE_SCRIPTS: Record<Source, string> = {
  openalex: 'bulk-ingest.ts',
  core: 'bulk-ingest-core.ts',
  disciplines: 'bulk-ingest-disciplines.ts',
}

function printHelp() {
  console.log(`
Canonical ingest entrypoint for GenPaper.

Default source:
  openalex  Broad corpus ingest with optional PDF queueing.

Usage:
  bun run ingest -- [args]
  bun run ingest -- --source core [args]
  bun run ingest -- --source disciplines [args]

Examples:
  bun run ingest -- --limit 10000 --with-pdfs --resume
  bun run ingest -- --source core --limit 10000 --query "thesis OR dissertation"
  bun run ingest -- --source disciplines --papers-per-discipline 5000
`)
}

function parseArgs(argv: string[]) {
  let source: Source = DEFAULT_SOURCE
  const forwarded: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      return { help: true, source, forwarded }
    }

    if (arg === '--source' || arg === '--mode') {
      const rawValue = argv[index + 1]
      if (!rawValue) {
        throw new Error('Missing value for --source')
      }
      const resolved = SOURCE_ALIASES[rawValue]
      if (!resolved) {
        throw new Error(`Unsupported source "${rawValue}"`)
      }
      source = resolved
      index += 1
      continue
    }

    if (arg.startsWith('--source=')) {
      const rawValue = arg.slice('--source='.length)
      const resolved = SOURCE_ALIASES[rawValue]
      if (!resolved) {
        throw new Error(`Unsupported source "${rawValue}"`)
      }
      source = resolved
      continue
    }

    forwarded.push(arg)
  }

  return { help: false, source, forwarded }
}

async function main() {
  const { help, source, forwarded } = parseArgs(process.argv.slice(2))
  if (help) {
    printHelp()
    return
  }

  const currentFilePath = fileURLToPath(import.meta.url)
  const scriptsDir = path.dirname(currentFilePath)
  const targetScript = path.join(scriptsDir, SOURCE_SCRIPTS[source])

  console.log(`[ingest] Source: ${source}`)
  console.log(`[ingest] Target: ${path.basename(targetScript)}`)

  const child = spawn('bun', ['run', targetScript, ...forwarded], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    console.error('[ingest] Failed to start ingest process:', error.message)
    process.exit(1)
  })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[ingest] ${message}`)
  process.exit(1)
})
