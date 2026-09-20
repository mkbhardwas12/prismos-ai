# SAP NetWeaver PI/PO support-package planning: evidence requirements

Reviewed: 2026-09-08. Classification: public planning reference; not an executable upgrade procedure.

SAP describes Maintenance Planner as supporting software-maintenance planning, including releases and updates, Java patches, landscape information and related planning utilities. [Source: SAP Maintenance Planner](https://support.sap.com/en/alm/solution-manager/integrated-tools/maintenance-planner.html)

A requested move from one NetWeaver support-package level to a later one is a proposed target, not proof of compatibility, entitlement, maintenance status or an approved stack. This reference does not verify any such path. Obtain the applicable SAP documentation and system-specific maintenance plan before writing execution instructions. Do not invent SAP Note numbers, label a target support package a long-term-maintenance release, or guess a required kernel from the request alone.

Required project inputs include installed product/component versions, PI versus PO topology, Java/ABAP presence, operating system and database, adapters and integrations, add-ons, customizations, target-stack validation, applicable update guide and tool version, backup/restore design, business blackout constraints, and test ownership.

An executive planning deck can cover DEV, Test, Stage and Prod, with promotion gates, integration regression testing, operational rehearsal, rollback decision criteria and owner sign-offs. Keep downtime and dates explicitly TBD until measured and agreed. A kernel binary replacement is not a complete PI/PO support-package update. Unrelated automation project names are not established SAP upgrade tools merely because they appear in local knowledge.
