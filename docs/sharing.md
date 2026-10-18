# Sharing

Settled on 2026-10-18. Sharing publishes a project at a link that anyone can
open, including on a phone. The audience is children (see
[design.md](design.md), section 7), and that drives most of the decisions here.

## 1. Architecture

- **Hosting.** Cloudflare Pages serves the built app (`app/dist/`) together
  with Pages Functions (`app/functions/`).
- **API.** `app/server/api.ts` holds the API without a framework; the
  functions only call it. The routes are listed at the top of that file.
- **Storage.** D1 keeps each shared project's metadata: title, notes, the
  hash of its edit key, its status and its report count
  (`app/migrations/`). R2 keeps the project JSON at `projects/<id>.json`.
- **Pages.**
  - `/p/<id>` is the player page. A function adds the project's title and
    link-preview tags (Open Graph) to it; the player then fetches the project
    from the API.
  - The link preview's picture is the stage as it looked when the project
    was shared or last updated: the editor takes it (640 pixels wide, JPEG,
    without the selection outline) and sends it with the project. It is kept
    in R2 at `thumbnails/<id>.jpg`; its URL changes with each update so
    previews don't show an old picture.
  - `/?open=<id>` ("See inside" on the player) opens a shared project in the
    editor, after asking, since it replaces the project being edited.
- **Ids** are 10 random characters from an alphabet without look-alikes
  (no `0`, `1`, `l`, `o`).

## 2. Shared projects' license

Shared projects are under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as the terms
of use say: anyone may view a project, open it with "See inside", change it
and share their version, with credit and under the same license. (Scratch
does the same with CC BY-SA 2.0.) Without accounts, credit is the original's
title and link, which the terms ask remixers to put in their notes.

## 3. Who can change a share

There are no accounts. Sharing returns an **edit key**:

- the sharer's browser keeps it, in a list of the projects shared from that
  browser (`localStorage`);
- the server keeps only its SHA-256 hash.

Changing a share (its title and notes, or its project) or stopping sharing
requires the key, so it is possible only from the browser that shared the
project. A request with a wrong key gets
"not found", the same as a missing project, so ids can't be probed.

## 4. Safety

- **Nothing about people is stored.** There are no accounts, and the API
  keeps no IP addresses. A report records only its reason.
- **A warning when sharing**, in words for children: anyone with the link can
  see the project, so don't write your real name, where you live, your
  school, or anything else about yourself.
- **Links only.** There is no gallery, search or list of shared projects.
- **A person, not a script.** Sharing and reporting need a
  [Turnstile](https://developers.cloudflare.com/turnstile/) token, which the
  server checks with Cloudflare before acting. The visitor's IP address is
  not sent with the check. Until the Turnstile keys are configured
  (`TURNSTILE_SITE_KEY` in `wrangler.toml`, the `TURNSTILE_SECRET` secret),
  sharing and reporting are refused. Cloudflare's script is loaded only when
  the share or report form opens.
- **Reports.** The player has a Report button with four reasons: someone's
  personal information, mean or rude, scary or violent, something else. A
  project with `REPORT_HIDE_THRESHOLD` reports (3, set in `wrangler.toml`) is
  hidden at once, until a moderator restores or deletes it. This errs on the
  side of hiding: one person reporting several times can hide a project.
- **Moderation** uses the admin routes with the `ADMIN_TOKEN` secret: list
  hidden and reported projects with their report reasons, hide, restore
  (which clears the reports) and delete. Without the secret the admin routes
  are closed. The moderation page, `/admin` (not linked from the app, not
  indexed), does this from a browser. For each project it shows the title,
  notes, picture and every text typed into the project (names, values, text
  in blocks), since text is what usually needs checking. The token is kept
  for the browser tab only.
- **What is accepted.**
  - Titles: up to 80 characters, required.
  - Notes: up to 2,000 characters.
  - Control characters are removed; notes keep their line breaks.
  - Requests: up to 2 MB.
  - Pictures: JPEG only (checked by its first bytes), up to 300 KB.
  - The project must pass the same validation as opening a file, and it is
    stored re-serialized, so unknown fields are dropped.
- **The player shows only shared projects and bundled samples, by id.** It
  never loads a URL from its address, so the site can't be made to show
  content from elsewhere.

## 5. Open questions

To be settled before or at deployment:

- **Limiting requests.** Turnstile stops scripts, but not a person sharing or
  reporting many times. A `pages.dev` site has no zone of its own, so
  Cloudflare's WAF rate limiting can't be used. A rate-limiting binding may
  work if Pages Functions support it; limiting by IP address would need care,
  since no personal data is kept.
- **Word filters** for titles and notes, which would need a list per language.
