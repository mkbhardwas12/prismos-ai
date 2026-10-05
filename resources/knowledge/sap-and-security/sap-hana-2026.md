# SAP HANA in 2026: releases and operations

As of 2026-10-05. Sources are listed at the end. "Third-party" means no SAP page confirmed the point. Security topics (password policy, users, auditing, encryption, vulnerabilities) are in sap-hana-security.md.

## SAP HANA 2.0 support package stacks

- SAP HANA 2.0 SPS 08 is the newest SPS found. Release announcements date it around 2024-11-20, and an ASUG session with an SAP product manager on 2024-12-04 called it just released (third-party: hanaonpower, ASUG). SAP's own announcement post exists but could not be read.
- SPS 08 revisions seen: revision 85 (SAP Note 3586713, 37 fixes, announced 2025-05-07), revision 88 (announced 2025-10-29; SAP also published an availability notice for SAP HANA, express edition 2.0 SPS 08 revision 88 in November 2025), revision 89.02 and 89.03 (SAP Note 3737608, announced 2026-04-08), and revision 89.05 (2.00.089.05, released 2026-09-15). The SPS 08 revision 80 note is 3531605. (third-party: hanaonpower, hanadba; SAP express edition notice)
- The latest SPS 07 revision listed is 79.11 (released 2026-09-16). The last SPS 05 revision is 59.20 (released 2025-12-03). (third-party: hanadba)
- Version strings follow 2.00.0, then SPS and revision, then a patch number, for example 2.00.059.07. SAP separates SPS revisions from maintenance revisions, which carry only major or critical fixes. (SAP Learning, revision strategy)

## Maintenance windows

- SAP's 2023 revision-strategy slides: SPS 05 was a long-term release with 5.5 years of maintenance ending 2025-12-31; SPS 06 maintenance ended 2023-12-31; SPS 07 is a long-term release maintained through April 2028; from SPS 08 on, a new SPS comes every two years with four years of maintenance each. (SAP slides dated 2023-10-26, hosted by a third party)
- Planned end of maintenance per a third-party table: SPS 05 December 2025, SPS 07 April 2028, SPS 08 November 2028. So in October 2026 the maintained lines are SPS 07 and SPS 08, and SPS 05 is out of maintenance. (third-party: hanadba)
- SAP Learning still describes the older model (one SPS a year, two years of fixes, five years for the last SPS of a major version), which conflicts with the 2023 slides. SAP Note 2378962 is the authoritative source and needs a login.
- SAP HANA 2.0 stays in maintenance as long as SAP business application releases that run on it are in mainstream maintenance (SAP slides, rendering SAP Note 2378962). No end date for HANA 2.0 as a whole, no SPS 09 announcement and no named successor were found.

## SAP HANA Cloud

- A new SAP HANA Cloud version ships every three months, on the last day of each quarter, named "QRC quarter/year". Each version is maintained for seven months; after that SAP upgrades instances still on it at a time SAP chooses. Patches with fixes ship between versions. (SAP KBA 3388475 preview)
- Evidence of recent versions: a Help Portal URL carries version 2025_3_QRC, an SAP Community question mentions an upgrade to version 2026.2.6 in QRC 1/2026, and SAP staff posts titled "What's New in SAP HANA Cloud" exist for December 2025, March 2026, July 2026 and September 2026. Which version was current on 2026-10-05 was not verified.
- Engines named by SAP: relational, document store, geospatial, knowledge graph, vector and time series (SAP HANA Cloud product page).
- The knowledge graph engine stores RDF and is queried with SPARQL from SQL through SPARQL_EXECUTE and SPARQL_TABLE. SAP positions HANA Cloud for VectorRAG, GraphRAG and HybridRAG patterns and shows single SQL queries that mix relational, SPARQL and vector search. (SAP News, 2025-07-16)
- At SAP TechEd in November 2025: Model Context Protocol (MCP) support became generally available so Joule agents can use HANA Cloud's engines; automatic generation of knowledge graphs from HANA Cloud metadata was announced for Q1 2026; an "agentic memory" (long-term memory for AI agents) capability is being added; SAP-RPT-1 and other tabular AI through SAP AI Core can be called from SQL; and SAP Business Data Cloud and HANA Cloud gained two-way data sharing. (SAP News, 2025-11-05 and 2025-11-17)
- In May 2026 SAP called HANA Cloud the AI database for SAP Business Data Cloud, with general availability planned for the second half of 2026 (SAP News, 2026-05-13).

## Architecture

- A system has exactly one system database (SYSTEMDB), which holds the system administration data and knows every tenant. Each tenant has its own users, persistence, backups, traces, logs and catalog. Databases are identified by the system ID (SID) plus the database name. (SAP Learning, installing SAP HANA 2.0)
- From HANA 2.0 SPS 01 on, systems always run in multiple-container mode, and installation creates one tenant by default. Cross-database queries are off by default. (SAP Learning)
- Tenant lifecycle statements run in SYSTEMDB and need DATABASE ADMIN: CREATE DATABASE name SYSTEM USER PASSWORD ..., DROP DATABASE name [DROP BACKUPS], RENAME DATABASE old TO new. ALTER SYSTEM STOP DATABASE and ALTER SYSTEM START DATABASE stop and start a tenant; a tenant stopped on its own must be started on its own. (SAP Learning)
- Services: nameserver (system topology), indexserver (data and engines), compileserver, preprocessor (text analysis), webdispatcher (HTTP into XS classic) and sapstartsrv (starts and stops the others). Optional: xsengine, diserver (HDI) and XS advanced. (SAP Learning)

Ports, with NN the instance number (SAP Learning):

| Database | Internal | SQL | HTTP (XS classic) |
|---|---|---|---|
| System database | 3NN01 | 3NN13 | 3NN14 |
| First tenant | 3NN03 | 3NN15 | 3NN08 |
| More tenants | from 3NN40 to 3NN99, three ports each | | |

The default range allows up to 20 more tenants. SAP's Python client documentation says SAP HANA Cloud listens on port 443 with encryption always on, and that tenants of a multitenant system can be reached through port 3NN13 (PyPI hdbcli 2.30.27).

## Users and tools

- Installation creates the OS user sidadm (written <sid>adm; UID above 999, group sapsys with GID 79), sapadm for the SAP Host Agent when none exists, and <sid>crypt when the Local Secure Store is installed. SYSTEM is the database superuser; a standard installation creates one in SYSTEMDB and one in the tenant. (SAP Learning)
- Start and stop as <sid>adm with HDB or sapcontrol, for example sapcontrol -nr NN -function StopSystem. Stopping or starting services needs SERVICE ADMIN or DATABASE ADMIN. (SAP Learning)
- The SAP HANA cockpit is a browser tool on XS advanced with a cockpit manager and the cockpit; installation creates a fully authorized COCKPIT_ADMIN user. SAP HANA studio is deprecated (SAP Note 2396214). (SAP Learning)
- hdbsql lives in /usr/sap/<SID>/HDB<NN>/exe. Use -U with an hdbuserstore key instead of -p, which SAP advises against for interactive sessions. hdbuserstore SET key host:port@database user password stores a key. (SAP Learning)

## Configuration

- Defaults live in /usr/sap/<SID>/HDB<NN>/exe/config, system-wide custom settings in /usr/sap/<SID>/SYS/global/hdb/custom/config, tenant settings in its DB_<tenant> subfolder, and host settings under /usr/sap/<SID>/HDB<NN>/<host>. The layers are DEFAULT, SYSTEM, DATABASE and HOST. (SAP Learning)
- Changing configuration needs the INIFILE ADMIN privilege. setParameter.py can change values offline or online, and comments on online changes go to M_INIFILE_CONTENT_HISTORY. (SAP Learning)
- SQL changes use ALTER SYSTEM ALTER CONFIGURATION. SAP's audit sample, for example, contains: ALTER SYSTEM ALTER CONFIGURATION ('global.ini', 'system') set ('auditing configuration', 'global_auditing_state') = 'true' with reconfigure; (SAP-samples audit policies)
- .ini files are not part of data backups. Save them separately. (SAP Learning)

## Persistence, logging and backup

- Data and log volumes default to /usr/sap/<SID>/SYS/global/hdb/data and /usr/sap/<SID>/SYS/global/hdb/log. A savepoint writes changed pages to the data area every five minutes by default (savepoint_interval_s), at data backup and at shutdown; ALTER SYSTEM SAVEPOINT triggers one. (SAP Learning)
- log_mode = normal is the default and is required for production: log segments are freed only after they are backed up, point-in-time recovery works, and log backups run automatically when a segment is full or older than 15 minutes. log_mode = overwrite frees segments at savepoints, gives no point-in-time recovery, and is not for production. (SAP Learning, log backups)
- Log backup settings: enable_auto_log_backup (default yes), log_backup_timeout_s (default 900 seconds), log_segment_size_mb (1 GB for the indexserver by default), destination basepath_logbackup. (SAP Learning)
- Backup types: complete data backups, differential backups (changes since the last complete backup), incremental backups (changes since the last complete or delta backup), automatic log backups and storage snapshots. Size estimates come from M_BACKUP_SIZE_ESTIMATIONS. (SAP Learning)
- SYSTEMDB and each tenant keep their own backup catalog, which is backed up after every backup. Views: M_BACKUP_CATALOG, M_BACKUP_CATALOG_FILES, M_BACKUP_PROGRESS. Housekeeping: BACKUP CATALOG DELETE BACKUP_ID id [COMPLETE] and BACKUP CATALOG DELETE ALL BEFORE BACKUP_ID id [WITH FILE]. (SAP Learning)
- Backint is SAP's interface for certified third-party backup tools; Backint backups go to /usr/sap/<SID>/SYS/global/hdb/backint, and multistreaming allows up to 32 channels (parallel_data_backup_backint_channels) for backups above 128 GB. Privileges: BACKUP ADMIN for backup and recovery, BACKUP OPERATOR for backup only. Check tools: hdbbackupcheck, hdbbackupdiag and hdbrecovercheck.py. (SAP Learning)

## System replication and monitoring

- Commands, as documented by SUSE and Microsoft (third-party): hdbnsutil -sr_enable --name=site on the primary; hdbnsutil -sr_register with --remoteHost, --remoteInstance, --replicationMode and --operationMode on the secondary; HDBSettings.sh systemReplicationStatus.py for status.
- Replication modes: sync, syncmem and async. Operation modes: delta_datashipping, logreplay (hot standby) and logreplay_readaccess (read access on the secondary). In multi-tier chains the operation mode must be the same on every tier. Cross-region setups usually need async, which rules out a zero recovery point objective. (third-party: SUSE, Microsoft Learn)
- The statistics service is HANA's built-in monitoring and alerting. Its data lives in schema _SYS_STATISTICS; STATISTICS_ALERTS keeps 42 days by default, and alerts have the priorities Information, Low, Medium and High. (SAP Learning)
- Commonly monitored views include M_SERVICES, M_SERVICE_MEMORY, M_HOST_RESOURCE_UTILIZATION, M_CONNECTIONS, M_DISKS, M_VOLUME_FILES, M_SERVICE_REPLICATION and M_SYSTEM_REPLICATION_TAKEOVER_HISTORY (third-party: SUSE hanadb_exporter).

## Open questions

- SPS 09 and the future of HANA 2.0 as a whole: no SAP statement found.
- The SPS cadence conflict between SAP Learning and the 2023 slides; SAP Note 2378962 decides.
- The latest HANA Cloud version on 2026-10-05, and whether naming or cadence changed in 2026.
- Exact acknowledgement semantics of sync, syncmem and async replication, and the replication ports.

## Sources

- SAP Community post title (not readable), "SAP HANA 2.0 SPS 08 Released: Safeguarding Customer Investments and...": https://community.sap.com/t5/technology-blog-posts-by-sap/sap-hana-2-0-sps-08-released-safeguarding-customer-investments-and/ba-p/13942543
- Help Portal URL seen in search results, version 2025_3_QRC: https://help.sap.com/docs/HANA_CLOUD_DATABASE/c82f8d6a84c147f8b78bf6416dae7290/61662e3032ad4f8dbdb5063a21a7d706.html?locale=en-US&state=PRODUCTION&version=2025_3_QRC
- SAP Community question title, "SAP HANA Cloud Upgrade (Version 2026.2.6 ... QRC 1/2026)": https://community.sap.com/t5/technology-q-a/sap-hana-cloud-upgrade-version-2026-2-6-qrc-1-2026/qaq-p/14366472
- SAP Community post titles, "What's New in SAP HANA Cloud" for December 2025, March 2026, July 2026 and September 2026: https://community.sap.com/t5/technology-blog-posts-by-sap/what-s-new-in-sap-hana-cloud-september-2026/ba-p/14491462 (and the matching earlier posts)
- Third-party, hanaonpower, 2024-11-20, "SAP HANA 2.0 SPS08 has been released!": https://www.hanaonpower.com/2024/11/20/sap-hana-2-0-sps08-has-been-released/
- Third-party, ASUG event, 2024-12-04, SAP HANA 2.0 SPS 08 new features: https://www.asug.com/events/asug-business-technology-platform-btp-community-alliance-presents-sap-hana-2-0-sps-08-new-features
- Third-party, hanaonpower revision posts: https://www.hanaonpower.com/2025/05/07/sap-hana-2-0-sps08-new-revision/ , https://www.hanaonpower.com/?s=SPS08 , https://www.hanaonpower.com/2026/04/08/new-revision-for-sps08-available-89-02/
- SAP availability notice, SAP HANA express edition 2.0 SPS 08 revision 88: https://www.sap.com/documents/2023/12/242fc18e-9c7e-0010-bca6-c68f7e60039b.html
- Third-party, hanadba, "HANA Latest Release": https://www.hanadba.com/hana-latest-release
- SAP slides, "SAP HANA 2.0 Revision and Maintenance Strategy" (2023-10-26), third-party host: https://masteringsap.com/wp-content/uploads/2023/11/SAP-HANA-2.0-Revision-and-Maintenance-Strategy.pdf
- SAP Learning, "Explaining the Revision Strategy of SAP HANA": https://learning.sap.com/courses/sap-hana-installation-and-administration/explaining-the-revision-strategy-of-sap-hana_a1629561-794e-435f-b583-4a07ad64f2bd
- SAP KBA 3388475 preview, "SAP HANA Cloud Release Cycle Customization": https://userapps.support.sap.com/sap/support/knowledge/en/3388475
- SAP HANA Cloud product page: https://www.sap.com/products/data-cloud/hana.html
- SAP News, 2025-07-16, unifying AI workloads in SAP HANA Cloud: https://news.sap.com/2025/07/unifying-ai-workloads-sap-hana-cloud-one-database/
- SAP News, 2025-11-05, SAP Snowflake and data fabric innovations: https://news.sap.com/2025/11/sap-snowflake-new-data-fabric-innovations-sap-bdc-sap-hana-cloud/
- SAP News, 2025-11-17, "Business AI Innovation Unveiled at SAP TechEd": https://news.sap.com/2025/11/business-ai-innovation-unveiled-at-sap-teched/
- SAP News, 2026-05-13, "Accelerate the Autonomous Enterprise with SAP Business Data Cloud": https://news.sap.com/2026/05/sap-bdc-accelerate-autonomous-enterprise/
- SAP Learning course "SAP HANA - Installation and Administration" (lessons on installing, tenants, starting and stopping, services, advanced installation options, configuration parameters, persistence, log backups, backup and recovery, data backups, additional backup topics, alerts, administration tools, hdbsql): https://learning.sap.com/courses/sap-hana-installation-and-administration
- PyPI, hdbcli 2.30.27 (2026-09-18): https://pypi.org/project/hdbcli/
- SAP-samples, s4hana-hana-audit-policies: https://github.com/SAP-samples/s4hana-hana-audit-policies
- Third-party, SUSE, SAP HANA System Replication scale-up guide: https://documentation.suse.com/sbp/sap-15/html/SLES4SAP-hana-sr-guide-PerfOpt-15/index.html
- Third-party, Microsoft Learn, SAP HANA high availability and availability across regions: https://learn.microsoft.com/en-us/azure/sap/workloads/sap-hana-high-availability and https://learn.microsoft.com/en-us/azure/sap/workloads/sap-hana-availability-across-regions
- Third-party, SUSE hanadb_exporter metrics: https://raw.githubusercontent.com/SUSE/hanadb_exporter/master/metrics.json
