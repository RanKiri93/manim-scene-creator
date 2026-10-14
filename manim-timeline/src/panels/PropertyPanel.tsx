import type { ReactNode } from 'react';
import { itemClipDisplayName, itemKindLabel } from '@/lib/itemDisplayName';
import { CloseIcon, IconButton, ItemTitle, KindSwatch, PanelTitle } from '@/components/ui';
import { useSceneStore } from '@/store/useSceneStore';
import LineEditor from './LineEditor';
import AxesEditor from './AxesEditor';
import GraphPlotEditor from './GraphPlotEditor';
import GraphCurveEditor from './GraphCurveEditor';
import GraphDotEditor from './GraphDotEditor';
import GraphFieldEditor from './GraphFieldEditor';
import FunctionSeriesEditor from './FunctionSeriesEditor';
import PointSequenceEditor from './PointSequenceEditor';
import GraphAreaEditor from './GraphAreaEditor';
import ExitAnimationEditor from './ExitAnimationEditor';
import BlinkAnimationEditor from './BlinkAnimationEditor';
import TargetAnimationEditor from './TargetAnimationEditor';
import CameraMoveEditor from './CameraMoveEditor';
import FrameAssignmentPanel from './FrameAssignmentPanel';
import SurroundingRectEditor from './SurroundingRectEditor';
import ShapeEditor from './ShapeEditor';
import ImageEditor from './ImageEditor';

/** Docked inspector on the right of the stage. Closing it clears the selection. */
export default function PropertyPanel() {
  const inspectedId = useSceneStore((s) => s.inspectedId);
  const itemsMap = useSceneStore((s) => s.items);
  const clearSelection = useSceneStore((s) => s.clearSelection);

  const item = inspectedId ? itemsMap.get(inspectedId) : undefined;
  if (!item) {
    return (
      <aside
        aria-label="Properties"
        className="flex w-[340px] shrink-0 flex-col gap-2 border-l border-rule bg-panel px-5 pt-4"
      >
        <PanelTitle>Properties</PanelTitle>
        <p className="m-0 max-w-[32ch] text-ctl text-chalk-faint">
          Select an item on the stage, in the item list or on the timeline to edit it here.
        </p>
      </aside>
    );
  }

  let body: ReactNode;
  switch (item.kind) {
    case 'textLine':
      body = <LineEditor item={item} />;
      break;
    case 'axes':
      body = <AxesEditor item={item} />;
      break;
    case 'graphPlot':
      body = <GraphPlotEditor item={item} />;
      break;
    case 'graphCurve':
      body = <GraphCurveEditor item={item} />;
      break;
    case 'graphDot':
      body = <GraphDotEditor item={item} />;
      break;
    case 'graphField':
      body = <GraphFieldEditor item={item} />;
      break;
    case 'graphFunctionSeries':
      body = <FunctionSeriesEditor item={item} />;
      break;
    case 'graphPointSequence':
      body = <PointSequenceEditor item={item} />;
      break;
    case 'graphArea':
      body = <GraphAreaEditor item={item} />;
      break;
    case 'exit_animation':
      body = <ExitAnimationEditor item={item} />;
      break;
    case 'blink_animation':
      body = <BlinkAnimationEditor item={item} />;
      break;
    case 'target_animation':
      body = <TargetAnimationEditor item={item} />;
      break;
    case 'camera_move':
      body = <CameraMoveEditor item={item} />;
      break;
    case 'surroundingRect':
      body = <SurroundingRectEditor item={item} />;
      break;
    case 'shape':
      body = <ShapeEditor item={item} />;
      break;
    case 'image':
      body = <ImageEditor item={item} />;
      break;
    default:
      body = <p className="m-0 text-ctl text-chalk-faint">This item kind has no editor.</p>;
  }

  return (
    <aside aria-label="Properties" className="flex w-[340px] shrink-0 flex-col border-l border-rule bg-panel">
      <div className="flex shrink-0 items-start gap-2 border-b border-rule pt-3 pr-2 pb-3 pl-4">
        <div className="min-w-0 flex-1">
          <ItemTitle className="text-title">
            <KindSwatch kind={item.kind} />
            <span className="min-w-0 truncate" dir="auto">{itemClipDisplayName(item)}</span>
          </ItemTitle>
          <div className="mt-0.5 pl-[18px] text-meta text-chalk-faint">{itemKindLabel(item.kind)}</div>
        </div>
        <IconButton label="Close properties" title="Close properties (clears the selection)" onClick={clearSelection}>
          <CloseIcon />
        </IconButton>
      </div>
      <FrameAssignmentPanel item={item} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">{body}</div>
    </aside>
  );
}
