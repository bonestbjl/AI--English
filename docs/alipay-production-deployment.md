# Alipay production payment deployment

The production payment code is fail-closed. Keep `ALIPAY_ENABLED=false` until the Alipay mobile website payment product is approved, the migration has been reviewed and applied, and the key files have been installed on the server.

## Required environment variables

```text
ALIPAY_ENABLED=false
ALIPAY_APP_ID=2021006178670803
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_PRIVATE_KEY_PATH=/etc/real-scene-english/keys/alipay_app_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=/etc/real-scene-english/keys/alipay_public_key.pem
ALIPAY_NOTIFY_URL=https://english.bonestlab.com/api/alipay/notify
ALIPAY_RETURN_URL=https://english.bonestlab.com/?payment=return
ALIPAY_QUIT_URL=https://english.bonestlab.com/?payment=cancel
```

The existing `AUTH_TOKEN_SECRET` (or `SMS_CODE_SECRET` fallback), `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` variables are also required by the payment endpoints. Do not place private keys or service-role credentials in this repository.

The application private key is expected to be an RSA 2048-bit PKCS8 PEM file beginning with `-----BEGIN PRIVATE KEY-----`. The Node SDK is explicitly initialized with `keyType: "PKCS8"`.

## Tencent Cloud Node service

The repository root `server.js` is the API process entry point. It listens on `127.0.0.1:3001` by default and registers the existing login, SMS, learning-data and legacy API routes together with:

```text
POST /api/alipay/create-order
POST /api/alipay/notify
GET  /api/alipay/order-status
```

The notification route preserves `application/x-www-form-urlencoded` request bodies for SDK signature verification. With the existing Nginx `/api/` proxy to port 3001, no Nginx route change should be needed.

## Manual rollout order

1. Keep `ALIPAY_ENABLED=false`.
2. Review and apply `supabase/migrations/20260802_alipay_production_payments.sql` in Supabase.
3. Install the application private key and Alipay public key at the configured server-only paths with restrictive file permissions.
4. Configure the callback URLs in the Alipay application and verify that `/api/alipay/notify` is publicly reachable over HTTPS.
5. Deploy the code while payments remain disabled and run endpoint health checks.
6. After the Alipay product is approved, use a controlled low-risk production test account and only then set `ALIPAY_ENABLED=true`.

The return URL never grants membership. Membership is granted only by the signed asynchronous notification through the atomic `finalize_alipay_payment` database function.
