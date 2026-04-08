# RunPod FLUX.1 Setup Guide

## 1. Account & Credits
- Go to https://www.runpod.io and create an account
- Load **$10** in credits (enough for several hours of generation)

## 2. Deploy a Pod

1. Navigate to **Pods** → **Community Cloud**
2. Select a GPU:
   | GPU | VRAM | Est. Cost |
   |-----|------|-----------|
   | RTX 4090 | 24 GB | ~$0.34–0.58/hr |
   | RTX 5090 | 32 GB | ~$0.69–0.76/hr |
   | RTX A6000 | 48 GB | ~$0.75/hr |
3. Click the **Template** dropdown → search **RunPod ComfyUI** → select it
4. Set **Volume (persistent storage)** to **150 GB** minimum
5. Click **Deploy**

## 3. First Boot

Once the pod is running (~60 seconds), click **Connect → HTTP Service [Port 8188]** to open ComfyUI.

Then open the pod **Terminal** and run:

```bash
# For FLUX.1 dev (best quality, requires HF token):
export HF_TOKEN=hf_your_token_here
bash /workspace/setup.sh

# For FLUX.1 schnell (open-weight, no token needed, faster):
MODEL=schnell bash /workspace/setup.sh
```

### Getting a Hugging Face Token (for dev model)
1. Accept the license at https://huggingface.co/black-forest-labs/FLUX.1-dev
2. Create a read token at https://huggingface.co/settings/tokens
3. Pass it via `HF_TOKEN=hf_xxx` as shown above

## 4. Upload Setup Files

Copy `setup.sh` and `workflow_flux1.json` to your pod before running:

```bash
# From your local machine:
scp -P <pod_ssh_port> runpod-flux/setup.sh runpod-flux/workflow_flux1.json \
    root@<pod_ip>:/workspace/
```

Or paste the contents directly into the pod terminal via the RunPod web terminal.

## 5. Generate Images

1. In ComfyUI, click **Load** → select `workflow_flux1.json`
2. Edit the **Positive Prompt** node with your prompt
3. Click **Queue Prompt**

## 6. Cost Management (IMPORTANT)

- **Stop the pod** when done — you're billed per second while it runs
- Your downloaded models stay safe on the 150 GB persistent volume
- Restarting costs only storage (~$0.02/GB/month) between sessions
- **Terminate** the pod entirely if you won't return — storage fees then stop

## Model Files Downloaded

| File | Size | Destination |
|------|------|-------------|
| `flux1-dev.safetensors` | ~24 GB | `models/unet/` |
| `ae.safetensors` | ~335 MB | `models/vae/` |
| `clip_l.safetensors` | ~246 MB | `models/clip/` |
| `t5xxl_fp8_e4m3fn.safetensors` | ~5 GB | `models/clip/` |
