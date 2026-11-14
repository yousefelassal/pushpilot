# pushpilot

## 0.1.2

### Patch Changes

- 0401b4a: `send` now encrypts each message while it signs the VAPID header, and checks each stored subscription while it hashes the endpoint, instead of waiting for one step to finish before starting the next. Key setup and `pushpilot doctor` run their independent checks at the same time too.

## 0.1.1

### Patch Changes

- 6d937c3: The browser client no longer stays in `unknown` when the push service never answers. A subscription lookup that takes longer than 10 seconds now moves the client to `error` with code `push-service`.

## 0.1.0

### Minor Changes

- ebc9fad: Add portable Web Push delivery, callback-owned HTTP handlers, browser lifecycle and React bindings, service-worker notifications, and VAPID CLI tools.
