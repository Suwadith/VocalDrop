import os
import sys
import time
import subprocess
from pydub import AudioSegment

CHUNK_LENGTH_MS = 10000 # 10 seconds
OVERLAP_MS = 1000       # 1 second overlap

# Global dictionary to store priorities
# priority_targets[video_id] = target_time_ms
priority_targets = {}
last_activity = {}

def update_activity(video_id: str):
    last_activity[video_id] = time.time()

def set_priority_target(video_id: str, target_time_ms: int):
    priority_targets[video_id] = target_time_ms
    update_activity(video_id)

def cancel_separation(video_id: str):
    priority_targets[video_id] = -1

def run_chunked_separation(input_file: str, output_dir: str, video_id: str):
    print(f"Starting chunked separation for {video_id}...")
    try:
        audio = AudioSegment.from_file(input_file)
        duration_ms = len(audio)
        
        chunks_dir = os.path.join(output_dir, video_id)
        os.makedirs(chunks_dir, exist_ok=True)
        
        # Pre-calculate chunk boundaries
        chunks_meta = []
        c_start = 0
        while c_start < duration_ms:
            c_end = min(c_start + CHUNK_LENGTH_MS, duration_ms)
            chunks_meta.append((c_start, c_end))
            c_start = c_end - OVERLAP_MS
            if c_start >= duration_ms - OVERLAP_MS:
                break
                
        total_chunks = len(chunks_meta)
        processed_chunks = set()
        
        # If any chunks were already completed from a previous aborted run, mark them
        for i in range(total_chunks):
            if os.path.exists(os.path.join(chunks_dir, f"chunk_{i}.ready")):
                processed_chunks.add(i)
                
        # We start with the default priority: 0 (the beginning)
        priority_targets[video_id] = 0
        
        update_activity(video_id)
        
        while len(processed_chunks) < total_chunks:
            target_ms = priority_targets.get(video_id, 0)
            
            if target_ms == -1:
                print(f"Separation for {video_id} cancelled explicitly.")
                break
                
            if time.time() - last_activity.get(video_id, time.time()) > 15.0:
                print(f"Separation for {video_id} auto-cancelled due to inactivity.")
                break
            
            # Find the chunk that covers the target_ms, or the closest one after it
            best_chunk_idx = -1
            
            # First, try to find a chunk that directly covers target_ms
            for i, (s, e) in enumerate(chunks_meta):
                if i not in processed_chunks and s <= target_ms < e:
                    best_chunk_idx = i
                    break
                    
            # If target_ms is completely handled, just find the next unprocessed chunk sequentially
            if best_chunk_idx == -1:
                # Find the first unprocessed chunk AFTER the target time
                for i, (s, e) in enumerate(chunks_meta):
                    if i not in processed_chunks and s >= target_ms:
                        best_chunk_idx = i
                        break
                        
            # If still not found (meaning everything after target is processed), just take the first available
            if best_chunk_idx == -1:
                for i in range(total_chunks):
                    if i not in processed_chunks:
                        best_chunk_idx = i
                        break
                        
            if best_chunk_idx == -1:
                break # Everything is processed!
                
            start, end = chunks_meta[best_chunk_idx]
            print(f"Processing chunk {best_chunk_idx} for {video_id} (Target: {target_ms}ms)")
            
            chunk_audio = audio[start:end]
            chunk_filename = f"{video_id}_raw_chunk_{best_chunk_idx}.wav"
            chunk_path = os.path.join(chunks_dir, chunk_filename)
            chunk_audio.export(chunk_path, format="wav")
            
            # Spawn isolated process for separation so we can kill it if needed
            script_path = os.path.join(os.path.dirname(__file__), "process_chunk.py")
            proc = subprocess.Popen([sys.executable, script_path, chunk_path, output_dir])
            
            aborted = False
            while proc.poll() is None:
                time.sleep(0.5)
                new_target_ms = priority_targets.get(video_id, 0)
                
                if new_target_ms == -1:
                    proc.terminate()
                    print(f"Separation for {video_id} cancelled mid-chunk.")
                    return
                    
                if time.time() - last_activity.get(video_id, time.time()) > 15.0:
                    proc.terminate()
                    print(f"Separation for {video_id} auto-cancelled mid-chunk due to inactivity.")
                    return
                    
                # If priority shifted outside this chunk's bounds, abort instantly!
                if new_target_ms != target_ms:
                    if not (start <= new_target_ms < end):
                        print(f"Priority changed from {target_ms} to {new_target_ms}. Aborting chunk {best_chunk_idx} instantly!")
                        proc.terminate()
                        aborted = True
                        break
                        
            if aborted:
                if os.path.exists(chunk_path): os.remove(chunk_path)
                continue # Re-evaluate the loop with the new priority target
                
            if proc.returncode == 0:
                result_file = chunk_path + ".result"
                if os.path.exists(result_file):
                    with open(result_file, 'r') as f:
                        lines = f.read().splitlines()
                        primary_stem = lines[0]
                        secondary_stem = lines[1]
                    os.remove(result_file)
                    
                    if os.path.exists(chunk_path):
                        os.remove(chunk_path)
                        
                    inst_name = primary_stem if "(Instrumental)" in primary_stem or "Instrumental" in primary_stem else secondary_stem
                    voc_name = secondary_stem if inst_name == primary_stem else primary_stem
                    
                    inst_path = os.path.join(output_dir, inst_name)
                    voc_path = os.path.join(output_dir, voc_name)
                    
                    final_inst = os.path.join(chunks_dir, f"chunk_{best_chunk_idx}_instrumental.wav")
                    final_voc = os.path.join(chunks_dir, f"chunk_{best_chunk_idx}_vocals.wav")
                    
                    if os.path.exists(final_inst): os.remove(final_inst)
                    if os.path.exists(final_voc): os.remove(final_voc)
                        
                    os.rename(inst_path, final_inst)
                    os.rename(voc_path, final_voc)
                    
                    marker_path = os.path.join(chunks_dir, f"chunk_{best_chunk_idx}.ready")
                    with open(marker_path, 'w') as f:
                        f.write(f"{start},{end}")
                        
                    print(f"Chunk {best_chunk_idx} ready ({start}ms - {end}ms)")
                    processed_chunks.add(best_chunk_idx)
            else:
                print(f"Process failed for chunk {best_chunk_idx} with return code {proc.returncode}")
                # We can choose to break or retry. Breaking is safer.
                break
            
        with open(os.path.join(chunks_dir, "done.txt"), 'w') as f:
            f.write("done")
            
    except Exception as e:
        print(f"Error during chunked separation for {video_id}: {e}")
