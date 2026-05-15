---
name: password-reset
description: Walk the user through resetting a password — local account, corporate SSO/AD, Apple ID, or app-specific. Use when the user can't log in or asks how to reset a password.
when_to_use: "can't log in", "forgot password", "reset password", "locked out", "account locked".
disable-model-invocation: false
user-invocable: true
arguments:
  - account_type
argument-hint: "[local | ad | apple-id | google | other]"
---

# Password reset guide

You are guiding a user (or an IT helper) through a password reset. Determine the account type first, then walk through the right flow.

If `$account_type` is provided, jump straight to that section. Otherwise, ask:

> "What kind of account is this? Local computer login, work/school (Active Directory or Azure AD), Apple ID, Google, or something else?"

## Local account

### macOS
1. Reboot, hold ⌘R to enter Recovery Mode.
2. Utilities → Terminal → run `resetpassword`.
3. Pick the account, set a new password, **don't change the keychain password** unless you also know the old one.
4. Reboot.

If FileVault is on and they don't remember the old password, the recovery key is required — ask them if they have it saved somewhere (printed, in iCloud, with IT).

### Windows
1. Sign-in screen → "I forgot my password" link (only works if security questions or Microsoft account is set up).
2. Otherwise: boot to Windows installer USB → Repair → Command Prompt → use `net user <name> <newpass>` once Utilman trick is set up.
3. Modern Windows 10/11 with a Microsoft account: reset at <https://account.microsoft.com/password>.

### Linux
1. Reboot, hold Shift to enter GRUB.
2. Edit boot entry, add `init=/bin/bash` to the kernel line.
3. After boot: `mount -o remount,rw /` then `passwd <user>`.
4. Reboot normally.

## Active Directory / Azure AD (work or school)

1. Contact the **IT helpdesk** — most orgs require this for compliance / audit.
2. If self-service is enabled: <https://passwordreset.microsoftonline.com> for Azure AD.
3. For on-prem AD: ask the user if their org has a self-service portal; otherwise the helpdesk has to do it.

## Apple ID

1. <https://iforgot.apple.com> on any browser.
2. Or: Settings → [Name] → Sign-In & Security → Change Password on a signed-in device.
3. They'll need either trusted device approval, a trusted phone number, or the recovery key.

## Google account

1. <https://accounts.google.com/signin/recovery>.
2. Will ask for a recovery email, phone, or last-remembered password.
3. 2FA users: need backup codes or a trusted device.

## What NOT to do

- Never ask the user to tell you their old or new password.
- Never store a password anywhere — guide the reset, then leave.
- For corporate accounts, if there's any doubt about identity (e.g. someone else calling on their behalf), defer to IT and stop.

## Tell the user before you finish

- "Update your password in your password manager."
- "If this account is used in apps (Mail, Outlook, Calendar), update it there too — they'll show 'authentication failed' until you do."
- "Consider turning on 2FA if it isn't already."
