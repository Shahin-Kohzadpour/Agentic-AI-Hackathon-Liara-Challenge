"""Optional demo production helper. Sends only the public Persian narration to TTS."""
import asyncio
import json
from pathlib import Path
import edge_tts
import sys

ROOT = Path(__file__).resolve().parent.parent
SCENES = json.loads((ROOT / 'docs/NARRATION.fa.json').read_text())
OUT = ROOT / 'artifacts/narration'
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    semaphore = asyncio.Semaphore(2)
    async def render(index, scene):
        async with semaphore:
            voice = edge_tts.Communicate(scene['text'], 'fa-IR-DilaraNeural', rate='-5%')
            await asyncio.wait_for(voice.save(str(OUT / f'{index:02}.mp3')), timeout=90)
            print(f'Narration scene {index + 1} ready.', flush=True)
    selected = [(int(sys.argv[1]), SCENES[int(sys.argv[1])])] if len(sys.argv) > 1 else list(enumerate(SCENES))
    await asyncio.gather(*(render(i, scene) for i, scene in selected))

asyncio.run(main())
