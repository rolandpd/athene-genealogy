/**
 * Release in einem Schritt:  bun scripts/release.ts <patch|minor|major|x.y.z> [--dry-run]
 *
 * 1. Prüft: Branch main, sauberer Arbeitsbaum, nicht hinter origin/main
 * 2. Führt check-i18n, lint, test und build aus
 * 3. Setzt die Version in package.json, manifest.json (+ versions.json)
 * 4. Commit + annotierter Tag (ohne "v", Obsidian-Vorgabe)
 * 5. Pusht Commit und Tag atomar — der Tag startet den Release-Workflow
 *
 * Mit --dry-run laufen Prüfungen und Build, aber nichts wird geschrieben oder gepusht.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const REPO = 'rolandpd/athene-genealogy';
const BRANCH = 'main';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bump = args.find(a => !a.startsWith('--'));

function fail(msg: string): never {
	console.error(`\n✗ ${msg}`);
	process.exit(1);
}

function run(cmd: string, cmdArgs: string[], opts: { capture?: boolean } = {}): string {
	const res = spawnSync(cmd, cmdArgs, {
		stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});
	if (res.status !== 0) fail(`Fehlgeschlagen: ${cmd} ${cmdArgs.join(' ')}`);
	return (res.stdout ?? '').trim();
}

const git = (...a: string[]) => run('git', a, { capture: true });

function nextVersion(current: string, how: string): string {
	if (/^\d+\.\d+\.\d+$/.test(how)) return how;
	const [major, minor, patch] = current.split('.').map(Number);
	switch (how) {
		case 'patch': return `${major}.${minor}.${patch + 1}`;
		case 'minor': return `${major}.${minor + 1}.0`;
		case 'major': return `${major + 1}.0.0`;
		default: fail(`Unbekannter Bump "${how}" — erlaubt: patch, minor, major oder x.y.z`);
	}
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function writeJson(path: string, data: unknown): void {
	writeFileSync(path, JSON.stringify(data, null, '\t') + '\n');
}

if (!bump) fail('Aufruf: bun scripts/release.ts <patch|minor|major|x.y.z> [--dry-run]');

// ── 1. Vorbedingungen ───────────────────────────────────────────────────────
const problems: string[] = [];

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== BRANCH) problems.push(`Nicht auf ${BRANCH}, sondern auf ${branch}`);

if (git('status', '--porcelain') !== '') problems.push('Arbeitsbaum nicht sauber — erst committen');

git('fetch', '--quiet', 'origin', BRANCH);
const behind = git('rev-list', '--count', `HEAD..origin/${BRANCH}`);
if (behind !== '0') problems.push(`${behind} Commit(s) hinter origin/${BRANCH} — erst pullen`);

const pkg = readJson('package.json');
const current = String(pkg.version);
const version = nextVersion(current, bump);

if (git('tag', '--list', version) !== '') problems.push(`Tag ${version} existiert bereits`);

if (problems.length > 0) {
	const list = problems.map(p => `  • ${p}`).join('\n');
	if (!dryRun) fail(`Release abgebrochen:\n${list}`);
	console.warn(`\n⚠ Würde abbrechen:\n${list}\n`);
}

console.log(`\nRelease ${current} → ${version}${dryRun ? ' (dry run)' : ''}\n`);

// ── 2. Prüfen und bauen ─────────────────────────────────────────────────────
for (const script of ['check-i18n', 'lint', 'test', 'build']) {
	console.log(`\n▶ ${script}`);
	run('bun', ['run', script]);
}

if (dryRun) {
	console.log(`\n✓ Dry run ok — "mise run release ${bump}" würde ${version} veröffentlichen.`);
	process.exit(0);
}

// ── 3. Version setzen ───────────────────────────────────────────────────────
pkg.version = version;
writeJson('package.json', pkg);

const manifest = readJson('manifest.json');
manifest.version = version;
writeJson('manifest.json', manifest);

// versions.json: nur ergänzen, wenn sich minAppVersion ändert (Obsidian-Konvention)
const versions = readJson('versions.json');
const minAppVersion = String(manifest.minAppVersion);
if (!Object.values(versions).includes(minAppVersion)) {
	versions[version] = minAppVersion;
	writeJson('versions.json', versions);
}

// ── 4. Commit + Tag, 5. Push ────────────────────────────────────────────────
run('git', ['add', 'package.json', 'manifest.json', 'versions.json']);
run('git', ['commit', '-m', version]);
run('git', ['tag', '-a', version, '-m', version]);
run('git', ['push', '--atomic', 'origin', BRANCH, version]);

console.log(`\n✓ ${version} gepusht. Release-Workflow: https://github.com/${REPO}/actions`);
console.log(`  BRAT holt die Version, sobald https://github.com/${REPO}/releases/tag/${version} existiert.`);
