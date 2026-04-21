import type { ItemId, ShapeItem, SceneItem } from '@/types/scene';
import { emitNextToPython } from './nextToCodegen';
import { manimColor } from './graphCodegen';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  resolveRecordedPlayback,
} from './lineCodegen';
import type { AudioTrackItem } from '@/types/scene';

function fillKwArgs(item: ShapeItem): string {
  if (item.fillColor?.trim()) {
    return `, fill_color=${manimColor(item.fillColor.trim())}, fill_opacity=${Math.max(0, Math.min(1, item.fillOpacity)).toFixed(4)}`;
  }
  return ', fill_opacity=0';
}

export function generateShapeDef(
  item: ShapeItem,
  varName: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const stroke = manimColor(item.strokeColor);
  const sw = item.strokeWidth.toFixed(4);
  const fill = fillKwArgs(item);

  switch (item.shapeType) {
    case 'circle':
      return `${pad}${varName} = Circle(radius=${item.radius.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})\n`;
    case 'rectangle':
      return `${pad}${varName} = Rectangle(width=${item.width.toFixed(4)}, height=${item.height.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})\n`;
    case 'arrow': {
      const ex = item.endX.toFixed(4);
      const ey = item.endY.toFixed(4);
      const fill = item.fillColor?.trim() ? fillKwArgs(item) : '';
      return (
        `${pad}${varName} = Arrow(start=[0, 0, 0], end=[${ex}, ${ey}, 0], color=${stroke}, stroke_width=${sw}, buff=0${fill})\n`
      );
    }
    case 'line': {
      const ex = item.endX.toFixed(4);
      const ey = item.endY.toFixed(4);
      return (
        `${pad}${varName} = Line(start=[0, 0, 0], end=[${ex}, ${ey}, 0], color=${stroke}, stroke_width=${sw})\n`
      );
    }
    default:
      return `${pad}${varName} = Circle(radius=0.25, color=${stroke}, stroke_width=${sw}${fill})\n`;
  }
}

export function generateShapePos(
  item: ShapeItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  let emittedPlacement = false;

  for (let si = 0; si < item.posSteps.length; si++) {
    const step = item.posSteps[si]!;
    switch (step.kind) {
      case 'absolute':
        lines.push(
          `${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
        );
        emittedPlacement = true;
        break;
      case 'next_to': {
        if (!step.refId) break;
        const refVar = idToVarName.get(step.refId);
        if (!refVar) break;
        const refItem = itemsMap.get(step.refId);
        if (!refItem) break;
        lines.push(
          emitNextToPython({
            varName,
            step,
            refVar,
            item,
            refItem,
            itemsMap,
            stepIndex: si,
            indent: pad,
          }),
        );
        emittedPlacement = true;
        break;
      }
      case 'to_edge':
        lines.push(
          `${pad}${varName}.to_edge(${step.edge}, buff=${step.buff})`,
        );
        emittedPlacement = true;
        break;
      case 'shift':
        lines.push(
          `${pad}${varName}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`,
        );
        emittedPlacement = true;
        break;
      case 'set_x':
        lines.push(`${pad}${varName}.set_x(${step.x.toFixed(6)})`);
        emittedPlacement = true;
        break;
      case 'set_y':
        lines.push(`${pad}${varName}.set_y(${step.y.toFixed(6)})`);
        emittedPlacement = true;
        break;
    }
  }

  // Match canvas `resolvePosition`: it always starts from item.x / item.y. If no placement
  // ran (empty posSteps, skipped next_to, etc.), the mobject must still move_to the store coords.
  if (!emittedPlacement) {
    lines.push(
      `${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
    );
  }

  // Canvas anchors the arrow at the shaft midpoint (start+end)/2. Manim's Arrow includes the
  // tip in get_center(), so move_to/rotate/scale use a slightly offset pivot — visible on short arrows.
  if (item.shapeType === 'arrow') {
    const c0 = `_${varName}_shaft_c`;
    const s0 = `_${varName}_shaft_s`;
    lines.push(
      `${pad}${c0} = ${varName}.get_center()`,
      `${pad}${s0} = (${varName}.get_start() + ${varName}.get_end()) / 2`,
      `${pad}${varName}.shift(${c0} - ${s0})`,
    );
  }

  if (Math.abs(item.rotationDeg) > 1e-6) {
    // Canvas (Konva): +deg is clockwise. Manim: +deg is CCW in the xy plane (y up).
    const manimDeg = -item.rotationDeg;
    if (item.shapeType === 'arrow') {
      const rp = `_${varName}_shaft_rp`;
      lines.push(
        `${pad}${rp} = (${varName}.get_start() + ${varName}.get_end()) / 2`,
        `${pad}${varName}.rotate(${manimDeg.toFixed(4)} * DEGREES, about_point=${rp})`,
      );
    } else {
      lines.push(
        `${pad}${varName}.rotate(${manimDeg.toFixed(4)} * DEGREES)`,
      );
    }
  }
  if (Math.abs(item.scale - 1) > 1e-6) {
    if (item.shapeType === 'arrow') {
      const sp = `_${varName}_shaft_sp`;
      lines.push(
        `${pad}${sp} = (${varName}.get_start() + ${varName}.get_end()) / 2`,
        `${pad}${varName}.scale(${item.scale.toFixed(6)}, about_point=${sp})`,
      );
    } else {
      lines.push(`${pad}${varName}.scale(${item.scale.toFixed(6)})`);
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

export function generateShapePlay(
  item: ShapeItem,
  varName: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  const intro =
    item.introStyle === 'fade_in' ? `FadeIn(${varName})` : `Create(${varName})`;
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    const soundEarly =
      audioItems?.length &&
      boundSoundEmittedAtTrackStart(item, itemsMap, audioItems);
    return (
      (soundEarly ? '' : `${pad}self.add_sound("${recorded.soundPath}")\n`) +
      `${pad}self.play(${intro}, run_time=${rt})\n` +
      appendAudioTailAfterLeafPlayback(
        pad,
        recorded,
        item,
        itemsMap,
        audioItems,
        tailOpts,
      )
    );
  }
  const rt = Math.max(0.05, item.duration).toFixed(6);
  return `${pad}self.play(${intro}, run_time=${rt})\n`;
}
