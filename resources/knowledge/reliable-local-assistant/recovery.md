# SQLite recovery backups versus knowledge graph exports

Reviewed: 2026-09-08. Classification: public technical reference.

SQLite's online backup API copies a consistent database snapshot while permitting the source database to remain in use. Copying only the main file of a live WAL-mode database is not equivalent to an online backup. [Source: SQLite online backup](https://www.sqlite.org/backup.html)

A graph export can preserve selected nodes and edges yet omit embeddings, feedback, preferences, history, configuration or other tables. A full database backup and the application settings/key material needed to use it are a different recovery deliverable. Document exactly what is included.

Before migration or bulk ingestion, create a new owner-restricted backup outside the source repository. Check database integrity and compare expected row counts. Keep a checksum and a private restore note. Never overwrite the only known-good copy. Test restoration into a separate empty directory with the application stopped; keep newer live data separately until verification finishes. Do not mix stale WAL/SHM files with a restored snapshot.

A local backup on the same disk protects against some application failures, not loss of the disk or machine. Disaster recovery also needs a separate protected copy and independently recoverable keys. A Git repository, even a private one, is not encryption. Do not upload plaintext personal databases or rely on an untested export format for disaster recovery.
