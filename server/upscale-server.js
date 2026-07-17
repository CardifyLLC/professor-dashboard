/* global process, Buffer */
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const REAL_ESRGAN_BIN = process.env.REAL_ESRGAN_BIN || 'realesrgan-ncnn-vulkan';
const REAL_ESRGAN_CWD = process.env.REAL_ESRGAN_CWD || '';
const REAL_ESRGAN_MODEL = process.env.REAL_ESRGAN_MODEL || 'realesrgan-x4plus';
const REAL_ESRGAN_SCALE = process.env.REAL_ESRGAN_SCALE || '4';
const REAL_ESRGAN_GPU_ID = process.env.REAL_ESRGAN_GPU_ID || '';
const REAL_ESRGAN_TILE_SIZE = process.env.REAL_ESRGAN_TILE_SIZE || process.env.REAL_ESRGAN_TITLE_SIZE || '256';
const REAL_ESRGAN_OUTPUT_FORMAT = (process.env.REAL_ESRGAN_OUTPUT_FORMAT || 'png').toLowerCase();
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 2 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10 * 60 * 1000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'order-images';
const SUPABASE_OUTPUT_PREFIX = process.env.SUPABASE_OUTPUT_PREFIX || 'upscaled';
const UPSCALE_API_KEY = process.env.UPSCALE_API_KEY || '';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  if (!UPSCALE_API_KEY) {
    return true;
  }

  const header = req.headers.authorization || '';
  return header === `Bearer ${UPSCALE_API_KEY}`;
}

function getExtensionFromContentType(contentType = '') {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}

function getMimeFromExtension(extension) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

function sanitizePathPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || crypto.randomUUID();
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function loadImageBuffer(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    throw new Error('imageUrl is required.');
  }

  if (imageUrl.startsWith('data:image/')) {
    const [header, payload] = imageUrl.split(',');
    const contentType = header.match(/^data:([^;]+);base64$/)?.[1] || 'image/png';
    return {
      buffer: Buffer.from(payload || '', 'base64'),
      extension: getExtensionFromContentType(contentType),
    };
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error('imageUrl must be an HTTP URL or data image.');
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    extension: getExtensionFromContentType(contentType),
  };
}

function runRealEsrgan(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-n', REAL_ESRGAN_MODEL,
      '-s', REAL_ESRGAN_SCALE,
    ];
    if (REAL_ESRGAN_TILE_SIZE && REAL_ESRGAN_TILE_SIZE !== '0') {
      args.push('-t', REAL_ESRGAN_TILE_SIZE);
    }
    if (REAL_ESRGAN_GPU_ID) {
      args.push('-g', REAL_ESRGAN_GPU_ID);
    }
    args.push('-f', REAL_ESRGAN_OUTPUT_FORMAT);

    const child = spawn(REAL_ESRGAN_BIN, args, {
      cwd: REAL_ESRGAN_CWD || (path.isAbsolute(REAL_ESRGAN_BIN) ? path.dirname(REAL_ESRGAN_BIN) : undefined),
      windowsHide: true,
      timeout: REQUEST_TIMEOUT_MS,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Real-ESRGAN exited with code ${code}.`));
    });
  });
}

async function uploadToSupabaseStorage(buffer, requestId, outputExtension) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const contentType = getMimeFromExtension(outputExtension);
  const cleanBaseUrl = SUPABASE_URL.replace(/\/$/, '');
  const outputPath = `${SUPABASE_OUTPUT_PREFIX}/${sanitizePathPart(requestId)}-${Date.now()}.${outputExtension}`;
  const uploadUrl = `${cleanBaseUrl}/storage/v1/object/${SUPABASE_BUCKET}/${outputPath}`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Supabase upload failed with HTTP ${response.status}.`);
  }

  return {
    imageUrl: `${cleanBaseUrl}/storage/v1/object/public/${SUPABASE_BUCKET}/${outputPath}`,
    storagePath: outputPath,
  };
}

async function upscaleImage({ imageUrl, requestId }) {
  const id = crypto.randomUUID();
  const workDir = path.join(tmpdir(), `realesrgan-${id}`);
  await mkdir(workDir, { recursive: true });

  try {
    const { buffer, extension } = await loadImageBuffer(imageUrl);
    const inputPath = path.join(workDir, `input.${extension}`);
    const outputExtension = REAL_ESRGAN_OUTPUT_FORMAT === 'jpeg' ? 'jpg' : REAL_ESRGAN_OUTPUT_FORMAT;
    const safeOutputExtension = ['jpg', 'png', 'webp'].includes(outputExtension) ? outputExtension : 'jpg';
    const outputPath = path.join(workDir, `output.${safeOutputExtension}`);

    await writeFile(inputPath, buffer);
    await runRealEsrgan(inputPath, outputPath);

    const output = await readFile(outputPath);
    const contentType = getMimeFromExtension(safeOutputExtension);
    const uploaded = await uploadToSupabaseStorage(output, requestId || id, safeOutputExtension);

    if (uploaded) {
      return {
        ...uploaded,
        contentType,
        model: REAL_ESRGAN_MODEL,
        scale: Number(REAL_ESRGAN_SCALE),
        tileSize: Number(REAL_ESRGAN_TILE_SIZE || 0),
      };
    }

    return {
      imageUrl: `data:${contentType};base64,${output.toString('base64')}`,
      contentType,
      model: REAL_ESRGAN_MODEL,
      scale: Number(REAL_ESRGAN_SCALE),
      tileSize: Number(REAL_ESRGAN_TILE_SIZE || 0),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      ok: true,
      binary: REAL_ESRGAN_BIN,
      model: REAL_ESRGAN_MODEL,
      scale: Number(REAL_ESRGAN_SCALE),
      tileSize: Number(REAL_ESRGAN_TILE_SIZE || 0),
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/upscale') {
    try {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: 'Unauthorized.' });
        return;
      }

      const body = await readJsonBody(req);
      const result = await upscaleImage({
        imageUrl: body.imageUrl,
        requestId: body.requestId,
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Upscale failed.',
      });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, () => {
  console.log(`Real-ESRGAN upscale API listening on http://localhost:${PORT}`);
});
