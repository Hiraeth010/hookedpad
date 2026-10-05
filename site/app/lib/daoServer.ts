import { Connection, PublicKey } from "@solana/web3.js";
import { q } from "./node/db";
import { CLUSTER, serverRpcUrl, rpcFetchWithFallback } from "./node/env";
import { daoMinHold, daoVotes } from "./node/nodeTypes";
import type { DaoConfig } from "./dao";

// Server side of the DAO hook: which tokens are DAO tokens, and how much of one a wallet holds.

export const serverConnection = () => new Connection(serverRpcUrl(), { commitment: "confirmed", fetch: rpcFetchWithFallback as unknown as typeof fetch });

export type DaoToken = DaoConfig & { mint: string; pool: string; creator: string };

/** The DAO token with this mint, or null if there isn't one on this network. */
export async function daoToken(mint: string): Promise<DaoToken | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const [r] = await q<{ pool: string; creator: string; params: Record<string, number | string> }>(
    `SELECT pool, creator, params FROM hooked.nodes WHERE mint = $1 AND cluster = $2 AND node_id = 'dao' AND pool IS NOT NULL`, [mint, CLUSTER]);
  return r ? { mint, pool: r.pool, creator: r.creator, minHold: daoMinHold(r.params ?? {}), votesToPass: daoVotes(r.params ?? {}) } : null;
}

/** Whole tokens of `mint` the wallet holds right now, across all its token accounts. */
export async function holdingOf(conn: Connection, wallet: string, mint: string): Promise<number> {
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) }, "confirmed");
  return res.value.reduce((sum, a) => sum + Number((a.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } }).parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
}
