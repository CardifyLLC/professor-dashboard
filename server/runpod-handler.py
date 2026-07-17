import base64
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image, ImageOps, ImageStat
import runpod


REAL_ESRGAN_BIN = os.environ.get("REAL_ESRGAN_BIN", "/opt/realesrgan-runtime/realesrgan-ncnn-vulkan")
REAL_ESRGAN_CWD = os.environ.get("REAL_ESRGAN_CWD", "/opt/realesrgan-runtime")
REAL_ESRGAN_MODEL = os.environ.get("REAL_ESRGAN_MODEL", "realesrgan-x4plus")
REAL_ESRGAN_SCALE = os.environ.get("REAL_ESRGAN_SCALE", "4")
REAL_ESRGAN_TARGET_SCALE = os.environ.get("REAL_ESRGAN_TARGET_SCALE", "2")
REAL_ESRGAN_GPU_ID = os.environ.get("REAL_ESRGAN_GPU_ID", "")
REAL_ESRGAN_TILE_SIZE = os.environ.get(
    "REAL_ESRGAN_TILE_SIZE",
    os.environ.get("REAL_ESRGAN_TITLE_SIZE", "256"),
)
REAL_ESRGAN_OUTPUT_FORMAT = os.environ.get("REAL_ESRGAN_OUTPUT_FORMAT", "png").lower()
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("REQUEST_TIMEOUT_SECONDS", "600"))
DIAGNOSTIC_COMMAND_TIMEOUT_SECONDS = int(os.environ.get("DIAGNOSTIC_COMMAND_TIMEOUT_SECONDS", "15"))
RUN_STARTUP_DIAGNOSTICS = os.environ.get("RUN_STARTUP_DIAGNOSTICS", "1") == "1"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "order-images")
SUPABASE_OUTPUT_PREFIX = os.environ.get("SUPABASE_OUTPUT_PREFIX", "upscaled")
BLACK_FRAME_MEAN_THRESHOLD = float(os.environ.get("BLACK_FRAME_MEAN_THRESHOLD", "1.0"))

if REAL_ESRGAN_OUTPUT_FORMAT == "jpeg":
    REAL_ESRGAN_OUTPUT_FORMAT = "jpg"
if REAL_ESRGAN_OUTPUT_FORMAT not in {"jpg", "png", "webp"}:
    REAL_ESRGAN_OUTPUT_FORMAT = "jpg"


def log(message):
    print(f"[upscale-worker] {message}", flush=True)


def run_diagnostic_command(command):
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=DIAGNOSTIC_COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
        output = (result.stdout or result.stderr or "").strip()
        if len(output) > 2000:
            output = output[:2000] + "\n...<truncated>"
        log(f"{' '.join(command)} exited {result.returncode}: {output or '<no output>'}")
    except Exception as error:
        log(f"{' '.join(command)} failed: {error}")


def log_startup_diagnostics():
    log(
        "config "
        f"model={REAL_ESRGAN_MODEL} "
        f"inference_scale={REAL_ESRGAN_SCALE} "
        f"target_scale={REAL_ESRGAN_TARGET_SCALE} "
        f"tile={REAL_ESRGAN_TILE_SIZE} "
        f"gpu_id={REAL_ESRGAN_GPU_ID or '<auto>'} "
        f"format={REAL_ESRGAN_OUTPUT_FORMAT} "
        f"bin={REAL_ESRGAN_BIN} "
        f"cwd={REAL_ESRGAN_CWD}"
    )
    log(f"binary_exists={os.path.exists(REAL_ESRGAN_BIN)}")
    if RUN_STARTUP_DIAGNOSTICS:
        run_diagnostic_command(["nvidia-smi"])
        run_diagnostic_command(["vulkaninfo", "--summary"])


def sanitize_path_part(value):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip())
    cleaned = cleaned.strip("-")[:80]
    return cleaned or str(uuid.uuid4())


def extension_from_content_type(content_type):
    value = (content_type or "").lower()
    if "jpeg" in value or "jpg" in value:
        return "jpg"
    if "webp" in value:
        return "webp"
    return "png"


def content_type_from_extension(extension):
    value = (extension or "").lower()
    if value in {"jpg", "jpeg"}:
        return "image/jpeg"
    if value == "webp":
        return "image/webp"
    return "image/png"


def load_image(image_url):
    if not isinstance(image_url, str) or not image_url.strip():
        raise ValueError("imageUrl is required.")

    if image_url.startswith("data:image/"):
        header, payload = image_url.split(",", 1)
        content_type = header.split(";")[0].replace("data:", "") or "image/png"
        return base64.b64decode(payload), extension_from_content_type(content_type)

    if not re.match(r"^https?://", image_url, re.I):
        raise ValueError("imageUrl must be an HTTP URL or data image.")

    request = urllib.request.Request(image_url, headers={"User-Agent": "tcgplaytest-upscaler/1.0"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get("content-type") or "image/png"
        return response.read(), extension_from_content_type(content_type)


def normalize_input_image(image_bytes, output_path):
    with Image.open(io.BytesIO(image_bytes)) as image:
        image = ImageOps.exif_transpose(image)
        original_mode = image.mode
        original_size = image.size

        if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            background.alpha_composite(rgba)
            normalized = background.convert("RGB")
        else:
            normalized = image.convert("RGB")

        normalized.save(output_path, format="PNG")
        log(f"normalized input mode={original_mode}->RGB size={original_size}->{normalized.size}")


def numeric_scale(value, fallback):
    try:
        parsed = float(value)
        return parsed if parsed > 0 else fallback
    except (TypeError, ValueError):
        return fallback


def save_image(image, output_path):
    extension = os.path.splitext(output_path)[1].lstrip(".").lower()
    if extension in {"jpg", "jpeg"}:
        image.convert("RGB").save(output_path, format="JPEG", quality=95)
    elif extension == "webp":
        image.save(output_path, format="WEBP", quality=95)
    else:
        image.save(output_path, format="PNG")


def downscale_output_image(input_path, output_path):
    inference_scale = numeric_scale(REAL_ESRGAN_SCALE, 4.0)
    target_scale = numeric_scale(REAL_ESRGAN_TARGET_SCALE, inference_scale)

    with Image.open(input_path) as image:
        image = ImageOps.exif_transpose(image)
        if target_scale >= inference_scale:
            save_image(image, output_path)
            return

        ratio = target_scale / inference_scale
        width = max(1, round(image.width * ratio))
        height = max(1, round(image.height * ratio))
        resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        resized = image.resize((width, height), resampling)
        save_image(resized, output_path)


def validate_output_image(image_path):
    with Image.open(image_path) as image:
        rgb = image.convert("RGB")
        extrema = rgb.getextrema()
        mean = ImageStat.Stat(rgb).mean
        max_channel = max(channel_max for _channel_min, channel_max in extrema)
        mean_luma = sum(mean) / len(mean)

    log(f"output stats path={image_path} extrema={extrema} mean={mean} mean_luma={mean_luma:.4f}")

    if max_channel == 0 or mean_luma <= BLACK_FRAME_MEAN_THRESHOLD:
        raise RuntimeError(
            "Real-ESRGAN produced a black/empty output image. "
            "This points to a model/runtime/GPU/Vulkan issue; try the bundled model, "
            "verify nvidia-smi/vulkaninfo in the container, lower tile size, or use another GPU id."
        )


def run_realesrgan(input_path, output_path):
    command = [
        REAL_ESRGAN_BIN,
        "-i",
        input_path,
        "-o",
        output_path,
        "-n",
        REAL_ESRGAN_MODEL,
        "-s",
        REAL_ESRGAN_SCALE,
    ]
    if REAL_ESRGAN_TILE_SIZE and REAL_ESRGAN_TILE_SIZE != "0":
        command.extend(["-t", REAL_ESRGAN_TILE_SIZE])
    if REAL_ESRGAN_GPU_ID:
        command.extend(["-g", REAL_ESRGAN_GPU_ID])
    command.extend(["-f", REAL_ESRGAN_OUTPUT_FORMAT])
    log(f"running command: {' '.join(command)}")

    result = subprocess.run(
        command,
        cwd=REAL_ESRGAN_CWD or None,
        capture_output=True,
        text=True,
        timeout=REQUEST_TIMEOUT_SECONDS,
        check=False,
    )
    if result.stdout.strip():
        log(f"realesrgan stdout: {result.stdout.strip()}")
    if result.stderr.strip():
        log(f"realesrgan stderr: {result.stderr.strip()}")
    log(f"realesrgan exit_code={result.returncode} output_exists={os.path.exists(output_path)}")
    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(result.stderr.strip() or f"Real-ESRGAN exited with code {result.returncode}.")


def upload_to_supabase(image_bytes, request_id, output_extension):
    content_type = content_type_from_extension(output_extension)
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return {
            "imageUrl": f"data:{content_type};base64," + base64.b64encode(image_bytes).decode("ascii"),
            "storagePath": None,
        }

    output_path = (
        f"{SUPABASE_OUTPUT_PREFIX}/"
        f"{sanitize_path_part(request_id)}-{int(time.time() * 1000)}.{output_extension}"
    )
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{output_path}"
    request = urllib.request.Request(
        upload_url,
        data=image_bytes,
        method="POST",
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response.read()
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(message or f"Supabase upload failed with HTTP {error.code}.")

    return {
        "imageUrl": f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{output_path}",
        "storagePath": output_path,
    }


def upscale_image(image_url, request_id):
    work_dir = tempfile.mkdtemp(prefix="realesrgan-")
    try:
        image_bytes, _extension = load_image(image_url)
        log(f"job request_id={request_id or '<none>'} input_bytes={len(image_bytes)} work_dir={work_dir}")
        input_path = os.path.join(work_dir, "input.png")
        raw_output_path = os.path.join(work_dir, f"raw-output.{REAL_ESRGAN_OUTPUT_FORMAT}")
        output_path = os.path.join(work_dir, f"output.{REAL_ESRGAN_OUTPUT_FORMAT}")

        normalize_input_image(image_bytes, input_path)

        run_realesrgan(input_path, raw_output_path)
        downscale_output_image(raw_output_path, output_path)
        validate_output_image(output_path)

        with open(output_path, "rb") as file:
            output_bytes = file.read()

        uploaded = upload_to_supabase(
            output_bytes,
            request_id or str(uuid.uuid4()),
            REAL_ESRGAN_OUTPUT_FORMAT,
        )
        return {
            **uploaded,
            "contentType": content_type_from_extension(REAL_ESRGAN_OUTPUT_FORMAT),
            "model": REAL_ESRGAN_MODEL,
            "scale": int(numeric_scale(REAL_ESRGAN_TARGET_SCALE, numeric_scale(REAL_ESRGAN_SCALE, 4.0))),
            "inferenceScale": int(numeric_scale(REAL_ESRGAN_SCALE, 4.0)),
            "tileSize": int(REAL_ESRGAN_TILE_SIZE or "0"),
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def handler(job):
    job_input = job.get("input") or {}
    image_url = job_input.get("imageUrl")
    request_id = job_input.get("requestId") or job.get("id")
    try:
        return upscale_image(image_url, request_id)
    except Exception as error:
        log(f"job failed request_id={request_id or '<none>'}: {error}")
        raise


log_startup_diagnostics()
runpod.serverless.start({"handler": handler})
