# 2. Tokens are integers, money is micro-dollars, prices have a validity range

Date: 2026-11-18

## Context

Every answer is metered in tokens and costed in dollars, and the usage report must add up: the sum over rows equals the sum by model equals the sum by member. A thousand tokens of a small model cost $0.00015. Prices change (the public list moves a few times a year), and an answer given in August must keep August's cost after September's price lands.

## Options considered

1. **Floating-point dollars.** `0.1 + 0.2` is not `0.3`; the report would drift by a few millionths and never reconcile.
2. **Integer cents.** Exact, but a single answer costs a fraction of a cent, so every row would round to zero and the month's total would be wrong by the sum of the roundings.
3. **Integer micro-dollars** (a millionth of a dollar), with prices as integer micro-dollars per thousand tokens, and one half-up rounding per row.
4. **A current price on the model** and the cost computed at report time.

## Decision

Option 3 for money. `costMicros(tokens, microsPer1k)` is the only place a division happens, and it rounds once. Tokens are integers counted by the approximate tokenizer (one token per six characters of a word, one per punctuation mark), which is what the chunker, the context budget and the meter all use, so the counts agree with each other even though they are not a model's own.

For prices, a table with `valid_from` and a nullable `valid_to`, start inclusive and end exclusive, and `priceInForce(prices, model, kind, at)` picks the row. A usage row snapshots the price it was costed at, so the report never recomputes a past month at today's price, and a model with no price in force cannot answer.

## Consequences

Amounts are shown with four decimals under a cent and two above, which is slightly unusual on a screen. The tokenizer is an approximation and the README says so; swapping in a real one is a new adapter behind the `Tokenizer` port and a re-index. Price changes are inserts, never updates, which is what makes the audit trail of a cost possible.
