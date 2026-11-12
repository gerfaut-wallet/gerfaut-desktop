import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What a form refused, under the field it refused: said in words, in
    the text colour with its glyph, never in red, which is kept for
    what happens on chain. For what the core refuses of a pasted
    wallet or transaction: the same refusal read as a grey hint in one
    form and as an error in the next. */
export function InputError({
  id,
  children,
  detail,
  className,
}: {
  /** For the field's `aria-describedby`. */
  id?: string;
  /** The sentence: what was refused. */
  children: ReactNode;
  /** The words under it, when the sentence has a reason apart. */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div id={id} role="alert" className={cn("flex items-start gap-2", className)}>
      <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-text" />
      <p className="min-w-0 font-ui text-sm font-medium text-text">
        {children}
        {detail && (
          <span className="selectable mt-0.5 block break-words font-ui text-xs font-normal text-muted">
            {detail}
          </span>
        )}
      </p>
    </div>
  );
}
