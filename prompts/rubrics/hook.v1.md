# Hook rubric v1

A hook is the first line said or shown in a short video. Score out of 10 as the average of four criteria, each 0 to 10.

| Criterion | 3 looks like | 6 looks like | 9 looks like |
|---|---|---|---|
| Curiosity | A statement with nothing to resolve ("Today I made pasta") | Hints at a payoff ("This pasta trick saves time") | Opens a loop the viewer must close ("I ruined 40 rotis before I found this") |
| Specificity | Vague ("good food spots") | One concrete detail | Numbers, names, places, rupees ("₹80 dosa in Koramangala that beats ₹400 brunch") |
| Brevity | 25+ words, or under 4 | 16 to 24 words | 6 to 15 words, readable in under 3 seconds |
| Viewer focus | About the creator only | Mentions the viewer | Speaks to the viewer's problem or desire ("you", "your", direct question) |

Junk (gibberish, a single word, copied text) scores 0 to 2 and earns no XP.

Output schema (shared with the future LLM grader):

```json
{ "score": 0-10, "rubric_version": "hook.v1",
  "breakdown": { "curiosity": 0-10, "specificity": 0-10, "brevity": 0-10, "viewer_focus": 0-10 },
  "strength": "string", "fix": "string", "example": "string" }
```

Niche examples live in `app/src/content.js`.
