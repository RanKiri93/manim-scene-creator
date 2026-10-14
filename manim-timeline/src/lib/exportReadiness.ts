import type { SceneItem } from '@/types/scene';

/** Graph-follow motion and its graph-dot annotation semantics are supported by codegen. */
export const GRAPH_FOLLOW_EXPORT_SUPPORTED = true;
export function graphFollowExportBlock(items: readonly SceneItem[]): string | null {
  if (GRAPH_FOLLOW_EXPORT_SUPPORTED) return null;
  const hasGraphFollow = items.some((item) => item.kind === 'target_animation' && item.mode === 'graphFollow');
  const hasPreviewOnlyGraphDotSemantics = items.some((item) => item.kind === 'graphDot' && (
    (item.dot.attachment != null && item.dot.attachment.kind !== 'free') ||
    item.dot.showCoordinates === true || item.dot.showProjectionGuides === true ||
    item.dot.labelFontSize != null && item.dot.labelFontSize !== 18 ||
    item.dot.labelColor != null && item.dot.labelColor.toLowerCase() !== '#ffffff' ||
    item.dot.labelSpacing != null && item.dot.labelSpacing !== 0.15
  ));
  return hasGraphFollow || hasPreviewOnlyGraphDotSemantics
    ? 'Move along graph, attached points, and customized/live annotations are preview-only until graph-follow export support is available.'
    : null;
}
