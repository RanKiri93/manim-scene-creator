import type { ReactNode } from 'react';
import { itemClipDisplayName, itemKindLabel } from '@/lib/itemDisplayName';
import { CloseIcon, IconButton, ItemTitle, KindSwatch, Segmented } from '@/components/ui';
import AgentPanel from '@/agent/AgentPanel';
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
import MatrixStepEditor from './MatrixStepEditor';
import CameraMoveEditor from './CameraMoveEditor';
import FrameAssignmentPanel from './FrameAssignmentPanel';
import SurroundingRectEditor from './SurroundingRectEditor';
import ShapeEditor from './ShapeEditor';
import ImageEditor from './ImageEditor';
import MatrixEditor from './MatrixEditor';

const DOCK_CLASS = 'flex w-[340px] shrink-0 flex-col border-l border-rule bg-panel';

/**
 * Right-hand dock: the selected item's properties, or the Copilot. The view follows the store's
 * `agentOpen` flag, so the header's Copilot button and the switch here stay in step.
 */
export default function PropertyPanel() {
  const inspectedId = useSceneStore((s) => s.inspectedId);
  const itemsMap = useSceneStore((s) => s.items);
  const clearSelection = useSceneStore((s) => s.clearSelection);
  const agentOpen = useSceneStore((s) => s.agentOpen);
  const setAgentOpen = useSceneStore((s) => s.setAgentOpen);

  const dockSwitch = (
    <Segmented
      className="mx-3 mt-3 mb-1 shrink-0"
      aria-label="Side panel"
      options={[
        { value: 'properties', label: 'Properties' },
        { value: 'copilot', label: 'Copilot' },
      ]}
      value={agentOpen ? 'copilot' : 'properties'}
      onChange={(v) => setAgentOpen(v === 'copilot')}
    />
  );

  if (agentOpen) {
    return (
      <aside aria-label="Copilot" className={DOCK_CLASS}>
        {dockSwitch}
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <AgentPanel />
        </div>
      </aside>
    );
  }

  const item = inspectedId ? itemsMap.get(inspectedId) : undefined;
  if (!item) {
    return (
      <aside aria-label="Properties" className={DOCK_CLASS}>
        {dockSwitch}
        <p className="m-0 max-w-[32ch] px-4 pt-4 text-ctl text-chalk-faint">
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
      body = item.mode === 'matrix_step' ? <MatrixStepEditor item={item} /> : <TargetAnimationEditor item={item} />;
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
    case 'matrix':
      body = <MatrixEditor item={item} />;
      break;
    default:
      body = <p className="m-0 text-ctl text-chalk-faint">This item kind has no editor.</p>;
  }

  return (
    <aside aria-label="Properties" className={DOCK_CLASS}>
      {dockSwitch}
      <div className="flex shrink-0 items-start gap-2 border-b border-rule pt-2 pr-2 pb-3 pl-4">
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
