import {
  functionSeriesTotalDuration,
  pointSequenceTotalDuration,
  type AxesItem,
  type AxesTipShape,
  type ExitAnimationItem,
  type BlinkAnimationItem,
  type BlinkMode,
  type BlinkTargetSpec,
  type TargetAnimationItem,
  type TargetAnimationMode,
  type TargetAnimationTargetSpec,
  type FunctionLineStyle,
  type FunctionSeriesDefaults,
  type FunctionSeriesMode,
  type FunctionSeriesPerN,
  type PointSequenceDefaults,
  type PointSequencePerN,
  type GraphDot,
  type GraphDotAttachment,
  type GraphDotItem,
  type GraphCurveItem,
  type GraphFunctionSeriesItem,
  type GraphPlotItem,
  type GraphPointSequenceItem,
  type ItemId,
  type ManimDirection,
  type PosStep,
  type SceneItem,
  type ShapeItem,
  type ShapeAnchor,
  type ShapeAngleMark,
  type ShapeEndpoints,
  type ShapeKind,
  type ShapePoint,
  type SurroundingRectItem,
  type TextLineItem,
  DEFAULT_SHAPE_POLYLINE_POINTS,
} from '@/types/scene';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, FRAME_W } from '@/lib/constants';
import {
  AGENT_ALLOWED_KINDS,
  AGENT_UI_ONLY_FIELDS,
  type AgentAction,
  type AgentChatResponse,
  actionItemId,
  isAgentAllowedKind,
} from './types';
import { canBeTargetAnimationTargetKind } from '@/lib/time';
import { MAX_COPILOT_NOTE_LENGTH } from '@/lib/copilotNotes';
import {
  angleMarkStaticGeometry,
  connectorStaticGeometry,
  isAngleMark,
  isBoundShape,
  isConnectorShape,
  resolveAngleMark,
  resolveConnectorEndpoints,
} from '@/lib/shapeAnchors';
import {
  graphFollowStartTimeError,
  resolveAttachedGraphDot,
  resolveGraphDotPosition,
} from '@/lib/graphMotion';
import { dotFunctionPlot, parseLiveValueTemplate, templateUsesSlope } from '@/lib/graphLiveValue';
import { DEFAULT_CAMERA_DURATION, MIN_CAMERA_DURATION, validateCameraMove } from '@/lib/camera';
import type { CameraMoveItem, SceneDefaults } from '@/types/scene';
import { mergeTextLineUpdate, withParsedSegments } from './textDraft';
import { checkTextTransforms, normalizeAnimStyle, normalizeTransformConfig } from './textTransforms';
import { checkTimelineEdits, normalizeTimelineEdit } from './timelineEdits';
import { applyTimelineEdit } from '@/lib/timelineSurgery';
import type { AudioTrackItem } from '@/types/scene';
import { checkGraphRegions, normalizeAreaIntroStyle, normalizeAreaMode, normalizeFieldFields, normalizeGraphArea, normalizeGraphField } from './graphRegions';

export type ValidationResult =
  | { ok: true; response: AgentChatResponse; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Live frame context for `frameId` validation. Mirrors the scene store at
 * request time. Optional so older callers (and unit tests without frames)
 * keep working — when absent, `frameId` handling is skipped entirely and the
 * store's own fallbacks apply at commit.
 */
export interface AgentFrameContext {
  frameIds: readonly ItemId[];
  activeFrameId: ItemId | null;
  startFrameId: ItemId | null;
  frames?: readonly import('@/types/scene').FrameDef[];
}

export interface ValidateOptions {
  /**
   * Tool loop: the draft is checked and previewed before the user approves it, so a text line
   * created in this draft may be styled by a later UPDATE in the same draft. (A styled CREATE is
   * still rejected: its segments come from `raw`.)
   */
  allowStyleAfterCreate?: boolean;
  /** Narration tracks at request time: TIMELINE edits move them and are blocked by them. */
  audioItems?: readonly AudioTrackItem[];
}

/**
 * Kinds that can appear in an `exit_animation.targets[i].targetId`. Must stay
 * in sync with `canBeExitTarget` in `@/lib/time` — we inline the predicate as
 * a `Set<kind>` to keep the validator free of store / DOM dependencies.
 */
const EXIT_TARGET_KINDS: ReadonlySet<SceneItem['kind']> = new Set<SceneItem['kind']>([
  'textLine',
  'axes',
  'graphPlot',
  'graphCurve',
  'graphDot',
  'graphField',
  'graphFunctionSeries',
  'graphPointSequence',
  'graphArea',
  'shape',
  'surroundingRect',
]);

/** Dot fields an LLM tends to put at the item's top level instead of under `dot`. */
const GRAPH_DOT_TOP_LEVEL_ALIASES = [
  'attachment',
  'showCoordinates',
  'showProjectionGuides',
  'dx',
  'dy',
  'radius',
  'color',
] as const;

/**
 * Validate and normalize an `AgentChatResponse`. The LLM's JSON schema enforces
 * the envelope; this pass enforces cross-action invariants (unique ids, axes
 * refs, disallowed kinds, no UI-only field leakage) and fills missing base
 * fields with factory-style defaults so `useSceneStore.addItem` doesn't
 * explode.
 *
 * `reply` is required and must be non-empty. `actions` is optional; missing /
 * null means "pure chat reply" and is normalized to `[]`. Older responses that
 * used `rationale` instead of `reply` are accepted as a fallback.
 */
export function validateAgentResponse(
  raw: unknown,
  currentItems: Map<ItemId, SceneItem>,
  frameCtx?: AgentFrameContext,
  options: ValidateOptions = {},
): ValidationResult {
  const errors: string[] = [];
  /** Non-fatal repairs (dropped unknown fields …) the model should hear about. */
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Response is not an object.'] };
  }
  const resp = raw as Record<string, unknown>;
  const replyRaw =
    typeof resp.reply === 'string' && resp.reply.trim()
      ? resp.reply
      : typeof resp.rationale === 'string' && resp.rationale.trim()
        ? resp.rationale
        : '';
  if (!replyRaw) {
    return {
      ok: false,
      errors: ['Response is missing a non-empty `reply` string.'],
    };
  }
  const thinking =
    typeof resp.thinking === 'string' && resp.thinking.trim()
      ? resp.thinking
      : undefined;
  const rawActions: unknown[] =
    resp.actions == null
      ? []
      : Array.isArray(resp.actions)
        ? resp.actions
        : (null as unknown as unknown[]);
  if (rawActions === null) {
    return {
      ok: false,
      errors: ['Response `actions` must be an array (use [] for pure chat).'],
    };
  }

  // Pre-pass: if the model forgot to set `axesId` on a graphPlot / graphCurve /
  // graphDot CREATE but included exactly one axes CREATE in the same response, auto-link
  // them. This rescues a very common LLM omission without hiding genuine errors
  // (ambiguous cases with 0 or >1 candidate axes still fail validation later).
  autoLinkAxesIds(rawActions);

  const plannedCreates = new Map<ItemId, SceneItem['kind']>(); // id -> kind
  const plannedCreateRaw = new Map<ItemId, unknown>(); // id -> raw item for dedup
  const plannedCreateNormalized = new Map<ItemId, SceneItem>();
  const normalizedActions: AgentAction[] = [];

  rawActions.forEach((raw, idx) => {
    const a = raw as Record<string, unknown>;
    const prefix = `actions[${idx}]`;

    if (a.action === 'CREATE') {
      const item = a.item as Record<string, unknown> | undefined;
      if (!item || typeof item !== 'object') {
        errors.push(`${prefix}: CREATE is missing an \`item\`.`);
        return;
      }
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) {
        errors.push(`${prefix}.item.id is required.`);
        return;
      }
      if (currentItems.has(id)) {
        errors.push(
          `${prefix}.item.id "${id}" already exists in the scene.`,
        );
        return;
      }
      if (plannedCreates.has(id)) {
        // Tolerate exact-duplicate CREATEs (some preview LLMs hallucinate them):
        // drop the second one silently. Genuine collisions (same id, different
        // body) still fail so the user can see the bug in preview.
        if (isDeepEqual(plannedCreateRaw.get(id), item)) {
          return;
        }
        errors.push(
          `${prefix}.item.id "${id}" is also created by another action with different content.`,
        );
        return;
      }
      if (!isAgentAllowedKind(item.kind)) {
        errors.push(
          `${prefix}.item.kind "${String(item.kind)}" is not in the v1 whitelist (${AGENT_ALLOWED_KINDS.join(', ')}).`,
        );
        return;
      }
      for (const f of AGENT_UI_ONLY_FIELDS) {
        if (f in item) {
          errors.push(
            `${prefix}.item includes forbidden UI-only field "${f}".`,
          );
          return;
        }
      }
      const normalized = normalizeCreateItem(item, errors, prefix);
      if (!normalized) return;
      if (
        frameCtx &&
        !applyFrameIdOnCreate(item, normalized, frameCtx, errors, prefix)
      ) {
        return;
      }
      plannedCreates.set(id, normalized.kind);
      plannedCreateRaw.set(id, item);
      plannedCreateNormalized.set(id, normalized);
      normalizedActions.push({ action: 'CREATE', item: normalized });
      return;
    }

    if (a.action === 'UPDATE') {
      const itemId = typeof a.itemId === 'string' ? a.itemId : '';
      if (!itemId) {
        errors.push(`${prefix}: UPDATE is missing \`itemId\`.`);
        return;
      }
      if (!currentItems.has(itemId) && !plannedCreates.has(itemId)) {
        errors.push(`${prefix}: UPDATE target "${itemId}" does not exist.`);
        return;
      }
      const updates = a.updates as Record<string, unknown> | undefined;
      if (!updates || typeof updates !== 'object') {
        errors.push(`${prefix}: UPDATE is missing \`updates\` object.`);
        return;
      }
      if ('id' in updates) {
        errors.push(`${prefix}.updates may not change \`id\`.`);
        return;
      }
      if ('kind' in updates) {
        errors.push(`${prefix}.updates may not change \`kind\`.`);
        return;
      }
      for (const f of AGENT_UI_ONLY_FIELDS) {
        if (f in updates) {
          errors.push(
            `${prefix}.updates includes forbidden UI-only field "${f}".`,
          );
          return;
        }
      }
      const targetKind =
        currentItems.get(itemId)?.kind ?? plannedCreates.get(itemId) ?? '';
      if (!isAgentAllowedKind(targetKind)) {
        errors.push(
          `${prefix}: UPDATE target "${itemId}" is a ${targetKind || 'unknown item'}, which the Copilot may not edit (allowed: ${AGENT_ALLOWED_KINDS.join(', ')}). It can still be deleted.`,
        );
        return;
      }
      if (targetKind === 'camera_move') {
        for (const key of ['targetMode', 'targetId', 'region']) if (key in updates) {
          errors.push(`${prefix}.updates.${key} is request-only and cannot be persisted; use the resolved camera destination fields.`);
          return;
        }
      }
      if (frameCtx && 'frameId' in updates) {
        const fid = (updates as Record<string, unknown>).frameId;
        if (fid == null) {
          // Clearing carries no meaning (association falls back the same
          // way); drop it so the store never persists a null frameId.
          delete (updates as Record<string, unknown>).frameId;
        } else if (!isFrameDrawableKind(targetKind)) {
          // Effect clips and camera moves derive frame association from
          // their targets; a stray frameId is dropped silently.
          delete (updates as Record<string, unknown>).frameId;
        } else if (
          typeof fid !== 'string' ||
          !fid ||
          !frameCtx.frameIds.includes(fid)
        ) {
          errors.push(
            `${prefix}.updates.frameId "${String(fid)}" is not a known frame (known: ${frameCtx.frameIds.join(', ') || 'none'}).`,
          );
          return;
        }
      }
      const known = knownUpdateFields(
        targetKind,
        currentItems.get(itemId) ?? plannedCreateNormalized.get(itemId),
      );
      for (const key of Object.keys(updates)) {
        if (known.has(key)) continue;
        delete (updates as Record<string, unknown>)[key];
        warnings.push(
          `${prefix}.updates.${key} is not a ${targetKind} field and was ignored.`,
        );
      }
      normalizedActions.push({
        action: 'UPDATE',
        itemId,
        updates: normalizeUpdates(
          updates as Partial<SceneItem>,
          targetKind,
          errors,
          prefix,
          currentItems.get(itemId) ?? plannedCreateNormalized.get(itemId),
        ),
      });
      return;
    }

    if (a.action === 'TIMELINE') {
      const edit = normalizeTimelineEdit(a, prefix, errors);
      if (edit) normalizedActions.push({ action: 'TIMELINE', edit });
      return;
    }

    if (a.action === 'DELETE') {
      const itemId = typeof a.itemId === 'string' ? a.itemId : '';
      if (!itemId) {
        errors.push(`${prefix}: DELETE is missing \`itemId\`.`);
        return;
      }
      if (!currentItems.has(itemId) && !plannedCreates.has(itemId)) {
        errors.push(`${prefix}: DELETE target "${itemId}" does not exist.`);
        return;
      }
      normalizedActions.push({ action: 'DELETE', itemId });
      return;
    }

    errors.push(
      `${prefix}.action must be CREATE / UPDATE / DELETE / TIMELINE, got "${String(a.action)}".`,
    );
  });

  // Second pass: verify axes references on graphPlot / graphCurve / graphDot /
  // graphFunctionSeries / graphPointSequence CREATEs, and exit-target references on
  // exit_animation CREATEs.
  for (let i = 0; i < normalizedActions.length; i++) {
    const act = normalizedActions[i]!;
    if (act.action !== 'CREATE') continue;
    const item = act.item;
    if (
      item.kind === 'graphPlot' ||
      item.kind === 'graphCurve' ||
      item.kind === 'graphDot' ||
      item.kind === 'graphFunctionSeries' ||
      item.kind === 'graphPointSequence' ||
      item.kind === 'graphArea' ||
      item.kind === 'graphField'
    ) {
      const axesId = item.axesId;
      const existingIsAxes = currentItems.get(axesId)?.kind === 'axes';
      const plannedKind = plannedCreates.get(axesId);
      if (!existingIsAxes && plannedKind !== 'axes') {
        errors.push(
          `actions[${i}].item "${item.id}" references axesId "${axesId}" but no such axes exists or is being created.`,
        );
      }
      continue;
    }
    if (item.kind === 'exit_animation') {
      const exit = item as ExitAnimationItem;
      for (let ti = 0; ti < exit.targets.length; ti++) {
        const { targetId } = exit.targets[ti]!;
        const existing = currentItems.get(targetId);
        const plannedKind = plannedCreates.get(targetId);
        const resolvedKind = existing?.kind ?? plannedKind;
        if (!resolvedKind) {
          errors.push(
            `actions[${i}].item "${item.id}" targets[${ti}] references unknown item "${targetId}".`,
          );
          continue;
        }
        if (!EXIT_TARGET_KINDS.has(resolvedKind)) {
          errors.push(
            `actions[${i}].item "${item.id}" targets[${ti}] "${targetId}" is a ${resolvedKind}, which cannot be the target of an exit_animation.`,
          );
        }
      }
      continue;
    }
    if (item.kind === 'blink_animation') {
      const blink = item as BlinkAnimationItem;
      for (let ti = 0; ti < blink.targets.length; ti++) {
        const { targetId } = blink.targets[ti]!;
        const existing = currentItems.get(targetId);
        const plannedKind = plannedCreates.get(targetId);
        const resolvedKind = existing?.kind ?? plannedKind;
        if (!resolvedKind) {
          errors.push(
            `actions[${i}].item "${item.id}" targets[${ti}] references unknown item "${targetId}".`,
          );
          continue;
        }
        if (!EXIT_TARGET_KINDS.has(resolvedKind)) {
          errors.push(
            `actions[${i}].item "${item.id}" targets[${ti}] "${targetId}" is a ${resolvedKind}, which cannot be the target of a blink_animation.`,
          );
        }
      }
      continue;
    }
    if (item.kind === 'target_animation') {
      const ta = item as TargetAnimationItem;
      for (let ti = 0; ti < ta.targets.length; ti++) {
        const { targetId } = ta.targets[ti]!;
        const existing = currentItems.get(targetId);
        const plannedKind = plannedCreates.get(targetId);
        const resolvedKind = existing?.kind ?? plannedKind;
        if (!resolvedKind) {
          errors.push(
            `actions[${i}].item "${item.id}" targets[${ti}] references unknown item "${targetId}".`,
          );
          continue;
        }
        if (
          ta.mode === 'graphFollow'
            ? resolvedKind !== 'graphDot'
            : !canBeTargetAnimationTargetKind(ta.mode, resolvedKind)
        ) {
          errors.push(
            `actions[${i}].item "${item.id}" targets[${ti}] "${targetId}" is a ${resolvedKind}, which cannot be the target of a target_animation (${ta.mode}).`,
          );
        }
      }
      continue;
    }
  }

  // Third pass: enforce two-stage text workflow.
  if (frameCtx?.frames) {
    let virtual = new Map(currentItems);
    for (let i = 0; i < normalizedActions.length; i += 1) {
      const action = normalizedActions[i]!;
      if (action.action === 'CREATE') virtual.set(action.item.id, action.item);
      else if (action.action === 'UPDATE') {
        const previous = virtual.get(action.itemId);
        if (previous) virtual.set(action.itemId, { ...previous, ...action.updates } as SceneItem);
      } else if (action.action === 'DELETE') virtual.delete(action.itemId);
      else {
        virtual = applyTimelineEdit(virtual, options.audioItems ?? [], action.edit).items;
        continue;
      }
      if (action.action !== 'DELETE') {
        const candidate = virtual.get(action.action === 'CREATE' ? action.item.id : action.itemId);
        if (candidate?.kind === 'camera_move') {
          for (const diagnostic of validateCameraMove(candidate, frameCtx.frames, virtual)) errors.push(`actions[${i}]: ${diagnostic.message}`);
        }
      }
    }
  }

  checkGraphMotion(normalizedActions, currentItems, errors, warnings);
  checkConnectors(normalizedActions, currentItems, frameCtx, errors);
  checkLiveValueSlopes(normalizedActions, currentItems, errors);
  checkSegmentIndices(normalizedActions, currentItems, errors);
  checkTimelineEdits(currentItems, options.audioItems ?? [], normalizedActions, errors);
  const draftScene = virtualSceneAfter(currentItems, normalizedActions, undefined, options.audioItems);
  const touchedIds = new Set(normalizedActions.map(actionItemId).filter((id): id is ItemId => id != null));
  checkGraphRegions(draftScene, touchedIds, errors);
  checkTextTransforms(draftScene, touchedIds, errors, warnings);

  // Third pass: enforce two-stage text workflow.
  // 1) CREATE textLine must carry source in `raw`.
  // 2) Styling must not be combined with text creation in the same response.
  //    (no styled CREATE, and no UPDATE that styles a textLine created earlier
  //    in this same actions array).
  const createdTextLineIds = new Set<string>();
  for (const act of normalizedActions) {
    if (act.action !== 'CREATE' || act.item.kind !== 'textLine') continue;
    createdTextLineIds.add(act.item.id);
    if (!act.item.raw.trim()) {
      // raw was empty even after the segments-recovery pass → truly no content.
      errors.push(
        `CREATE textLine "${act.item.id}" must include non-empty LaTeX source in \`raw\` (or non-empty \`segments\`).`,
      );
    }
    if (hasTextStyleChange(act.item.segments)) {
      errors.push(
        options.allowStyleAfterCreate
          ? `CREATE textLine "${act.item.id}" includes segment styling. Create it with \`raw\` only, then style its segments with an UPDATE (raw with || splits + segments).`
          : `CREATE textLine "${act.item.id}" includes segment styling. Create text first, then propose styling in a separate turn.`,
      );
    }
  }
  for (const act of normalizedActions) {
    if (options.allowStyleAfterCreate) break;
    if (act.action !== 'UPDATE') continue;
    if (!createdTextLineIds.has(act.itemId)) continue;
    if (updateHasTextStyleChange(act.updates)) {
      errors.push(
        `UPDATE for newly-created textLine "${act.itemId}" includes segment styling in the same response. Split into two approvals.`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    response: {
      reply: replyRaw,
      actions: normalizedActions,
      ...(thinking ? { thinking } : {}),
      ...(normalizeStyleNote(resp.styleNote) ? { styleNote: normalizeStyleNote(resp.styleNote) } : {}),
    },
    warnings,
  };
}

/** A suggested project style note: one trimmed line, or undefined. */
export function normalizeStyleNote(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const note = v.trim().replace(/\s+/g, ' ').slice(0, MAX_COPILOT_NOTE_LENGTH);
  return note || undefined;
}

/** Optional fields a kind may carry even when the stored item omits them. */
const COMMON_OPTIONAL_FIELDS = [
  'frameId',
  'visibleAtSceneStart',
  'audioTrackId',
  'label',
  'layer',
  'startTime',
  'duration',
  'posSteps',
  'x',
  'y',
  'scale',
];
const OPTIONAL_FIELDS_BY_KIND: Partial<Record<SceneItem['kind'], readonly string[]>> = {
  textLine: ['snapBuffer', 'baseDir', 'englishFont', 'animStyle', 'transformConfig', 'raw', 'segments', 'font', 'fontSize'],
  axes: [
    'axisColor', 'axisStrokeWidth', 'tickLength', 'tickColor', 'tickStrokeWidth', 'numberColor',
    'numberFontSize', 'tipShape', 'tipHeight', 'tipWidth', 'tipStrokeWidth', 'tipFillOpacity', 'tipLength',
    'xRange', 'yRange', 'scaleX', 'scaleY', 'xLabel', 'yLabel', 'includeNumbers', 'includeTip',
  ],
  graphPlot: ['lineStyle', 'fn', 'xDomain', 'color', 'strokeWidth'],
  graphCurve: ['lineStyle', 'curve', 'tDomain', 'color', 'strokeWidth', 'jsXExpr', 'pyXExpr', 'jsYExpr', 'pyYExpr', 'exprX', 'xExpr', 'exprY', 'yExpr'],
  graphDot: ['dot', 'axesId', ...GRAPH_DOT_TOP_LEVEL_ALIASES],
  graphFunctionSeries: ['displayMode', 'perN', 'defaults', 'jsExpr', 'pyExpr', 'nMin', 'nMax', 'mode', 'xDomain'],
  graphPointSequence: ['perN', 'defaults', 'jsXExpr', 'pyXExpr', 'jsYExpr', 'pyYExpr', 'exprX', 'xExpr', 'exprY', 'yExpr', 'nMin', 'nMax', 'mode'],
  graphArea: ['area', 'mode', 'fillColor', 'fillOpacity', 'strokeColor', 'strokeWidth', 'introStyle'],
  graphField: [
    'fieldMode', 'jsExprSlope', 'pyExprSlope', 'slopeArrowLength', 'jsExprP', 'pyExprP', 'jsExprQ', 'pyExprQ',
    'fieldGridStep', 'fieldColormap', 'colorSchemeMin', 'colorSchemeMax', 'arrowStrokeWidth', 'streamPoints',
    'streamDt', 'streamVirtualTime',
  ],
  shape: ['endpoints', 'angle'],
  surroundingRect: ['segmentIndices', 'runTime'],
  target_animation: ['targets', 'mode'],
  exit_animation: ['targets'],
  blink_animation: ['targets', 'repetitions'],
  camera_move: ['offsetX', 'offsetY', 'targetFrameId', 'targetWidth', 'follow'],
};

/** Field names an UPDATE may set on an item of this kind. */
function knownUpdateFields(kind: string, existing: SceneItem | undefined): Set<string> {
  const known = new Set<string>(COMMON_OPTIONAL_FIELDS);
  for (const key of OPTIONAL_FIELDS_BY_KIND[kind as SceneItem['kind']] ?? []) known.add(key);
  if (existing) for (const key of Object.keys(existing)) known.add(key);
  known.delete('id');
  known.delete('kind');
  return known;
}

// ── Per-kind normalizers ─────────────────────────────────────────────────

function normalizeCreateItem(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): SceneItem | null {
  const kind = raw.kind as string;
  switch (kind) {
    case 'textLine':
      return normalizeTextLine(raw, errors, prefix);
    case 'axes':
      return normalizeAxes(raw);
    case 'graphPlot':
      return normalizeGraphPlot(raw, errors, prefix);
    case 'graphCurve':
      return normalizeGraphCurve(raw, errors, prefix);
    case 'graphDot':
      return normalizeGraphDot(raw, errors, prefix);
    case 'graphFunctionSeries':
      return normalizeGraphFunctionSeries(raw, errors, prefix);
    case 'graphPointSequence':
      return normalizeGraphPointSequence(raw, errors, prefix);
    case 'graphArea':
      return normalizeGraphArea(raw, baseDefaults(raw), errors, prefix);
    case 'graphField':
      return normalizeGraphField(raw, baseDefaults(raw), errors, prefix);
    case 'shape':
      return normalizeShape(raw, errors, prefix);
    case 'surroundingRect':
      return normalizeSurroundingRect(raw, errors, prefix);
    case 'exit_animation':
      return normalizeExitAnimation(raw, errors, prefix);
    case 'blink_animation':
      return normalizeBlinkAnimation(raw, errors, prefix);
    case 'target_animation':
      return normalizeTargetAnimation(raw, errors, prefix);
    case 'camera_move':
      return normalizeCameraMove(raw, errors, prefix);
    default:
      errors.push(`${prefix}.item.kind "${kind}" is not implemented.`);
      return null;
  }
}

/**
 * Mutate `actions` in place: if a `graphPlot` / `graphCurve` / `graphDot` /
 * `graphFunctionSeries` / `graphPointSequence` CREATE is missing `axesId` and
 * exactly one `axes` is
 * being CREATEd in the same batch, copy that axes' id onto the child. No-op
 * in ambiguous cases — the validator's later axesId-required check will still
 * surface them.
 */
function autoLinkAxesIds(actions: unknown[]): void {
  const axesIds: string[] = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const act = a as Record<string, unknown>;
    if (act.action !== 'CREATE') continue;
    const item = act.item as Record<string, unknown> | undefined;
    if (!item || item.kind !== 'axes') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    if (id) axesIds.push(id);
  }
  if (axesIds.length !== 1) return;
  const onlyAxesId = axesIds[0]!;
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const act = a as Record<string, unknown>;
    if (act.action !== 'CREATE') continue;
    const item = act.item as Record<string, unknown> | undefined;
    if (!item) continue;
    if (
      item.kind !== 'graphPlot' &&
      item.kind !== 'graphCurve' &&
      item.kind !== 'graphDot' &&
      item.kind !== 'graphFunctionSeries' &&
      item.kind !== 'graphPointSequence' &&
      item.kind !== 'graphArea' &&
      item.kind !== 'graphField'
    ) {
      continue;
    }
    if (typeof item.axesId !== 'string' || !item.axesId) {
      item.axesId = onlyAxesId;
    }
  }
}

/**
 * Drawable items carry their own `frameId`; effect clips, camera moves, and
 * surrounding rects derive frame association from their targets (see
 * `associatedFrameId` in `@/lib/frameGrid`). Keep in sync with
 * `isFrameDrawable` in `store/useSceneStore.ts`.
 */
function isFrameDrawableKind(kind: string): boolean {
  return (
    kind !== 'exit_animation' &&
    kind !== 'blink_animation' &&
    kind !== 'target_animation' &&
    kind !== 'camera_move' &&
    kind !== 'surroundingRect'
  );
}

/**
 * Validate / normalize `frameId` on a CREATE item. Explicit unknown frame ids
 * fail loudly; a missing `frameId` on a drawable is stamped with the active
 * (else start) frame, mirroring `addItem` in the store so the preview already
 * shows the clip in the right frame. `frameId` on non-drawables is dropped
 * silently — those clips follow their targets by design.
 */
function applyFrameIdOnCreate(
  rawItem: Record<string, unknown>,
  normalized: SceneItem,
  frameCtx: AgentFrameContext,
  errors: string[],
  prefix: string,
): boolean {
  const out = normalized as unknown as Record<string, unknown>;
  if (!isFrameDrawableKind(normalized.kind)) {
    delete out.frameId;
    return true;
  }
  const explicit =
    typeof rawItem.frameId === 'string' ? rawItem.frameId : '';
  if (explicit) {
    if (!frameCtx.frameIds.includes(explicit)) {
      errors.push(
        `${prefix}.item.frameId "${explicit}" is not a known frame (known: ${frameCtx.frameIds.join(', ') || 'none'}).`,
      );
      return false;
    }
    out.frameId = explicit;
    return true;
  }
  const fallback = frameCtx.activeFrameId ?? frameCtx.startFrameId;
  if (fallback) out.frameId = fallback;
  return true;
}

/**
 * Stable deep equality for JSON-serializable values. Used to tolerate
 * accidental exact-duplicate CREATE actions emitted by flaky preview LLMs.
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (
        !isDeepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

const AXES_TIP_SHAPES: ReadonlySet<AxesTipShape> = new Set<AxesTipShape>([
  'default',
  'ArrowTriangleTip',
  'StealthTip',
  'ArrowSquareTip',
]);

function asOptionalTrimmedStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** Accepts finite numbers only; rejects NaN stored in JSON. */
function asOptionalPositiveNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}

function normalizeAxesTipShape(v: unknown): AxesTipShape | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string') return undefined;
  return AXES_TIP_SHAPES.has(v as AxesTipShape) ? (v as AxesTipShape) : undefined;
}

function baseDefaults(raw: Record<string, unknown>) {
  const visibleAtSceneStart = raw.visibleAtSceneStart === true;
  const startTime = visibleAtSceneStart
    ? 0
    : Math.max(0, asNum(raw.startTime, 0));
  return {
    id: String(raw.id),
    label: asStr(raw.label, ''),
    layer: Math.max(0, asNum(raw.layer, 0)),
    startTime,
    duration: Math.max(0.01, asNum(raw.duration, 2)),
    x: asNum(raw.x, 0),
    y: asNum(raw.y, 0),
    scale: Math.max(0.01, asNum(raw.scale, 1)),
    posSteps: normalizePosSteps(raw.posSteps),
    audioTrackId:
      typeof raw.audioTrackId === 'string' ? raw.audioTrackId : null,
    ...(visibleAtSceneStart ? { visibleAtSceneStart: true as const } : {}),
  };
}

/** Defaults for agent-normalized graphPointSequence; keep in sync with `createGraphPointSequence`. */
const POINT_SEQUENCE_DEFAULTS: PointSequenceDefaults = {
  color: '#3b82f6',
  pointRadius: 0.08,
  animDuration: 0.6,
  waitAfter: 0.2,
};

function normalizePointSequenceDefaults(raw: unknown): PointSequenceDefaults {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    color: asStr(r.color, POINT_SEQUENCE_DEFAULTS.color),
    pointRadius: Math.max(
      0.01,
      asNum(r.pointRadius, POINT_SEQUENCE_DEFAULTS.pointRadius),
    ),
    animDuration: Math.max(
      0,
      asNum(r.animDuration, POINT_SEQUENCE_DEFAULTS.animDuration),
    ),
    waitAfter: Math.max(
      0,
      asNum(r.waitAfter, POINT_SEQUENCE_DEFAULTS.waitAfter),
    ),
  };
}

function normalizePointSequencePerNDict(
  raw: unknown,
): Record<string, PointSequencePerN> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PointSequencePerN> = {};
  for (const [rawKey, rawVal] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const n = Number(rawKey);
    if (!Number.isFinite(n) || !Number.isInteger(n)) continue;
    if (!rawVal || typeof rawVal !== 'object') continue;
    const entry = rawVal as Record<string, unknown>;
    const perN: PointSequencePerN = {};
    if (typeof entry.color === 'string') perN.color = entry.color;
    if (
      typeof entry.pointRadius === 'number' &&
      Number.isFinite(entry.pointRadius)
    ) {
      perN.pointRadius = Math.max(0.01, entry.pointRadius);
    }
    if (
      typeof entry.animDuration === 'number' &&
      Number.isFinite(entry.animDuration)
    ) {
      perN.animDuration = Math.max(0, entry.animDuration);
    }
    const waitRaw =
      typeof entry.waitAfter === 'number'
        ? entry.waitAfter
        : typeof entry.waitAfterSec === 'number'
          ? entry.waitAfterSec
          : undefined;
    if (typeof waitRaw === 'number' && Number.isFinite(waitRaw)) {
      perN.waitAfter = Math.max(0, waitRaw);
    }
    out[String(Math.trunc(n))] = perN;
  }
  return out;
}

/**
 * Coerce per-axis x(n)/y(n) expressions from an UPDATE patch. Returns null
 * when the patch does not touch that axis.
 */
function resolvePointSequenceAxisFromPatch(
  patch: Record<string, unknown>,
  axis: 'x' | 'y',
  errors: string[],
  axisPrefix: string,
): { jsExpr: string; pyExpr: string } | null {
  const jsKey = axis === 'x' ? 'jsXExpr' : 'jsYExpr';
  const pyKey = axis === 'x' ? 'pyXExpr' : 'pyYExpr';
  const aliasKeys =
    axis === 'x' ? ['exprX', 'xExpr'] : ['exprY', 'yExpr'];
  const hasAxis =
    jsKey in patch ||
    pyKey in patch ||
    aliasKeys.some((k) => k in patch);
  if (!hasAxis) return null;

  let js =
    pickStr(patch, jsKey) || pickStrAny(patch, aliasKeys);
  let py = pickStr(patch, pyKey);
  if (js && !py) py = toPyExpr(js);
  if (py && !js) js = toJsExpr(py);
  if (!js || !py) {
    errors.push(
      `${axisPrefix}: ${axis}(n) needs ${jsKey} / ${pyKey} (or aliases ${aliasKeys.join(', ')}) — provide at least one dialect per coordinate.`,
    );
    return null;
  }
  return {
    jsExpr: js.replace(/\^/g, '**'),
    pyExpr: py.replace(/\^/g, '**'),
  };
}

/**
 * Coerce per-axis x(t)/y(t) expressions from a graphCurve UPDATE patch.
 * Reads `curve.*` first, then top-level coordinate keys/aliases (which CREATE
 * also accepts); top-level hits are folded into `curve` by the caller.
 * Returns null when the patch does not touch that axis.
 */
function resolveCurveAxisFromPatch(
  patch: Record<string, unknown>,
  curve: Record<string, unknown> | null,
  axis: 'x' | 'y',
  errors: string[],
  axisPrefix: string,
): { jsExpr: string; pyExpr: string } | null {
  const jsKey = axis === 'x' ? 'jsXExpr' : 'jsYExpr';
  const pyKey = axis === 'x' ? 'pyXExpr' : 'pyYExpr';
  const aliasKeys =
    axis === 'x' ? ['exprX', 'xExpr'] : ['exprY', 'yExpr'];
  const hasAxis =
    (curve &&
      (jsKey in curve ||
        pyKey in curve ||
        aliasKeys.some((k) => k in curve))) ||
    jsKey in patch ||
    pyKey in patch ||
    aliasKeys.some((k) => k in patch);
  if (!hasAxis) return null;

  let js =
    (curve && (pickStr(curve, jsKey) || pickStrAny(curve, aliasKeys))) ||
    pickStr(patch, jsKey) ||
    pickStrAny(patch, aliasKeys);
  let py =
    (curve && pickStr(curve, pyKey)) || pickStr(patch, pyKey);
  if (js && !py) py = toPyExpr(js);
  if (py && !js) js = toJsExpr(py);
  if (!js || !py) {
    errors.push(
      `${axisPrefix}: ${axis}(t) needs ${jsKey} / ${pyKey} (or aliases ${aliasKeys.join(', ')}) — provide at least one dialect per coordinate.`,
    );
    return null;
  }
  return {
    jsExpr: js.replace(/\^/g, '**'),
    pyExpr: py.replace(/\^/g, '**'),
  };
}

function normalizeUpdates(
  updates: Partial<SceneItem>,
  targetKind: string,
  errors: string[],
  prefix: string,
  existing?: SceneItem,
): Partial<SceneItem> {
  const patch = updates as Record<string, unknown>;
  const next: Record<string, unknown> = { ...patch };
  if (targetKind === 'graphDot') {
    // `dot` is one nested object in the store; merge the patch over the stored dot so a partial
    // patch (e.g. only `attachment`) never wipes color/label. Top-level aliases fold into it.
    const dotPatch = collectDotPatch(patch);
    for (const key of GRAPH_DOT_TOP_LEVEL_ALIASES) delete next[key];
    if (dotPatch) {
      const base = existing?.kind === 'graphDot' ? existing.dot : undefined;
      const merged = normalizeGraphDotFields(dotPatch, base, `${prefix}.updates.dot`, errors);
      if (merged) next.dot = merged;
      else delete next.dot;
    }
  }
  if ('posSteps' in patch) {
    next.posSteps = normalizePosSteps(patch.posSteps);
  }
  if (targetKind === 'graphArea') {
    // The model sends geometry as `area` (merged over the stored `mode`); persist it as `mode`.
    const areaPatch = 'area' in patch ? patch.area : typeof patch.mode === 'object' ? patch.mode : undefined;
    delete next.area;
    delete next.mode;
    if (areaPatch !== undefined) {
      const base = existing?.kind === 'graphArea' ? existing.mode : undefined;
      const mode = normalizeAreaMode(areaPatch, `${prefix}.updates.area`, errors, base);
      if (mode) next.mode = mode;
    }
    if ('fillOpacity' in patch) next.fillOpacity = Math.max(0, Math.min(1, asNum(patch.fillOpacity, 0.35)));
    if ('introStyle' in patch) {
      const style = normalizeAreaIntroStyle(patch.introStyle, `${prefix}.updates.introStyle`, errors);
      if (style) next.introStyle = style;
      else delete next.introStyle;
    }
  }
  if (targetKind === 'graphField') {
    const fieldKeys = OPTIONAL_FIELDS_BY_KIND.graphField!;
    for (const key of fieldKeys) delete next[key];
    Object.assign(
      next,
      normalizeFieldFields(patch, `${prefix}.updates`, errors, existing?.kind === 'graphField' ? existing : undefined),
    );
  }
  if (targetKind === 'shape' && 'endpoints' in patch && patch.endpoints != null) {
    const endpoints = normalizeShapeEndpoints(patch.endpoints, `${prefix}.updates.endpoints`, errors);
    if (endpoints) next.endpoints = endpoints;
    else delete next.endpoints;
  }
  if (targetKind === 'shape' && 'angle' in patch && patch.angle != null) {
    const angle = normalizeShapeAngle(patch.angle, `${prefix}.updates.angle`, errors);
    if (angle) next.angle = angle;
    else delete next.angle;
  }
  if (targetKind === 'textLine') {
    if ('baseDir' in patch) next.baseDir = normalizeTextBaseDir(patch.baseDir);
    if ('englishFont' in patch) next.englishFont = normalizeEnglishFont(patch.englishFont);
    if ('animStyle' in patch) next.animStyle = normalizeAnimStyle(patch.animStyle, `${prefix}.updates.animStyle`, errors);
    if ('transformConfig' in patch) {
      next.transformConfig = normalizeTransformConfig(patch.transformConfig, `${prefix}.updates.transformConfig`, errors);
      if (next.transformConfig && !('animStyle' in patch)) next.animStyle = 'transform';
    }
  }
  if (targetKind === 'graphFunctionSeries') {
    if ('perN' in patch) {
      // Coerce perN entries: stringify integer keys, drop unknown fields,
      // map `waitAfterSec` → `waitAfter`. commit.ts is responsible for the
      // deep-merge against the store; this pass only ensures the patch is
      // well-typed.
      next.perN = normalizePerNDict(patch.perN);
    }
    if ('defaults' in patch) {
      // Merge user-supplied defaults over the factory defaults so any fields
      // the LLM omitted still carry a sane value — but apply on top of the
      // real store entry happens in commit.ts (deep-merge with existing).
      next.defaults = normalizeFunctionSeriesDefaults(patch.defaults);
    }
    if ('nMin' in patch || 'nMax' in patch) {
      const hasMin = 'nMin' in patch;
      const hasMax = 'nMax' in patch;
      let nMin = hasMin
        ? Math.trunc(asNum(patch.nMin, 1))
        : (undefined as number | undefined);
      let nMax = hasMax
        ? Math.trunc(asNum(patch.nMax, 5))
        : (undefined as number | undefined);
      if (hasMin && hasMax && nMin! > nMax!) {
        [nMin, nMax] = [nMax, nMin];
      }
      if (hasMin) next.nMin = nMin;
      if (hasMax) next.nMax = nMax;
    }
    if ('mode' in patch) {
      next.mode = asFunctionSeriesMode(patch.mode, 'accumulation');
    }
    if ('jsExpr' in patch || 'pyExpr' in patch) {
      // `resolveFnExprs` reads patch.jsExpr / patch.pyExpr, converts `^` to
      // `**`, and fills in the missing dialect when the LLM only sent one.
      const { jsExpr, pyExpr } = resolveFnExprs(patch);
      next.jsExpr = jsExpr;
      next.pyExpr = pyExpr;
    }
  }
  if (targetKind === 'graphPointSequence') {
    if ('perN' in patch) {
      next.perN = normalizePointSequencePerNDict(patch.perN);
    }
    if ('defaults' in patch) {
      next.defaults = normalizePointSequenceDefaults(patch.defaults);
    }
    if ('nMin' in patch || 'nMax' in patch) {
      const hasMin = 'nMin' in patch;
      const hasMax = 'nMax' in patch;
      let nMin = hasMin
        ? Math.trunc(asNum(patch.nMin, 1))
        : (undefined as number | undefined);
      let nMax = hasMax
        ? Math.trunc(asNum(patch.nMax, 5))
        : (undefined as number | undefined);
      if (hasMin && hasMax && nMin! > nMax!) {
        [nMin, nMax] = [nMax, nMin];
      }
      if (hasMin) next.nMin = nMin;
      if (hasMax) next.nMax = nMax;
    }
    if ('mode' in patch) {
      next.mode = asFunctionSeriesMode(patch.mode, 'accumulation');
    }
    const upPrefix = `${prefix}.updates`;
    const xPair = resolvePointSequenceAxisFromPatch(
      patch,
      'x',
      errors,
      upPrefix,
    );
    if (xPair) {
      next.jsXExpr = xPair.jsExpr;
      next.pyXExpr = xPair.pyExpr;
    }
    const yPair = resolvePointSequenceAxisFromPatch(
      patch,
      'y',
      errors,
      upPrefix,
    );
    if (yPair) {
      next.jsYExpr = yPair.jsExpr;
      next.pyYExpr = yPair.pyExpr;
    }
  }
  if (targetKind === 'graphPlot') {
    // Repair `fn` expression updates the same way CREATE does (`^` → `**`,
    // alias rescue, single-dialect derivation) without touching sibling
    // fields like `color`. Untouched when the patch carries no expressions
    // so color-only updates never invent a sine default.
    const fnRaw = patch.fn;
    if (typeof fnRaw === 'string' && fnRaw.trim()) {
      const { jsExpr, pyExpr } = resolveFnExprs({ fn: fnRaw });
      next.fn = { jsExpr, pyExpr };
    } else if (fnRaw && typeof fnRaw === 'object' && !Array.isArray(fnRaw)) {
      const fr = fnRaw as Record<string, unknown>;
      const exprKeys = [
        'jsExpr',
        'jsExpression',
        'pyExpr',
        'pyExpression',
        'expr',
        'expression',
        'formula',
        'function',
        'equation',
      ];
      const touchesExpr =
        exprKeys.some(
          (k) => typeof fr[k] === 'string' && (fr[k] as string).trim(),
        ) ||
        exprKeys.some(
          (k) => typeof patch[k] === 'string' && (patch[k] as string).trim(),
        );
      if (touchesExpr) {
        const { jsExpr, pyExpr } = resolveFnExprs({ ...patch, fn: fr });
        next.fn = { ...fr, jsExpr, pyExpr };
      }
    }
  }
  if (targetKind === 'graphCurve') {
    // Repair `curve` coordinate updates (`^` → `**`, single-dialect
    // derivation). Top-level coordinate keys are folded into `curve`
    // (CREATE accepts them there); unrelated `curve` fields pass through
    // and commit deep-merges the result over the stored curve.
    const curveRaw = patch.curve;
    const curveRec =
      curveRaw && typeof curveRaw === 'object' && !Array.isArray(curveRaw)
        ? (curveRaw as Record<string, unknown>)
        : null;
    const upPrefix = `${prefix}.updates`;
    const xPair = resolveCurveAxisFromPatch(
      patch,
      curveRec,
      'x',
      errors,
      upPrefix,
    );
    const yPair = resolveCurveAxisFromPatch(
      patch,
      curveRec,
      'y',
      errors,
      upPrefix,
    );
    if (xPair || yPair) {
      const mergedCurve: Record<string, unknown> = { ...(curveRec ?? {}) };
      if (xPair) {
        mergedCurve.jsXExpr = xPair.jsExpr;
        mergedCurve.pyXExpr = xPair.pyExpr;
        for (const k of ['jsXExpr', 'pyXExpr', 'exprX', 'xExpr']) {
          delete (next as Record<string, unknown>)[k];
        }
      }
      if (yPair) {
        mergedCurve.jsYExpr = yPair.jsExpr;
        mergedCurve.pyYExpr = yPair.pyExpr;
        for (const k of ['jsYExpr', 'pyYExpr', 'exprY', 'yExpr']) {
          delete (next as Record<string, unknown>)[k];
        }
      }
      next.curve = mergedCurve;
    }
  }
  if (targetKind === 'target_animation' && 'mode' in patch) {
    const mode = patch.mode == null ? null : asTargetAnimationMode(patch.mode);
    if (mode) next.mode = mode;
    else errors.push(`${prefix}.updates.mode "${String(patch.mode)}" is not a target_animation mode (${TA_MODES.join(', ')}).`);
  }
  if (targetKind === 'target_animation' && Array.isArray(patch.targets)) {
    // Repair `parametricPath` expressions inside UPDATE rows (`^` → `**`,
    // single-dialect derivation). Rows and all non-expression fields pass
    // through untouched; axes the patch does not mention are left alone.
    next.targets = (patch.targets as unknown[]).map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const r = row as Record<string, unknown>;
      const pp = r.parametricPath;
      if (!pp || typeof pp !== 'object' || Array.isArray(pp)) return r;
      const ppr = pp as Record<string, unknown>;
      const nextPP: Record<string, unknown> = { ...ppr };
      let touched = false;
      for (const [jsK, pyK] of [
        ['jsXExpr', 'pyXExpr'],
        ['jsYExpr', 'pyYExpr'],
      ] as const) {
        const pair = repairParametricAxis(ppr[jsK], ppr[pyK]);
        if (!pair) continue;
        nextPP[jsK] = pair.jsExpr;
        nextPP[pyK] = pair.pyExpr;
        touched = true;
      }
      return touched ? { ...r, parametricPath: nextPP } : r;
    });
  }
  if ('visibleAtSceneStart' in patch) {
    if (patch.visibleAtSceneStart === true) {
      next.visibleAtSceneStart = true;
      next.startTime = 0;
    } else {
      next.visibleAtSceneStart = undefined;
    }
  }
  return next as Partial<SceneItem>;
}

function normalizePosSteps(rawPosSteps: unknown): PosStep[] {
  if (!Array.isArray(rawPosSteps) || rawPosSteps.length === 0) {
    return [{ kind: 'absolute' as const }];
  }
  const out: PosStep[] = [];
  for (const raw of rawPosSteps) {
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as Record<string, unknown>;
    const kind = step.kind;
    if (kind === 'absolute') {
      out.push({ kind: 'absolute' });
      continue;
    }
    if (kind === 'next_to') {
      out.push({
        kind: 'next_to',
        refKind:
          step.refKind === 'line' || step.refKind === 'axes' || step.refKind === 'shape'
            ? step.refKind
            : 'line',
        refId: typeof step.refId === 'string' ? step.refId : null,
        dir: asDir(step.dir, 'RIGHT'),
        buff: Math.max(0, asNum(step.buff, 0.3)),
        alignedEdge: asNullableDir(step.alignedEdge),
        refSegmentIndex:
          typeof step.refSegmentIndex === 'number' && Number.isFinite(step.refSegmentIndex)
            ? Math.max(0, Math.trunc(step.refSegmentIndex))
            : null,
        selfSegmentIndex:
          typeof step.selfSegmentIndex === 'number' && Number.isFinite(step.selfSegmentIndex)
            ? Math.max(0, Math.trunc(step.selfSegmentIndex))
            : null,
        bounds:
          step.bounds === 'mobject' || step.bounds === 'ink' || step.bounds === null
            ? (step.bounds as 'mobject' | 'ink' | null)
            : null,
      });
      continue;
    }
    if (kind === 'to_edge') {
      out.push({
        kind: 'to_edge',
        edge: asDir(step.edge, 'UP'),
        buff: Math.max(0, asNum(step.buff, 0.3)),
        bounds:
          step.bounds === 'mobject' || step.bounds === 'ink' || step.bounds === null
            ? (step.bounds as 'mobject' | 'ink' | null)
            : null,
      });
      continue;
    }
    if (kind === 'shift') {
      out.push({
        kind: 'shift',
        dx: asNum(step.dx, 0),
        dy: asNum(step.dy, 0),
      });
      continue;
    }
    if (kind === 'set_x') {
      out.push({
        kind: 'set_x',
        x: asNum(step.x, 0),
      });
      continue;
    }
    if (kind === 'set_y') {
      out.push({
        kind: 'set_y',
        y: asNum(step.y, 0),
      });
      continue;
    }
  }
  return out.length > 0 ? out : [{ kind: 'absolute' as const }];
}

function asDir(v: unknown, fallback: ManimDirection): ManimDirection {
  if (
    v === 'UP' ||
    v === 'DOWN' ||
    v === 'LEFT' ||
    v === 'RIGHT' ||
    v === 'UL' ||
    v === 'UR' ||
    v === 'DL' ||
    v === 'DR'
  ) {
    return v;
  }
  return fallback;
}

function asNullableDir(v: unknown): ManimDirection | null {
  if (v == null) return null;
  return asDir(v, 'UP');
}

/**
 * Reconstruct a LaTeX source string from a segments array.
 * Used as a fallback when the agent emits segments but leaves `raw` empty.
 * Text segments are joined as-is; math segments are wrapped in `$...$`.
 */
function rawFromSegments(segments: TextLineItem['segments']): string {
  return segments
    .map((s) => (s.isMath ? `$${s.text}$` : s.text))
    .join('');
}

/** `animStyle` and `transformConfig` of a created line; a transform source implies animStyle "transform". */
function textAnimFields(raw: Record<string, unknown>, errors: string[], prefix: string): Pick<TextLineItem, 'animStyle' | 'transformConfig'> {
  const transformConfig = normalizeTransformConfig(raw.transformConfig, `${prefix}.item.transformConfig`, errors);
  const animStyle = normalizeAnimStyle(raw.animStyle, `${prefix}.item.animStyle`, errors) ?? (transformConfig ? 'transform' : undefined);
  return { animStyle, transformConfig };
}

function normalizeCameraMove(raw: Record<string, unknown>, errors: string[], prefix: string): CameraMoveItem | null {
  const targetFrameId = typeof raw.targetFrameId === 'string' ? raw.targetFrameId.trim() : '';
  if (!targetFrameId) { errors.push(`${prefix}.item.targetFrameId is required for camera_move.`); return null; }
  const duration = typeof raw.duration === 'number' ? raw.duration : DEFAULT_CAMERA_DURATION;
  if (!Number.isFinite(duration) || duration < MIN_CAMERA_DURATION) errors.push(`${prefix}.item.duration must be at least ${MIN_CAMERA_DURATION}s.`);
  const targetWidth = raw.targetWidth == null ? FRAME_W : raw.targetWidth;
  if (typeof targetWidth !== 'number' || !Number.isFinite(targetWidth) || targetWidth <= 0) errors.push(`${prefix}.item.targetWidth must be finite and positive.`);
  for (const key of ['startTime', 'offsetX', 'offsetY'] as const) if (raw[key] != null && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]))) errors.push(`${prefix}.item.${key} must be finite.`);
  if (typeof raw.startTime === 'number' && raw.startTime < 0) errors.push(`${prefix}.item.startTime must be non-negative.`);
  const base = baseDefaults({ ...raw, duration });
  const out: Record<string, unknown> = { id: base.id, kind: 'camera_move', label: base.label, layer: base.layer, startTime: base.startTime, duration, targetFrameId, targetWidth, offsetX: typeof raw.offsetX === 'number' ? raw.offsetX : 0, offsetY: typeof raw.offsetY === 'number' ? raw.offsetY : 0 };
  const follow = raw.follow as { targetId?: unknown } | null | undefined;
  if (follow && typeof follow === 'object' && typeof follow.targetId === 'string' && follow.targetId.trim()) out.follow = { targetId: follow.targetId.trim() };
  delete out.targetMode; delete out.targetId; delete out.region;
  return out as unknown as CameraMoveItem;
}

/** `ltr` or nothing: an absent base direction means right-to-left. */
function normalizeTextBaseDir(v: unknown): TextLineItem['baseDir'] {
  return v === 'ltr' ? 'ltr' : undefined;
}

/** Trimmed font name, or nothing for "same as the Hebrew font". */
function normalizeEnglishFont(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function normalizeTextLine(raw: Record<string, unknown>, errors: string[], prefix: string): TextLineItem {
  const rawForBase =
    raw.animStyle === 'transform' && raw.visibleAtSceneStart === true
      ? { ...raw, visibleAtSceneStart: false }
      : raw;
  const base = baseDefaults(rawForBase);
  const segments = Array.isArray(raw.segments)
    ? (raw.segments as TextLineItem['segments'])
    : [];

  // If the agent omitted `raw` but populated `segments`, recover the source.
  let texSource = asStr(raw.raw, '');
  if (!texSource.trim() && segments.length > 0) {
    texSource = rawFromSegments(segments);
  }

  return {
    ...base,
    kind: 'textLine',
    snapBuffer: 0.3,
    raw: texSource,
    font: asStr(raw.font, DEFAULT_FONT),
    fontSize: asNum(raw.fontSize, DEFAULT_FONT_SIZE),
    baseDir: normalizeTextBaseDir(raw.baseDir),
    englishFont: normalizeEnglishFont(raw.englishFont),
    ...textAnimFields(raw, errors, prefix),
    segments,
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
    mathChildMeasures: null,
  };
}

function hasTextStyleChange(segments: TextLineItem['segments']): boolean {
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.bold || seg.italic) return true;
    if (typeof seg.color === 'string' && seg.color !== '#ffffff') return true;
  }
  return false;
}

function updateHasTextStyleChange(updates: Partial<SceneItem>): boolean {
  const patch = updates as Record<string, unknown>;
  if (typeof patch.bold === 'boolean' || typeof patch.italic === 'boolean') {
    return true;
  }
  if (typeof patch.color === 'string' && patch.color !== '#ffffff') {
    return true;
  }
  if (Array.isArray(patch.segments)) {
    return hasTextStyleChange(patch.segments as TextLineItem['segments']);
  }
  return false;
}

function normalizeAxes(raw: Record<string, unknown>): AxesItem {
  const base = baseDefaults(raw);
  const xRange = Array.isArray(raw.xRange) && raw.xRange.length === 3
    ? (raw.xRange as AxesItem['xRange'])
    : ([-5, 5, 1] as AxesItem['xRange']);
  const yRange = Array.isArray(raw.yRange) && raw.yRange.length === 3
    ? (raw.yRange as AxesItem['yRange'])
    : ([-3, 3, 1] as AxesItem['yRange']);
  const tipShape = normalizeAxesTipShape(raw.tipShape);
  const axisStrokeWidthRaw = asOptionalPositiveNum(raw.axisStrokeWidth);
  const axisStrokeWidth =
    axisStrokeWidthRaw !== undefined
      ? Math.max(0.5, axisStrokeWidthRaw)
      : undefined;

  const tipHeightRaw = asOptionalPositiveNum(raw.tipHeight);
  const tipLengthLegacy = asOptionalPositiveNum(raw.tipLength);
  let tipHeight: number | undefined;
  if (tipHeightRaw !== undefined) {
    tipHeight = Math.max(0.05, tipHeightRaw);
  } else if (tipLengthLegacy !== undefined) {
    tipHeight = Math.max(0.05, tipLengthLegacy);
  }

  const tipWidthRaw = asOptionalPositiveNum(raw.tipWidth);
  const tipWidth =
    tipWidthRaw !== undefined ? Math.max(0.05, tipWidthRaw) : undefined;

  const tipStrokeWidthRaw = asOptionalPositiveNum(raw.tipStrokeWidth);
  const tipStrokeWidth =
    tipStrokeWidthRaw !== undefined ? Math.max(0, tipStrokeWidthRaw) : undefined;
  const tipFillOpacityRaw = asOptionalPositiveNum(raw.tipFillOpacity);
  const tipFillOpacity =
    tipFillOpacityRaw !== undefined
      ? Math.max(0, Math.min(1, tipFillOpacityRaw))
      : undefined;

  const tickLengthRaw = asOptionalPositiveNum(raw.tickLength);
  const tickLength =
    tickLengthRaw !== undefined ? Math.max(0.01, tickLengthRaw) : undefined;
  const tickStrokeWidthRaw = asOptionalPositiveNum(raw.tickStrokeWidth);
  const tickStrokeWidth =
    tickStrokeWidthRaw !== undefined
      ? Math.max(0.5, tickStrokeWidthRaw)
      : undefined;
  const numberFontSizeRaw = asOptionalPositiveNum(raw.numberFontSize);
  const numberFontSize =
    numberFontSizeRaw !== undefined
      ? Math.max(1, numberFontSizeRaw)
      : undefined;

  return {
    ...base,
    kind: 'axes',
    xRange,
    yRange,
    xLabel: asStr(raw.xLabel, 'x'),
    yLabel: asStr(raw.yLabel, 'y'),
    includeNumbers: asBool(raw.includeNumbers, false),
    includeTip: asBool(raw.includeTip, true),
    scaleX: Math.max(0.01, asNum(raw.scaleX, 1)),
    scaleY: Math.max(0.01, asNum(raw.scaleY, 1)),
    axisColor: asOptionalTrimmedStr(raw.axisColor),
    axisStrokeWidth,
    tickLength,
    tickColor: asOptionalTrimmedStr(raw.tickColor),
    tickStrokeWidth,
    numberColor: asOptionalTrimmedStr(raw.numberColor),
    numberFontSize,
    tipShape: tipShape === 'default' ? undefined : tipShape,
    tipHeight,
    tipWidth,
    tipStrokeWidth,
    tipFillOpacity,
    axisPreviewDataUrl: null,
    axisPreviewError: null,
    axisPreviewHash: null,
    axisPreviewBounds: null,
  };
}

function normalizeGraphPlot(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): GraphPlotItem | null {
  const base = baseDefaults(raw);
  const axesId = typeof raw.axesId === 'string' ? raw.axesId : '';
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphPlot.`);
    return null;
  }
  const { jsExpr, pyExpr } = resolveFnExprs(raw);
  const fnRaw = ((raw.fn ?? {}) as Record<string, unknown>);
  return {
    ...base,
    kind: 'graphPlot',
    axesId,
    fn: {
      id: asStr(fnRaw.id, base.id + '_fn'),
      jsExpr,
      pyExpr,
      color: asStr(fnRaw.color, '#3b82f6'),
      label: asStr(fnRaw.label, ''),
    },
    xDomain:
      Array.isArray(raw.xDomain) && raw.xDomain.length === 2
        ? (raw.xDomain as [number, number])
        : null,
    strokeWidth: asNum(raw.strokeWidth, 2),
    lineStyle: asLineStyle(raw.lineStyle, 'solid'),
  };
}

/**
 * Resolve x(t) / y(t) expressions for graphCurve — at least one dialect per
 * coordinate must be present (the other may be derived), matching
 * graphFunctionSeries strictness (no silent defaults).
 */
function resolveParametricCoordinateExprs(
  itemRaw: Record<string, unknown>,
  curveRaw: Record<string, unknown>,
  axis: 'x' | 'y',
  errors: string[],
  curvePrefix: string,
): { jsExpr: string; pyExpr: string } | null {
  const jsKey = axis === 'x' ? 'jsXExpr' : 'jsYExpr';
  const pyKey = axis === 'x' ? 'pyXExpr' : 'pyYExpr';
  const aliasKeys =
    axis === 'x'
      ? ['exprX', 'xExpr']
      : ['exprY', 'yExpr'];

  let js =
    pickStr(curveRaw, jsKey) ||
    pickStr(itemRaw, jsKey) ||
    pickStrAny(curveRaw, aliasKeys) ||
    pickStrAny(itemRaw, aliasKeys);
  let py =
    pickStr(curveRaw, pyKey) ||
    pickStr(itemRaw, pyKey);

  if (js && !py) py = toPyExpr(js);
  if (py && !js) js = toJsExpr(py);
  if (!js || !py) {
    errors.push(
      `${curvePrefix}: ${axis}(t) needs ${jsKey} / ${pyKey} — provide at least one dialect per coordinate (aliases: ${aliasKeys.join(', ')}).`,
    );
    return null;
  }
  return {
    jsExpr: js.replace(/\^/g, '**'),
    pyExpr: py.replace(/\^/g, '**'),
  };
}

function normalizeGraphCurve(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): GraphCurveItem | null {
  const base = baseDefaults(raw);
  const axesId = typeof raw.axesId === 'string' ? raw.axesId : '';
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphCurve.`);
    return null;
  }
  const curveRaw = ((raw.curve ?? {}) as Record<string, unknown>);
  const curvePrefix = `${prefix}.item.curve`;
  const xPair = resolveParametricCoordinateExprs(
    raw,
    curveRaw,
    'x',
    errors,
    curvePrefix,
  );
  const yPair = resolveParametricCoordinateExprs(
    raw,
    curveRaw,
    'y',
    errors,
    curvePrefix,
  );
  if (!xPair || !yPair) return null;

  let tDomain: [number, number];
  if (Array.isArray(raw.tDomain) && raw.tDomain.length === 2) {
    const ta = Number((raw.tDomain as number[])[0]);
    const tb = Number((raw.tDomain as number[])[1]);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) {
      errors.push(`${prefix}.item.tDomain must be two finite numbers.`);
      return null;
    }
    tDomain = [ta, tb];
  } else {
    tDomain = [0, Math.PI * 2];
  }

  return {
    ...base,
    kind: 'graphCurve',
    axesId,
    curve: {
      id: asStr(curveRaw.id, base.id + '_curve'),
      jsXExpr: xPair.jsExpr,
      jsYExpr: yPair.jsExpr,
      pyXExpr: xPair.pyExpr,
      pyYExpr: yPair.pyExpr,
      color: asStr(curveRaw.color, '#3b82f6'),
      label: asStr(curveRaw.label, ''),
    },
    tDomain,
    strokeWidth: asNum(raw.strokeWidth, 2),
    lineStyle: asLineStyle(raw.lineStyle, 'solid'),
  };
}

/**
 * Resolve jsExpr / pyExpr from a raw graphPlot item, forgiving common model
 * mistakes so we don't silently fall back to the default sine wave:
 *   - fn.jsExpr / fn.pyExpr                        (canonical)
 *   - fn.expr / fn.expression / fn.formula         (string alias)
 *   - fn as a bare string (e.g. `fn: "x^2"`)
 *   - item.jsExpr / item.pyExpr / item.expr / ...  (one level up)
 * If only one dialect is provided, derive the other (^ → ** for Python).
 * Falls back to sine defaults only when nothing resembling an expression
 * was emitted.
 */
function resolveFnExprs(
  raw: Record<string, unknown>,
  opts: { jsDefault?: string; pyDefault?: string } = {},
): { jsExpr: string; pyExpr: string } {
  const fnAny = raw.fn;
  const fn: Record<string, unknown> =
    fnAny && typeof fnAny === 'object' && !Array.isArray(fnAny)
      ? (fnAny as Record<string, unknown>)
      : {};
  const fnString = typeof fnAny === 'string' ? fnAny : '';

  const aliasKeys = ['expr', 'expression', 'formula', 'function', 'equation'];
  let js =
    pickStr(fn, 'jsExpr') ||
    pickStr(fn, 'jsExpression') ||
    pickStrAny(fn, aliasKeys) ||
    fnString ||
    pickStr(raw, 'jsExpr') ||
    pickStrAny(raw, aliasKeys);
  let py =
    pickStr(fn, 'pyExpr') ||
    pickStr(fn, 'pyExpression') ||
    pickStr(raw, 'pyExpr');

  if (js && !py) py = toPyExpr(js);
  if (py && !js) js = toJsExpr(py);
  if (!js && !py) {
    js = opts.jsDefault ?? 'Math.sin(x)';
    py = opts.pyDefault ?? 'np.sin(x)';
  }
  // Normalize `^` to `**` on BOTH sides — `^` is XOR (not power) in both
  // JavaScript and Python, and users / models almost always mean power.
  return { jsExpr: js!.replace(/\^/g, '**'), pyExpr: py!.replace(/\^/g, '**') };
}

function pickStr(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === 'string' && v.trim() ? v : '';
}
function pickStrAny(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = pickStr(o, k);
    if (v) return v;
  }
  return '';
}

/** Best-effort conversion of a generic `x^2`-style expression into Python. */
function toPyExpr(src: string): string {
  return src
    .replace(/\^/g, '**')
    .replace(/\bMath\.(\w+)/g, 'np.$1');
}
/** Best-effort conversion of a Python-flavored expression into JS. */
function toJsExpr(src: string): string {
  return src
    .replace(/\*\*/g, '^^TEMP^^') // stash Python power so ^ rewrite below is unambiguous
    .replace(/\bnp\.(\w+)/g, 'Math.$1')
    .replace(/\^\^TEMP\^\^/g, '**')
    .replace(/\^/g, '**');
}

/**
 * Repair one `x(t)`/`y(t)`-style expression axis shared by graphCurve
 * coordinates and target_animation parametric paths: `^` → `**` on both
 * dialects plus single-dialect derivation. Returns null when neither side
 * carries content, so partial UPDATEs never invent expressions.
 */
function repairParametricAxis(
  jsRaw: unknown,
  pyRaw: unknown,
): { jsExpr: string; pyExpr: string } | null {
  const js = typeof jsRaw === 'string' && jsRaw.trim() ? jsRaw.trim() : '';
  const py = typeof pyRaw === 'string' && pyRaw.trim() ? pyRaw.trim() : '';
  if (!js && !py) return null;
  const outJs = js || toJsExpr(py);
  const outPy = py || toPyExpr(js);
  return {
    jsExpr: outJs.replace(/\^/g, '**'),
    pyExpr: outPy.replace(/\^/g, '**'),
  };
}

/**
 * Resolve jsExpr/pyExpr for graphFunctionSeries (top-level only). Unlike
 * graphPlot, there is no silent default curve — at least one dialect or alias
 * must be present so both sides can be derived.
 */
function resolveGraphFunctionSeriesExprs(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): { jsExpr: string; pyExpr: string } | null {
  const aliasKeys = ['expr', 'expression', 'formula', 'function', 'equation'];
  let js =
    pickStr(raw, 'jsExpr') ||
    pickStr(raw, 'jsExpression') ||
    pickStrAny(raw, aliasKeys);
  let py =
    pickStr(raw, 'pyExpr') ||
    pickStr(raw, 'pyExpression');
  if (js && !py) py = toPyExpr(js);
  if (py && !js) js = toJsExpr(py);
  if (!js || !py) {
    errors.push(
      `${prefix}.item requires jsExpr/pyExpr (or top-level expr/expression/formula alias); omitting both is not allowed for graphFunctionSeries.`,
    );
    return null;
  }
  return {
    jsExpr: js.replace(/\^/g, '**'),
    pyExpr: py.replace(/\^/g, '**'),
  };
}

function collectDotPatch(raw: Record<string, unknown>): Record<string, unknown> | null {
  const nested =
    raw.dot && typeof raw.dot === 'object' && !Array.isArray(raw.dot)
      ? { ...(raw.dot as Record<string, unknown>) }
      : null;
  const out: Record<string, unknown> = nested ?? {};
  let any = nested != null;
  for (const key of GRAPH_DOT_TOP_LEVEL_ALIASES) {
    if (key in raw && !(key in out)) {
      out[key] = raw[key];
      any = true;
    }
  }
  return any ? out : null;
}

function normalizeDotAttachment(
  v: unknown,
  path: string,
  errors: string[],
): GraphDotAttachment | undefined | null {
  if (v == null) return undefined;
  if (v === 'free') return { kind: 'free' };
  if (typeof v !== 'object' || Array.isArray(v)) {
    errors.push(`${path} must be an object like { kind: "function", graphPlotId, x }.`);
    return null;
  }
  const r = v as Record<string, unknown>;
  const kind =
    typeof r.kind === 'string'
      ? r.kind
      : typeof r.graphPlotId === 'string'
        ? 'function'
        : typeof r.graphCurveId === 'string'
          ? 'parametric'
          : '';
  if (kind === 'free') return { kind: 'free' };
  if (kind === 'function') {
    const graphPlotId = typeof r.graphPlotId === 'string' ? r.graphPlotId.trim() : '';
    const x = typeof r.x === 'number' ? r.x : Number(r.x);
    if (!graphPlotId || !Number.isFinite(x)) {
      errors.push(`${path}: a function attachment needs graphPlotId and a finite x.`);
      return null;
    }
    return { kind: 'function', graphPlotId, x };
  }
  if (kind === 'parametric') {
    const graphCurveId = typeof r.graphCurveId === 'string' ? r.graphCurveId.trim() : '';
    const t = typeof r.t === 'number' ? r.t : Number(r.t);
    if (!graphCurveId || !Number.isFinite(t)) {
      errors.push(`${path}: a parametric attachment needs graphCurveId and a finite t.`);
      return null;
    }
    return { kind: 'parametric', graphCurveId, t };
  }
  errors.push(`${path}.kind must be "free", "function" or "parametric".`);
  return null;
}

/**
 * Normalize a (possibly partial) dot over `base`. Returns null after pushing an error.
 * Optional annotation fields are only set when valid; invalid ones are ignored.
 */
function normalizeGraphDotFields(
  raw: Record<string, unknown>,
  base: GraphDot | undefined,
  path: string,
  errors: string[],
  fallbackId = 'dot',
): GraphDot | null {
  const dot: GraphDot = {
    ...(base ?? {}),
    id: asStr(raw.id, base?.id ?? fallbackId),
    dx: asNum(raw.dx, base?.dx ?? 0),
    dy: asNum(raw.dy, base?.dy ?? 0),
    color: asStr(raw.color, base?.color ?? '#ef4444'),
    radius: asNum(raw.radius, base?.radius ?? 0.08),
    label: asStr(raw.label, base?.label ?? ''),
    labelDir: asDir(raw.labelDir, base?.labelDir ?? 'UP'),
  };
  const attachment = normalizeDotAttachment(raw.attachment, `${path}.attachment`, errors);
  if (attachment === null) return null;
  if (attachment) {
    if (attachment.kind === 'free') delete dot.attachment;
    else dot.attachment = attachment;
  }
  for (const key of ['showCoordinates', 'showProjectionGuides'] as const) {
    if (typeof raw[key] === 'boolean') dot[key] = raw[key] as boolean;
  }
  for (const key of ['labelFontSize', 'coordinateFontSize'] as const) {
    const n = asOptionalPositiveNum(raw[key]);
    if (n != null) dot[key] = n;
  }
  for (const key of ['labelSpacing', 'coordinateSpacing'] as const) {
    const n = raw[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) dot[key] = n;
  }
  if (typeof raw.coordinatePrecision === 'number' && Number.isFinite(raw.coordinatePrecision)) {
    dot.coordinatePrecision = Math.max(0, Math.min(6, Math.round(raw.coordinatePrecision)));
  }
  for (const key of ['labelColor', 'coordinateColor'] as const) {
    const c = asOptionalTrimmedStr(raw[key]);
    if (c) dot[key] = c;
  }
  const coordinateDir = asNullableDir(raw.coordinateDir);
  if (coordinateDir) dot.coordinateDir = coordinateDir;
  if (typeof raw.valueTemplate === 'string') {
    const template = raw.valueTemplate.trim();
    const { unknown } = parseLiveValueTemplate(template);
    if (unknown.length) {
      errors.push(`${path}.valueTemplate uses {${unknown.join('}, {')}}; only {x}, {y} and {slope} are filled in.`);
      return null;
    }
    if (template) dot.valueTemplate = template;
    else delete dot.valueTemplate;
  }
  if (raw.trace === false || raw.trace === null) delete dot.trace;
  else if (raw.trace === true) dot.trace = {};
  else if (raw.trace !== undefined) {
    const t = raw.trace as Record<string, unknown>;
    if (typeof t !== 'object' || Array.isArray(t)) {
      errors.push(`${path}.trace must be { color?, width?, fadeSeconds? } (or true / null).`);
      return null;
    }
    const fade = t.fadeSeconds == null ? null : Number(t.fadeSeconds);
    if (fade != null && !(Number.isFinite(fade) && fade >= 0)) {
      errors.push(`${path}.trace.fadeSeconds must be a number of seconds ≥ 0 (0 or null keeps the whole path).`);
      return null;
    }
    const width = asOptionalPositiveNum(t.width);
    const color = asOptionalTrimmedStr(t.color);
    dot.trace = {
      ...(color ? { color } : {}),
      ...(width != null ? { width } : {}),
      ...(fade ? { fadeSeconds: fade } : {}),
    };
  }
  return dot;
}

function normalizeGraphDot(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): GraphDotItem | null {
  const base = baseDefaults(raw);
  const axesId = typeof raw.axesId === 'string' ? raw.axesId : '';
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphDot.`);
    return null;
  }
  const dotRaw = collectDotPatch(raw) ?? {};
  const dot = normalizeGraphDotFields(dotRaw, undefined, `${prefix}.item.dot`, errors, base.id + '_dot');
  if (!dot) return null;
  return {
    ...base,
    kind: 'graphDot',
    axesId,
    dot,
  };
}

/** Item map as it would look after `actions` (shallow UPDATE merge, as in the preview). */
export function virtualSceneAfter(
  currentItems: ReadonlyMap<ItemId, SceneItem>,
  actions: readonly AgentAction[],
  defaults?: SceneDefaults,
  audioItems: readonly AudioTrackItem[] = [],
): Map<ItemId, SceneItem> {
  return virtualStateAfter(currentItems, audioItems, actions, defaults).items;
}

/**
 * Items and narration as the actions leave them: text lines as Approve will (segments parsed,
 * source edits merged) and TIMELINE edits applied like the editor's time edits (a blocked edit
 * changes nothing here; the validator reports it).
 */
export function virtualStateAfter(
  currentItems: ReadonlyMap<ItemId, SceneItem>,
  audioItems: readonly AudioTrackItem[],
  actions: readonly AgentAction[],
  defaults?: SceneDefaults,
): { items: Map<ItemId, SceneItem>; audio: AudioTrackItem[] } {
  let virtual = new Map(currentItems);
  let audio = [...audioItems];
  for (const action of actions) {
    if (action.action === 'CREATE') virtual.set(action.item.id, withParsedSegments(action.item, defaults));
    else if (action.action === 'UPDATE') {
      const previous = virtual.get(action.itemId);
      if (previous?.kind === 'textLine') {
        virtual.set(action.itemId, mergeTextLineUpdate(previous, action.updates as Partial<TextLineItem>, defaults));
      } else if (previous) virtual.set(action.itemId, { ...previous, ...action.updates } as SceneItem);
    } else if (action.action === 'DELETE') virtual.delete(action.itemId);
    else {
      const result = applyTimelineEdit(virtual, audio, action.edit);
      if (result.ok) {
        virtual = result.items;
        audio = result.audioItems;
      }
    }
  }
  return { items: virtual, audio };
}

/**
 * Segment indices on blink / target animation rows and surrounding rects must exist on the text
 * line they point at (segments as they will be after the draft: `raw` with its `||` splits).
 */
function checkSegmentIndices(
  actions: AgentAction[],
  currentItems: Map<ItemId, SceneItem>,
  errors: string[],
): void {
  const uses: { at: string; lineId: string; indices: number[] }[] = [];
  actions.forEach((action, i) => {
    if (action.action !== 'CREATE') return;
    const item = action.item;
    if (item.kind === 'surroundingRect' && item.segmentIndices?.length && item.targetIds.length === 1) {
      uses.push({ at: `actions[${i}] surroundingRect "${item.id}"`, lineId: item.targetIds[0]!, indices: item.segmentIndices });
    }
    if (item.kind === 'blink_animation' || item.kind === 'target_animation') {
      item.targets.forEach((row, ti) => {
        const indices = (row as { segmentIndices?: number[] | null }).segmentIndices;
        if (indices?.length) uses.push({ at: `actions[${i}] ${item.kind} "${item.id}" targets[${ti}]`, lineId: row.targetId, indices });
      });
    }
  });
  if (!uses.length) return;
  const virtual = virtualSceneAfter(currentItems, actions);
  for (const use of uses) {
    const line = virtual.get(use.lineId);
    if (line?.kind !== 'textLine') continue;
    const count = line.segments.length;
    const bad = use.indices.filter((n) => !Number.isInteger(n) || n < 0 || n >= count);
    if (bad.length) {
      const list = line.segments.map((seg, n) => `${n}: ${JSON.stringify(seg.text)}`).join(', ');
      errors.push(`${use.at}: segment ${bad.join(', ')} does not exist on text line "${use.lineId}" (segments ${list}).`);
    }
  }
}

/**
 * Check attached dots and Move-along-graph clips against the scene they would produce, with the
 * same resolver the canvas and the exporter use. Attached dots get their fallback dx/dy synced to
 * the resolved point; a free dot's clip without a plot picks the only plot on the dot's axes.
 */
function checkGraphMotion(
  actions: AgentAction[],
  currentItems: Map<ItemId, SceneItem>,
  errors: string[],
  warnings: string[],
): void {
  const touchesMotion = actions.some((a) =>
    a.action === 'CREATE'
      ? a.item.kind === 'graphDot' || a.item.kind === 'target_animation'
      : a.action === 'UPDATE' &&
        ['dot', 'targets', 'mode', 'startTime', 'duration', 'fn', 'curve', 'xDomain', 'tDomain'].some((k) => k in a.updates),
  );
  if (!touchesMotion) return;
  const errorCount = errors.length;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.action === 'DELETE' || action.action === 'TIMELINE') continue;
    const id = action.action === 'CREATE' ? action.item.id : action.itemId;
    const virtual = virtualSceneAfter(currentItems, actions);
    const item = virtual.get(id);
    if (!item) continue;
    const values = [...virtual.values()];
    if (item.kind === 'graphDot' && item.dot.attachment && item.dot.attachment.kind !== 'free') {
      const resolved = resolveAttachedGraphDot(item, values);
      if (resolved.error) {
        errors.push(`actions[${i}]: graph dot "${id}": ${resolved.error}`);
        continue;
      }
      const synced = { ...item.dot, dx: resolved.point.x, dy: resolved.point.y };
      if (action.action === 'CREATE') action.item = { ...item, dot: synced };
      else if ('dot' in action.updates) action.updates = { ...action.updates, dot: synced } as Partial<SceneItem>;
      continue;
    }
    if (item.kind !== 'target_animation' || item.mode !== 'graphFollow') continue;
    let rows = item.targets;
    let repaired = false;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      const dot = virtual.get(row.targetId);
      if (dot?.kind !== 'graphDot') continue;
      const attachment = dot.dot.attachment ?? { kind: 'free' as const };
      const where = `actions[${i}]: Move-along-graph clip "${id}" row ${r}`;
      if (attachment.kind === 'parametric') {
        if (!Number.isFinite(row.targetT)) errors.push(`${where} needs targetT (the dot is attached to a parametric curve).`);
        continue;
      }
      if (!Number.isFinite(row.targetX)) {
        errors.push(`${where} needs targetX (destination x in graph units).`);
        continue;
      }
      if (attachment.kind === 'free' && !row.graphPlotId) {
        const plots = values.filter((it) => it.kind === 'graphPlot' && it.axesId === dot.axesId);
        if (plots.length === 1) {
          rows = rows.map((x, k) => (k === r ? { ...x, graphPlotId: plots[0]!.id } : x));
          repaired = true;
          warnings.push(`${where}: graphPlotId was missing; using the only plot "${plots[0]!.id}" on the dot's axes.`);
        } else {
          errors.push(`${where} needs graphPlotId (a function plot on the dot's axes), or attach the dot to a plot.`);
        }
      }
    }
    if (repaired) {
      if (action.action === 'CREATE') action.item = { ...item, targets: rows };
      else action.updates = { ...action.updates, targets: rows } as Partial<SceneItem>;
    }
  }
  if (errors.length > errorCount) return;
  const virtual = virtualSceneAfter(currentItems, actions);
  const values = [...virtual.values()];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.action === 'DELETE' || action.action === 'TIMELINE') continue;
    const clip = virtual.get(action.action === 'CREATE' ? action.item.id : action.itemId);
    if (clip?.kind !== 'target_animation' || clip.mode !== 'graphFollow') continue;
    const startError = graphFollowStartTimeError(clip, virtual);
    if (startError) errors.push(`actions[${i}]: ${startError}`);
    for (const row of clip.targets) {
      const dot = virtual.get(row.targetId);
      if (dot?.kind !== 'graphDot') continue;
      const end = resolveGraphDotPosition({ dot, items: values, time: clip.startTime + clip.duration });
      if (end.error) errors.push(`actions[${i}]: Move-along-graph clip "${clip.id}": ${end.error}`);
    }
  }
}

const FUNCTION_LINE_STYLES: readonly FunctionLineStyle[] = [
  'solid',
  'dashed',
  'dotted',
];

function asLineStyle(v: unknown, fallback: FunctionLineStyle): FunctionLineStyle {
  return typeof v === 'string' &&
    (FUNCTION_LINE_STYLES as readonly string[]).includes(v)
    ? (v as FunctionLineStyle)
    : fallback;
}

function asFunctionSeriesMode(
  v: unknown,
  fallback: FunctionSeriesMode,
): FunctionSeriesMode {
  return v === 'accumulation' || v === 'replacement' ? v : fallback;
}

/**
 * Default styling for a freshly-created graphFunctionSeries. Kept in sync with
 * `createGraphFunctionSeries` in `store/factories.ts`.
 */
const FUNCTION_SERIES_DEFAULTS: FunctionSeriesDefaults = {
  color: '#3b82f6',
  strokeWidth: 4,
  lineStyle: 'solid',
  animDuration: 1,
  waitAfter: 0.3,
};

function normalizeFunctionSeriesDefaults(
  raw: unknown,
): FunctionSeriesDefaults {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    color: asStr(r.color, FUNCTION_SERIES_DEFAULTS.color),
    strokeWidth: Math.max(
      0.1,
      asNum(r.strokeWidth, FUNCTION_SERIES_DEFAULTS.strokeWidth),
    ),
    lineStyle: asLineStyle(r.lineStyle, FUNCTION_SERIES_DEFAULTS.lineStyle),
    animDuration: Math.max(
      0,
      asNum(r.animDuration, FUNCTION_SERIES_DEFAULTS.animDuration),
    ),
    waitAfter: Math.max(
      0,
      asNum(r.waitAfter, FUNCTION_SERIES_DEFAULTS.waitAfter),
    ),
  };
}

/**
 * Coerce an LLM-supplied `perN` dictionary into a valid `FunctionSeriesPerN`
 * map. Keys are integer-parseable strings; unknown fields on each entry are
 * dropped. The LLM is allowed to send `waitAfterSec` (human-readable alias)
 * and we map it onto the canonical `waitAfter` field, since models routinely
 * confuse the two.
 */
function normalizePerNDict(
  raw: unknown,
): Record<string, FunctionSeriesPerN> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, FunctionSeriesPerN> = {};
  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(rawKey);
    // Silently drop non-integer keys — they are almost always model noise
    // around an otherwise-valid patch, and failing the whole response would
    // lose legitimate edits.
    if (!Number.isFinite(n) || !Number.isInteger(n)) continue;
    if (!rawVal || typeof rawVal !== 'object') continue;
    const entry = rawVal as Record<string, unknown>;
    const perN: FunctionSeriesPerN = {};
    if (typeof entry.color === 'string') perN.color = entry.color;
    if (typeof entry.strokeWidth === 'number' && Number.isFinite(entry.strokeWidth)) {
      perN.strokeWidth = Math.max(0.1, entry.strokeWidth);
    }
    if (typeof entry.lineStyle === 'string' &&
        (FUNCTION_LINE_STYLES as readonly string[]).includes(entry.lineStyle)) {
      perN.lineStyle = entry.lineStyle as FunctionLineStyle;
    }
    if (typeof entry.animDuration === 'number' && Number.isFinite(entry.animDuration)) {
      perN.animDuration = Math.max(0, entry.animDuration);
    }
    // Accept both `waitAfter` (canonical) and `waitAfterSec` (common LLM alias).
    const waitRaw =
      typeof entry.waitAfter === 'number'
        ? entry.waitAfter
        : typeof entry.waitAfterSec === 'number'
          ? entry.waitAfterSec
          : undefined;
    if (typeof waitRaw === 'number' && Number.isFinite(waitRaw)) {
      perN.waitAfter = Math.max(0, waitRaw);
    }
    out[String(Math.trunc(n))] = perN;
  }
  return out;
}

function normalizeGraphFunctionSeries(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): GraphFunctionSeriesItem | null {
  const isReplacement = raw.mode === 'replacement';
  const rawForBase =
    raw.visibleAtSceneStart === true && isReplacement
      ? { ...raw, visibleAtSceneStart: false }
      : raw;
  const base = baseDefaults(rawForBase);
  const axesId = typeof raw.axesId === 'string' ? raw.axesId : '';
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphFunctionSeries.`);
    return null;
  }
  // Ensure nMin ≤ nMax; if reversed, swap silently.
  let nMin = Math.trunc(asNum(raw.nMin, 1));
  let nMax = Math.trunc(asNum(raw.nMax, 5));
  if (nMin > nMax) {
    [nMin, nMax] = [nMax, nMin];
  } else if (nMin === nMax) {
    // A single-point range would render nothing; widen by 1 so the item is
    // still visible, matching the factory's default behaviour.
    nMax = nMin + 1;
  }

  const resolved = resolveGraphFunctionSeriesExprs(raw, errors, prefix);
  if (!resolved) return null;
  const { jsExpr, pyExpr } = resolved;

  const xDomain =
    Array.isArray(raw.xDomain) && raw.xDomain.length === 2
      ? (raw.xDomain as [number, number])
      : null;

  const defaults = normalizeFunctionSeriesDefaults(raw.defaults);
  const perN = normalizePerNDict(raw.perN);

  const partial: GraphFunctionSeriesItem = {
    ...base,
    kind: 'graphFunctionSeries',
    axesId,
    jsExpr,
    pyExpr,
    nMin,
    nMax,
    mode: asFunctionSeriesMode(raw.mode, 'accumulation'),
    displayMode:
      raw.displayMode === 'partialSum' || raw.displayMode === 'individual'
        ? raw.displayMode
        : 'individual',
    xDomain,
    defaults,
    perN,
    perNErrors: {},
    topLevelError: null,
  };

  const durationExplicit =
    'duration' in raw &&
    typeof raw.duration === 'number' &&
    Number.isFinite(raw.duration);
  const duration = durationExplicit
    ? Math.max(0.01, raw.duration as number)
    : Math.max(0.01, functionSeriesTotalDuration(partial));

  return { ...partial, duration };
}

function resolvePointSequenceCoordinateExprs(
  itemRaw: Record<string, unknown>,
  axis: 'x' | 'y',
  errors: string[],
  prefix: string,
): { jsExpr: string; pyExpr: string } | null {
  const jsKey = axis === 'x' ? 'jsXExpr' : 'jsYExpr';
  const pyKey = axis === 'x' ? 'pyXExpr' : 'pyYExpr';
  const aliasKeys =
    axis === 'x' ? ['exprX', 'xExpr', 'x'] : ['exprY', 'yExpr', 'y'];

  let js =
    pickStr(itemRaw, jsKey) || pickStrAny(itemRaw, aliasKeys);
  let py = pickStr(itemRaw, pyKey);

  if (js && !py) py = toPyExpr(js);
  if (py && !js) js = toJsExpr(py);
  if (!js || !py) {
    errors.push(
      `${prefix}: ${axis}(n) needs ${jsKey} / ${pyKey} — provide at least one dialect per coordinate (aliases: ${aliasKeys.join(', ')}).`,
    );
    return null;
  }
  return {
    jsExpr: js.replace(/\^/g, '**'),
    pyExpr: py.replace(/\^/g, '**'),
  };
}

function normalizeGraphPointSequence(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): GraphPointSequenceItem | null {
  const isReplacement = raw.mode === 'replacement';
  const rawForBase =
    raw.visibleAtSceneStart === true && isReplacement
      ? { ...raw, visibleAtSceneStart: false }
      : raw;
  const base = baseDefaults(rawForBase);
  const axesId = typeof raw.axesId === 'string' ? raw.axesId : '';
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphPointSequence.`);
    return null;
  }
  let nMin = Math.trunc(asNum(raw.nMin, 1));
  let nMax = Math.trunc(asNum(raw.nMax, 5));
  if (nMin > nMax) {
    [nMin, nMax] = [nMax, nMin];
  } else if (nMin === nMax) {
    nMax = nMin + 1;
  }

  const xPair = resolvePointSequenceCoordinateExprs(
    raw,
    'x',
    errors,
    prefix,
  );
  const yPair = resolvePointSequenceCoordinateExprs(
    raw,
    'y',
    errors,
    prefix,
  );
  if (!xPair || !yPair) return null;

  const defaults = normalizePointSequenceDefaults(raw.defaults);
  const perN = normalizePointSequencePerNDict(raw.perN);

  const partial: GraphPointSequenceItem = {
    ...base,
    kind: 'graphPointSequence',
    axesId,
    jsXExpr: xPair.jsExpr,
    pyXExpr: xPair.pyExpr,
    jsYExpr: yPair.jsExpr,
    pyYExpr: yPair.pyExpr,
    nMin,
    nMax,
    mode: asFunctionSeriesMode(raw.mode, 'accumulation'),
    defaults,
    perN,
    perNErrors: {},
    topLevelError: null,
  };

  const durationExplicit =
    'duration' in raw &&
    typeof raw.duration === 'number' &&
    Number.isFinite(raw.duration);
  const duration = durationExplicit
    ? Math.max(0.01, raw.duration as number)
    : Math.max(0.01, pointSequenceTotalDuration(partial));

  return { ...partial, duration };
}

const AGENT_SHAPE_KINDS = new Set<ShapeKind>([
  'circle',
  'rectangle',
  'arrow',
  'line',
  'polyline',
]);

function normalizeShapePoints(rawPoints: unknown): ShapePoint[] {
  if (!Array.isArray(rawPoints)) return DEFAULT_SHAPE_POLYLINE_POINTS.map((p) => ({ ...p }));
  const points = rawPoints
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const x = asNum((p as Record<string, unknown>).x, NaN);
      const y = asNum((p as Record<string, unknown>).y, NaN);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter((p): p is ShapePoint => !!p);
  if (points.length >= 2) return points;
  return DEFAULT_SHAPE_POLYLINE_POINTS.map((p) => ({ ...p }));
}

const ANCHOR_EDGES = new Set(['center', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR']);

/** One connector end. Aliases: `dotFoot` for `graphDotFoot`, `id` for the referenced id. */
function normalizeShapeAnchor(v: unknown, path: string, errors: string[]): ShapeAnchor | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errors.push(`${path} must be an anchor object such as { kind: "graphDot", dotId }.`);
    return null;
  }
  const r = v as Record<string, unknown>;
  const kind = r.kind === 'dotFoot' ? 'graphDotFoot' : r.kind;
  const ref = (key: string) => {
    const value = typeof r[key] === 'string' ? (r[key] as string) : typeof r.id === 'string' ? r.id : '';
    return value.trim();
  };
  const num = (key: string) => (typeof r[key] === 'number' ? (r[key] as number) : Number(r[key]));
  switch (kind) {
    case 'point': {
      const x = num('x');
      const y = num('y');
      if (Number.isFinite(x) && Number.isFinite(y)) return { kind: 'point', x, y };
      errors.push(`${path}: a "point" anchor needs finite x and y.`);
      return null;
    }
    case 'graphPoint': {
      const axesId = ref('axesId');
      const x = num('x');
      const y = num('y');
      if (axesId && Number.isFinite(x) && Number.isFinite(y)) return { kind: 'graphPoint', axesId, x, y };
      errors.push(`${path}: a "graphPoint" anchor needs axesId and finite graph x, y.`);
      return null;
    }
    case 'graphDot': {
      const dotId = ref('dotId');
      if (dotId) return { kind: 'graphDot', dotId };
      errors.push(`${path}: a "graphDot" anchor needs dotId.`);
      return null;
    }
    case 'graphDotFoot': {
      const dotId = ref('dotId');
      const axis = r.axis === 'y' ? 'y' : r.axis == null || r.axis === 'x' ? 'x' : null;
      if (dotId && axis) return { kind: 'graphDotFoot', dotId, axis };
      errors.push(`${path}: a "graphDotFoot" anchor needs dotId and axis "x" or "y".`);
      return null;
    }
    case 'object': {
      const itemId = ref('itemId');
      if (!itemId) {
        errors.push(`${path}: an "object" anchor needs itemId.`);
        return null;
      }
      const edge = typeof r.edge === 'string' && ANCHOR_EDGES.has(r.edge) ? (r.edge as ManimDirection | 'center') : 'center';
      return { kind: 'object', itemId, edge };
    }
    default:
      errors.push(`${path}.kind must be point, graphPoint, graphDot, graphDotFoot or object.`);
      return null;
  }
}

function normalizeShapeEndpoints(v: unknown, path: string, errors: string[]): ShapeEndpoints | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errors.push(`${path} must be { start: <anchor>, end: <anchor> }.`);
    return null;
  }
  const r = v as Record<string, unknown>;
  const start = normalizeShapeAnchor(r.start, `${path}.start`, errors);
  if (r.tangent != null) {
    const t = r.tangent as Record<string, unknown>;
    const length = typeof t === 'object' && !Array.isArray(t) ? Number(t.length ?? 2) : NaN;
    if (!Number.isFinite(length) || length <= 0) {
      errors.push(`${path}.tangent must be { length: <positive number>, plotId?: <plot id> }.`);
      return null;
    }
    if (start && start.kind !== 'graphDot') {
      errors.push(`${path}.start must be a "graphDot" anchor for a tangent (the dot the tangent touches).`);
      return null;
    }
    const plotId = typeof t.plotId === 'string' && t.plotId.trim() ? t.plotId.trim() : undefined;
    // The tangent is defined by its dot alone; `end` is kept equal to `start`.
    return start ? { start, end: start, tangent: { length, ...(plotId ? { plotId } : {}) } } : null;
  }
  const end = normalizeShapeAnchor(r.end, `${path}.end`, errors);
  if (r.extend != null && !(Number.isFinite(Number(r.extend)) && Number(r.extend) >= 0)) {
    errors.push(`${path}.extend must be a number ≥ 0 (Manim units past each end).`);
    return null;
  }
  const extend = Number(r.extend ?? 0);
  const ticks = r.ticks == null ? 0 : Number(r.ticks);
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > 3) {
    errors.push(`${path}.ticks must be 0, 1, 2 or 3 (equal-length marks across the middle).`);
    return null;
  }
  return start && end ? { start, end, ...(extend > 0 ? { extend } : {}), ...(ticks > 0 ? { ticks } : {}) } : null;
}

/** An angle mark: three anchors (vertex, from, to), a radius and the mark style. */
function normalizeShapeAngle(v: unknown, path: string, errors: string[]): ShapeAngleMark | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errors.push(`${path} must be { vertex: <anchor>, from: <anchor>, to: <anchor>, radius?, mark? }.`);
    return null;
  }
  const r = v as Record<string, unknown>;
  const vertex = normalizeShapeAnchor(r.vertex, `${path}.vertex`, errors);
  const from = normalizeShapeAnchor(r.from, `${path}.from`, errors);
  const to = normalizeShapeAnchor(r.to, `${path}.to`, errors);
  const radius = r.radius == null ? 0.4 : Number(r.radius);
  if (!(Number.isFinite(radius) && radius > 0)) {
    errors.push(`${path}.radius must be a positive number of Manim units (about 0.3–0.6).`);
    return null;
  }
  const mark = r.mark ?? 'auto';
  if (mark !== 'auto' && mark !== 'arc' && mark !== 'right') {
    errors.push(`${path}.mark must be "auto", "arc" or "right".`);
    return null;
  }
  return vertex && from && to ? { vertex, from, to, radius, mark } : null;
}

function normalizeShape(raw: Record<string, unknown>, errors: string[], prefix: string): ShapeItem | null {
  const base = baseDefaults(raw);
  const rawSt = raw.shapeType;
  const hasEndpoints = raw.endpoints != null;
  const hasAngle = raw.angle != null;
  const shapeType: ShapeKind =
    typeof rawSt === 'string' && AGENT_SHAPE_KINDS.has(rawSt as ShapeKind)
      ? (rawSt as ShapeKind)
      : hasEndpoints
        ? 'line'
        : hasAngle
          ? 'polyline'
          : 'circle';
  let angle: ShapeAngleMark | null = null;
  if (hasAngle) {
    if (shapeType !== 'polyline') {
      errors.push(`${prefix}.item.angle needs shapeType "polyline" (or no shapeType).`);
      return null;
    }
    angle = normalizeShapeAngle(raw.angle, `${prefix}.item.angle`, errors);
    if (!angle) return null;
  }
  let endpoints: ShapeEndpoints | null = null;
  if (hasEndpoints) {
    if (shapeType !== 'line' && shapeType !== 'arrow') {
      errors.push(`${prefix}.item.endpoints needs shapeType "line" or "arrow".`);
      return null;
    }
    endpoints = normalizeShapeEndpoints(raw.endpoints, `${prefix}.item.endpoints`, errors);
    if (!endpoints) return null;
  }
  return {
    ...base,
    kind: 'shape',
    shapeType,
    rotationDeg: asNum(raw.rotationDeg, 0),
    radius: asNum(raw.radius, 0.5),
    width: asNum(raw.width, 2),
    height: asNum(raw.height, 1),
    endX: asNum(raw.endX, 2),
    endY: asNum(raw.endY, 0),
    points: normalizeShapePoints(raw.points),
    tailArrow: typeof raw.tailArrow === 'boolean' ? raw.tailArrow : false,
    headArrow: typeof raw.headArrow === 'boolean' ? raw.headArrow : false,
    strokeColor: asStr(raw.strokeColor, '#60a5fa'),
    strokeWidth: asNum(raw.strokeWidth, 3),
    fillColor:
      typeof raw.fillColor === 'string' ? raw.fillColor : null,
    fillOpacity: asNum(raw.fillOpacity, 0.25),
    introStyle:
      (raw.introStyle as ShapeItem['introStyle']) ?? 'create',
    ...(endpoints ? { endpoints } : {}),
    ...(angle ? { angle, headArrow: false, tailArrow: false } : {}),
  };
}

/** A dot whose live label shows `{slope}` must sit on (or follow) one function plot. */
function checkLiveValueSlopes(actions: AgentAction[], currentItems: Map<ItemId, SceneItem>, errors: string[]): void {
  const touched = actions.flatMap((a, i) =>
    a.action === 'CREATE' && a.item.kind === 'graphDot' ? [[i, a.item.id] as const] : a.action === 'UPDATE' ? [[i, a.itemId] as const] : [],
  );
  if (touched.length === 0) return;
  const virtual = virtualSceneAfter(currentItems, actions);
  for (const [i, id] of touched) {
    const dot = virtual.get(id);
    if (dot?.kind !== 'graphDot' || !dot.dot.showCoordinates || !templateUsesSlope(dot.dot.valueTemplate)) continue;
    const r = dotFunctionPlot(dot, virtual);
    if (r.error != null) errors.push(`actions[${i}]: dot "${id}" shows {slope} but ${r.error}`);
  }
}

/**
 * Resolve every created / updated connector against the scene the actions produce (same resolver
 * as the canvas) and sync its static x / y / endX / endY to the geometry at its start time.
 */
function checkConnectors(
  actions: AgentAction[],
  currentItems: Map<ItemId, SceneItem>,
  frameCtx: AgentFrameContext | undefined,
  errors: string[],
): void {
  if (!actions.some((a) => (a.action === 'CREATE' ? isBoundShape(a.item) : a.action === 'UPDATE' && ('endpoints' in a.updates || 'angle' in a.updates)))) return;
  const virtual = virtualSceneAfter(currentItems, actions);
  const ctx = { items: virtual, frames: frameCtx?.frames ?? [], startFrameId: frameCtx?.startFrameId ?? null };
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.action === 'DELETE' || action.action === 'TIMELINE') continue;
    if (action.action === 'UPDATE' && !('endpoints' in action.updates) && !('angle' in action.updates)) continue;
    const shape = virtual.get(action.action === 'CREATE' ? action.item.id : action.itemId);
    if (isAngleMark(shape)) {
      const mark = resolveAngleMark(shape, { ...ctx, time: shape.startTime });
      if (mark.error != null) {
        errors.push(`actions[${i}]: angle mark "${shape.id}": ${mark.error}`);
        continue;
      }
      const geometry = angleMarkStaticGeometry(shape, { ...ctx, time: shape.startTime });
      if (!geometry) continue;
      if (action.action === 'CREATE') action.item = { ...shape, ...geometry };
      else action.updates = { ...action.updates, ...geometry } as Partial<SceneItem>;
      continue;
    }
    if (!isConnectorShape(shape)) continue;
    const result = resolveConnectorEndpoints(shape, { ...ctx, time: shape.startTime });
    if (result.error != null) {
      errors.push(`actions[${i}]: connector "${shape.id}": ${result.error}`);
      continue;
    }
    const geometry = connectorStaticGeometry(shape, { ...ctx, time: shape.startTime });
    if (!geometry) continue;
    if (action.action === 'CREATE') action.item = { ...shape, ...geometry };
    else action.updates = { ...action.updates, ...geometry } as Partial<SceneItem>;
  }
}

function normalizeSurroundingRect(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): SurroundingRectItem | null {
  const targetIds = Array.isArray(raw.targetIds)
    ? (raw.targetIds as string[]).filter((x) => typeof x === 'string')
    : [];
  if (targetIds.length === 0) {
    errors.push(
      `${prefix}.item.targetIds must include at least one id for surroundingRect.`,
    );
    return null;
  }
  const visibleAtSceneStart = raw.visibleAtSceneStart === true;
  const startTime = visibleAtSceneStart
    ? 0
    : Math.max(0, asNum(raw.startTime, 0));
  return {
    kind: 'surroundingRect',
    id: String(raw.id),
    label: asStr(raw.label, ''),
    layer: Math.max(0, asNum(raw.layer, 0)),
    startTime,
    runTime: Math.max(0.05, asNum(raw.runTime, 0.45)),
    targetIds,
    segmentIndices: Array.isArray(raw.segmentIndices)
      ? (raw.segmentIndices as number[])
      : null,
    buff: asNum(raw.buff, 0.15),
    color: asStr(raw.color, '#fbbf24'),
    cornerRadius: asNum(raw.cornerRadius, 0.08),
    strokeWidth: asNum(raw.strokeWidth, 2),
    labelText: asStr(raw.labelText, ''),
    labelDir:
      (raw.labelDir as SurroundingRectItem['labelDir']) ?? 'UP',
    labelFontSize: asNum(raw.labelFontSize, 22),
    introStyle:
      (raw.introStyle as SurroundingRectItem['introStyle']) ?? 'create',
    ...(visibleAtSceneStart ? { visibleAtSceneStart: true as const } : {}),
  };
}

const EXIT_ANIM_STYLES: readonly ExitAnimationItem['targets'][number]['animStyle'][] = [
  'fade_out',
  'uncreate',
  'shrink_to_center',
  'none',
];

function asExitAnimStyle(
  v: unknown,
): ExitAnimationItem['targets'][number]['animStyle'] {
  return typeof v === 'string' &&
    (EXIT_ANIM_STYLES as readonly string[]).includes(v)
    ? (v as ExitAnimationItem['targets'][number]['animStyle'])
    : 'fade_out';
}

function normalizeExitAnimation(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): ExitAnimationItem | null {
  const targetsRaw = Array.isArray(raw.targets) ? raw.targets : [];
  const targets = targetsRaw
    .map((t) => t as Record<string, unknown>)
    .filter((t) => typeof t.targetId === 'string' && t.targetId.trim() !== '')
    .map((t) => ({
      targetId: String(t.targetId),
      animStyle: asExitAnimStyle(t.animStyle),
    }));
  if (targets.length === 0) {
    errors.push(
      `${prefix}.item.targets must include at least one target for exit_animation.`,
    );
    return null;
  }
  return {
    kind: 'exit_animation',
    id: String(raw.id),
    label: asStr(raw.label, ''),
    layer: Math.max(0, asNum(raw.layer, 0)),
    startTime: Math.max(0, asNum(raw.startTime, 0)),
    duration: Math.max(0.05, asNum(raw.duration, 1)),
    targets,
  };
}

const BLINK_MODES: readonly BlinkMode[] = ['scale', 'color'];

function asBlinkMode(v: unknown): BlinkMode {
  return typeof v === 'string' && (BLINK_MODES as readonly string[]).includes(v)
    ? (v as BlinkMode)
    : 'scale';
}

function normalizeBlinkAnimation(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): BlinkAnimationItem | null {
  const targetsRaw = Array.isArray(raw.targets) ? raw.targets : [];
  const targets: BlinkTargetSpec[] = targetsRaw
    .map((t) => t as Record<string, unknown>)
    .filter((t) => typeof t.targetId === 'string' && t.targetId.trim() !== '')
    .map((t) => {
      const segRaw = t.segmentIndices;
      let segmentIndices: number[] | null | undefined;
      if (Array.isArray(segRaw)) {
        const nums = segRaw
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((x) => Number.isInteger(x));
        segmentIndices = nums.length > 0 ? nums : null;
      } else {
        segmentIndices = null;
      }
      const row: BlinkTargetSpec = {
        targetId: String(t.targetId),
        mode: asBlinkMode(t.mode),
      };
      if (typeof t.scaleFactor === 'number' && Number.isFinite(t.scaleFactor)) {
        row.scaleFactor = t.scaleFactor;
      }
      if (typeof t.blinkColor === 'string' && t.blinkColor.trim()) {
        row.blinkColor = t.blinkColor.trim();
      }
      if (segmentIndices != null) {
        row.segmentIndices = segmentIndices;
      }
      const subRaw = t.mathSubtargets;
      if (Array.isArray(subRaw)) {
        const mrows: { segmentIndex: number; childIndices: number[] }[] = [];
        for (const ent of subRaw) {
          const rec = ent as Record<string, unknown>;
          const si = Number(rec.segmentIndex);
          if (!Number.isInteger(si) || si < 0) continue;
          const chRaw = rec.childIndices;
          if (!Array.isArray(chRaw)) continue;
          const ch = chRaw
            .map((x) => (typeof x === 'number' ? x : Number(x)))
            .filter((x) => Number.isInteger(x) && x >= 0);
          if (ch.length > 0) {
            mrows.push({ segmentIndex: si, childIndices: [...new Set(ch)].sort((a, b) => a - b) });
          }
        }
        if (mrows.length > 0) {
          row.mathSubtargets = mrows;
        }
      }
      return row;
    });
  if (targets.length === 0) {
    errors.push(
      `${prefix}.item.targets must include at least one target for blink_animation.`,
    );
    return null;
  }
  return {
    kind: 'blink_animation',
    id: String(raw.id),
    label: asStr(raw.label, ''),
    layer: Math.max(0, asNum(raw.layer, 0)),
    startTime: Math.max(0, asNum(raw.startTime, 0)),
    duration: Math.max(0.05, asNum(raw.duration, 0.6)),
    repetitions: Math.max(1, Math.round(asNum(raw.repetitions, 1))),
    targets,
  };
}

const TA_MODES: readonly TargetAnimationMode[] = [
  'scale',
  'color',
  'move',
  'path',
  'rotate',
  'graphFollow',
];

/** Move-along-graph row fields (`mode === 'graphFollow'`); `toX` / `toT` are accepted aliases. */
function applyGraphFollowRowFields(row: TargetAnimationTargetSpec, t: Record<string, unknown>): void {
  if (typeof t.graphPlotId === 'string' && t.graphPlotId.trim()) row.graphPlotId = t.graphPlotId.trim();
  if (typeof t.graphCurveId === 'string' && t.graphCurveId.trim()) row.graphCurveId = t.graphCurveId.trim();
  const targetX = typeof t.targetX === 'number' ? t.targetX : t.toX;
  if (typeof targetX === 'number' && Number.isFinite(targetX)) row.targetX = targetX;
  const targetT = typeof t.targetT === 'number' ? t.targetT : t.toT;
  if (typeof targetT === 'number' && Number.isFinite(targetT)) row.targetT = targetT;
  if (t.easing === 'linear' || t.easing === 'smooth') row.easing = t.easing;
}

/** Missing mode keeps the historical `scale` default; an unknown mode is an error, never a silent scale. */
function asTargetAnimationMode(v: unknown): TargetAnimationMode | null {
  if (v == null) return 'scale';
  return typeof v === 'string' && (TA_MODES as readonly string[]).includes(v)
    ? (v as TargetAnimationMode)
    : null;
}

function normalizeTargetAnimation(
  raw: Record<string, unknown>,
  errors: string[],
  prefix: string,
): TargetAnimationItem | null {
  const mode = asTargetAnimationMode(raw.mode);
  if (!mode) {
    errors.push(
      `${prefix}.item.mode "${String(raw.mode)}" is not a target_animation mode (${TA_MODES.join(', ')}).`,
    );
    return null;
  }
  const targetsRaw = Array.isArray(raw.targets) ? raw.targets : [];
  const targets: TargetAnimationTargetSpec[] = targetsRaw
    .map((t) => t as Record<string, unknown>)
    .filter((t) => typeof t.targetId === 'string' && t.targetId.trim() !== '')
    .map((t) => {
      const segRaw = t.segmentIndices;
      let segmentIndices: number[] | null | undefined;
      if (Array.isArray(segRaw)) {
        const nums = segRaw
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((x) => Number.isInteger(x));
        segmentIndices = nums.length > 0 ? nums : null;
      } else {
        segmentIndices = null;
      }
      const row: TargetAnimationTargetSpec = {
        targetId: String(t.targetId),
      };
      if (typeof t.scaleFactor === 'number' && Number.isFinite(t.scaleFactor)) {
        row.scaleFactor = t.scaleFactor;
      }
      if (typeof t.color === 'string' && t.color.trim()) {
        row.color = t.color.trim();
      }
      if (typeof t.dx === 'number' && Number.isFinite(t.dx)) row.dx = t.dx;
      if (typeof t.dy === 'number' && Number.isFinite(t.dy)) row.dy = t.dy;
      if (typeof t.angleDeg === 'number' && Number.isFinite(t.angleDeg)) {
        row.angleDeg = t.angleDeg;
      }
      if (t.pathKind === 'parametric') {
        row.pathKind = 'parametric';
      } else if (t.pathKind === 'polyline') {
        row.pathKind = 'polyline';
      }
      const ppRaw = t.pathPoints;
      if (Array.isArray(ppRaw)) {
        const pts: ShapePoint[] = [];
        for (const ent of ppRaw) {
          const rec = ent as Record<string, unknown>;
          const x = typeof rec.x === 'number' ? rec.x : Number(rec.x);
          const y = typeof rec.y === 'number' ? rec.y : Number(rec.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x, y });
        }
        if (pts.length >= 2) row.pathPoints = pts;
      }
      const paramRaw = t.parametricPath;
      if (paramRaw && typeof paramRaw === 'object') {
        const rec = paramRaw as Record<string, unknown>;
        const tMin = Number(rec.tMin);
        const tMax = Number(rec.tMax);
        if (Number.isFinite(tMin) && Number.isFinite(tMax)) {
          // Same rescue as every other expression pair: `^` → `**` plus
          // single-dialect derivation. Both-missing axes keep the '0'
          // default so path rows without expressions still validate.
          const xPair = repairParametricAxis(rec.jsXExpr, rec.pyXExpr);
          const yPair = repairParametricAxis(rec.jsYExpr, rec.pyYExpr);
          row.parametricPath = {
            jsXExpr: xPair?.jsExpr ?? '0',
            jsYExpr: yPair?.jsExpr ?? '0',
            pyXExpr: xPair?.pyExpr ?? '0',
            pyYExpr: yPair?.pyExpr ?? '0',
            tMin,
            tMax,
            samples: Math.max(2, Math.round(asNum(rec.samples, 80))),
          };
        }
      }
      if (segmentIndices != null) row.segmentIndices = segmentIndices;
      applyGraphFollowRowFields(row, t);
      const subRaw = t.mathSubtargets;
      if (Array.isArray(subRaw)) {
        const mrows: { segmentIndex: number; childIndices: number[] }[] = [];
        for (const ent of subRaw) {
          const rec = ent as Record<string, unknown>;
          const si = Number(rec.segmentIndex);
          if (!Number.isInteger(si) || si < 0) continue;
          const chRaw = rec.childIndices;
          if (!Array.isArray(chRaw)) continue;
          const ch = chRaw
            .map((x) => (typeof x === 'number' ? x : Number(x)))
            .filter((x) => Number.isInteger(x) && x >= 0);
          if (ch.length > 0) {
            mrows.push({ segmentIndex: si, childIndices: [...new Set(ch)].sort((a, b) => a - b) });
          }
        }
        if (mrows.length > 0) row.mathSubtargets = mrows;
      }
      return row;
    });
  if (targets.length === 0) {
    errors.push(
      `${prefix}.item.targets must include at least one target for target_animation.`,
    );
    return null;
  }
  return {
    kind: 'target_animation',
    id: String(raw.id),
    label: asStr(raw.label, ''),
    layer: Math.max(0, asNum(raw.layer, 0)),
    startTime: Math.max(0, asNum(raw.startTime, 0)),
    duration: Math.max(mode === 'graphFollow' ? 0.01 : 0.05, asNum(raw.duration, 1)),
    mode,
    targets,
  };
}
