import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names joined, the later utility winning a conflict: a
    caller's `className` overrides the component's own. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
