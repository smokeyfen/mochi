import type {
  CameraIntent,
  CutPreference,
  EvidencePackageV2,
  ProductFact,
  ReferenceProfile,
  SceneAction,
  SceneMode,
  ScenePlanSetV2,
  ScenePlanV2,
} from '../../src/v2/contracts';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_INTERACTIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

const SCENE_MODES: readonly SceneMode[] = [
  'PRESENTATION',
  'DEMONSTRATION',
];

const SCENE_ACTIONS: readonly SceneAction[] = [
  'PRESENT',
  'MOVE',
  'REORIENT',
  'PRESS_RELEASE',
  'OPEN',
  'CLOSE',
  'CONNECT',
  'DISCONNECT',
  'REMOVE',
];

const CAMERA_INTENTS: readonly CameraIntent[] = [
  'OVERVIEW_REVEAL',
  'ACTION_READABILITY',
  'DETAIL_INSPECTION',
  'PRODUCT_PRESENTATION',
];

const CUT_PREFERENCES: readonly CutPreference[] = [
  'CONTINUOUS',
  'ONE_CUT',
];

interface GeminiScenePlanV2 {
  mode: SceneMode;
  focus: string;
  primaryFactId: string;
  supportingFactIds: string[];
  primaryReferenceId: string;
  supportingReferenceIds: string[];
  action: SceneAction;
  dialogue: string;
  cameraIntent: CameraIntent;
  cutPreference: CutPreference;
}

interface GeminiScenePlanSetV2 {
  scenes: GeminiScenePlanV2[];
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: SCENE_MODES },
          focus: { type: 'string' },
          primaryFactId: { type: 'string' },
          supportingFactIds: {
            type: 'array',
            items: { type: 'string' },
          },
          primaryReferenceId: { type: 'string' },
          supportingReferenceIds: {
            type: 'array',
            items: { type: 'string' },
          },
          action: { type: 'string', enum: SCENE_ACTIONS },
          dialogue: { type: 'string' },
          cameraIntent: { type: 'string', enum: CAMERA_INTENTS },
          cutPreference: { type: 'string', enum: CUT_PREFERENCES },
        },
        required: [
          'mode',
          'focus',
          'primaryFactId',
          'supportingFactIds',
          'primaryReferenceId',
          'supportingReferenceIds',
          'action',
          'dialogue',
          'cameraIntent',
          'cutPreference',
        ],
      },
    },
  },
  required: ['scenes'],
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

function describeReferences(references: readonly ReferenceProfile[]): string {
  return references
    .map(
      (reference) =>
        `${reference.referenceId} | slot ${reference.slot} | role=${reference.role} | variant=${reference.variantKey ?? 'unknown'} | ${reference.summary}`,
    )
    .join('\n');
}

function describeFacts(facts: readonly ProductFact[]): string {
  return facts
    .map(
      (fact) =>
        `${fact.factId} | mode=${fact.mode} | confidence=${fact.confidence} | ${fact.text}\n` +
        `  supportingRefs=[${fact.supportingReferenceIds.join(', ')}] compatibleRefs=[${fact.compatibleReferenceIds.join(', ')}]`,
    )
    .join('\n');
}

function buildInstruction(evidence: EvidencePackageV2): string {
  return `You are MOCHI PROMPT V2 E2 — Scene Director.

GOAL
Create exactly four strong product-review scene plans from the supplied evidence package. Do not re-analyze the original images and do not invent new product facts. E1 decides what is true; you decide what is worth showing and how each scene should present it.

PRODUCT
Name: ${evidence.product.productName}
Category: ${evidence.product.category}
Summary: ${evidence.product.summary}
Environment anchor: ${evidence.product.environmentAnchor}
Voice gender: ${evidence.voiceGender}

REFERENCE PROFILES
${describeReferences(evidence.references)}

GROUNDED FACTS
${describeFacts(evidence.facts)}

SCENE SELECTION
- Return exactly 4 scenes.
- Prefer strong, useful facts over filling a quota. Reusing one strong fact in more than one scene is allowed when the presentation purpose is genuinely different.
- Do not manufacture weak facts merely to make four scenes distinct.
- primaryFactId is the main claim for that scene. supportingFactIds may be empty and must only add grounded context from the listed facts.
- Do not use LOW-confidence facts as the primary fact when a stronger grounded alternative exists.

PRESENTATION VS DEMONSTRATION
- PRESENTATION means the scene shows the product while discussing a grounded fact. It must not imply that a staging gesture proves an invisible property.
- DEMONSTRATION is allowed only when the primary fact is marked DEMONSTRATABLE by E1 and one simple physical action can truthfully show that behavior.
- Never convert a PRESENTATIONAL fact into a demonstration merely because the object can be touched or moved.
- A DEMONSTRATABLE fact may still be used in a PRESENTATION scene when that creates a better four-scene sequence.

ACTION
Choose exactly one major physical action per scene from: ${SCENE_ACTIONS.join(', ')}.
- PRESENT: simply reveal or hold/show the product.
- MOVE: externally controlled translation of the whole product; in PRESENTATION this is staging, not proof of a hidden claim.
- REORIENT: rotate/turn/reposition the whole product for inspection; in PRESENTATION this is staging.
- PRESS_RELEASE: one simple whole-product actuation followed by full release, then the product moves afterward. Use only when the grounded fact supports that behavior; never invent a motor/spring/mechanism.
- OPEN, CLOSE, CONNECT, DISCONNECT, REMOVE: use only when the grounded fact explicitly supports that physical relationship or behavior.
- ACTION_READABILITY outranks decorative motion. Do not stack multiple major actions into one scene.

REFERENCE ROUTING
- primaryReferenceId must be one of the primary fact's supportingReferenceIds or compatibleReferenceIds.
- supportingReferenceIds are optional and may only use known uploaded references that genuinely help the selected facts.
- Never compact or renumber IDs.
- Do not mix incompatible variants. If references have different non-null variantKey values, keep a scene within one variant.
- Supporting compatibility never upgrades evidence authority.

CAMERA
Choose one camera intent per scene: ${CAMERA_INTENTS.join(', ')}.
- OVERVIEW_REVEAL: establish the product/set clearly.
- ACTION_READABILITY: prioritize an unobstructed view of the physical action.
- DETAIL_INSPECTION: emphasize small visible product details.
- PRODUCT_PRESENTATION: polished product-first composition.
- Across four scenes, create meaningful composition variety when the content permits, but never force an angle change that makes the action harder to understand.
- Camera diversity is an outcome, not a scene-number template.

CUT
- CONTINUOUS for a scene that reads best as one uninterrupted shot, especially causal demonstrations.
- ONE_CUT only when one purposeful edit materially improves presentation or detail readability.
- Never add more than one cut.

DIALOGUE
- Write one concise, natural Vietnamese off-camera review line per scene.
- Keep the selected voice gender consistent; do not mention the speaker on screen.
- Dialogue must stay within the meaning and strength of primaryFactId plus supportingFactIds.
- Do not add new mechanisms, specifications, safety guarantees, performance claims, or promotional superlatives.
- Prefer conversational review wording over literal translation of English evidence text.
- No hard word-count target; keep it short enough for an approximately 8-second scene.

SEQUENCE
Build a coherent four-scene review arc. A useful default is broad orientation -> useful feature/behavior -> detail/value -> closing presentation, but follow the actual evidence instead of forcing that pattern.

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

function referenceIdsForFact(fact: ProductFact): Set<string> {
  return new Set([
    ...fact.supportingReferenceIds,
    ...fact.compatibleReferenceIds,
  ]);
}

function validateModelOutput(
  value: unknown,
  evidence: EvidencePackageV2,
): string[] {
  const errors: string[] = [];

  if (!isRecord(value) || !Array.isArray(value.scenes) || value.scenes.length !== 4) {
    return ['scenes must contain exactly four items'];
  }

  const factsById = new Map(evidence.facts.map((fact) => [fact.factId, fact]));
  const referencesById = new Map(
    evidence.references.map((reference) => [reference.referenceId, reference]),
  );

  value.scenes.forEach((scene, index) => {
    const prefix = `scenes[${index}]`;

    if (!isRecord(scene)) {
      errors.push(`${prefix} is invalid`);
      return;
    }

    if (!isEnumValue(scene.mode, SCENE_MODES)) {
      errors.push(`${prefix}.mode is invalid`);
    }
    if (!isNonEmptyString(scene.focus)) {
      errors.push(`${prefix}.focus is required`);
    }
    if (!isNonEmptyString(scene.primaryFactId) || !factsById.has(scene.primaryFactId)) {
      errors.push(`${prefix}.primaryFactId is invalid`);
    }
    if (
      !isStringArray(scene.supportingFactIds) ||
      new Set(scene.supportingFactIds).size !== scene.supportingFactIds.length ||
      scene.supportingFactIds.some(
        (factId) => factId === scene.primaryFactId || !factsById.has(factId),
      )
    ) {
      errors.push(`${prefix}.supportingFactIds is invalid`);
    }
    if (!isNonEmptyString(scene.primaryReferenceId) || !referencesById.has(scene.primaryReferenceId)) {
      errors.push(`${prefix}.primaryReferenceId is invalid`);
    }
    if (
      !isStringArray(scene.supportingReferenceIds) ||
      new Set(scene.supportingReferenceIds).size !== scene.supportingReferenceIds.length ||
      scene.supportingReferenceIds.some(
        (referenceId) =>
          referenceId === scene.primaryReferenceId || !referencesById.has(referenceId),
      )
    ) {
      errors.push(`${prefix}.supportingReferenceIds is invalid`);
    }
    if (!isEnumValue(scene.action, SCENE_ACTIONS)) {
      errors.push(`${prefix}.action is invalid`);
    }
    if (!isNonEmptyString(scene.dialogue)) {
      errors.push(`${prefix}.dialogue is required`);
    }
    if (!isEnumValue(scene.cameraIntent, CAMERA_INTENTS)) {
      errors.push(`${prefix}.cameraIntent is invalid`);
    }
    if (!isEnumValue(scene.cutPreference, CUT_PREFERENCES)) {
      errors.push(`${prefix}.cutPreference is invalid`);
    }

    const primaryFact =
      typeof scene.primaryFactId === 'string'
        ? factsById.get(scene.primaryFactId)
        : undefined;

    if (
      scene.mode === 'DEMONSTRATION' &&
      primaryFact &&
      primaryFact.mode !== 'DEMONSTRATABLE'
    ) {
      errors.push(`${prefix} cannot demonstrate a PRESENTATIONAL fact`);
    }

    if (
      primaryFact &&
      typeof scene.primaryReferenceId === 'string' &&
      !referenceIdsForFact(primaryFact).has(scene.primaryReferenceId)
    ) {
      errors.push(`${prefix}.primaryReferenceId is not routed by the primary fact`);
    }

    const sceneReferenceIds = [
      typeof scene.primaryReferenceId === 'string' ? scene.primaryReferenceId : '',
      ...(isStringArray(scene.supportingReferenceIds) ? scene.supportingReferenceIds : []),
    ];
    const variantKeys = new Set(
      sceneReferenceIds
        .map((referenceId) => referencesById.get(referenceId)?.variantKey ?? null)
        .filter((variantKey): variantKey is string => variantKey !== null),
    );

    if (variantKeys.size > 1) {
      errors.push(`${prefix} mixes incompatible reference variants`);
    }
  });

  return errors;
}

function normalizeOutput(
  output: GeminiScenePlanSetV2,
  evidence: EvidencePackageV2,
): ScenePlanSetV2 {
  const scenes = output.scenes.map((scene, index): ScenePlanV2 => ({
    sceneNumber: (index + 1) as ScenePlanV2['sceneNumber'],
    mode: scene.mode,
    focus: scene.focus.trim(),
    primaryFactId: scene.primaryFactId,
    supportingFactIds: [...new Set(scene.supportingFactIds)],
    primaryReferenceId: scene.primaryReferenceId,
    supportingReferenceIds: [...new Set(scene.supportingReferenceIds)],
    action: scene.action,
    dialogue: scene.dialogue.trim(),
    cameraIntent: scene.cameraIntent,
    cutPreference: scene.cutPreference,
  }));

  return {
    contractVersion: 1,
    sourceFingerprint: evidence.sourceFingerprint,
    voiceGender: evidence.voiceGender,
    scenes: scenes as unknown as ScenePlanSetV2['scenes'],
  };
}

export async function planScenesV2(
  apiKey: string,
  evidence: EvidencePackageV2,
): Promise<ScenePlanSetV2> {
  if (apiKey.trim() === '') {
    throw new Error('Gemini API key is required');
  }
  if (evidence.contractVersion !== 1 || evidence.sourceFingerprint.trim() === '') {
    throw new Error('Evidence package is invalid');
  }
  if (evidence.references.length < 1) {
    throw new Error('Evidence package requires at least one reference');
  }
  if (evidence.facts.length < 1) {
    throw new Error('Evidence package requires at least one fact');
  }

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
        input: [
          {
            type: 'text',
            text: buildInstruction(evidence),
          },
        ],
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
      throw new Error('Gemini returned no structured scene-plan output');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Gemini returned invalid JSON scene-plan output');
    }

    const outputErrors = validateModelOutput(parsed, evidence);
    if (outputErrors.length > 0) {
      throw new Error(`Gemini scene-plan output invalid: ${outputErrors.join(' | ')}`);
    }

    return normalizeOutput(parsed as unknown as GeminiScenePlanSetV2, evidence);
  } finally {
    clearTimeout(timeout);
  }
}
