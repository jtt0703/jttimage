# LensCart AI Embedding Service

Runs CLIP ViT-B/16 image embedding for the Shopify app backend.

## Local setup

```bash
cd services/embedding
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pip install -e '.[download]'
python -c "from modelscope import snapshot_download; print(snapshot_download('openai-mirror/clip-vit-base-patch16', cache_dir='/Users/apple/Desktop/test'))"
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

The service loads the local ModelScope snapshot first when this directory exists:

```txt
/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch16
```

Override the local model directory with `IMAGE_EMBEDDING_MODEL_LOCAL_DIR`.

## Verify

```bash
curl http://127.0.0.1:8001/health
pytest
```

Expected `/health` response:

```json
{"ok":true,"model":"openai/clip-vit-base-patch16","modelAlias":"clip-vit-b-16","dimension":512}
```
