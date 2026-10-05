// Security lane: offline cyber investigation and hardening, on your machine.
//
// Drop in logs and ask to investigate, drop in a config and ask to harden it,
// or just ask "harden my postgres": PrismOS does the deterministic part itself
// and the local model only explains and prioritises what was found.
//   • Investigate: indicators (IPs, domains, URLs, hashes, emails, users, CVEs,
//     paths), a timeline with activity peaks, and pattern detectors mapped to
//     MITRE ATT&CK (brute force, success-after-failure, new admins, encoded
//     PowerShell, download cradles, persistence, log clearing, web attacks,
//     reverse shells, credential dumping, lateral movement).
//   • Harden a config: sshd_config, nginx, Dockerfile, docker-compose,
//     Kubernetes, .env, package.json and GitHub Actions are checked line by
//     line, each finding with a severity and the exact fix (and a fully
//     patched sshd_config).
//   • Harden a platform: a curated checklist grounds the model's plan.
// Logs and configs never leave the machine, which is the point for incident
// data. Defensive use only: findings, containment and hardening.

export type SecurityMode = "investigate" | "harden";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type ConfigType = "sshd" | "nginx" | "dockerfile" | "compose" | "kubernetes" | "dotenv" | "npm" | "github-actions";

export interface AttackRef {
  id: string;
  name: string;
  tactic: string;
}

export interface SecurityFinding {
  id: string;
  title: string;
  severity: Severity;
  /** What was seen (investigation) or what is wrong (hardening). */
  detail: string;
  /** Up to three evidence lines, defanged and with secrets masked. */
  evidence: string[];
  attack?: AttackRef;
  /** The exact line or snippet that fixes it (hardening). */
  fix?: string;
  count?: number;
}

export interface Indicators {
  ipsPublic: string[];
  ipsPrivate: string[];
  domains: string[];
  urls: string[];
  emails: string[];
  md5: string[];
  sha1: string[];
  sha256: string[];
  users: string[];
  cves: string[];
  paths: string[];
}

export interface InvestigationReport {
  mode: "investigate";
  source: string;
  lines: number;
  timeline: { first: string | null; last: string | null; parsed: number; peaks: { minute: string; count: number }[] };
  indicators: Indicators;
  findings: SecurityFinding[];
}

export interface HardeningReport {
  mode: "harden";
  source: string;
  configType: ConfigType;
  findings: SecurityFinding[];
  /** A fully patched config when the fixes can be applied mechanically. */
  patched?: string;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_ICON: Record<Severity, string> = { critical: "🟥", high: "🟧", medium: "🟨", low: "🟦", info: "⬜" };

// ─── MITRE ATT&CK techniques the detectors map to ────────────────────────────

const ATTACK: Record<string, AttackRef> = {
  bruteForce: { id: "T1110.001", name: "Brute Force: Password Guessing", tactic: "Credential Access" },
  validAccounts: { id: "T1078", name: "Valid Accounts", tactic: "Initial Access / Persistence" },
  createAccount: { id: "T1136", name: "Create Account", tactic: "Persistence" },
  accountManipulation: { id: "T1098", name: "Account Manipulation", tactic: "Persistence / Privilege Escalation" },
  sudo: { id: "T1548.003", name: "Abuse Elevation Control: Sudo", tactic: "Privilege Escalation" },
  powershell: { id: "T1059.001", name: "Command and Scripting Interpreter: PowerShell", tactic: "Execution" },
  obfuscation: { id: "T1027", name: "Obfuscated Files or Information", tactic: "Defense Evasion" },
  toolTransfer: { id: "T1105", name: "Ingress Tool Transfer", tactic: "Command and Control" },
  unixShell: { id: "T1059.004", name: "Command and Scripting Interpreter: Unix Shell", tactic: "Execution" },
  scheduledTask: { id: "T1053", name: "Scheduled Task/Job", tactic: "Persistence / Execution" },
  service: { id: "T1543", name: "Create or Modify System Process", tactic: "Persistence" },
  runKeys: { id: "T1547.001", name: "Registry Run Keys / Startup Folder", tactic: "Persistence" },
  indicatorRemoval: { id: "T1070", name: "Indicator Removal", tactic: "Defense Evasion" },
  exploitPublic: { id: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access" },
  activeScanning: { id: "T1595", name: "Active Scanning", tactic: "Reconnaissance" },
  credentialDump: { id: "T1003.001", name: "OS Credential Dumping: LSASS Memory", tactic: "Credential Access" },
  discovery: { id: "T1087", name: "Account Discovery", tactic: "Discovery" },
  remoteServices: { id: "T1021", name: "Remote Services", tactic: "Lateral Movement" },
  userExecution: { id: "T1204", name: "User Execution", tactic: "Execution" },
};

// ─── Detection ────────────────────────────────────────────────────────────────

const HARDEN_WORDS =
  /\b(harden\w*|lock\s+(?:it|this|them|down)\b|security\s+(?:review|audit|check|scan|posture|baseline|best\s+practices?)|secure\s+(?:this|my|the|our)\b|make\s+(?:it|this|(?:my|our)\s+[\w.-]+(?:\s+[\w.-]+){0,2})\s+(?:more\s+)?secure|misconfig\w*|cis\s+benchmark|is\s+(?:this|my|our)\s+[\w.-]+\s+secure)/i;
const INVESTIGATE_WORDS =
  /\b(investigat\w*|incident|forensic\w*|iocs?\b|indicators?\s+of\s+compromise|threat\s+hunt\w*|triage|breach\w*|compromis\w*|intrusion|malware|phishing|suspicious|attack(?:ed|er|ers|s)?\b|brute[\s-]?forc\w*|lateral\s+movement|what\s+happened|who\s+logged\s+in)/i;
/** Asking to look over a config (summarising one is not a security review). */
const CONFIG_VERBS = /\b(review|check|audit|look\s+(?:at|over)|go\s+through|fix|improve|scan|tighten)\b/i;
/** Asking to look over logs: any of those, plus analyse / explain / summarise. */
const LOG_VERBS = /\b(review|check|audit|look\s+(?:at|over)|analy[sz]e|go\s+through|explain|summari[sz]e|scan|triage)\b/i;

/** A platform a hardening checklist exists for, named in the request. */
export function hardeningTopic(input: string): string | null {
  const t = input.toLowerCase();
  for (const [topic, re] of TOPIC_MATCH) if (re.test(t)) return topic;
  return null;
}

/** Text that reads as log lines: many lines carrying timestamps or log keywords. */
export function looksLikeLogs(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 400);
  if (lines.length < 3) return false;
  let hits = 0;
  for (const l of lines) {
    if (parseTimestamp(l, 2026) !== null || /\b(EventID|sshd\[|kernel:|GET \/|POST \/|HTTP\/1\.[01]"|level=|ERROR|WARN|Failed password|Accepted )/.test(l)) hits++;
  }
  return hits >= Math.max(3, lines.length * 0.4);
}

/**
 * Route a request to the security lane. With material attached (or pasted),
 * hardening words or a recognised config mean "harden"; investigation words
 * or log-shaped text mean "investigate". Without material, "harden my X" for
 * a known platform is a hardening guide. Everything else stays in its lane.
 */
export function detectSecurityRequest(input: string, material?: string): SecurityMode | null {
  const t = input.trim();
  const body = material ?? (t.length > 300 ? t : "");
  if (body) {
    const config = detectConfigType(body);
    const logs = looksLikeLogs(body);
    if (HARDEN_WORDS.test(t)) return "harden";
    if (INVESTIGATE_WORDS.test(t)) return "investigate";
    if (config && CONFIG_VERBS.test(t)) return "harden";
    if (logs && LOG_VERBS.test(t)) return "investigate";
    if (!material && config && /\b(security|secure|harden)/i.test(t)) return "harden";
    return null;
  }
  if (HARDEN_WORDS.test(t) && hardeningTopic(t)) return "harden";
  return null;
}

/** Recognise the config format, from the file name when given, else the text. */
export function detectConfigType(text: string, name = ""): ConfigType | null {
  const n = name.toLowerCase();
  if (/sshd_config/.test(n)) return "sshd";
  if (/nginx|\.conf$/.test(n) && /\bserver\s*\{|\blocation\b/.test(text)) return "nginx";
  if (/(^|\/)dockerfile/.test(n)) return "dockerfile";
  if (/(docker-)?compose\.ya?ml$/.test(n)) return "compose";
  if (/\.github\/workflows\//.test(n)) return "github-actions";
  if (/(^|\/)\.env(\.|$)/.test(n)) return "dotenv";
  if (/package\.json$/.test(n)) return "npm";
  const s = text.slice(0, 60_000);
  if (/^\s*(PermitRootLogin|PasswordAuthentication|ChallengeResponseAuthentication|KbdInteractiveAuthentication|PubkeyAuthentication|Subsystem\s+sftp)\b/im.test(s)) return "sshd";
  if (/^\s*FROM\s+\S+/im.test(s) && /^\s*(RUN|COPY|ADD|CMD|ENTRYPOINT|USER|WORKDIR)\b/im.test(s)) return "dockerfile";
  if (/^\s*apiVersion:\s*\S+/m.test(s) && /^\s*kind:\s*\S+/m.test(s)) return "kubernetes";
  if (/^\s*on:\s*$|^\s*on:\s*\[|^\s*on:\s*(push|pull_request)/m.test(s) && /^\s*jobs:\s*$/m.test(s)) return "github-actions";
  if (/^\s*services:\s*$/m.test(s) && /^\s+(image|build):/m.test(s)) return "compose";
  if (/\bserver\s*\{/.test(s) && /\b(listen|server_name|location)\b/.test(s)) return "nginx";
  if (/^\s*\{/.test(s) && /"(dependencies|devDependencies|scripts)"\s*:/.test(s)) return "npm";
  const lines = s.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length >= 2 && lines.filter((l) => /^\s*(export\s+)?[A-Z][A-Z0-9_]*\s*=/.test(l)).length >= lines.length * 0.7) return "dotenv";
  return null;
}

// ─── Hygiene: defang indicators, mask secrets ────────────────────────────────

/** 203.0.113.5 → 203.0.113[.]5, http://a.com → hxxp://a[.]com, so nothing in a report is clickable. */
export function defang(s: string): string {
  return s
    .replace(/\bhttp(s?):\/\//gi, "hxxp$1://")
    .replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\b/g, "$1[.]$2")
    .replace(/\b([a-z0-9-]+)\.(com|net|org|io|ru|cn|xyz|top|info|biz|co|me|us|uk|de|su|tk|ml|ga|cf|gq|cc|pw|online|site|club|app|dev|link|live|shop)\b/gi, "$1[.]$2")
    .replace(/@/g, "[@]");
}

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "AWS access key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Stripe key", re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

/** Replace anything secret-shaped with its first four characters and stars. */
export function maskSecrets(s: string): string {
  let out = s;
  for (const { re } of SECRET_PATTERNS) out = out.replace(re, (m) => (m.startsWith("-----") ? "-----BEGIN PRIVATE KEY----- [masked]" : `${m.slice(0, 4)}****`));
  return out.replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key)\s*[=:]\s*)(["']?)([^\s"']{3,})\2/gi, (_m, k: string, q: string, v: string) => `${k}${q}${v.slice(0, 2)}****${q}`);
}

/** Secret-shaped strings in any text (names only, never the values). */
export function findSecrets(text: string): string[] {
  const found: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) if (new RegExp(re.source).test(text)) found.push(name);
  return found;
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const evidenceLine = (s: string) => clip(maskSecrets(defang(s.trim())));
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

// ─── Indicators ───────────────────────────────────────────────────────────────

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const TLDS = "com|net|org|io|ru|cn|xyz|top|info|biz|co|me|us|uk|de|fr|nl|su|tk|ml|ga|cf|gq|cc|pw|online|site|club|app|dev|link|live|shop|in|jp|br|kr|it|es|pl|ir|tw|vn|ua|ca|au|eu|cloud|tech|store";
const DOMAIN = new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b`, "gi");

/** RFC 1918, loopback, link-local, CGNAT and documentation ranges. */
export function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
}

export function extractIndicators(text: string): Indicators {
  const s = text.slice(0, 5_000_000);
  const ips = uniq(s.match(IPV4) ?? []).filter((ip) => !/^\d+\.\d+\.\d+\.\d+\.\d/.test(ip));
  const urls = uniq((s.match(/\bhttps?:\/\/[^\s"'<>()]+/gi) ?? []).map((u) => u.replace(/[.,;]+$/, ""))).slice(0, 200);
  const emails = uniq(s.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g) ?? []).slice(0, 200);
  const domains = uniq((s.match(DOMAIN) ?? []).map((d) => d.toLowerCase()))
    .filter((d) => !emails.some((e) => e.toLowerCase().endsWith(`@${d}`)) || urls.some((u) => u.toLowerCase().includes(d)))
    .slice(0, 300);
  const sha256 = uniq(s.match(/\b[a-f0-9]{64}\b/gi) ?? []);
  const sha1 = uniq((s.match(/\b[a-f0-9]{40}\b/gi) ?? []).filter((h) => !sha256.some((x) => x.includes(h))));
  const md5 = uniq((s.match(/\b[a-f0-9]{32}\b/gi) ?? []).filter((h) => !sha1.some((x) => x.includes(h)) && !sha256.some((x) => x.includes(h))));
  const users: string[] = [];
  const userRe = /(?:Failed password for (?:invalid user )?|Accepted \w+ for |Invalid user |session opened for user |user=|USER=|Account Name:\s+|TargetUserName[=:]\s*|SubjectUserName[=:]\s*|for user )([A-Za-z0-9._$\\-]{2,64})/g;
  for (const m of s.matchAll(userRe)) if (!/^(-|SYSTEM|N\/A|from)$/i.test(m[1])) users.push(m[1]);
  const paths = uniq([
    ...(s.match(/\b[A-Za-z]:\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]+\.(?:exe|dll|ps1|bat|vbs|js|hta|scr)\b/gi) ?? []),
    ...(s.match(/(?:\/tmp|\/dev\/shm|\/var\/tmp|\/root|\/etc\/cron[^\s]*|\/etc\/systemd\/system)\/[^\s"'<>;|]+/g) ?? []),
  ]).slice(0, 100);
  return {
    ipsPublic: ips.filter((ip) => !isPrivateIp(ip)).slice(0, 300),
    ipsPrivate: ips.filter(isPrivateIp).slice(0, 300),
    domains,
    urls,
    emails,
    md5: md5.slice(0, 100),
    sha1: sha1.slice(0, 100),
    sha256: sha256.slice(0, 100),
    users: uniq(users).slice(0, 100),
    cves: uniq((s.match(/\bCVE-\d{4}-\d{4,7}\b/gi) ?? []).map((c) => c.toUpperCase())),
    paths,
  };
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Milliseconds (UTC, or log-local time when the log carries no zone), or null. */
export function parseTimestamp(line: string, yearHint: number): number | null {
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/);
  if (m) {
    const tz = m[7] ? (m[7] === "Z" ? "Z" : m[7].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "Z";
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`);
    if (!Number.isNaN(t)) return t;
  }
  m = line.match(/\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?\]/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const offset = m[7] ? (Number(m[7].slice(0, 3)) * 60 + Math.sign(Number(m[7].slice(0, 3)) || 1) * Number(m[7].slice(3))) * 60_000 : 0;
    return Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5], +m[6]) - offset;
  }
  m = line.match(/^(?:<\d+>)?([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\b/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) return Date.UTC(yearHint, MONTHS[m[1].toLowerCase()], +m[2], +m[3], +m[4], +m[5]);
  m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    let h = +m[4];
    if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5], +m[6]);
  }
  return null;
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.000Z$/, "Z");

// ─── Investigation ────────────────────────────────────────────────────────────

interface LineDetector {
  id: string;
  title: string;
  severity: Severity;
  attack: AttackRef;
  re: RegExp;
  detail: string;
}

const LINE_DETECTORS: LineDetector[] = [
  { id: "new-account", title: "New account created", severity: "high", attack: ATTACK.createAccount, re: /\b(useradd|adduser)\b|new user: name=|EventID[=: ]+4720\b|A user account was created/i, detail: "An account was created. Confirm it was a planned change." },
  { id: "admin-group", title: "Account added to an admin group", severity: "high", attack: ATTACK.accountManipulation, re: /usermod\s+(-a\s*)?-G\s*\w*(sudo|wheel|admin)|add(ed)? .{0,40}to group '?(sudo|wheel|admin)|EventID[=: ]+(4728|4732|4756)\b|member was added to a security-enabled (global|local|universal) group/i, detail: "An account was given administrator rights." },
  { id: "sudo", title: "Commands run with sudo", severity: "low", attack: ATTACK.sudo, re: /sudo:\s+\S+\s*:.*COMMAND=|\bsu\[\d+\]: .*session opened/i, detail: "Privileged commands were run. Check they match the person and the job." },
  { id: "encoded-powershell", title: "Encoded PowerShell command", severity: "high", attack: ATTACK.powershell, re: /powershell(?:\.exe)?\b.{0,120}\s-(?:e|en|enc|enco|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i, detail: "PowerShell ran a base64-encoded command, a common way to hide what a script does." },
  { id: "download-cradle", title: "Download-and-run command", severity: "high", attack: ATTACK.toolTransfer, re: /(curl|wget)\s[^|;\n]{0,200}\|\s*(ba|z|da)?sh\b|IEX\s*\(?\s*\(?New-Object\s+Net\.WebClient|Invoke-WebRequest.{0,120}\|\s*iex|DownloadString\(|certutil(\.exe)?\s+.*-urlcache|bitsadmin\s+\/transfer/i, detail: "Something was downloaded and executed in one step." },
  { id: "reverse-shell", title: "Reverse shell pattern", severity: "critical", attack: ATTACK.unixShell, re: /bash\s+-i\s+>&\s*\/dev\/tcp\/|\/dev\/tcp\/\d|\bnc(at)?\s+(-\w+\s+)*-e\s+\/bin\/(ba)?sh|socat\s+.*exec:.*sh|python3?\s+-c\s+["'].*socket.*subprocess/i, detail: "A shell was wired to a network connection, the classic remote-control foothold." },
  { id: "persistence-cron", title: "Scheduled task or cron change", severity: "medium", attack: ATTACK.scheduledTask, re: /\bcrontab\s+(-e|-l\s*\|)|\/etc\/cron\.|CRON\[\d+\]: .*REPLACE|schtasks(\.exe)?\s+\/create|EventID[=: ]+4698\b|A scheduled task was created/i, detail: "Something set up a recurring job, a common way to survive reboots." },
  { id: "persistence-service", title: "New service or systemd unit", severity: "medium", attack: ATTACK.service, re: /systemctl\s+(enable|daemon-reload)|\/etc\/systemd\/system\/[^\s]+\.service|EventID[=: ]+7045\b|A service was installed|sc(\.exe)?\s+create\s/i, detail: "A service was installed or enabled." },
  { id: "persistence-runkey", title: "Registry Run key written", severity: "medium", attack: ATTACK.runKeys, re: /\\CurrentVersion\\Run(Once)?\b|\\Start Menu\\Programs\\Startup\\/i, detail: "A program was set to start automatically at logon." },
  { id: "log-clearing", title: "Logs or history cleared", severity: "high", attack: ATTACK.indicatorRemoval, re: /EventID[=: ]+(1102|104)\b|audit log was cleared|wevtutil(\.exe)?\s+cl\b|history\s+-c\b|rm\s+(-\w+\s+)*\/var\/log|>\s*\/var\/log\/\w+|unset\s+HISTFILE|Clear-EventLog/i, detail: "Someone removed records, which usually means they were hiding something." },
  { id: "credential-dump", title: "Credential dumping tool or LSASS access", severity: "critical", attack: ATTACK.credentialDump, re: /mimikatz|sekurlsa|procdump(64)?(\.exe)?\s+.*-ma\s+lsass|lsass\.(exe|dmp).{0,40}(dump|minidump)|comsvcs\.dll.{0,40}MiniDump|ntds\.dit/i, detail: "Tools or actions that steal passwords from memory or the domain database." },
  { id: "lateral-movement", title: "Remote execution on another host", severity: "high", attack: ATTACK.remoteServices, re: /\bpsexec(64)?(\.exe)?\b|wmic(\.exe)?\s+\/node:|Invoke-Command\s+-ComputerName|winrs(\.exe)?\s+-r:|Enter-PSSession/i, detail: "Commands were run on other machines, a sign of spreading." },
  { id: "discovery", title: "Reconnaissance commands", severity: "low", attack: ATTACK.discovery, re: /\b(whoami(\.exe)?(\s+\/all)?|net(1)?\s+(user|group|localgroup)\b|nltest\s+\/dclist|ipconfig\s+\/all|systeminfo|cat\s+\/etc\/passwd|id\s*;|uname\s+-a)\b/i, detail: "Commands that map users, groups and the system, typical right after a break-in." },
  { id: "temp-exec", title: "Program run from a temp folder", severity: "medium", attack: ATTACK.userExecution, re: /(\/tmp\/|\/dev\/shm\/|\/var\/tmp\/|\\AppData\\Local\\Temp\\|\\Windows\\Temp\\)[^\s"']+\.(sh|elf|bin|exe|dll|ps1|vbs|js|hta)\b|chmod\s+\+x\s+\/(tmp|dev\/shm)\//i, detail: "Executables in temp folders are a common malware landing spot." },
];

const WEB_REQUEST = /^(\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|PROPFIND|CONNECT)\s+(\S+)[^"]*"\s+(\d{3})/;
const WEB_ATTACKS: Array<{ id: string; title: string; severity: Severity; re: RegExp; detail: string }> = [
  { id: "web-log4shell", title: "Log4Shell (JNDI) probe", severity: "critical", re: /\$\{jndi:|%24%7Bjndi/i, detail: "Requests carrying a JNDI lookup, the Log4Shell exploit string." },
  { id: "web-sqli", title: "SQL injection attempts", severity: "high", re: /\bunion\b.{0,30}\bselect\b|'\s*or\s*'?1'?\s*=\s*'?1|\bsleep\s*\(\s*\d|benchmark\s*\(|information_schema|xp_cmdshell|%27%20or%20/i, detail: "Requests trying to inject SQL." },
  { id: "web-traversal", title: "Path traversal attempts", severity: "high", re: /\.\.\/|\.\.%2f|%2e%2e(%2f|\/)|\/etc\/passwd|win\.ini|boot\.ini/i, detail: "Requests trying to read files outside the web root." },
  { id: "web-xss", title: "Cross-site scripting attempts", severity: "medium", re: /<script|%3cscript|javascript:|onerror\s*=|%3Csvg/i, detail: "Requests trying to inject scripts." },
  { id: "web-cmdi", title: "Command injection attempts", severity: "high", re: /(;|%3b|\||%7c|`|\$\(|%24%28)\s*(cat|id|whoami|uname|wget|curl|nc|bash|sh)\b|\/bin\/(ba)?sh|cmd\.exe/i, detail: "Requests trying to run shell commands on the server." },
  { id: "web-sensitive", title: "Probes for sensitive files and admin panels", severity: "medium", re: /\/\.env\b|\/\.git\/|\/wp-login\.php|\/xmlrpc\.php|phpmyadmin|\/actuator\/|\/server-status|\/\.aws\/|\/config\.(json|php|yml)|\/backup\.(zip|sql|tar)/i, detail: "Requests looking for secrets, source control and admin pages." },
];
const SCANNER_UA = /\b(sqlmap|nikto|nmap|masscan|zgrab|gobuster|dirbuster|feroxbuster|wpscan|nuclei|acunetix|nessus|openvas|hydra|wfuzz|ffuf)\b/i;

/**
 * The deterministic investigation: indicators, a timeline and every detector
 * over every line. The model is given this report, not the raw log, so its
 * story is bound to evidence.
 */
export function investigate(text: string, source: string, yearHint = new Date().getUTCFullYear()): InvestigationReport {
  const lines = text.split(/\r?\n/).slice(0, 200_000);
  const findings = new Map<string, SecurityFinding>();
  const add = (key: string, base: Omit<SecurityFinding, "evidence" | "count">, line: string) => {
    const f = findings.get(key) ?? { ...base, evidence: [], count: 0 };
    f.count = (f.count ?? 0) + 1;
    if (f.evidence.length < 3) f.evidence.push(evidenceLine(line));
    findings.set(key, f);
  };

  const failedByIp = new Map<string, { n: number; users: Set<string>; sample: string }>();
  const successAfterFail: string[] = [];
  const webByIp = new Map<string, { errors: number; attacks: number; sample: string }>();
  const minutes = new Map<string, number>();
  let first: number | null = null;
  let last: number | null = null;
  let parsed = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const t = parseTimestamp(line, yearHint);
    if (t !== null) {
      parsed++;
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
      const minute = iso(t).slice(0, 16);
      minutes.set(minute, (minutes.get(minute) ?? 0) + 1);
    }

    // Authentication: failures per source, and a success from a source that was failing.
    const fail = line.match(/Failed password for (?:invalid user )?(\S+) from (\d{1,3}(?:\.\d{1,3}){3})|Invalid user (\S+) from (\d{1,3}(?:\.\d{1,3}){3})|authentication failure;.*rhost=(\d{1,3}(?:\.\d{1,3}){3})(?:.*user=(\S+))?/);
    const winFail = /EventID[=: ]+4625\b|An account failed to log on/i.test(line) ? line.match(IPV4)?.[0] : undefined;
    if (fail || winFail) {
      const ip = fail ? fail[2] ?? fail[4] ?? fail[5] : winFail!;
      const user = fail ? fail[1] ?? fail[3] ?? fail[6] ?? "?" : "?";
      const entry = failedByIp.get(ip) ?? { n: 0, users: new Set<string>(), sample: line };
      entry.n++;
      entry.users.add(user);
      failedByIp.set(ip, entry);
    }
    const ok = line.match(/Accepted (?:password|publickey|keyboard-interactive\/pam) for (\S+) from (\d{1,3}(?:\.\d{1,3}){3})/);
    const winOk = /EventID[=: ]+4624\b|An account was successfully logged on/i.test(line) ? line.match(IPV4)?.[0] : undefined;
    const okIp = ok?.[2] ?? winOk;
    if (okIp && (failedByIp.get(okIp)?.n ?? 0) >= 5) successAfterFail.push(line);

    for (const d of LINE_DETECTORS) {
      if (d.re.test(line)) add(d.id, { id: d.id, title: d.title, severity: d.severity, detail: d.detail, attack: d.attack }, line);
    }

    // Web access logs: attacks by pattern, scanners, error bursts per client.
    const req = line.match(WEB_REQUEST);
    if (req) {
      const [, ip, , path, status] = req;
      let decoded = path;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        // keep the raw path
      }
      const w = webByIp.get(ip) ?? { errors: 0, attacks: 0, sample: line };
      if (Number(status) >= 400) w.errors++;
      for (const a of WEB_ATTACKS) {
        if (a.re.test(path) || a.re.test(decoded)) {
          w.attacks++;
          const landed = Number(status) < 400 && a.severity !== "medium";
          add(`${a.id}${landed ? "-landed" : ""}`, {
            id: a.id,
            title: landed ? `${a.title}, answered with ${status}` : a.title,
            severity: landed ? "critical" : a.severity,
            detail: landed ? `${a.detail} At least one got a success response: check whether it worked.` : a.detail,
            attack: ATTACK.exploitPublic,
          }, line);
        }
      }
      if (SCANNER_UA.test(line)) add("web-scanner", { id: "web-scanner", title: "Vulnerability scanner traffic", severity: "medium", detail: "Requests from known scanning tools.", attack: ATTACK.activeScanning }, line);
      webByIp.set(ip, w);
    }
  }

  for (const [ip, e] of failedByIp) {
    if (e.n < 10) continue;
    const f: SecurityFinding = {
      id: `brute-force-${ip}`,
      title: `Password guessing from ${defang(ip)}`,
      severity: e.n >= 100 ? "high" : "medium",
      detail: `${e.n} failed logins from ${defang(ip)} for ${e.users.size} account name${e.users.size === 1 ? "" : "s"} (${[...e.users].slice(0, 5).join(", ")}).`,
      evidence: [evidenceLine(e.sample)],
      attack: ATTACK.bruteForce,
      count: e.n,
    };
    findings.set(f.id, f);
  }
  if (successAfterFail.length) {
    findings.set("success-after-failure", {
      id: "success-after-failure",
      title: "Login succeeded from a source that was guessing passwords",
      severity: "critical",
      detail: "A source with many failed logins then logged in successfully. Treat the account as compromised until proven otherwise.",
      evidence: successAfterFail.slice(0, 3).map(evidenceLine),
      attack: ATTACK.validAccounts,
      count: successAfterFail.length,
    });
  }
  for (const [ip, w] of webByIp) {
    if (w.errors >= 50 && w.attacks === 0) {
      findings.set(`web-burst-${ip}`, {
        id: `web-burst-${ip}`,
        title: `Error burst from ${defang(ip)}`,
        severity: "low",
        detail: `${w.errors} error responses for one client, typical of directory brute forcing or a broken crawler.`,
        evidence: [evidenceLine(w.sample)],
        attack: ATTACK.activeScanning,
        count: w.errors,
      });
    }
  }

  // Decode the encoded PowerShell so the analyst sees what it does (defanged).
  const ps = findings.get("encoded-powershell");
  if (ps) {
    const payload = text.match(/\s-(?:e|en|enc|enco|encodedcommand)\s+([A-Za-z0-9+/=]{20,})/i)?.[1];
    const decoded = payload ? decodePowerShell(payload) : null;
    if (decoded) ps.detail += ` Decoded: ${clip(defang(maskSecrets(decoded)), 240)}`;
  }

  const peaks = [...minutes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([minute, count]) => ({ minute: `${minute}Z`, count }));
  const sorted = [...findings.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (b.count ?? 0) - (a.count ?? 0));
  return {
    mode: "investigate",
    source,
    lines: lines.filter((l) => l.trim()).length,
    timeline: { first: first === null ? null : iso(first), last: last === null ? null : iso(last), parsed, peaks },
    indicators: extractIndicators(text),
    findings: sorted,
  };
}

/** PowerShell -EncodedCommand is base64 of UTF-16LE text. */
export function decodePowerShell(b64: string): string | null {
  try {
    const bin = atob(b64);
    let out = "";
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
    return /^[\x09\x0a\x0d\x20-\x7e]+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

// ─── Hardening: configs ───────────────────────────────────────────────────────

type Check = (text: string) => SecurityFinding[];

const finding = (id: string, title: string, severity: Severity, detail: string, fix?: string, evidence: string[] = []): SecurityFinding => ({ id, title, severity, detail, fix, evidence: evidence.map(evidenceLine) });

/** Global-section sshd directives (before the first Match block), lowercase keys. */
function sshdDirectives(text: string): Map<string, { value: string; line: string }> {
  const map = new Map<string, { value: string; line: string }>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^match\s/i.test(line)) break;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (m && !map.has(m[1].toLowerCase())) map.set(m[1].toLowerCase(), { value: m[2].trim(), line });
  }
  return map;
}

/** The sshd settings every finding converges on. */
const SSHD_TARGET: Array<{ key: string; value: string }> = [
  { key: "PermitRootLogin", value: "no" },
  { key: "PasswordAuthentication", value: "no" },
  { key: "KbdInteractiveAuthentication", value: "no" },
  { key: "PermitEmptyPasswords", value: "no" },
  { key: "PubkeyAuthentication", value: "yes" },
  { key: "MaxAuthTries", value: "3" },
  { key: "LoginGraceTime", value: "30" },
  { key: "X11Forwarding", value: "no" },
  { key: "AllowAgentForwarding", value: "no" },
  { key: "ClientAliveInterval", value: "300" },
  { key: "ClientAliveCountMax", value: "2" },
];

const checkSshd: Check = (text) => {
  const d = sshdDirectives(text);
  const get = (k: string) => d.get(k.toLowerCase());
  const out: SecurityFinding[] = [];
  const root = get("PermitRootLogin");
  if (!root) out.push(finding("ssh-root-default", "Root login not explicitly disabled", "medium", "PermitRootLogin is not set, so the default applies (key-only root logins on modern OpenSSH, full root logins on old builds).", "PermitRootLogin no"));
  else if (!/^no$/i.test(root.value)) out.push(finding("ssh-root", "Root can log in over SSH", /^yes$/i.test(root.value) ? "high" : "medium", `PermitRootLogin is "${root.value}". Log in as a normal user and use sudo, so every admin action is tied to a person.`, "PermitRootLogin no", [root.line]));
  const pw = get("PasswordAuthentication");
  if (!pw || /^yes$/i.test(pw.value)) out.push(finding("ssh-passwords", "Password logins are allowed", "high", pw ? "PasswordAuthentication is yes: the server can be brute forced." : "PasswordAuthentication is not set and defaults to yes: the server can be brute forced.", "PasswordAuthentication no", pw ? [pw.line] : []));
  for (const k of ["KbdInteractiveAuthentication", "ChallengeResponseAuthentication"]) {
    const v = get(k);
    if (v && /^yes$/i.test(v.value)) out.push(finding(`ssh-${k.toLowerCase()}`, `${k} is on`, "medium", "Keyboard-interactive logins can bring passwords back in through PAM.", `${k} no`, [v.line]));
  }
  const empty = get("PermitEmptyPasswords");
  if (empty && /^yes$/i.test(empty.value)) out.push(finding("ssh-empty", "Empty passwords are allowed", "critical", "Accounts without a password can log in.", "PermitEmptyPasswords no", [empty.line]));
  const proto = get("Protocol");
  if (proto && /1/.test(proto.value)) out.push(finding("ssh-protocol1", "SSH protocol 1 enabled", "critical", "Protocol 1 is broken and removed from modern OpenSSH.", "Protocol 2", [proto.line]));
  const tries = Number(get("MaxAuthTries")?.value ?? 6);
  if (tries > 4) out.push(finding("ssh-maxauthtries", "Too many login attempts per connection", "low", `MaxAuthTries is ${tries}; 3 slows guessing without bothering real users.`, "MaxAuthTries 3"));
  const grace = Number(get("LoginGraceTime")?.value?.replace(/s$/i, "") ?? 120);
  if (grace > 60) out.push(finding("ssh-grace", "Long login grace time", "low", `LoginGraceTime is ${grace}s, which lets idle unauthenticated connections pile up.`, "LoginGraceTime 30"));
  const x11 = get("X11Forwarding");
  if (x11 && /^yes$/i.test(x11.value)) out.push(finding("ssh-x11", "X11 forwarding is on", "low", "Rarely needed on servers and widens the attack surface.", "X11Forwarding no", [x11.line]));
  if (!get("AllowUsers") && !get("AllowGroups")) out.push(finding("ssh-allowlist", "No allow-list of who may log in", "medium", "Any account with a valid key or password can log in. Limit SSH to the people who need it.", "AllowGroups ssh-users   # then: groupadd ssh-users && usermod -aG ssh-users <you>"));
  const weak = [
    { k: "Ciphers", re: /(cbc|arcfour|3des|blowfish)/i, fix: "Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr" },
    { k: "MACs", re: /(md5|sha1-96|umac-64\b|hmac-sha1\b)/i, fix: "MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com" },
    { k: "KexAlgorithms", re: /(group1-sha1|group14-sha1|group-exchange-sha1)/i, fix: "KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512" },
  ];
  for (const w of weak) {
    const v = get(w.k);
    if (v && w.re.test(v.value)) out.push(finding(`ssh-weak-${w.k.toLowerCase()}`, `Weak ${w.k}`, "high", `${w.k} includes legacy algorithms that are breakable or deprecated.`, w.fix, [v.line]));
  }
  if (!get("ClientAliveInterval")) out.push(finding("ssh-idle", "Idle sessions never time out", "low", "Abandoned sessions stay open indefinitely.", "ClientAliveInterval 300\nClientAliveCountMax 2"));
  return out;
};

/** sshd_config with every SSHD_TARGET setting applied in the global section. */
export function patchSshd(text: string): string {
  const lines = text.split(/\r?\n/);
  const matchAt = lines.findIndex((l) => /^\s*match\s/i.test(l));
  const globalEnd = matchAt < 0 ? lines.length : matchAt;
  const seen = new Set<string>();
  for (let i = 0; i < globalEnd; i++) {
    const m = lines[i].match(/^\s*(\S+)\s+(.+)$/);
    if (!m || lines[i].trim().startsWith("#")) continue;
    const target = SSHD_TARGET.find((t) => t.key.toLowerCase() === m[1].toLowerCase());
    if (!target) continue;
    if (seen.has(target.key)) {
      lines[i] = `# ${lines[i].trim()}   # duplicate, the first value wins`;
      continue;
    }
    seen.add(target.key);
    if (m[2].trim() !== target.value) lines[i] = `${target.key} ${target.value}   # hardened by PrismOS (was: ${m[2].trim()})`;
  }
  const missing = SSHD_TARGET.filter((t) => !seen.has(t.key)).map((t) => `${t.key} ${t.value}`);
  if (missing.length) lines.splice(globalEnd, 0, "", "# --- hardened by PrismOS ---", ...missing, "");
  return lines.join("\n");
}

const checkNginx: Check = (text) => {
  const out: SecurityFinding[] = [];
  if (!/server_tokens\s+off/i.test(text)) out.push(finding("nginx-tokens", "Version number is advertised", "low", "nginx shows its version in headers and error pages, which helps attackers pick exploits.", "server_tokens off;"));
  const protocols = text.match(/ssl_protocols\s+([^;]+);/i);
  if (protocols && /(SSLv2|SSLv3|TLSv1(\s|;|$)|TLSv1\.1)/i.test(`${protocols[1]};`)) out.push(finding("nginx-tls", "Old TLS versions enabled", "high", `ssl_protocols allows ${protocols[1].trim()}; TLS 1.0/1.1 and SSL are broken.`, "ssl_protocols TLSv1.2 TLSv1.3;", [protocols[0]]));
  const ciphers = text.match(/ssl_ciphers\s+([^;]+);/i);
  if (ciphers && /(RC4|MD5|3DES|DES-|NULL|EXPORT|aNULL)/i.test(ciphers[1]) && !/!(RC4|MD5|3DES|NULL|EXPORT|aNULL)/i.test(ciphers[1])) out.push(finding("nginx-ciphers", "Weak TLS ciphers", "high", "The cipher list includes broken ciphers.", "ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;", [ciphers[0]]));
  if (/listen\s+(\[::\]:)?80\b/.test(text) && !/listen\s+[^;]*443/.test(text)) out.push(finding("nginx-https", "Served over plain HTTP only", "high", "Traffic, cookies and logins travel unencrypted.", "listen 443 ssl;\nhttp2 on;\nssl_certificate /etc/letsencrypt/live/<site>/fullchain.pem;\nssl_certificate_key /etc/letsencrypt/live/<site>/privkey.pem;\n# and in the port 80 server: return 301 https://$host$request_uri;"));
  const headers: Array<{ name: string; value: string; severity: Severity; why: string }> = [
    { name: "Strict-Transport-Security", value: '"max-age=63072000; includeSubDomains" always', severity: "medium", why: "browsers stay on HTTPS" },
    { name: "X-Content-Type-Options", value: '"nosniff" always', severity: "low", why: "no MIME sniffing" },
    { name: "Content-Security-Policy", value: "\"default-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'\" always", severity: "medium", why: "limits what injected scripts can do and blocks framing" },
    { name: "Referrer-Policy", value: '"strict-origin-when-cross-origin" always', severity: "low", why: "less URL leakage to other sites" },
    { name: "Permissions-Policy", value: '"camera=(), microphone=(), geolocation=()" always', severity: "low", why: "turns off powerful browser features you don't use" },
  ];
  const missing = headers.filter((h) => !new RegExp(`add_header\\s+${h.name}`, "i").test(text));
  if (missing.length) out.push(finding("nginx-headers", `Missing security headers (${missing.map((h) => h.name).join(", ")})`, missing.some((h) => h.severity === "medium") ? "medium" : "low", missing.map((h) => `${h.name}: ${h.why}`).join("; "), missing.map((h) => `add_header ${h.name} ${h.value};`).join("\n")));
  if (/autoindex\s+on/i.test(text)) out.push(finding("nginx-autoindex", "Directory listings are on", "medium", "Anyone can browse the files in those folders.", "autoindex off;"));
  if (!/location\s+~\s*\/\\\./.test(text)) out.push(finding("nginx-dotfiles", "Dotfiles are not blocked", "medium", ".env, .git and similar files could be served if they sit under the web root.", "location ~ /\\.(?!well-known) { deny all; }"));
  if (!/limit_req_zone/i.test(text)) out.push(finding("nginx-ratelimit", "No rate limiting", "info", "Login and API endpoints can be hammered without limits.", "limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;\n# in the login location: limit_req zone=login burst=5 nodelay;"));
  return out;
};

const checkDockerfile: Check = (text) => {
  const out: SecurityFinding[] = [];
  const lines = text.split(/\r?\n/);
  const user = lines.filter((l) => /^\s*USER\s+/i.test(l)).pop();
  if (!user || /^\s*USER\s+(root|0)(\s|:|$)/i.test(user)) out.push(finding("docker-root", "Container runs as root", "high", "If the app is compromised, the attacker is root inside the container, one step from the host.", "RUN addgroup --system app && adduser --system --ingroup app app\nUSER app", user ? [user] : []));
  for (const l of lines.filter((x) => /^\s*FROM\s+/i.test(x))) {
    const image = l.trim().split(/\s+/)[1] ?? "";
    if (/^scratch$/i.test(image) || image.startsWith("$")) continue;
    if (!/[:@]/.test(image.split("/").pop() ?? "") || /:latest$/i.test(image)) out.push(finding(`docker-unpinned-${image}`, `Base image not pinned (${image})`, "medium", "Builds pull whatever the tag points to that day, so they are not reproducible and can change under you.", `FROM ${image.replace(/:latest$/i, "")}:<version>@sha256:<digest>`, [l]));
  }
  for (const l of lines.filter((x) => /^\s*(ENV|ARG)\s+/i.test(x))) {
    if (/(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)\w*\s*[= ]\s*\S+/i.test(l)) out.push(finding("docker-secret", "Secret baked into the image", "critical", "ENV/ARG values are stored in the image layers; anyone with the image can read them.", "RUN --mount=type=secret,id=api_key ...   # docker build --secret id=api_key,src=api_key.txt", [l]));
  }
  if (lines.some((l) => /^\s*ADD\s+https?:\/\//i.test(l))) out.push(finding("docker-add-url", "ADD downloads from a URL", "medium", "No checksum is verified, so a tampered download goes straight into the image.", "RUN curl -fsSLo /tmp/file <url> && echo '<sha256>  /tmp/file' | sha256sum -c -"));
  else if (lines.some((l) => /^\s*ADD\s+/i.test(l))) out.push(finding("docker-add", "ADD used for local files", "low", "ADD also unpacks archives and fetches URLs; COPY does only what it says.", "COPY <src> <dest>"));
  if (lines.some((l) => /(curl|wget)[^|]*\|\s*(ba)?sh/i.test(l))) out.push(finding("docker-curl-sh", "Remote script piped into a shell", "high", "Whatever that URL serves at build time runs as root in your build.", "Download, verify the checksum, then run the script."));
  if (lines.some((l) => /^\s*EXPOSE\s+.*\b22\b/i.test(l))) out.push(finding("docker-ssh", "SSH port exposed", "medium", "Containers should not run sshd; use docker exec or kubectl exec.", "Remove sshd and EXPOSE 22."));
  if (lines.some((l) => /chmod\s+(-R\s+)?777/.test(l))) out.push(finding("docker-777", "World-writable permissions", "medium", "chmod 777 lets any process change those files.", "chmod -R u=rwX,go=rX <path>"));
  if (lines.some((l) => /apt-get\s+install/.test(l)) && !lines.some((l) => /--no-install-recommends/.test(l))) out.push(finding("docker-apt", "Extra packages installed", "low", "Recommended packages add attack surface you don't need.", "RUN apt-get update && apt-get install -y --no-install-recommends <pkgs> && rm -rf /var/lib/apt/lists/*"));
  if (!lines.some((l) => /^\s*HEALTHCHECK\s/i.test(l))) out.push(finding("docker-health", "No health check", "info", "The orchestrator can't tell a hung container from a healthy one.", "HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://localhost:8080/health || exit 1"));
  return out;
};

const DB_PORTS = /\b(5432|3306|6379|27017|9200|11211|5984|9042|1433|1521)\b/;
const checkCompose: Check = (text) => {
  const out: SecurityFinding[] = [];
  const lines = text.split(/\r?\n/);
  const hit = (re: RegExp) => lines.filter((l) => re.test(l));
  if (hit(/privileged:\s*true/).length) out.push(finding("compose-privileged", "Privileged container", "critical", "A privileged container can take over the host.", "privileged: false   # add only the capabilities it needs: cap_add: [NET_BIND_SERVICE]", hit(/privileged:\s*true/)));
  if (hit(/\/var\/run\/docker\.sock/).length) out.push(finding("compose-docker-sock", "Docker socket mounted", "critical", "Access to the Docker socket is root on the host.", "Remove the docker.sock mount (or use a filtered socket proxy).", hit(/\/var\/run\/docker\.sock/)));
  if (hit(/network_mode:\s*["']?host/).length) out.push(finding("compose-host-net", "Host networking", "high", "The container shares the host's network stack and can reach everything the host can.", "Remove network_mode: host and publish only the ports you need.", hit(/network_mode:\s*["']?host/)));
  if (hit(/^\s*pid:\s*["']?host/).length) out.push(finding("compose-host-pid", "Host PID namespace", "high", "The container can see and signal host processes.", "Remove pid: host.", hit(/^\s*pid:\s*["']?host/)));
  if (hit(/cap_add:.*\b(ALL|SYS_ADMIN)\b|-\s*(ALL|SYS_ADMIN)\s*$/).length) out.push(finding("compose-caps", "Dangerous capabilities added", "high", "ALL or SYS_ADMIN is close to privileged.", "cap_drop: [ALL]\ncap_add: [<only what is needed>]", hit(/cap_add:.*\b(ALL|SYS_ADMIN)\b|-\s*(ALL|SYS_ADMIN)\s*$/)));
  const mounts = hit(/^\s*-\s*["']?\/(etc|root|var\/lib|home)?["']?(:|\/?:)/);
  if (mounts.length) out.push(finding("compose-host-mount", "Sensitive host paths mounted", "high", "Mounting /, /etc or /root gives the container control over host files.", "Mount only the specific data directory, read-only where possible (:ro).", mounts));
  const exposed = hit(/^\s*-\s*["']?(0\.0\.0\.0:)?\d+:\d+/).filter((l) => DB_PORTS.test(l) && !/127\.0\.0\.1:/.test(l));
  if (exposed.length) out.push(finding("compose-db-exposed", "Database port published to every interface", "high", "Databases on 0.0.0.0 are reachable from the network (and Docker bypasses ufw).", '- "127.0.0.1:5432:5432"   # or drop ports: and use the internal network', exposed));
  const secrets = hit(/(PASSWORD|SECRET|TOKEN|API_?KEY)\w*\s*[:=]\s*\S+/i).filter((l) => !/\$\{/.test(l));
  if (secrets.length) out.push(finding("compose-secrets", "Secrets written into the compose file", "high", "Anyone who can read the repo can read them.", "env_file: .env   # keep .env out of git, or use Docker secrets", secrets));
  if (hit(/image:\s*\S+:latest\b|image:\s*[^:\s]+\s*$/).length) out.push(finding("compose-latest", "Images not pinned", "medium", "latest changes under you.", "image: <name>:<version>@sha256:<digest>", hit(/image:\s*\S+:latest\b|image:\s*[^:\s]+\s*$/)));
  if (!/no-new-privileges/.test(text)) out.push(finding("compose-nnp", "Privilege escalation not blocked", "low", "setuid binaries inside the container can still raise privileges.", "security_opt:\n  - no-new-privileges:true"));
  if (!/read_only:\s*true/.test(text)) out.push(finding("compose-readonly", "Writable root filesystem", "info", "A read-only root makes it much harder to drop tools.", "read_only: true\ntmpfs: [/tmp]"));
  return out;
};

const checkKubernetes: Check = (text) => {
  const out: SecurityFinding[] = [];
  const lines = text.split(/\r?\n/);
  const hit = (re: RegExp) => lines.filter((l) => re.test(l));
  if (hit(/privileged:\s*true/).length) out.push(finding("k8s-privileged", "Privileged pod", "critical", "A privileged container can take over the node.", "securityContext:\n  privileged: false", hit(/privileged:\s*true/)));
  for (const k of ["hostNetwork", "hostPID", "hostIPC"]) if (hit(new RegExp(`${k}:\\s*true`)).length) out.push(finding(`k8s-${k.toLowerCase()}`, `${k} enabled`, "high", "The pod shares the node's namespace.", `${k}: false`, hit(new RegExp(`${k}:\\s*true`))));
  if (hit(/hostPath:/).length) out.push(finding("k8s-hostpath", "hostPath volume", "high", "Node files are mounted into the pod.", "Use a PersistentVolumeClaim, configMap or emptyDir instead.", hit(/hostPath:/)));
  if (!/runAsNonRoot:\s*true/.test(text)) out.push(finding("k8s-root", "May run as root", "high", "Nothing stops the container from running as UID 0.", "securityContext:\n  runAsNonRoot: true\n  runAsUser: 10001"));
  if (!/allowPrivilegeEscalation:\s*false/.test(text)) out.push(finding("k8s-escalation", "Privilege escalation allowed", "medium", "setuid binaries can raise privileges.", "securityContext:\n  allowPrivilegeEscalation: false"));
  if (!/drop:\s*(\[\s*["']?ALL|\n\s*-\s*["']?ALL)/.test(text)) out.push(finding("k8s-caps", "Linux capabilities not dropped", "medium", "Containers keep the default capability set.", "securityContext:\n  capabilities:\n    drop: [ALL]"));
  if (!/readOnlyRootFilesystem:\s*true/.test(text)) out.push(finding("k8s-readonly", "Writable root filesystem", "low", "A read-only root makes dropping tools much harder.", "securityContext:\n  readOnlyRootFilesystem: true"));
  if (/containers:/.test(text) && !/limits:/.test(text)) out.push(finding("k8s-limits", "No resource limits", "medium", "One pod can starve the node (or be used for cryptomining).", "resources:\n  limits: { cpu: \"500m\", memory: \"512Mi\" }\n  requests: { cpu: \"100m\", memory: \"128Mi\" }"));
  const images = hit(/image:\s*\S+/).filter((l) => /:latest\b/.test(l) || !/:[\w.-]+(@sha256:)?/.test(l.split("image:")[1].trim().split("/").pop() ?? ""));
  if (images.length) out.push(finding("k8s-latest", "Images not pinned", "medium", "latest changes under you.", "image: <registry>/<name>:<version>@sha256:<digest>", images));
  if (/kind:\s*(Deployment|Pod|StatefulSet|DaemonSet|Job|CronJob)/.test(text) && !/automountServiceAccountToken:\s*false/.test(text)) out.push(finding("k8s-sa-token", "Service account token mounted", "low", "Every pod gets an API token by default; most never need it.", "automountServiceAccountToken: false"));
  const secretEnv = lines.filter((l, i) => /-\s*name:\s*\S*(PASSWORD|SECRET|TOKEN|API_?KEY)/i.test(l) && /value:\s*\S+/.test(lines[i + 1] ?? ""));
  if (secretEnv.length) out.push(finding("k8s-secret-env", "Secret values written in the manifest", "high", "Use a Secret and valueFrom.secretKeyRef instead.", "valueFrom:\n  secretKeyRef: { name: app-secrets, key: password }", secretEnv));
  return out;
};

const checkDotenv: Check = (text) => {
  const out: SecurityFinding[] = [];
  const kinds = findSecrets(text);
  const keyed = text.split(/\r?\n/).filter((l) => /^\s*(export\s+)?\w*(PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY)\w*\s*=\s*\S+/i.test(l));
  if (kinds.length || keyed.length) out.push(finding("env-secrets", `Live secrets in this file${kinds.length ? ` (${kinds.join(", ")})` : ""}`, "critical", "If this file was ever committed, shared or pasted, rotate these credentials now. Keep .env out of git and out of images.", "echo '.env' >> .gitignore\ngit rm --cached .env   # then rotate every key in it", keyed.slice(0, 3)));
  const weak = text.split(/\r?\n/).filter((l) => /PASSWORD\w*\s*=\s*["']?([^"'\s]{0,11})["']?\s*$/i.test(l) && !/=\s*["']?\$\{/.test(l));
  if (weak.length) out.push(finding("env-weak-password", "Short passwords", "high", "Passwords under 12 characters fall to guessing.", "openssl rand -base64 24", weak.slice(0, 3)));
  const debug = text.split(/\r?\n/).filter((l) => /^(DEBUG|APP_DEBUG|FLASK_DEBUG)\s*=\s*(1|true|yes)/i.test(l) || /^(NODE_ENV|APP_ENV|RAILS_ENV)\s*=\s*(dev|development)/i.test(l));
  if (debug.length) out.push(finding("env-debug", "Debug mode on", "medium", "Debug pages leak stack traces, config and sometimes a console.", "DEBUG=false\nNODE_ENV=production", debug));
  return out;
};

const checkNpm: Check = (text) => {
  const out: SecurityFinding[] = [];
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(text);
  } catch {
    return [finding("npm-json", "package.json is not valid JSON", "info", "Fix the syntax first.")];
  }
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (/(curl|wget)[^|]*\|\s*(ba)?sh|node\s+-e\s+.*https?:/.test(cmd)) out.push(finding(`npm-script-${name}`, `Script "${name}" downloads and runs code`, "high", "This runs on every install or build, including on CI and teammates' machines.", "Vendor the script into the repo and review it.", [`"${name}": "${cmd}"`]));
    if (/^(pre|post)?install$/.test(name)) out.push(finding(`npm-install-hook-${name}`, `Install hook "${name}"`, "low", "Install hooks run automatically; keep them minimal and reviewed.", undefined, [`"${name}": "${cmd}"`]));
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const loose = Object.entries(deps).filter(([, v]) => v === "*" || v === "latest" || v === "");
  if (loose.length) out.push(finding("npm-unpinned", "Dependencies with no version range", "medium", `${loose.map(([k]) => k).join(", ")} will install whatever is newest, including a compromised release.`, loose.map(([k]) => `"${k}": "^<current version>"`).join("\n")));
  const insecure = Object.entries(deps).filter(([, v]) => /^(git\+)?http:\/\//.test(v));
  if (insecure.length) out.push(finding("npm-http", "Dependencies fetched over plain HTTP", "high", "A network attacker can swap the code.", insecure.map(([k]) => `"${k}": "<registry version or https URL>"`).join("\n")));
  out.push(finding("npm-audit", "Run the lockfile audit", "info", "Known vulnerable versions show up in the audit, not in package.json.", "npm audit --omit=dev   # and commit package-lock.json"));
  return out;
};

const checkGithubActions: Check = (text) => {
  const out: SecurityFinding[] = [];
  const lines = text.split(/\r?\n/);
  if (/pull_request_target/.test(text) && /ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(text)) out.push(finding("gha-prt-checkout", "pull_request_target checks out untrusted code", "critical", "Forked PRs run with your secrets and a write token.", "Use on: pull_request for untrusted code, or don't check out the PR head in pull_request_target."));
  if (!/^\s*permissions:/m.test(text)) out.push(finding("gha-permissions", "Default token permissions", "medium", "The GITHUB_TOKEN may get broad write access by default.", "permissions:\n  contents: read"));
  const unpinned = lines.filter((l) => /uses:\s*[\w.-]+\/[\w.-]+@(?![0-9a-f]{40}\b)\S+/.test(l) && !/uses:\s*actions\//.test(l));
  if (unpinned.length) out.push(finding("gha-unpinned", "Third-party actions pinned by tag", "medium", "A tag can be moved to malicious code; a commit SHA can't.", "uses: owner/action@<40-char commit sha>   # vX.Y.Z", unpinned.slice(0, 3)));
  const injection = lines.filter((l) => /run:.*\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit)\.(title|body|head\.ref|message|label)/.test(l) || /^\s+.*\$\{\{\s*github\.event\.(issue|pull_request|comment)\.(title|body)/.test(l));
  if (injection.length) out.push(finding("gha-injection", "Untrusted text interpolated into a shell", "high", "An issue title or PR body can inject commands.", "env:\n  TITLE: ${{ github.event.issue.title }}\nrun: echo \"$TITLE\"", injection.slice(0, 3)));
  return out;
};

const CHECKS: Record<ConfigType, Check> = {
  sshd: checkSshd,
  nginx: checkNginx,
  dockerfile: checkDockerfile,
  compose: checkCompose,
  kubernetes: checkKubernetes,
  dotenv: checkDotenv,
  npm: checkNpm,
  "github-actions": checkGithubActions,
};

export const CONFIG_LABEL: Record<ConfigType, string> = {
  sshd: "SSH server (sshd_config)",
  nginx: "nginx",
  dockerfile: "Dockerfile",
  compose: "Docker Compose",
  kubernetes: "Kubernetes manifest",
  dotenv: ".env file",
  npm: "package.json",
  "github-actions": "GitHub Actions workflow",
};

/** Check one config. Secrets anywhere in it are always a finding. */
export function hardeningReview(text: string, source: string, type?: ConfigType | null): HardeningReport | null {
  const configType = type ?? detectConfigType(text, source);
  if (!configType) return null;
  const findings = CHECKS[configType](text);
  if (configType !== "dotenv") {
    const kinds = findSecrets(text);
    if (kinds.length) findings.unshift(finding("secrets", `Credentials in the file (${kinds.join(", ")})`, "critical", "Rotate them and move them to a secret store; anyone with this file has them.", "Replace with a reference (env var, secret manager), then rotate the old values."));
  }
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return { mode: "harden", source, configType, findings, patched: configType === "sshd" ? patchSshd(text) : undefined };
}

// ─── Hardening: platform checklists ───────────────────────────────────────────

// Most specific first: "harden my postgres server" is about postgres, not the server.
const TOPIC_MATCH: Array<[string, RegExp]> = [
  ["ssh", /\bssh\b|sshd/],
  ["nginx", /\bnginx\b/],
  ["apache", /\bapache|httpd\b/],
  ["kubernetes", /\bkubernetes|k8s|kubectl|eks|aks|gke\b/],
  ["docker", /\bdocker|container/],
  ["postgres", /\bpostgres(ql)?\b/],
  ["mysql", /\bmysql|mariadb\b/],
  ["redis", /\bredis\b/],
  ["mongodb", /\bmongo(db)?\b/],
  ["wordpress", /\bwordpress|\bwp\b/],
  ["aws", /\baws|amazon web services|s3 bucket|iam\b/],
  ["azure", /\bazure|entra\b/],
  ["gcp", /\bgcp|google cloud\b/],
  ["github", /\bgithub|git repo|repository\b/],
  ["router", /\brouter|wi-?fi|home network\b/],
  ["windows", /\bwindows|active directory|domain controller/],
  ["macos", /\bmac(os|book)?\b/],
  ["webapp", /\b(web\s?app|website|api|node|express|django|flask|rails|react|next\.?js|php)\b/],
  ["linux", /\b(linux|ubuntu|debian|centos|rhel|rocky|fedora|vps|server)\b/],
  ["accounts", /\b(my )?(accounts?|passwords?|email|gmail|phone)\b/],
];

/** What a seasoned hardening checklist covers for each platform; the model expands it into steps. */
export const HARDENING_CHECKLISTS: Record<string, string[]> = {
  ssh: ["keys only: PasswordAuthentication no, PermitRootLogin no", "AllowGroups for the people who need SSH", "fail2ban or sshguard on the auth log", "modern Ciphers/MACs/KexAlgorithms", "MaxAuthTries 3, LoginGraceTime 30, idle timeouts", "verify with: sshd -t, then ssh -v from a second session before closing the first"],
  linux: ["automatic security updates (unattended-upgrades / dnf-automatic)", "firewall default deny inbound (ufw / firewalld), only needed ports", "SSH keys only, no root login, fail2ban", "remove unused packages and services (ss -tulpn)", "sudo with named users, no shared accounts", "auditd or journald persistent logs shipped off the box", "file integrity (AIDE) and a backup you have restored once", "sysctl network hardening (rp_filter, no ICMP redirects, syncookies)"],
  nginx: ["TLS 1.2/1.3 only, modern ciphers, HSTS", "server_tokens off", "security headers: CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy", "deny dotfiles, autoindex off", "rate limits on login and API routes", "run workers as an unprivileged user, keep nginx patched"],
  apache: ["ServerTokens Prod, ServerSignature Off", "TLS 1.2/1.3 only, HSTS", "disable unused modules (autoindex, status, userdir)", "Options -Indexes, AllowOverride None where possible", "security headers via mod_headers", "mod_security with the OWASP CRS if public"],
  docker: ["non-root USER in every image, pinned base images by digest", "no privileged, no docker.sock mounts, cap_drop ALL", "read-only root filesystem, no-new-privileges", "publish ports on 127.0.0.1 unless public, remember Docker bypasses ufw", "scan images (trivy/grype) in CI", "secrets via build secrets or runtime env, never ENV in the Dockerfile", "rootless Docker or userns-remap on the host"],
  kubernetes: ["Pod Security Admission 'restricted' on app namespaces", "runAsNonRoot, drop ALL capabilities, readOnlyRootFilesystem, no privilege escalation", "NetworkPolicies default deny", "RBAC least privilege, no cluster-admin for apps, automountServiceAccountToken false", "resource limits and quotas", "secrets encrypted at rest, images pinned and scanned, audit logging on"],
  postgres: ["listen_addresses limited, no 0.0.0.0 without a firewall", "pg_hba.conf: scram-sha-256, no trust, hostssl only for remote", "ssl = on with a real certificate", "least-privilege roles, the app never uses the postgres superuser", "log_connections, log_disconnections, pgaudit for sensitive data", "tested backups (pg_dump / PITR) and patched minor versions"],
  mysql: ["bind-address 127.0.0.1 unless needed", "remove anonymous users and the test database (mysql_secure_installation)", "require_secure_transport, TLS", "least-privilege users, no app using root", "local_infile=0, secure_file_priv set", "audit plugin or general log on sensitive systems, tested backups"],
  redis: ["bind 127.0.0.1 and protected-mode yes", "requirepass / ACL users with strong passwords", "rename or disable FLUSHALL, CONFIG, DEBUG for app users", "TLS for anything off-box", "never expose 6379 to the internet", "run as a non-root user"],
  mongodb: ["authorization: enabled", "bindIp 127.0.0.1 or private network only", "TLS for clients", "least-privilege roles per app", "disable server-side JavaScript if unused", "audit log and tested backups"],
  windows: ["patching through WSUS/Intune, auto updates", "Defender (or EDR) on, tamper protection, ASR rules", "LAPS for local admin passwords, no shared admins", "disable SMBv1, LLMNR and NetBIOS over TCP", "BitLocker with recovery keys escrowed", "PowerShell script block and module logging, Sysmon, forward logs", "tiered admin accounts, MFA for privileged users"],
  macos: ["FileVault on, automatic updates", "firewall on with stealth mode", "Gatekeeper and SIP left on", "standard (non-admin) daily account", "screen lock and a firmware/startup password where supported", "review Login Items, background items and Full Disk Access grants"],
  wordpress: ["core, themes and plugins on auto-update, delete unused ones", "MFA for admins, unique admin username", "DISALLOW_FILE_EDIT, protect wp-config.php", "block xmlrpc.php if unused, rate-limit wp-login.php", "least-privilege file permissions, no 777", "web application firewall and daily off-site backups"],
  webapp: ["parameterised queries everywhere (no string-built SQL)", "output encoding and a Content-Security-Policy", "secure session cookies: HttpOnly, Secure, SameSite", "CSRF protection on state-changing requests", "authN with rate limits, MFA, and safe password storage (argon2/bcrypt)", "authorisation checked on every request (no IDOR)", "dependency scanning and pinned versions", "secrets from a vault or env, never in the repo; security headers and HTTPS only"],
  aws: ["MFA on root, no root access keys, root used only for break-glass", "IAM roles and SSO instead of long-lived keys, least privilege", "CloudTrail in all regions to a locked bucket, GuardDuty on", "S3 Block Public Access at the account level", "security groups without 0.0.0.0/0 on admin ports", "AWS Config / Security Hub for continuous checks, billing alerts"],
  azure: ["MFA and Conditional Access for everyone, no legacy auth", "PIM for privileged roles, few Global Admins", "Defender for Cloud on, secure score reviewed", "NSGs without open RDP/SSH, Bastion for admin access", "storage accounts without public blob access", "diagnostic logs to Log Analytics / Sentinel"],
  gcp: ["org policies: no service account keys, no public IPs by default", "least-privilege IAM, no primitive Owner/Editor roles for apps", "Cloud Audit Logs on, Security Command Center", "VPC firewall without 0.0.0.0/0 on admin ports, IAP for SSH", "uniform bucket-level access, no allUsers", "MFA / security keys for admins"],
  github: ["require 2FA for the org, SSO if available", "branch protection: reviews, status checks, no force pushes", "secret scanning and push protection on", "Dependabot alerts and security updates", "Actions: minimal GITHUB_TOKEN permissions, pinned action SHAs, no pull_request_target with untrusted code", "fine-grained tokens with expiry, audit deploy keys and apps"],
  router: ["change the admin password and disable remote admin", "latest firmware, auto updates if offered", "WPA3 (or WPA2-AES), strong passphrase, WPS off", "guest network for visitors and IoT devices", "UPnP off unless needed", "check connected devices monthly"],
  accounts: ["a password manager with unique passwords everywhere", "MFA on email first, then banking and social accounts, prefer passkeys or security keys", "recovery codes stored offline, recovery phone and email up to date", "review signed-in devices and third-party app access", "breach alerts (Have I Been Pwned)", "SIM PIN / carrier port-out lock against SIM swaps"],
};

// ─── Prompts and rendering ────────────────────────────────────────────────────

const countBy = (findings: SecurityFinding[]) => {
  const counts: Partial<Record<Severity, number>> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(", ");
};

function findingsBlock(findings: SecurityFinding[], max = 25): string {
  return findings
    .slice(0, max)
    .map((f) => [
      `- [${f.severity.toUpperCase()}] ${f.title}${f.count && f.count > 1 ? ` (x${f.count})` : ""}${f.attack ? ` · ${f.attack.id} ${f.attack.name}` : ""}`,
      `  ${f.detail}`,
      ...f.evidence.map((e) => `  evidence: ${e}`),
      ...(f.fix ? [`  fix: ${f.fix.replace(/\n/g, " | ")}`] : []),
    ].join("\n"))
    .join("\n");
}

/** The model's brief: explain and prioritise what the deterministic pass found, nothing invented. */
export function securityPrompt(report: InvestigationReport | HardeningReport, question: string): string {
  if (report.mode === "investigate") {
    const i = report.indicators;
    const list = (name: string, xs: string[]) => (xs.length ? `${name}: ${xs.slice(0, 15).map(defang).join(", ")}${xs.length > 15 ? ` (+${xs.length - 15} more)` : ""}` : "");
    return [
      "You are a senior incident responder. PrismOS has already analysed the evidence below on this machine. Write the investigation for the user.",
      "Ground every statement in the findings and indicators; when something is a guess, say so. Never invent hosts, users or times. Indicators stay defanged.",
      "",
      `User request: ${question}`,
      `Source: ${report.source} · ${report.lines.toLocaleString()} lines · time span ${report.timeline.first ?? "unknown"} to ${report.timeline.last ?? "unknown"}${report.timeline.peaks.length ? ` · busiest minutes: ${report.timeline.peaks.map((p) => `${p.minute} (${p.count})`).join(", ")}` : ""}`,
      "",
      `Findings (${countBy(report.findings) || "none"}):`,
      findingsBlock(report.findings) || "- none of the detectors fired",
      "",
      "Indicators:",
      ...[list("public IPs", i.ipsPublic), list("internal IPs", i.ipsPrivate), list("domains", i.domains), list("URLs", i.urls), list("users", i.users), list("hashes", [...i.sha256, ...i.sha1, ...i.md5]), list("CVEs", i.cves), list("paths", i.paths)].filter(Boolean),
      "",
      "Write, in this order, with short headings:",
      "1. What happened: a plain-language story in 3-6 sentences, with times.",
      "2. Severity and scope: what is affected (accounts, hosts, data) and how sure we are.",
      "3. Contain now: numbered actions for the next hour, most urgent first.",
      "4. Eradicate and recover.",
      "5. Harden so it doesn't happen again: specific settings and controls.",
      "6. What to collect next to confirm or rule out, and open questions.",
      "Keep it under 450 words. Defensive guidance only.",
    ].join("\n");
  }
  return [
    `You are a senior security engineer reviewing a ${CONFIG_LABEL[report.configType]} for the user. PrismOS has already checked it line by line on this machine; the findings and exact fixes are below.`,
    "Explain and prioritise them, don't invent new problems you can't see in the findings. Keep the fixes exactly as given unless one is clearly wrong for this file.",
    "",
    `User request: ${question}`,
    `File: ${report.source}`,
    "",
    `Findings (${countBy(report.findings) || "none"}):`,
    findingsBlock(report.findings) || "- no issues found by the checks",
    "",
    "Write: 1) a one-paragraph verdict, 2) the fixes in priority order (do these first / then these), each with why it matters in one sentence, 3) how to apply and verify safely (test, reload, keep a session open), 4) anything to watch afterwards. Under 400 words.",
  ].join("\n");
}

/** A security review of material that isn't a config PrismOS has checks for
 *  (source code, a policy, an email): secrets masked, size capped. */
export function genericSecurityPrompt(material: string, question: string): string {
  const secrets = findSecrets(material);
  return [
    "You are a senior security engineer. Review the content below for security weaknesses and how to harden it.",
    `User request: ${question}`,
    ...(secrets.length ? [`PrismOS found credentials in it (${secrets.join(", ")}); they are masked below. Tell the user to rotate them.`] : []),
    "",
    "---",
    maskSecrets(material.slice(0, 14_000)),
    "---",
    "",
    "List the issues you can actually see, most severe first, each with: severity (critical/high/medium/low), where it is, why it matters, and the exact fix. Then a short 'do this first' list. Don't invent issues you can't point to. Defensive guidance only. Under 500 words.",
  ].join("\n");
}

/** Prompt for "harden my X" with no file: the checklist grounds the plan. */
export function hardeningGuidePrompt(topic: string, question: string): string {
  const items = HARDENING_CHECKLISTS[topic] ?? [];
  return [
    `You are a senior security engineer. The user asked: "${question}"`,
    "",
    `Write a prioritised hardening plan for ${topic}. Cover at least everything in this checklist, in your own order, and add anything specific to the user's request:`,
    ...items.map((i) => `- ${i}`),
    "",
    "For each step give: what to do, the exact command or setting, how to verify it worked, and how to undo it if it breaks something. Group into: do today / this week / ongoing. Defensive guidance only. Under 600 words.",
  ].join("\n");
}

/** The top of the chat card: counts and the most severe findings at a glance. */
export function securitySummary(report: InvestigationReport | HardeningReport): string {
  const top = report.findings.slice(0, 8).map((f) => `${SEVERITY_ICON[f.severity]} **${f.title}**${f.count && f.count > 1 ? ` ×${f.count}` : ""}${f.attack ? ` · ${f.attack.id}` : ""}`);
  const head =
    report.mode === "investigate"
      ? `🛡️ **${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}** in ${report.lines.toLocaleString()} lines${report.timeline.first ? ` (${report.timeline.first} to ${report.timeline.last})` : ""}: ${countBy(report.findings) || "nothing the detectors recognise"}. ${report.indicators.ipsPublic.length} public IPs, ${report.indicators.domains.length} domains, ${report.indicators.users.length} accounts seen.`
      : `🛡️ **${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}** in this ${CONFIG_LABEL[report.configType]}: ${countBy(report.findings) || "no issues from the checks"}.`;
  return [head, ...(top.length ? ["", ...top] : [])].join("\n");
}

/** File-name friendly stem for the saved report. */
export function reportSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "report";
}

/** Markdown for the result card and the saved report. */
export function renderSecurityMarkdown(report: InvestigationReport | HardeningReport, narrative: string, model: string): string {
  const head =
    report.mode === "investigate"
      ? `# Investigation: ${report.source}\n\n${report.lines.toLocaleString()} lines · ${report.timeline.first ?? "?"} to ${report.timeline.last ?? "?"} · ${report.findings.length} findings (${countBy(report.findings) || "none"}) · analysed on this machine by PrismOS + ${model}`
      : `# Hardening review: ${report.source}\n\n${CONFIG_LABEL[report.configType]} · ${report.findings.length} findings (${countBy(report.findings) || "none"}) · checked on this machine by PrismOS + ${model}`;
  const rows = report.findings.map((f) => `| ${SEVERITY_ICON[f.severity]} ${f.severity} | ${f.title.replace(/\|/g, "/")} | ${f.attack ? `${f.attack.id}` : ""} | ${(f.evidence[0] ?? "").replace(/\|/g, "/").replace(/`/g, "'")} |`);
  const table = rows.length ? ["| Severity | Finding | ATT&CK | Evidence |", "|---|---|---|---|", ...rows].join("\n") : "_No findings from the checks._";
  const fixes =
    report.mode === "harden"
      ? report.findings.filter((f) => f.fix).map((f) => `**${f.title}**\n\`\`\`\n${f.fix}\n\`\`\``).join("\n\n")
      : "";
  const iocs =
    report.mode === "investigate"
      ? (() => {
          const i = report.indicators;
          const section = (name: string, xs: string[]) => (xs.length ? `- **${name}** (${xs.length}): ${xs.slice(0, 40).map((x) => `\`${defang(x)}\``).join(", ")}` : "");
          return ["## Indicators (defanged)", section("Public IPs", i.ipsPublic), section("Internal IPs", i.ipsPrivate), section("Domains", i.domains), section("URLs", i.urls), section("Emails", i.emails), section("Users", i.users), section("SHA-256", i.sha256), section("SHA-1", i.sha1), section("MD5", i.md5), section("CVEs", i.cves), section("Paths", i.paths)].filter(Boolean).join("\n");
        })()
      : "";
  const patched = report.mode === "harden" && report.patched ? ["", `## Hardened ${report.source} (review, then test with \`sshd -t\` and keep a session open while you reload)`, "```", report.patched, "```"] : [];
  return [head, "", "## Findings", table, "", narrative.trim(), ...(fixes ? ["", "## Exact fixes", fixes] : []), ...patched, ...(iocs ? ["", iocs] : [])].join("\n");
}
