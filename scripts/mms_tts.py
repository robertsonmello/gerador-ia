#!/usr/bin/env python3
"""Sintetiza português com o modelo aberto facebook/mms-tts-por."""
import sys
from scipy.io import wavfile
from transformers import VitsModel, AutoTokenizer
import torch

if len(sys.argv) != 2:
    raise SystemExit("uso: mms_tts.py ARQUIVO.wav")

text = sys.stdin.read().strip()
if not text:
    raise SystemExit("texto vazio")

model_id = "facebook/mms-tts-por"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = VitsModel.from_pretrained(model_id)
inputs = tokenizer(text, return_tensors="pt")
with torch.no_grad():
    waveform = model(**inputs).waveform[0].cpu().float().numpy()
wavfile.write(sys.argv[1], model.config.sampling_rate, waveform)
