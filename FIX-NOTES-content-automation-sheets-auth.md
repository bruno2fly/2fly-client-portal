# Content automation `/sheets` authentication fix

## Root cause

`POST /sheets`, `GET /status`, and `POST /seed-estoqui` are all behind the same
router-level `automationAuth` middleware. There is no earlier route collision or
second application-level authentication middleware for `/sheets`.

The shared parser was unnecessarily strict: it accepted only the exact,
case-sensitive `Bearer ` prefix and compared untrimmed header and environment
values. A trailing newline/space introduced while setting a Render environment
variable, or harmless whitespace/scheme casing in the request, therefore caused
the middleware's only 401 response before `/sheets` could run.

## Fix

The configured secret is now trimmed once at startup. Presented Bearer, query,
and `X-API-Key` credentials are normalized before the same timing-safe comparison,
and the Bearer scheme is parsed case-insensitively with flexible whitespace. The
router remains fail-closed and every content-automation route remains protected.
No legacy scheduling or publishing code was changed.

## Verify after deployment

```sh
curl -X POST -H "Authorization: Bearer 4ad55d14b1ba59d8deb31322c193703cf36019121ad66a4087aec601d32adc42" \
  -H "Content-Type: application/json" \
  "https://api.2flyflow.com/api/content-automation/sheets" \
  -d '{"clientId":"estoqui","spreadsheetId":"1KqAd-Tl2foryYqRY3zKh90f90aAKxIQqr2lIkwY5azw","tabName":"Sheet1"}'
```

Expected: HTTP 200 with the created or updated `AutomatedContentSheet` record.

## Next runtime step

This sandbox had no live network access, so the two registrations were not run.
After deploying, run the Estoqui command above, confirm the Cafe St. Petersburg
tab name through the Sheets API, then register it (expected tab name shown):

```sh
curl -X POST -H "Authorization: Bearer 4ad55d14b1ba59d8deb31322c193703cf36019121ad66a4087aec601d32adc42" \
  -H "Content-Type: application/json" \
  "https://api.2flyflow.com/api/content-automation/sheets" \
  -d '{"clientId":"stpetersburg","spreadsheetId":"1-zD-swDoQrr1E14-0vlmpwqa0aW1ceMw0MJvQqzUT5U","tabName":"Schedule"}'
```
