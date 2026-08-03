import { useMemo } from "react";
import { randomFunFact } from "../data/funFacts";

export function FunFactCard({ fact }: { fact?: string }) {
  const text = useMemo(() => fact ?? randomFunFact(), [fact]);

  return (
    <div className="relative mx-auto max-w-md rounded-md border border-border bg-paper-card px-5 py-4 shadow-sm dark:border-border-dark dark:bg-paper-card-dark">
      <p className="font-serif text-xs uppercase tracking-widest text-cat-orange dark:text-cat-orange-dark">
        Did you know
      </p>
      <p className="mt-1.5 text-sm leading-snug text-ink-soft dark:text-ink-soft-dark">
        {text}
      </p>
    </div>
  );
}
