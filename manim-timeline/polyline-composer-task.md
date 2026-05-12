# Composer Task: Add Polyline Shape

## Goal

Add a new `Polyline` shape feature to the timeline editor.

The user should be able to create a shape whose geometry is an ordered list of points. The canvas preview should draw straight connected segments through those points in order.

The user should also be able to choose arrowheads independently:

- no arrowheads;
- tail arrowhead only;
- head arrowhead only;
- both tail and head arrowheads.

This should behave like the existing shape system wherever possible: same timeline clip behavior, same shared shape style controls, same positioning model, same audio binding behavior, same export flow.

Do not create a separate top-level item kind unless there is a strong reason. Prefer extending the existing `shape` item because the requested behavior is a shape variant and should inherit general shape properties.

## User-Facing Behavior

### Creation

The user can add a shape from the existing `+ Object > Shape` flow, then change `Shape type` to `Polyline`.

Recommended default polyline geometry:

```ts
[
  { x: -1, y: 0 },
  { x: 0, y: 0.75 },
  { x: 1, y: 0 },
]
```

This gives the user an immediately visible editable object.

### Point Picking

When a `Polyline` shape is selected, the properties panel should expose a `Points` section.

Required controls:

- `Start picking points` button.
- `Finish picking` button, shown while picking.
- `Clear points` button.
- Per-point numeric editors for `X` and `Y`.
- Per-point delete button.
- Optional but recommended: `Add point` button that appends a point after the current last point.

While point picking is active:

- clicking on the black canvas frame should append a point to the selected polyline;
- points should be recorded in Manim scene units;
- point order should be preserved exactly;
- the visible polyline should update after each click;
- clicking existing canvas objects should not accidentally select another item unless the click is clearly on another object and not on the empty stage;
- pressing `Escape` should exit picking mode if practical.

For the first implementation, point insertion between existing points can be omitted. The numeric list plus append/delete is enough.

### Arrowheads

Expose a control named `Arrowheads` with options:

```text
None
Tail
Head
Both
```

Definitions:

- `tail` means the first point in the ordered list;
- `head` means the last point in the ordered list;
- arrowhead direction follows the local path direction;
- head arrow points from the second-to-last point toward the last point;
- tail arrow points from the second point back toward the first point.

If the polyline has fewer than 2 distinct points, arrowheads should not render and export should avoid invalid arrow-tip math.

### Existing Shape Properties

The following existing shape properties should continue to work:

- clip name;
- stroke color;
- stroke width;
- fill toggle should not apply to polylines;
- intro style `Create` / `FadeIn`;
- start time;
- duration;
- layer;
- audio binding;
- position steps;
- `X`, `Y`, `Scale`, `Rotation`.

For polylines, hide or disable fill controls because a polyline is an open stroked path.

## Current Codebase Context

The app already has a generic shape model:

- `src/types/scene.ts`
  - `ShapeKind = 'circle' | 'rectangle' | 'arrow' | 'line'`
  - `ShapeItem` stores shared shape style, timing, positioning, and line/arrow vector data.
- `src/store/factories.ts`
  - `createShape()` creates the default shape.
- `src/panels/ShapeEditor.tsx`
  - shape type selector;
  - dimension controls;
  - shared style controls;
  - timeline / audio controls;
  - positioning controls.
- `src/canvas/layers/ShapeNode.tsx`
  - Konva preview for `Circle`, `Rect`, `Arrow`, and `Line`;
  - selected shape transformer;
  - drag and transform behavior.
- `src/codegen/shapeCodegen.ts`
  - Manim definitions for `Circle`, `Rectangle`, `Arrow`, and `Line`;
  - position / rotation / scale export;
  - intro animation export.
- `src/panels/PropertyPanel.tsx`
  - routes `shape` items to `ShapeEditor`.
- `src/panels/ItemList.tsx`
  - creates shapes through `createShape()`.
- `src/lib/resolvePosition.ts` and `src/lib/nextToGeometry.ts`
  - shape bounding boxes for positioning and `next_to`.
- `src/codegen/manimExporter.ts`
  - includes shapes as export leaves and validates `next_to` references.
- `src/agent/validate.ts`
  - normalizes incoming agent shape objects.

The implementation should fit this structure rather than adding a parallel polyline subsystem.

## Recommended Data Model

### 1. Add A Shared Point Type

In `src/types/scene.ts`, near `ShapeKind`, add:

```ts
export interface ShapePoint {
  x: number;
  y: number;
}
```

Coordinates are local Manim coordinates relative to the shape item's anchor. The item-level `x` and `y` remain the center / anchor used by the position pipeline.

### 2. Extend `ShapeKind`

Change:

```ts
export type ShapeKind = 'circle' | 'rectangle' | 'arrow' | 'line';
```

to:

```ts
export type ShapeKind = 'circle' | 'rectangle' | 'arrow' | 'line' | 'polyline';
```

### 3. Extend `ShapeItem`

Add fields to `ShapeItem`:

```ts
/** Polyline: ordered local points relative to the shape anchor. */
points: ShapePoint[];
/** Polyline only: arrowhead at the first point. */
tailArrow: boolean;
/** Polyline only: arrowhead at the last point. */
headArrow: boolean;
```

Keep these fields on the existing `ShapeItem` rather than creating a separate union for the first pass. This is consistent with the current shape model, which already keeps `radius`, `width`, `height`, `endX`, and `endY` on all shapes even though only some shape types use each field.

Recommended defaults:

```ts
points: [
  { x: -1, y: 0 },
  { x: 0, y: 0.75 },
  { x: 1, y: 0 },
],
tailArrow: false,
headArrow: false,
```

### 4. Add UI-Only Picking State

Add transient UI state to `src/store/useSceneStore.ts`:

```ts
polylinePointCaptureId: ItemId | null;
setPolylinePointCaptureId: (id: ItemId | null) => void;
```

Keep this in the store UI slice, not on `ShapeItem`, so the picking state is not saved into `.mtproj` files.

When a selected item is deleted or changed away from `shapeType: 'polyline'`, clear `polylinePointCaptureId` if it points to that item.

## Coordinate Model

Use the same Manim coordinate conversion as `ShapeNode`:

```ts
const canvasToManim = (cx: number, cy: number) => ({
  mx: (cx / canvasWidth - 0.5) * FRAME_W,
  my: (0.5 - cy / canvasHeight) * FRAME_H,
});
```

When appending a clicked point:

1. Convert the stage click position to absolute Manim coordinates.
2. Resolve the polyline item's current anchor position via `resolvePosition(item, itemsMap)`.
3. Convert the clicked absolute coordinate into a local point:

```ts
const local = {
  x: clicked.mx - resolvedAnchor.x,
  y: clicked.my - resolvedAnchor.y,
};
```

This keeps `item.x` / `item.y` as the movable object anchor, while `points` define shape-local geometry.

For the initial implementation, do not attempt to inverse-apply item rotation or scale when adding a clicked point. Instead:

- document that point picking is intended while rotation is `0` and scale is `1`;
- or, better, disable picking if `rotationDeg !== 0` or `scale !== 1` and show helper text.

If full support is desired, the click-to-local conversion must inverse-transform the clicked coordinate by the item's rotation and scale before appending it. That can be a follow-up.

## Files To Edit

Expected files:

- `src/types/scene.ts`
- `src/store/factories.ts`
- `src/store/useSceneStore.ts`
- `src/panels/ShapeEditor.tsx`
- `src/canvas/SceneCanvas.tsx`
- `src/canvas/layers/ShapeNode.tsx`
- `src/codegen/shapeCodegen.ts`
- `src/lib/resolvePosition.ts`
- `src/lib/nextToGeometry.ts`
- `src/lib/itemDisplayName.ts`
- `src/codegen/scriptExport.ts`
- `src/agent/validate.ts`
- `src/lib/migrateLoadedItems.ts`
- `src/lib/constants.ts`

Recommended test files:

- `src/codegen/shapeCodegen.test.ts`
- `src/lib/resolvePosition.test.ts`
- `src/lib/nextToGeometry.test.ts`
- `src/agent/validate.test.ts`

Do not edit unrelated app areas.

## Implementation Steps

### 1. Update Scene Types

In `src/types/scene.ts`:

1. Add `ShapePoint`.
2. Add `'polyline'` to `ShapeKind`.
3. Add `points`, `tailArrow`, and `headArrow` to `ShapeItem`.

The updated shape section should conceptually look like:

```ts
export type ShapeKind = 'circle' | 'rectangle' | 'arrow' | 'line' | 'polyline';

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeItem extends SceneItemBase {
  kind: 'shape';
  shapeType: ShapeKind;
  rotationDeg: number;
  radius: number;
  width: number;
  height: number;
  endX: number;
  endY: number;
  points: ShapePoint[];
  tailArrow: boolean;
  headArrow: boolean;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string | null;
  fillOpacity: number;
  introStyle: 'create' | 'fade_in';
}
```

### 2. Update Factory Defaults

In `src/store/factories.ts`, update `createShape()` to include:

```ts
points: [
  { x: -1, y: 0 },
  { x: 0, y: 0.75 },
  { x: 1, y: 0 },
],
tailArrow: false,
headArrow: false,
```

Keep `shapeType: 'circle'` as the default unless you want `+ Shape` to directly create a polyline. The request does not require a new object menu entry.

### 3. Add Migration For Existing Projects

Because `ShapeItem` now has required fields, existing project files need defaults.

Recommended approach:

1. Increment `PROJECT_VERSION` in `src/lib/constants.ts` from `27` to `28`.
2. Add `src/lib/migrateProjectToV28.ts`.
3. Import and call it from `src/lib/migrateLoadedItems.ts` when `fileVersion < 28`.

Migration behavior:

- for every item with `kind === 'shape'`;
- if `points` is missing or invalid, set default polyline points;
- if `tailArrow` is missing, set `false`;
- if `headArrow` is missing, set `false`.

Suggested implementation:

```ts
import type { SceneItem, ShapePoint } from '@/types/scene';

const DEFAULT_POLYLINE_POINTS: ShapePoint[] = [
  { x: -1, y: 0 },
  { x: 0, y: 0.75 },
  { x: 1, y: 0 },
];

function isPoint(v: unknown): v is ShapePoint {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ShapePoint).x === 'number' &&
    Number.isFinite((v as ShapePoint).x) &&
    typeof (v as ShapePoint).y === 'number' &&
    Number.isFinite((v as ShapePoint).y)
  );
}

export function migrateItemsToV28(items: SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'shape') return item;
    const raw = item as SceneItem & Record<string, unknown>;
    const points = Array.isArray(raw.points) && raw.points.every(isPoint)
      ? raw.points
      : DEFAULT_POLYLINE_POINTS;
    return {
      ...item,
      points,
      tailArrow: typeof raw.tailArrow === 'boolean' ? raw.tailArrow : false,
      headArrow: typeof raw.headArrow === 'boolean' ? raw.headArrow : false,
    };
  });
}
```

### 4. Normalize Agent / Imported Shape Objects

In `src/agent/validate.ts`, update `normalizeShape()`.

It currently reads:

```ts
const shapeType = (raw.shapeType as ShapeItem['shapeType']) ?? 'circle';
```

Add safe parsing for points:

```ts
function normalizeShapePoints(rawPoints: unknown): ShapePoint[] {
  if (!Array.isArray(rawPoints)) return DEFAULT_POLYLINE_POINTS;
  const points = rawPoints
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const x = asNum((p as Record<string, unknown>).x, NaN);
      const y = asNum((p as Record<string, unknown>).y, NaN);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter((p): p is ShapePoint => !!p);
  return points.length >= 2 ? points : DEFAULT_POLYLINE_POINTS;
}
```

Then include:

```ts
points: normalizeShapePoints(raw.points),
tailArrow: typeof raw.tailArrow === 'boolean' ? raw.tailArrow : false,
headArrow: typeof raw.headArrow === 'boolean' ? raw.headArrow : false,
```

Keep the default permissive behavior for non-polyline shapes so older agent outputs still normalize.

### 5. Add UI Store State For Point Picking

In `src/store/useSceneStore.ts`:

1. Add `polylinePointCaptureId` to `UiSlice`.
2. Add `setPolylinePointCaptureId`.
3. Initialize it to `null`.
4. Implement the setter.

Example:

```ts
interface UiSlice {
  exportOpen: boolean;
  audioMode: AudioPanelMode | null;
  agentOpen: boolean;
  polylinePointCaptureId: ItemId | null;
  setExportOpen: (open: boolean) => void;
  setAudioMode: (mode: AudioPanelMode | null) => void;
  setAgentOpen: (open: boolean) => void;
  setPolylinePointCaptureId: (id: ItemId | null) => void;
}
```

Implementation:

```ts
polylinePointCaptureId: null,
setPolylinePointCaptureId: (id) => set({ polylinePointCaptureId: id }),
```

In `removeItem`, clear it if the removed id is active:

```ts
if (get().polylinePointCaptureId === id) {
  draft.polylinePointCaptureId = null;
}
```

Use the store's existing Immer mutation style. Do not introduce a separate global React state for this.

### 6. Add Shape Editor Controls

In `src/panels/ShapeEditor.tsx`:

1. Add `{ value: 'polyline', label: 'Polyline' }` to `SHAPE_TYPES`.
2. Import `ShapePoint` if needed.
3. Read `polylinePointCaptureId` and `setPolylinePointCaptureId` from the store.
4. Add point-editing controls shown only when `item.shapeType === 'polyline'`.
5. Hide fill controls for polyline.

Recommended helpers inside `ShapeEditor`:

```ts
const setPoint = (index: number, patch: Partial<ShapePoint>) => {
  set({
    points: item.points.map((p, i) => (i === index ? { ...p, ...patch } : p)),
  });
};

const addPoint = () => {
  const last = item.points[item.points.length - 1] ?? { x: 0, y: 0 };
  set({ points: [...item.points, { x: last.x + 0.5, y: last.y }] });
};

const deletePoint = (index: number) => {
  set({ points: item.points.filter((_, i) => i !== index) });
};
```

Use `NumberInput` for each point coordinate.

Arrowhead select:

```tsx
<select
  value={item.tailArrow && item.headArrow ? 'both' : item.tailArrow ? 'tail' : item.headArrow ? 'head' : 'none'}
  onChange={(e) => {
    const mode = e.target.value;
    set({
      tailArrow: mode === 'tail' || mode === 'both',
      headArrow: mode === 'head' || mode === 'both',
    });
  }}
>
  <option value="none">None</option>
  <option value="tail">Tail</option>
  <option value="head">Head</option>
  <option value="both">Both</option>
</select>
```

Point picking buttons:

```tsx
{isCapturing ? (
  <button onClick={() => setPolylinePointCaptureId(null)}>Finish picking</button>
) : (
  <button onClick={() => setPolylinePointCaptureId(item.id)}>Start picking points</button>
)}
```

When `shapeType` changes away from `polyline`, clear point picking if active.

Recommended helper text:

```text
Click the canvas to append points in order. Tail is the first point; head is the last point.
```

### 7. Capture Canvas Clicks In `SceneCanvas`

In `src/canvas/SceneCanvas.tsx`:

1. Read `polylinePointCaptureId`, `updateItem`, and `itemsMap`.
2. On stage click, before `clearSelection()`, check whether point capture is active.
3. If active and the click target is the stage or the grid/background, append a point and keep selection.

Implementation outline:

```ts
const polylinePointCaptureId = useSceneStore((s) => s.polylinePointCaptureId);
const updateItem = useSceneStore((s) => s.updateItem);
```

Add a helper near the component:

```ts
function canvasPointToManim(pos: { x: number; y: number }, size: { width: number; height: number }) {
  return {
    x: (pos.x / size.width - 0.5) * FRAME_W,
    y: (0.5 - pos.y / size.height) * FRAME_H,
  };
}
```

Stage click logic:

```tsx
onClick={(e) => {
  if (polylinePointCaptureId) {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    const raw = itemsMap.get(polylinePointCaptureId);
    if (pos && raw?.kind === 'shape' && raw.shapeType === 'polyline') {
      const abs = canvasPointToManim(pos, size);
      const anchor = resolvePosition(raw, itemsMap);
      updateItem(raw.id, {
        points: [...raw.points, { x: abs.x - anchor.x, y: abs.y - anchor.y }],
      });
      useSceneStore.getState().select(raw.id);
      return;
    }
  }
  if (e.target === e.target.getStage()) clearSelection();
}}
```

If grid layer nodes intercept clicks, either:

- mark non-interactive grid shapes as `listening={false}` if they are not already;
- or allow capture when `e.target === stage` or target is known background/grid.

Do not allow point capture to accidentally create points while dragging objects or transformer handles.

### 8. Render Polyline In `ShapeNode`

In `src/canvas/layers/ShapeNode.tsx`:

1. Add polyline handling to `bboxHalfPx`.
2. Add polyline handling to `onTransformEnd`.
3. Add polyline rendering in `inner`.

Coordinate conversion:

```ts
const toCanvasPoint = (p: ShapePoint) => [p.x * pxPerUnitX, -p.y * pxPerUnitY];
```

Konva line points:

```ts
const points = item.points.flatMap((p) => [p.x * pxPerUnitX, -p.y * pxPerUnitY]);
```

Render the connected path:

```tsx
<KonvaLine
  points={points}
  stroke={stroke}
  strokeWidth={Math.max(1, item.strokeWidth * 0.35)}
  lineCap="round"
  lineJoin="round"
/>
```

Arrowheads in Konva:

- For the head arrow, render a short `KonvaArrow` from the second-to-last point to the last point with `strokeWidth` matching the line. It can overlap the final segment.
- For the tail arrow, render a short `KonvaArrow` from the second point to the first point.
- Use `pointerAtEnding` for the arrow direction if using `KonvaArrow`.

Recommended helper:

```ts
function arrowSegment(points: ShapePoint[], at: 'head' | 'tail'): [ShapePoint, ShapePoint] | null {
  if (points.length < 2) return null;
  return at === 'head'
    ? [points[points.length - 2]!, points[points.length - 1]!]
    : [points[1]!, points[0]!];
}
```

For transform end:

```ts
case 'polyline':
  patch.points = base.points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  break;
```

This matches line/arrow behavior, where transform bakes scale into geometry and resets group scale to `1`.

For bounding selection:

```ts
case 'polyline': {
  const xs = item.points.map((p) => p.x * pxPerUnitX * s);
  const ys = item.points.map((p) => p.y * pxPerUnitY * s);
  const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const h = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  return Math.max(24, Math.hypot(w, h) / 2 + 8);
}
```

If points are empty, render a faint placeholder or nothing plus selection outline.

### 9. Export Polyline To Manim

In `src/codegen/shapeCodegen.ts`, extend `generateShapeDef()`.

Preferred export strategy:

- create a `VMobject`;
- call `set_points_as_corners([...])`;
- style stroke;
- optionally add arrow tips via `add_tip` or separate `ArrowTriangleFilledTip` objects if available.

Recommended robust implementation:

```py
polyline_1 = VMobject(color=ManimColor("#60a5fa"), stroke_width=3.0000)
polyline_1.set_points_as_corners([
    [-1.0000, 0.0000, 0],
    [0.0000, 0.7500, 0],
    [1.0000, 0.0000, 0],
])
```

For arrowheads, the most Manim-native path is to use `add_tip`:

```py
polyline_1.add_tip(tip_length=0.2, tip_width=0.2)
```

For tail tips, Manim supports `at_start=True` on many tip APIs in recent versions:

```py
polyline_1.add_tip(tip_length=0.2, tip_width=0.2, at_start=True)
```

However, verify the local Manim version before committing to this. If `at_start` is unsupported, use explicit short `Arrow` tip mobjects or a small custom triangle.

The safest export plan is:

1. emit the VMobject for the connected path;
2. if `headArrow` or `tailArrow`, create one or two `Arrow` objects with `max_tip_length_to_length_ratio=1` and no visible shaft, or use Manim's tip API if confirmed;
3. group them in a `VGroup` so existing position / rotation / scale code applies to one variable.

Example generated code shape:

```py
_polyline_1_path = VMobject(color=ManimColor("#60a5fa"), stroke_width=3.0000)
_polyline_1_path.set_points_as_corners([
    [-1.0000, 0.0000, 0],
    [0.0000, 0.7500, 0],
    [1.0000, 0.0000, 0],
])
polyline_1 = VGroup(_polyline_1_path)
_polyline_1_path.add_tip(tip_length=0.2, tip_width=0.2)
```

If using `add_tip`, do it before wrapping or after accessing the path object. Keep the exported top-level variable name as `varName`, because downstream `generateShapePos()` and `generateShapePlay()` expect one object variable.

Validation:

- If `item.points.length < 2`, emit a tiny fallback `Line` or `VMobject` with two identical-safe points.
- Prefer validating and preserving UI rather than throwing during export.

Recommended fallback:

```py
polyline_1 = Line(start=[0, 0, 0], end=[0.001, 0, 0], color=..., stroke_width=...)
```

### 10. Position / Rotation / Scale Export

`generateShapePos()` should mostly keep working because it receives a single `varName`.

Check special cases:

- the arrow-specific shaft-center corrections should remain only for `shapeType === 'arrow'`;
- do not apply arrow-specific corrections to `polyline`;
- normal `.rotate(...)` and `.scale(...)` on the `VGroup` should work.

If using a `VGroup` for path and tips, `move_to`, `rotate`, and `scale` should affect all children.

### 11. Playback Export

`generateShapePlay()` should continue to work:

```ts
const intro = item.introStyle === 'fade_in' ? `FadeIn(${varName})` : `Create(${varName})`;
```

`Create(VGroup(...))` should animate children. If Manim renders the tip awkwardly during `Create`, use this follow-up adjustment:

```ts
const intro =
  item.introStyle === 'fade_in'
    ? `FadeIn(${varName})`
    : item.shapeType === 'polyline'
      ? `Create(${varName})`
      : `Create(${varName})`;
```

No change is needed unless tests or render output show a problem.

### 12. Bounding Boxes For Positioning

Update both `src/lib/resolvePosition.ts` and `src/lib/nextToGeometry.ts` shape bbox logic.

For `polyline`, compute min/max from `points`:

```ts
function polylineDims(points: ShapePoint[]): { w: number; h: number } {
  if (points.length === 0) return { w: 0.5, h: 0.5 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    w: Math.max(0.15, Math.max(...xs) - Math.min(...xs)),
    h: Math.max(0.15, Math.max(...ys) - Math.min(...ys)),
  };
}
```

Use this in the `shape` switch.

This makes `to_edge`, `next_to`, surrounding rectangles, and preview layout roughly match the rendered polyline.

### 13. Display Name And Script Export

In `src/lib/itemDisplayName.ts`, ensure `polyline` displays naturally.

Expected behavior:

```text
Polyline
```

If the current implementation title-cases `shapeType`, this may already work. Verify it.

In `src/codegen/scriptExport.ts`, `appendShape()` currently emits:

```ts
lines.push(`## Shape (${item.shapeType})`);
```

This already works. Optional improvement:

```ts
if (item.shapeType === 'polyline') {
  lines.push(`points: ${item.points.map((p) => `(${p.x}, ${p.y})`).join(' -> ')}`);
  lines.push(`arrowheads: ${item.tailArrow && item.headArrow ? 'both' : item.tailArrow ? 'tail' : item.headArrow ? 'head' : 'none'}`);
}
```

### 14. Agent Prompt / Validation Awareness

Search `src/agent` for shape-related prompt text. If the agent is told valid `shapeType` values, add `polyline`.

Likely files:

- `src/agent/systemPrompt.ts`
- `src/agent/types.ts`
- `src/agent/validate.ts`

Add concise schema guidance:

```text
For shapeType "polyline", provide points as ordered local coordinates: [{x, y}, ...].
tailArrow and headArrow control arrowheads at the first and last point.
```

Do not let the agent create a polyline with fewer than two points.

### 15. Optional Dedicated Object Menu Entry

This is optional and can be skipped for the first pass.

If desired, add `+ Object > Polyline` that creates a shape and immediately sets:

```ts
shapeType: 'polyline'
```

Keep `+ Object > Shape` unchanged.

## Manim Arrowhead Details

This is the riskiest part of the feature because Manim's tip APIs vary slightly by version.

Recommended implementation order:

1. First export a plain polyline with no arrowheads using `VMobject.set_points_as_corners`.
2. Add tests for the generated code string.
3. Manually render a sample in Manim.
4. Add head arrow support.
5. Add tail arrow support.

If `VMobject.add_tip(..., at_start=True)` works locally, use it.

If it does not, create explicit arrow-tip triangles. One possible fallback:

```py
_tip = ArrowTriangleFilledTip(color=ManimColor("#60a5fa"))
_tip.set_width(0.2)
_tip.move_to([x, y, 0])
_tip.rotate(angle)
polyline_1.add(_tip)
```

The angle should come from the segment direction:

```py
angle = np.arctan2(dy, dx)
```

For head:

```py
dx = last_x - prev_x
dy = last_y - prev_y
```

For tail:

```py
dx = first_x - second_x
dy = first_y - second_y
```

If using `np.arctan2`, ensure the full-file exporter already imports numpy when needed. Currently shapes alone do not require numpy. Either avoid numpy by using Manim vector methods, or update `leafNeedsNumpy()` in `src/codegen/manimExporter.ts` so polyline arrow tips add `numpy as np`.

Simpler preferred path: use Manim's built-in `add_tip` if supported, so no new numpy requirement is needed.

## Suggested Tests

### Codegen Tests

Create `src/codegen/shapeCodegen.test.ts` if it does not exist.

Test plain polyline:

- `generateShapeDef()` contains `VMobject`;
- contains `set_points_as_corners`;
- contains all expected points;
- does not contain `add_tip`.

Test head arrow:

- `headArrow: true`;
- generated code contains the chosen head-tip API.

Test tail arrow:

- `tailArrow: true`;
- generated code contains the chosen tail-tip API.

Test fallback:

- with `points: []` or one point, generated code is still valid and does not throw.

### Geometry Tests

Update `resolvePosition.test.ts` and `nextToGeometry.test.ts`:

- polyline bbox width equals `maxX - minX`;
- polyline bbox height equals `maxY - minY`;
- fallback dimensions are nonzero for empty points.

### Validation Tests

Update `validate.test.ts`:

- normalizes a valid polyline shape with ordered points;
- defaults invalid/missing points to the default polyline points;
- defaults missing `tailArrow` / `headArrow` to `false`.

### Manual QA

Run:

```bash
npm test
npm run build
```

Manual browser checks:

1. Add a shape.
2. Change shape type to `Polyline`.
3. Confirm the preview renders a connected path.
4. Start picking points.
5. Click the canvas several times.
6. Confirm points append in order.
7. Finish picking.
8. Drag the whole polyline.
9. Rotate and scale the whole polyline.
10. Edit individual point coordinates.
11. Toggle arrowheads: none, tail, head, both.
12. Export Manim code and inspect the emitted polyline.
13. Render a short Manim preview to confirm arrowheads point in the right directions.

## Edge Cases

Handle these deliberately:

- `points` missing in old projects.
- `points` array has fewer than 2 entries.
- repeated identical points.
- very small final segment with arrowhead.
- deleting all points.
- picking points while polyline has nonzero rotation or non-1 scale.
- deleting a shape while point picking is active.
- changing selected item while point picking is active.
- using `next_to` with a polyline.
- exporting a polyline with audio binding.
- exporting a polyline inside concurrent visual clusters.

## Non-Goals For First Pass

Do not implement these unless specifically requested:

- curved paths / Bezier handles;
- closed polygons;
- fill for closed paths;
- per-segment colors;
- per-segment stroke widths;
- dashed/dotted polyline style;
- insertion by clicking between existing points;
- dragging individual points directly on the canvas;
- point-by-point draw animation.

These can be added later once the basic ordered-point model is stable.

## Acceptance Criteria

The task is done when:

- `ShapeKind` includes `polyline`;
- existing projects load without missing-field crashes;
- a selected polyline can append points by clicking the canvas;
- a selected polyline can edit/delete points from the property panel;
- the canvas preview draws connected segments in order;
- tail/head arrowhead controls work in preview;
- Manim export creates a visible polyline;
- Manim export includes requested arrowheads;
- shared shape style, timeline, positioning, and audio binding still work;
- tests cover codegen, migration/validation, and bbox behavior;
- `npm test` and `npm run build` pass.

## Implementation Preference

Keep the first implementation conservative:

- extend existing `shape` infrastructure;
- keep point picking as UI-only store state;
- use simple ordered local points;
- hide fill for polylines;
- avoid broad refactors of `ShapeItem`;
- avoid adding dependencies;
- avoid changing unrelated timeline, graph, text, or audio behavior.

