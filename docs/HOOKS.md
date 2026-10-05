# Every hook on Hooked

Each of these is a transfer hook program (or a rule set on the rules engine) that a token can launch with. Program addresses are the same on devnet and mainnet.

## AI-assisted hook creation

### Custom hook
Your own rules, written with AI. Say what you want the token to do; the AI writes it as a short rule set, checks it with the real compiler and tests it, and you can edit every line. Rules can use the trade, each wallet's own buys and sells, the clock in any time zone, the market cap, fees and the app a trade came from. Stored on-chain at launch, fixed for good, and it still trades on any DEX.

Trades on any DEX · program `9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL`

### Editable hook
A Custom hook that is never locked. Launch with any rules (or none) and rewrite them whenever you like with the same AI builder: only your wallet can make a change, each one is made on-chain, and the token's page always shows the rules as they are right now. 5% of the token's trading fees goes into its own fund that pays for the AI work; 80% still goes to the Hooked buyback and burn. Normal 1% fee, and it trades on any DEX.

Trades on any DEX · program `9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL`

### DAO hook
A Custom hook run by its holders. Wallets holding the minimum you set post ideas for the rules and vote them up or down. When an idea reaches the votes you set, AI writes it as rules, tests it, and Hooked's keeper puts it on-chain. Nobody can change the rules any other way, including you. 5% of the token's trading fees goes into its own fund that pays for the AI work and the changes; 80% still goes to the Hooked buyback and burn. Normal 1% fee, and it trades on any DEX.

Trades on any DEX · program `9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL`

## Who can hold

### Pegs
The supply becomes a fixed collection of numbered objects, up to 65,535. Every whole unit a wallet holds is one of them, with its own number and art: buying across a unit mints a number, selling below one burns your newest, and sending tokens moves your newest objects with them. Upload your own art at launch, or let Hooked draw one from each number.

Trades through Hooked's own route · program `2JwcGx9cUK1UyTsztkRAnCeAPgbJXkwCqSP9ghkPi3Md`

### Blocklist
The opposite of an allowlist: up to 200 wallets you name can never receive the token. They can't buy it and nobody can send it to them; everyone else trades normally, on any DEX. The list is sealed at launch, so it can never change.

Trades on any DEX · program `8zw1psRFN541E1A3uzxB3uBXjUj3dVtkLHS3Ad99dFqP`

### Allowlist
You upload a list of wallets at launch. Only those wallets can receive the token, checked against a Merkle root with a proof carried in the trade.

Trades through Hooked's own route · program `3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs`

### Holder-gated
To receive this token a wallet must already hold a token you pick: a membership token, an NFT or another coin. The hook checks the receiving wallet's balance of it on every buy and transfer.

Trades through Hooked's own route · program `2WsdXUpABzpXbiPcKrDYypdgzr2EybGorWFHBDXYtSGx`

## When you can sell

### Holder vesting
Each wallet's tokens unlock on their own clock from the moment it buys: nothing during the cliff, then a fixed share every period, from every hour to once a week. Vest every wallet, or only the ones that buy early, like a presale. A wallet can only sell what it has unlocked.

Trades through Hooked's own route · program `3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo`

### Hot potato
Whoever bought last holds the hot potato: they can't sell or send until a different wallet buys after them, which passes it on. Everyone else trades freely and buys are never blocked. A buy has to reach your minimum to pass it, and you can let it go cold after a while. Nobody is exempt, you included.

Trades on any DEX · program `CapP1YJk8Rh4d17szh45zXHy8vSMbZoNXfzm6zvNTgz7`

### Anti-dump caps
The hook tells buys from sells and caps each side separately, so people can buy freely while no single trade can dump a big bag.

Trades on any DEX · program `Ft8R4BsJp7n3dGKsd1RbAi3WrvkiH5s5z2jyDztEQJ6f`

### Sliding caps
The max per buy and max per sell change as the market cap grows. You set the caps at launch, then up to five market-cap levels where they change, for example max sell 1% at launch, 0.5% from $100,000 and 0.1% from $1,000,000, so whales have to exit in ever smaller pieces as the token grows. The hook reads the price from the token's own pool on every trade. If the market cap falls back under a level, the level below applies again. Nobody is exempt, including the creator.

Trades on any DEX · program `8uDCgT4KrMNsX6nJzqCFtLansP9AJef4deWWBk4nG9VA`

### Graduated sell caps
Small holders sell freely, but the bigger a wallet's bag, the smaller its per-sell cap, down to a floor. A whale can build a position but can't dump it in one sell. Nothing to fund and no minimum buy: the hook reads the bag straight from the sell.

Trades on any DEX · program `9Am6KfHqhi3vYmZKpE2kRJxmbNvwggujNzqqSaqdor2Z`

## Fair launch

### Max per wallet
After every buy or transfer the hook checks what the receiving wallet now holds, and refuses the trade if it would go over your cap, for example 1% of supply. The Meteora pool and your own wallet are exempt. Nothing to fund and no per-wallet setup.

Trades on any DEX · program `BVM8FK38fAJdWj4pezJh9xHaYaektV4f5Df9dq7y5TDC`

### Chapters
A max per wallet that grows with the token. It starts small, for example 1% of supply, and doubles every time the total volume traded crosses another chapter, for example every 10,000,000 tokens. Selling back into the pool always works.

Trades on any DEX · program `A7m1Pw8Kj8YfSEjZe3SEHAzeFE3xZPTmH4XqhLqRhQsc`

### Rising max per wallet
Every wallet's max holding starts small, for example 0.1% of supply, and rises for everyone on a timer you set: a fixed step or doubling. It never stops rising, so the token opens up completely over time. Snipers can only grab a tiny bag at launch. Nothing to fund and no per-wallet setup; the pool and your wallet are exempt.

Trades on any DEX · program `6AH1GVkqUdYCrbse28TcFSLyYTSiYqQVneaxvSBTSyp3`

### Sniper-fee cap
Snipers win launches by outbidding everyone with huge priority fees and Jito tips. For a launch window you choose, the hook reads each buy's transaction and refuses it if it pays more than your cap. Normal buyers pay tiny fees and never notice. Sells are never blocked and your wallet is exempt.

Trades on any DEX · program `BPVEVJfsDvPQ4A8oRntVudUAJyaUvFuSJVk5tidKz7Fp`

### Trade guard
Every buy, sell and transfer is capped at the same share of supply, for example 0.5%. Anything bigger is refused inside the swap, so no whale can grab or dump a big bag in one trade.

Trades on any DEX · program `9Kvwjjf2f9jP64JuC5AHfCQdxynHV1e678kfZCpiJ31z`

### Anti-bundle
The hook counts trades in each Solana block and refuses any past your limit. A bundler packing many buys into one block gets the first few at most, so nobody can buy up the launch in a single shot.

Trades on any DEX · program `AsqN4BA2cGmzbajL5rdg8rmfAsWs2K4TBS7Eqa8eLaY8`

### Conviction cap
Every wallet starts with a small limit per buy. Each minute, hour or day it holds without selling (you choose), its own limit climbs, up to a ceiling you set; sell and that wallet's clock starts again. New money is throttled while proven holders can buy bigger. Sells are never capped, your wallet is exempt, and it trades on any DEX.

Trades on any DEX · program `9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL`

## Where it trades

### Venue-locked
Trades only through its Meteora pool. A plain wallet-to-wallet transfer is refused, so every trade hits your official liquidity and nobody can move the token quietly off-market between wallets.

Trades on any DEX · program `3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs`

### DEX-only
Moves only when a program moves it, like a swap on the Meteora pool. A plain wallet-to-wallet send is refused, so the token can't be passed around off-market. Buying and selling through the pool work normally.

Trades on any DEX · program `4FYZUzNqHxLRLs8bhoQf71yRW8i2jPxJxLZJFcqB9Xom`

### FOMO-only buys
It can only be bought through the FOMO app. The hook checks that FOMO's own signing wallet co-signed each buy and refuses any buy that didn't come through FOMO. Launching includes a required dev buy. The dev wallet is also permanently whitelisted, so you can buy anywhere with it. Everyone else can only buy on FOMO. This lets the dev open up the pool on FOMO, which takes a few buys to trigger. Selling and sending always work, and the rule ends when the curve graduates.

Trades on any DEX · program `4Tabcoy1niosiNAGHMruLBFscgJWXZsVF3pfij3FqMB5`

### Pump App only
It can only be bought in the Pump app. It can only be bought in the Pump app. The Pump app buys through Jupiter's app API and the OKX router, and the swap built for it carries a tag that jup.ag's own swaps don't; the hook refuses any buy without that tag on that router. Buying on jup.ag, in FOMO, through trading terminals like Axiom and Photon, or straight from the pool is refused. Another app built on the same Jupiter API could also get through. Launching includes a required dev buy, and the dev wallet is permanently whitelisted, so you can buy anywhere with it. Selling and sending always work, and the rule ends when the curve graduates.

Trades on any DEX · program `BXax2KXrnT7qRf7cva9cLJpqDGXWywsw4ucLwtGiTa28`

### Social trading
It only trades in FOMO or the Pump app, buying and selling. A FOMO trade is recognised by FOMO's own signature. A Pump app trade is recognised by its route: it goes through Jupiter's app API and the OKX router, and carries a tag that jup.ag's own swaps don't. Trading on jup.ag, through terminals, or straight with the pool is refused both ways. Holders have no exit outside the two apps, so if both stop trading the token nobody can sell it. Launching includes a required dev buy, and the dev wallet is permanently whitelisted. Sending between wallets always works, and the rule ends when the curve graduates.

Trades on any DEX · program `DMohCzuYMQUsmYAiitgtYtSpsBtyEw9UWZha7EGqTv8M`

### OpenSea only
It only trades on OpenSea, buying and selling. Every swap made on OpenSea carries OpenSea's own marker, and the hook refuses any trade without it, so there's no exit outside OpenSea. Launching includes a required dev buy, and the dev wallet is permanently whitelisted. Sending between wallets always works, and the rule ends when the curve graduates. OpenSea hasn't yet been seen trading a token still on its curve.

Trades on any DEX · program `VqzxRoumJqbx99dQeWDoRC5XL48r5ZZYANwCgpuWVPW`

### P2P-only
The opposite of Venue-locked: it moves only wallet to wallet, and nobody can buy or sell it on a market. Only you can buy from the bonding curve, even all of it, and hand tokens out. When the curve fills up it graduates, the rule switches off, and it trades normally.

Trades on any DEX · program `B9HAaxbFnz868uYsVPWBJr1hL2cfZvXqzhssR3V2VQaT`

## When it trades

### Ping Pong
Buys and sells take turns: after a buy the next trade must be a sell, and after a sell it must be a buy, for everyone, the creator included. Trades under your minimum go through on their own turn but don't hand it over, and two trades in one transaction are refused, so nobody can game it with dust. If nobody takes the turn for a while, either side can go next. Sends always work, and the token page shows whose shot it is.

Trades on any DEX · program `Bf7ecqFieSoacTNbangY4trvnU7bVig6na1RMr6G84dk`

### Market hours
Trades like a stock: only Monday to Friday, 9:30am to 4:00pm New York time. Outside the session the hook refuses the trade. You choose whether sells stay open around the clock and whether stock-market holidays are observed. Wallet-to-wallet sends always work. It can also be paired with a tokenized stock like NVDAx or TSLAx instead of SOL, so the token is priced in that stock.

Trades on any DEX · program `EZet2oSoussVujse5U8W4T2NZsTuJ1rZBqQ8J188iJKk`

### Trading hours
You set the trading week: which days it trades and the hours on each, in any time zone in the world, with daylight saving followed on-chain. Outside those hours the hook refuses the trade. A day can run past midnight or stay open all day, and you choose whether sells stay open around the clock. Wallet-to-wallet sends always work.

Trades on any DEX · program `BUwCiwrRfVgNKEhHryBb626oKCRqNfm5hhkebrXKG6iY`

## Physics in tokens

### Breathing cap
An oscillator inside the hook swings the per-buy cap up and down on a fixed cycle, forever: wide open at the peaks, tight at the troughs. You choose the cycle, the base cap and the swing. Sells and sends are never capped, and your wallet is exempt.

Trades on any DEX · program `C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk`

### Momentum
A damped oscillator that starts at rest. Every buy kicks it and the cap swings up with it, so a run of buying opens room for bigger buys; then it swings back and settles when trading goes quiet. Sells and sends are never capped, and your wallet is exempt.

Trades on any DEX · program `C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk`

### Resonance
Momentum tuned for rhythm: buys that land in step with the natural period pile energy on and swing the cap far wider than scattered buys (5× the energy on devnet). A community buying on the beat unlocks the biggest buys. Sells and sends are never capped, and your wallet is exempt.

Trades on any DEX · program `C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk`

### Coupled resonator
Two coupled oscillators in the hook. Buys energise the first, which sets the cap, and the coupling pours that energy into the second and back, so the cap swells and fades in beats. Sells and sends are never capped, and your wallet is exempt.

Trades on any DEX · program `C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk`

## Who gets paid

### King of the Hill
The largest qualifying buy holds the crown. Beat the King's winning buy in a single buy and you steal it; the bar slowly decays so the throne never becomes unreachable. While they hold the crown the King earns about 0.5% of every trade, paid in SOL by the program itself, and selling or sending any tokens gives it up. The token page shows the King, the reign and a Hall of Kings. Trades carry a 1.65% fee, and it trades on any DEX.

Trades on any DEX · program `63VLLdKEZVjwKN4Y6CqeeFkLGzMoSZxFAXsfiLwnKKkD`

### Buyer rewards
Fill a vault with any token or with NFTs. Every qualifying buy earns the buyer a reward, which they collect on Hooked, even if they've never held that token. Buys only earn while the vault can cover them. You can withdraw anything not already owed to buyers.

Trades through Hooked's own route · program `3MNVGyhzq5iLN2ZAnkSnBdwqEomtdQ9vt7qS6nheauok`

### Tithe
The same enforcement as a royalty, but the payment goes to a cause you name: a charity, a treasury, a public-goods fund.

Trades through Hooked's own route · program `3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs`

## Linked tokens

### Reactive pair
Two tokens that watch each other. Each one's per-buy cap loosens while the other is being bought and tightens while it's being sold, so momentum in one opens the door in the other. Sells are never capped. Launch the two together.

Trades on any DEX · program `BCiJ49rbFS7Lw6QfbxweBQ5a4RVsif12kHBnx4QHBUxM`

### Entangled
Stays locked until its Beacon token's market cap reaches the target you set, for example $20,000. Then it unlocks for good, even if the Beacon falls back later. Launch the two as a pair.

Trades on any DEX · program `8h3iUcxwcCb2YJW99HbTmPohhitPsE94dHDuEAhwBJ7U`

### Beacon
Trades freely with no cap. Its hook remembers the highest market cap it has reached, and hitting the target is what unlocks its Entangled partner.

Trades on any DEX · program `8h3iUcxwcCb2YJW99HbTmPohhitPsE94dHDuEAhwBJ7U`
