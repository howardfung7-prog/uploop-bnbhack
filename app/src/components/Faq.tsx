import { tr } from "../lib/i18n";
import type { QA } from "../lib/faq";

/// The shell for the questions at the foot of a page (§53 / §55 / §59): Asset Staking, Certificate
/// Market and MEME Lab share it with the Help Center, and all the copy lives in lib/faq.ts — change
/// it in one place and the page foot and the Help Center (`#help`) both follow (§71.41).
/// Passing `title` as null prints no heading (the Help Center already has section headings of its
/// own).
export function Faq({ qa, title = tr("Rules and common questions"), id = "faq" }: { qa: QA[]; title?: string | null; id?: string }) {
  return (
    <section className="faq" id={id}>
      {title !== null && <h2>{title}</h2>}
      {qa.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </section>
  );
}
