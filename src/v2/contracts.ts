export type VoiceGender =
  | 'FEMALE'
  | 'MALE';

export type ReferenceSlot = 1 | 2 | 3 | 4 | 5;

export type ReferenceRole =
  | 'FAMILY_OVERVIEW'
  | 'SINGLE_VARIANT'
  | 'DETAIL_SUPPORT'
  | 'PACKAGING_CONTEXT'
  | 'OTHER';

export interface ReferenceProfile {
  readonly referenceId: string;
  readonly slot: ReferenceSlot;
  readonly role: ReferenceRole;
  readonly variantKey: string | null;
  readonly summary: string;
}

export interface EvidenceReferenceInputV2 {
  readonly slot: ReferenceSlot;
  readonly mimeType: string;
  readonly dataBase64: string;
}

export interface EvidenceInputV2 {
  readonly productName: string;
  readonly productDetails: string;
  readonly category: string;
  readonly voiceGender: VoiceGender;
  readonly references: readonly EvidenceReferenceInputV2[];
}

export type EvidenceSource =
  | 'USER_TEXT'
  | 'IMAGE_TEXT'
  | 'VISUAL_EVIDENCE'
  | 'REASONABLE_INFERENCE';

// Demonstratable facts support a simple truthful action; presentational facts may be discussed during visual presentation without implying mechanical proof.
export type FactMode =
  | 'DEMONSTRATABLE'
  | 'PRESENTATIONAL';

export type FactConfidence =
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW';

export interface ProductFact {
  readonly factId: string;
  readonly text: string;
  readonly sources: readonly EvidenceSource[];
  readonly confidence: FactConfidence;
  readonly mode: FactMode;
  readonly inferenceBasis: string | null;
  readonly supportingReferenceIds: readonly string[];
  readonly compatibleReferenceIds: readonly string[];
}

export interface ProductProfile {
  readonly productName: string;
  readonly category: string;
  readonly summary: string;
  readonly shapeAndGeometry: string;
  readonly colors: readonly string[];
  readonly materialAppearance: string;
  readonly visibleMarkers: readonly string[];
  readonly environmentAnchor: string;
}

export interface EvidencePackageV2 {
  readonly contractVersion: 1;
  readonly sourceFingerprint: string;
  readonly voiceGender: VoiceGender;
  readonly product: ProductProfile;
  readonly references: readonly ReferenceProfile[];
  readonly facts: readonly ProductFact[];
}

export type SceneMode =
  | 'PRESENTATION'
  | 'DEMONSTRATION';

export type SceneAction =
  | 'PRESENT'
  | 'MOVE'
  | 'REORIENT'
  | 'PRESS_RELEASE'
  | 'OPEN'
  | 'CLOSE'
  | 'CONNECT'
  | 'DISCONNECT'
  | 'REMOVE';

export type CameraIntent =
  | 'OVERVIEW_REVEAL'
  | 'ACTION_READABILITY'
  | 'DETAIL_INSPECTION'
  | 'PRODUCT_PRESENTATION';

export type CutPreference =
  | 'CONTINUOUS'
  | 'ONE_CUT';

export interface ScenePlanV2 {
  readonly sceneNumber: 1 | 2 | 3 | 4;
  readonly mode: SceneMode;
  readonly focus: string;
  readonly primaryFactId: string;
  readonly supportingFactIds: readonly string[];
  readonly primaryReferenceId: string;
  readonly supportingReferenceIds: readonly string[];
  readonly action: SceneAction;
  readonly dialogue: string;
  readonly cameraIntent: CameraIntent;
  readonly cutPreference: CutPreference;
}

export interface ScenePlanSetV2 {
  readonly contractVersion: 1;
  readonly sourceFingerprint: string;
  readonly voiceGender: VoiceGender;
  readonly scenes: readonly [
    ScenePlanV2,
    ScenePlanV2,
    ScenePlanV2,
    ScenePlanV2,
  ];
}

export interface CompiledScenePromptV2 {
  readonly sceneNumber: 1 | 2 | 3 | 4;
  readonly finalPrompt: string;
  readonly characterCount: number;
  readonly primaryReferenceId: string;
  readonly supportingReferenceIds: readonly string[];
}

export interface CompiledPromptSetV2 {
  readonly compilerVersion: 1;
  readonly sourceFingerprint: string;
  readonly voiceGender: VoiceGender;
  readonly scenes: readonly [
    CompiledScenePromptV2,
    CompiledScenePromptV2,
    CompiledScenePromptV2,
    CompiledScenePromptV2,
  ];
}
