#!/usr/bin/env python3
"""Sintetiza português brasileiro com XTTS v2 e uma voz de referência autorizada."""
import os
import sys

from TTS.api import TTS


if len(sys.argv) not in (3, 4):
    raise SystemExit("uso: xtts_tts.py REFERENCIA.mp3 SAIDA.wav [TEXTO]")

reference, output = sys.argv[1:3]
text = (sys.argv[3] if len(sys.argv) == 4 else sys.stdin.read()).strip()
if not text:
    raise SystemExit("texto vazio")
if not os.path.isfile(reference):
    raise SystemExit("referência de voz não encontrada")

tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False, gpu=False)
tts.tts_to_file(
    text=text,
    speaker_wav=reference,
    language="pt",
    file_path=output,
    split_sentences=True,
)
