#!/bin/bash

# Cloud Embedding Script
# Run this on the TEI server (bge-embeddings VM) for fastest performance
#
# Usage:
#   # From local machine:
#   scp scripts/cloud-embed.sh azureuser@20.121.195.131:~/
#   ssh azureuser@20.121.195.131 'chmod +x cloud-embed.sh && ./cloud-embed.sh'

set -e

echo "============================================================"
echo "📦 Cloud Embedding: Supabase → Qdrant"
echo "============================================================"

# Configuration - UPDATE THESE VALUES
SUPABASE_URL="https://fhamqqcsaoakvlwpqlmk.supabase.co"
SUPABASE_KEY="REPLACE_WITH_SERVICE_ROLE_KEY"
QDRANT_URL="http://20.121.3.85:6333"
TEI_URL="http://localhost:8080"  # Local since we're on the TEI server

BATCH_SIZE=32
COLLECTION="paper_chunks"

# Check dependencies
if ! command -v curl &> /dev/null; then
    echo "❌ curl not found"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Installing jq..."
    sudo apt-get update && sudo apt-get install -y jq
fi

# Check TEI is running locally
echo "Checking TEI server..."
if ! curl -s "${TEI_URL}/health" > /dev/null; then
    echo "❌ TEI server not responding at ${TEI_URL}"
    exit 1
fi
echo "✅ TEI server healthy"

# Check Qdrant
echo "Checking Qdrant..."
QDRANT_COUNT=$(curl -s "${QDRANT_URL}/collections/${COLLECTION}" | jq -r '.result.points_count // 0')
echo "✅ Qdrant has ${QDRANT_COUNT} points in ${COLLECTION}"

# Get total count from Supabase
echo "Checking Supabase..."
TOTAL=$(curl -s "${SUPABASE_URL}/rest/v1/paper_chunks?select=id&limit=1" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Prefer: count=exact" \
    -I 2>/dev/null | grep -i 'content-range' | sed 's/.*\///' | tr -d '\r')

echo "✅ Supabase has ${TOTAL} chunks"

# Create working directory
WORK_DIR="/tmp/embedding_job_$$"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo ""
echo "📝 Starting embedding process..."
echo "   Batch size: ${BATCH_SIZE}"
echo "   Total chunks: ${TOTAL}"
echo ""

PROCESSED=0
OFFSET=0
START_TIME=$(date +%s)

while [ $OFFSET -lt $TOTAL ]; do
    # Fetch batch from Supabase
    CHUNKS=$(curl -s "${SUPABASE_URL}/rest/v1/paper_chunks?select=id,paper_id,chunk_index,content&order=id&offset=${OFFSET}&limit=${BATCH_SIZE}" \
        -H "apikey: ${SUPABASE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_KEY}")
    
    BATCH_COUNT=$(echo "$CHUNKS" | jq 'length')
    
    if [ "$BATCH_COUNT" -eq 0 ]; then
        break
    fi
    
    # Extract texts and truncate to ~1000 chars
    TEXTS=$(echo "$CHUNKS" | jq -r '[.[].content[:1000]] | @json')
    
    # Generate embeddings
    EMBEDDINGS=$(curl -s -X POST "${TEI_URL}/embed" \
        -H "Content-Type: application/json" \
        -d "{\"inputs\": ${TEXTS}}" 2>/dev/null)
    
    if [ -z "$EMBEDDINGS" ] || [ "$EMBEDDINGS" = "null" ]; then
        echo "⚠️  Embedding failed for batch at offset ${OFFSET}, retrying one by one..."
        # Process one by one
        for i in $(seq 0 $((BATCH_COUNT - 1))); do
            CHUNK=$(echo "$CHUNKS" | jq ".[$i]")
            ID=$(echo "$CHUNK" | jq -r '.id')
            PAPER_ID=$(echo "$CHUNK" | jq -r '.paper_id')
            CHUNK_INDEX=$(echo "$CHUNK" | jq -r '.chunk_index')
            CONTENT=$(echo "$CHUNK" | jq -r '.content')
            SHORT_CONTENT=$(echo "$CONTENT" | head -c 800)
            
            SINGLE_EMBED=$(curl -s -X POST "${TEI_URL}/embed" \
                -H "Content-Type: application/json" \
                -d "{\"inputs\": [\"${SHORT_CONTENT//\"/\\\"}\"]}") 
            
            if [ -n "$SINGLE_EMBED" ] && [ "$SINGLE_EMBED" != "null" ]; then
                VECTOR=$(echo "$SINGLE_EMBED" | jq '.[0]')
                curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}/points?wait=true" \
                    -H "Content-Type: application/json" \
                    -d "{\"points\": [{\"id\": \"${ID}\", \"vector\": ${VECTOR}, \"payload\": {\"paper_id\": \"${PAPER_ID}\", \"chunk_index\": ${CHUNK_INDEX}, \"content\": $(echo "$CONTENT" | jq -Rs .)}}]}" > /dev/null
                PROCESSED=$((PROCESSED + 1))
            fi
        done
    else
        # Build points array for Qdrant
        POINTS="["
        for i in $(seq 0 $((BATCH_COUNT - 1))); do
            CHUNK=$(echo "$CHUNKS" | jq ".[$i]")
            ID=$(echo "$CHUNK" | jq -r '.id')
            PAPER_ID=$(echo "$CHUNK" | jq -r '.paper_id')
            CHUNK_INDEX=$(echo "$CHUNK" | jq -r '.chunk_index')
            CONTENT=$(echo "$CHUNK" | jq '.content')
            VECTOR=$(echo "$EMBEDDINGS" | jq ".[$i]")
            
            if [ $i -gt 0 ]; then
                POINTS="${POINTS},"
            fi
            POINTS="${POINTS}{\"id\":\"${ID}\",\"vector\":${VECTOR},\"payload\":{\"paper_id\":\"${PAPER_ID}\",\"chunk_index\":${CHUNK_INDEX},\"content\":${CONTENT}}}"
        done
        POINTS="${POINTS}]"
        
        # Upsert to Qdrant
        curl -s -X PUT "${QDRANT_URL}/collections/${COLLECTION}/points?wait=true" \
            -H "Content-Type: application/json" \
            -d "{\"points\": ${POINTS}}" > /dev/null
        
        PROCESSED=$((PROCESSED + BATCH_COUNT))
    fi
    
    OFFSET=$((OFFSET + BATCH_SIZE))
    
    # Progress update
    NOW=$(date +%s)
    ELAPSED=$((NOW - START_TIME))
    if [ $ELAPSED -gt 0 ]; then
        RATE=$(echo "scale=1; $PROCESSED / $ELAPSED" | bc)
        REMAINING=$((TOTAL - PROCESSED))
        ETA=$(echo "scale=0; $REMAINING / ($PROCESSED / $ELAPSED) / 60" | bc 2>/dev/null || echo "?")
        PCT=$(echo "scale=1; $PROCESSED * 100 / $TOTAL" | bc)
        echo "  Progress: ${PROCESSED}/${TOTAL} (${PCT}%) - ${RATE} chunks/s - ETA: ${ETA} min"
    fi
done

echo ""
echo "✅ Embedding complete!"
echo "   Total processed: ${PROCESSED}"
echo "   Total time: $(($(date +%s) - START_TIME)) seconds"

# Cleanup
rm -rf "$WORK_DIR"

# Verify
echo ""
echo "🔍 Verifying..."
FINAL_COUNT=$(curl -s "${QDRANT_URL}/collections/${COLLECTION}" | jq -r '.result.points_count')
echo "   Qdrant now has ${FINAL_COUNT} points"
