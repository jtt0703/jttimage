FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY services/embedding/pyproject.toml ./pyproject.toml
COPY services/embedding/app ./app

RUN pip install --no-cache-dir -e .

EXPOSE 9301

CMD ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "9301"]
