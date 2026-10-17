# Script rubric v1 (30-second script)

Score out of 10 as the average of four criteria, each 0 to 10.

| Criterion | 3 looks like | 6 looks like | 9 looks like |
|---|---|---|---|
| Hook | First line is a greeting ("Hi guys, welcome back") | First line states the topic | First line opens a loop (see hook rubric) |
| Payoff | No clear takeaway | A takeaway buried in the middle | One clear, specific payoff the hook promised |
| Call to action | None | Generic ("like and subscribe") | Specific next step tied to the content ("save this for your next Goa trip") |
| Length and pacing | Under 30 or over 130 words | 40 to 55 or 95 to 120 words | 55 to 95 words (about 30 seconds spoken), short sentences |

Output schema:

```json
{ "score": 0-10, "rubric_version": "script.v1",
  "breakdown": { "hook": 0-10, "payoff": 0-10, "cta": 0-10, "pacing": 0-10 },
  "strength": "string", "fix": "string", "example": "string" }
```
