/**
 * SM-2 has been replaced by FSRS (see ./fsrs). Cards reviewed under SM-2 are
 * converted automatically the next time they're graded (fsrs.fromStored).
 * This module only re-exports the shared mastery helpers for old imports.
 */
export { isMastered, MASTERY_INTERVAL, type Grade } from "./fsrs";
