# SAP HANA security: users, password policy, auditing, encryption and vulnerabilities

As of 2026-10-05. Sources are listed at the end. "Third-party" means no SAP page confirmed the point. SAP's HANA Security Guide and Security Checklist on the Help Portal could not be read, so this document relies on SAP Learning, SAP's published audit-policy samples, SAP Patch Day pages and NVD.

## Password policy

- The password policy lives in section [password policy] of indexserver.ini for a tenant and nameserver.ini for the system database. Changing it needs INIFILE ADMIN. The effective values show in the view M_PASSWORD_POLICY, and a blocklist table _SYS_PASSWORD_BLACKLIST sits in schema _SYS_SECURITY. (SAP Learning, authentication and authorization; third-party: Centiq)
- password_lock_for_system_user decides whether the SYSTEM user can be locked (SAP Learning, managing users).

| Key | Default | Source |
|---|---|---|
| minimal_password_length | 8 (allowed 6 to 64) | third-party (hanadba blog, 2016) |
| force_first_password_change | true | third-party (hanadba blog, 2016) |
| last_used_passwords | 5 | third-party (hanadba blog 2016, sapbi.blog 2018) |
| maximum_invalid_connect_attempts | 6 | SAP Learning |
| password_lock_time | 1440 minutes; -1 locks without end, 0 unlocks at once | third-party default; SAP Learning for the meaning of -1 and 0 |
| maximum_password_lifetime | 182 days | third-party (sapbi.blog, 2018) |
| password_layout | upper case, lower case and a digit required | third-party (sapbi.blog, 2018) |

Most defaults in this table come from blogs written between 2016 and 2018; check M_PASSWORD_POLICY on your own system. A consultancy suggested tighter values such as a minimum length of 10, a lifetime of 30 days, 7 remembered passwords and 5 failed attempts before lock (third-party: Centiq, 2018); that is advice, not SAP guidance.

## Users, SYSTEM and privileges

- After installation, deactivate the SYSTEM user in SYSTEMDB and in every tenant (SAP Note 2493657) and give administrators named accounts. Do not use SYSTEM for daily work in production. (SAP Learning, post-installation steps and managing users)
- SQL: ALTER USER SYSTEM DEACTIVATE USER NOW deactivates it; ALTER USER SYSTEM ACTIVATE USER NOW turns it back on. Seeing the second statement outside a planned break-glass event is worth an alert. (SAP Learning, managing users)
- User types: standard users; restricted users (CREATE RESTRICTED USER), which start with no privileges, cannot create objects in their own schema, do not get the PUBLIC role and connect over HTTP or HTTPS by default; and technical users. CREATE USER name PASSWORD ... NO FORCE_FIRST_PASSWORD_CHANGE skips the forced first change. (SAP Learning, managing users)
- Authentication methods are set in global.ini, [authentication] authentication_methods. The default list is password, kerberos, spnego, saml, saplogon, x509xs and sessioncookie; JWT and LDAP are also supported. (SAP Learning)
- Powerful system privileges to give to few people: USER ADMIN (create, change and drop users), ROLE ADMIN (create, drop, grant and revoke roles), DATA ADMIN (unfiltered read of all system and monitoring views plus every DDL statement), CATALOG READ, and IMPORT and EXPORT (SAP Learning, privileges and roles). Also INIFILE ADMIN for configuration changes and DATABASE ADMIN for tenant management (SAP Learning, configuration and tenant lessons), and AUDIT ADMIN, AUDIT OPERATOR and AUDIT READ for the audit log, where only AUDIT OPERATOR can truncate the audit table (SAP Learning, auditing lessons).
- SAP_INTERNAL_HANA_SUPPORT gives read access to metadata, system status and statistics data. It cannot be granted to SYSTEM or to other roles, is limited to one user by default, and is reset to its default privileges at every upgrade. Design-time roles can be transported between systems; catalog roles are created at runtime and behave like SQL objects with an owner. (SAP Learning, privileges and roles)
- SAP's EarlyWatch Alert flags HANA users with DATA ADMIN (SAP EWA security workshop, 2020).
- A consultancy query lists holders of sensitive privileges from EFFECTIVE_PRIVILEGE_GRANTEES, filtered for INIFILE ADMIN, AUDIT OPERATOR, ROLE ADMIN, USER ADMIN and DATA ADMIN and excluding SYSTEM and _SYS_REPO (third-party: sapbi.blog, 2018).

## Auditing

Turning it on:

- Set global_auditing_state to true in section [auditing configuration]. SAP's sample sets it in nameserver.ini and global.ini with WITH RECONFIGURE. Auditing is off by default (stated by SAP Learning for SAP HANA Cloud). (SAP-samples audit policies; SAP Learning, auditing in SAP HANA Cloud)
- Audit trail targets: the internal database table (fast to query), Linux syslog (the database administrator cannot read or change it) and a CSV file (testing only, not production). Trail targets are set in SYSTEMDB and cannot be changed later in a tenant; the tenant default is the internal table. (SAP Learning, setting up auditing)
- Vendor documentation names the parameters default_audit_trail_type (SYSLOGPROTOCOL, CSTABLE or CSVTEXTFILE) and critical_audit_trail_type; the CSV trail writes files named *.audit_trail.csv in the trace directory (third-party: NXLog, IBM Guardium).
- minimal_retention_period sets a global minimum retention; a policy with a shorter retention fails. Table retention per policy has a minimum default of 7 days, alert check 64 watches the memory used by the table-based audit log, and ALTER SYSTEM CLEAR AUDIT LOG ALL empties the table. (SAP-samples; SAP Learning)
- Always audited, even with no policy: creating, changing, enabling, disabling or deleting audit policies; deleting audit entries; and changing the audit configuration, including turning auditing on or off and changing trail targets. (SAP Learning, setting up auditing and auditing in SAP HANA Cloud)
- Reading the audit log needs AUDIT ADMIN, AUDIT OPERATOR or AUDIT READ (SAP Learning, auditing in SAP HANA Cloud).

SAP's baseline policies. SAP publishes "mandatory" HANA audit policies as SAP samples; they are the defaults for new S/4HANA 2021, 2022 and 2023 and BW/4HANA 2021 or later tenants, and SAP Note 3016478 has the details (SAP-samples audit policies):

| Policy | Audits | Level | Retention days |
|---|---|---|---|
| _SAP_session connect | unsuccessful CONNECT | ALERT | 20 |
| _SAP_session validate | all VALIDATE USER | ALERT | 20 |
| _SAP_authorizations | all GRANT ANY and REVOKE ANY | INFO | 180 |
| _SAP_user administration | successful create, alter and drop of roles, users and user groups | INFO | 180 |
| _SAP_structured privileges | successful structured privilege changes | INFO | 180 |
| _SAP_certificates | all PSE and certificate changes | INFO | 180 |
| _SAP_authentication provider | all JWT, LDAP and SAML provider changes | CRITICAL | 180 |
| _SAP_clientside encryption | all client-side encryption key changes | CRITICAL | 180 |
| _SAP_designtime privileges | successful runs of the _SYS_REPO GRANT and REVOKE procedures | INFO | 180 |
| _SAP_configuration changes | all STOP SERVICE and SYSTEM CONFIGURATION CHANGE | INFO | 180 |
| _SAP_license addition, _SAP_license deletion | SET and UNSET SYSTEM LICENSE | INFO | 180 |
| _SAP_recover database | BACKUP CATALOG DELETE, BACKUP DATA, RECOVER DATA | INFO | 180 |

Every policy uses TRAIL TYPE TABLE and is switched on with ALTER AUDIT POLICY "name" ENABLE. The same repository ships recommended _SAPS4_ policies and optional _SAPS4_Opt_ policies. (SAP-samples audit policies)

Reading syslog or CSV audit records: fields are separated by semicolons. Google's SecOps parser maps column 1 to the event timestamp, 2 service, 3 host, 4 SID, 5 instance, 6 port, 7 database, 8 client IP, 9 client name, 12 policy name, 13 audit level, 14 audit action, 15 session user, 16 target schema, 17 target object, 22 action status, 29 executed statement, 30 session id and 31 application user. Syslog headers carry process names such as HDB_SYSTEMDB or HDB_TENANTDB. (third-party: Google Cloud SecOps mapping, NXLog)

## Encryption and root keys

- Data volume encryption uses AES-256-CBC at page level with 256-bit page keys, which the data volume root key encrypts: ALTER SYSTEM PERSISTENCE ENCRYPTION ON or OFF. Redo log encryption also uses AES-256-CBC: ALTER SYSTEM LOG ENCRYPTION ON or OFF. Backup encryption covers data, delta and log backups. (SAP Learning, describing encryption)
- SAP Learning says data, log and backup encryption are set by default during installation. Whether that holds for every installation path and for upgraded systems was not verified, so check M_ENCRYPTION_OVERVIEW (third-party: SAP PRESS).
- Root keys for data volume, redo log, backup and application encryption are generated at installation and kept in the instance SSFS by default, or in the Local Secure Store run by <sid>crypt. Change the SSFS master key with rsecssfx as <sid>adm while the system is stopped, and do it promptly on pre-installed systems. (SAP Learning)
- Back up the root keys: set a backup password first (ALTER SYSTEM SET ENCRYPTION ROOT KEYS BACKUP PASSWORD), then back them up, for example with hdbnsutil -backupRootKeys; validate with hdbnsutil -validateRootKeysBackup. SAP says to always back up all root keys, because losing them can make the database unrecoverable. New log, backup and application root keys must be backed up before activation. (SAP Learning; third-party: SAP PRESS, Commvault)
- CommonCryptoLib (libsapcrypto.so) is the default crypto library; OpenSSL is an alternative, and some features need CommonCryptoLib. Database traces are not encrypted, so keep extended tracing short. (SAP Learning)

## Statements and events worth an alert

These pairs follow from the SAP sources above. The PrismOS security lane flags most of them in logs (see prismos-sap-checks.md).

| Action | What to look for |
|---|---|
| New account | CREATE USER or CREATE RESTRICTED USER, especially with NO FORCE_FIRST_PASSWORD_CHANGE |
| SYSTEM reactivated | ALTER USER SYSTEM ACTIVATE USER NOW |
| Lockout cleared or password made permanent | ALTER USER ... RESET CONNECT ATTEMPTS, ALTER USER ... DISABLE PASSWORD LIFETIME |
| Privilege escalation | grants of USER ADMIN, ROLE ADMIN, DATA ADMIN, INIFILE ADMIN, AUDIT ADMIN, AUDIT OPERATOR or DATABASE ADMIN |
| Auditing turned off | global_auditing_state set to false; SYSTEM CONFIGURATION CHANGE audit events (policy _SAP_configuration changes); changes to the audit configuration are always audited |
| Audit trail wiped or policy disabled | ALTER SYSTEM CLEAR AUDIT LOG; disabling or dropping an audit policy (always audited) |
| Password policy weakened | changes to the [password policy] keys in indexserver.ini or nameserver.ini (SYSTEM CONFIGURATION CHANGE audit events) |
| Encryption removed | ALTER SYSTEM PERSISTENCE ENCRYPTION OFF, ALTER SYSTEM LOG ENCRYPTION OFF |
| Backups destroyed | BACKUP CATALOG DELETE, especially WITH FILE |
| Tenant stopped | ALTER SYSTEM STOP DATABASE |
| Password guessing | repeated unsuccessful CONNECT events (policy _SAP_session connect) |

## SAP HANA vulnerabilities, 2024 to 2026

From SAP Patch Day pages, SAP's 2024 and 2025 bulletins and NVD. CVSS values are SAP's CVSS 3.1 scores.

| Patch Day | SAP Note | CVE | CVSS | Component | Issue |
|---|---|---|---|---|---|
| 2024-03-12 | 3410615 | CVE-2023-44487 | 7.5 | HANA XS classic and XS advanced | Denial of service through the HTTP/2 rapid reset weakness |
| 2024-10-08 | 3520100 | CVE-2024-45277 | 4.3 | SAP HANA Node.js client | Prototype pollution; fixed in client 2.21.31 or later |
| 2025-02-11 | 3563929 | CVE-2025-24868 | 7.1 | XS advanced UAA | Open redirect |
| 2025-11-11 | 3639264 | CVE-2025-42885 | 5.8 | SAP HANA 2.0 hdbrss | Missing authentication lets an unauthenticated caller run a remote-enabled function and read information |
| 2025-11-11 | 3643385 | CVE-2025-42895 | 6.9 | SAP HANA JDBC client | Unvalidated connection properties let a high-privilege local user load code |
| 2026-01-13 | 3691059 | CVE-2026-0492 | 8.8 | SAP HANA database | A user with valid credentials can switch to another user, possibly an administrator |
| 2026-04-14 | 3730639 | CVE-2026-34262 | 5.0 | SAP HANA cockpit and database explorer | With mutual TLS configured, users can fetch the server's X.509 certificate and private key; fixed in cockpit 2.18.2; rotate exposed keys |
| 2026-05-12 | 3726962 | CVE-2026-40131 | 3.4 | HDI deploy library @sap/hdi-deploy | SQL injection by high-privileged users |
| 2026-07-14 | 3732522 | CVE-2026-44753 | 3.7 | HANA XS classic User Self Service | Different responses allow enumeration of users and email addresses |

- CVE-2026-0492: SecurityBridge reports that only SPS 07 and SPS 08 are affected and that there is no workaround, only the patch; hanaonpower reports the fix in SPS 07 revision 79.07 and SPS 08 revision 88. Confirm both in SAP Note 3691059. (third-party: SecurityBridge, Onapsis, hanaonpower)
- CVE-2026-34262 was found by SEC Consult (third-party: Full Disclosure, 2026-04-15).
- Related: SAP Note 3412456 (CVE-2023-49583, CVSS 9.1, January 2024) covers privilege escalation in apps built with Business Application Studio, Web IDE Full-Stack and Web IDE for SAP HANA through Node.js @sap/xssec below 3.6.0. SAP Note 3633049 (CVE-2025-42940, CVSS 7.5, November 2025) covers pre-authentication memory corruption in CommonCryptoLib, the default HANA crypto library; one security firm does not list HANA as affected, so check the note. SAP Note 3677544 (CVE-2025-42877, CVSS 7.5, December 2025) covers memory corruption in Web Dispatcher, ICM and Content Server, with XS advanced runtime among the affected versions. (NVD; SAP bulletins; third-party: SecurityBridge)
- No HANA-specific notes were found on the Patch Days of February, March, June, August and September 2026.

## Open questions

- Several password-policy defaults come from 2016 to 2018 blogs.
- Where global_auditing_state must be set (global.ini or nameserver.ini); SAP's sample sets both.
- The exact SQL for backup encryption differs between sources; check the SQL reference.
- The on-premise TLS enforcement parameter could not be verified.

## Sources

- SAP Learning course "SAP HANA - Installation and Administration": lessons "Describing SAP HANA Authentication and Authorization", "Managing Users", "Describing SAP HANA Privileges and Roles", "Illustrating Post-Installation Steps", "Setting Up Auditing", "Describing Encryption", "Illustrating the SAP HANA Security Functions": https://learning.sap.com/courses/sap-hana-installation-and-administration
- SAP Learning, "Auditing in SAP HANA Cloud": https://learning.sap.com/learning-journeys/provision-and-administer-databases-in-sap-hana-cloud/auditing-in-sap-hana-cloud_a6522675-08c8-45ac-801d-a2f7afe00550
- SAP-samples, s4hana-hana-audit-policies, README and 1_hana_audit_policy_mandatory.sql: https://github.com/SAP-samples/s4hana-hana-audit-policies
- SAP EWA security workshop, July 2020: https://assets.dm.ux.sap.com/webinars/sap-user-groups-k4u/pdfs/200721_sap_earlywatch_alert_security.pdf
- SAP Patch Day pages (January 2024, March 2024, October 2024, January 2026, April 2026, May 2026, July 2026): https://support.sap.com/en/my-support/knowledge-base/security-notes-news/ followed by month-year.html
- SAP Patch Day bulletins 2024 and 2025: https://support.sap.com/en/my-support/knowledge-base/security-notes-news/bulletin-2024.html and https://support.sap.com/en/my-support/knowledge-base/security-notes-news/bulletin-2025.html
- NVD CVE API records for CVE-2026-0492, CVE-2025-42885, CVE-2025-42895, CVE-2026-34262, CVE-2026-40131, CVE-2026-44753, CVE-2025-24868, CVE-2024-45277, CVE-2025-42940, CVE-2025-42877, CVE-2023-49583: https://services.nvd.nist.gov/rest/json/cves/2.0?cveId= followed by the CVE id
- Third-party, hanadba blog, 2016, password policy: http://hanadba.blogspot.com/2016/01/sap-hana-password-policy-configuration.html
- Third-party, sapbi.blog, 2018, "SAP HANA Security. Are you protected?": https://sapbi.blog/2018/11/16/sap-hana-security-are-you-protected/
- Third-party, Centiq, 2018, hardening the HANA password policy: https://www.centiq.co.uk/blog/hardening-sap-hana-password-policy
- Third-party, NXLog SAP integration: https://docs.nxlog.co/integrate/sap.html
- Third-party, IBM Guardium SAP HANA filter plugin: https://uc.guardium.security.ibm.com/docs/filter-plugin/logstash-filter-saphana-guardium/saphanaUsingFilebeatREADME
- Third-party, Google Cloud, SAP HANA audit UDM mapping: https://docs.cloud.google.com/sap/docs/secops/sap-hana-audit-udm-mapping
- Third-party, SAP PRESS, "Learn SAP HANA Data Encryption": https://blog.sap-press.com/learn-sap-hana-data-encryption
- Third-party, Commvault, backing up and recovering encryption keys: https://documentation.commvault.com/11.46/software/backing_up_and_recovering_encryption_keys_on_system_and_tenant_databases.html
- Third-party, SEC Consult via Full Disclosure, 2026-04-15: https://seclists.org/fulldisclosure/2026/Apr/16
- Third-party, SecurityBridge, January 2026 Patch Day: https://securitybridge.com/blog/sap-security-patch-day-january-2026/
- Third-party, Onapsis, January 2026 Patch Day: https://onapsis.com/blog/patch-day-january-2026/
- Third-party, hanaonpower, CVE-2026-0492 post: https://www.hanaonpower.com/2026/01/13/
- Third-party, SecurityBridge advisory for SAP Note 3633049: https://cloud.securitybridge.com/advisory/detail/3633049
