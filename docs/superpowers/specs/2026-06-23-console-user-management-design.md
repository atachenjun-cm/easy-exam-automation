# Console User Management Design

## Goal

Add a small admin-only user management page so the console owner can add coworker emails and temporary passwords for access to the automation console.

## Scope

- Add a `用户管理` entry in the existing sidebar.
- Only admin users can access user management.
- The existing configured account from `APP_LOGIN_EMAIL` / `APP_LOGIN_PASSWORD` remains the bootstrap admin.
- Admin can:
  - View enabled and disabled coworker accounts.
  - Add a coworker by email and temporary password.
  - Disable or enable a coworker account.
  - Delete a coworker account.
- Coworkers log in with their own email and password.
- User records are stored locally in `.easy_exam_runtime/auth_users.json`.

## Non-Goals

- No email sending.
- No registration page.
- No password reset flow.
- No fine-grained role permissions beyond `admin` and `user`.
- No changes to easy exam automation, requirement center, exam list/detail, or candidate import business logic.

## Data Model

The local user store contains coworker users only. The bootstrap admin stays in environment/local config.

Each coworker user has:

- `email`
- `passwordHash`
- `passwordSalt`
- `role`: `user`
- `disabled`: boolean
- `createdAt`
- `updatedAt`

Passwords are not stored as plaintext. The server stores salted hashes.

## API

- `GET /api/auth/users`
  - Admin only.
  - Returns coworker users without password hashes.
- `POST /api/auth/users`
  - Admin only.
  - Body: `{ "email": "...", "password": "..." }`
  - Creates or replaces a coworker account as enabled.
- `PATCH /api/auth/users/:email`
  - Admin only.
  - Body: `{ "disabled": true | false, "password": "optional new temporary password" }`
  - Updates status and optionally resets password.
- `DELETE /api/auth/users/:email`
  - Admin only.
  - Deletes the coworker account.

## Login Behavior

Login checks the bootstrap admin first, then enabled coworker accounts. Sessions include `{ email, role }`. User management APIs require `role === "admin"`.

Disabled users cannot log in. Existing sessions for a user are cleared when the user is disabled or deleted.

## UI

The `用户管理` page follows the current console card/table style:

- Top form: email and temporary password.
- Primary button: `添加/更新用户`.
- Table: email, status, created time, updated time, actions.
- Actions: enable/disable, delete.
- Non-admin users do not see the sidebar entry and get a no-permission message if they open `/users`.

## Testing

Add focused tests for:

- Password hashing and coworker login.
- Disabled users cannot log in.
- Admin role is required for user management routes.
- Router and SPA fallback include `/users`.
- HTML contains the user management page markers and sidebar entry.
