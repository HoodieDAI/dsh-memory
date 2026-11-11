/**
 * File-backed project memory store.
 *
 * One directory per project below `<dsh home>/auto-memory/`. Each memory is a
 * Markdown file with a small YAML-ish frontmatter block; `MEMORY.md` is a
 * generated index and `project.json` records the project identity.
 *
 * The store is deliberately dependency-free and usable from both the plugin
 * (async CRUD) and the synchronous prompt assembler (index rendering).
 */
import { promises as fsp, readFileSync, readdirSync, statSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
export const INDEX_FILE = 'MEMORY.md';
export const PROJECT_FILE = 'project.json';
export const MAX_MEMORY_BYTES = 64 * 1024;
const MAX_INDEX_LINES = 200;
const MAX_INDEX_BYTES = 25000;
const MAX_STORED_BYTES = 1024 * 1024;
const MAX_FILES = 500;

/** Resolve the harness home the same way DSH does, with the process env first. */
export function resolveDshHome() {
  const configured = process.env.DSH_HOME?.trim();
  return configured ? resolve(expandHome(configured)) : join(homedir(), '.dsh');
}

/** Resolve the root directory holding every project's memory. */
export function resolveMemoryRoot(configured) {
  const value = typeof configured === 'string' ? configured.trim() : '';
  return value ? resolve(expandHome(value)) : join(resolveDshHome(), 'auto-memory');
}

/** Expand a leading `~` without touching other path forms. */
export function expandHome(value) {
  const text = String(value ?? '');
  if (text === '~') return homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2));
  return text;
}

function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function slugifySegment(value) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{L}\p{N}.-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
    .replace(/^[-.]+|[-.]+$/g, '');
  return slug || 'project';
}

/**
 * Derive a stable project identity from a working directory.
 *
 * A Git checkout resolves to its common Git directory's parent, so linked
 * worktrees share one memory store. Everything else falls back to the canonical
 * directory itself. Results are cached per canonical directory.
 */
const identityCache = new Map();
export function projectIdentity(cwd) {
  const canonical = realpathOrSelf(cwd);
  const cached = identityCache.get(canonical);
  if (cached !== undefined) return cached;
  let identityPath = canonical;
  try {
    const output = execFileSync(
      'git',
      ['-C', canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (output && isAbsolute(output)) {
      const candidate = basename(output) === '.git' ? dirname(output) : output;
      if (candidate && candidate !== sep) identityPath = candidate;
    }
  } catch {
    // Not a repository, or Git is unavailable: the directory is the identity.
  }
  const key = `${slugifySegment(basename(identityPath))}-${createHash('sha1').update(identityPath).digest('hex').slice(0, 12)}`;
  const identity = { key, path: identityPath, cwd: canonical, name: basename(identityPath) || identityPath };
  identityCache.set(canonical, identity);
  return identity;
}

/** Validate and resolve one project directory below the configured root. */
export function projectDirForKey(root, key) {
  const value = String(key ?? '');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value)) throw new Error('invalid project key');
  const base = resolve(root);
  const full = resolve(base, value);
  if (full !== base && !full.startsWith(base + sep)) throw new Error('project path escapes the memory root');
  return full;
}

/** Validate and resolve one memory file below a project directory. */
export function memoryPath(projectDir, fileName) {
  const name = String(fileName ?? '');
  if (name !== INDEX_FILE && !/^[\p{L}\p{N}][\p{L}\p{N}._-]*\.md$/u.test(name)) {
    throw new Error('invalid memory file name');
  }
  const base = resolve(projectDir);
  const full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) throw new Error('memory path escapes the project directory');
  return full;
}

async function atomicWrite(path, text) {
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fsp.writeFile(temporary, text, 'utf8');
  try {
    await fsp.rename(temporary, path);
  } catch (error) {
    if (process.platform === 'win32') {
      await fsp.rm(path, { force: true });
      await fsp.rename(temporary, path);
      return;
    }
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

const projectLocks = new Map();
function withProjectLock(projectDir, operation) {
  const previous = projectLocks.get(projectDir) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  projectLocks.set(projectDir, next);
  return next.finally(() => {
    if (projectLocks.get(projectDir) === next) projectLocks.delete(projectDir);
  });
}

function oneLine(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Replace obvious credentials before anything reaches disk. Memory content is
 * model-authored, so a key can otherwise be copied into a durable file.
 */
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{16,})["']?/gi,
];
export function redactSecrets(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted secret]');
  return text;
}

/** Normalize a model-authored memory name into a safe file stem. */
export function slugifyName(value) {
  const source = String(value ?? '').trim().toLowerCase();
  if (!source) throw new Error('memory name is required');
  const slug = source
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{L}\p{N}.-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!slug) throw new Error('memory name must contain at least one letter or digit');
  return slug;
}

/** Normalize a user- or model-supplied memory name to its stored file name. */
export function memoryFileName(raw) {
  const stem = String(raw ?? '').trim().replace(/\.md$/i, '');
  if (stem.toLowerCase() === 'memory') return INDEX_FILE;
  if (/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(stem)) return `${stem}.md`;
  return `${slugifyName(stem)}.md`;
}

function normalizeType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return MEMORY_TYPES.includes(type) ? type : 'project';
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

/** Split a memory file into its frontmatter fields and Markdown body. */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const firstNewline = text.indexOf('\n');
  if (firstNewline === -1) return { meta: {}, body: text };
  const close = text.indexOf('\n---', firstNewline + 1);
  if (close === -1) return { meta: {}, body: text };
  const header = text.slice(firstNewline + 1, close);
  const meta = {};
  for (const line of header.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    meta[match[1]] = unquote(match[2]);
  }
  let body = text.slice(close + 4);
  body = body.replace(/^\n+/, '');
  return { meta, body };
}

/** Serialize frontmatter and body in the exact shape the store writes. */
export function serializeFrontmatter(meta, body) {
  const keys = ['name', 'description', 'type', 'created', 'updated'];
  const lines = keys
    .filter((key) => meta?.[key] !== undefined && meta?.[key] !== null && String(meta[key]).length > 0)
    .map((key) => `${key}: ${JSON.stringify(String(meta[key]))}`);
  return `---\n${lines.join('\n')}\n---\n\n${String(body ?? '').trim()}\n`;
}

/** Interpret one stored file, including the generated index. */
export function parseMemoryText(fileName, raw) {
  if (fileName === INDEX_FILE) {
    return {
      fileName,
      name: 'index',
      description: 'Generated index of every memory in this project',
      type: 'index',
      created: '',
      updated: '',
      body: String(raw ?? ''),
      generated: true,
    };
  }
  const { meta, body } = parseFrontmatter(raw);
  return {
    fileName,
    name: String(meta.name || fileName.replace(/\.md$/i, '')),
    description: oneLine(meta.description || ''),
    type: normalizeType(meta.type),
    created: String(meta.created || ''),
    updated: String(meta.updated || ''),
    body,
    generated: false,
  };
}

async function readBounded(path, maxBytes = MAX_STORED_BYTES) {
  const info = await fsp.stat(path);
  if (info.size > maxBytes) throw new Error(`memory file is too large (${info.size} bytes)`);
  return fsp.readFile(path, 'utf8');
}

/** Build the model-facing `MEMORY.md` text under the configured budgets. */
export function buildIndexText(files, options = {}) {
  const maxLines = Number.isFinite(options.maxLines) ? Math.max(1, Math.trunc(options.maxLines)) : MAX_INDEX_LINES;
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(256, Math.trunc(options.maxBytes)) : MAX_INDEX_BYTES;
  const header =
    files.length === 0
      ? '# Project memory\n\n_No memories yet._'
      : `# Project memory\n\n${files.length} ${files.length === 1 ? 'memory' : 'memories'}. Read a full entry with \`memory\` action "read" before relying on it.`;
  let text = header;
  let shown = 0;
  let truncated = false;
  for (const file of files) {
    const label = file.description || file.name;
    const line = `- ${label} — \`${file.name}\` (${file.type})`;
    if (shown >= maxLines || Buffer.byteLength(`${text}\n${line}`, 'utf8') > maxBytes) {
      truncated = true;
      break;
    }
    text = `${text}\n${line}`;
    shown += 1;
  }
  if (truncated) text += `\n- … ${files.length - shown} more; use the \`memory\` tool action "list" to see all.`;
  return { text, total: files.length, shown, truncated };
}

function sortFiles(files) {
  files.sort((left, right) => {
    const leftTime = Date.parse(left.updated || left.mtime || '') || 0;
    const rightTime = Date.parse(right.updated || right.mtime || '') || 0;
    return rightTime - leftTime || left.name.localeCompare(right.name);
  });
  return files;
}

/** Read metadata for every topic file in one project (excluding the index). */
export async function listMemoryFiles(projectDir) {
  let entries;
  try {
    entries = await fsp.readdir(projectDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === INDEX_FILE) continue;
    try {
      const full = memoryPath(projectDir, entry.name);
      const info = await fsp.stat(full);
      if (info.size > MAX_STORED_BYTES) continue;
      const parsed = parseMemoryText(entry.name, await fsp.readFile(full, 'utf8'));
      files.push({ ...parsed, bytes: info.size, mtime: info.mtime.toISOString() });
    } catch {
      // A broken or unreadable file must not hide the rest of the store.
    }
    if (files.length >= MAX_FILES) break;
  }
  return sortFiles(files);
}

/** Same as {@link listMemoryFiles}, synchronously, for prompt assembly. */
export function listMemoryFilesSync(projectDir) {
  let entries;
  try {
    entries = readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === INDEX_FILE) continue;
    try {
      const full = memoryPath(projectDir, entry.name);
      const info = statSync(full);
      if (info.size > MAX_STORED_BYTES) continue;
      const parsed = parseMemoryText(entry.name, readFileSync(full, 'utf8'));
      files.push({ ...parsed, bytes: info.size, mtime: info.mtime.toISOString() });
    } catch {
      // ignore broken entries
    }
    if (files.length >= MAX_FILES) break;
  }
  return sortFiles(files);
}

/** Synchronous index rendering for the system-prompt context callback. */
export function buildIndexSync(projectDir, options = {}) {
  const files = listMemoryFilesSync(projectDir);
  return { files, ...buildIndexText(files, options) };
}

/** List every file shown by the UI, including the generated index. */
export async function listProjectFiles(projectDir) {
  const files = await listMemoryFiles(projectDir);
  let indexInfo;
  try {
    indexInfo = await fsp.stat(join(projectDir, INDEX_FILE));
  } catch {
    indexInfo = undefined;
  }
  return [
    ...files,
    {
      fileName: INDEX_FILE,
      name: 'index',
      description: 'Generated index of every memory in this project',
      type: 'index',
      generated: true,
      created: '',
      updated: indexInfo?.mtime?.toISOString?.() ?? '',
      bytes: indexInfo?.size ?? 0,
      mtime: indexInfo?.mtime?.toISOString?.() ?? '',
    },
  ];
}

/** Read one memory by file name; regenerate a missing index on demand. */
export async function readMemory(projectDir, fileName) {
  const name = memoryFileName(fileName);
  const full = memoryPath(projectDir, name);
  if (name === INDEX_FILE) {
    try {
      await fsp.access(full);
    } catch {
      await generateIndex(projectDir);
    }
  }
  try {
    const raw = await readBounded(full);
    return parseMemoryText(name, raw);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`memory "${name.replace(/\.md$/i, '')}" not found`);
    throw error;
  }
}

async function readProjectMeta(projectDir) {
  try {
    return JSON.parse(await fsp.readFile(join(projectDir, PROJECT_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

async function touchProject(projectDir) {
  const meta = await readProjectMeta(projectDir);
  if (meta === undefined) return;
  await atomicWrite(
    join(projectDir, PROJECT_FILE),
    JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2),
  );
}

/** Create a project directory and record its identity. */
export async function ensureProject(root, identity) {
  const projectDir = projectDirForKey(root, identity.key);
  await fsp.mkdir(projectDir, { recursive: true });
  const meta = await readProjectMeta(projectDir);
  const now = new Date().toISOString();
  const next = {
    key: identity.key,
    name: meta?.name || identity.name,
    path: identity.path,
    cwd: identity.cwd,
    createdAt: meta?.createdAt || now,
    updatedAt: meta?.updatedAt || now,
  };
  if (meta === undefined || meta.path !== next.path || meta.cwd !== next.cwd || meta.name !== next.name) {
    await atomicWrite(join(projectDir, PROJECT_FILE), JSON.stringify(next, null, 2));
  }
  return { ...next, dir: projectDir };
}

/** Resolve a working directory to its project and ensure the store exists. */
export async function ensureProjectForCwd(root, cwd) {
  return ensureProject(root, projectIdentity(cwd));
}

/** Rebuild and persist the generated `MEMORY.md` index. */
export async function generateIndex(projectDir, options = {}) {
  const files = await listMemoryFiles(projectDir);
  const index = buildIndexText(files, options);
  await fsp.mkdir(projectDir, { recursive: true });
  await atomicWrite(join(projectDir, INDEX_FILE), `${index.text}\n`);
  return { ...index, files };
}

/** Create or update one memory, rebuild the index, and return it. */
export async function saveMemory(projectDir, input, options = {}) {
  const maxContentBytes = Number.isFinite(options.maxContentBytes) ? options.maxContentBytes : MAX_MEMORY_BYTES;
  const name = slugifyName(input?.name);
  if (name.toLowerCase() === 'memory') throw new Error('memory name "memory" is reserved for the generated index');
  const content = String(input?.content ?? '').trim();
  if (content.length === 0) throw new Error('memory content is required');
  const body = redactSecrets(content);
  if (Buffer.byteLength(body, 'utf8') > maxContentBytes) {
    throw new Error(`memory content exceeds the ${Math.trunc(maxContentBytes)} byte limit`);
  }
  const type = normalizeType(input?.type);
  const description = oneLine(redactSecrets(input?.description || content.split('\n')[0] || name), 200);
  const fileName = `${name}.md`;
  const full = memoryPath(projectDir, fileName);
  return withProjectLock(projectDir, async () => {
    let created = new Date().toISOString();
    try {
      const previous = parseMemoryText(fileName, await fsp.readFile(full, 'utf8'));
      if (previous.created) created = previous.created;
    } catch {
      // A new memory keeps the current creation time.
    }
    const updated = new Date().toISOString();
    await atomicWrite(full, serializeFrontmatter({ name, description, type, created, updated }, body));
    await touchProject(projectDir);
    const index = await generateIndex(projectDir, options);
    return {
      fileName,
      name,
      description,
      type,
      created,
      updated,
      index: index.text,
      indexCount: index.total,
    };
  });
}

/** Delete one memory by name or file name. The generated index is protected. */
export async function deleteMemory(projectDir, nameOrFile) {
  const fileName = memoryFileName(nameOrFile);
  if (fileName === INDEX_FILE) throw new Error('the memory index is generated and cannot be deleted');
  const full = memoryPath(projectDir, fileName);
  return withProjectLock(projectDir, async () => {
    let deleted = false;
    try {
      await fsp.unlink(full);
      deleted = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await touchProject(projectDir);
    await generateIndex(projectDir);
    return { deleted, fileName };
  });
}

/** Search names, descriptions, and bodies; returns bounded snippets. */
export async function searchMemories(projectDir, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  const files = await listMemoryFiles(projectDir);
  const results = [];
  for (const file of files) {
    try {
      const parsed = parseMemoryText(file.fileName, await fsp.readFile(memoryPath(projectDir, file.fileName), 'utf8'));
      const haystack = `${parsed.name}\n${parsed.description}\n${parsed.body}`.toLowerCase();
      const at = needle.length === 0 ? 0 : haystack.indexOf(needle);
      if (at === -1) continue;
      const bodyAt = needle.length === 0 ? 0 : parsed.body.toLowerCase().indexOf(needle);
      const snippet =
        bodyAt === -1
          ? parsed.description || parsed.body.slice(0, 200)
          : parsed.body.slice(Math.max(0, bodyAt - 80), bodyAt + 160);
      results.push({ ...file, snippet: oneLine(snippet, 240) });
    } catch {
      // skip broken entries
    }
  }
  return results;
}

/** Read every project below the root, newest activity first. */
export async function listProjects(root, options = {}) {
  const maxProjects = Number.isFinite(options.maxProjects) ? options.maxProjects : 50;
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const projectDir = join(root, entry.name);
    const meta = await readProjectMeta(projectDir);
    if (meta === undefined) continue;
    // The list route carries metadata only; bodies are fetched one at a time.
    const files = (await listProjectFiles(projectDir)).map(({ body: _body, ...entry }) => entry);
    const updatedAt = files.reduce((latest, file) => {
      const time = Date.parse(file.updated || file.mtime || '') || 0;
      return time > latest ? time : latest;
    }, Date.parse(meta.updatedAt || '') || 0);
    projects.push({
      key: meta.key || entry.name,
      name: meta.name || entry.name,
      path: meta.path || '',
      cwd: meta.cwd || '',
      createdAt: meta.createdAt || '',
      updatedAt: updatedAt > 0 ? new Date(updatedAt).toISOString() : '',
      memoryCount: files.filter((file) => !file.generated).length,
      files,
    });
    if (projects.length >= maxProjects) break;
  }
  projects.sort((left, right) => (Date.parse(right.updatedAt || '') || 0) - (Date.parse(left.updatedAt || '') || 0));
  return projects;
}
