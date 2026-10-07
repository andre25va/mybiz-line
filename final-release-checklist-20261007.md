# Final release checklist — 2026-10-07

Hold merge. No production change.

## Done

- [x] Phone health stays a read-only admin GET. No second Device, polling, token mint, call, text, or provider probe was added for this fix.
- [x] Admin page gate was left as it is: cookie middleware plus the phone-health route. Access was not broadened.
- [x] Initial 503, network/JSON failure, and malformed 200 show only a generic unavailable message and Retry. That failure is not treated as authorization.
- [x] Strict-valid 200 is the only data view. 401/403 clears held health state and renders nothing health-related.
- [x] Retry and Refresh stay single-flight and disabled while loading.
- [x] Local validation for the runtime commit `41115cce2f435f11f3b0f6daed0c5430e380a904` (not hosted proof): focused suite 22 passed, 0 failed; `npx tsc --noEmit --pretty false` exit 0; full Next build exit 0 under `env -i`, the external-egress guard, and inert placeholders. No `.env.local` or real secrets.
- [x] Automatic Vercel previews observed Ready: behavior commit `41115cce2f435f11f3b0f6daed0c5430e380a904` and notes commit `b32ecd71150c555368acaad8e2c409a1cc388ef1`. See `preview-verification-20261007.md`. The branch alias follows the tip.
- [x] Owner-admin authenticated preview of the data view, Refresh, and Unknown checks was already completed on the prior head.
- [x] Build Hub action registry records `admin-view-phone-health`, `admin-open-system-health`, and `admin-refresh-phone-health`. Retry reuses the refresh action id.

## Not done — do not merge on these

- [ ] Hosted click-through of the new initial-unavailable Retry UI. Not safe from this workspace without a new login.
- [ ] Signed-in non-admin hosted check. No non-admin session was available.
- [ ] Do not describe a missing GitHub test check as a failed build. The authoritative hosted build is the automatic Vercel deployment.

## Explicitly not in this change

- No merge, manual deploy, production change, OTP, activation, token issuance, call, text, or provider probe.
