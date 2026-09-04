import { clsx } from "clsx";
import type { SVGProps } from "react";

type OnionIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Square side in pixels, like every Lucide icon in the interface. */
  size?: number | string;
};

/** An onion, drawn here because Lucide has none.
 *
 * Tor's own emblem is an onion, and the mask this replaced said
 * "disguise" where the app means "routed through Tor". The drawing keeps
 * the Lucide grammar to the letter, 24 viewBox, no fill, `currentColor`
 * stroke, round caps and joins, 1.5px by default, so it sits beside the
 * Lucide set without reading as a second library.
 *
 * Decorative by default: it always stands next to the word it
 * illustrates, and a screen reader announcing it would say "Tor" twice.
 * Pass `aria-hidden={false}` with a label where it stands alone. */
export function OnionIcon({
  size = 24,
  strokeWidth = 1.5,
  className,
  "aria-hidden": ariaHidden = true,
  ...props
}: OnionIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Deliberately not a `lucide-` name: the class says at a glance
      // which icons the library draws and which one this project does.
      className={clsx("gerfaut-onion", className)}
      aria-hidden={ariaHidden}
      {...props}
    >
      <path d="M12 5.5c-.6-1.6 0-2.8 1.6-3.5" />
      <path d="M12 5.5C8.5 8.8 5.5 10.8 5.5 13.5a6.5 6.5 0 0 0 13 0c0-2.7-3-4.7-6.5-8Z" />
      <path d="M12 5.5c-2 3.4-3 6.4-3 9.1 0 2.1.9 3.8 3 5.4" />
      <path d="M12 5.5c2 3.4 3 6.4 3 9.1 0 2.1-.9 3.8-3 5.4" />
    </svg>
  );
}
