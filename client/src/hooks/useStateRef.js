/**
 * useStateRef Hook
 * Combines useState and useRef to provide both reactive state and stable reference.
 *
 * Problem this solves:
 * - useState provides reactivity but closures capture stale values
 * - useRef provides stable references but doesn't trigger re-renders
 * - Many components duplicate both: const [state, setState] = useState(); const stateRef = useRef(state);
 *
 * This hook eliminates that duplication by providing:
 * - state: reactive value that triggers re-renders
 * - setState: setter function
 * - ref: always-current reference for use in callbacks/effects
 *
 * @example
 * // Before (duplicate pattern):
 * const [isPlaying, setIsPlaying] = useState(false);
 * const isPlayingRef = useRef(isPlaying);
 * useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
 *
 * // After (using useStateRef):
 * const [isPlaying, setIsPlaying, isPlayingRef] = useStateRef(false);
 */

import { useState, useRef, useCallback } from 'react';

/**
 * Hook that combines useState with a synchronized ref.
 *
 * @template T
 * @param {T} initialValue - Initial state value
 * @returns {[T, (value: T | ((prev: T) => T)) => void, React.MutableRefObject<T>]}
 *   - state: Current state value (triggers re-renders)
 *   - setState: Setter that updates both state and ref
 *   - ref: Ref object with .current always matching latest state
 */
export function useStateRef(initialValue) {
  const [state, setStateInternal] = useState(initialValue);
  const ref = useRef(initialValue);

  // Custom setter that updates both state and ref
  const setState = useCallback((valueOrUpdater) => {
    setStateInternal((prev) => {
      const newValue = typeof valueOrUpdater === 'function'
        ? valueOrUpdater(prev)
        : valueOrUpdater;
      ref.current = newValue;
      return newValue;
    });
  }, []);

  return [state, setState, ref];
}

/**
 * Hook for boolean state with toggle functionality.
 * Useful for play/pause, show/hide, enabled/disabled states.
 *
 * @param {boolean} initialValue - Initial boolean value
 * @returns {[boolean, (value?: boolean) => void, React.MutableRefObject<boolean>]}
 *   - state: Current boolean value
 *   - toggle: Toggle function (optionally accepts explicit value)
 *   - ref: Ref with current value
 */
export function useBooleanStateRef(initialValue = false) {
  const [state, setState, ref] = useStateRef(initialValue);

  const toggle = useCallback((explicitValue) => {
    if (typeof explicitValue === 'boolean') {
      setState(explicitValue);
    } else {
      setState(prev => !prev);
    }
  }, [setState]);

  return [state, toggle, ref];
}

export default useStateRef;
