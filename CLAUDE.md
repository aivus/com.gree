# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Homey](https://homey.app) app (SDK 3) that controls Gree and other EWPE Smart–compatible Wi-Fi HVAC devices, either over the local network or through the Gree cloud. Published as `com.gree` on the Homey App Store. Runs on the Homey device inside its Node.js app sandbox; there is no server component. Local device communication uses the third-party [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client) (pinned to a GitHub tag in `package.json`); the cloud transport lives in this repo and uses `mqtt` plus the global `fetch`.

## Commands

- `npm test` — runs ESLint **then** Jest (this is the full CI gate; both must pass).
- `npm run eslint` / `npm run jest` — run either half alone.
- `npx jest test/device.freshAirMode.test.js` — run a single test file.
- `npx jest -t 'sets fresh air mode'` — run tests matching a name.
- `homey app run` — run the app against a real Homey for manual testing (requires the Homey CLI and a paired Homey). `homey app validate --level publish` mirrors the validation CI job.

Node 22 is used in CI (`engines` requires `>=18`, because the cloud transport uses the global `fetch`).

## Build / generated files — important

`app.json` at the repo root is **generated** — never edit it directly. The source of truth is `.homeycompose/`:

- `.homeycompose/app.json` — app manifest (id, **version**, permissions, etc.).
- `.homeycompose/capabilities/*.json` — custom capability definitions (e.g. `fan_speed`, `fresh_air_mode`, `health_mode`).
- `drivers/<driver>/driver.compose.json` — driver + its capabilities/settings.
- `.homeycompose/flow/{triggers,conditions,actions}/<card-id>.json` — flow cards, one file per card, **app-scoped and shared by both drivers**.

The Homey CLI (`homey app build`, or implicitly on `homey app run`) compiles these into the root `app.json`. When editing manifest/flow/capability data, change the compose source and rebuild; if you can't run the CLI, hand-edit both the compose file **and** the corresponding section of `app.json` to keep them in sync (as the existing version-bump commits do).

## Flow cards — shared between drivers

Flow cards live in `.homeycompose/flow/<type>/<card-id>.json`, **not** in a driver's
`driver.flow.compose.json`, and each one hand-writes its `device` argument:

```json
"args": [{ "type": "device", "name": "device", "filter": "driver_id=gree_cooper_hunter_hvac|gree_cloud_hvac" }]
```

Three rules that are easy to break:

- **Never move a card into a `driver.flow.compose.json`.** `HomeyCompose` hard-codes
  `filter: "driver_id=<thatDriver>"` for anything there, so the card can only ever
  be offered to one driver — and two drivers emitting the same card id is a
  validation error.
- **The filter must keep a `driver_id=` key.** `homey-lib` only exempts the first
  device argument from `titleFormatted` validation when the filter carries one;
  filtering on `capabilities=` instead would demand a `[[device]]` token in all 26
  `titleFormatted` strings, in every locale.
- **The three deprecated cards (`hvac_mode_changed`, `hvac_mode_is`,
  `set_hvac_mode`) stay restricted to `gree_cooper_hunter_hvac`** so the cloud
  driver cannot grow new usage of them.

`app.js` registers every condition and action run listener once, app-wide, by card
id, and only touches `args.device` through generic SDK methods — so a new driver
needs no changes there.

Note that `_composeFlow()` runs before `_composeDrivers()` and reads files
alphabetically, so moving or adding cards **reorders** the `flow.*` arrays in the
generated `app.json`. Review such a diff by card id, not with `git diff`.

## Versioning & changelog

The version lives in **both** `.homeycompose/app.json` and the generated `app.json`; keep them identical. User-facing release notes go in `.homeychangelog.json`, keyed by version string, with a translation for every supported locale (`en, nl, de, fr, it, sv, no, es, da, pl, ko`). See past "Bump vX.Y.Z" commits for the exact shape.

## Localization

All user-visible strings are localized across the 11 locales above. Runtime strings live in `locales/<lang>.json` and are looked up with `this.homey.__('key', { ...tokens })`. Manifest/flow/capability titles are localized inline in the compose JSON. When adding any user-facing text, add **all** locales.

Note that `homey app validate` does **not** compare keys between locale files — it only checks that each file parses and is named after a known language. A key added to `en.json` alone would silently fall back to the key name everywhere else, so `test/locales.parity.test.js` guards this instead.

## Architecture

Two drivers, both exposing the same 16 capabilities and sharing the app's custom capabilities and flow cards.

### `drivers/gree_cooper_hunter_hvac/` — local network (default)

Three cooperating layers:

**`network/finder.js` — a module-level singleton** (`module.exports = new Finder()`). It owns one shared UDP socket bound to port 7000, broadcasts `{"t":"scan"}` every 30 s, and decrypts replies trying **both** AES-ECB (older firmware) and AES-GCM (firmware V2.x) ciphers. Discovered HVACs are cached by MAC and exposed via `finder.hvacs`. `finder.probe(ip)` sends a unicast scan for static-IP pairing. The finder is defensive against socket errors (auto-restart with backoff) so a UDP failure can't crash the app; on app shutdown `driver.onUninit()` calls `finder.stop()` to release the socket, timers, and pending probes.

**`driver.js`** — handles pairing (`onPair`). Two paths: normal discovery (pick from `finder.hvacs`, dedup against already-paired MACs) and manual **static IP** entry, including a "Skip UDP scan" mode for devices that don't answer broadcasts. Static-IP-skip devices have **no MAC at pair time** — the IP is used as the device id and the real MAC is resolved later on first connect.

**`device.js`** — the bulk of the logic. Each device instance:
- Runs a `setInterval` discovery loop (`_startLookingForDevice`) that matches the finder's cached HVACs by MAC (or connects directly if a static IP is set), then creates a `gree-hvac-client` `Client`.
- **Bridges two directions:** Homey capability listeners (`_registerCapabilityListeners`) translate Homey capability values → HVAC raw properties via `HVAC.PROPERTY`/`HVAC.VALUE` maps and call `_setClientProperty`; the client's `update` event (`_onUpdate`) translates HVAC properties → Homey capabilities and fires the corresponding `*_changed` flow triggers. The `_check*PropertyChanged` helpers gate updates so triggers only fire on real changes.
- Handles connection lifecycle: `connect`/`disconnect`/`error`/`no_response` events map to `setAvailable`/`_markOffline`. A prolonged `no_response` (60 s) triggers a full `reconnect()` — this is how the app recovers when the HVAC's DHCP IP changes.
- **Resource cleanup is manual and important:** the HVAC client owns its own socket/timers that the SDK does not clean up, so `onDeleted`/`onUninit` both call `_cleanup()` (stop timers + `_tryToDisconnect`). `disconnect()` is `.catch()`-guarded because it rejects when there's no active socket.

**`app.js`** — registers all flow **condition** and **action** run listeners globally (not per-device); each resolves `args.device` and reads/writes capability values. It also implements deprecated-flow-card notifications: `_notifyDeprecatedFlowCard(cardId)` warns the user (Homey timeline notification) and reports to Sentry once per card per session. The deprecated `hvac_mode_changed` **trigger** has no args so Homey never fires its run listener — usage is instead detected in `device.js` via `getArgumentValues(this)` when the trigger fires.

**`app.js` uses `homey-log`** (Sentry) for error/usage reporting, configured in `onInit`.

### `drivers/gree_cloud_hvac/` — Gree cloud

Reaches HVACs through Gree's servers with the user's Gree account, for units the
local protocol cannot serve (other network/VLAN, UDP blocked, newer firmware and
cloud-only models). The protocol is reverse-engineered and not published by Gree.

Two stages: **HTTPS REST** to sign in and list devices (which is where the
per-device AES keys come from), then **MQTT over TLS on port 1984** for all state
read and write — there is no REST endpoint for get/set status.

`network/` holds the transport, all of it unit-tested without a network:

- **`crypto.js`** — wraps `EcbCipher`/`GcmCipher` from `gree-hvac-client`, which
  already implement all three cipher layers the cloud needs (the REST envelope,
  the MQTT `pack` with a per-device key, and the GCM variant whose nonce and AAD
  are identical). Adds a fallback for replies padded with non-PKCS#7 bytes, which
  make OpenSSL reject the final block.
- **`rest.js`** — the signed request envelope (two MD5 digests over an *ordered*
  per-endpoint field list; the order is load-bearing) and the four endpoints.
  Generate the timestamp **once** per request: it signs the request *and* hashes
  the password, so deriving it twice can straddle a second boundary.
- **`mqtt.js`** — one TLS connection per account; requests correlated by `cid`.
  Topics use the **parent** MAC while `tcid` names the child, for ducted units
  exposed as a child of a gateway.
- **`commands.js`** — the write sequencing, which is what makes cloud writes land:
  strictly one command at a time, mode first and power last, and the temperature
  fields (`SetTem` + the half-degree ones) and the sleep pair (`SwhSlp`/`SlpMod`)
  each in a single command.
- **`properties.js`** — reuses `PropertyTransformer` from `gree-hvac-client` and
  re-exports `PROPERTY`/`VALUE` verbatim, so `device.js` speaks the same
  vocabulary as the local driver.
- **`connection.js` / `session.js`** — `session.js` is a module-level singleton
  keyed by region + account. A Gree account permits only **one active session**, so
  every device on an account shares one connection; the last one to detach closes
  it, and `driver.onUninit()` calls `session.stop()`. Unlike `finder.js` it starts
  nothing on require. An expired token is handled by signing in again and retrying
  once — the cloud has no refresh endpoint.

`driver.js` pairs by account login: a warning view about the single-session limit,
then region + credentials, then a device list deduped against `getMac()`.
`onRepair` re-enters credentials and rotates the stored key. Credentials live in
the `cloud_accounts` app setting so the app can sign in again unattended; the
per-device key lives in the device store because the cloud rotates it. **Never log
or Sentry-report them.**

`device.js` is a deliberate, standalone copy of the local driver's capability
bridge over this transport — the two are intentionally duplicated, so a change to
the capability↔property bridge must be applied to **both**. It omits the
deprecated `hvac_mode_changed` trigger (12 trigger cards, not 13) and needs no
capability migrations.

Some things about the cloud are still unverified and are called out in the code:
the `TemSen`/`EnvTem` offset may differ per firmware, `Quiet` may need `2` rather
than `1` for "on", and broker certificate validation may need relaxing.

### Capability migrations

Local driver only. `device.js._executeCapabilityMigrations()` runs on every `onInit` and incrementally adds/renames capabilities for devices paired with older app versions (each block is commented with the version it was added in). When adding a new capability, add a guarded `addCapability` block here so existing paired devices get it. Note the `hvac_mode` → `thermostat_mode` history — `thermostat_mode` is the current HVAC-mode capability.

## Testing conventions

Tests run in plain Node with **no Homey runtime** — `homey`, `gree-hvac-client`, and the driver's `network/` modules are mocked per-test with `jest.doMock` inside `beforeEach` (after `jest.resetModules()`). Instances are constructed directly and their SDK methods (`registerCapabilityListener`, `setCapabilityValue`, flow triggers, `log`/`error`) are replaced with `jest.fn()`. Follow the existing pattern in `test/device.*.test.js` (local) or `test/cloudDevice.test.js` (cloud) when covering new device logic. Test files must match `test/**/*.test.js`.

`test/manifest.*.test.js` and `test/locales.parity.test.js` assert invariants of the **generated** `app.json` and the locale files: the full set of flow card ids and their device filters, capability parity between the two drivers, pair/repair views existing on disk, locale key parity, and the version matching across `.homeycompose/app.json`, `app.json` and `.homeychangelog.json`. Run `homey app build` before `npm test` after changing any compose file, or these read a stale manifest.

ESLint's `mocha/no-setup-in-describe` rule rejects `it.each` and any computation directly inside a `describe` body — put the work inside the test function instead.

## Code style

ESLint extends `athom` config with 4-space indentation (`.eslintrc.json`); `npm run eslint` is part of `npm test`. Files start with `'use strict';`.
