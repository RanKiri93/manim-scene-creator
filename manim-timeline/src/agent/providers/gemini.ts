import { AGENT_ALLOWED_KINDS } from '../types';
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
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['reply'],
  properties: {
    reply: {
      type: 'string',
      description:
        'The conversational message shown to the user. Required and non-empty. Use this to explain changes, ask clarifying questions, or discuss the scene. When you are only chatting, set actions to an empty array.',
    },
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
            enum: ['CREATE', 'UPDATE', 'DELETE'],
            description:
              'Discriminator. MUST be one of CREATE, UPDATE, DELETE.',
          },
          item: {
            type: 'object',
            description:
              'Required for CREATE only. Full scene item with `id`, `kind`, and any kind-specific fields.\n' +
              'IMPORTANT:\n' +
              '• When `kind` is "graphPlot", "graphCurve", "graphDot", or "graphFunctionSeries", set `axesId` when referencing axes (existing id or same-batch CREATE).\n' +
              '• When `kind` is "graphPlot", the function goes under `fn` as `{ jsExpr, pyExpr, color, label }`. `jsExpr` is a JavaScript expression (e.g. "x*x" or "Math.sin(x)"), `pyExpr` is its NumPy equivalent (e.g. "x**2" or "np.sin(x)"). NEVER put the expression under `fn.expr` or as a bare string — always use `jsExpr` and `pyExpr` with the correct dialect. Use "**" (not "^") for power.\n' +
              '• When `kind` is "graphCurve", coordinates go under `curve` as `{ jsXExpr, pyXExpr, jsYExpr, pyYExpr, color, label }` with parameter `t`. Also set top-level `tDomain: [tMin, tMax]` (two numbers). Use "**" (not "^") for power.\n' +
              '• When `kind` is "graphFunctionSeries", put expressions at the TOP LEVEL as `jsExpr` and `pyExpr` (or a single top-level `expr` alias); both dialects must be derivable. Reference BOTH `n` (integer index) and `x`. Set `nMin`, `nMax` (integers), `displayMode` ("individual" | "partialSum"), and `mode` ("accumulation" | "replacement"). Vector/slope fields (`graphField`) and filled regions (`graphArea`) are not agent-created — use the editor UI.\n',
            properties: {
              id: { type: 'string' },
              kind: {
                type: 'string',
                enum: [...AGENT_ALLOWED_KINDS],
              },
              axesId: {
                type: 'string',
                description:
                  'REQUIRED when kind is "graphPlot", "graphCurve", "graphDot", or "graphFunctionSeries". Must equal an existing axes id in the scene, or the id of an axes you are CREATE-ing earlier in this same actions array. Omit for other agent-created kinds.',
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
                  jsXExpr: { type: 'string' },
                  pyXExpr: { type: 'string' },
                  jsYExpr: { type: 'string' },
                  pyYExpr: { type: 'string' },
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
              nMin: {
                type: 'integer',
                description:
                  'Smallest integer index n in the family (inclusive). Required for kind="graphFunctionSeries".',
              },
              nMax: {
                type: 'integer',
                description:
                  'Largest integer index n in the family (inclusive). Required for kind="graphFunctionSeries". Must satisfy nMax ≥ nMin after normalization.',
              },
              mode: {
                type: 'string',
                enum: ['accumulation', 'replacement'],
                description:
                  'For kind="graphFunctionSeries": "accumulation" draws each curve on top of the previous ones; "replacement" transforms the previous curve into the next (ideal for convergence animations).',
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
              fieldMode: {
                type: 'string',
                enum: ['vector', 'slope', 'none'],
                description:
                  'For kind="graphField": "slope" visualizes a scalar slope field dy/dx = f(x, y) (use jsExprSlope/pyExprSlope); "vector" visualizes a planar vector field (P(x,y), Q(x,y)) (use jsExprP/pyExprP and jsExprQ/pyExprQ); "none" disables arrow rendering (streamlines only).',
              },
              jsExprSlope: {
                type: 'string',
                description:
                  'For kind="graphField" with fieldMode="slope": JavaScript expression for dy/dx in terms of `x` and `y`. Example: "x - y" or "Math.sin(x) * y". Use "**" for power.',
              },
              pyExprSlope: {
                type: 'string',
                description:
                  'For kind="graphField" with fieldMode="slope": NumPy expression for dy/dx in terms of `x` and `y`. Example: "x - y" or "np.sin(x) * y". Use "**" for power.',
              },
              slopeArrowLength: {
                type: 'number',
                description:
                  'For kind="graphField" with fieldMode="slope": rendered length of each slope tick in graph units. Default 0.5.',
              },
              jsExprP: {
                type: 'string',
                description:
                  'For kind="graphField" with fieldMode="vector": JavaScript expression for the x-component P(x, y). Example: "-y" or "Math.cos(x)". Use "**" for power.',
              },
              pyExprP: {
                type: 'string',
                description:
                  'For kind="graphField" with fieldMode="vector": NumPy expression for the x-component P(x, y). Example: "-y" or "np.cos(x)". Use "**" for power.',
              },
              jsExprQ: {
                type: 'string',
                description:
                  'For kind="graphField" with fieldMode="vector": JavaScript expression for the y-component Q(x, y). Example: "x" or "Math.sin(x) - y". Use "**" for power.',
              },
              pyExprQ: {
                type: 'string',
                description:
                  'For kind="graphField" with fieldMode="vector": NumPy expression for the y-component Q(x, y). Example: "x" or "np.sin(x) - y". Use "**" for power.',
              },
              fieldGridStep: {
                type: 'number',
                description:
                  'For kind="graphField": spacing (in graph units) between sampled arrows on the grid. Default 0.5. Smaller = denser field.',
              },
              fieldColormap: {
                type: 'string',
                enum: ['viridis', 'plasma', 'inferno', 'magma'],
                description:
                  'For kind="graphField": colormap used to shade arrows by magnitude. Default "viridis".',
              },
              colorSchemeMin: {
                type: 'number',
                description:
                  'For kind="graphField": magnitude mapped to the low end of the colormap. Default 0.',
              },
              colorSchemeMax: {
                type: 'number',
                description:
                  'For kind="graphField": magnitude mapped to the high end of the colormap. Default 2.',
              },
              arrowStrokeWidth: {
                type: 'number',
                description:
                  'For kind="graphField": stroke width in pixels of each arrow shaft / slope tick. Applied to both the canvas preview and the Manim ArrowVectorField via set_stroke(width=...). Default 4. Use ~1.5–2 for hairline arrows, ~6–8 for bold arrows.',
              },
              streamPoints: {
                type: 'array',
                description:
                  'For kind="graphField": optional seed points for ODE streamlines integrated through the field. Each entry is { id, x, y } in graph coordinates. Omit for a plain arrow field.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
              },
              streamDt: {
                type: 'number',
                description:
                  'For kind="graphField": integration timestep for streamlines. Default 0.05.',
              },
              streamVirtualTime: {
                type: 'number',
                description:
                  'For kind="graphField": total virtual time (seconds) integrated per streamline. Default 3.',
              },
              targets: {
                type: 'array',
                description:
                  'For exit_animation: each row removes one target (animStyle). For blink_animation: each row pulses a target (mode, optional scaleFactor, blinkColor, segmentIndices on textLine). At least one entry.',
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
                      description: 'blink_animation: peak scale (>1).',
                    },
                    blinkColor: {
                      type: 'string',
                      description: 'blink_animation: CSS hex.',
                    },
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
          updates: {
            type: 'object',
            description:
              'Required for UPDATE only. Partial patch of fields to change on the target item. For graphFunctionSeries, include only the perN entries you want to change — the app deep-merges your patch with the existing dictionary so other indices are never dropped.',
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
