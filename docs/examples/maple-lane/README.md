# Maple Lane Bakery: two one-line prompts, run offline

Maple Lane Bakery is made up. Its web server's bad night is staged: a 107-line log of
nginx access, auth.log and syslog entries merged in time order, with every IP taken from
the RFC 5737 documentation ranges, so nothing here points at a real host.

| File | What it is |
|---|---|
| [`maple-lane-last-night.txt`](maple-lane-last-night.txt) | The log that was attached in PrismOS |
| [`investigation-report.md`](investigation-report.md) | The report PrismOS saved, unedited |
| [`site/`](site/) | The website PrismOS built from the second prompt, unedited |

Both runs, with a 3D scene from a third line, are in one
[66-second video](../../media/prismos-one-app-three-jobs.mp4).

## Prompt one: what happened?

With the log attached, one line:

> Something happened on our bakery's web server last night. What happened, and what do we do now?

About a minute later on a MacBook with qwen3.8:27b: 13 findings (2 critical, 5 high,
5 medium, 1 low), each mapped to MITRE ATT&CK, a timeline in plain words, what to do in
the next hour, how to rebuild, how to harden, and what to collect next.

PrismOS reads every line itself first (indicators, a timeline, brute-force counts, a
login that followed the guessing, and its detectors). The model only receives that
evidence and writes it up. Indicators come back defanged and secrets masked.

## Prompt two: a new website

> Build a new website for Maple Lane Bakery: menu, opening hours and pickup orders

The App Builder planned the site, wrote [`index.html`](site/index.html),
[`styles.css`](site/styles.css), [`js/data.js`](site/js/data.js) and
[`js/app.js`](site/js/app.js) one at a time, and opened it in the browser. It took about
21 minutes on the same MacBook and model. Open `site/index.html` straight from disk: it
needs no server, makes no network requests, and starts with the content security policy
PrismOS puts on every page it writes (`connect-src 'none'`).

Checked in a headless browser: a menu of 17 items with category and diet filters and an
empty state, opening hours with today highlighted, a map card, six reviews, a twelve-tile
gallery, and a pickup form that flags every missing field and then confirms with a
reference number. No console errors.

## Honest notes

- The first incident run, on an earlier build and an earlier draft of the log, found 11
  problems, not 13. It missed `usermod -aG sudo`, and it missed the cron change: the
  draft's cron line was in a format crontab never writes, and the detector didn't know
  crontab's real `REPLACE` line either. Both detectors are fixed and tested, and three
  log lines a real server would never write (a curl, a crontab change and a chmod) were
  rewritten before the re-runs.
- The model calls the SQL injection that got a 200 a success. The log can't show that:
  the response is exactly the size of the normal menu page. PrismOS's own finding says
  to check whether it worked, and the report's "collect next" list includes the database
  logs that would settle it.
- The website took four tries. The first plan came back with no files; the next two runs
  stopped when `styles.css` ran past the output limit. Plans are now schema-constrained
  with a fallback, and files are written with repetition-resistant sampling and one
  compact retry.
- The pickup form asks for a party size, which no croissant order needs: every food site
  used to get a table-reservation note in its design brief. Fixed on main: a bakery or a
  pickup request now gets an order form.
- The mobile menu never opens on a phone: the button turns into an X, but the stylesheet
  looks for the menu after the button, and the menu sits before it.
- The App Builder's own end-to-end check said `js/app.js` was missing and the menu was
  unwired. Both were wrong: the check skipped files over its size budget. Fixed on main.
- Small slips left as they are: the hero says 16 items while the menu has 17, Chamomile
  Honey Tea is tagged vegan, a review wishes the bakery opened on Sundays (the page says
  seven days a week), and each menu card prints its category and price with no space
  between them (`Pastries$4.50`).
- The party-size and self-check fixes have not been tried on a fresh build of this site
  yet.
