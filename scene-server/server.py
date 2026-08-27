"""
Scene server: keeps SDXL-Turbo warm and turns prompts into PNGs.

A deliberately tiny stdlib HTTP service (no web framework) that the Node
server calls for ambient "what you're hearing" artwork:

    GET  /health              -> {"ok": true, ...}
    POST /generate            -> {"image": "<base64 png>", "seconds": 1.9}
         {"prompt": "...", "width": 768, "height": 512, "steps": 2}

The pipeline loads once at startup (~7 GB download from Hugging Face on the
first run, then cached) and generations are serialized with a lock — one
image at a time is plenty for a card that refreshes every ~45 s.
"""

import base64
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8790
MODEL = "stabilityai/sdxl-turbo"

print(f"[scene-server] loading {MODEL} (first run downloads ~7 GB)…", flush=True)
load_started = time.time()

import torch  # noqa: E402
from diffusers import AutoencoderKL, AutoPipelineForText2Image  # noqa: E402

device = "mps" if torch.backends.mps.is_available() else "cpu"
# SDXL's stock VAE overflows in fp16 (NaNs -> solid black images, seen
# intermittently on MPS); this community VAE is the standard fix.
vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", dtype=torch.float16)
pipe = AutoPipelineForText2Image.from_pretrained(
    MODEL, dtype=torch.float16, variant="fp16", vae=vae
)
pipe.to(device)
# Trade a little speed for a smaller memory footprint: this box also runs
# whisper.cpp and an Ollama model.
pipe.enable_attention_slicing()

print(
    f"[scene-server] ready on http://{HOST}:{PORT} "
    f"(device={device}, loaded in {time.time() - load_started:.0f}s)",
    flush=True,
)

generate_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter than the default stderr spam
        pass

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "model": MODEL, "device": device})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/generate":
            self._json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            prompt = str(payload.get("prompt", "")).strip()
            width = int(payload.get("width", 768))
            height = int(payload.get("height", 512))
            steps = int(payload.get("steps", 2))
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "bad_request"})
            return
        if not prompt:
            self._json(400, {"error": "bad_request", "message": "prompt is required"})
            return

        started = time.time()
        with generate_lock:
            image = None
            for attempt in range(2):
                # guidance_scale must be 0 for the turbo distillation.
                image = pipe(
                    prompt=prompt,
                    num_inference_steps=max(1, min(steps, 8)),
                    guidance_scale=0.0,
                    width=max(256, min(width, 1024)) // 8 * 8,
                    height=max(256, min(height, 1024)) // 8 * 8,
                ).images[0]
                # Belt-and-braces against residual fp16 NaN blackouts: a real
                # scene never has a max luminance this low.
                if image.convert("L").getextrema()[1] >= 16:
                    break
                print(f"[scene-server] black frame on attempt {attempt + 1}, retrying", flush=True)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        self._json(
            200,
            {
                "image": base64.b64encode(buffer.getvalue()).decode(),
                "seconds": round(time.time() - started, 2),
            },
        )


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
