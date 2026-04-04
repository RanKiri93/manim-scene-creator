import type { AudioTrackItem, GraphItem, ItemId, SceneItem } from '@/types/scene';
import { pythonStringLiteral } from './texUtils';
import { resolveRecordedPlayback } from './lineCodegen';

function manimColor(hex: string): string {
  return `ManimColor("${hex}")`;
}

export function generateGraphDef(
  item: GraphItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  let s = '';

  const [xMin, xMax, xStep] = item.xRange;
  const [yMin, yMax, yStep] = item.yRange;

  s += `${pad}${axVar} = Axes(\n`;
  s += `${inner}x_range=[${xMin}, ${xMax}, ${xStep}],\n`;
  s += `${inner}y_range=[${yMin}, ${yMax}, ${yStep}],\n`;
  s += `${inner}x_length=${((xMax - xMin) * item.scale).toFixed(2)},\n`;
  s += `${inner}y_length=${((yMax - yMin) * item.scale).toFixed(2)},\n`;

  if (item.includeNumbers) {
    s += `${inner}axis_config={"include_numbers": True}`;
    if (!item.includeTip) s += `, tips=False`;
    s += `,\n`;
  } else if (!item.includeTip) {
    s += `${inner}tips=False,\n`;
  }

  s += `${pad})\n`;

  if (item.xLabel) {
    s += `${pad}${axVar}_xlabel = ${axVar}.get_x_axis_label(${pythonStringLiteral(item.xLabel)})\n`;
  }
  if (item.yLabel) {
    s += `${pad}${axVar}_ylabel = ${axVar}.get_y_axis_label(${pythonStringLiteral(item.yLabel)})\n`;
  }

  const plotVars: string[] = [];
  item.functions.forEach((fn, fi) => {
    const pVar = `${axVar}_f${fi + 1}`;
    s += `${pad}${pVar} = ${axVar}.plot(lambda x: ${fn.pyExpr || 'x'}, color=${manimColor(fn.color)})\n`;
    plotVars.push(pVar);
  });

  const dotVars: string[] = [];
  item.dots.forEach((dot, di) => {
    const dVar = `${axVar}_d${di + 1}`;
    let line = `${pad}${dVar} = Dot(${axVar}.coords_to_point(${dot.dx}, ${dot.dy}), color=${manimColor(dot.color)}`;
    if (dot.radius !== 0.08) line += `, radius=${dot.radius}`;
    line += ')\n';
    s += line;
    dotVars.push(dVar);

    if (dot.label.trim()) {
      const lblVar = `${dVar}_lbl`;
      s += `${pad}${lblVar} = Text(${pythonStringLiteral(dot.label.trim())}, font_size=18)\n`;
      s += `${pad}${lblVar}.next_to(${dVar}, ${dot.labelDir}, buff=0.15)\n`;
    }
  });

  return s;
}

/**
 * Generate positioning statements for a GraphItem (axes mobject).
 */
export function generateGraphPos(
  item: GraphItem,
  axVar: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const step of item.posSteps) {
    switch (step.kind) {
      case 'absolute':
        lines.push(
          `${pad}${axVar}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
        );
        break;
      case 'next_to': {
        if (!step.refId) break;
        const refVar = idToVarName.get(step.refId);
        if (!refVar) break;
        lines.push(
          `${pad}${axVar}.next_to(${refVar}, ${step.dir}, buff=${step.buff})`,
        );
        break;
      }
      case 'to_edge':
        lines.push(`${pad}${axVar}.to_edge(${step.edge}, buff=${step.buff})`);
        break;
      case 'shift':
        lines.push(
          `${pad}${axVar}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`,
        );
        break;
      case 'set_x':
        lines.push(`${pad}${axVar}.set_x(${step.x.toFixed(6)})`);
        break;
      case 'set_y':
        lines.push(`${pad}${axVar}.set_y(${step.y.toFixed(6)})`);
        break;
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

function graphExitAnimTargets(axVar: string, item: GraphItem): string {
  const parts: string[] = [axVar];
  item.functions.forEach((_, fi) => {
    parts.push(`${axVar}_f${fi + 1}`);
  });
  item.dots.forEach((dot, di) => {
    parts.push(`${axVar}_d${di + 1}`);
    if (dot.label.trim()) {
      parts.push(`${axVar}_d${di + 1}_lbl`);
    }
  });
  return parts.join(', ');
}

function emitGraphExitAnim(
  item: GraphItem,
  axVar: string,
  pad: string,
): string {
  const style = item.exitAnimStyle;
  if (!style || style === 'none') return '';
  const runTime = item.exitRunTime ?? 1;
  const targets = graphExitAnimTargets(axVar, item);
  switch (style) {
    case 'fade_out':
      return `${pad}self.play(FadeOut(${targets}), run_time=${runTime})\n`;
    case 'uncreate':
      return `${pad}self.play(Uncreate(${targets}), run_time=${runTime})\n`;
    case 'shrink_to_center':
      return `${pad}self.play(ShrinkToCenter(${targets}), run_time=${runTime})\n`;
    default:
      return '';
  }
}

export function generateGraphPlay(
  item: GraphItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): string {
  const pad = ' '.repeat(indent);
  let s = '';

  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    s += `${pad}self.play(Create(${axVar}), run_time=${rt})\n`;
  } else {
    s += `${pad}self.play(Create(${axVar}), run_time=${item.duration})\n`;
  }

  item.functions.forEach((_, fi) => {
    s += `${pad}self.play(Create(${axVar}_f${fi + 1}))\n`;
  });

  item.dots.forEach((dot, di) => {
    s += `${pad}self.play(FadeIn(${axVar}_d${di + 1}))\n`;
    if (dot.label.trim()) {
      s += `${pad}self.play(Write(${axVar}_d${di + 1}_lbl))\n`;
    }
  });

  if (item.waitAfter > 0) {
    s += `${pad}self.wait(${item.waitAfter.toFixed(4)})\n`;
  }

  s += emitGraphExitAnim(item, axVar, pad);

  return s;
}
