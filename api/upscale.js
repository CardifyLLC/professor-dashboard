const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || '';
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || '';
const UPSCALE_API_KEY = process.env.UPSCALE_API_KEY || '';

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function isAuthorized(request) {
  if (!UPSCALE_API_KEY) {
    return true;
  }

  return request.headers.authorization === `Bearer ${UPSCALE_API_KEY}`;
}

async function requestRunpod(path, options = {}) {
  const runpodResponse = await fetch(`https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      ...(options.headers || {}),
    },
  });
  const payload = await runpodResponse.json().catch(() => ({}));

  if (!runpodResponse.ok) {
    throw new Error(payload.error || payload.message || `RunPod request failed with HTTP ${runpodResponse.status}.`);
  }

  return payload;
}

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'Unauthorized.' });
    return;
  }

  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    sendJson(response, 500, { error: 'RunPod serverless env vars are not configured.' });
    return;
  }

  try {
    const body = await readJsonBody(request);

    if (body.jobId) {
      const status = await requestRunpod(`/status/${body.jobId}`, { method: 'GET' });

      if (status.status === 'COMPLETED') {
        sendJson(response, 200, status.output || status);
        return;
      }

      if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status.status)) {
        sendJson(response, 502, {
          error: `RunPod job ${status.status.toLowerCase()}.`,
          runpod: status,
        });
        return;
      }

      sendJson(response, 202, {
        jobId: body.jobId,
        status: status.status || 'IN_PROGRESS',
      });
      return;
    }

    const run = await requestRunpod('/run', {
      method: 'POST',
      body: JSON.stringify({
        input: {
          imageUrl: body.imageUrl,
          requestId: body.requestId,
        },
      }),
    });

    const runId = run.id;

    if (!runId) {
      sendJson(response, 500, { error: 'RunPod did not return a job id.', runpod: run });
      return;
    }

    sendJson(response, 202, {
      jobId: runId,
      status: run.status || 'IN_QUEUE',
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Upscale failed.',
    });
  }
}
