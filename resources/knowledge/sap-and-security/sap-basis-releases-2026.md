# SAP Basis in 2026: releases, versions and maintenance dates

As of 2026-10-05. Each point names its source; the full list is at the end. "Third-party" means no SAP page confirmed the point.

## SAP S/4HANA release rhythm

- Starting with SAP S/4HANA 2023, SAP ships a new on-premise and private cloud release every two years, and each release gets seven years of mainstream maintenance instead of five. Feature package stacks (FPS) arrive about every six months during a release's first two years. The releases planned after 2023 are 2025 and 2027. (SAP News, 2022-09-15)
- SAP S/4HANA 2023 shipped in October 2023 with software component S4CORE 108 (third-party: Wikipedia). SAP News announced 2023 FPS02 on 2024-10-09 and 2023 FPS03 on 2025-03-10.
- The 2025 release was announced on 2025-10-13 under the name "SAP Cloud ERP Private 2025" (SAP News, 2025-10-13). SAP News described 2025 FPS01 on 2026-03-06; a third party gives 2026-03-09 as its release date. No 2025 FPS02 announcement had been found by 2026-10-05.
- SAP maintains a sequence of S/4HANA releases until 2040-12-31 (SAP News, 2020-02-04; SAP Release and Maintenance Strategy 2026.1).
- The exact end of mainstream maintenance for the 2023 and 2025 releases was not verified. The seven-year rule points to about the end of 2030 and the end of 2032. SAP names the Product Availability Matrix (PAM) and the SAP Notes it references as the authoritative source for these dates (SAP Release and Maintenance Strategy 2026.1).
- S/4HANA 2025 ships with SAP kernel 9.16 (third-party: IBM Community blog on the AIX build, 2025-10-16).
- The May 2026 security-note rollup lists S4CORE 102 to 109 and SAP_BASIS versions up to 816. That S4CORE 109 and SAP_BASIS 816 belong to the 2025 release is an inference from that list, not an SAP statement (Canadian Centre for Cyber Security, May 2026 SAP rollup).

## SAP kernel lines still receiving fixes

- SAP's September 2026 Patch Day lists these kernel lines as affected, which means they still get fixes: KERNEL 7.22, 7.53, 7.54, 7.77, 7.89, 7.93, 8.04, 9.16, 9.18, 9.19 and 9.20; KRNL64UC 7.22, 7.22EXT, 7.53 and 8.04; KRNL64NUC 7.22 and 7.22EXT; Web Dispatcher WEBDISP 9.16, 9.18, 9.19 and 9.20. (SAP Patch Day, Sep 2026)
- How SAP mapped kernels to releases in its 2021 kernel webinar: kernel 722 for ERP 6.0 EhP 6 and lower on NetWeaver 7.0 to 7.31; 749 and 753 for EhP 7 and 8 on NetWeaver 7.4 and 7.5 and for S/4HANA 1511 to 1710; 773 and 777 for S/4HANA 1809 to 1909; 781 and 785 for S/4HANA 2020 and 2021. (SAP kernel webinar, 2021-09-28)
- A downward-compatible kernel (DCK) can replace an older one, for example 753 instead of 740, 742, 745 or 749. Kernels 781 and 785 cannot be used as a DCK for S/4HANA 1809 to 1909. In 2021 SAP planned kernel 749 to leave maintenance on 2022-12-31 and kernel 753 on 2025-12-31. Kernel 7.53 still appeared in the September 2026 affected-version lists, so check SAP's current kernel maintenance information and the PAM before assuming it is out of maintenance. (SAP kernel webinar, 2021-09-28; SAP Patch Day, Sep 2026)
- Which products run kernels 7.89, 7.93, 8.04, 9.18, 9.19 and 9.20 was not verified.

## SAP GUI

- SAP GUI for Windows 8.10: an SAP Community post is titled "SAP GUI for Windows 8.10 is coming: General Availability as of 16th of July 2026". A third party reports support until 2029-06-30, patch level 2 planned for October 2026, and 32-bit and 64-bit editions with only one installed per PC. (SAP Community title; third-party: saptechnicalguru, 2026-08-21)
- SAP GUI for Windows 8.00 was released on 2023-01-27 (third-party: Wikipedia). Its end date differs by source: standard support until 2027-01-12, then restricted support until 2027-07-31 according to SAP Note 147519 as quoted by a third party. Read Note 147519 for the binding dates.
- SAP GUI for Windows 7.70 support ended on 2024-04-09 (third-party: Wikipedia).
- A third party describes SAP's policy as supporting each SAP GUI for Windows release for about two years, so plan an upgrade roughly every two years. Related SAP Notes, by title as quoted: 147519 (support dates and restrictions), 66971 (supported platforms), 1053737 (expected release dates), 3549180 (new features in 8.10). (third-party: saptechnicalguru)
- SAP GUI for Java 8.10 revision 10 came out in February 2026 and is the last version that supports Intel-based macOS. SAP GUI for Java 7.80 support ended on 2025-03-31. (SAP Community topic page "SAP GUI Family")

## Software Update Manager, DMO and SWPM

- Software Logistics Toolset 1.0 SPS 46, available since 2026-02-09, contains SUM 2.0 SP 25 and Software Provisioning Manager 1.0 SP46 and 2.0 SP23. That SUM release added shell copy for ERP 6.0 EHP7 and EHP8, automatic reset of obsolete SAP Notes during an upgrade, parallel ACT_UPG, and downtime-optimized conversion for SAP ASE. HP-UX runs only on frozen versions: no HP-UX patches after the end of 2025. (SAP SL Toolset SPS 46 news)
- SL Toolset 1.0 SPS 47, available since 2026-05-26, contains SUM 2.0 SP 26 and SWPM 1.0 SP47 and 2.0 SP24. SUM changes: a better user interface for DMO with System Move, system conversion with SUM 2.0 from Microsoft SQL Server source systems, and a new "lift and shift with DMO to SAP HANA" approach. This was the newest SL Toolset news page that could be read. (SAP SL Toolset SPS 47 news)
- Which SUM line to use: SUM 2.0 for system conversions, ABAP single-stack targets on SAP_BASIS 7.50 or higher, and the Zero Downtime Option; SUM 1.x for dual-stack or Java sources and for targets on 7.40 or lower. (SAP Software Update Manager page)
- Downtime options named on SAP's SUM page, with their SAP Notes: DMO (update or upgrade combined with a migration to SAP HANA), DMO without system change, DMO with System Move, near-Zero Downtime Maintenance for ABAP (Note 1678565), Zero Downtime Option ZDO (Note 2707231), nZDM for Java (Note 3291319), and downtime-optimized conversion (Note 3301507). (SAP Software Update Manager page)

## Maintenance timelines

### SAP Business Suite 7 and SAP ERP 6.0 (ECC)

- Mainstream maintenance for the Business Suite 7 core applications ends on 2027-12-31. Optional extended maintenance runs from 2028-01-01 to 2030-12-31 for a premium of two percentage points on the maintenance base. Customers without extended maintenance move to customer-specific maintenance from 2028-01-01. (SAP News, 2020-02-04; SAP Release and Maintenance Strategy 2026.1)
- Customer-specific maintenance fixes known issues at unchanged fees (SAP News, 2020-02-04). A third party adds that it does not promise legal changes, new support packages or new database and OS versions (third-party: SAPinsider, 2023-06-16).
- ERP 6.0 without an enhancement package, and EHP 1 to 5, left mainstream maintenance on 2025-12-31; the extended maintenance to 2030 applies to EHP 6, 7 and 8 (third-party: SAPinsider, 2023-06-16).

### SAP ERP, private edition, transition option

- A time-bound subscription for business continuity from 2031 to 2033, centred on SAP ECC on SAP HANA. Eligible products are listed in SAP Note 3591251. Systems on the option need at least 2 TB, it is sold only together with the "max success plan", and systems must be on SAP ERP, private edition on SAP HANA before 2030-12-31. (SAP News, 2025-08-04)
- Commercial terms for the underlying SAP ERP, private edition: customers who committed by the end of 2025 got commercially equivalent terms; sign-ups in 2026 carry a standard 20 percent uplift. (SAP News, 2025-08-04)

### SAP NetWeaver, BW and Process Orchestration

- SAP NetWeaver 7.5 (AS ABAP, and AS Java on SAP JVM 8): mainstream maintenance until the end of 2027 and extended maintenance until the end of 2030. BW 7.5 has the same dates. SAP BW/4HANA is maintained until the end of 2040. (SAP News, August 2020; SAP Community NetWeaver maintenance page)
- NetWeaver 7.4, 7.3, 7.31 and 7.1x left mainstream maintenance at the end of 2020, except that AS ABAP 7.4 and 7.31 stay supported as needed for Business Suite 7 commitments. (SAP Community NetWeaver maintenance page)
- Process Orchestration 7.5: SAP's page shows mainstream until the end of 2027 with an extended option to the end of 2030, while a 2020 third-party article said no extended maintenance was offered. Confirm in the PAM.
- Embedded NetWeaver products follow the maintenance dates of the core application they ship with. (SAP Release and Maintenance Strategy 2026.1)

### SAP Solution Manager 7.2 and SAP Cloud ALM

- Solution Manager 7.2 mainstream maintenance runs until 2027-12-31. Extended maintenance until the end of 2030 covers selected functions only: requirements, project and process management, test suite, change control, IT service management and landscape management. It costs nothing extra for customers who buy Business Suite 7 extended maintenance. (SAP Solution Manager page; SAP ALM FAQ)
- Customers keep a perpetual Solution Manager license and may keep using it after maintenance ends. SAP recommends moving to SAP Cloud ALM before the end of 2027. (SAP Solution Manager page; SAP ALM FAQ)
- SAP Cloud ALM is included in SAP Enterprise Support and in cloud subscriptions with Enterprise Support, cloud editions, with no license fee and one tenant per customer number. As SaaS it needs no customer-side patching. (SAP Cloud ALM page; SAP ALM FAQ; SAP Learning)

### Policy changes in 2025 and 2026

- 2026-07-09: after dialogue with the European Commission (case AT.40823), SAP changed its on-premise maintenance and support practices. Customers may split landscapes into separate "commercial installations" with different support levels or none; termination rights for unused licenses widened (severe workforce reductions, products in customer-specific maintenance, bankruptcy, divestiture, failed implementations); single-metric contracts became easier to get; there is no administrative fee to resume support; back-maintenance is capped at the lower of six months or 50 percent of fees for the time off, with defined outdated products exempt. It applies to on-premise products worldwide; cloud offerings are not affected. (SAP News, 2026-07-09)
- 2026-07-28: SAP published version 2026.1 of its "SAP Release and Maintenance Strategy" document. (support.sap.com/releasestrategy)

## Sources

- SAP News, 2022-09-15, "New SAP S/4HANA Release and Maintenance Strategy to Deliver Greater Innovation and Flexibility": https://news.sap.com/2022/09/new-sap-s4hana-release-maintenance-strategy/
- SAP News, 2025-10-13, "From Innovation to Impact: Latest Release of SAP Cloud ERP Private": https://news.sap.com/?p=237788
- SAP News, 2026-03-06, "SAP Cloud ERP Private: Delivering Continuous Innovation with FPS01": https://news.sap.com/2026/03/sap-cloud-erp-private-fps01-delivering-continuous-innovation/
- SAP News FPS02 and FPS03 announcements (2024-10-09, 2025-03-10): https://news.sap.com/2024/10/sap-s4hana-cloud-private-edition-2023-fps02-ai-assisted-capabilities/ and https://news.sap.com/2025/03/sap-s4hana-cloud-private-edition-2023-fps03-new-ai-capabilities/
- Third-party, Savic Technologies, 2026-04-24, S/4HANA 2025 FPS01: https://www.savictech.com/insights/sap-s4hana-2025-fps01-ai-embedded-erp-2026/
- Third-party, Wikipedia, "SAP S/4HANA" and "SAP Graphical User Interface": https://en.wikipedia.org/wiki/SAP_S/4HANA and https://en.wikipedia.org/wiki/SAP_Graphical_User_Interface
- Canadian Centre for Cyber Security, 2026-05-12, SAP security advisory May 2026 rollup (AV26-447): https://cyber.gc.ca/en/alerts-advisories/sap-security-advisory-may-2026-monthly-rollup-av26-447
- SAP Patch Day, Sep 2026: https://support.sap.com/en/my-support/knowledge-base/security-notes-news/september-2026.html
- Third-party, IBM Community blog, 2025-10-16, "AIX: SAP Kernel 916 for S/4HANA 2025 available": https://community.ibm.com/community/user/blogs/markus-mueller/2025/10/16/aix-sap-kernel-916-for-s4hana-2025-available
- SAP kernel webinar, 2021-09-28, "SAP Kernel in on-premise landscapes - update 2021": https://assets.dm.ux.sap.com/webinars/sap-user-groups-k4u/pdfs/210928_sap_kernel_in_on_premise_landscapes_update_2021.pdf
- SAP Community title, "SAP GUI for Windows 8.10 is coming: General Availability as of 16th of July 2026": https://community.sap.com/t5/technology-blog-posts-by-sap/sap-gui-for-windows-8-10-is-coming-general-availability-as-of-16th-of-july/ba-p/14434135
- Third-party, saptechnicalguru, "SAP GUI 8.10" and "SAP GUI patching": https://www.saptechnicalguru.com/?p=17327 and https://www.saptechnicalguru.com/sap-gui-patching
- SAP Community topic page "SAP GUI Family": https://pages.community.sap.com/topics/gui/family
- SAP SL Toolset SPS 46 news, 2026-02-09: https://support.sap.com/en/tools/software-logistics-tools/sltoolset-news-sps46.html
- SAP SL Toolset SPS 47 news, 2026-05-26: https://support.sap.com/en/tools/software-logistics-tools/sltoolset-news-sps47.html
- SAP Software Update Manager page: https://support.sap.com/en/tools/software-logistics-tools/software-update-manager.html
- SAP Release and Maintenance Strategy 2026.1, 2026-07-28: https://support.sap.com/releasestrategy
- SAP News, 2020-02-04, "SAP Extends Its Innovation Commitment for SAP S/4HANA": https://news.sap.com/2020/02/sap-s4hana-maintenance-2040-clarity-choice-sap-business-suite-7/
- SAP News, August 2020, aligned extended maintenance commitments: https://news.sap.com/2020/08/aligned-extended-maintenance-commitments/
- SAP Community NetWeaver maintenance strategy page: https://pages.community.sap.com/topics/abap/netweaver-maintenance-strategy
- Third-party, SAPinsider, 2023-06-16, "SAP Details End of Maintenance Plans for Business Suite": https://sapinsider.org/blogs/sap-details-end-of-maintenance-plans-for-business-suite/
- Third-party, SAPinsider, 2020-04-09, "SAP Extends Maintenance for SAP NetWeaver 7.5 and SAP BW/4HANA": https://sapinsider.org/blogs/sap-extends-maintenance-for-sap-netweaver-7-5-and-sap-bw-4hana/
- SAP News, 2025-08-04, "Updates for SAP ERP, Private Edition, Transition Option": https://news.sap.com/2025/08/rise-with-sap-journey-sap-erp-private-edition-transition-option-updates/
- SAP News, 2026-07-09, "Evolving Our Maintenance and Support Practices": https://news.sap.com/2026/07/evolving-maintenance-support-practices-greater-flexibility-sap-customers/
- SAP Solution Manager 7.2 page: https://support.sap.com/solution-manager
- SAP ALM Questions and Answers: https://support.sap.com/en/alm/faq.html
- SAP Cloud ALM page: https://support.sap.com/en/alm/sap-cloud-alm.html
- SAP Learning, transition from Solution Manager to Cloud ALM: https://learning.sap.com/courses/transition-from-sap-solution-manager-to-sap-cloud-alm/understanding-the-transition-from-sap-solution-manager-to-sap-cloud-alm
