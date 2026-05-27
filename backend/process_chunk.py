import sys
import os
import logging
from pydub import AudioSegment
from audio_separator.separator import Separator

# Suppress audio-separator logs to keep console clean
logging.getLogger("audio_separator").setLevel(logging.ERROR)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    
    separator = Separator(output_dir=output_dir, output_format='wav')
    separator.load_model(model_filename='UVR-MDX-NET-Inst_full_292.onnx')
    primary_stem, secondary_stem = separator.separate(input_file)
    
    with open(input_file + ".result", "w") as f:
        f.write(f"{primary_stem}\n{secondary_stem}")
