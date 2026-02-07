"""
Self-hosted embedding server using all-MiniLM-L6-v2.
Exposes an OpenAI-compatible /v1/embeddings endpoint.

Deploy on a Hetzner CX22 ($4.5/mo) or similar VPS.
Run: uvicorn main:app --host 0.0.0.0 --port 8787
"""

import time
import os
from typing import Union
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

# Load model at startup
model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    from sentence_transformers import SentenceTransformer

    print("Loading all-MiniLM-L6-v2...")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    print(f"Model loaded. Embedding dimension: {model.get_sentence_embedding_dimension()}")
    yield


app = FastAPI(title="Embedding Server", lifespan=lifespan)

# Simple auth token from env
API_TOKEN = os.environ.get("EMBEDDING_API_TOKEN", "")


# --- Request/Response models (OpenAI-compatible) ---

class EmbeddingRequest(BaseModel):
    input: Union[str, list[str]]
    model: str = "all-MiniLM-L6-v2"
    dimensions: int | None = None  # ignored, always 384


class EmbeddingData(BaseModel):
    object: str = "embedding"
    index: int
    embedding: list[float]


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    total_tokens: int = 0


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: list[EmbeddingData]
    model: str = "all-MiniLM-L6-v2"
    usage: UsageInfo


# --- Endpoints ---

@app.post("/v1/embeddings", response_model=EmbeddingResponse)
async def create_embeddings(
    request: EmbeddingRequest,
    authorization: str | None = Header(None),
):
    # Auth check
    if API_TOKEN:
        if not authorization or not authorization.replace("Bearer ", "") == API_TOKEN:
            raise HTTPException(status_code=401, detail="Invalid API token")

    # Normalize input to list
    texts = request.input if isinstance(request.input, list) else [request.input]

    if len(texts) == 0:
        raise HTTPException(status_code=400, detail="Input must not be empty")

    if len(texts) > 2048:
        raise HTTPException(status_code=400, detail="Max 2048 inputs per request")

    start = time.time()
    embeddings = model.encode(texts, normalize_embeddings=True)
    duration_ms = (time.time() - start) * 1000

    print(f"Encoded {len(texts)} text(s) in {duration_ms:.1f}ms")

    data = [
        EmbeddingData(index=i, embedding=emb.tolist())
        for i, emb in enumerate(embeddings)
    ]

    return EmbeddingResponse(
        data=data,
        model="all-MiniLM-L6-v2",
        usage=UsageInfo(prompt_tokens=sum(len(t.split()) for t in texts)),
    )


@app.get("/health")
async def health():
    return {"status": "ok", "model": "all-MiniLM-L6-v2", "dimensions": 384}
