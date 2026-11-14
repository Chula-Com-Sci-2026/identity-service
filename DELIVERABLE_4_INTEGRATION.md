# Deliverable 4 compatibility branch

This branch can run the local demo before the PR is merged. It keeps the teammate's Express/PostgreSQL service and existing email/password-reset endpoints while repairing session behavior and adding gateway-compatible aliases. The fixes do not require a frontend rewrite.

## Fixed behavior

- One HTTP listener starts after database readiness and optional RabbitMQ initialization.
- Cookies are parsed; refresh/logout work with an HttpOnly cookie scoped to `/api/v1/auth`. Refresh tokens are no longer returned to browser JavaScript.
- Access JWTs retain `id` for existing clients and add UUID `sub`, `iss`, `aud`, `iat`, `exp` and phone-verification state. Use HS256 with the same local access key as downstream services.
- Refresh JWTs use a different secret, a different audience and a random `jti`. Atomic consumption prevents concurrent refresh replay.
- Phone verification is required for login by default. Password hashes remain bcrypt, increased to cost 12 for new accounts. Inputs exceeding bcrypt's 72-byte password limit are rejected during registration.
- Random OTPs use cryptographic randomness, expiry, five persisted attempts and resend cooldown. Phone numbers normalize to `+66…`; OTP verification uses one database transaction/client.
- The deferred admin lock/unlock endpoint is unavailable rather than exposed without authorization.
- Repeatable PostgreSQL SQL migrations, database readiness, a fixed worker restart policy, pinned dependency resolution and isolated database-backed tests are included.
- Runtime configuration is no longer tracked or copied into images. If earlier committed configuration contained real credentials, rotate them; removing a file does not remove Git history.

## Standalone local startup

For a new checkout, create local configuration without committing secrets:

```sh
node scripts/init-env.js
docker compose --env-file config/config.env up -d --build --wait
docker compose --env-file config/config.env exec identity-api node scripts/seed-demo.js
```

The script preserves an existing configuration. Existing installations should compare it with `config/config.env.example` and explicitly configure the new variables before starting. The PostgreSQL initializer creates a non-superuser application owner and separate demo/test databases. Keep volumes when stopping. Schema initialization targets a fresh database; review migration compatibility before pointing this branch at an existing manually managed database or importing a dump.

Default local OTP delivery is explicitly `console`; inspect `docker compose --env-file config/config.env logs identity-api` for the random code. No real SMS is sent in this mode. Select `OTP_DELIVERY=sms` with valid Twilio configuration for real delivery; missing provider configuration fails explicitly instead of silently claiming an SMS was sent. `EMAIL_DELIVERY=console` similarly prevents external email delivery in local demo mode. RabbitMQ's `identity.email.v1` queue is separate from buddy domain events. Login and sessions do not use the queue; set `RABBITMQ_REQUIRED=false` only when intentionally running without email jobs.

## Browser/gateway compatibility

Existing routes remain available:

- `POST /api/v1/auth/phone/send-otp` with `phoneNumber`.
- `POST /api/v1/auth/phone/verify-otp` with `phoneNumber` and `otpCode`.
- `POST /api/v1/auth/refresh-token`.

Added compatibility:

- `AUTO_SEND_PHONE_OTP=true`: registration starts the verification flow and returns `registrationId`, `maskedPhone`, `expiresAt`, `deliveryAdapter` alongside the original `user` object.
- `POST /api/v1/auth/verify-otp` with `registrationId` and `code`: verifies and creates the initial session.
- `POST /api/v1/auth/refresh`: alias of refresh-token.
- Login/verification/refresh return `accessToken`, top-level `userId`, and `profileComplete=false`. Profile completeness is managed by Profile/onboarding, not an Identity database field.
- `POST /api/v1/auth/logout` is idempotent and returns 204.

The local gateway can forward these paths without translating user IDs. Refresh cookies must be forwarded in both directions. Tokens use issuer `cant-run-alone-local`, audience `cant-run-alone-services`; the refresh audience has suffix `-refresh`. Fifteen-minute access tokens remain valid until expiry after logout. This local HS256 setup is not a production asymmetric-key trust architecture.

If using the multi-repository demo, `running-buddy-integration/compose.team-identity.yaml` selects this branch's checkout as the Identity build context, uses a fresh `identity_team` database and points the gateway to port 5000. The original Python Identity repo/database are retained for rollback. All identity UUIDs must match Profile/Scheduling/Reputation fixtures; `seed-demo.js` provides Ray and Mali with stable UUIDs and password `runner123`. These seeded verification flags are development fixtures.

## Tests

`npm test` uses Node's built-in test runner and a real isolated PostgreSQL database. Supply `TEST_DATABASE_URL` ending in `_test`, `ACCESS_TOKEN_SECRET`, and `REFRESH_TOKEN_SECRET`; tests refuse other database names. Containerized tests can use the same API image and override `DATABASE_URL` via `TEST_DATABASE_URL`.

Coverage: registration/OTP/login, token claims and HttpOnly cookies, one-time refresh rotation, concurrent refresh replay, logout, persisted OTP lockout, expiry/reuse, failed-login lockout, unavailable admin route, original phone endpoints, validation and one-listener startup/readiness. Existing email/password-reset behavior is retained; this PR does not claim a complete security audit of those legacy flows. The existing dev-only nodemon dependency has audit findings; production images omit dev dependencies.
