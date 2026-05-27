import os
import asyncio
import threading
import re
import warnings
from tamil_translite import translite
from collections import defaultdict
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from ytmusicapi import YTMusic
import yt_dlp
import syncedlyrics
from separator import run_chunked_separation, set_priority_target, update_activity
import uroman as ur

# Initialize the Universal Romanizer once
uroman_client = ur.Uroman()

app = FastAPI()

# Allow CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

warnings.filterwarnings('ignore', category=UserWarning, module='tamil_translite')

def get_romanized_lrc(lrc_content: str) -> str:
    # 1. Phonetically transliterate any Tamil characters perfectly
    tamil_transliterated = translite(lrc_content)
    # 2. Fallback to uroman for all other global languages (Hindi, Korean, Japanese, Russian, etc)
    #    uroman returns an intelligent phonetic spelling based on language rules.
    return uroman_client.romanize_string(tamil_transliterated)

ytmusic = YTMusic()
TEMP_DIR = os.path.join(os.getcwd(), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

class SearchQuery(BaseModel):
    q: str

@app.get("/api/search")
def search(q: str):
    try:
        results = ytmusic.search(query=q, filter="songs", limit=10)
        formatted = []
        for r in results:
            formatted.append({
                "videoId": r.get("videoId"),
                "title": r.get("title"),
                "artists": [a["name"] for a in r.get("artists", [])],
                "thumbnails": r.get("thumbnails", []),
                "album": r.get("album", {}).get("name") if r.get("album") else None,
                "duration": r.get("duration")
            })
        return formatted
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

lyrics_locks = defaultdict(threading.Lock)

@app.get("/api/lyrics/{video_id}")
def get_lyrics(video_id: str, title: str, artist: str):
    lrc_path = os.path.join(TEMP_DIR, f"{video_id}.lrc")
    
    with lyrics_locks[video_id]:
        # Check if we already have it
        if os.path.exists(lrc_path):
            with open(lrc_path, 'r', encoding='utf-8') as f:
                lrc_content = f.read()
                if lrc_content.strip() and re.search(r'\[\d{2}:\d{2}\.\d{2}\]', lrc_content):
                    return {"lrc": lrc_content, "lrc_english": get_romanized_lrc(lrc_content)}
                else:
                    return {"lrc": None, "lrc_english": None}
                
        # Scrape lyrics
        query = f"{title} {artist}"
        try:
            # Prioritize Musixmatch and fallback to others
            lrc = syncedlyrics.search(query, providers=["Musixmatch", "NetEase", "Megalobiz", "Lrclib"])
            if lrc and re.search(r'\[\d{2}:\d{2}\.\d{2}\]', lrc):
                with open(lrc_path, 'w', encoding='utf-8') as f:
                    f.write(lrc)
                return {"lrc": lrc, "lrc_english": get_romanized_lrc(lrc)}
            else:
                # Cache negative result so we don't spam the API on subsequent searches
                with open(lrc_path, 'w', encoding='utf-8') as f:
                    f.write("")
        except Exception as e:
            print("Error fetching lyrics:", e)
            
        return {"lrc": None, "lrc_english": None}

def download_audio(video_id: str, title: str = "", artist: str = "") -> str:
    """Downloads audio via yt-dlp and returns path to wav file."""
    output_path = os.path.join(TEMP_DIR, f"{video_id}.wav")
    
    if os.path.exists(output_path):
        return output_path
        
    def cleanup_partial_files():
        for ext in ['.webm', '.m4a', '.mp3', '.part', '.ytdl']:
            fpath = os.path.join(TEMP_DIR, f"{video_id}{ext}")
            if os.path.exists(fpath):
                try: os.remove(fpath)
                except: pass

    cleanup_partial_files()
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(TEMP_DIR, f'{video_id}.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
            'preferredquality': '192',
        }],
        'quiet': True
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            ydl.download([f'https://www.youtube.com/watch?v={video_id}'])
        except Exception as e:
            print(f"DEBUG: download_audio caught {type(e).__name__}: {e}")
            print(f"DEBUG: title='{title}', artist='{artist}'")
            if title or artist:
                print(f"Failed to download primary video_id {video_id}, falling back to search for: {title} {artist}")
                cleanup_partial_files()
                try:
                    ydl.download([f'ytsearch1:{title} {artist} audio'])
                except Exception as e2:
                    raise Exception(f"Fallback search also failed: {e2}")
            else:
                raise e
        
    return output_path

# Global locks to prevent React Strict Mode double-fetches from corrupting yt-dlp downloads
download_locks = defaultdict(threading.Lock)
separation_locks = defaultdict(threading.Lock)
active_separations = set()

@app.post("/api/prepare/{video_id}")
def prepare_audio(video_id: str, background_tasks: BackgroundTasks, title: str = "", artist: str = "", mode: str = "karaoke"):
    """
    Downloads the original audio. If not already separated, starts background separation.
    Returns the URL for the original audio immediately so playback can begin.
    """
    try:
        with download_locks[video_id]:
            # 1. Download original audio synchronously (usually takes 1-3 seconds)
            original_path = download_audio(video_id, title, artist)
            
            # 2. Check if already chunking or done
            if mode != "listen":
                chunks_dir = os.path.join(TEMP_DIR, video_id)
                os.makedirs(chunks_dir, exist_ok=True)
                
                with separation_locks[video_id]:
                    if video_id not in active_separations:
                        active_separations.add(video_id)
                        
                        def separation_task():
                            try:
                                run_chunked_separation(original_path, TEMP_DIR, video_id)
                            finally:
                                if video_id in active_separations:
                                    active_separations.remove(video_id)
                                    
                        background_tasks.add_task(separation_task)
            
        return {
            "originalUrl": f"/api/audio/{video_id}.wav",
            "chunksUrl": f"/api/chunks/{video_id}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/seek/{video_id}")
def seek_audio(video_id: str, time: float):
    """
    Updates the target priority for the background separation task.
    """
    set_priority_target(video_id, int(time * 1000))
    return {"status": "ok"}

@app.post("/api/cancel/{video_id}")
def cancel_audio(video_id: str):
    from separator import cancel_separation
    cancel_separation(video_id)
    return {"status": "cancelled"}

@app.get("/api/chunks/{video_id}")
def get_chunks(video_id: str):
    update_activity(video_id)
    chunks_dir = os.path.join(TEMP_DIR, video_id)
    if not os.path.exists(chunks_dir):
        return {"chunks": [], "done": False}
        
    chunks = []
    
    import glob
    marker_files = glob.glob(os.path.join(chunks_dir, "chunk_*.ready"))
    
    for marker in marker_files:
        try:
            # Extract chunk_idx from filename
            filename = os.path.basename(marker)
            chunk_idx = int(filename.split('_')[1].split('.')[0])
            
            with open(marker, 'r') as f:
                content = f.read().strip()
                if not content:
                    continue
                start, end = map(int, content.split(','))
                
            chunks.append({
                "index": chunk_idx,
                "start": start / 1000.0,
                "end": end / 1000.0,
                "instrumentalUrl": f"/api/audio/{video_id}/chunk_{chunk_idx}_instrumental.wav",
                "vocalsUrl": f"/api/audio/{video_id}/chunk_{chunk_idx}_vocals.wav"
            })
        except Exception as e:
            print(f"Error reading chunk marker {marker}: {e}")
            continue
            
    # Sort chunks by index just for consistency
    chunks.sort(key=lambda x: x["index"])
            
    done = os.path.exists(os.path.join(chunks_dir, "done.txt"))
    return {"chunks": chunks, "done": done}

@app.get("/api/audio/{filename}")
def get_original_audio(filename: str):
    file_path = os.path.join(TEMP_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

@app.get("/api/audio/{video_id}/{filename}")
def get_chunk_audio(video_id: str, filename: str):
    file_path = os.path.join(TEMP_DIR, video_id, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
