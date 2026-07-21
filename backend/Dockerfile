FROM python:3.11-slim

  ENV PYTHONDONTWRITEBYTECODE=1
  ENV PYTHONUNBUFFERED=1
  ENV TESSERACT_CMD=/usr/bin/tesseract

  RUN apt-get update \
      && apt-get install -y --no-install-recommends \
         tesseract-ocr \
         tesseract-ocr-eng \
      && rm -rf /var/lib/apt/lists/*

  WORKDIR /app

  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt

  COPY . .

  RUN python manage.py collectstatic --noinput

  CMD gunicorn config.wsgi:application --bind 0.0.0.0:$PORT