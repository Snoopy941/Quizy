/**
 * Fast, local card-quality checks (no AI). Pure module.
 */
import { isNearDuplicate, normalizeText } from "./card-parse";

interface CardLike {
  id: string;
  front: string;
  back: string;
  type: string;
}

export function localCardIssues(cards: CardLike[]): { cardId: string; problem: string }[] {
  const out: { cardId: string; problem: string }[] = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const back = normalizeText(c.back);
    const front = normalizeText(c.front);
    for (let j = 0; j < i; j++) {
      if (isNearDuplicate(c, cards[j])) {
        out.push({ cardId: c.id, problem: `Nearly the same as another card: “${cards[j].front.slice(0, 80)}”` });
        break;
      }
    }
    if (c.type !== "true-false" && back.length >= 3 && back.split(" ").length <= 4 && ` ${front} `.includes(` ${back} `)) {
      out.push({ cardId: c.id, problem: "The question gives away the answer." });
    }
    if (c.back.length > 280) out.push({ cardId: c.id, problem: "The answer is long — hard to recall in one go. Consider splitting it." });
    if (c.front.trim().length < 8) out.push({ cardId: c.id, problem: "The question is very short — it may be ambiguous." });
  }
  return out;
}
