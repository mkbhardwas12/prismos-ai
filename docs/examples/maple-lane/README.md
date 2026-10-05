# Maple Lane Bakery: a staged incident, investigated offline

Maple Lane Bakery is made up. Its web server's bad night is staged: 107 lines of
nginx access log, auth.log and syslog merged in time order, with every IP taken from
the RFC 5737 documentation ranges, so nothing here points at a real host.

| File | What it is |
|---|---|
| [`maple-lane-last-night.txt`](maple-lane-last-night.txt) | The log that was attached in PrismOS |
| [`investigation-report.md`](investigation-report.md) | The report PrismOS saved, unedited |

## The prompt

With the log attached, one line:

> Something happened on our bakery's web server last night. What happened, and what do we do now?

## What came back

About a minute later on a MacBook with qwen3.8:27b: 13 findings (2 critical, 5 high,
5 medium, 1 low), each mapped to MITRE ATT&CK, a timeline in plain words, what to do in
the next hour, how to rebuild, how to harden, and what to collect next.

PrismOS reads every line itself first (indicators, a timeline, brute-force counts, a
login that followed the guessing, and its detectors). The model only receives that
evidence and writes it up. Indicators come back defanged and secrets masked.

## Honest notes

- The first run on an earlier build found 11, not 13. It missed `usermod -aG sudo` and
  crontab's own `REPLACE` line; both detectors are fixed and tested.
- The saved report masks `PWD=/home/deploy` in sudo lines as `PWD=/h****`. That over-eager
  mask is fixed on main; this report was produced just before the fix and is left as it was.
- The model treats the SQL injection request that got a 200 as a likely success. That is
  a judgement, and its "collect next" list starts with the database logs that would settle it.
