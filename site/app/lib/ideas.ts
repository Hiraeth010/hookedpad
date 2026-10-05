// Hook ideas: anyone can read them; submitting and voting need a wallet signature. The wallet signs
// one plain-text sign-in message (free: no transaction), the browser keeps it for a few days and
// sends it with every submit or vote, and the server checks the signature each time. No session
// state on the server, and nothing a wallet signs here can move funds.

export const TITLE_MIN = 6, TITLE_MAX = 80, BODY_MAX = 600;
/** how long a sign-in stays good */
export const AUTH_DAYS = 7;
export type IdeaAuth = { wallet: string; message: string; signature: string };
export type Idea = { id: number; wallet: string; title: string; body: string; createdAt: string; up: number; down: number; mine: -1 | 0 | 1 };

/** The exact text a wallet signs. The server rebuilds it from the wallet and time and compares. */
export function signInMessage(wallet: string, issued: string): string {
  return `hookedpad.com: sign in to Hook ideas\n\nThis lets you submit and vote on hook ideas. Signing is free: it doesn't send a transaction and can't move any funds.\n\nWallet: ${wallet}\nIssued: ${issued}`;
}
export const issuedOf = (message: string) => /\nIssued: (\S+)$/.exec(message)?.[1] ?? null;

/** Tidy what someone typed: no control characters, single spaces in a title, at most two blank lines in the details. */
export function cleanText(v: unknown, max: number, oneLine: boolean): string {
  const s = String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩]/g, "").replace(/\r\n?/g, "\n");
  return (oneLine ? s.replace(/\s+/g, " ") : s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")).trim().slice(0, max);
}
/** Why a submission can't be accepted, or null. */
export function ideaProblem(title: string, body: string): string | null {
  if (title.length < TITLE_MIN) return `Give your idea a title of at least ${TITLE_MIN} characters.`;
  if (title.length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (body.length > BODY_MAX) return `Keep the details under ${BODY_MAX} characters.`;
  // app names like pump.fun are fine; actual links aren't
  if (/https?:\/\/|www\.|\bt\.me\/|discord\.gg/i.test(`${title} ${body}`)) return "Ideas can't contain links.";
  return null;
}
