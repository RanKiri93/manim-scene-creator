import {
  functionSeriesTotalDuration,
  pointSequenceTotalDuration,
  type AxesItem,
  type AxesTipShape,
  type ExitAnimationItem,
  type BlinkAnimationItem,
  type BlinkMode,
  type BlinkTargetSpec,
  type FunctionLineStyle,
  type FunctionSeriesDefaults,
  type FunctionSeriesMode,
  type FunctionSeriesPerN,
  type PointSequenceDefaults,
  type PointSequencePerN,
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
  type ShapeKind,
  type ShapePoint,
  type SurroundingRectItem,
  type TextLineItem,
  DEFAULT_SHAPE_POLYLINE_POINTS,
} from '@/types/scene';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE } from '@/lib/constants';
import {
  AGENT_ALLOWED_KINDS,
  AGENT_UI_ONLY_FIELDS,
  type AgentAction,
  type AgentChatResponse,
  isAgentAllowedKind,
} from './types';

export type ValidationResult =
  | { ok: true; response: AgentChatResponse }
  | { ok: false; errors: string[] };

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
): ValidationResult {
  const errors: string[] = [];

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
      plannedCreates.set(id, normalized.kind);
      plannedCreateRaw.set(id, item);
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
      normalizedActions.push({
        action: 'UPDATE',
        itemId,
        updates: normalizeUpdates(
          updates as Partial<SceneItem>,
          targetKind,
          errors,
          prefix,
        ),
      });
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
      `${prefix}.action must be CREATE / UPDATE / DELETE, got "${String(a.action)}".`,
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
      item.kind === 'graphPointSequence'
    ) {
      const axesId = (
        item as
          | GraphPlotItem
          | GraphCurveItem
          | GraphDotItem
          | GraphFunctionSeriesItem
          | GraphPointSequenceItem
      ).axesId;
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
    }
  }

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
        `CREATE textLine "${act.item.id}" includes segment styling. Create text first, then propose styling in a separate turn.`,
      );
    }
  }
  for (const act of normalizedActions) {
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
    },
  };
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
      return normalizeTextLine(raw);
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
    case 'shape':
      return normalizeShape(raw);
    case 'surroundingRect':
      return normalizeSurroundingRect(raw, errors, prefix);
    case 'exit_animation':
      return normalizeExitAnimation(raw, errors, prefix);
    case 'blink_animation':
      return normalizeBlinkAnimation(raw, errors, prefix);
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
      item.kind !== 'graphPointSequence'
    ) {
      continue;
    }
    if (typeof item.axesId !== 'string' || !item.axesId) {
      item.axesId = onlyAxesId;
    }
  }
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
  _errors: string[],
  _prefix: string,
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

function normalizeUpdates(
  updates: Partial<SceneItem>,
  targetKind: string,
  errors: string[],
  prefix: string,
): Partial<SceneItem> {
  const patch = updates as Record<string, unknown>;
  const next: Record<string, unknown> = { ...patch };
  if ('posSteps' in patch) {
    next.posSteps = normalizePosSteps(patch.posSteps);
  }
  if (targetKind === 'graphFunctionSeries') {
    if ('perN' in patch) {
      // Coerce perN entries: stringify integer keys, drop unknown fields,
      // map `waitAfterSec` → `waitAfter`. commit.ts is responsible for the
      // deep-merge against the store; this pass only ensures the patch is
      // well-typed.
      next.perN = normalizePerNDict(patch.perN, errors, prefix + '.updates');
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
      next.perN = normalizePointSequencePerNDict(
        patch.perN,
        errors,
        prefix + '.updates',
      );
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

function normalizeTextLine(raw: Record<string, unknown>): TextLineItem {
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
    raw: texSource,
    font: asStr(raw.font, DEFAULT_FONT),
    fontSize: asNum(raw.fontSize, DEFAULT_FONT_SIZE),
    animStyle: raw.animStyle as TextLineItem['animStyle'],
    transformConfig:
      (raw.transformConfig as TextLineItem['transformConfig']) ?? null,
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
  const dotRaw = (raw.dot ?? {}) as Record<string, unknown>;
  return {
    ...base,
    kind: 'graphDot',
    axesId,
    dot: {
      id: asStr(dotRaw.id, base.id + '_dot'),
      dx: asNum(dotRaw.dx, 0),
      dy: asNum(dotRaw.dy, 0),
      color: asStr(dotRaw.color, '#ef4444'),
      radius: asNum(dotRaw.radius, 0.08),
      label: asStr(dotRaw.label, ''),
      labelDir:
        (dotRaw.labelDir as GraphDotItem['dot']['labelDir']) ?? 'UP',
    },
  };
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
  _errors: string[],
  _prefix: string,
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
  const perN = normalizePerNDict(raw.perN, errors, prefix);

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
  const perN = normalizePointSequencePerNDict(raw.perN, errors, prefix);

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

function normalizeShape(raw: Record<string, unknown>): ShapeItem {
  const base = baseDefaults(raw);
  const rawSt = raw.shapeType;
  const shapeType: ShapeKind =
    typeof rawSt === 'string' && AGENT_SHAPE_KINDS.has(rawSt as ShapeKind)
      ? (rawSt as ShapeKind)
      : 'circle';
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
  };
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
