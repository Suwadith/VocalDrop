import os
import asyncio
import threading
import re
import warnings
from tamil_translite import translite
from collections import defaultdict
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uuid
from pydantic import BaseModel
from ytmusicapi import YTMusic
import yt_dlp
import syncedlyrics
from separator import run_chunked_separation, set_priority_target, update_activity
import uroman as ur
from fastapi.exceptions import RequestValidationError
from fastapi import Request
from fastapi.responses import JSONResponse

# Initialize the Universal Romanizer once
uroman_client = ur.Uroman()

app = FastAPI()

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"Validation error: {exc}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

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

@app.post("/api/mix")
async def mix_recording(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    video_id: str = Form(...),
    start_time: float = Form(...),
    mic_volume: float = Form(...),
    reverb: float = Form(...)
):
    try:
        from pydub import AudioSegment
        import subprocess

        chunks_dir = os.path.join(TEMP_DIR, video_id)
        stitched_inst = None
        
        # Stitch separated chunks if they exist
        if os.path.exists(chunks_dir):
            i = 0
            while True:
                f = os.path.join(chunks_dir, f"chunk_{i}_instrumental.wav")
                if not os.path.exists(f):
                    break
                chunk_audio = AudioSegment.from_file(f)
                if stitched_inst is None:
                    stitched_inst = chunk_audio
                else:
                    stitched_inst = stitched_inst.append(chunk_audio, crossfade=1000)
                i += 1
                
        # If no chunks, fallback to original full audio
        if stitched_inst is None:
            original_audio = os.path.join(TEMP_DIR, f"{video_id}.wav")
            if os.path.exists(original_audio):
                stitched_inst = AudioSegment.from_file(original_audio)
            else:
                raise HTTPException(500, "Audio not found")
        
        # Calculate offset
        # Compensate for Web Audio API MediaRecorder processing delay (~40ms)
        WEB_AUDIO_LATENCY_MS = 40
        inst_start_ms = int(start_time * 1000) - WEB_AUDIO_LATENCY_MS
        
        if inst_start_ms >= 0:
            sliced_inst = stitched_inst[inst_start_ms:]
        else:
            silence = AudioSegment.silent(duration=-inst_start_ms)
            sliced_inst = silence + stitched_inst
            
        unique_id = uuid.uuid4().hex
        inst_path = os.path.join(TEMP_DIR, f"inst_{unique_id}.wav")
        
        ext = ".webm" if "webm" in file.filename else ".mp4"
        vocal_path = os.path.join(TEMP_DIR, f"vocal_{unique_id}{ext}")
        out_path = os.path.join(TEMP_DIR, f"mixed_{unique_id}{ext}")
        
        clean_vocal_path = os.path.join(TEMP_DIR, f"clean_vocal_{unique_id}.wav")
        mixed_audio_path = os.path.join(TEMP_DIR, f"mixed_audio_{unique_id}.wav")
        
        def cleanup():
            for p in [inst_path, vocal_path, out_path, clean_vocal_path, mixed_audio_path]:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except:
                        pass
                        
        # background_tasks.add_task(cleanup)

        sliced_inst.export(inst_path, format="wav")
        
        with open(vocal_path, "wb") as f:
            f.write(await file.read())
            
        # 1. Process vocal with FFmpeg to apply volume and reverb, ensuring we extract pure synced audio
        vocal_filter = f"volume={mic_volume}"
        if reverb > 0:
            decay = 0.4 * reverb
            vocal_filter += f",aecho=1.0:1.0:60:{decay}"
            
        subprocess.run([
            "ffmpeg", "-y", 
            "-i", vocal_path,
            "-af", vocal_filter,
            clean_vocal_path
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # 2. Load processed vocal and instrumental into pydub
        processed_vocal = AudioSegment.from_file(clean_vocal_path)
        
        # Lower instrumental volume slightly so vocals stand out
        sliced_inst = sliced_inst - 4.4
        
        # 3. Overlay them perfectly
        mixed_audio = processed_vocal.overlay(sliced_inst)
        
        mixed_audio.export(mixed_audio_path, format="wav")
        
        out_path = os.path.join(TEMP_DIR, f"mixed_{unique_id}.mp4")
        
        # 4. Mux the mixed audio back with the original video, transcoded to mp4 for universal support
        cmd = [
            "ffmpeg", "-y",
            "-i", vocal_path,
            "-i", mixed_audio_path,
            "-filter_complex", "[0:v]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2[v_out]",
            "-map", "[v_out]",
            "-map", "1:a",
            "-c:v", "libx264",
            "-preset", "fast",
            "-profile:v", "main",
            "-r", "30",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "320k",
            "-movflags", "+faststart",
            out_path
        ]
        
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        return FileResponse(out_path, media_type="video/mp4")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
