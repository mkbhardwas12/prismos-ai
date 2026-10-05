# SAP Basis security: Patch Day, Security Audit Log and hardening

As of 2026-10-05. Sources are listed at the end. "Third-party" means no SAP page confirmed the point. "SBT value as published by a third party" means a value credited to the SAP Security Baseline Template by GRC Advisory's transcription of a template updated on 2021-11-16; newer template versions may differ.

## SAP Security Patch Day

- SAP publishes security notes on the second Tuesday of every month, in line with other large vendors (SAP Security Notes and News page). By that rule the next Patch Day after this pack was written is 2026-10-13; that date is computed, not read from SAP.
- How fixes are delivered: for notes rated high or very high, SAP ships fixes for the support packages of the last 24 months, for versions in mainstream or extended maintenance. Low and medium notes get corrections in at least the newest support package. (SAP Security Notes and News page) An SAP Center of Expertise talk calls this the "24 Month Rule for Security Notes" (SAP attack-surface webinar).
- The 2026 Patch Day pages rank notes as Critical, High, Medium and Low. Security firms still call the top tier "HotNews" (CVSS 9.0 to 10.0). (SAP Patch Day pages 2026; third-party: Onapsis, SecurityBridge)
- August 2026 (2026-08-11): 28 new notes and 1 GitHub security advisory, including note 3714806, a memory corruption in AS ABAP and ABAP Platform rated CVSS 9.8 (SAP Patch Day, Aug 2026).
- September 2026 (2026-09-08): 19 new notes and 1 updated note. Kernel-relevant examples: note 3747649 (CVE-2026-44756), memory corruption in SAP Extended Passport processing, CVSS 10.0, affecting kernels 7.22 to 9.20 and Web Dispatcher 9.16 to 9.20; note 3759472 (CVE-2026-58240), missing authentication check in the message server, CVSS 9.8, kernels 9.16, 9.18, 9.19 and 9.20; note 3781729 (CVE-2026-66768), SAP GUI for Java 8.10, CVSS 9.0. (SAP Patch Day, Sep 2026; Canadian Centre for Cyber Security, Sep 2026 rollup)
- The full list of notes lives in SAP for Me under "All Security Notes".

## Security Audit Log (SAL)

Transactions and programs:

- RSAU_CONFIG configures the log and replaces SM19. RSAU_READ_LOG evaluates it and replaces SM20. A third party says the RSAU_* transactions exist from SAP_BASIS 7.50 SP03. (third-party: saptechnicalguru, Aglea, RZ10.de)
- RSAU_ADMIN reorganizes log files, creates the HMAC key and checks file integrity; program RSAU_FILE_ADMIN runs the integrity check in batch. RSAU_CONFIG_SHOW shows the settings, RSAU_READ_LOG_ADM shows the log anonymized (SAP Note 2883981), and SE92 maintains the message definitions. (third-party: saptechnicalguru)
- The log can be kept in the database. Archiving object BC_SAL (transaction SARA) uses RSAU_ARCHIVE_WRITE, RSAU_ARCHIVE_DELETE, RSAU_ARCHIVE_READ and RSAU_ARCHIVE_RELOAD; RSAU_LOAD_FILES loads files into the database (SAP Note 3055825). (third-party: saptechnicalguru)
- SAP Notes by title as quoted by third parties: 539404 (SAL FAQ for older releases), 2191612 (SAL FAQ as of NetWeaver 7.50), 2033317 (integrity protection format), 2883981 (anonymized display), 2122578 (new SAL event for unencrypted GUI and RFC connections).

Profile parameters:

| Parameter | What it does | Default | Recommended |
|---|---|---|---|
| rsau/enable | Switches SAL on for the instance | 0 | 1 (SBT value as published by a third party) |
| rsau/integrity | HMAC-protected audit file format; create the key in RSAU_ADMIN and tick "protection format active" in RSAU_CONFIG | 0 | 1 (SBT value as published by a third party) |
| rsau/log_peer_address | Logs the peer IP address instead of the terminal name | 0 | 1 (SBT value as published by a third party) |
| rsau/user_selection | Exact or generic user matching in filters | 0 | 1 (SBT value as published by a third party) |
| rsau/selection_slots | Number of filter slots | 2 | 10 or more (SBT value as published by a third party) |
| rsau/max_diskspace/local | Maximum local audit file size | 1,000,000 or 2,000,000 bytes, sources differ | at least 1 GB (third-party) |
| snc/log_unencrypted_rfc | Value 2 also logs unencrypted RFC connections as SAL event BUJ; one summary of the same site spells it rsau/log_unencrypted_rfc, so check the name | | 2 to build a worklist, possibly only for a while (third-party) |

Filter practice:

- Microsoft's Sentinel guidance audits all SAL messages in all clients, including 000 and 066 (third-party: Microsoft Learn).
- Layer Seven recommends static filters that log every action of SAP*, logons and transaction starts of DDIC, all severe and critical events in all clients, and selected IDs such as BU4, CUY, DU9, DUI and FU1 (third-party: Layer Seven, 2019).
- If the log fills up, older entries are overwritten and lost (third-party: saptechnicalguru). Size the files and archive them.

Message IDs worth knowing. SAP's own definitions (SE92) could not be read; this list comes from BMC's Defender for SAP documentation of January 2023 (third-party), cross-checked where noted:

- Logons: AU1 dialog logon successful, AU2 dialog logon failed, AU5 RFC/CPIC logon successful, AU6 RFC/CPIC logon failed, AUO logon failed, AUC user logoff.
- Users: AU7 user created, AU8 user deleted, AU9 user locked, AUA user unlocked, AUB authorizations for a user changed, AUD user master record changed (Microsoft also maps AUD and AUB this way), AUM user locked after failed password checks, AUN unlocked after such a lock.
- System and audit: AUE audit configuration changed, AUG application server started, AUH application server stopped, AUI audit slot inactive, AUJ audit activity status changed.
- Transactions, reports and RFC: AU3 transaction started, AU4 transaction start failed, AUK successful RFC call, AUL failed RFC call, AUP transaction locked, AUQ transaction unlocked, AUW report started, AUY download of bytes to a file.
- Debugging: CUK C debugging activated, CUL field content changed in the debugger, CUM jump to the ABAP debugger, CUO explicit commit or rollback from the debugger.
- Other: BU1 password check failed, BU2 password changed, BU4 transport contains security-critical objects, CUZ generic table access by RFC, DU9 generic table access such as SE16N (third-party: saptechnicalguru), BUJ unencrypted GUI or RFC communication (third-party: saptechnicalguru).

## EarlyWatch Alert security checks

SAP's EarlyWatch Alert security workshop (2020) lists checks worth repeating by hand:

- Standard users SAP*, DDIC, SAPCPIC and EARLYWATCH must not keep default passwords in any client; report RSUSR003 checks this. TMSADM is also commonly listed (third-party: WALLSEC).
- Users with critical basis authorizations (SAP_ALL, debug and replace, change all tables), SAP HANA users with DATA ADMIN, and weaknesses in the RFC gateway and message server.

## Profile parameters for hardening

Status of the baseline: SAP's Security Optimization Services page lists Security Baseline Template version 2.5 (2024-04) with its ConfigVal and Dashboard Builder package, described in KBA 2253549. The GitHub link it gives for the Focused Run policies returned 404 on 2026-10-05, and a third party says the current template is 2.6 (July 2025). SAP also publishes white papers on securing RFC (2023-03) and on secure configuration of AS ABAP (2012-01). (SAP Security Optimization Services page; SAP Security Whitepapers page; third-party: saptechnicalguru)

### Passwords and logon

| Parameter | Value | Why |
|---|---|---|
| login/min_password_lng | 8 or more; default 6, maximum 40 | Resists guessing. SBT value as published by a third party, and newer template versions may ask for more; default per SAP Learning |
| login/password_hash_algorithm | encoding=RFC2307, algorithm=iSSHA-512, iterations=15000, saltsize=256 | Strong stored hashes. SBT value as published by a third party |
| login/password_downwards_compatibility | 0 | Stops weak legacy hashes. SBT value as published by a third party |
| login/no_automatic_user_sapstar | 1 (any value above 0 removes SAP*'s built-in emergency logon) | SAP EWA workshop; SAP Learning |
| login/fails_to_user_lock | 5 or less | Locks a user after repeated failed logons. SBT value as published by a third party |
| login/failed_user_auto_unlock | 0 (no unlock at midnight; SAP default since NetWeaver 7.0) | Keeps brute-force lockouts in place. SBT value as published by a third party; default per SAP Learning |
| login/password_history_size | 5 or more (range 1 to 100, standard value 5) | Blocks password reuse. SBT value as published by a third party; range and standard value per SAP Learning |
| login/password_max_idle_initial | 1 to 14 days | Unused initial passwords expire. SBT value as published by a third party |
| login/password_max_idle_productive | 1 to 180 days | Unused productive passwords expire. SBT value as published by a third party |
| login/password_compliance_to_current_policy | 1 | Old passwords must meet the current policy at logon. SBT value as published by a third party |
| login/show_detailed_errors | 0 | Detailed logon errors help user enumeration. SBT value as published by a third party |
| icf/reject_expired_passwd | 1 | No HTTP logon with initial or expired passwords. SBT value as published by a third party |
| rdisp/gui_auto_logout | 2 hours or less | Ends abandoned SAP GUI sessions. SBT value as published by a third party; the transcribed value looks odd, so check the current template |

### Authorizations and RFC

| Parameter | Value | Why |
|---|---|---|
| auth/rfc_authority_check | 1 or 6 as transcribed (default 1); check against the current SBT | Enforces the S_RFC check on remote calls |
| auth/object_disabling_active | N | Stops authorization objects being switched off system-wide |
| rfc/callback_security_method | 3 | Allows RFC callbacks only from an allowlist |
| rfc/selftrust | 0 | No implicit trusted RFC into the same system |
| login/disable_cpic | 1 | Blocks incoming CPIC logons |
| ucon/rfc/active | 1 | Turns on Unified Connectivity runtime checks (third-party: Onapsis, SecurityBridge) |

The first five values are SBT values as published by a third party.

### RFC gateway

| Parameter | Value | Why |
|---|---|---|
| gw/acl_mode | 1 | With 1, secure default rules apply when no reginfo or secinfo file exists; with 0 no access control lists are used (SAP EWA workshop) |
| gw/reg_info, gw/sec_info | Point to maintained files without allow-all entries; maintain in SMGW | reginfo protects registered RFC server programs, secinfo protects started programs; the files do not exist by default (SAP EWA workshop) |
| gw/sim_mode | 0 | In simulation mode the lists only log and do not block (SAP EWA workshop) |
| gw/reg_no_conn_info | All required bits set, at least bits 1 to 4, for example 15, 31 or 255 | Closes known gateway bypasses; EWA flags missing bits (SAP EWA workshop) |
| gw/monitor | 1 | Blocks remote gateway monitor commands. SBT value as published by a third party |
| gw/rem_start | DISABLED or SSH_SHELL | No remote start of programs over a plain remote shell. SBT value as published by a third party |

### Message server

| Parameter | Value | Why |
|---|---|---|
| ms/acl_info | ACL file without catch-all entries such as HOST=* | Only known servers and clients may connect |
| ms/monitor | 0 | No external monitor or administration |
| ms/admin_port | 0 | No message server admin port |

All three are SBT values as published by a third party.

### Encryption

| Parameter | Value | Why |
|---|---|---|
| system/secure_communication | ON | TLS for internal system communication (SBT value as published by a third party) |
| snc/enable | 1 | SNC encryption for SAP GUI and RFC (SBT value as published by a third party) |
| snc/accept_insecure_gui, _rfc, _cpic, _r3int_rfc | 0 | Reject connections without SNC (third-party: Microsoft Learn) |
| ssl/ciphersuites | 135:PFS:HIGH::EC_P256:EC_HIGH | Server TLS cipher choice (SBT value as published by a third party) |
| ssl/client_ciphersuites | 150:PFS:HIGH::EC_P256:EC_HIGH | Client TLS cipher choice (SBT value as published by a third party) |

TLS 1.3 for the ABAP kernel is covered by SAP Notes 3318423, 3346659, 3532801 and 3727660, as cited by a third party (saptechnicalguru, 2026-04-17).

### HTTP, ICM and logging

- is/HTTP/show_detailed_errors = FALSE hides details in HTTP error pages (SBT value as published by a third party).
- rec/client should not be OFF, so Customizing table changes are logged (SBT value as published by a third party).
- On SAP Web Dispatcher, keep the admin interface on a dedicated port that the internet cannot reach (SAP Web Dispatcher webinar, 2024).
- Deactivate ICF services nobody needs. A third party, citing SAP Notes 887164, 1422273 and 1417568 among others, lists /sap/bc/echo, /sap/bc/error, /sap/bc/report, /sap/bc/webrfc, /sap/bc/xrfc, /sap/bc/xrfc_test, /sap/bc/bsp/sap/bsp_veri, /sap/bc/bsp/sap/certmap, /sap/bc/bsp/sap/certreq, /sap/bc/bsp/sap/icf, /sap/bc/srt/IDoc and /sap/bc/idoc_xml. Some, such as /sap/bc/soap/rfc, may still have a business use; check before disabling. (third-party: saptechnicalguru)

## Unified Connectivity (UCON) for RFC

- UCON, available from SAP NetWeaver 7.40, sharply cuts the number of remote-enabled function modules that can be called from outside (SAP UCON overview).
- Activate it with ucon/rfc/active = 1, run a logging phase (90 days by default according to Onapsis), evaluate, then switch to the final phase in which only modules in the default communication assembly can be called. Administer it in transaction UCONCOCKPIT. Failed checks show in SM21. A typical result is that about 95 percent of remote-enabled modules get blocked. (third-party: Onapsis; SecurityBridge)

## SAProuter

- SAProuter is an application-level gateway between the customer network and SAP; its default port is 3299 (SAP SAProuter page).
- The route permission table (saprouttab) is mandatory from SAProuter version 25; SAP's page notes that without a table every connection is allowed. Entries are P (permit) or D (deny), the first matching entry wins, so order matters. (SAP SAProuter configuration page)
- Use the latest SAProuter and CommonCryptoLib for SNC. Certificates from SAP's CA are needed only between SAP's SAProuters and the first SAProuter at the customer site. SAP issues them free from the Support Portal with SHA-256 and 4096-bit keys and reminds the holder 30 days before expiry. (SAP SAProuter pages)

## SAP Web Dispatcher in front of the internet

From SAP's 2024 webinar on secure exposure:

- Place it in a DMZ on hardened Linux. Use identity-provider logon with MFA, client certificates where possible, and IP filters for machine-to-machine traffic.
- Enforce HTTP protocol compliance and allowlist path prefixes.
- Limit connections per client IP, protect against slow-request attacks, throttle requests, and cap concurrent requests per system.
- Pin internet traffic to a dedicated logon group, never expose the admin interface, pass the real client IP on (true-client-ip, x-forwarded-for or the PROXY protocol), and send the security and HTTP logs to a SIEM.
- Standard web application firewall rule sets can break SAP traffic such as OData $batch requests.

## Sources

- SAP Security Notes and News page: https://support.sap.com/en/my-support/knowledge-base/security-notes-news.html
- SAP Security Notes page (SAP for Me list): https://support.sap.com/securitynotes
- SAP Patch Day, Aug 2026: https://support.sap.com/en/my-support/knowledge-base/security-notes-news/august-2026.html
- SAP Patch Day, Sep 2026: https://support.sap.com/en/my-support/knowledge-base/security-notes-news/september-2026.html
- Canadian Centre for Cyber Security, Sep 2026 SAP rollup (AV26-894): https://cyber.gc.ca/en/alerts-advisories/sap-security-advisory-september-2026-monthly-rollup-av26-894
- SAP attack-surface webinar, "How to minimize the attack surface of hybrid SAP landscapes?": https://assets.dm.ux.sap.com/webinars/sap-user-groups-k4u/pdfs/220519_minimize_attack_surface_of_hybrid_sap_s4hana_landscapes.pdf
- SAP EWA workshop, July 2020, "SAP EarlyWatch Alert - Security Workshop": https://assets.dm.ux.sap.com/webinars/sap-user-groups-k4u/pdfs/200721_sap_earlywatch_alert_security.pdf
- SAP Learning, "Maintaining Access Control and User Administration": https://learning.sap.com/courses/exploring-the-authorization-concept-for-sap-s-4hana-and-sap-business-suite/maintaining-access-control-and-user-administration
- SAP Security Optimization Services page: https://support.sap.com/sos
- SAP KBA 2253549 preview, "The SAP Security Baseline Template": https://userapps.support.sap.com/sap/support/knowledge/en/2253549
- SAP Security Whitepapers page: https://support.sap.com/securitywp
- SAP UCON overview: https://www.sap.com/documents/2015/07/ccf7ed8e-5b7c-0010-82c7-eda71af511fa.html
- SAP SAProuter page: https://support.sap.com/en/tools/connectivity-tools/saprouter.html
- SAP SAProuter configuration page: https://support.sap.com/en/tools/connectivity-tools/saprouter/configure.html
- SAP SAProuter install page (SNC): https://support.sap.com/en/tools/connectivity-tools/saprouter/install-saprouter.html
- SAP Web Dispatcher webinar, 2024, "Help, the Internet is coming!": https://assets.dm.ux.sap.com/sap-user-groups/pdfs/241219_help_the_internet_is_coming_sap_web_dispatcher_and_secure_exposure.pdf
- Third-party, GRC Advisory, "SAP Security Parameters Overview": https://grcadvisory.com/en/experts-blog/sap-security-parameters-overview/
- Third-party, Microsoft Learn, monitored SAP security parameters: https://learn.microsoft.com/en-us/azure/sentinel/sap/sap-suspicious-configuration-security-parameters
- Third-party, Microsoft Learn, SAP security content reference: https://learn.microsoft.com/en-us/azure/sentinel/sap/sap-solution-security-content
- Third-party, Microsoft Learn, configure SAP auditing: https://learn.microsoft.com/en-us/azure/sentinel/sap/configure-audit
- Third-party, BMC, "Common SAP Adapter messages and codes" (2023-01-05): https://docs.bmc.com/docs/defasap/62/common-sap-adapter-messages-and-codes-1168618804.html
- Third-party, saptechnicalguru: SAP audit log https://www.saptechnicalguru.com/sap-audit-log/ ; integrity protection https://www.saptechnicalguru.com/?p=14883 ; BC_SAL archiving https://www.saptechnicalguru.com/sap-audit-log-data-archiving-bc_sal/ ; unencrypted GUI and RFC https://www.saptechnicalguru.com/detecting-unencrypted-gui-and-rfc-traffic/ ; SE16N usage https://www.saptechnicalguru.com/?p=6668 ; TLS 1.3 https://www.saptechnicalguru.com/tls-v1-3-setup/ ; SICF services https://www.saptechnicalguru.com/sicf-services-to-be-disabled/
- Third-party, Aglea, "SAP Security Audit Log": https://www.aglea.com/en/blog/sap-security-audit-log-configuration
- Third-party, RZ10.de, "SAP Security Audit Log": https://rz10.de/knowhow/sap-security-audit-log/
- Third-party, Layer Seven Security, "Recommended Settings for SAP Logging and Auditing": https://www.layersevensecurity.com/recommended-settings-for-sap-logging-and-auditing/
- Third-party, WALLSEC, "TOP 5 Security Measures for SAP NetWeaver ABAP": https://www.wallsec.de/blog/top-5-security-measures-for-sap-netweaver-abap
- Third-party, Onapsis, UCON: https://onapsis.com/?p=3246
- Third-party, saptechnicalguru, security baseline template post (states SBT 2.6, July 2025): https://saptechnicalguru.com/2019/02
- Third-party, SecurityBridge, "SAP Security Notes 2025" and September 2026 Patch Day (HotNews naming): https://securitybridge.com/?p=50183 and https://securitybridge.com/?p=54418
- Third-party, Onapsis, March 2026 Patch Day (HotNews naming): https://onapsis.com/blog/sap-security-patch-day-march-2026/
- Third-party, SecurityBridge, UCON (2024-10-10): https://securitybridge.com/blog/unlocking-secure-and-efficient-communications-with-sap-ucon/
