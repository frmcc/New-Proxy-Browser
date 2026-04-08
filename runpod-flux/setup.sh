#!/bin/bash
# ============================================================
# FLUX.1 Setup Script for RunPod ComfyUI Template
# Run this inside the RunPod pod terminal after first boot.
# ============================================================

set -e

COMFY_ROOT="/workspace/ComfyUI"
MODELS_DIR="$COMFY_ROOT/models"

echo "==> Verifying ComfyUI installation..."
if [ ! -d "$COMFY_ROOT" ]; then
  echo "ERROR: ComfyUI not found at $COMFY_ROOT"
  echo "Make sure you deployed with the RunPod ComfyUI template."
  exit 1
fi

# ── Directories ──────────────────────────────────────────────
echo "==> Creating model directories..."
mkdir -p "$MODELS_DIR/unet"
mkdir -p "$MODELS_DIR/vae"
mkdir -p "$MODELS_DIR/clip"
mkdir -p "$MODELS_DIR/loras"

# ── huggingface-cli check ────────────────────────────────────
if ! command -v huggingface-cli &> /dev/null; then
  echo "==> Installing huggingface_hub..."
  pip install -q huggingface_hub
fi

# ── HF Token (optional but required for FLUX.1 dev) ─────────
# FLUX.1 dev requires accepting the license on Hugging Face
# and passing your token here. Export it before running:
#   export HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx
if [ -z "$HF_TOKEN" ]; then
  echo ""
  echo "WARNING: HF_TOKEN is not set."
  echo "  FLUX.1 dev requires a Hugging Face token."
  echo "  1. Accept the license at https://huggingface.co/black-forest-labs/FLUX.1-dev"
  echo "  2. Create a token at https://huggingface.co/settings/tokens"
  echo "  3. Re-run:  HF_TOKEN=hf_xxx bash setup.sh"
  echo ""
  echo "  Alternatively, FLUX.1 schnell is open-weight (no token needed)."
  echo "  Re-run with:  MODEL=schnell bash setup.sh"
  echo ""
fi

MODEL="${MODEL:-dev}"
echo "==> Downloading FLUX.1-$MODEL model files (~25–30 GB total)..."

download_hf() {
  local repo="$1"
  local filename="$2"
  local dest="$3"

  if [ -f "$dest/$filename" ]; then
    echo "  [skip] $filename already exists."
    return
  fi

  echo "  Downloading $filename..."
  huggingface-cli download \
    --repo-type model \
    ${HF_TOKEN:+--token "$HF_TOKEN"} \
    "$repo" "$filename" \
    --local-dir "$dest" \
    --local-dir-use-symlinks False
}

# ── Main FLUX.1 checkpoint ───────────────────────────────────
download_hf \
  "black-forest-labs/FLUX.1-$MODEL" \
  "flux1-$MODEL.safetensors" \
  "$MODELS_DIR/unet"

# ── VAE ──────────────────────────────────────────────────────
download_hf \
  "black-forest-labs/FLUX.1-$MODEL" \
  "ae.safetensors" \
  "$MODELS_DIR/vae"

# ── Text Encoders ────────────────────────────────────────────
# CLIP-L (small, ~250 MB)
download_hf \
  "comfyanonymous/flux_text_encoders" \
  "clip_l.safetensors" \
  "$MODELS_DIR/clip"

# T5-XXL FP8 (quantized, ~5 GB — fits in 24 GB VRAM alongside the model)
download_hf \
  "comfyanonymous/flux_text_encoders" \
  "t5xxl_fp8_e4m3fn.safetensors" \
  "$MODELS_DIR/clip"

echo ""
echo "==> All files downloaded. Placing workflow..."
cp "$(dirname "$0")/workflow_flux1.json" "$COMFY_ROOT/user/default/workflows/flux1_$MODEL.json" 2>/dev/null || true

echo ""
echo "======================================================"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Open ComfyUI: Connect -> HTTP Service [Port 8188]"
echo "  2. Load workflow: flux1_$MODEL.json"
echo "  3. Hit 'Queue Prompt' to generate your first image."
echo ""
echo "  STOP THE POD when done to avoid unnecessary charges."
echo "======================================================"
