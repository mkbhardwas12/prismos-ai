# What PrismOS checks in SAP profiles, SAP HANA configuration and SAP logs

As of 2026-10-05 (PrismOS 0.7.0). This describes the offline security lane in src/lib/securityLane.ts. Everything runs on the computer; nothing is uploaded. The checks are deterministic pattern rules, and the local model only explains and prioritises what they found. A clean result means these rules found nothing, not that a system is secure.

## How to use it

- Attach an SAP instance profile (for example DEFAULT.PFL or a file named like PRD_D00_host), a SAP HANA global.ini, indexserver.ini or nameserver.ini, or a log export, and ask PrismOS to review or harden it. Logs go to the investigation mode, configuration files to the hardening review. A file counts as an SAP profile when it ends in .pfl, or when its name has the SID_INSTANCE_host shape and it sets at least one SAP parameter; a .ini file counts as SAP HANA configuration only when it has a HANA section or key.
- Several configuration files attached together are reviewed one by one, each with its own findings.
- Ask "how do I harden SAP", "harden SAP HANA" or "SAP BTP security checklist" without a file to get a hardening plan built from PrismOS's built-in SAP, SAP HANA and BTP checklists.
- Several files can be attached at once. Ask to "compare these and cite them" to get a cited comparison from the research lane instead.

## SAP instance profile checks

PrismOS reads profile parameters (the last value of a parameter wins) and reports each finding with the line, why it matters and the exact line to put in the profile.

| Finding | Triggered when |
|---|---|
| Short passwords allowed (high) | login/min_password_lng below 8 (missing: see below) |
| SAP* can log on with its built-in password (high) | login/no_automatic_user_sapstar = 0 |
| Many wrong passwords before a lock (medium) | login/fails_to_user_lock above 5 |
| Locked users unlock themselves at midnight (medium) | login/failed_user_auto_unlock = 1 |
| Weak legacy password hashes kept (medium) | login/password_downwards_compatibility above 0 |
| Password hashes weaker than iSSHA-512 (medium) | login/password_hash_algorithm without iSSHA-512 |
| Logon errors reveal which users exist (low) | login/show_detailed_errors = 1 |
| Incoming CPIC logons allowed (low) | login/disable_cpic = 0 |
| SAP GUI sessions stay open too long (low) | rdisp/gui_auto_logout = 0 or above 7200 seconds |
| RFC calls skip the authorization check (high) | auth/rfc_authority_check = 0 |
| Authorization checks can be switched off system-wide (medium) | auth/object_disabling_active = Y |
| RFC callbacks not limited to an allow-list (medium) | rfc/callback_security_method below 3 |
| Implicit trusted RFC to the same system (medium) | rfc/selftrust = 1 |
| RFC gateway accepts any external program (high) | gw/acl_mode = 0 |
| Gateway ACLs only log, they don't block (high) | gw/sim_mode = 1 |
| Gateway security bits missing (medium) | gw/reg_no_conn_info without bits 1 to 4 |
| Gateway can be administered remotely (medium) | gw/monitor = 2 |
| Message server accepts external administration (medium) | ms/monitor = 1 |
| Message server admin port open (medium) | ms/admin_port set to a port number |
| Security Audit Log is off (high) | rsau/enable = 0 (missing: see below) |
| Audit files not integrity-protected (low) | SAL on but rsau/integrity not 1 |
| Audit entries miss the client IP address (low) | SAL on but rsau/log_peer_address not 1 |
| Internal system communication not encrypted (medium) | system/secure_communication = OFF |
| SNC encryption not enabled (low) | snc/enable = 0 (missing: see below) |
| Detailed HTTP error pages (low) | is/HTTP/show_detailed_errors = TRUE |
| HTTP logons work with expired passwords (low) | icf/reject_expired_passwd = 0 |
| RFC calls not limited by UCON (low) | ucon/rfc/active = 0 |

A parameter missing from the file (login/min_password_lng, rsau/enable, snc/enable) counts at full severity only in DEFAULT.PFL, where the SAP default then applies. In any other profile it is a low-severity hint to check DEFAULT.PFL or RZ11, because instance profiles usually leave those settings to DEFAULT.PFL.

The recommended values follow sap-basis-security.md; several of them are Security Baseline Template values as published by a third party, so compare them with your own baseline.

## SAP HANA .ini checks

| Finding | Triggered when |
|---|---|
| Auditing is off (high) | [auditing configuration] global_auditing_state = false |
| CSV audit trail in use (medium) | an *_audit_trail_type set to CSVTEXTFILE |
| Short passwords allowed (high) | [password policy] minimal_password_length below 8 |
| Many wrong passwords before a lock (medium) | maximum_invalid_connect_attempts above 6 |
| Locked users unlock immediately (medium) | password_lock_time = 0 |
| Initial passwords never have to change (medium) | force_first_password_change = false |
| Old passwords can be reused soon (low) | last_used_passwords below 5 |
| SYSTEM can never be locked (medium) | password_lock_for_system_user = false |
| No point-in-time recovery (high) | [persistence] log_mode = overwrite |
| Automatic log backups are off (high) | enable_auto_log_backup = no |

## SAP and SAP HANA log detectors

These run on every line of an attached log, next to the general detectors for Linux, Windows and web servers. Each finding carries its MITRE ATT&CK v19 technique where one fits.

| Detector | What it matches | ATT&CK |
|---|---|---|
| Request to Visual Composer's metadata uploader (critical) | /developmentserver/metadatauploader (CVE-2025-31324, Notes 3594142 and 3604119) | T1190 |
| Possible web shell in the portal (critical) | JSP names and paths reported in the 2025 intrusions, /irj/*.jsp?cmd=, and any .jsp, .java or .class file path under servlet_jsp/irj/root, work or work/sync | T1505.003 |
| SAP secure storage files read or copied (high) | commands touching SecStore.properties, SecStore.key or global/security/rsecssfs | T1552.001 |
| Database user created (high) | CREATE USER or CREATE RESTRICTED USER with a password or identity, or a HANA audit entry for CREATE USER | T1136 |
| SAP HANA SYSTEM user reactivated (high) | ALTER USER SYSTEM ACTIVATE USER NOW (Note 2493657) | T1078 |
| Powerful database privilege granted (high) | GRANT of USER ADMIN, ROLE ADMIN, DATA ADMIN, INIFILE ADMIN, AUDIT ADMIN, AUDIT OPERATOR, DATABASE ADMIN, TRUST ADMIN or CREDENTIAL ADMIN | T1098 |
| Database auditing turned off, disabled or cleared (high) | global_auditing_state = false, ALTER AUDIT POLICY ... DISABLE, DROP AUDIT POLICY, ALTER SYSTEM CLEAR AUDIT LOG | T1685 |
| Database encryption turned off (high) | ALTER SYSTEM PERSISTENCE or LOG ENCRYPTION OFF | T1685 |
| Backups deleted from the backup catalog (medium) | BACKUP CATALOG DELETE | T1490 |
| SAP user created (high) | Security Audit Log AU7 | T1136 |
| SAP user's authorizations changed (high) | Security Audit Log AUB | T1098 |
| SAP audit configuration changed (high) | Security Audit Log AUE | T1685 |
| ABAP debugger used to change values, or C debugging on (high) | Security Audit Log CUL or CUK | none |
| SAP user locked after failed passwords (medium) | Security Audit Log AUM | T1110.001 |
| Generic table access (low) | Security Audit Log DU9 or CUZ | T1213 |

Passwords inside SQL statements (CREATE or ALTER USER ... PASSWORD, IDENTIFIED BY, BACKUP PASSWORD) are masked before anything reaches the model or the saved report. Ordinary log text such as "Failed password for root" stays readable.

## Limits

- The checks read one file at a time; they do not log on to SAP, read the database or call SAP APIs.
- A profile parameter set in another profile (DEFAULT.PFL versus the instance profile) can override what one file shows; review both.
- Security Audit Log message texts differ by release and language; the detectors match the message ID next to an English keyword.
- Patch levels are not checked. Compare kernel and component versions with the current SAP Patch Day notes yourself.

## Sources

- PrismOS source: src/lib/securityLane.ts (SAP_PROFILE_RULES, checkHanaIni, SAP_DETECTORS, maskSecrets) and its tests in src/test/securityLane.test.ts.
- Background for the recommended values: sap-basis-security.md and sap-hana-security.md in this pack.
