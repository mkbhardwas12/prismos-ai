# Security landscape 2025 to 2026: ATT&CK v19, exploitation trends, OWASP and AI risk

As of 2026-10-05. Sources are listed at the end. "Third-party" marks news and vendor summaries.

## MITRE ATT&CK versions

| Version | Date | What changed |
|---|---|---|
| v17 | 2025-04-22 | ESXi platform added; Network platform renamed Network Devices; DLL Side-Loading folded into Hijack Execution Flow: DLL. Enterprise: 14 tactics, 211 techniques, 468 sub-techniques |
| v18 | 2025-10-28 | Detections replaced by Detection Strategies and Analytics; Data Sources deprecated; 12 new Enterprise techniques. Enterprise: 216 techniques, 475 sub-techniques, 691 detection strategies, 1,739 analytics |
| v19 | 2026-04-28 | Defense Evasion split into Stealth and Defense Impairment. Enterprise: 15 tactics, 222 techniques, 475 sub-techniques, 697 detection strategies, 1,758 analytics |
| v19.2 | 2026-08-06 (the versions page lists v19.2 as current from 2026-04-28) | First "Agile" release, updating groups and software between the twice-yearly releases. Adds ShinyHunters (G1057), TeamPCP (G1056), Kali365 (S9044), Shai-Hulud (S9008), Mini Shai-Hulud (S9043), CanisterWorm (S9042) and TeamPCP Cloud Stealer (S9041) |

(MITRE ATT&CK versions and update pages)

What v19 means for detection rules:

- TA0005 is now named Stealth, and the new tactic TA0112 Defense Impairment was created on 2026-04-14 (MITRE ATT&CK tactics pages).
- T1685 Disable or Modify Tools sits under Defense Impairment and now also holds Clear Windows Event Logs (T1685.005) and Clear Linux or Mac System Logs (T1685.006). T1070 Indicator Removal stays under Stealth with sub-techniques .003 to .010. (MITRE ATT&CK technique pages)
- A third party reports that T1562, T1562.001 and T1562.006 were merged into T1685 (third-party: Cymulate). Update any rule metadata that still says "Defense Evasion" or T1562.

## ATT&CK techniques seen in SAP intrusions

Names as ATT&CK v19 lists them; the behavior column maps what incident reports described.

| ID | Name | Tactic | SAP behavior reported |
|---|---|---|---|
| T1190 | Exploit Public-Facing Application | Initial Access | Visual Composer uploader exploitation; Commerce Cloud attempts. ATT&CK's own example: FIN13 used SAP NetWeaver exploits |
| T1505.003 | Server Software Component: Web Shell | Persistence | JSP web shells under irj/servlet_jsp/irj/root |
| T1059.004 | Command and Scripting Interpreter: Unix Shell | Execution | SAP JVM spawning /bin/sh -c; bash reverse shells |
| T1059.003 | Command and Scripting Interpreter: Windows Command Shell | Execution | SAP JVM spawning cmd.exe /c |
| T1105 | Ingress Tool Transfer | Command and Control | curl, wget and tftp downloads |
| T1016 | System Network Configuration Discovery | Discovery | cat /etc/hosts |
| T1049 | System Network Connections Discovery | Discovery | netstat -tenp |
| T1552.001 | Unsecured Credentials: Credentials In Files | Credential Access | SecStore files, cloud credentials, JDBC strings, shell history |
| T1572 | Protocol Tunneling | Command and Control | reverse SSH (GOREVERSE), GOST |
| T1090 | Proxy | Command and Control | reverse SSH SOCKS proxy, NPS |
| T1127.001 | Trusted Developer Utilities Proxy Execution: MSBuild | Stealth, Execution | MSBuild compiling Brute Ratel and PipeMagic loaders |
| T1055 | Process Injection | Stealth, Privilege Escalation | Brute Ratel injected into dllhost.exe |
| T1068 | Exploitation for Privilege Escalation | Privilege Escalation | attempted Windows CLFS exploit CVE-2025-29824 |
| T1036 | Masquerading | Stealth | VShell running under a name like [kworker/0:2] |
| T1078 | Valid Accounts | Initial Access, Persistence, Privilege Escalation, Stealth | a low-privileged SAP user is enough for CVE-2025-42957 |
| T1136 | Create Account | Persistence | SAP users created with SAP_ALL |
| T1098 | Account Manipulation | Persistence, Privilege Escalation | privilege grants to existing users (no report names a case) |
| T1213 | Data from Information Repositories | Collection | candidate for ERP data theft (no report names a case); sub-technique T1213.006 Databases exists |

(MITRE ATT&CK technique pages; behaviors from ReliaQuest, Unit 42, Pathlock, Forescout, EclecticIQ, Onapsis and SecurityBridge reports)

## Exploitation trends

- Google Threat Intelligence Group (GTIG, 2026-09-30): 127 vulnerabilities exploited in all of 2025 against 141 from January to August 2026; an average of 10.5 a month in 2025 against 18 a month in 2026; zero-days made up 62 percent of exploited vulnerabilities from January to August 2026; only 0.23 percent of vulnerabilities disclosed in 2026 were seen exploited. Edge and security appliances were 14 percent of exploited vulnerabilities, and enterprise directory and collaboration hubs 11 percent.
- M-Trends 2026 (2025 data): exploits were the top initial infection vector for the sixth year running (32 percent); global median dwell time rose to 14 days from 11; the mean time to exploit was about minus 7 days, meaning exploitation routinely started before a patch was released.
- VulnCheck: 884 vulnerabilities newly seen exploited in 2025, while CISA added 245 to its Known Exploited Vulnerabilities catalog; 28.96 percent were exploited on or before the day the CVE was published. First half of 2026: 495 newly exploited; 23.43 percent on or before publication; the median time from CVE to KEV listing fell from 120 days in 2025 to 80 days.
- Recorded Future, August 2026: 73 high-impact vulnerabilities, 31 of them surfaced through KEV; the most common weaknesses were CWE-94 and CWE-502 (7 each), then CWE-287 and CWE-306 (6 each).

## Weakness classes: CWE Top 25 of 2025

Rank 1 CWE-79 cross-site scripting, 2 CWE-89 SQL injection, 3 CWE-352 cross-site request forgery, 4 CWE-862 missing authorization, 5 CWE-787 out-of-bounds write, 6 CWE-22 path traversal, 7 CWE-416 use after free, 9 CWE-78 OS command injection (with the most KEV entries, 20), 10 CWE-94 code injection, 12 CWE-434 unrestricted upload, 15 CWE-502 deserialization of untrusted data, 21 CWE-306 missing authentication. The SAP criticals of 2025 and 2026 cluster in CWE-94, CWE-89, CWE-502, CWE-862 and memory-safety weaknesses in the kernel. (MITRE CWE Top 25, updated 2025-12-15; CVE records)

## Notable KEV entries for enterprise application servers

- CVE-2025-53770, SharePoint Server deserialization leading to remote code execution: KEV 2025-07-20, due 2025-07-21 (NVD).
- CVE-2025-61882, Oracle E-Business Suite (Concurrent Processing, BI Publisher Integration, 12.2.3 to 12.2.14), CVSS 9.8: KEV 2025-10-06, due 2025-10-27 (NVD). GTIG and Mandiant describe zero-day exploitation from as early as 2025-08-09 and CL0P-branded extortion emails from 2025-09-29.
- CVE-2026-1731, BeyondTrust Remote Support and Privileged Remote Access pre-authentication remote code execution: KEV 2026-02-13, due 2026-02-16 (NVD). GTIG says an AI research agent found it autonomously.

Ransomware and extortion near ERP: BianLian and RansomEXX operators used the SAP Visual Composer flaw (ReliaQuest), Scattered Lapsus$ Hunters (ShinyHunters) published the exploit chain, and M-Trends 2026 reports Akira and Qilin operators going after backups, identity services and virtualization management.

## OWASP lists

- OWASP Top 10:2025 (web): A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions.
- OWASP Top 10 for LLM Applications 2025: LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Supply Chain, LLM04 Data and Model Poisoning, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM08 Vector and Embedding Weaknesses, LLM09 Misinformation, LLM10 Unbounded Consumption.
- OWASP Top 10 for LLM Applications 2026 (resource dated 2026-08-03, v1.0): LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Excessive Agency, LLM04 Supply Chain, LLM05 Data and Model Poisoning, LLM06 Unbounded Consumption, LLM07 Misinformation, LLM08 Hidden Context Exposure, LLM09 Vector and Embedding Weaknesses, LLM10 Improper Output Handling. The ranking weighted a community vote at 75 percent and data from 7,714 incidents at 25 percent, and prompt injection now covers cross-modal attacks. OWASP also announced a donated Agent Control Standard for runtime enforcement.
- OWASP Top 10 for Agentic Applications for 2026 (released 2025-12-09; one OWASP page is dated 2025-12-10): ASI01 Agent Goal Hijack, ASI02 Tool Misuse ("Tool Misuse and Exploitation" in the press release), ASI03 Identity and Privilege Abuse, ASI04 Agentic Supply Chain Vulnerabilities, ASI05 Unexpected Code Execution, ASI06 Memory and Context Poisoning, ASI07 Insecure Inter-Agent Communication, ASI08 Cascading Failures, ASI09 Human-Agent Trust Exploitation, ASI10 Rogue Agents.

## Prompt injection and AI agent risk

- LLM01:2025 separates direct injection (the user's own input) from indirect injection (hidden instructions in web pages or files the model processes). Mitigations include least privilege, human approval for high-risk actions, and keeping external content apart from instructions. (OWASP LLM01)
- OWASP cites EchoLeak as an ASI01 example and Amazon Q for ASI02. NVD lists CVE-2025-32711, AI command injection in Microsoft 365 Copilot (CNA 9.3, NVD 7.5, CWE-74).
- GTIG: orchestration middleware accounts for 50 percent of AI-related flaws, up 347 percent in 2026 disclosures, mostly code execution through prompt injection or crafted workflow JSON; one example is CVE-2026-42271 in LiteLLM's MCP test endpoint. NVD lists Langflow CVE-2025-3248, unauthenticated code injection at /api/v1/validate/code (CNA 9.8).
- MITRE ATLAS (data 2026.05): AML.T0051 LLM Prompt Injection, with AML.T0051.000 Direct and AML.T0051.001 Indirect; AML.T0054 LLM Jailbreak; AML.T0053 AI Agent Tool Invocation.

## Sources

- MITRE ATT&CK versions: https://attack.mitre.org/resources/versions/
- MITRE ATT&CK updates: https://attack.mitre.org/resources/updates/ , https://attack.mitre.org/resources/updates/updates-april-2026/ , https://attack.mitre.org/resources/updates/updates-october-2025/ , https://attack.mitre.org/resources/updates/updates-april-2025/
- MITRE ATT&CK tactics: https://attack.mitre.org/tactics/enterprise/ and https://attack.mitre.org/tactics/TA0112/
- MITRE ATT&CK technique pages: https://attack.mitre.org/techniques/ followed by the id
- Third-party, Cymulate, ATT&CK v19 breakdown: https://cymulate.com/blog/mitre-attack-v19-breakdown/
- Google Threat Intelligence Group, 2026-09-30, "Vulnerability Discovery and Exploitation Trends in the AI Era": https://cloud.google.com/blog/topics/threat-intelligence/vulnerability-discovery-and-exploitation-trends-in-the-ai-era
- Google Cloud and Mandiant, 2026-03-23, "M-Trends 2026": https://cloud.google.com/blog/topics/threat-intelligence/m-trends-2026
- GTIG and Mandiant, 2025-10-09, Oracle E-Business Suite zero-day: https://cloud.google.com/blog/topics/threat-intelligence/oracle-ebusiness-suite-zero-day-exploitation
- VulnCheck, "State of Exploitation 2026" and "1H-2026": https://www.vulncheck.com/blog/state-of-exploitation-2026 and https://www.vulncheck.com/blog/state-of-exploitation-1h-2026
- Recorded Future, "August 2026 CVE Landscape": https://www.recordedfuture.com/blog/august-2026-cve-landscape
- MITRE CWE Top 25 (2025): https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html
- NVD records: CVE-2025-53770, CVE-2025-61882, CVE-2026-1731, CVE-2025-32711, CVE-2025-3248: https://nvd.nist.gov/vuln/detail/ followed by the id
- Third-party, ReliaQuest, SAP NetWeaver threat spotlight: https://reliaquest.com/blog/threat-spotlight-reliaquest-uncovers-vulnerability-behind-sap-netweaver-compromise/
- Third-party, Palo Alto Networks Unit 42, SAP NetWeaver threat brief: https://unit42.paloaltonetworks.com/threat-brief-sap-netweaver-cve-2025-31324/
- Third-party, Pathlock, CVE-2025-31324 at scale: https://pathlock.com/blog/security-alerts/cve-2025-31324-in-sap-netweaver-visual-composer-now-exploitable-at-scale/
- Third-party, Forescout Vedere Labs: https://www.forescout.com/blog/threat-analysis-sap-vulnerability-exploited-in-the-wild-by-chinese-threat-actor
- Third-party, EclecticIQ: https://blog.eclecticiq.com/china-nexus-nation-state-actors-exploit-sap-netweaver-cve-2025-31324-to-target-critical-infrastructures
- Third-party, Onapsis, exploitation after the ShinyHunters release: https://onapsis.com/?p=31562
- Third-party, SecurityBridge, CVE-2025-42957: https://securitybridge.com/blog/critical-sap-s-4hana-code-injection-vulnerability-cve-2025-42957/
- Third-party, The Hacker News, CVE-2026-58231 attempts: https://thehackernews.com/2026/08/sap-commerce-cloud-cve-2026-58231.html
- OWASP Top 10:2025: https://top10.owasp.org/2025/
- OWASP GenAI, LLM Top 10 (2025) and LLM01: https://genai.owasp.org/llm-top-10/ and https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP GenAI, LLM Top 10 2026: https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/
- OWASP GenAI, 2026 announcement: https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/
- OWASP Top 10 for Agentic Applications for 2026: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ and https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/
- MITRE ATLAS data 2026.05: https://github.com/mitre-atlas/atlas-data
