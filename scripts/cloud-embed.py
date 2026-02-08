#!/usr/bin/env python3
"""
Cloud Embedding Script - Run on TEI server for fastest performance

Usage:
    # Copy to VM and run:
    scp scripts/cloud-embed.py azureuser@20.121.195.131:~/
    ssh azureuser@20.121.195.131 'pip3 install requests && python3 -u cloud-embed.py'
"""

import os
import sys
import time
import json
import requests

# Force unbuffered output
os.environ['PYTHONUNBUFFERED'] = '1'
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://fhamqqcsaoakvlwpqlmk.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoYW1xcWNzYW9ha3Zsd3BxbG1rIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzU0MTkyMSwiZXhwIjoyMDgzMTE3OTIxfQ.8tPGQ-4AK4-XpbAMHHgqlUfdfzSkHJfAvBmR68pNJBY")
QDRANT_URL = os.getenv("QDRANT_URL", "http://20.121.3.85:6333")
TEI_URL = os.getenv("TEI_URL", "http://localhost:8080")  # Local on TEI server

BATCH_SIZE = 8  # Chunks per embedding batch
CONCURRENT_BATCHES = 1  # Sequential - TEI can't handle parallel well
COLLECTION = "paper_chunks"


def truncate_text(text: str, max_chars: int = 1000) -> str:
    """Truncate text to fit TEI token limit"""
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    last_space = truncated.rfind(' ')
    if last_space > max_chars * 0.8:
        return truncated[:last_space]
    return truncated


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings using TEI server"""
    truncated = [truncate_text(t) for t in texts]
    
    try:
        response = requests.post(
            f"{TEI_URL}/embed",
            json={"inputs": truncated},
            timeout=60
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        # Try one by one with aggressive truncation
        results = []
        for text in texts:
            try:
                short = truncate_text(text, 600)
                resp = requests.post(
                    f"{TEI_URL}/embed",
                    json={"inputs": [short]},
                    timeout=30
                )
                resp.raise_for_status()
                results.append(resp.json()[0])
            except Exception as inner_e:
                # Ultra short as last resort
                ultra = text[:400] if text else ""
                resp = requests.post(
                    f"{TEI_URL}/embed",
                    json={"inputs": [ultra]},
                    timeout=30
                )
                resp.raise_for_status()
                results.append(resp.json()[0])
        return results


def fetch_chunks(offset: int, limit: int) -> list[dict]:
    """Fetch chunks from Supabase"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/paper_chunks",
        params={
            "select": "id,paper_id,chunk_index,content",
            "order": "id",
            "offset": offset,
            "limit": limit,
        },
        headers=headers,
        timeout=60
    )
    response.raise_for_status()
    return response.json()


def upsert_to_qdrant(points: list[dict]) -> bool:
    """Upsert points to Qdrant"""
    try:
        response = requests.put(
            f"{QDRANT_URL}/collections/{COLLECTION}/points",
            params={"wait": "true"},
            json={"points": points},
            timeout=60
        )
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"  Qdrant error: {e}")
        return False


def process_batch(chunks: list[dict]) -> int:
    """Process a batch of chunks: embed and upsert"""
    if not chunks:
        return 0
    
    try:
        # Generate embeddings
        texts = [c.get("content", "") or "" for c in chunks]
        embeddings = generate_embeddings(texts)
        
        # Build points
        points = []
        for chunk, embedding in zip(chunks, embeddings):
            points.append({
                "id": chunk["id"],
                "vector": embedding,
                "payload": {
                    "paper_id": chunk["paper_id"],
                    "chunk_index": chunk["chunk_index"],
                    "content": chunk.get("content", ""),
                }
            })
        
        # Upsert
        if upsert_to_qdrant(points):
            return len(points)
        return 0
    except Exception as e:
        print(f"  Batch error: {e}")
        return 0


def get_total_count() -> int:
    """Get total chunk count from Supabase"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
    }
    
    response = requests.head(
        f"{SUPABASE_URL}/rest/v1/paper_chunks",
        params={"select": "id"},
        headers=headers,
        timeout=30
    )
    
    content_range = response.headers.get("content-range", "")
    if "/" in content_range:
        return int(content_range.split("/")[-1])
    return 0


def main():
    print("=" * 60)
    print("📦 Cloud Embedding: Supabase → Qdrant")
    print("=" * 60)
    print(f"Supabase URL:  {SUPABASE_URL}")
    print(f"Qdrant URL:    {QDRANT_URL}")
    print(f"TEI URL:       {TEI_URL}")
    print(f"Batch size:    {BATCH_SIZE}")
    print(f"Concurrency:   {CONCURRENT_BATCHES}")
    print("=" * 60)
    
    # Check connections
    print("\n🔌 Checking connections...")
    
    # Check TEI
    try:
        r = requests.get(f"{TEI_URL}/health", timeout=10)
        print(f"  TEI: ✅ Healthy")
    except Exception as e:
        print(f"  TEI: ❌ {e}")
        sys.exit(1)
    
    # Check Qdrant
    try:
        r = requests.get(f"{QDRANT_URL}/collections/{COLLECTION}", timeout=10)
        info = r.json()
        points = info.get("result", {}).get("points_count", 0)
        print(f"  Qdrant: ✅ ({points} existing points)")
    except Exception as e:
        print(f"  Qdrant: ❌ {e}")
        sys.exit(1)
    
    # Check Supabase and get count
    try:
        total = get_total_count()
        print(f"  Supabase: ✅ ({total} chunks)")
    except Exception as e:
        print(f"  Supabase: ❌ {e}")
        sys.exit(1)
    
    # Test embedding
    try:
        test = generate_embeddings(["test"])
        print(f"  Embedding dims: {len(test[0])}")
    except Exception as e:
        print(f"  Embedding test: ❌ {e}")
        sys.exit(1)
    
    # Process all chunks
    print(f"\n📝 Processing {total} chunks...")
    
    processed = 0
    offset = 0
    start_time = time.time()
    effective_batch = BATCH_SIZE * CONCURRENT_BATCHES
    
    while offset < total:
        # Fetch larger batch
        chunks = fetch_chunks(offset, effective_batch)
        if not chunks:
            break
        
        # Split into smaller batches for parallel processing
        batches = [chunks[i:i+BATCH_SIZE] for i in range(0, len(chunks), BATCH_SIZE)]
        
        # Process in parallel
        with ThreadPoolExecutor(max_workers=CONCURRENT_BATCHES) as executor:
            futures = [executor.submit(process_batch, batch) for batch in batches]
            for future in as_completed(futures):
                processed += future.result()
        
        offset += len(chunks)
        
        # Progress
        elapsed = time.time() - start_time
        if elapsed > 0:
            rate = processed / elapsed
            remaining = total - processed
            eta = remaining / rate / 60 if rate > 0 else 0
            pct = processed * 100 / total
            print(f"  Progress: {processed}/{total} ({pct:.1f}%) - {rate:.1f} chunks/s - ETA: {eta:.1f} min")
    
    total_time = time.time() - start_time
    print(f"\n✅ Embedding complete!")
    print(f"   Total processed: {processed}")
    print(f"   Total time: {total_time/60:.1f} minutes")
    print(f"   Average rate: {processed/total_time:.1f} chunks/second")
    
    # Verify
    print("\n🔍 Verifying...")
    r = requests.get(f"{QDRANT_URL}/collections/{COLLECTION}", timeout=10)
    final = r.json().get("result", {}).get("points_count", 0)
    print(f"   Qdrant now has {final} points")
    
    # Test search
    print("\n🔍 Test search...")
    query_embed = generate_embeddings(["machine learning neural networks"])[0]
    r = requests.post(
        f"{QDRANT_URL}/collections/{COLLECTION}/points/search",
        json={"vector": query_embed, "limit": 3, "with_payload": True},
        timeout=30
    )
    results = r.json().get("result", [])
    for res in results:
        score = res.get("score", 0)
        content = res.get("payload", {}).get("content", "")[:60]
        print(f"   Score: {score:.4f} - {content}...")


if __name__ == "__main__":
    main()
