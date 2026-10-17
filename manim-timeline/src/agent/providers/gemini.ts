import { AGENT_ALLOWED_KINDS } from '../types';
import {
  GRAPH_AREA_PROPERTIES,
  GRAPH_DOT_SCHEMA,
  GRAPH_FIELD_PROPERTIES,
  GRAPH_FOLLOW_ROW_PROPERTIES,
  SHAPE_ANGLE_SCHEMA,
  STYLE_NOTE_SCHEMA,
  SHAPE_ENDPOINTS_SCHEMA,
  SHAPE_PROPERTIES,
  TARGET_ANIMATION_MODES,
  TEXT_ANIM_PROPERTIES,
  TIMELINE_EDIT_SCHEMA,
} from '../schemaFragments';
import type { AgentChatMessage, AgentContextPayload } from '../types';
import {
  AgentProviderError,
  type AgentProvider,
  type ProviderConfig,
  type ProviderGenerateInput,
  type RawAgentResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Flattened schema tuned for Gemini's function-calling subset.
 *
 * Gemini accepts OpenAPI 3.0 schemas but reliability drops sharply on nested
 * `oneOf` discriminator unions — the model frequently emits the body of a
 * branch (e.g. `{ item: {...} }`) while forgetting to set the discriminator
 * field (`action`). We flatten to a single union-of-all-fields schema where
 * `action` is a required enum and `item` / `itemId` / `updates` are optional
 * siblings. Our TS validator already re-checks the combination, so we don't
 * lose any safety.
 *
 * Omitted keywords: `additionalProperties`, `const`, `$schema`, `title`
 * (all rejected by Gemini).
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['reply'],
  properties: {
    reply: {
      type: 'string',
      description:
        'The conversational message shown to the user. Required and non-empty. Use this to explain changes, ask clarifying questions, or discuss the scene. When you are only chatting, set actions to an empty array.',
    },
    styleNote: STYLE_NOTE_SCHEMA,
    actions: {
      type: 'array',
      description:
        'Ordered list of structural changes. Use an empty array for pure-chat replies (no edits). Each action MUST include an `action` field set to "CREATE", "UPDATE", or "DELETE". CREATE requires `item`; UPDATE requires `itemId` and `updates`; DELETE requires `itemId`.',
      items: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['CREATE', 'UPDATE', 'DELETE', 'TIMELINE'],
            description:
              'Discriminator. MUST be one of CREATE, UPDATE, DELETE, TIMELINE (a time edit: requires `edit`).',
          },
          item: {
            type: 'object',
            description:
              'Required for CREATE only. Full scene item with `id`, `kind`, and any kind-specific fields.\n' +
              'IMPORTANT:\n' +
              '• When `kind` is "graphPlot", "graphCurve", "graphDot", "graphFunctionSeries", "graphPointSequence", "graphArea", or "graphField", set `axesId` when referencing axes (existing id or same-batch CREATE).\n' +
              '• When `kind` is "graphPlot", the function goes under `fn` as `{ jsExpr, pyExpr, color, label }`. `jsExpr` is a JavaScript expression (e.g. "x*x" or "Math.sin(x)"), `pyExpr` is its NumPy equivalent (e.g. "x**2" or "np.sin(x)"). NEVER put the expression under `fn.expr` or as a bare string — always use `jsExpr` and `pyExpr` with the correct dialect. Use "**" (not "^") for power.\n' +
              '• When `kind` is "graphCurve", coordinates go under `curve` as `{ jsXExpr, pyXExpr, jsYExpr, pyYExpr, color, label }` with parameter `t`. Also set top-level `tDomain: [tMin, tMax]` (two numbers). Use "**" (not "^") for power.\n' +
              '• When `kind` is "graphFunctionSeries", put expressions at the TOP LEVEL as `jsExpr` and `pyExpr` (or a single top-level `expr` alias); both dialects must be derivable. Reference BOTH `n` (integer index) and `x`. Set `nMin`, `nMax` (integers), `displayMode` ("individual" | "partialSum"), and `mode` ("accumulation" | "replacement").\n' +
              '• When `kind` is "graphArea" (shaded region on axes), put the geometry under `area` with `areaKind`: underCurve / betweenCurves / riemann (plus rule and counts) use xMin < xMax and curve (or lower + upper) = { plotId } of a graphPlot on the same axes or { jsExpr, pyExpr } in x; parallelogramFour uses four corners; parallelogramVec ox, oy, ux, uy, vx, vy; disk cx, cy, radius (graph coordinates).\n' +
              '• When `kind` is "graphField", set `fieldMode` "slope" (jsExprSlope / pyExprSlope = dy/dx in x and y) or "vector" (jsExprP / pyExprP and jsExprQ / pyExprQ); expressions use only x and y.\n' +
              '• When `kind` is "graphPointSequence", put coordinates at the TOP LEVEL as `jsXExpr` / `pyXExpr` (for x(n)) and `jsYExpr` / `pyYExpr` (for y(n)) with variable `n` (integer index). Set integer `nMin`, `nMax`, and `mode` ("accumulation" | "replacement"). Use "**" (not "^") for power.\n' +
              '• When `kind` is "target_animation" with `mode: "path"` and a row `pathKind: "parametric"`, put offset curves under that row as `parametricPath: { jsXExpr, pyXExpr, jsYExpr, pyYExpr, tMin, tMax }` with parameter `t` (JS `Math.*`, Python `np.*`, "**" never "^"). Never set `frameId` on target_animation (it follows its targets).\n' +
              '• Set `frameId` on new drawable items (text, axes, graphs, shapes) to the payload `activeFrameId`, or to another frame id from the payload `frames` catalog when the user names a different frame. Never set `frameId` on exit_animation / blink_animation / target_animation (they follow their targets).\n',
            properties: {
              id: { type: 'string' },
              kind: {
                type: 'string',
                enum: [...AGENT_ALLOWED_KINDS],
              },
              targetMode: { type: 'string', enum: ['frame', 'region', 'object', 'follow'], description: 'camera_move request-only target descriptor; resolved before item persistence. "follow" keeps the moving targetId centred for the whole clip.' },
              targetId: { type: 'string', description: 'camera_move object-fit descriptor: exact existing drawable item id.' },
              region: { type: 'object', description: 'camera_move region descriptor in world coordinates; requires finite left/right/bottom/top edges.', properties: { left: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, top: { type: 'number' } } },
              targetFrameId: { type: 'string', description: 'camera_move destination frame id from the existing frame catalog.' },
              targetWidth: { type: 'number', description: 'Positive absolute target camera width in Manim units.' },
              offsetX: { type: 'number', description: 'Optional finite horizontal offset from the frame center.' },
              offsetY: { type: 'number', description: 'Optional finite vertical offset from the frame center.' },
              baseDir: { type: 'string', enum: ['rtl', 'ltr'], description: "textLine: 'ltr' for an English-base line (plain text is English, Hebrew is marked \\he{...}). Omit for the default right-to-left Hebrew line (English is marked \\en{...})." },
              englishFont: { type: 'string', description: "textLine: font for English text. Omit to use the Hebrew font; 'Latin Modern Roman' = LaTeX default." },
              startTime: { type: 'number', description: 'Start time in seconds. For “now”, use frozen currentTimeSec.' },
              duration: { type: 'number', description: 'Transition duration in seconds, at least 0.05.' },
              axesId: {
                type: 'string',
                description:
                  'REQUIRED when kind is "graphPlot", "graphCurve", "graphDot", "graphFunctionSeries", "graphPointSequence", "graphArea", or "graphField". Must equal an existing axes id in the scene, or the id of an axes you are CREATE-ing earlier in this same actions array. Omit for other agent-created kinds.',
              },
              frameId: {
                type: 'string',
                description:
                  'Optional frame id for drawable kinds (textLine, axes, graph overlays, shape). Must equal a frame id from the payload `frames` catalog; when omitted the active frame is used. Never set on exit_animation / blink_animation / target_animation (they follow their targets).',
              },
              fn: {
                type: 'object',
                description:
                  'REQUIRED when kind is "graphPlot". The plotted function.',
                properties: {
                  jsExpr: {
                    type: 'string',
                    description:
                      'JavaScript expression using `x`. Use "**" for power and "Math.sin" etc. Example: "x*x" or "Math.sin(x)".',
                  },
                  pyExpr: {
                    type: 'string',
                    description:
                      'Python/NumPy expression using `x`. Use "**" for power and "np.sin" etc. Example: "x**2" or "np.sin(x)".',
                  },
                  color: { type: 'string' },
                  label: { type: 'string' },
                },
              },
              curve: {
                type: 'object',
                description:
                  'REQUIRED when kind is "graphCurve". Parametric x(t), y(t) in graph coordinates.',
                properties: {
                  jsXExpr: {
                    type: 'string',
                    description:
                      'JavaScript expression for x(t) with parameter `t`. Example: "Math.cos(t)". Use "**" for power (NEVER "^").',
                  },
                  pyXExpr: {
                    type: 'string',
                    description:
                      'NumPy expression for x(t) with parameter `t`. Example: "np.cos(t)". Use "**" for power (NEVER "^").',
                  },
                  jsYExpr: {
                    type: 'string',
                    description:
                      'JavaScript expression for y(t) with parameter `t`. Example: "Math.sin(t)". Use "**" for power (NEVER "^").',
                  },
                  pyYExpr: {
                    type: 'string',
                    description:
                      'NumPy expression for y(t) with parameter `t`. Example: "np.sin(t)". Use "**" for power (NEVER "^").',
                  },
                  color: { type: 'string' },
                  label: { type: 'string' },
                },
              },
              tDomain: {
                type: 'array',
                description: 'Two numbers [tMin, tMax] for kind="graphCurve".',
                items: { type: 'number' },
              },
              xDomain: {
                type: 'array',
                description:
                  'Optional [xMin, xMax] domain for graphPlot or graphFunctionSeries. Two numbers.',
                items: { type: 'number' },
              },
              jsExpr: {
                type: 'string',
                description:
                  'Top-level JavaScript expression for kind="graphFunctionSeries". References both `n` and `x`. Example: "Math.sin(n * x)" or "x**n / n". Use "**" for power (NEVER "^").',
              },
              pyExpr: {
                type: 'string',
                description:
                  'Top-level NumPy expression for kind="graphFunctionSeries". References both `n` and `x`. Example: "np.sin(n * x)" or "x**n / n".',
              },
              jsXExpr: {
                type: 'string',
                description:
                  'Top-level JavaScript expression for kind="graphPointSequence": x(n) with variable `n` (integer index). Example: "n" or "Math.cos(n)". Use "**" for power (NEVER "^").',
              },
              pyXExpr: {
                type: 'string',
                description:
                  'Top-level NumPy expression for kind="graphPointSequence": x(n) with variable `n` (integer index). Example: "n" or "np.cos(n)". Use "**" for power (NEVER "^").',
              },
              jsYExpr: {
                type: 'string',
                description:
                  'Top-level JavaScript expression for kind="graphPointSequence": y(n) with variable `n` (integer index). Example: "0" or "Math.sin(n)". Use "**" for power (NEVER "^").',
              },
              pyYExpr: {
                type: 'string',
                description:
                  'Top-level NumPy expression for kind="graphPointSequence": y(n) with variable `n` (integer index). Example: "0" or "np.sin(n)". Use "**" for power (NEVER "^").',
              },
              nMin: {
                type: 'integer',
                description:
                  'Smallest integer index n (inclusive). Required for kind="graphFunctionSeries" (curve family) and kind="graphPointSequence" (point family).',
              },
              nMax: {
                type: 'integer',
                description:
                  'Largest integer index n (inclusive). Required for kind="graphFunctionSeries" and kind="graphPointSequence". Must satisfy nMax ≥ nMin after normalization.',
              },
              dot: GRAPH_DOT_SCHEMA,
              endpoints: SHAPE_ENDPOINTS_SCHEMA,
              angle: SHAPE_ANGLE_SCHEMA,
              ...SHAPE_PROPERTIES,
              mode: {
                type: 'string',
                enum: [
                  'accumulation',
                  'replacement',
                  ...TARGET_ANIMATION_MODES,
                ],
                description:
                  'For kind="graphFunctionSeries" or "graphPointSequence": "accumulation" keeps every curve/point on screen; "replacement" morphs/fades the previous into the next. For kind="target_animation": the effect mode — "scale" | "color" | "move" | "path" | "rotate" | "graphFollow" (Move along graph: moves a graph dot along its plot; rows use targetX). One mode per clip.',
              },
              displayMode: {
                type: 'string',
                enum: ['individual', 'partialSum'],
                description:
                  'For kind="graphFunctionSeries": "individual" plots each term f(n, x); "partialSum" plots S_k(x) = Σ_{n=nMin}^{k} f(n, x). Pair "partialSum" with mode="replacement" for Taylor / Fourier partial-sum convergence.',
              },
              defaults: {
                type: 'object',
                description:
                  'For kind="graphFunctionSeries": default styling applied to every curve unless overridden per-n. Omit to use sensible defaults.',
                properties: {
                  color: { type: 'string' },
                  strokeWidth: { type: 'number' },
                  lineStyle: {
                    type: 'string',
                    enum: ['solid', 'dashed', 'dotted'],
                  },
                  animDuration: { type: 'number' },
                  waitAfter: {
                    type: 'number',
                    description: 'Wait time in seconds after each curve finishes drawing.',
                  },
                },
              },
              perN: {
                type: 'object',
                description:
                  'For kind="graphFunctionSeries": per-index styling overrides. Keys are the stringified integer `n`, values are partial `{ color, strokeWidth, lineStyle, animDuration, waitAfter }` objects. Omit on CREATE unless the user asked for specific indices. On UPDATE, only include the indices you want to change — the app deep-merges this patch with the existing perN dictionary; indices you omit are preserved as-is.',
              },
              ...GRAPH_FIELD_PROPERTIES,
              ...GRAPH_AREA_PROPERTIES,
              ...TEXT_ANIM_PROPERTIES,
              targets: {
                type: 'array',
                description:
                  'For exit_animation: each row removes one target (animStyle). For blink_animation: each row pulses a target (mode, optional scaleFactor, blinkColor, segmentIndices on textLine). For target_animation: each row retargets one item — include the fields for the clip mode (scale → scaleFactor; color → color; move → dx/dy; rotate → angleDeg; path → pathKind + pathPoints or parametricPath). At least one entry.',
                items: {
                  type: 'object',
                  required: ['targetId'],
                  properties: {
                    targetId: {
                      type: 'string',
                      description:
                        'Scene item id (textLine, axes, graphPlot, graphCurve, graphDot, graphField, graphFunctionSeries, graphArea, shape, or surroundingRect) — existing or same-batch CREATE.',
                    },
                    animStyle: {
                      type: 'string',
                      enum: ['fade_out', 'uncreate', 'shrink_to_center', 'none'],
                      description:
                        'exit_animation rows only. "fade_out", "uncreate", "shrink_to_center", or "none".',
                    },
                    mode: {
                      type: 'string',
                      enum: ['scale', 'color'],
                      description: 'blink_animation rows only.',
                    },
                    scaleFactor: {
                      type: 'number',
                      description:
                        'blink_animation: peak scale (>1). target_animation with mode="scale": final scale factor.',
                    },
                    blinkColor: {
                      type: 'string',
                      description: 'blink_animation: CSS hex.',
                    },
                    color: {
                      type: 'string',
                      description:
                        'target_animation with mode="color": final CSS hex color.',
                    },
                    dx: {
                      type: 'number',
                      description:
                        'target_animation with mode="move": final x offset in Manim scene units.',
                    },
                    dy: {
                      type: 'number',
                      description:
                        'target_animation with mode="move": final y offset in Manim scene units.',
                    },
                    angleDeg: {
                      type: 'number',
                      description:
                        'target_animation with mode="rotate": final rotation in degrees (CCW positive).',
                    },
                    pathKind: {
                      type: 'string',
                      enum: ['polyline', 'parametric'],
                      description:
                        'target_animation with mode="path": "polyline" uses pathPoints offsets; "parametric" uses parametricPath offsets.',
                    },
                    pathPoints: {
                      type: 'array',
                      description:
                        'target_animation path row with pathKind="polyline": ≥2 offset points { x, y } from the anchor at clip start.',
                      items: {
                        type: 'object',
                        properties: {
                          x: { type: 'number' },
                          y: { type: 'number' },
                        },
                        required: ['x', 'y'],
                      },
                    },
                    parametricPath: {
                      type: 'object',
                      description:
                        'target_animation path row with pathKind="parametric": offset curves x(t), y(t) in parameter `t` (first sample subtracted automatically).',
                      properties: {
                        jsXExpr: {
                          type: 'string',
                          description:
                            'JavaScript offset x(t). Example: "t" or "Math.cos(t)". Use "**" (NEVER "^").',
                        },
                        pyXExpr: {
                          type: 'string',
                          description:
                            'NumPy offset x(t). Example: "t" or "np.cos(t)". Use "**" (NEVER "^").',
                        },
                        jsYExpr: {
                          type: 'string',
                          description:
                            'JavaScript offset y(t). Example: "Math.sin(t)". Use "**" (NEVER "^").',
                        },
                        pyYExpr: {
                          type: 'string',
                          description:
                            'NumPy offset y(t). Example: "np.sin(t)". Use "**" (NEVER "^").',
                        },
                        tMin: { type: 'number' },
                        tMax: { type: 'number' },
                        samples: { type: 'integer' },
                      },
                    },
                    ...GRAPH_FOLLOW_ROW_PROPERTIES,
                    segmentIndices: {
                      type: 'array',
                      description: 'blink_animation on textLine: segment indices (line[i]); omit for whole line.',
                      items: { type: 'integer' },
                    },
                    mathSubtargets: {
                      type: 'array',
                      description:
                        'blink_animation on textLine math segments only: Manim subobject indices (line[i][j]). Do not invent; omit unless indices are known from UI measurement.',
                      items: {
                        type: 'object',
                        properties: {
                          segmentIndex: { type: 'integer' },
                          childIndices: {
                            type: 'array',
                            items: { type: 'integer' },
                          },
                        },
                        required: ['segmentIndex', 'childIndices'],
                      },
                    },
                  },
                },
              },
              repetitions: {
                type: 'integer',
                description: 'blink_animation only: cycles in duration (≥1). Default 1.',
              },
            },
          },
          itemId: {
            type: 'string',
            description: 'Required for UPDATE and DELETE; id of an existing item.',
          },
          edit: TIMELINE_EDIT_SCHEMA,
          updates: {
            type: 'object',
            description:
              'Required for UPDATE only. Partial patch of fields to change on the target item. For graphFunctionSeries, include only the perN entries you want to change — the app deep-merges your patch with the existing dictionary so other indices are never dropped. Expression fields use the same paired shapes as CREATE (fn for graphPlot, curve coordinates for graphCurve, jsExpr/pyExpr for graphFunctionSeries, coordinate pairs for graphPointSequence, targets[].parametricPath for path-mode target_animation); the app rewrites "^" to "**" and derives a missing dialect.',
            properties: {
              targetMode: { type: 'string', enum: ['frame', 'region', 'object', 'follow'], description: 'camera_move UPDATE request-only target mode; resolved before persistence.' },
              targetId: { type: 'string', description: 'camera_move UPDATE request-only exact existing object id.' },
              region: { type: 'object', description: 'camera_move UPDATE request-only finite world-space region.', properties: { left: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, top: { type: 'number' } } },
              targetFrameId: { type: 'string', description: 'camera_move UPDATE: destination frame id from the existing frame catalog.' },
              targetWidth: { type: 'number', description: 'camera_move UPDATE: positive absolute target frame width.' },
              offsetX: { type: 'number', description: 'camera_move UPDATE: finite horizontal offset.' },
              offsetY: { type: 'number', description: 'camera_move UPDATE: finite vertical offset.' },
              baseDir: { type: 'string', enum: ['rtl', 'ltr'], description: "textLine: 'ltr' for an English-base line (plain text is English, Hebrew is marked \\he{...}). Omit for the default right-to-left Hebrew line (English is marked \\en{...})." },
              englishFont: { type: 'string', description: "textLine: font for English text. Omit to use the Hebrew font; 'Latin Modern Roman' = LaTeX default." },
              startTime: { type: 'number', description: 'camera_move UPDATE: finite start time in seconds.' },
              duration: { type: 'number', description: 'camera_move UPDATE: transition duration, minimum 0.05 seconds.' },
              dot: GRAPH_DOT_SCHEMA,
              endpoints: SHAPE_ENDPOINTS_SCHEMA,
              angle: SHAPE_ANGLE_SCHEMA,
              ...SHAPE_PROPERTIES,
              ...GRAPH_FIELD_PROPERTIES,
              ...GRAPH_AREA_PROPERTIES,
              ...TEXT_ANIM_PROPERTIES,
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Google Gemini provider. Uses function calling with a forced `emit_response`
 * function (mode: ANY) so the model must emit structured JSON matching our
 * schema — mirrors the Anthropic adapter's strategy.
 *
 * Chat history is replayed as alternating user / model turns. Prior model
 * turns are re-sent as a `functionCall` part so the model stays on-schema.
 * When `includeThinking` is requested and the model supports it (Gemini 2.5
 * series), `thinkingConfig.includeThoughts` is enabled and any `thought`
 * parts in the response are collected into `thinking`.
 */
export function createGeminiProvider(cfg: ProviderConfig): AgentProvider {
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = cfg.model || DEFAULT_MODEL;

  return {
    id: 'gemini',
    async generate({
      payload,
      systemPrompt,
      history,
      userPrompt,
      includeThinking,
      signal,
    }: ProviderGenerateInput): Promise<RawAgentResponse> {
      if (!cfg.apiKey) {
        throw new AgentProviderError('Gemini API key is not configured.');
      }
      const url =
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent` +
        `?key=${encodeURIComponent(cfg.apiKey)}`;

      const contents = buildGeminiContents({ history, payload, userPrompt });

      const wantThoughts = includeThinking && supportsThinking(model);

      const body: Record<string, unknown> = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'emit_response',
                description:
                  'Emit the chat reply and the list of CREATE / UPDATE / DELETE actions (possibly empty) for this turn.',
                parameters: GEMINI_RESPONSE_SCHEMA,
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: ['emit_response'],
          },
        },
      };
      if (wantThoughts) {
        body.generationConfig = {
          thinkingConfig: { includeThoughts: true },
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await safeText(res);
        throw new AgentProviderError(
          `Gemini request failed (${res.status}): ${text}`,
          res.status,
        );
      }

      const data = (await res.json()) as {
        candidates?: {
          content?: {
            parts?: {
              functionCall?: { name?: string; args?: unknown };
              text?: string;
              thought?: boolean;
            }[];
          };
        }[];
        promptFeedback?: { blockReason?: string };
      };

      if (data.promptFeedback?.blockReason) {
        throw new AgentProviderError(
          `Gemini blocked the request: ${data.promptFeedback.blockReason}`,
        );
      }

      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const thoughtTexts = parts
        .filter((p) => p.thought === true && typeof p.text === 'string')
        .map((p) => p.text as string);

      for (const p of parts) {
        if (
          p.functionCall &&
          p.functionCall.name === 'emit_response' &&
          p.functionCall.args &&
          typeof p.functionCall.args === 'object'
        ) {
          const out = p.functionCall.args as Record<string, unknown>;
          if (thoughtTexts.length > 0) {
            out.thinking = thoughtTexts.join('\n\n').trim();
          }
          return out;
        }
      }

      // Fallback: some Gemini deployments return the JSON inline as text
      // when function calling is unavailable; try to parse it.
      const textPart = parts
        .filter((p) => p.thought !== true && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('')
        .trim();
      if (textPart) {
        try {
          const parsed = JSON.parse(extractJson(textPart)) as Record<
            string,
            unknown
          >;
          if (thoughtTexts.length > 0) {
            parsed.thinking = thoughtTexts.join('\n\n').trim();
          }
          return parsed;
        } catch (e) {
          throw new AgentProviderError(
            `Gemini returned non-JSON text: ${(e as Error).message}`,
          );
        }
      }

      throw new AgentProviderError(
        'Gemini did not invoke the emit_response function.',
      );
    },
  };
}

function supportsThinking(model: string): boolean {
  const m = model.toLowerCase();
  // 2.5 and later surface thought summaries.
  return (
    m.includes('gemini-2.5') ||
    m.includes('gemini-3') ||
    m.includes('gemini-4')
  );
}

interface BuildGeminiContentsInput {
  history: AgentChatMessage[];
  payload: AgentContextPayload;
  userPrompt: string;
}

type GeminiPart =
  | { text: string }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
    }
  | {
      functionResponse: { name: string; response: Record<string, unknown> };
    };

function buildGeminiContents(input: BuildGeminiContentsInput): {
  role: 'user' | 'model';
  parts: GeminiPart[];
}[] {
  const out: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  let pendingFnCallForResponse = false;

  for (const m of input.history) {
    if (m.role === 'user') {
      const parts: GeminiPart[] = [];
      if (pendingFnCallForResponse) {
        parts.push({
          functionResponse: {
            name: 'emit_response',
            response: { status: 'ok' },
          },
        });
        pendingFnCallForResponse = false;
      }
      parts.push({ text: m.content });
      out.push({ role: 'user', parts });
    } else {
      const applied = m.actionsStatus === 'approved' ? (m.actions ?? []) : [];
      const noteSuffix =
        m.actionsStatus === 'rejected'
          ? '\n\n(Note: the user rejected the previous proposal; it was NOT applied.)'
          : m.actionsStatus === 'superseded'
            ? '\n\n(Note: the previous proposal was superseded by a newer reply; it was NOT applied.)'
            : '';
      out.push({
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'emit_response',
              args: {
                reply: m.content + noteSuffix,
                actions: applied as unknown as Record<string, unknown>[],
              },
            },
          },
        ],
      });
      pendingFnCallForResponse = true;
    }
  }

  // Current user turn — carries the scene payload preamble.
  const currentText = buildCurrentUserText(input.payload, input.userPrompt);
  const parts: GeminiPart[] = [];
  if (pendingFnCallForResponse) {
    parts.push({
      functionResponse: {
        name: 'emit_response',
        response: { status: 'ok' },
      },
    });
  }
  parts.push({ text: currentText });
  out.push({ role: 'user', parts });
  return out;
}

function buildCurrentUserText(
  payload: AgentContextPayload,
  userPrompt: string,
): string {
  return (
    'Current project state (JSON):\n```json\n' +
    JSON.stringify(payload, null, 2) +
    '\n```\n\nUser message:\n' +
    userPrompt +
    '\n\nCall the `emit_response` function with your reply (required) and any actions (possibly empty).'
  );
}

/** Strip an optional ```json fence if the model wrapped its output. */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) return fence[1].trim();
  return text.trim();
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
