# LensCart AI Embedding Service

Runs CLIP ViT-B/16 image embedding for the Shopify app backend.

## Local setup

```bash
cd services/embedding
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

## Verify

```bash
curl http://127.0.0.1:8001/health
pytest
```

Expected `/health` response:

```json
{"ok":true,"model":"openai/clip-vit-base-patch16","modelAlias":"clip-vit-b-16","dimension":512}
```
