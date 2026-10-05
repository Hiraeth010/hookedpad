# Hooked

**A token launchpad on Solana where every token's trading rules are enforced on-chain, by the token itself.**

**[Pitch deck (PDF)](hooked-pitch-deck.pdf)** · Website: [hookedpad.com](https://www.hookedpad.com) · X: [@hoookedpad](https://x.com/hoookedpad) · Network: Solana mainnet

Every token launched on Hooked is a Token-2022 mint with a **transfer hook**: a program Solana calls on every buy, sell and send. If a trade breaks the token's rule, it never lands. The token trades on a Meteora Dynamic Bonding Curve and, for most rules, on any DEX or aggregator, because the rule lives in the token and not in a website.

Live as of 5 October 2026:

| | |
|---|---|
| Tokens launched on mainnet | 682 |
| Ready-made hooks | 39 |
| Trading fees collected by the flywheel | 3,305 SOL |
| Spent buying back the Hooked token | 2,808 SOL |
| Hooked token burned | 48.2M (4.83% of supply) |

## What you can launch

- **39 ready-made hooks**, each a real on-chain program: max per wallet, anti-bundle, sniper-fee caps, sell caps that scale with bag size, trading hours in any time zone, market hours with the NYSE holiday calendar, app-only trading (FOMO, the Pump app, OpenSea), Hot potato, Ping Pong, King of the Hill, Pegs (every whole token is a numbered object), caps that breathe like an oscillator, and more. See [docs/HOOKS.md](docs/HOOKS.md).
- **Custom hook, written by AI.** Describe the rule in plain words. An AI builder writes it in a small rule language, checks it with the real compiler, tests it against made-up trades, and hands you an editable rule set. See [docs/RULE-LANGUAGE.md](docs/RULE-LANGUAGE.md).
- **Editable hook.** A custom hook that is never locked: the creator's wallet can replace the rules at any time, on-chain, with an optional public notice period.
- **DAO hook.** Holders run the rules. Wallets holding a minimum post ideas and vote; when an idea passes, the AI builder turns it into a rule set and a keeper puts it on-chain. Nobody can change the rules any other way.
- **Combine rules.** Stack several ready-made rules on one token.

## How it works

```
 creator ──► launcher ──► 1. Token-2022 mint + Meteora DBC pool (one transaction)
                          2. the hook is switched on (rule stored on-chain)

 any trade, on any DEX ──► Token-2022 ──► the token's hook program ──► allow / refuse
                                                  │
                                    reads: the trade, the clock, the pool,
                                    the transaction, the token's own history

 1% trading fee ──► flywheel (every run): 15% dev · 85% buys the Hooked token and burns it
                    (Editable and DAO hooks: 15% dev · 5% the token's own fund · 80% buyback)
```

### The rules engine

Most hooks are one program per rule. The rules engine is one program for *any* rule: each token carries a small compiled program (bytecode), and the hook runs it on every transfer.

- **A stack machine with no jumps and no loops.** Every rule set halts, costs at most its own length, and can only allow or refuse. Arithmetic saturates.
- **A typed rule language.** Token amounts, SOL, time, shares and yes/no are different types, so `amount > 5 SOL` is a compile error instead of a silent bug. The compiler also produces a plain-English reading of every rule, and a decompiler turns on-chain bytecode back into source so a token's page shows its real rules.
- **Signals** a rule can use: the trade (amount, balances, buy or sell), the clock in any time zone with daylight saving, the pool (market cap, curve progress, the SOL value of a buy), the transaction (priority fee, Jito tip, signers, programs, memos, which app sent it), the token's counters (holders, volume, trades this slot, last buyer) and each wallet's own history (time since it last bought or sold, how long it has held).
- **Per-wallet history without per-wallet accounts.** One shared table per token remembers up to 100,000 recent traders in a single account, with a constant-cost lookup. That is what lets a rule say "wait 15 minutes after buying before selling" and still trade on any DEX.
- **It stays tradable everywhere.** Everything the hook reads resolves from the mint alone, so routers and aggregators can build the trade without knowing anything about Hooked.

```
timezone America/New_York
refuse if is_buy and amount > 1% and not trader is creator          # max 1% of supply per buy
refuse if is_sell and sender_seconds_since_buy < 15m                 # wait 15 minutes after buying
require is_transfer or (weekday < sat and hour >= 9 and hour < 17)   # trade Monday to Friday, 9 to 5
```

### AI-assisted hook creation

The AI can only produce rule text. It has three tools: compile a rule set, run it against made-up transfers, and propose the result. What reaches the creator has already compiled and been tested, and the creator can edit every line before signing. For a DAO hook, the same builder carries out a passed vote: it changes only what the vote asked for, and refuses requests the language can't express.

## The research behind it

Hooked started as a lab. Before building a product we mapped what Token-2022 transfer hooks can and can't do: 88 batches of experiments, each one a small program run on devnet, including live Meteora swaps, with the result written down whether it worked or not. A few things that came out of it:

- A hook fires inside a live Meteora swap, on buys and sells, and can veto it.
- Meteora's swap exposes the mint to a hook's account resolution but not the recipient. Rules keyed on the mint trade anywhere; rules keyed on the recipient need their own route. That one fact decides which hooks are "any DEX".
- A hook can't move its own token, but it can mint or pay out a different asset mid-transfer.
- A hook can read the rest of the transaction, which turns a per-transfer check into a whole-transaction one (fees paid, which app, memos).
- A hook can host real dynamics: a clock-driven oscillator, a damped driven oscillator with resonance, two coupled oscillators trading energy.
- Tokens can react to each other: one token's rules reading another token's live state, baskets, rings and feedback loops.
- Graduation to a normal Meteora pool removes the hook, so a rule is either a launch-phase guard or, on a permanent curve, for life.

The full log is in [docs/RESEARCH.md](docs/RESEARCH.md), and [docs/LAUNCH-IDEAS.md](docs/LAUNCH-IDEAS.md) lists token designs built only from things that were proven.

## What's in this repository

This repository is the submission companion: the research, the documentation and the parts of the site that implement the rule language, the AI builder and the Editable and DAO hooks.

| Path | What it is |
|---|---|
| `docs/RESEARCH.md` | The research log, batch by batch |
| `docs/HOOKS.md` | Every hook a token can launch with, and its program address |
| `docs/RULE-LANGUAGE.md` | The rule language reference the AI builder works from |
| `docs/LAUNCH-IDEAS.md` | Token designs built from proven capabilities |
| `site/app/lib/node/engine/` | The rule language: compiler, decompiler, simulator, on-chain client |
| `site/app/lib/hookAgent.ts` | The AI hook builder (tool loop: compile, test, propose) |
| `site/app/lib/daoExecutor.ts` | The keeper job that carries out DAO votes |
| `site/app/lib/editFund.ts` | The per-token fund for Editable and DAO hooks |
| `site/app/components/` | The hook builder and the live rules panel on a token's page |
| `site/app/api/` | Public rule-check and simulate endpoints, the builder, DAO ideas and votes |
| `site/scripts/` | Tests: unit tests for the language and end-to-end runs on devnet with real Meteora trades |

The `site/` folder is an excerpt of the production site (Next.js), included to be read; it isn't a standalone build. The on-chain program source isn't included in this repository: the programs are deployed and can be inspected at the addresses in `docs/HOOKS.md`.

## Key addresses (mainnet)

| | |
|---|---|
| Rules engine (Custom, Editable, DAO, Conviction cap) | `9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL` |
| King of the Hill | `63VLLdKEZVjwKN4Y6CqeeFkLGzMoSZxFAXsfiLwnKKkD` |
| Trading hours | `BUwCiwrRfVgNKEhHryBb626oKCRqNfm5hhkebrXKG6iY` |
| Blocklist | `8zw1psRFN541E1A3uzxB3uBXjUj3dVtkLHS3Ad99dFqP` |
| Hooked token | `C1mBfBoDkwWfd6uTFZp62ARHLjeVp3bDpCDMfMZtPngE` |
| Flywheel wallet | `2oXT6oMgNPfToahWG48QTBPWS9UJ8a7TSSeEoeoSLMGt` |

## Try it

- Launch a token: [hookedpad.com/launch](https://www.hookedpad.com/launch)
- Browse tokens: [hookedpad.com/launches](https://www.hookedpad.com/launches)
- Check a rule set without an account:

```bash
curl -s https://www.hookedpad.com/api/rules/check -H "content-type: application/json" -d '{"rules":"refuse if is_buy and amount > 1%"}'
```
