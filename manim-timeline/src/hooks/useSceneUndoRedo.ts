import { useCallback } from 'react';
import { useStore } from 'zustand/react';
import { useSceneStore } from '@/store/useSceneStore';

export function useSceneUndoRedo(): {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
} {
  const canUndo = useStore(
    useSceneStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useSceneStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  const undo = useCallback(() => {
    useSceneStore.temporal.getState().undo();
  }, []);

  const redo = useCallback(() => {
    useSceneStore.temporal.getState().redo();
  }, []);

  return { canUndo, canRedo, undo, redo };
}
