---
'pushpilot': patch
---

`send` now encrypts each message while it signs the VAPID header, and checks each stored subscription while it hashes the endpoint, instead of waiting for one step to finish before starting the next. Key setup and `pushpilot doctor` run their independent checks at the same time too.
