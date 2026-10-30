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
  (`app/migrations/`). R2 keeps the project JSON at `projects/<id>.json`
  and its pictures and 3D models at `assets/<id>/<sha-256>.<png|jpg|glb>`.
- **Pictures and 3D models** are assets, as in the editor: the project JSON
  refers to them by hash. Settled on 2026-10-26:
  - They are kept **per project**, not for everyone as Scratch's asset
    server does. Stopping sharing or a moderator's delete removes them
    with the project, and a picture can't be seen through another
    project's link.
  - Sharing or updating answers with the pictures the project uses but
    the share lacks; the editor then uploads each one (with the edit
    key). Only those are accepted, and pictures an update stops using are
    removed. Library pictures ship with the app and are never uploaded.
  - Until the uploads finish the project shows without them; if one
    fails, the editor says so, and updating the share sends it again.
  - "See inside" copies the pictures into the editor's own storage, so
    the remix doesn't depend on the share.
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
project. Changing one also needs the Turnstile check, as sharing does
(section 4). A request with a wrong key gets
"not found", the same as a missing project, so ids can't be probed.

## 4. Safety

- **Nothing about people is stored.** There are no accounts, and the API
  keeps no IP addresses. A report records only its reason.
- **A warning when sharing**, in words for children: anyone with the link can
  see the project, so don't write your real name, where you live, your
  school, or anything else about yourself, and don't use photos of yourself
  or your friends.
- **Links only.** There is no gallery, search or list of shared projects.
- **A person, not a script.** Sharing, changing a share and reporting need a
  [Turnstile](https://developers.cloudflare.com/turnstile/) token, which the
  server checks with Cloudflare before acting. Settled on 2026-10-30:
  changing a share needs it too, so a share can't be changed again and again
  by a script, as a place to keep other files. The visitor's IP address is
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
  notes, picture, every text typed into the project (names, values, text
  in blocks), since text is what usually needs checking, and every picture
  and 3D model uploaded with it, models drawn (the library's are left out). The token is kept
  for the browser tab only.
- **What is accepted.**
  - Titles: up to 80 characters, required.
  - Notes: up to 2,000 characters.
  - Control characters are removed; notes keep their line breaks.
  - Requests: up to 2 MB.
  - The link-preview picture: JPEG only (checked by its first bytes), up
    to 300 KB.
  - The project's pictures and 3D models: PNG, JPEG or binary glTF, named
    by the SHA-256 of their contents (checked), up to 5 MB each and 20 MB
    for a project. Settled on 2026-10-30, so that a file can't be a picture
    with something else (a zip, a program) after it or inside it
    (`app/server/files.ts`):
    - Each is checked through: its parts as the format lays them out, the
      last one right at the end of the file.
    - Pictures are at most 8192 pixels across and down. They may have at
      most 128 KB besides their pixels (color profiles, notes). The pictures
      the editor uploads are re-encoded by the browser, so they have little.
    - A 3D model's JSON must be glTF 2.0. Its binary chunk must be exactly
      its buffer, and any file it refers to must be inside it (a `data:`
      URI), so a model never fetches anything.
    - The link-preview picture is checked as a JPEG the same way.
  - Uploads: a project takes at most 200 in an hour (`UPLOAD_LIMIT`), counted
    in D1, refused ones included. That is enough to share a big project a
    few times over. This limits a project, not a person, so no IP address is
    kept.
- **Files are only what they are.** Pictures and models are served with
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`,
  so a browser never reads one as a page. They also carry
  `Cross-Origin-Resource-Policy: same-origin`, so other sites can't show
  them. The link-preview picture is the exception, since previews show it
  elsewhere.
  - The project must pass the same validation as opening a file, and it is
    stored re-serialized, so unknown fields are dropped.
- **The player shows only shared projects and bundled samples, by id.** It
  never loads a URL from its address, so the site can't be made to show
  content from elsewhere.

## 5. Open questions

To be settled before or at deployment:

- **Limiting requests.** Turnstile stops scripts, but not a person sharing or
  reporting many times. Uploads are limited per project (section 4), not per
  person. A `pages.dev` site has no zone of its own, so
  Cloudflare's WAF rate limiting can't be used. A rate-limiting binding may
  work if Pages Functions support it; limiting by IP address would need care,
  since no personal data is kept.
- **Word filters** for titles and notes, which would need a list per language.
