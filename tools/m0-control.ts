import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

type Arguments = {
	yuku: string;
	ref: string;
	sha256Path?: string;
	command: string[];
};

const archiveLabel = "git archive";
const excludedNames = new Set([".git", ".zig-cache", "node_modules", "zig-cache", "zig-out"]);
const yukuDependencyName = "yuku-dialect";

function fail(message: string): never {
	throw new Error(message);
}

const run = (
	command: string,
	args: string[],
	options: { cwd?: string; input?: Buffer; capture?: boolean } = {},
): Buffer => {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: options.capture === false ? undefined : "buffer",
		input: options.input,
		maxBuffer: 256 * 1024 * 1024,
		stdio: options.capture === false ? "inherit" : ["pipe", "pipe", "inherit"],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) fail(`${command} exited with status ${result.status ?? "unknown"}`);
	return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
};

const parseArguments = (argv: string[]): Arguments => {
	let yuku: string | undefined;
	let ref: string | undefined;
	let sha256Path: string | undefined;
	let index = 0;
	while (index < argv.length && argv[index] !== "--") {
		const option = argv[index];
		const value = argv[index + 1];
		if (value === undefined) fail(`missing value for ${option}`);
		if (option === "--yuku") yuku = value;
		else if (option === "--ref") ref = value;
		else if (option === "--sha256") sha256Path = value;
		else fail(`unknown option ${option}`);
		index += 2;
	}
	if (argv[index] !== "--") fail("missing -- command separator");
	const command = argv.slice(index + 1);
	if (!yuku || !ref || command.length === 0) fail("--yuku, --ref, and a command are required");
	return { yuku, ref, sha256Path, command };
};

export const dependencySiblingFromManifest = (manifest: string): string => {
	const matches = [...manifest.matchAll(/\.yuku\s*=\s*\.\{\s*\.path\s*=\s*"([^"]+)"\s*\}/g)];
	if (matches.length !== 1) fail("manifest must declare exactly one yuku path dependency");
	const dependencyPath = matches[0][1];
	if (dependencyPath !== `../${yukuDependencyName}`) {
		fail(`yuku dependency must be the safe sibling ../${yukuDependencyName}`);
	}
	if (dependencyPath.includes("\\")) fail("yuku dependency cannot contain backslashes");
	return yukuDependencyName;
};

const main = async (): Promise<void> => {
	const args = parseArguments(process.argv.slice(2));
	const project = resolve(import.meta.dirname, "..");
	const yuku = resolve(args.yuku);
	const resolvedRef = run("git", ["-C", yuku, "rev-parse", args.ref]).toString().trim();
	if (resolvedRef !== args.ref)
		fail(`control ref resolved to ${resolvedRef}, expected ${args.ref}`);

	const temporaryRoot = await mkdtemp(join(tmpdir(), "yuku-tsrx-m0-"));
	const temporaryProject = join(temporaryRoot, basename(project));
	try {
		await cp(project, temporaryProject, {
			recursive: true,
			filter: (source) => !excludedNames.has(basename(source)),
		});
		const manifest = await readFile(join(temporaryProject, "build.zig.zon"), "utf8");
		const dependencySibling = dependencySiblingFromManifest(manifest);
		const temporaryYuku = join(temporaryRoot, dependencySibling);
		await mkdir(temporaryYuku);
		const archive = run("git", ["-C", yuku, "archive", "--format=tar", args.ref]);
		if (archive.length === 0) fail(`${archiveLabel} produced an empty snapshot`);
		run("tar", ["-xf", "-", "-C", temporaryYuku], { input: archive });

		const [command, ...commandArgs] = args.command;
		run(command, commandArgs, { cwd: temporaryProject, capture: false });
		if (args.sha256Path) {
			const artifact = resolve(temporaryProject, args.sha256Path);
			if (dirname(artifact).startsWith(temporaryProject) === false) {
				fail("sha256 artifact must remain inside the temporary project");
			}
			const digest = createHash("sha256")
				.update(await readFile(artifact))
				.digest("hex");
			process.stdout.write(`${digest}  ${args.sha256Path}\n`);
		}
	} finally {
		await rm(temporaryRoot, { force: true, recursive: true });
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
