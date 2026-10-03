import { useRef } from "react";
import type { KeyboardEvent } from "react";

/** The keyboard of a group of choices, as the platform's own radio
    buttons have it: Tab enters on the chosen one and leaves the group,
    the arrows move to the previous or next choice and choose it, Home
    and End go to the ends; a disabled choice is stepped over. Spread
    `radio(value, index)` on each button. */
export function useRadioGroup<T>(
  values: readonly T[],
  value: T,
  onChange: (value: T) => void,
  isDisabled: (value: T) => boolean = () => false,
) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = values.map((candidate, index) => ({ candidate, index })).filter(
    ({ candidate }) => !isDisabled(candidate),
  );
  // With nothing chosen, Tab still has somewhere to land.
  const tabStop = values.includes(value) ? value : enabled[0]?.candidate;

  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const at = enabled.findIndex(({ index }) => index === from);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (at + 1) % enabled.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (at - 1 + enabled.length) % enabled.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    buttons.current[target.index]?.focus();
    if (target.candidate !== value) onChange(target.candidate);
  };

  return (option: T, index: number) => ({
    ref: (element: HTMLButtonElement | null) => {
      buttons.current[index] = element;
    },
    tabIndex: option === tabStop ? 0 : -1,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => move(event, index),
  });
}
