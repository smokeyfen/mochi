import express from 'express';
import path from 'node:path';

import type { EvidenceInputV2, EvidencePackageV2 } from './src/v2/contracts';
import { validateEvidenceInputV2 } from './src/v2/evidence';
import { analyzeEvidenceV2 } from './server/v2/evidence';
import { planScenesV2 } from './server/v2/director';

const app = express();
const port = Number(process.env.PORT) || 3000;

function isEvidenceInputBody(value: unknown): value is EvidenceInputV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const input = value as Record<string, unknown>;

  if (
    typeof input.productName !== 'string' ||
    typeof input.productDetails !== 'string' ||
    typeof input.category !== 'string' ||
    (input.voiceGender !== 'FEMALE' && input.voiceGender !== 'MALE') ||
    !Array.isArray(input.references)
  ) {
    return false;
  }

  return input.references.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    const reference = item as Record<string, unknown>;
    const slot = reference.slot;

    return (
      typeof slot === 'number' &&
      Number.isInteger(slot) &&
      slot >= 1 &&
      slot <= 5 &&
      typeof reference.mimeType === 'string' &&
      typeof reference.dataBase64 === 'string'
    );
  });
}


function isEvidencePackageBody(value: unknown): value is EvidencePackageV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const evidence = value as Record<string, unknown>;
  if (
    evidence.contractVersion !== 1 ||
    typeof evidence.sourceFingerprint !== 'string' ||
    (evidence.voiceGender !== 'FEMALE' && evidence.voiceGender !== 'MALE') ||
    !evidence.product ||
    typeof evidence.product !== 'object' ||
    Array.isArray(evidence.product) ||
    !Array.isArray(evidence.references) ||
    !Array.isArray(evidence.facts)
  ) {
    return false;
  }

  const product = evidence.product as Record<string, unknown>;
  if (
    typeof product.productName !== 'string' ||
    typeof product.category !== 'string' ||
    typeof product.summary !== 'string' ||
    typeof product.environmentAnchor !== 'string'
  ) {
    return false;
  }

  const referencesValid = evidence.references.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const reference = item as Record<string, unknown>;
    return (
      typeof reference.referenceId === 'string' &&
      typeof reference.slot === 'number' &&
      typeof reference.role === 'string' &&
      (reference.variantKey === null || typeof reference.variantKey === 'string') &&
      typeof reference.summary === 'string'
    );
  });

  const factsValid = evidence.facts.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const fact = item as Record<string, unknown>;
    return (
      typeof fact.factId === 'string' &&
      typeof fact.text === 'string' &&
      typeof fact.confidence === 'string' &&
      typeof fact.mode === 'string' &&
      Array.isArray(fact.supportingReferenceIds) &&
      fact.supportingReferenceIds.every((id) => typeof id === 'string') &&
      Array.isArray(fact.compatibleReferenceIds) &&
      fact.compatibleReferenceIds.every((id) => typeof id === 'string')
    );
  });

  return referencesValid && factsValid;
}

app.use(express.json({ limit: '50mb' }));

app.post('/api/v2/evidence/analyze', async (request, response) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    response.status(503).json({
      code: 'GEMINI_API_KEY_MISSING',
      message: 'GEMINI_API_KEY is not configured on the server.',
    });
    return;
  }

  if (!isEvidenceInputBody(request.body)) {
    response.status(400).json({
      code: 'EVIDENCE_INPUT_INVALID',
      message: 'Evidence input shape is invalid.',
    });
    return;
  }

  const issues = validateEvidenceInputV2(request.body);
  if (issues.length > 0) {
    response.status(400).json({
      code: 'EVIDENCE_INPUT_INVALID',
      message: 'Evidence input is invalid.',
      issues,
    });
    return;
  }

  try {
    const evidence = await analyzeEvidenceV2(apiKey, request.body);
    response.json({ evidence });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown evidence analysis failure.';

    if (error instanceof Error && error.name === 'AbortError') {
      response.status(504).json({
        code: 'EVIDENCE_ANALYSIS_TIMEOUT',
        message: 'Gemini evidence analysis timed out.',
      });
      return;
    }

    const statusMatch = /^Gemini API (\d{3}):/.exec(message);
    if (statusMatch?.[1] === '429') {
      response.status(429).json({
        code: 'GEMINI_RATE_LIMITED',
        message,
      });
      return;
    }

    console.error('[MOCHI V2 E1]', message);
    response.status(502).json({
      code: 'EVIDENCE_ANALYSIS_FAILED',
      message,
    });
  }
});


app.post('/api/v2/director/plan', async (request, response) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    response.status(503).json({
      code: 'GEMINI_API_KEY_MISSING',
      message: 'GEMINI_API_KEY is not configured on the server.',
    });
    return;
  }

  const body = request.body as Record<string, unknown> | null;
  const evidence = body && typeof body === 'object' ? body.evidence : undefined;

  if (!isEvidencePackageBody(evidence)) {
    response.status(400).json({
      code: 'DIRECTOR_INPUT_INVALID',
      message: 'Evidence package is invalid.',
    });
    return;
  }

  try {
    const scenePlan = await planScenesV2(apiKey, evidence);
    response.json({ scenePlan });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown scene planning failure.';

    if (error instanceof Error && error.name === 'AbortError') {
      response.status(504).json({
        code: 'DIRECTOR_TIMEOUT',
        message: 'Gemini scene planning timed out.',
      });
      return;
    }

    const statusMatch = /^Gemini API (\d{3}):/.exec(message);
    if (statusMatch?.[1] === '429') {
      response.status(429).json({
        code: 'GEMINI_RATE_LIMITED',
        message,
      });
      return;
    }

    console.error('[MOCHI V2 E2]', message);
    response.status(502).json({
      code: 'DIRECTOR_FAILED',
      message,
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');

    app.use(express.static(distPath));
    app.use((_request, response) => {
      response.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      appType: 'spa',
      server: { middlewareMode: true },
    });

    app.use(vite.middlewares);
  }

  app.listen(port, () => {
    console.log(`MOCHI PROMPT V2 listening on http://localhost:${port}`);
  });
}

void startServer();
