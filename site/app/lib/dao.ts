// DAO hook: a token whose rules its holders change by voting. Shared by the browser and the server.
//
// A wallet holding the minimum set at launch signs in (the same free sign-in message as Hook ideas,
// app/lib/ideas.ts), posts ideas for the token's rules and votes them up or down. When an idea's
// upvotes minus downvotes reach the number set at launch, the keeper (app/lib/daoExecutor.ts, run
// by the flywheel worker) has the AI builder turn it into a rule set and puts it on-chain.

/** open = collecting votes; sealed = passed and on-chain, waiting out the notice period;
 *  applied = now the token's rules; failed = passed, but couldn't be turned into rules. */
export type DaoStatus = "open" | "sealed" | "applied" | "failed";
export type DaoIdea = {
  id: number; wallet: string; title: string; body: string; createdAt: string; up: number; down: number; mine: -1 | 0 | 1;
  status: DaoStatus;
  /** what the AI did with it (applied / sealed), why it couldn't (failed), or what it is waiting for (open) */
  result: string | null;
  decidedAt: string | null;
};
export type DaoConfig = { minHold: number; votesToPass: number };
