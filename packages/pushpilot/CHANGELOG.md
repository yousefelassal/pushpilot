# pushpilot

## 0.1.1

### Patch Changes

- 6d937c3: The browser client no longer stays in `unknown` when the push service never answers. A subscription lookup that takes longer than 10 seconds now moves the client to `error` with code `push-service`.

## 0.1.0

### Minor Changes

- ebc9fad: Add portable Web Push delivery, callback-owned HTTP handlers, browser lifecycle and React bindings, service-worker notifications, and VAPID CLI tools.
