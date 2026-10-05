import { AUTH_DAYS, issuedOf, signInMessage, type IdeaAuth } from "./ideas";

// The browser side of Hooked's wallet sign-in (see ideas.ts): one free signed message, kept in this
// browser for a few days and sent with each request that needs to know which wallet is asking.
// Shared by Hook ideas, the DAO hook's votes and the Editable hook's editor.

const LS_KEY = "hooked.ideas.signin";

/** This wallet's saved sign-in, if it has one that is still fresh. */
export function savedAuth(wallet: string): IdeaAuth | null {
  try {
    const a = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as IdeaAuth | null;
    const issued = a ? issuedOf(a.message) : null;
    // renew a day early so a sign-in never expires mid-click
    return a && a.wallet === wallet && issued && Date.now() - Date.parse(issued) < (AUTH_DAYS - 1) * 86_400_000 ? a : null;
  } catch { return null; }
}
export function forgetAuth() { try { localStorage.removeItem(LS_KEY); } catch { /* nothing saved */ } }

/** The wallet's sign-in, asking it to sign if there isn't a fresh one. Throws if the wallet says no. */
export async function signIn(wallet: string, signMessage: (m: Uint8Array) => Promise<Uint8Array>): Promise<IdeaAuth> {
  const saved = savedAuth(wallet);
  if (saved) return saved;
  const message = signInMessage(wallet, new Date().toISOString());
  const sig = await signMessage(new TextEncoder().encode(message));
  const a: IdeaAuth = { wallet, message, signature: Buffer.from(sig).toString("base64") };
  try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch { /* private window: sign again next time */ }
  return a;
}
