"""Assemble an explicitly narrated presentation from real run screenshots, plus raw run clips."""
from pathlib import Path
import subprocess
import json

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artifacts'
OUT = ART / 'presentation'
OUT.mkdir(exist_ok=True)
SCENES = json.loads((ROOT / 'docs/NARRATION.fa.json').read_text())
IMAGES = ['live-before-dashboard.png', 'live-request-before.png', 'scene-evidence.png', 'scene-diff.png', 'scene-approval.png', 'scene-report.png', 'scene-recovered.png']

def run(args):
    subprocess.run(args, check=True)

def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]))

durations = [duration(ART / 'narration' / f'{i:02}.mp3') for i in range(len(SCENES))]
tempo = sum(durations) / 300
assert .5 <= tempo <= 2
files = []
manifest = []
offset = 0
for i, (scene, image, seconds) in enumerate(zip(SCENES, IMAGES, durations)):
    target = seconds / tempo
    output = OUT / f'{i:02}.mp4'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '15', '-i', str(ART / image), '-i', str(ART / 'narration' / f'{i:02}.mp3'), '-vf', 'scale=1440:-2,crop=1440:1000:0:0,setsar=1', '-af', f'atempo={tempo:.9f}', '-t', f'{target:.6f}', '-r', '15', '-c:v', 'libx264', '-preset', 'fast', '-tune', 'stillimage', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '24000', '-ac', '1', '-b:a', '64k', str(output)])
    files.append(output)
    manifest.append({'name': scene['name'], 'start': round(offset, 3), 'duration': round(target, 3), 'image': image, 'text': scene['text']})
    offset += target
    print(f'Presentation scene {i + 1} rendered.', flush=True)

listing = OUT / 'concat.txt'
listing.write_text(''.join(f"file '{p}'\n" for p in files))
run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(ART / 'DEMO.fa.mp4')])
(ART / 'presentation-manifest.json').write_text(json.dumps({'syntheticNarration': True, 'voice': 'fa-IR-DilaraNeural', 'images': 'Screenshots of the actual run; presentation, not continuous live footage', 'targetSeconds': 300, 'scenes': manifest}, ensure_ascii=False, indent=2))

raw = OUT / 'raw-concat.txt'
raw.write_text(''.join(f"file '{ART / p}'\n" for p in ['live-demo-silent.webm', 'live-recheck-silent.webm']))
run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(raw), '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', str(ART / 'LIVE-RUN.silent.mp4')])
print(json.dumps({'presentationSeconds': duration(ART / 'DEMO.fa.mp4'), 'rawRunSeconds': duration(ART / 'LIVE-RUN.silent.mp4')}), flush=True)
