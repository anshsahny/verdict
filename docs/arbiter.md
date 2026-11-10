# The SIMULATED arbiter

**The Arena's arbiter is a rule-based stand-in for PayPal's dispute reviewers. It is not PayPal's process, and Arena results are not real-world outcomes.** It exists so we can score thousands of dispute responses cheaply and consistently. In the sandbox, PayPal's own ruling can be forced (`adjudicate`) but not predicted, so the Arena uses these rules instead. The code is in `lib/arena/arbiter.ts`. Every verdict stores the rule trace that produced it.

## Inputs
- The scenario's dispute type, amount and complaint. The **hidden ground truth** (who is really at fault) is used only to judge whether the response was the right call, never to decide the case.
- The defender's decision: action, amount and cited evidence.
- The evidence packet: every relevant store record, including records that hurt the seller.
- For partial-refund offers: the buyer agent's reply (accept or decline).

## Outcomes
| Defender action | Outcome |
|---|---|
| `accept` | **BUYER_WINS**: the seller refunds in full. No fee. |
| `offer_refund`, buyer accepts | **SETTLED**: the seller refunds the offer amount. |
| `offer_refund`, buyer declines | The buyer escalates; the cited evidence is judged as a contest. |
| `contest` | **SELLER_WINS** if every rule below passes, otherwise **BUYER_WINS**: full refund plus a $15 SIMULATED dispute fee. |
| `escalate_to_human` | **ESCALATED**: no automatic outcome, and no money counted. |

## Contest rules (all must pass)
Only citations that match a real, helpful record of that kind count.

| Rule | Not received / late | Not as described | Unauthorized | Duplicate |
|---|---|---|---|---|
| Evidence completeness | tracking + delivery scan cited | product listing cited | delivery + account history cited | separate orders or a prior refund cited |
| Tracking proof | delivered to the order address | — | delivered to the account holder's address | — |
| Signature over $100 | signature cited if amount > $100 | — | — | — |
| Claim consistency | — | the complaint is variation the listing discloses (damage or a wrong item always loses) | — | — |
| Timeliness | responded before the seller deadline | same | same | same |
| No contradicting records | no record against the seller (wrong address, no delivery scan, untracked, unrefunded duplicate) | same | same | same |

## "Right call"
A response is the right call when it serves the merchant given the hidden truth:
- conceding when the merchant is at fault;
- winning (or settling) when the buyer is at fault;
- escalating ambiguous cases.

Losing a contest is never the right call.

## Money
- **Retained**: disputed money the seller keeps.
- **Refunded**: money that left.
- **Fees**: SIMULATED, $15 per lost contest.

The benchmark compares these with an "always refund" baseline. All figures are SIMULATED.

## Limitations (read before quoting numbers)
- The arbiter, the scenarios and the defender's evidence packet share one model of the world (the same record kinds and the same notion of "delivered to the order address"). High scores partly show that the agent applies the store's playbook consistently inside that model. They do not show how real PayPal reviewers would rule.
- Buyer claims are written live by a Claude buyer agent with four personas (honest, mistaken, opportunistic, aggressive). The facts behind each case are fixed by the scenario.
- Fees, the $100 signature rule and the "right call" definition are SIMULATED parameters chosen for this project.
- Bound runs (`npm run arena:bound`) act on real sandbox disputes. The final PayPal state comes from the sandbox `adjudicate` call set to the SIMULATED verdict, so it confirms the plumbing, not the ruling.
