import { useCallback } from 'react';
import { fitCameraBounds, type CameraBounds } from '@/lib/camera';

export const CAMERA_REGION_REQUEST_EVENT = 'manim-timeline:camera-region-request';
export const CAMERA_FIT_REQUEST_EVENT = 'manim-timeline:camera-fit-request';

export interface CameraFitRequestDetail {
  cameraId: string | null;
}

export function cameraRegionBoundsFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): ReturnType<typeof fitCameraBounds> {
  const bounds: CameraBounds = {
    left: start.x,
    right: end.x,
    bottom: start.y,
    top: end.y,
  };
  return fitCameraBounds(bounds, 0);
}

export function cameraCaptureContextUnchanged(
  frozen: { time: number; frameIds: string; startFrameId: string; sceneId: string | null },
  current: { time: number; frameIds: string; startFrameId: string; sceneId: string | null },
): boolean {
  return frozen.time === current.time &&
    frozen.frameIds === current.frameIds &&
    frozen.startFrameId === current.startFrameId &&
    frozen.sceneId === current.sceneId;
}

function dispatch<T>(name: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function useCameraRegionSelection() {
  const requestCameraRegionSelection = useCallback(() => {
    dispatch(CAMERA_REGION_REQUEST_EVENT, null);
  }, []);
  const requestCameraObjectFit = useCallback((cameraId: string | null = null) => {
    dispatch<CameraFitRequestEventDetail>(CAMERA_FIT_REQUEST_EVENT, { cameraId });
  }, []);
  return { requestCameraRegionSelection, requestCameraObjectFit };
}

export type CameraFitRequestEventDetail = CameraFitRequestDetail;
