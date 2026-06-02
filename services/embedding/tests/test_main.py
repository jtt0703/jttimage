from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import MODEL_NAME, app, resolve_model_source


def make_png_bytes() -> bytes:
    image = Image.new("RGB", (8, 8), color=(255, 0, 0))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_health_returns_model_metadata():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "model": "openai/clip-vit-base-patch16",
        "modelAlias": "clip-vit-b-16",
        "dimension": 512,
    }


def test_resolve_model_source_prefers_existing_local_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_EMBEDDING_MODEL_LOCAL_DIR", str(tmp_path))

    assert resolve_model_source() == str(tmp_path)


def test_resolve_model_source_falls_back_to_model_name_for_missing_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_EMBEDDING_MODEL_LOCAL_DIR", str(tmp_path / "missing"))

    assert resolve_model_source() == MODEL_NAME


def test_embed_image_file_returns_normalized_512_vector(monkeypatch):
    def fake_embed_image(image):
        return [1.0] + [0.0] * 511

    monkeypatch.setattr("app.main.embed_image", fake_embed_image)
    client = TestClient(app)
    response = client.post(
        "/embed/image",
        files={"image": ("sample.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "openai/clip-vit-base-patch16"
    assert body["modelAlias"] == "clip-vit-b-16"
    assert body["dimension"] == 512
    assert len(body["embedding"]) == 512
    assert sum(value * value for value in body["embedding"]) == 1.0


def test_embed_image_url_json_returns_normalized_512_vector(monkeypatch):
    def fake_load_image_from_url(image_url):
        assert image_url == "https://cdn.shopify.com/product.jpg"
        return Image.new("RGB", (8, 8), color=(0, 255, 0))

    def fake_embed_image(image):
        return [1.0] + [0.0] * 511

    monkeypatch.setattr("app.main.load_image_from_url", fake_load_image_from_url)
    monkeypatch.setattr("app.main.embed_image", fake_embed_image)
    client = TestClient(app)
    response = client.post("/embed/image", json={"imageUrl": "https://cdn.shopify.com/product.jpg"})

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "openai/clip-vit-base-patch16"
    assert body["modelAlias"] == "clip-vit-b-16"
    assert body["dimension"] == 512
    assert len(body["embedding"]) == 512
    assert sum(value * value for value in body["embedding"]) == 1.0


def test_embed_image_rejects_empty_request():
    client = TestClient(app)
    response = client.post("/embed/image", json={})
    assert response.status_code == 400
    assert response.json()["detail"] == "Provide imageUrl or multipart image file"
