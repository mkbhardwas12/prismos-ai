# SAP threats in 2025 and 2026: exploited and critical vulnerabilities, indicators and Patch Day trends

As of 2026-10-05. Sources are listed at the end. "Third-party" marks news and security-vendor sources. Network indicators are written with [.] and are historical; most are stale. CVSS values are the vendor's (SAP as CNA) unless stated.

## Exploited SAP vulnerabilities to know first

| CVE | SAP Note | CVSS | Component | Exploitation | Fix |
|---|---|---|---|---|---|
| CVE-2025-31324 | 3594142; 3593336 mitigates unpatched systems; KBA 3596125 lists indicators; 2501341 disables Visual Composer | 10.0 (NVD 9.8) | NetWeaver Visual Composer Metadata Uploader, VCFRAMEWORK 7.50 | Exploited as a zero-day before SAP's out-of-band patch of 2025-04-24; NVD shows it in CISA's Known Exploited Vulnerabilities catalog from 2025-04-29 | Note 3594142 |
| CVE-2025-42999 | 3604119 | 9.1 | Visual Composer Metadata Uploader deserialization, VCFRAMEWORK 7.50 | Chained with CVE-2025-31324 since at least early March 2025, according to Onapsis; in the KEV catalog from 2025-05-15 per NVD | Note 3604119 |
| CVE-2025-42957 | 3627998 | 9.9 | S/4HANA (private cloud or on-premise), S4CORE 102 to 108 | SecurityBridge confirmed real abuse (published 2025-09-04), not widespread exploitation | Note 3627998 |
| CVE-2026-58231 | 3771065 | 10.0 | Commerce Cloud Data Hub Adapter, COM_CLOUD 2211 and 2211-JDK21 | Exploitation attempts on honeypots from 2026-08-14, three days after the patch (third-party: Defused via SecurityWeek, KEVIntel via The Hacker News) | Release 2211.55, 2211-jdk21.17 or later |
| CVE-2017-12637 | n/a | NVD 7.5 | NetWeaver AS Java 7.50, directory traversal | An old flaw added to the KEV catalog on 2025-03-19 per NVD | Vendor mitigations |

BleepingComputer reported that CISA had added 14 SAP flaws to the KEV catalog since November 2021, three of them used by ransomware (third-party: BleepingComputer, 2026-09-08).

## Visual Composer (CVE-2025-31324 and CVE-2025-42999)

What happened:

- CVE-2025-31324 is an unauthenticated upload of executable content (CWE-434) to the Visual Composer Metadata Uploader, with CVSS vector AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H (NVD; CVE record).
- Timeline from different responders: reconnaissance seen in January 2025 (Onapsis); test requests in late January and web shells from mid-March 2025 (Unit 42); first exploitation confirmed by incident response on 2025-03-12 (Mandiant, via Help Net Security); compromises reported to Onapsis on March 14 and 31; Rapid7 saw exploitation from at least 2025-03-27; ReliaQuest published on 2025-04-22; SAP patched on 2025-04-24.
- A second wave of other actors reused web shells planted by the first, consistent with an initial access broker (third-party: Help Net Security). On 2025-08-15 a Telegram post by "Scattered Lapsus$ Hunters" shared an exploit chaining CVE-2025-31324 with CVE-2025-42999, and Onapsis tracked follow-on activity by at least four groups until 2025-08-25 (third-party: ReliaQuest, Onapsis).
- Actors named by researchers include UNC5221, UNC5174 and CL-STA-0048 (EclecticIQ, which also found an attacker file listing 581 compromised NetWeaver instances), Chaya_004 (Forescout), and BianLian and RansomEXX operators (ReliaQuest).
- Onapsis estimates that Visual Composer is present on about 50 to 70 percent of SAP Java systems.
- CVE-2025-42999 alone needs a user with the VisualComposer role; chained with CVE-2025-31324 it gives unauthenticated command execution (third-party: Arctic Wolf, quoting Onapsis).

What to look for in HTTP logs (ICM, Web Dispatcher, access logs and defaultTrace):

- POST requests to /developmentserver/metadatauploader; Pathlock's example carries ?CONTENTTYPE=MODEL&CLIENT=1. Bodies are application/octet-stream or multipart.
- GET requests to dropped JSP files that run commands, such as /irj/helper.jsp, /irj/shell.jsp?cmd= or any /irj/*.jsp?cmd= pattern, and paths under /irj/servlet_jsp/irj/work and /irj/servlet_jsp/irj/root.
- No report published a specific User-Agent string.

What to look for on disk (the Java instance):

- Unexpected .jsp, .class or .java files and odd timestamps under j2ee/cluster/apps/sap.com/irj/servlet_jsp/irj/root/, .../irj/work/ and .../irj/work/sync/. On Windows the root folder looks like C:\usr\sap\<SID>\<InstanceID>\j2ee\cluster\apps\sap.com\irj\servlet_jsp\irj\root.
- Web shell names reported: helper.jsp and cache.jsp (many sources); rrx.jsp, rrxx.jsp, rrxx1.jsp, rrr141.jsp and dyceorp.jsp (ReliaQuest); random eight-letter names such as cglswdjp.jsp or ssonkfrd.jsp (Rapid7, Forescout); ran.jsp, usage.jsp and shell.jsp (Unit 42, Onapsis); .webhelper.jsp, forwardsap.jsp, 404_error.jsp and .h.jsp (EclecticIQ).

What to look for on the host:

- The SAP JVM starting cmd.exe /c or /bin/sh -c, and outbound connections from SAP hosts.
- Reconnaissance commands such as cat /etc/hosts, netstat -tenp and whoami.
- Reverse shells over /dev/tcp, reverse SSH and SOCKS tunnels, and downloads with curl, wget or tftp -g.
- Credential hunting: reads of /usr/sap/<SID>/SYS/global/security/data/SecStore.properties and SecStore.key, the rsecssfs directory, cloud credential files, grep for "jdbc:" under /usr/sap, and shell history (Onapsis).
- Tools named in reports: GOREVERSE, Cobalt Strike, KrustyLoader delivering Sliver, SNOWLIGHT, VShell hiding under a name like [kworker/0:2], SuperShell, Brute Ratel injected into dllhost.exe via MSBuild, and PipeMagic (Unit 42, EclecticIQ, Forescout, ReliaQuest).

What to do:

- Apply Note 3594142 and Note 3604119; use Note 3593336 if you cannot patch yet; follow KBA 3596125 for indicators. Check whether VISUAL COMPOSER FRAMEWORK (VCFRAMEWORK) is deployed, for example at /nwa/sysinfo, and disable Visual Composer per Note 2501341 if nobody uses it. Block the uploader path at the Web Dispatcher, ICM or web application firewall and check every Java cluster node. (Onapsis, Rapid7, Pathlock)
- Onapsis and Mandiant released an open-source scanner that checks the vulnerability, known indicators and unknown web-executable files in known exploit paths.

## CVE-2025-42957 and RFC code injection in ABAP

- A user-level attacker calls a function module exposed through RFC and injects arbitrary ABAP code, bypassing authorization checks (CWE-94). SecurityBridge found it, reported it to SAP on 2025-06-27, and SAP fixed it on the August 2025 Patch Day. (NVD; SecurityBridge)
- What an attacker needs: any valid low-privileged account that may call the vulnerable module. SecurityBridge advises restricting authorization object S_DMIS activity 02. Possible impact: OS access, users created with SAP_ALL, database changes, password-hash download and ransomware. (SecurityBridge)
- Watch for suspicious RFC calls, new administrator users, users created with SAP_ALL, unexpected ABAP code changes and password-hash downloads (SecurityBridge). Pathlock adds unusual RFC_PING use, unexpected new ABAP reports, and changes to RFC destinations or trust settings, and names function modules that SAP's public material does not confirm.
- Related notes: 3633838 (CVE-2025-42950, Landscape Transformation) and 3581961 (CVE-2025-27429). Harden with UCON allowlisting of remote-enabled function modules, scoped S_RFC, and rfc/callback_security_method at a secure level. (Pathlock)
- Pattern: many 2025 and 2026 ABAP criticals are code injection through RFC-exposed or remote-enabled function modules (CVE-2025-27429, CVE-2025-31330, CVE-2025-42950, CVE-2025-42957, CVE-2025-42887, CVE-2025-42880, CVE-2026-0491); CVE-2026-0488 abuses a generic function module call to run arbitrary SQL. (CVE records)

## NetWeaver AS Java RMI-P4 (CVE-2025-42944)

- An unauthenticated payload sent to an open P4 port leads to OS command execution (CWE-502), SERVERCORE 7.50, CVSS 10.0. Note 3634501 (September 2025) fixes it; Note 3660659 (October 2025) adds a JVM-wide jdk.serialFilter block list. No exploitation was reported. (CVE record; SecurityBridge; Onapsis)
- P4 listens on 5NN04, P4 over HTTP on 5NN05 and P4 over SSL on 5NN06 (third-party: runZero). Let only trusted SAP systems reach these ports; filter P4 at the ICM level or the firewall.

## Commerce Cloud (CVE-2026-58231)

- An unauthenticated attacker abuses a default authentication client of the Data Hub Adapter and sends crafted input, leading to code execution (CWE-94) (NVD).
- Honeypot attempts started on 2026-08-14, before any public proof of concept. Shadowserver counted more than 4,200 Commerce Cloud instances exposed to the internet. An interim workaround is an IP filter set that restricts the vulnerable endpoint. (third-party: SecurityWeek, The Hacker News, BleepingComputer, Cloud Security Alliance)
- One vulnerability database attributes exploitation to Lazarus Group, but no primary report confirms it.

## SAP kernel: OVERPASS and S4GET (September 2026)

- CVE-2026-44756 ("OVERPASS"), Note 3747649, CVSS 10.0: memory corruption in Extended Passport (EPP) processing (CWE-120). EPP is a request-tracing feature, and the overflow runs before authentication and authorization checks. Reachable before logon over HTTP(S) through the ICM or Web Dispatcher, over SAP GUI (DIAG) through the dispatcher, and over RFC. It affects ABAP, Java and Web Dispatcher systems. One kernel patch closes all paths, and SAP authorizations do not help. (CVE record; third-party: Field Effect, Onapsis, SecurityBridge)
- CVE-2026-58240 ("S4GET"), Note 3759472, CVSS 9.8: the message server does not properly verify a registering application server component (CWE-308), so an unauthenticated attacker can register a rogue component. SAP lists KERNEL 9.16, 9.18, 9.19 and 9.20. Onapsis says it is reached through the port every SAP GUI client uses, so firewalling it would break logon. (CVE record; SAP Patch Day, Sep 2026; third-party: BleepingComputer quoting Onapsis)
- Onapsis, which named both, estimates more than 10,000 internet-facing IP addresses present an SAP web interface. Onapsis had not seen in-the-wild exploitation as of 2026-09-21, and CERT-EU reported none at publication. Watch for unexpected process crashes, service restarts, OS commands run by SAP service accounts and unusual RFC activity. (third-party: Onapsis, CERT-EU, Field Effect)

## Other critical SAP notes, 2026

| Patch Day | CVE | Note | CVSS | Component |
|---|---|---|---|---|
| 2026-01-13 | CVE-2026-0501 | 3687749 | 9.9 | S/4HANA Financials General Ledger, SQL injection |
| 2026-01-13 | CVE-2026-0500 | 3668679 | 9.6 | Wily Introscope Enterprise Manager, remote code execution through a crafted JNLP file |
| 2026-02-10 | CVE-2026-0488 | 3697099 | 9.9 | CRM and S/4HANA Scripting Editor, arbitrary SQL through a generic function module call |
| 2026-02-10 | CVE-2026-0509 | 3674774 | 9.6 | AS ABAP, background RFC without S_RFC in some cases |
| 2026-03-10 | CVE-2019-17571 | 3698553 | 9.8 | FS-QUO with outdated Log4j 1.2.17 |
| 2026-04-14 | CVE-2026-27681 | 3719353 | 9.9 | BPC and BW, SQL injection |
| 2026-05-12 | CVE-2026-34260 | 3724838 | 9.6 | Enterprise Search for ABAP, SQL injection |
| 2026-06-09 | CVE-2026-44748 | 3746332 | 9.9 | AS ABAP SAML XML signature wrapping |
| 2026-06-09 | CVE-2026-27671 | 3717897 | 9.8 | AS ABAP kernel memory corruption through a crafted RFC request, unauthenticated |
| 2026-07-14 | CVE-2026-44747 | 3747367 | 9.9 | AS ABAP memory corruption, authenticated |
| 2026-08-11 | CVE-2026-34265 | 3714806 | 9.8 | AS ABAP memory corruption in DIAG parsing, unauthenticated |
| 2026-09-08 | CVE-2026-76969 | 3798315 | 9.4 | CAP @sap/cds-mtxs credential disclosure in multitenant apps |
| 2026-09-08 | CVE-2026-66768 | 3781729 | 9.0 | SAP GUI for Java 8.10, trust-level policy not enforced |

Four 2026 criticals are kernel memory corruption: CVE-2026-27671 (RFC), CVE-2026-34265 (DIAG), CVE-2026-44756 (EPP) and CVE-2026-44747. Patch the kernel and Web Dispatcher with the same urgency as ABAP notes. (CVE records)

## Patch Day volume

- SecurityBridge counted 207 SAP security notes in 2025, against 149 in 2024, with 25 HotNews notes including five rated 10.0 (third-party: SecurityBridge, 2025-12-23).
- 2026 by SAP's monthly pages (new notes; notes rated 9.0 or higher): January 17 (4), February 26 plus 1 update (2), March 15 (2), April 19 plus 1 update and 1 note after Patch Day (1, plus Note 3747787 labelled Critical with CVSS 0.0), May 15 (2), June 15 (4), July 16 plus 1 GitHub advisory and 3 updates (4), August 28 plus 1 GitHub advisory (4), September 19 plus 1 update (4).
- Note 3747787 (April 2026) covers the malicious CAP and MTA npm packages; see sap-btp-security.md.

## Sources

- NVD records: CVE-2025-31324, CVE-2025-42999, CVE-2025-42957, CVE-2017-12637, CVE-2026-58231: https://nvd.nist.gov/vuln/detail/ followed by the id
- CVE Program records (2025 and 2026 SAP CVEs named above): https://cveawg.mitre.org/api/cve/ followed by the id
- SAP Patch Day pages, January to September 2026: https://support.sap.com/en/my-support/knowledge-base/security-notes-news/ followed by month-year.html
- Third-party, Onapsis, CVE-2025-31324 and CVE-2025-42999 defense: https://onapsis.com/threat-research/cve-2025-31324/
- Third-party, Onapsis, exploitation after the ShinyHunters release: https://onapsis.com/?p=31562
- Third-party, Onapsis, indicators of compromise scanner: https://onapsis.com/?p=20081
- Third-party, ReliaQuest, 2025-04-22 (updated to 2025-08-15): https://reliaquest.com/blog/threat-spotlight-reliaquest-uncovers-vulnerability-behind-sap-netweaver-compromise/
- Third-party, Rapid7, 2025-04-28: https://rapid7.com/blog/post/2025/04/28/etr-active-exploitation-of-sap-netweaver-visual-composer-cve-2025-31324
- Third-party, Palo Alto Networks Unit 42, threat brief: https://unit42.paloaltonetworks.com/threat-brief-sap-netweaver-cve-2025-31324/
- Third-party, EclecticIQ, 2025-05-13: https://blog.eclecticiq.com/china-nexus-nation-state-actors-exploit-sap-netweaver-cve-2025-31324-to-target-critical-infrastructures
- Third-party, Forescout Vedere Labs, 2025-05-08: https://www.forescout.com/blog/threat-analysis-sap-vulnerability-exploited-in-the-wild-by-chinese-threat-actor
- Third-party, Help Net Security, 2025-05-12: https://www.helpnetsecurity.com/?p=330671
- Third-party, Pathlock, CVE-2025-31324 at scale: https://pathlock.com/blog/security-alerts/cve-2025-31324-in-sap-netweaver-visual-composer-now-exploitable-at-scale/
- Third-party, Arctic Wolf, CVE-2025-42999: https://arcticwolf.com/resources/blog/follow-up-cve-2025-42999/
- Third-party, SecurityBridge, CVE-2025-42957: https://securitybridge.com/blog/critical-sap-s-4hana-code-injection-vulnerability-cve-2025-42957/
- Third-party, Pathlock, CVE-2025-42957: https://pathlock.com/blog/security-alerts/cve-2025-42957-critical-sap-s-4hana-code-injection-vulnerability/
- Third-party, Onapsis, September and October 2025 Patch Day: https://onapsis.com/?p=31573 and https://onapsis.com/?p=31604
- Third-party, SecurityBridge advisory for Note 3634501: https://cloud.securitybridge.com/advisory/detail/3634501
- Third-party, runZero, SAP NetWeaver instances: https://runzero.com/blog/sap-netweaver-instances
- Third-party, The Hacker News, 2026-08-15, CVE-2026-58231: https://thehackernews.com/2026/08/sap-commerce-cloud-cve-2026-58231.html
- Third-party, SecurityWeek, 2026-08-17: https://www.securityweek.com/critical-sap-commerce-cloud-vulnerability-exploited-3-days-after-disclosure/
- Third-party, BleepingComputer, 2026-08-14: https://bleepingcomputer.com/news/security/max-severity-sap-commerce-cloud-flaw-now-targeted-in-attacks
- Third-party, Cloud Security Alliance, 2026-08-16: https://labs.cloudsecurityalliance.org/research/csa-research-note-sap-commerce-cloud-cve-2026-58231-20260816/
- Third-party, Wiz vulnerability database, CVE-2026-58231: https://www.wiz.io/vulnerability-database/cve/cve-2026-58231
- Third-party, SecurityBridge, September 2026 Patch Day: https://securitybridge.com/?p=54418
- CERT-EU Security Advisory 2026-011: https://cert.europa.eu/publications/security-advisories/2026-011/
- Third-party, Onapsis, mitigating OVERPASS: https://onapsis.com/blog/sap-overpass-remediation/
- Third-party, BleepingComputer, 2026-09-08, OVERPASS: https://bleepingcomputer.com/news/security/sap-warns-of-maximum-severity-overpass-kernel-vulnerability
- Third-party, Field Effect, 2026-09-18: https://fieldeffect.com/blog/critical-extended-passport-flaw-impacts-sap-systems
- Third-party, SecurityBridge, "SAP Security Notes 2025": https://securitybridge.com/?p=50183
