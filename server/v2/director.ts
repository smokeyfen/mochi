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
        `${fact.factId} | mode=${fact.mode} | confidence=${fact.confidence} | sources=[${fact.sources.join(', ')}] | ${fact.text}\n` +
        `  inferenceBasis=${fact.inferenceBasis ?? 'none'} supportingRefs=[${fact.supportingReferenceIds.join(', ')}] compatibleRefs=[${fact.compatibleReferenceIds.join(', ')}]`,
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
- Keep focus semantically anchored to primaryFactId. It may summarize the idea naturally, but it must not introduce a new mechanism, feature, operating step, or performance claim.
- The dialogue must clearly center on primaryFactId. Supporting facts are optional in speech; omit them when adding them would make the line crowded or unnatural.
- Do not use LOW-confidence facts as the primary fact when a stronger grounded alternative exists.

PRESENTATION VS DEMONSTRATION
- PRESENTATION means the scene shows the product while discussing a grounded fact. Natural evidence-compatible handling may support direct observation, but it must not imply that a staging gesture proves an invisible property.
- DEMONSTRATION is allowed only when the primary fact is marked DEMONSTRATABLE by E1 and a clear evidence-supported physical action can truthfully show that behavior. Preserve an easy-to-read cause-and-effect relationship.
- Never convert a PRESENTATIONAL fact into a demonstration merely because the object can be touched or moved.
- A DEMONSTRATABLE fact may still be used in a PRESENTATION scene when that creates a better four-scene sequence.

ACTION
Choose exactly one primary physical action per scene from: ${SCENE_ACTIONS.join(', ')}. Store that primary action in the existing action field.
- PRESENT: simply reveal or hold/show the product.
- MOVE: externally controlled translation of the whole product; in PRESENTATION this is staging, not proof of a hidden claim.
- REORIENT: rotate/turn/reposition the whole product for inspection; in PRESENTATION this is staging.
- PRESS_RELEASE: one simple whole-product actuation followed by full release, then the product moves afterward. Use only when the grounded fact supports that behavior; never invent a motor/spring/mechanism.
- OPEN, CLOSE, CONNECT, DISCONNECT, REMOVE: use only when the grounded fact explicitly supports that physical relationship or behavior.
- Simple natural supporting movements or handling are allowed only when they directly support the primary action, fit the product's physical reality, and remain consistent with evidence.
- Do not require supporting movement. The primary action alone is correct when it is the clearest presentation.
- Do not create a complex, hard-to-read, or unsupported chain of actions. In DEMONSTRATION, every supporting movement must preserve clear cause and effect; in PRESENTATION, it may only support natural product observation.
- ACTION_READABILITY outranks decorative motion.

REFERENCE ROUTING
- primaryReferenceId must be one of the primary fact's supportingReferenceIds or compatibleReferenceIds.
- When the primary fact has supportingReferenceIds that are visually usable, prefer one of them as primaryReferenceId because it carries direct evidence authority. Use a merely compatible reference as primary only when it is clearly better for the scene and does not create conflicting visual context.
- The final video is hands-only: no face or full body. When multiple routed references are equally usable for the same scene, prefer a clean product-only view with direct support for the fact over a person/model or broader context view. A person/context reference may remain supporting context only when it materially helps and does not force that person into the generated scene.
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
- Write at least two complete Vietnamese sentences per scene in a sincere, everyday KOC-review voice. It must sound like a real person directly holding, looking at, or trying the product while talking to the viewer, not introducing a listing, catalog, script brief, or TV advertisement.
- Normally use exactly two short, natural sentences. Add another sentence only when the complete dialogue remains comfortably speakable within the 8-second scene at a natural pace.
- Each sentence must stand on its own as a complete spoken thought. Do not use a comma, semicolon, conjunction, or two clauses inside one sentence to imitate the required two-sentence structure.
- The sentences must complement each other and stay centered on primaryFactId rather than repeating the same claim in different words. Supporting facts are optional and should appear only when they strengthen that same primary idea without crowding the speech.
- Keep the selected voice gender consistent; do not mention the speaker on screen.
- The line does not need to repeat evidence word-for-word. Natural paraphrase, everyday phrasing, mild subjective reactions, and conversational particles are welcome when they stay truthful.
- Prefer interactive spoken Vietnamese with natural cues in the spirit of "mình thấy", "nhìn chỗ này", "Mẹ nhìn này", "mình thử", "cái này", or "đoạn này" when they fit the scene. These are tone cues, not fixed sentence templates. Vary sentence openings and cadence; do not force every scene to begin the same way.
- Do not use listing-style introductions or technical recitation such as "hôm nay mình giới thiệu", "sản phẩm có", "chiều dài là", "kích thước là", "được làm từ", or "sử dụng cơ chế". When a casual equivalent exists, also avoid stiff wording such as "sản phẩm được...", "trang bị...", "tác động lực...", "thiết kế phù hợp cho...", or "rất thích hợp...".
- Immediate first-person wording is allowed when it naturally describes the current visible review action, observation, or light subjective reaction. Do not fabricate ownership, long-term use, prior testing, or a child's personal reaction.
- Do not read raw measurements or technical specifications aloud, including centimetres, grams, watts, volts, or specific numeric dimensions. When the selected grounded fact is a specification, turn it into an ordinary observation or experience only when E1 evidence supports that interpretation; for example, a supported size fact may become a natural observation about being compact, easy to inspect, or comfortable in hand. Do not create a new claim while paraphrasing.
- A grounded product count, such as the number of items in a set, may still be spoken when that count is the useful primary idea for the viewer.
- Scene 1 is the opening introduction of the video. Its dialogue must contain at least two short, natural sentences that remain comfortably speakable within 8 seconds.
- Scene 1 must mention the full exact productName from PRODUCT Name at least once. Integrate it naturally into a spoken sentence; do not shorten, abbreviate, or replace the input name when doing so would omit any part of that name.
- Choose a context-appropriate Scene 1 opening approach: directly address the viewer, invite the viewer to look along, ask a light opening question, bring the product immediately into the current holding or viewing action, or share a first impression. These are varied tone strategies, not fixed sentence templates, and no single approach is required for every product.
- The other Scene 1 sentence should give a first impression or useful overview grounded in primaryFactId. Do not turn the opening into reading the product name followed by a measurement or technical specification.
- These Scene 1 opening rules apply only to Scene 1. Do not impose them on Scenes 2 through 4.
- Address the viewer according to PRODUCT Category when direct address is useful:
  - For "Mẹ và Bé", prefer "Mẹ" or "các Mẹ" and never use "các bạn" in the CTA.
  - For "Đồ chơi và Trẻ em", prefer "ba mẹ".
  - For "Điện tử tiêu dùng", prefer "mọi người".
  - For "Trang trí nhà cửa", prefer "mọi người" or "cả nhà" when natural.
  - For "Thực phẩm và Đồ uống", prefer "mọi người" or "cả nhà" when natural.
- Do not mention an audience persona in every sentence. Use it only when directly speaking to the viewer or when the Scene 4 CTA benefits from it.
- Reasonable inference is allowed only when it is already supported by the selected E1 grounded fact. Do not extend an inference into a new specific claim.
- For a simple physical behavior, describe what the viewer can see in everyday verbs rather than explaining a mechanism. If the grounded idea is "chạy đà", a natural line can describe pushing/releasing and the car continuing to move; do not rename that behavior as a friction motor, spring motor, pull-back motor, or other internal mechanism.
- For physical behavior such as "chạy đà", natural spoken phrasing must stay at the grounded strength of the fact and the visible action. Unless separately grounded, do not qualify the push force, travel distance, smoothness, speed, or how long the motion continues.
- In packaging or product-presentation scenes, speak only from grounded facts and what is visibly being presented. Packaging or a neat arrangement alone does not support extra portability, storage, convenience, travel/use-case, or ease-of-use claims.
- Use particles such as "nha", "nè", "thì", or "cũng" only when they genuinely improve spoken rhythm, not as a quota.
- Do not turn natural reviewer language into a new falsifiable claim. Never add specific performance, safety, mechanism, compatibility, operating information, or any detail that exceeds or contradicts the evidence.
- Never add ungrounded measurable performance such as speed, distance, duration, force, or capacity.
- Casual adjectives are allowed when they are clearly subjective and visual, but avoid stacking superlatives or polished ad slogans.
- Keep the complete dialogue comfortably speakable within the 8-second scene at a natural conversational pace. Never write a long dialogue and compensate by asking for fast delivery.
- Scene 4 is the closing scene. Keep its dialogue to at least two short, natural sentences that remain comfortably speakable within 8 seconds; the first sentence should give a final observation or conclusion grounded in that scene's primaryFactId.
- The final sentence of Scene 4 must be a clear, soft KOC call to action that conversationally invites viewers to tham khảo, xem thử, or cân nhắc the product. Use the audience persona mapped from PRODUCT Category; for "Mẹ và Bé", address "Mẹ" or "các Mẹ" naturally. Generate wording that fits the actual product and scene rather than copying a fixed CTA template.
- Keep the Scene 4 CTA light and natural, never forceful or promotional. Do not mention buying now, placing an order, price, discounts, scarcity, urgency, or any unsupported claim. The CTA must not create a new product fact; it may only invite the viewer to consider or look into the product.

SEQUENCE
Build a coherent four-scene review arc. A useful default is broad orientation -> useful feature/behavior -> detail/value -> closing CTA presentation, but follow the actual evidence instead of forcing that pattern.

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
