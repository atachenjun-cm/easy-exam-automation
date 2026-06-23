# Console Local Login Design

## Goal

Add a minimal email/password login gate so coworkers can open the automation console by URL and use it after authenticating.

## Scope

- Add a `/login` page in the existing console visual style.
- Add server-side authentication endpoints:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
- Store login state in an HttpOnly session cookie.
- Read the allowed account from local configuration, preferring environment variables:
  - `APP_LOGIN_EMAIL`
  - `APP_LOGIN_PASSWORD`
- Protect console pages and business APIs when authentication is enabled.
- Keep `/api/health`, `/login`, `/web/*`, and static frontend delivery available before login.

## Non-Goals

- No registration.
- No password reset.
- No multi-user management UI.
- No role permissions.
- No changes to existing easy exam automation, requirement center, exam list/detail, candidate import, or tenant API business logic.

## User Flow

1. A coworker opens the shared console URL.
2. If no valid session cookie exists, the app shows `/login`.
3. The coworker enters the configured email and password.
4. On success, the server sets an HttpOnly cookie and the app navigates to the originally requested path, defaulting to `/projects`.
5. The sidebar shows the logged-in email and a logout button.
6. Logout clears the cookie and returns to `/login`.

## Authentication Behavior

Authentication is enabled only when both `APP_LOGIN_EMAIL` and `APP_LOGIN_PASSWORD` are configured, or when equivalent local runtime auth settings are configured. This avoids locking out the current local development console before credentials are created.

When authentication is enabled:

- Unauthenticated frontend route requests redirect to `/login`.
- Unauthenticated JSON API requests return `401` with a clear error.
- Authenticated requests proceed through existing handlers unchanged.
- Incorrect login returns `401` without revealing which field was wrong.

## UI Design

The login page uses the existing design language:

- White card on the current light gray background.
- Existing blue primary button color.
- Same font stack and border radius.
- Brand mark and title: `考试配置台`.
- Form fields: email and password.
- Inline error state below the form.

## Testing

Add focused tests for:

- `/login` route matching and frontend fallback.
- Auth helper behavior for disabled auth, invalid credentials, login success, session lookup, and logout cookie clearing.
- UI markers for the login page, logout button, and auth bootstrap script.

## Deployment

After verification, sync tracked files to the existing deployed app directory and restart the LaunchAgent. Credentials can be supplied through the app environment or a local runtime auth file before coworkers use the URL.
