# dsh-enter-guard

Double-Enter send guard for **DeepSeek Harness**. The first `Enter` only *arms* the composer — nothing is sent. The second `Enter` sends. Pressing any other key cancels.

Stops a half-written message from being sent by an accidental Enter.

[中文说明 →](README.zh.md)

```
type message ──▶ Enter ──▶ ✗ not sent, composer outlined, "press Enter again to send"
                     │
                     ├── Enter (again) ──▶ ✓ sent
                     └── any other key ──▶ state cancelled, back to normal
```

## The gap it fills

DeepSeek Harness sends on `Enter` and has no confirmation step. Its only setting (`Settings → General → Enter behavior`) decides whether `Enter` **queues** or **steers** while the agent is busy — it does nothing about accidental sends when the agent is idle.

A community catalog scan (6084 DSH plugins) turns up nothing in this category. The closest neighbours only cover half the problem: `dsh-prompt-stash` stashes a draft on demand, `dsh-composer-plus` enhances the built-in queue, `dsh-sleep-send` adds scheduled sending, and the `prompt-refine` family rewrites the draft *before* sending — none of them intercept the Enter key.

## Behaviour

| Situation | Result |
|---|---|
| First `Enter` (no modifier, not IME-composing, not key-repeat) | **blocked** — composer outlined, hint shown |
| `Enter` while armed | passes through — DSH sends natively |
| **Any** other key while armed (letters, digits, Backspace, arrows, Shift, Ctrl, Alt, Win, CapsLock) | state cancelled immediately |
| Draft changed, IME composition start, blur, click outside | state cancelled |
| `Ctrl`/`Cmd`+`Enter`, clicking Send | **sends immediately**, no confirmation (deliberate escape hatch) |
| `/` command menu or `@` file menu open | passes through — Enter there selects a candidate |
| Holding `Enter` down (key repeat) | ignored, never sends by itself |
| Empty draft (no text, no attachment) | not intercepted |
| 2 seconds after arming | hint fades, **state is kept** — a later `Enter` still sends |

## Install

Not on npm yet — install from source:

```bash
git clone https://github.com/Liyu147/dsh-enter-guard.git
dsh plugin --profile web add ./dsh-enter-guard
```

Then **restart `dsh web`** (a page refresh is not enough — the client bundle is resolved at boot).

A local checkout works the same way; point `add` at the directory:

```bash
dsh plugin --profile web add /path/to/dsh-enter-guard
```

Uninstall:

```bash
dsh plugin --profile web remove dsh-enter-guard
```

Verify it is alive — open DevTools console and run:

```js
__dshEnterGuard.instance.inspect()
// => { version, mounted: true, armed: false, hasCard: true, everBlocked: false, ... }
```

`hasCard: false` means the composer anchor was not found — see *Compatibility*.
`everBlocked` flips to `true` once the guard has actually swallowed an Enter — that is the field proving the key path works end to end.

## Compatibility

Anchors come from the DSH web client (`dsh-client-ui-conversation`):

| Selector | Purpose |
|---|---|
| `[data-composer-card]` | composer card (outline + hint anchor) |
| `[data-composer-input]` | editable area (focus / emptiness check) |
| `[data-trigger-menu]` | command & file candidate menu (pass-through) |
| `[data-composer-chip]` | attachment / reference chips (counts as content) |

If a future DSH release renames these, the plugin **fails safe**: it becomes a no-op and native `Enter` behaviour is restored. It never swallows a message. A startup self-check warns in the console 5 s after boot when the anchor is missing.

Tested against DSH **0.1.5-rc.3** on Windows / Chrome.

## Known limitations

1. **Enter only.** The Send button and `Ctrl`/`Cmd`+`Enter` always send immediately — by design.
2. **Cannot stop plugins that call `submit()` directly.** Voice-input plugins that auto-send bypass the keyboard entirely.
3. **DOM-anchor dependent** (see above).
4. **Not verified on mobile virtual keyboards** — they may not emit `keydown`.
5. One composer card is assumed (the first match). Normal single-session UI is unaffected.

## Design note

The guard deliberately **does not clear the draft, does not call `setDraft`, does not touch the attachment pipeline**. The text simply stays in the composer and is sent later. That is why the whole feature fits in a read-only DOM listener and why it is safe to remove at any time.

## Testing

Two zero-dependency Node harnesses (fake DOM, no browser, no DSH involved):

```bash
node test_guard_enter_send_v1.js    # core state machine, 17 cases
node test_client_bundle_v1.js       # the packaged bundle, 12 cases
```

These live in the parent directory of this package (the development workspace), not in the published tarball.

Manual regression before trusting it — six checks:

1. `/` opens the command menu → `Enter` **selects** a candidate
2. `@` opens the file menu → `Enter` **inserts** the reference
3. `Shift`+`Enter` → inserts a **newline**, no outline
4. `Ctrl`+`Enter` → **sends immediately**
5. Agent busy + `Enter` → still queues / steers as configured
6. Paste an image, then `Enter` → attachment **is sent with the message**

## Security

Read-only DOM. A single document-level `keydown`/`input`/`compositionstart`/`focusout`/`click` listener set, one injected `<style>`, one floating hint `<div>`.

- no `fetch`, no `XMLHttpRequest`, no `WebSocket`
- no `localStorage`, no `sessionStorage`, no cookies
- no session data, no settings writes, no host-side code (the host half is an empty shell)
- all decision code is wrapped in `try/catch` and **fails open** — an internal error restores native behaviour instead of eating the key

## License

MIT. See [LICENSE](LICENSE).
