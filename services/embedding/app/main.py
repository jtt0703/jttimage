from functools import lru_cache
from io import BytesIO
import asyncio
import json
import logging
import math
import os
from pathlib import Path
import time
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from PIL import Image
import requests
import torch
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = os.environ.get("IMAGE_EMBEDDING_MODEL", "openai/clip-vit-base-patch32")
MODEL_ALIAS = os.environ.get("IMAGE_EMBEDDING_MODEL_ALIAS", "clip-vit-b-32")
DIMENSION = int(os.environ.get("IMAGE_EMBEDDING_DIMENSION", "512"))
DEFAULT_LOCAL_MODEL_DIR = os.environ.get(
    "IMAGE_EMBEDDING_MODEL_LOCAL_DIR",
    "/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch32",
)
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("IMAGE_URL_FETCH_TIMEOUT_SECONDS", "20"))
MAX_CONCURRENCY = int(os.environ.get("EMBEDDING_MAX_CONCURRENCY", "1"))

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("lens-cart-ai-embedding")
semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

app = FastAPI(title="LensCart AI Embedding Service")


class ImageUrlRequest(BaseModel):
    imageUrl: Optional[str] = None


class EmbeddingResponse(BaseModel):
    model: str
    modelAlias: str
    dimension: int
    embedding: list[float]


def log_event(event: str, **fields):
    logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False))


@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
        log_event(
            "embedding_service.request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return response
    except Exception as exc:
        log_event(
            "embedding_service.request_failed",
            method=request.method,
            path=request.url.path,
            duration_ms=round((time.perf_counter() - started) * 1000),
            error_name=type(exc).__name__,
            error_message=str(exc),
        )
        raise


@lru_cache(maxsize=1)
def get_model_and_processor():
    started = time.perf_counter()
    model_source = resolve_model_source()
    log_event("embedding_service.model_load_started", model=MODEL_NAME, model_alias=MODEL_ALIAS, model_source=model_source)
    model = CLIPModel.from_pretrained(model_source)
    processor = CLIPProcessor.from_pretrained(model_source)
    model.eval()
    log_event(
        "embedding_service.model_load_completed",
        model=MODEL_NAME,
        model_alias=MODEL_ALIAS,
        model_source=model_source,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return model, processor


def resolve_model_source() -> str:
    local_model_dir = os.environ.get("IMAGE_EMBEDDING_MODEL_LOCAL_DIR", DEFAULT_LOCAL_MODEL_DIR).strip()
    if local_model_dir and Path(local_model_dir).exists():
        return local_model_dir
    return MODEL_NAME


def load_image_from_bytes(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data)).convert("RGB")
        return image
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid image") from exc


def load_image_from_url(image_url: str) -> Image.Image:
    started = time.perf_counter()
    try:
        response = requests.get(image_url, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if content_type and not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="imageUrl must return an image")
        log_event(
            "embedding_service.image_url_loaded",
            duration_ms=round((time.perf_counter() - started) * 1000),
            byte_size=len(response.content),
            content_type=content_type,
        )
        return load_image_from_bytes(response.content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to fetch imageUrl") from exc


def l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        raise HTTPException(status_code=500, detail="Embedding norm is zero")
    return [value / norm for value in values]


def embed_image(image: Image.Image) -> list[float]:
    started = time.perf_counter()
    model, processor = get_model_and_processor()
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        image_features = model.get_image_features(**inputs)
    vector = image_features[0].detach().cpu().float().tolist()
    if len(vector) != DIMENSION:
        raise HTTPException(status_code=500, detail="Unexpected embedding dimension")
    log_event("embedding_service.inference_completed", duration_ms=round((time.perf_counter() - started) * 1000))
    return l2_normalize(vector)


@app.get("/health")
def health():
    loaded = get_model_and_processor.cache_info().currsize > 0
    return {
        "ok": True,
        "model": MODEL_NAME,
        "modelAlias": MODEL_ALIAS,
        "dimension": DIMENSION,
        "modelLoaded": loaded,
        "maxConcurrency": MAX_CONCURRENCY,
    }


@app.post("/embed/image", response_model=EmbeddingResponse)
async def embed_image_endpoint(request: Request, image: UploadFile | None = File(default=None)):
    async with semaphore:
        if image is not None:
            image_bytes = await image.read()
            log_event(
                "embedding_service.upload_image_received",
                byte_size=len(image_bytes),
                content_type=image.content_type,
            )
            pil_image = load_image_from_bytes(image_bytes)
        else:
            payload = await read_json_payload(request)
            if payload.imageUrl:
                pil_image = load_image_from_url(payload.imageUrl)
            else:
                raise HTTPException(status_code=400, detail="Provide imageUrl or multipart image file")

        return EmbeddingResponse(
            model=MODEL_NAME,
            modelAlias=MODEL_ALIAS,
            dimension=DIMENSION,
            embedding=embed_image(pil_image),
        )


async def read_json_payload(request: Request) -> ImageUrlRequest:
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return ImageUrlRequest(**body)
