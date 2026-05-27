FROM python:3.10-slim

# Install system dependencies (ffmpeg is required for audio-separator)
RUN apt-get update && \
    apt-get install -y ffmpeg build-essential nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
# We'll create a requirements.txt on the fly or copy it if it exists.
# But let's just install them directly if there's no requirements.txt, 
# or copy the whole backend directory and install.
COPY . /app/

RUN pip install --no-cache-dir fastapi uvicorn yt-dlp ytmusicapi syncedlyrics audio-separator tamil-translite uroman onnxruntime

# Expose port
EXPOSE 8000

# Start FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
