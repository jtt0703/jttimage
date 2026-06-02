from functools import lru_cache
from io import BytesIO
import math
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from PIL import Image
import requests
import torch
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = "openai/clip-vit-base-patch16"
MODEL_ALIAS = "clip-vit-b-16"
DIMENSION = 512
DEFAULT_LOCAL_MODEL_DIR = "/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch16"

app = FastAPI(title="LensCart AI Embedding Service")


class ImageUrlRequest(BaseModel):
    imageUrl: Optional[str] = None


class EmbeddingResponse(BaseModel):
    model: str
    modelAlias: str
    dimension: int
    embedding: list[float]


@lru_cache(maxsize=1)
def get_model_and_processor():
    model_source = resolve_model_source()
    model = CLIPModel.from_pretrained(model_source)
    processor = CLIPProcessor.from_pretrained(model_source)
    model.eval()
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
    try:
        response = requests.get(image_url, timeout=20)
        response.raise_for_status()
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
    model, processor = get_model_and_processor()
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        image_features = model.get_image_features(**inputs)
    vector = image_features[0].detach().cpu().float().tolist()
    if len(vector) != DIMENSION:
        raise HTTPException(status_code=500, detail="Unexpected embedding dimension")
    return l2_normalize(vector)


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "modelAlias": MODEL_ALIAS,
        "dimension": DIMENSION,
    }


@app.post("/embed/image", response_model=EmbeddingResponse)
async def embed_image_endpoint(payload: Optional[ImageUrlRequest] = None, image: UploadFile | None = File(default=None)):
    if image is not None:
        image_bytes = await image.read()
        pil_image = load_image_from_bytes(image_bytes)
    elif payload is not None and payload.imageUrl:
        pil_image = load_image_from_url(payload.imageUrl)
    else:
        raise HTTPException(status_code=400, detail="Provide imageUrl or multipart image file")

    return EmbeddingResponse(
        model=MODEL_NAME,
        modelAlias=MODEL_ALIAS,
        dimension=DIMENSION,
        embedding=embed_image(pil_image),
    )
