---
'pushpilot': patch
---

The browser client no longer stays in `unknown` when the push service never answers. A subscription lookup that takes longer than 10 seconds now moves the client to `error` with code `push-service`.
