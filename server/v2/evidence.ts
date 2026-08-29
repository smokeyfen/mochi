import type {
  EvidenceInputV2,
  EvidencePackageV2,
  EvidenceSource,
  FactConfidence,
  FactMode,
  ProductFact,
  ReferenceProfile,
  ReferenceRole,
} from '../../src/v2/contracts';
import {
  createSourceFingerprint,
  referenceIdForSlot,
  validateEvidenceInputV2,
} from '../../src/v2/evidence';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_INTERACTIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

const REFERENCE_ROLES: readonly ReferenceRole[] = [
  'FAMILY_OVERVIEW',
  'SINGLE_VARIANT',
  'DETAIL_SUPPORT',
  'PACKAGING_CONTEXT',
  'OTHER',
];

const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  'USER_TEXT',
  'IMAGE_TEXT',
  'VISUAL_EVIDENCE',
  'REASONABLE_INFERENCE',
];

const FACT_CONFIDENCES: readonly FactConfidence[] = [
  'HIGH',
  'MEDIUM',
  'LOW',
];

const FACT_MODES: readonly FactMode[] = [
  'DEMONSTRATABLE',
  'PRESENTATIONAL',
];

interface GeminiProductProfileV2 {
  summary: string;
  shapeAndGeometry: string;
  colors: string[];
  materialAppearance: string;
  visibleMarkers: string[];
  environmentAnchor: string;
}

interface GeminiReferenceProfileV2 {
  referenceId: string;
  slot: number;
  role: ReferenceRole;
  variantKey: string | null;
  summary: string;
}

interface GeminiProductFactV2 {
  text: string;
  sources: EvidenceSource[];
  confidence: FactConfidence;
  mode: FactMode;
  inferenceBasis: string | null;
  supportingReferenceIds: string[];
  compatibleReferenceIds: string[];
}

interface GeminiEvidenceOutputV2 {
  product: GeminiProductProfileV2;
  references: GeminiReferenceProfileV2[];
  facts: GeminiProductFactV2[];
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    product: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        shapeAndGeometry: { type: 'string' },
        colors: { type: 'array', items: { type: 'string' } },
        materialAppearance: { type: 'string' },
        visibleMarkers: { type: 'array', items: { type: 'string' } },
        environmentAnchor: { type: 'string' },
      },
      required: [
        'summary',
        'shapeAndGeometry',
        'colors',
        'materialAppearance',
        'visibleMarkers',
        'environmentAnchor',
      ],
    },
    references: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          referenceId: { type: 'string' },
          slot: { type: 'integer' },
          role: { type: 'string', enum: REFERENCE_ROLES },
          variantKey: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          summary: { type: 'string' },
        },
        required: ['referenceId', 'slot', 'role', 'variantKey', 'summary'],
      },
    },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'string', enum: EVIDENCE_SOURCES },
          },
          confidence: { type: 'string', enum: FACT_CONFIDENCES },
          mode: { type: 'string', enum: FACT_MODES },
          inferenceBasis: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          supportingReferenceIds: {
            type: 'array',
            items: { type: 'string' },
          },
          compatibleReferenceIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'text',
          'sources',
          'confidence',
          'mode',
          'inferenceBasis',
          'supportingReferenceIds',
          'compatibleReferenceIds',
        ],
      },
    },
  },
  required: ['product', 'references', 'facts'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isEnumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function buildInstruction(input: EvidenceInputV2): string {
  const orderedReferences = [...input.references].sort(
    (left, right) => left.slot - right.slot,
  );

  return `You are MOCHI PROMPT V2 E1 — Product Evidence Engine.

GOAL
Convert the committed user text and reference images into a small, trustworthy evidence package for a four-scene product-review director.

AUTHORITATIVE USER INPUT
Product name: ${input.productName.trim()}
Category: ${input.category.trim()}
Product details:
${input.productDetails.trim()}

REFERENCE BINDINGS
${orderedReferences
    .map((reference) => `${referenceIdForSlot(reference.slot)} | fixed slot ${reference.slot}`)
    .join('\n')}

EVIDENCE SOURCES
- USER_TEXT: directly stated in Product details.
- IMAGE_TEXT: product-relevant text actually legible in a supplied image.
- VISUAL_EVIDENCE: stable physical or visual facts actually visible in a supplied image.
- REASONABLE_INFERENCE: a low-risk implication of grounded evidence. It must include a concise inferenceBasis.

GROUNDING RULES
- Never invent functionality, specifications, material composition, safety, performance, compatibility, included parts, or hidden behavior.
- Preserve claim strength. Do not turn "safe" into "absolutely safe", "moves" into "very fast", or any source claim into a stronger certainty/performance claim.
- Material appearance is not material composition. Visual appearance alone does not prove ABS, silicone, metal, food safety, child safety, durability, or similar invisible properties.
- Ignore watermarks, usernames, social handles, app UI, prices, timestamps, subtitles, and unrelated overlay text.
- If explicit evidence materially conflicts, omit the disputed claim from facts instead of choosing a side.
- Merge semantic duplicates. Do not create extra facts just to reach a target count.

REFERENCE RULES
- Return exactly one references item for each supplied image, in ascending fixed-slot order.
- Copy referenceId and slot exactly. Sparse slots remain sparse; never compact or renumber.
- role must be FAMILY_OVERVIEW, SINGLE_VARIANT, DETAIL_SUPPORT, PACKAGING_CONTEXT, or OTHER.
- variantKey groups only visibly compatible views of the same product variant; use null when uncertain or not applicable.
- supportingReferenceIds means the image actually supports or proves the fact.
- compatibleReferenceIds means only that the image is visually suitable for presenting or demonstrating the fact. Compatibility never upgrades evidence authority.
- IMAGE_TEXT or VISUAL_EVIDENCE facts must list actual supportingReferenceIds.
- USER_TEXT-only facts must use supportingReferenceIds=[]. They may still have compatibleReferenceIds when an uploaded image clearly matches the product/variant.

FACT MODE
- DEMONSTRATABLE only when one simple physical action can visibly and truthfully demonstrate the fact using at least one uploaded compatible reference, without inventing hidden mechanics or requiring a second major action.
- PRESENTATIONAL for appearance, design, packaging, gifting context, counts, specifications, material/safety claims, or other facts that are better reviewed while simply showing the product.
- A physical presentation is not proof of an invisible property.
- If a fact has no uploaded reference suitable for a truthful physical demonstration, use PRESENTATIONAL.

PRODUCT PROFILE
- summary: concise neutral product summary grounded in the evidence.
- shapeAndGeometry, colors, materialAppearance, visibleMarkers: stable visible identity only.
- environmentAnchor: one simple neutral review setting that fits visible product scale/use (for example tabletop, floor, or handheld review). Do not turn it into a product claim and do not add camera language.

INFERENCE
- inferenceBasis must be null unless sources contains REASONABLE_INFERENCE.
- When REASONABLE_INFERENCE is present, inferenceBasis must state the grounded basis briefly.

OUTPUT
Return only JSON matching the provided schema.`;
}

function extractInteractionText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  if (!Array.isArray(payload.steps)) return null;

  const parts: string[] = [];

  for (const step of payload.steps) {
    if (!isRecord(step) || step.type !== 'model_output' || !Array.isArray(step.content)) {
      continue;
    }

    for (const content of step.content) {
      if (isRecord(content) && content.type === 'text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }

  return parts.length > 0 ? parts.join('') : null;
}

function validateModelOutput(
  value: unknown,
  input: EvidenceInputV2,
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['output must be an object'];

  const orderedReferences = [...input.references].sort(
    (left, right) => left.slot - right.slot,
  );
  const knownReferenceIds = new Set(
    orderedReferences.map((reference) => referenceIdForSlot(reference.slot)),
  );

  if (!isRecord(value.product)) {
    errors.push('product is required');
  } else {
    if (!isNonEmptyString(value.product.summary)) errors.push('product.summary is required');
    if (!isNonEmptyString(value.product.shapeAndGeometry)) {
      errors.push('product.shapeAndGeometry is required');
    }
    if (!isStringArray(value.product.colors)) errors.push('product.colors is invalid');
    if (!isNonEmptyString(value.product.materialAppearance)) {
      errors.push('product.materialAppearance is required');
    }
    if (!isStringArray(value.product.visibleMarkers)) {
      errors.push('product.visibleMarkers is invalid');
    }
    if (!isNonEmptyString(value.product.environmentAnchor)) {
      errors.push('product.environmentAnchor is required');
    }
  }

  if (!Array.isArray(value.references) || value.references.length !== orderedReferences.length) {
    errors.push('references must contain exactly one item per input reference');
  } else {
    value.references.forEach((reference, index) => {
      const expected = orderedReferences[index];
      const expectedId = referenceIdForSlot(expected.slot);

      if (!isRecord(reference)) {
        errors.push(`references[${index}] is invalid`);
        return;
      }
      if (reference.referenceId !== expectedId || reference.slot !== expected.slot) {
        errors.push(`references[${index}] must preserve fixed reference identity`);
      }
      if (!isEnumValue(reference.role, REFERENCE_ROLES)) {
        errors.push(`references[${index}].role is invalid`);
      }
      if (reference.variantKey !== null && !isNonEmptyString(reference.variantKey)) {
        errors.push(`references[${index}].variantKey is invalid`);
      }
      if (!isNonEmptyString(reference.summary)) {
        errors.push(`references[${index}].summary is required`);
      }
    });
  }

  if (!Array.isArray(value.facts) || value.facts.length === 0) {
    errors.push('facts must contain at least one grounded fact');
  } else {
    value.facts.forEach((fact, index) => {
      if (!isRecord(fact)) {
        errors.push(`facts[${index}] is invalid`);
        return;
      }

      if (!isNonEmptyString(fact.text)) errors.push(`facts[${index}].text is required`);
      if (
        !Array.isArray(fact.sources) ||
        fact.sources.length === 0 ||
        fact.sources.some((source) => !isEnumValue(source, EVIDENCE_SOURCES))
      ) {
        errors.push(`facts[${index}].sources is invalid`);
      }
      if (!isEnumValue(fact.confidence, FACT_CONFIDENCES)) {
        errors.push(`facts[${index}].confidence is invalid`);
      }
      if (!isEnumValue(fact.mode, FACT_MODES)) {
        errors.push(`facts[${index}].mode is invalid`);
      }
      if (fact.inferenceBasis !== null && !isNonEmptyString(fact.inferenceBasis)) {
        errors.push(`facts[${index}].inferenceBasis is invalid`);
      }
      if (
        Array.isArray(fact.sources) &&
        fact.sources.includes('REASONABLE_INFERENCE') &&
        fact.inferenceBasis === null
      ) {
        errors.push(`facts[${index}] requires inferenceBasis`);
      }
      if (
        Array.isArray(fact.sources) &&
        !fact.sources.includes('REASONABLE_INFERENCE') &&
        fact.inferenceBasis !== null
      ) {
        errors.push(`facts[${index}] has inferenceBasis without REASONABLE_INFERENCE`);
      }

      const supportingIds = fact.supportingReferenceIds;
      const compatibleIds = fact.compatibleReferenceIds;

      if (
        !isStringArray(supportingIds) ||
        new Set(supportingIds).size !== supportingIds.length ||
        supportingIds.some((id) => !knownReferenceIds.has(id))
      ) {
        errors.push(`facts[${index}].supportingReferenceIds is invalid`);
      }
      if (
        !isStringArray(compatibleIds) ||
        new Set(compatibleIds).size !== compatibleIds.length ||
        compatibleIds.some((id) => !knownReferenceIds.has(id))
      ) {
        errors.push(`facts[${index}].compatibleReferenceIds is invalid`);
      }

      const hasImageSource =
        Array.isArray(fact.sources) &&
        (fact.sources.includes('IMAGE_TEXT') || fact.sources.includes('VISUAL_EVIDENCE'));

      if (hasImageSource && isStringArray(supportingIds) && supportingIds.length === 0) {
        errors.push(`facts[${index}] with image evidence requires supportingReferenceIds`);
      }
      if (!hasImageSource && isStringArray(supportingIds) && supportingIds.length > 0) {
        errors.push(`facts[${index}] without image evidence cannot claim supportingReferenceIds`);
      }
      if (
        fact.mode === 'DEMONSTRATABLE' &&
        isStringArray(compatibleIds) &&
        compatibleIds.length === 0
      ) {
        errors.push(`facts[${index}] DEMONSTRATABLE requires a compatible reference`);
      }
    });
  }

  return errors;
}

function normalizeOutput(
  output: GeminiEvidenceOutputV2,
  input: EvidenceInputV2,
  sourceFingerprint: string,
): EvidencePackageV2 {
  const references: ReferenceProfile[] = output.references.map((reference) => ({
    referenceId: reference.referenceId,
    slot: reference.slot as ReferenceProfile['slot'],
    role: reference.role,
    variantKey: reference.variantKey === null ? null : reference.variantKey.trim(),
    summary: reference.summary.trim(),
  }));

  const facts: ProductFact[] = output.facts.map((fact, index) => ({
    factId: `FACT_${String(index + 1).padStart(2, '0')}`,
    text: fact.text.trim(),
    sources: [...new Set(fact.sources)],
    confidence: fact.confidence,
    mode: fact.mode,
    inferenceBasis: fact.inferenceBasis === null ? null : fact.inferenceBasis.trim(),
    supportingReferenceIds: [...new Set(fact.supportingReferenceIds)],
    compatibleReferenceIds: [...new Set(fact.compatibleReferenceIds)],
  }));

  return {
    contractVersion: 1,
    sourceFingerprint,
    voiceGender: input.voiceGender,
    product: {
      productName: input.productName.trim(),
      category: input.category.trim(),
      summary: output.product.summary.trim(),
      shapeAndGeometry: output.product.shapeAndGeometry.trim(),
      colors: output.product.colors.map((color) => color.trim()).filter(Boolean),
      materialAppearance: output.product.materialAppearance.trim(),
      visibleMarkers: output.product.visibleMarkers
        .map((marker) => marker.trim())
        .filter(Boolean),
      environmentAnchor: output.product.environmentAnchor.trim(),
    },
    references,
    facts,
  };
}

export async function analyzeEvidenceV2(
  apiKey: string,
  input: EvidenceInputV2,
): Promise<EvidencePackageV2> {
  if (apiKey.trim() === '') {
    throw new Error('Gemini API key is required');
  }

  const inputErrors = validateEvidenceInputV2(input);
  if (inputErrors.length > 0) {
    throw new Error(`Invalid evidence input: ${inputErrors.join(' | ')}`);
  }

  const orderedReferences = [...input.references].sort(
    (left, right) => left.slot - right.slot,
  );
  const sourceFingerprint = await createSourceFingerprint(input);
  const requestInput = [
    { type: 'text', text: buildInstruction(input) },
    ...orderedReferences.flatMap((reference) => [
      {
        type: 'text',
        text: `IMAGE BINDING: referenceId=${referenceIdForSlot(reference.slot)}; fixedSlot=${reference.slot}`,
      },
      {
        type: 'image',
        data: reference.dataBase64.replace(/\s/g, ''),
        mime_type: reference.mimeType.trim().toLowerCase(),
      },
    ]),
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: requestInput,
        store: false,
        generation_config: {
          thinking_level: 'medium',
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini API ${response.status}: ${detail.slice(0, 500)}`);
    }

    const payload: unknown = await response.json();
    const text = extractInteractionText(payload);
    if (!text) {
      throw new Error('Gemini returned no structured text output');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Gemini returned invalid JSON evidence output');
    }

    const outputErrors = validateModelOutput(parsed, input);
    if (outputErrors.length > 0) {
      throw new Error(`Gemini evidence output invalid: ${outputErrors.join(' | ')}`);
    }

    return normalizeOutput(
      parsed as unknown as GeminiEvidenceOutputV2,
      input,
      sourceFingerprint,
    );
  } finally {
    clearTimeout(timeout);
  }
}
