#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UV="$ROOT/.tools/uv/uv"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "GPU NVIDIA/CUDA não detectada. Instale o driver antes de preparar o Wan Animate." >&2
  exit 1
fi

"$UV" venv "$ROOT/.venv-wan" --python 3.11
"$UV" pip install --python "$ROOT/.venv-wan/bin/python" torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
"$UV" pip install --python "$ROOT/.venv-wan/bin/python" \
  'opencv-python>=4.9.0.80' 'diffusers>=0.31.0' 'transformers>=4.49.0,<=4.51.3' \
  'tokenizers>=0.20.3' 'accelerate>=1.1.1' tqdm 'imageio[ffmpeg]' easydict ftfy \
  dashscope imageio-ffmpeg 'numpy>=1.23.5,<2' huggingface-hub
"$UV" pip install --python "$ROOT/.venv-wan/bin/python" flash-attn --no-build-isolation

if [[ "${1:-}" == "--download" ]]; then
  "$ROOT/.venv-wan/bin/hf" download Wan-AI/Wan2.2-Animate-14B \
    --local-dir "$ROOT/models/Wan2.2-Animate-14B"
fi

echo "Wan Animate preparado. Use --download para baixar os pesos oficiais."
