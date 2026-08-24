#!/bin/bash
# Generate one Kimodo SMPL-X clip and convert it to the SmplxClip JSON that
# src/game/retarget.ts reads. Needs HF_TOKEN with access to BOTH gated repos:
#   https://huggingface.co/nvidia/Kimodo-SMPLX-RP-v1        (auto-approve)
#   https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct (manual form)
set -e
: "${HF_TOKEN:?set HF_TOKEN first}"
NAME="${1:-straight-punch}"
PROMPT="${2:-a martial artist throws a straight right punch}"
DUR="${3:-3}"
cd ~/kimodo-work/kimodo
# TEXT_ENCODER_DEVICE=cpu keeps the 8B LLM2Vec encoder off the 12 GB card;
# NVIDIA quote <3 GB VRAM for the diffusion model alone.
TEXT_ENCODER_DEVICE=cpu ./.venv/bin/kimodo_gen "$PROMPT" \
  --model kimodo-smplx-rp --duration "$DUR" --seed 0 \
  --no-postprocess \
  --output "$HOME/kimodo-work/out/$NAME.npz"
./.venv/bin/python ~/kimodo-work/npz_to_smplxclip.py \
  "$HOME/kimodo-work/out/$NAME.npz" -o "$HOME/kimodo-work/out/$NAME.json" \
  --name "$NAME" --fps 30
