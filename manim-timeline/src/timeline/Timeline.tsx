import { useMemo, useRef, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { SceneItem } from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';
import TimelineTrack from './TimelineTrack';
import AudioClip from './AudioClip';
import PlaybackControls from './PlaybackControls';
import Playhead from './Playhead';
import { usePlaybackLoop } from './hooks/usePlaybackLoop';
import { usePlaybackEngine } from './hooks/usePlaybackEngine';

export default function Timeline() {
  usePlaybackLoop();

  const itemsMap = useSceneStore((s) => s.items);
  const items = useMemo(
    () =>
      Array.from(itemsMap.values())
        .filter(isTopLevelItem)
        .sort((a: SceneItem, b: SceneItem) => a.startTime - b.startTime || a.layer - b.layer),
    [itemsMap],
  );
  const currentTime = useSceneStore((s) => s.currentTime);
  const viewRange = useSceneStore((s) => s.viewRange);
  const setCurrentTime = useSceneStore((s) => s.setCurrentTime);
  const setViewRange = useSceneStore((s) => s.setViewRange);
  const togglePlayback = useSceneStore((s) => s.togglePlayback);
  const audioItems = useSceneStore((s) => s.audioItems);
  const getSceneDuration = useSceneStore((s) => s.getSceneDuration);

  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const thumbDragRef = useRef<{ startX: number; startThumbX: number } | null>(null);
  const pendingScrollAfterZoom = useRef<number | null>(null);

  const [viewportWidth, setViewportWidth] = useState(800);
  const [dynamicPadding, setDynamicPadding] = useState(60);

  const [viewStart, viewEnd] = viewRange;
  const viewDuration = viewEnd - viewStart;

  const containerWidth = viewportWidth;
  const pxPerSecond = containerWidth / Math.max(viewDuration, 0.1);
  usePlaybackEngine(timelineRef, pxPerSecond);

  const contentEndTime = useMemo(
    () =>
      Math.max(
        ...items.map((item) => item.startTime + item.duration),
        ...audioItems.map((item) => item.startTime + item.duration),
        getSceneDuration(),
        viewEnd,
        0.1,
      ),
    [items, audioItems, getSceneDuration, viewEnd],
  );
  const contentWidth = Math.max((contentEndTime + dynamicPadding) * pxPerSecond, containerWidth);

  const [scrollState, setScrollState] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    scrollbarTrackWidth: 0,
  });

  const onTimelineScroll = useCallback(() => {
    const container = timelineRef.current;
    const track = scrollbarTrackRef.current;
    if (!container) return;
    const isNearEnd =
      container.scrollWidth - container.scrollLeft - container.clientWidth < 100;
    if (isNearEnd) {
      setDynamicPadding((prev) => prev + 60);
    }
    setScrollState({
      scrollLeft: container.scrollLeft,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      scrollbarTrackWidth: track?.clientWidth ?? 0,
    });
  }, []);

  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const tl = timelineRef.current;
    if (pendingScrollAfterZoom.current != null && tl) {
      tl.scrollLeft = pendingScrollAfterZoom.current;
      pendingScrollAfterZoom.current = null;
    }
    onTimelineScroll();
  }, [onTimelineScroll, containerWidth, items.length, audioItems.length, viewRange, pxPerSecond, contentWidth, dynamicPadding]);

  useEffect(() => {
    const onResize = () => onTimelineScroll();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [onTimelineScroll]);

  useEffect(() => {
    onTimelineScroll();
  }, [pxPerSecond, onTimelineScroll]);

  const { scrollLeft, scrollWidth, clientWidth, scrollbarTrackWidth } = scrollState;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const tw = scrollbarTrackWidth;
  const ratioPct =
    scrollWidth > 0 ? Math.min(100, (clientWidth / scrollWidth) * 100) : 100;
  const rawThumbPx = tw > 0 ? tw * (ratioPct / 100) : 0;
  const thumbPx = tw > 0 ? Math.max(20, Math.min(tw, rawThumbPx)) : 0;
  const thumbWidthPercent = tw > 0 ? (thumbPx / tw) * 100 : 100;
  const thumbTravelPx = tw > 0 ? Math.max(0, tw - thumbPx) : 0;
  const thumbLeftPercent =
    tw > 0 && maxScroll > 0 && thumbTravelPx > 0
      ? (scrollLeft / maxScroll) * (thumbTravelPx / tw) * 100
      : 0;

  const onThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const tl = timelineRef.current;
      const track = scrollbarTrackRef.current;
      if (!tl || !track || maxScroll <= 0) return;
      const trackW = track.clientWidth;
      if (trackW <= 0) return;
      const startMaxScroll = Math.max(0, tl.scrollWidth - tl.clientWidth);
      const startRatio = tl.scrollWidth > 0 ? tl.clientWidth / tl.scrollWidth : 1;
      const startThumbW = Math.max(20, Math.min(trackW, trackW * startRatio));
      const startMaxThumbDrag = trackW - startThumbW;
      const startThumbX =
        startMaxScroll > 0 && startMaxThumbDrag > 0
          ? (tl.scrollLeft / startMaxScroll) * startMaxThumbDrag
          : 0;
      thumbDragRef.current = {
        startX: e.clientX,
        startThumbX,
      };
      const onMove = (ev: PointerEvent) => {
        const drag = thumbDragRef.current;
        const inner = timelineRef.current;
        const tr = scrollbarTrackRef.current;
        if (!drag || !inner || !tr) return;
        const twMove = tr.clientWidth;
        if (twMove <= 0) return;
        const maxScroll = inner.scrollWidth - inner.clientWidth;
        const ratio = inner.scrollWidth > 0 ? inner.clientWidth / inner.scrollWidth : 1;
        const thumbWidth = Math.max(20, Math.min(twMove, twMove * ratio));
        const maxThumbDrag = twMove - thumbWidth;
        if (maxScroll <= 0 || maxThumbDrag <= 0) return;
        const currentThumbX = Math.max(
          0,
          Math.min(maxThumbDrag, drag.startThumbX + (ev.clientX - drag.startX)),
        );
        const calculatedScroll = (currentThumbX / maxThumbDrag) * maxScroll;
        inner.scrollLeft = Math.max(0, Math.min(maxScroll, calculatedScroll));
      };
      const onUp = () => {
        thumbDragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [maxScroll],
  );

  // Group items by layer
  const layerMap = useMemo(() => {
    const m = new Map<number, typeof items>();
    for (const item of items) {
      const arr = m.get(item.layer) ?? [];
      arr.push(item);
      m.set(item.layer, arr);
    }
    return m;
  }, [items]);

  const layers = useMemo(
    () => [...layerMap.keys()].sort((a, b) => a - b),
    [layerMap],
  );

  // Ensure at least one empty track
  if (layers.length === 0) layers.push(0);

  // Click on ruler to seek
  const onRulerClick = useCallback(
    (e: React.MouseEvent) => {
      const tl = timelineRef.current;
      if (!tl) return;
      const rect = tl.getBoundingClientRect();
      const xInContent = e.clientX - rect.left + tl.scrollLeft;
      setCurrentTime(Math.max(0, xInContent / pxPerSecond));
    },
    [pxPerSecond, setCurrentTime],
  );

  // Scroll to zoom (deltaY > 0: zoom out / wider window; deltaY < 0: zoom in / narrower)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const tl = timelineRef.current;
      if (!tl) return;
      const timelineRect = tl.getBoundingClientRect();
      const scrollLeft = tl.scrollLeft;
      const localX = e.clientX - timelineRect.left;
      const cw = tl.clientWidth || containerWidth;
      const oldPPS = cw / Math.max(viewDuration, 0.1);
      const timeAtMouse = (localX + scrollLeft) / oldPPS;

      const ZOOM_OUT = 1.15;
      const ZOOM_IN = 1 / ZOOM_OUT;
      const factor = e.deltaY > 0 ? ZOOM_OUT : ZOOM_IN;
      const minDuration = 0.1;
      const nextDuration = Math.max(minDuration, viewDuration * factor);
      let start = timeAtMouse - nextDuration / 2;
      let end = timeAtMouse + nextDuration / 2;
      if (start < 0) {
        start = 0;
        end = Math.max(minDuration, nextDuration);
      }
      const newPPS = cw / Math.max(nextDuration, 0.1);
      const newScrollLeft = timeAtMouse * newPPS - localX;
      pendingScrollAfterZoom.current = Math.max(0, newScrollLeft);
      setViewRange([start, end]);
    },
    [viewDuration, setViewRange, containerWidth],
  );

  // Ruler tick marks (visible window in time)
  const tickInterval = viewDuration <= 5 ? 0.5 : viewDuration <= 15 ? 1 : viewDuration <= 60 ? 5 : 10;
  const visibleTimeStart = scrollState.scrollLeft / pxPerSecond;
  const visibleTimeEnd = visibleTimeStart + containerWidth / pxPerSecond;
  const ticks: number[] = [];
  const first = Math.ceil(visibleTimeStart / tickInterval) * tickInterval;
  for (let t = first; t <= visibleTimeEnd + tickInterval; t += tickInterval) {
    if (t >= 0) ticks.push(t);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayback]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-900 border-t border-slate-700 select-none">
      <PlaybackControls />

      {/* Tracks + audio: scrollable; ruler inside for alignment */}
      <div
        ref={timelineRef}
        className="relative flex-1 min-h-0 overflow-x-auto overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        onScroll={onTimelineScroll}
        onWheel={onWheel}
      >
        <div
          className="relative"
          style={{ width: contentWidth, minWidth: '100%' }}
        >
          <div
            className="relative h-5 bg-slate-850 border-b border-slate-700 cursor-pointer"
            onClick={onRulerClick}
            onWheel={onWheel}
          >
            {ticks.map((t) => {
              const x = t * pxPerSecond;
              return (
                <span
                  key={t}
                  className="absolute top-0 text-[9px] text-slate-500 pointer-events-none"
                  style={{ left: `${x}px` }}
                >
                  {t.toFixed(tickInterval < 1 ? 1 : 0)}s
                </span>
              );
            })}
          </div>

          {layers.map((layer) => (
            <TimelineTrack
              key={layer}
              layer={layer}
              items={layerMap.get(layer) ?? []}
              pxPerSecond={pxPerSecond}
              viewStart={0}
            />
          ))}

          <div className="relative z-10 min-h-10 h-10 border-t-2 border-slate-600 bg-slate-800/50">
            <span className="absolute left-1 top-1 text-[9px] text-slate-300 z-20 pointer-events-none">
              Audio
            </span>
            {audioItems.map((item) => (
              <AudioClip
                key={item.id}
                item={item}
                pxPerSecond={pxPerSecond}
                viewStart={0}
              />
            ))}
          </div>

          <Playhead pixelsPerSecond={pxPerSecond} />
        </div>
      </div>

      <div
        ref={scrollbarTrackRef}
        className="relative h-2 bg-slate-900/50 rounded-full w-full mt-2 shrink-0"
      >
        <div
          role="presentation"
          className="absolute top-0 bottom-0 h-full bg-slate-600 hover:bg-blue-500 rounded-full cursor-pointer transition-colors touch-none"
          style={{
            width: `${thumbWidthPercent}%`,
            left: `${thumbLeftPercent}%`,
          }}
          onPointerDown={onThumbPointerDown}
        />
      </div>
    </div>
  );
}
