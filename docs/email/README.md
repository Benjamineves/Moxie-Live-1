# Moxie email templates

**Generated. Do not edit anything in this folder.**

Source: `web/src/lib/email/`. Rebuild with:

    npm run email:build

---

## supabase_password_reset.html — paste target

Pure HTML, no comment header, so it can be selected whole and pasted.

**Supabase dashboard → Authentication → Emails → Reset Password.**
Paste the entire file into the **Body (HTML)** box.

Subject line to set alongside it:

    Reset your Moxie password

On macOS, straight to the clipboard:

    cat docs/email/supabase_password_reset.html | pbcopy

### Things that will break it

- `{{ .ConfirmationURL }}` is Supabase's own Go template variable, substituted
  at send time. It must survive verbatim — do not encode it, wrap it in quotes,
  or replace it with a real URL. It appears twice: the button's `href` and the
  visible fallback URL beneath it.
- **Supabase is a paste target, not the source of truth.** A change made only in
  the dashboard is invisible to this repository and will be silently overwritten
  by the next paste. Edit the module and regenerate.

### Known gap

Supabase's editor has one Body box and no field for a `text/plain`
alternative, so `password_reset.txt` **cannot** be pasted alongside it. The
reset therefore sends as single-part HTML, which is a documented spam signal and
contributed to it landing in spam previously. The text part is ready for the day
sending moves to a real provider; it is not an omission.

---

## expiry_reminder.html — sample render, not wired to anything

There is no scheduler and no sender. This is a preview of what the template
produces, rendered with the mockup's own example values so it can be compared
side by side with `docs/design/moxie_email_templates.html`.

Subject line it would use:

    Insurance expires in 30 days — Second Wind

Nothing in the application may promise reminders until sending exists. This
template existing is not permission to reference it in app copy.

---

## Files

| File | What it is |
|---|---|
| `supabase_password_reset.html` | Paste into Supabase. Pure HTML. |
| `password_reset.txt` | Plain-text alternative. Nowhere to paste it yet. |
| `expiry_reminder.html` | Sample render. Not wired to anything. |
| `expiry_reminder.txt` | Plain-text alternative for the same. |
