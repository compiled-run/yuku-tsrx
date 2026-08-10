import { createHash, randomBytes } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { link, lstat, mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type ReceiptKind = "matrix" | "matched-fuzz";
export type InternalPhase = "pre-trace" | "final";

type FixedContract = {
	version: 1;
	warmupIterations: 10_000;
	sampleIterations: 100_000;
	filesPerIteration: 3;
	orderedPairs: 10;
	minimumElapsedNs: 250_000_000;
	minimumParserStackSamples: 250;
	thresholdPercent: 2;
	statistic: "median";
	sampleOrder: "control,seam interleaved";
	independentMatrices: 3;
	crossMatrixAveraging: false;
	optimize: "ReleaseFast";
	controlThenSeam: true;
	profiler: {
		template: "Time Profiler";
		timeLimitSeconds: 5;
		finalizationGraceSeconds: 5;
		postSigintGraceSeconds: 1;
		samplePeriodUs: 1_000;
		targetExitObserved: true;
	};
};

export type CommandIdentity = {
	id: "matched-fuzz" | "matrix-1" | "matrix-2" | "matrix-3";
	kind: ReceiptKind;
	executable: string;
	argv: string[];
	cwd: string;
};

type IdentityFile = { path: string; sha256: string };

type ControlYukuIdentity = {
	checkoutHead: string;
	checkoutStatusSha256: string;
	compareCommit: string;
	compareTree: string;
};

type SyntheticScenarios = {
	matchedFuzz: string;
	matrices: [string, string, string];
};

export type CampaignManifest = {
	version: 1;
	campaignId: string;
	campaignDirectory: string;
	fixedContract: FixedContract;
	contractSha256: string;
	identityFiles: IdentityFile[];
	identityDigest: string;
	controlYukuIdentity: ControlYukuIdentity;
	commands: CommandIdentity[];
	synthetic: false | { identityFile: string; scenarios: SyntheticScenarios };
};

type IdentifierReceipt = CommandIdentity & {
	version: 1;
	manifestSha256: string;
};

type EventPhase = "start" | InternalPhase | "exit";

type ReceiptEvent = {
	version: 1;
	id: string;
	sequence: number;
	phase: EventPhase;
	actor: "external-runner" | "internal-child";
	previousSha256: string;
	payload: Record<string, unknown>;
};

type FallbackEvidence = {
	control: number[];
	seam: number[];
	controlElapsedNs: number[];
	seamElapsedNs: number[];
	controlMedian: number;
	seamMedian: number;
	deltaPercent: number;
};

export type CampaignValidation = {
	version: 1;
	campaignId: string;
	manifestSha256: string;
	contractSha256: string;
	identityDigest: string;
	identifiers: ["matched-fuzz", "matrix-1", "matrix-2", "matrix-3"];
	terminalEventSha256: Record<(typeof expectedIds)[number], string>;
	validatedAt: string;
};

const project = resolve(import.meta.dirname, "..");
const seam = resolve(project, "../yuku-dialect");
const control = resolve(project, "../yuku");
const controlScript = resolve(project, "tools/m1-control.ts");
const syntheticChild = resolve(project, "test/fixtures/m1-receipt-child.ts");
const manifestName = "manifest.json";
const identifiersName = "identifiers";
const validationName = "campaign-validation.json";
const receiptCampaignEnv = "YUKU_TSRX_M1_RECEIPT_CAMPAIGN";
const receiptIdentifierEnv = "YUKU_TSRX_M1_RECEIPT_IDENTIFIER";
const temporaryPattern = /^\..+\.\d+\.[0-9a-f]+\.tmp$/;
const unsafeControlRootPattern = /^(?:yuku-tsrx-m1-|yuku-matched-fuzz-)/;
const expectedIds = ["matched-fuzz", "matrix-1", "matrix-2", "matrix-3"] as const;
const expectedRef = "eb2adcb4c17da16e7ade1a0517192d81d469e67f";
const expectedPriorArt = "bf03e146d97ae2f0c2d4c4ec90456e1e544d2760";
const expectedSeeds = ["0x59a69a3230b5d620", "0x730b1e8e350ed620"] as const;

export const fixedContract: FixedContract = {
	version: 1,
	warmupIterations: 10_000,
	sampleIterations: 100_000,
	filesPerIteration: 3,
	orderedPairs: 10,
	minimumElapsedNs: 250_000_000,
	minimumParserStackSamples: 250,
	thresholdPercent: 2,
	statistic: "median",
	sampleOrder: "control,seam interleaved",
	independentMatrices: 3,
	crossMatrixAveraging: false,
	optimize: "ReleaseFast",
	controlThenSeam: true,
	profiler: {
		template: "Time Profiler",
		timeLimitSeconds: 5,
		finalizationGraceSeconds: 5,
		postSigintGraceSeconds: 1,
		samplePeriodUs: 1_000,
		targetExitObserved: true,
	},
};

function fail(message: string): never {
	throw new Error(message);
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`;

const fsyncDirectory = async (directory: string): Promise<void> => {
	const handle = await open(directory, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
};

const writeImmutable = async (path: string, value: unknown): Promise<string> => {
	const directory = dirname(path);
	const bytes = jsonLine(value);
	const temporary = `${directory}/.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(temporary, path);
		await fsyncDirectory(directory);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	return sha256(bytes);
};

const readJson = async <T>(path: string): Promise<{ bytes: string; value: T }> => {
	const bytes = await readFile(path, "utf8");
	if (!bytes.endsWith("\n")) fail(`receipt is not newline-terminated: ${path}`);
	return { bytes, value: JSON.parse(bytes) as T };
};

const assertIdentifier = (id: string): void => {
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) fail(`invalid receipt identifier ${id}`);
};

const isInside = (path: string, root: string): boolean => {
	const child = relative(resolve(root), resolve(path));
	return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
};

const assertCampaignPath = (directory: string): void => {
	if (!isAbsolute(directory)) fail("campaign directory must be caller-selected and absolute");
	if (directory.split(sep).some((part) => unsafeControlRootPattern.test(part))) {
		fail("campaign directory cannot be inside an auto-deleted control root");
	}
};

const assertSha256 = (value: string, label: string): void => {
	if (!/^[0-9a-f]{64}$/.test(value)) fail(`${label} must be a lowercase SHA-256`);
};

const ignoredInventoryNames = new Set([".git", ".zig-cache", "node_modules", "zig-out"]);
const identityRoots = [
	resolve(project, "build.zig"),
	resolve(project, "build.zig.zon"),
	resolve(project, "package.json"),
	resolve(project, "pnpm-lock.yaml"),
	resolve(project, "tsconfig.json"),
	resolve(project, "vite.config.ts"),
	resolve(project, "src"),
	resolve(project, "profiler"),
	resolve(project, "tools"),
	resolve(project, "benchmarks"),
	resolve(project, "baselines"),
	resolve(seam, "build.zig"),
	resolve(seam, "build.zig.zon"),
	resolve(seam, "package.json"),
	resolve(seam, "bun.lock"),
	resolve(seam, "src"),
	resolve(seam, "tools"),
] as const;

const collectIdentityFiles = async (path: string, output: string[]): Promise<void> => {
	const metadata = await lstat(path);
	if (metadata.isSymbolicLink()) fail(`identity inventory rejects symlink: ${path}`);
	if (metadata.isFile()) {
		output.push(path);
		return;
	}
	if (!metadata.isDirectory()) fail(`identity inventory requires files or directories: ${path}`);
	for (const entry of (await readdir(path)).sort()) {
		if (ignoredInventoryNames.has(entry)) continue;
		await collectIdentityFiles(resolve(path, entry), output);
	}
};

const identityPaths = async (syntheticIdentity: string | null): Promise<string[]> => {
	const paths: string[] = [];
	for (const root of identityRoots) await collectIdentityFiles(root, paths);
	if (syntheticIdentity) {
		if (
			!isAbsolute(syntheticIdentity) ||
			!syntheticIdentity.split(sep).some((part) => part.startsWith("m1-receipt-simulation-"))
		) {
			fail("synthetic identity must be inside a test-owned temporary root");
		}
		await collectIdentityFiles(syntheticIdentity, paths);
	}
	paths.sort();
	if (new Set(paths).size !== paths.length) fail("identity inventory contains duplicates");
	return paths;
};

const computeIdentityFiles = async (paths: readonly string[]): Promise<IdentityFile[]> =>
	Promise.all(paths.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })));

const git = (args: string[]): string => {
	const result = spawnSync("git", ["-C", control, ...args], { encoding: "utf8" });
	if (result.status !== 0) fail(`control Yuku identity command failed: git ${args.join(" ")}`);
	return result.stdout.trim();
};

const computeControlYukuIdentity = (): ControlYukuIdentity => {
	const checkoutHead = git(["rev-parse", "HEAD"]);
	const status = git(["status", "--porcelain=v1"]);
	const compareCommit = git(["rev-parse", expectedRef]);
	const compareTree = git(["rev-parse", `${expectedRef}^{tree}`]);
	if (checkoutHead !== expectedPriorArt || status !== "" || compareCommit !== expectedRef) {
		fail("control Yuku identity or cleanliness diverged");
	}
	return {
		checkoutHead,
		checkoutStatusSha256: sha256(status),
		compareCommit,
		compareTree,
	};
};

const identityDigest = (
	identityFiles: IdentityFile[],
	controlYukuIdentity: ControlYukuIdentity,
): string => sha256(JSON.stringify({ controlYukuIdentity, identityFiles }));

const matrixArguments = [
	"--mode",
	"none",
	"--control-yuku",
	control,
	"--seam-yuku",
	seam,
	"--compare-ref",
	expectedRef,
	"--node-size",
	"--tree-size",
	"--tags",
	"--wire-sha256",
	"--binary-sha256",
	"--decoder-bytes",
	"--encoder-bytes",
	"--allocations",
	"--profile",
	"--disassembly",
] as const;

const realCommands = (): CommandIdentity[] => [
	{
		id: "matched-fuzz",
		kind: "matched-fuzz",
		executable: process.execPath,
		cwd: project,
		argv: [
			controlScript,
			"--matched-fuzz",
			"--control-yuku",
			control,
			"--seam-yuku",
			seam,
			"--compare-ref",
			expectedRef,
			"--seeds",
			expectedSeeds.join(","),
		],
	},
	...([1, 2, 3] as const).map((number) => ({
		id: `matrix-${number}` as const,
		kind: "matrix" as const,
		executable: process.execPath,
		cwd: project,
		argv: [controlScript, ...matrixArguments],
	})),
];

const allowedSyntheticScenarios = new Set([
	"matched-fuzz-success",
	"matched-fuzz-failure",
	"matrix-success",
	"silent-exit",
	"nonzero-exception",
	"interrupted-trace",
	"threshold-failure",
	"fake-threshold-pass",
	"malformed-vectors",
	"short-elapsed",
	"wrong-medians",
	"wrong-delta",
	"low-parser-samples",
	"wrong-profiler-contract",
	"pretrace-final-divergence",
	"invalid-numeric",
	"inconsistent-samples",
]);

const syntheticCommands = (scenarios: SyntheticScenarios): CommandIdentity[] => {
	for (const scenario of [scenarios.matchedFuzz, ...scenarios.matrices]) {
		if (!allowedSyntheticScenarios.has(scenario)) fail(`unknown synthetic scenario ${scenario}`);
	}
	return [
		{
			id: "matched-fuzz",
			kind: "matched-fuzz",
			executable: process.execPath,
			cwd: project,
			argv: [syntheticChild, scenarios.matchedFuzz],
		},
		...scenarios.matrices.map((scenario, index) => ({
			id: `matrix-${index + 1}` as "matrix-1" | "matrix-2" | "matrix-3",
			kind: "matrix" as const,
			executable: process.execPath,
			cwd: project,
			argv: [syntheticChild, scenario],
		})),
	];
};

const commandEquals = (left: CommandIdentity, right: CommandIdentity): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const campaignManifest = async (
	directory: string,
): Promise<{ manifest: CampaignManifest; sha256: string }> => {
	const receipt = await readJson<CampaignManifest>(resolve(directory, manifestName));
	return { manifest: receipt.value, sha256: sha256(receipt.bytes) };
};

const expectedCommands = (
	manifest: CampaignManifest,
	allowSynthetic: boolean,
): CommandIdentity[] => {
	if (manifest.synthetic === false) return realCommands();
	if (!allowSynthetic) fail("production operations reject synthetic campaigns");
	return syntheticCommands(manifest.synthetic.scenarios);
};

const validateManifestShape = async (
	directory: string,
	manifest: CampaignManifest,
	allowSynthetic: boolean,
): Promise<void> => {
	assertCampaignPath(directory);
	if (manifest.version !== 1) fail("unsupported campaign manifest version");
	assertIdentifier(manifest.campaignId);
	if (manifest.campaignDirectory !== directory) fail("campaign was relocated after creation");
	if (JSON.stringify(manifest.fixedContract) !== JSON.stringify(fixedContract)) {
		fail("fixed measurement contract diverged");
	}
	if (manifest.contractSha256 !== sha256(JSON.stringify(fixedContract))) {
		fail("fixed contract hash diverged");
	}
	const commands = expectedCommands(manifest, allowSynthetic);
	if (commands.length !== 4 || manifest.commands.length !== 4)
		fail("campaign requires four commands");
	for (let index = 0; index < expectedIds.length; index += 1) {
		if (manifest.commands[index]?.id !== expectedIds[index]) fail("campaign identifiers reordered");
		if (!commandEquals(manifest.commands[index], commands[index]))
			fail("campaign command diverged");
	}
	const syntheticIdentity = manifest.synthetic === false ? null : manifest.synthetic.identityFile;
	const paths = await identityPaths(syntheticIdentity);
	if (JSON.stringify(manifest.identityFiles.map((entry) => entry.path)) !== JSON.stringify(paths)) {
		fail("identity-file list diverged");
	}
	for (const identity of manifest.identityFiles) assertSha256(identity.sha256, identity.path);
	if (
		manifest.identityDigest !== identityDigest(manifest.identityFiles, manifest.controlYukuIdentity)
	) {
		fail("complete identity digest diverged");
	}
};

const recheckIdentityFiles = async (manifest: CampaignManifest): Promise<void> => {
	const syntheticIdentity = manifest.synthetic === false ? null : manifest.synthetic.identityFile;
	const paths = await identityPaths(syntheticIdentity);
	if (JSON.stringify(paths) !== JSON.stringify(manifest.identityFiles.map((entry) => entry.path))) {
		fail("identity inventory was omitted or reordered");
	}
	for (const identity of manifest.identityFiles) {
		if (sha256(await readFile(identity.path)) !== identity.sha256) {
			fail(`identity bytes changed: ${identity.path}`);
		}
	}
	const controlYukuIdentity = computeControlYukuIdentity();
	if (JSON.stringify(controlYukuIdentity) !== JSON.stringify(manifest.controlYukuIdentity)) {
		fail("control Yuku identity changed");
	}
	if (identityDigest(manifest.identityFiles, controlYukuIdentity) !== manifest.identityDigest) {
		fail("complete identity digest changed");
	}
};

const createCampaignInternal = async (
	directory: string,
	campaignId: string,
	synthetic: false | { identityFile: string; scenarios: SyntheticScenarios },
): Promise<string> => {
	assertCampaignPath(directory);
	assertIdentifier(campaignId);
	const paths = await identityPaths(synthetic === false ? null : synthetic.identityFile);
	const identityFiles = await computeIdentityFiles(paths);
	const controlYukuIdentity = computeControlYukuIdentity();
	const manifest: CampaignManifest = {
		version: 1,
		campaignId,
		campaignDirectory: directory,
		fixedContract,
		contractSha256: sha256(JSON.stringify(fixedContract)),
		identityFiles,
		identityDigest: identityDigest(identityFiles, controlYukuIdentity),
		controlYukuIdentity,
		commands: synthetic === false ? realCommands() : syntheticCommands(synthetic.scenarios),
		synthetic,
	};
	await mkdir(directory);
	await fsyncDirectory(dirname(directory));
	await writeImmutable(resolve(directory, manifestName), manifest);
	await mkdir(resolve(directory, identifiersName));
	await fsyncDirectory(directory);
	return sha256(jsonLine(manifest));
};

export const createFixedCampaign = async (directory: string, campaignId: string): Promise<string> =>
	createCampaignInternal(directory, campaignId, false);

export const createSyntheticCampaignForTests = async (
	directory: string,
	campaignId: string,
	identityFile: string,
	scenarios: SyntheticScenarios,
): Promise<string> => createCampaignInternal(directory, campaignId, { identityFile, scenarios });

const identifierDirectory = (campaignDirectory: string, id: string): string =>
	resolve(campaignDirectory, identifiersName, id);

const claimIdentifier = async (
	campaignDirectory: string,
	command: CommandIdentity,
	manifestSha256: string,
): Promise<void> => {
	const directory = identifierDirectory(campaignDirectory, command.id);
	await mkdir(directory);
	await fsyncDirectory(dirname(directory));
	await mkdir(resolve(directory, "events"));
	await fsyncDirectory(directory);
	await writeImmutable(resolve(directory, "identifier.json"), {
		version: 1,
		manifestSha256,
		...command,
	} satisfies IdentifierReceipt);
};

const expectedPhases = (kind: ReceiptKind): readonly EventPhase[] =>
	kind === "matrix" ? ["start", "pre-trace", "final", "exit"] : ["start", "final", "exit"];

const eventFiles = async (eventsDirectory: string): Promise<string[]> =>
	(await readdir(eventsDirectory)).filter((name) => name.endsWith(".json")).sort();

const appendEvent = async (
	campaignDirectory: string,
	id: string,
	phase: EventPhase,
	actor: ReceiptEvent["actor"],
	payload: Record<string, unknown>,
): Promise<void> => {
	assertIdentifier(id);
	const directory = identifierDirectory(campaignDirectory, id);
	const identifier = await readJson<IdentifierReceipt>(resolve(directory, "identifier.json"));
	const eventsDirectory = resolve(directory, "events");
	const files = await eventFiles(eventsDirectory);
	const phases = expectedPhases(identifier.value.kind);
	let lastEvent: ReceiptEvent | null = null;
	let previousSha256 = sha256(identifier.bytes);
	if (files.length > 0) {
		const lastFile = files.at(-1);
		if (!lastFile) fail("event list lost its final entry");
		const receipt = await readJson<ReceiptEvent>(resolve(eventsDirectory, lastFile));
		lastEvent = receipt.value;
		previousSha256 = sha256(receipt.bytes);
	}
	if (phase === "exit") {
		if (files.length === 0 || lastEvent?.phase === "exit") fail("exit event cannot be duplicated");
	} else if (phases[files.length] !== phase) {
		fail(`invalid receipt phase ${phase}`);
	}
	const event: ReceiptEvent = {
		version: 1,
		id,
		sequence: files.length,
		phase,
		actor,
		previousSha256,
		payload,
	};
	await writeImmutable(
		resolve(eventsDirectory, `${String(event.sequence).padStart(3, "0")}-${phase}.json`),
		event,
	);
};

export const recordInternalPhaseFromEnvironment = async (
	phase: InternalPhase,
	payload: Record<string, unknown>,
): Promise<void> => {
	const campaignDirectory = process.env[receiptCampaignEnv];
	const id = process.env[receiptIdentifierEnv];
	if (!campaignDirectory || !id) fail("internal receipt environment is incomplete");
	await appendEvent(campaignDirectory, id, phase, "internal-child", payload);
};

export const hasInternalReceiptEnvironment = (): boolean =>
	Boolean(process.env[receiptCampaignEnv] || process.env[receiptIdentifierEnv]);

const runCommandInternal = async (
	campaignDirectory: string,
	id: CommandIdentity["id"],
	allowSynthetic: boolean,
): Promise<SpawnSyncReturns<string>> => {
	assertCampaignPath(campaignDirectory);
	const { manifest, sha256: manifestSha256 } = await campaignManifest(campaignDirectory);
	await validateManifestShape(campaignDirectory, manifest, allowSynthetic);
	await recheckIdentityFiles(manifest);
	const command = manifest.commands.find((candidate) => candidate.id === id);
	if (!command) fail(`identifier is not in manifest: ${id}`);
	await claimIdentifier(campaignDirectory, command, manifestSha256);
	await appendEvent(campaignDirectory, id, "start", "external-runner", {
		argv: command.argv,
		cwd: command.cwd,
		executable: command.executable,
	});
	let result: SpawnSyncReturns<string>;
	try {
		result = spawnSync(command.executable, command.argv, {
			cwd: command.cwd,
			encoding: "utf8",
			env: {
				...process.env,
				[receiptCampaignEnv]: campaignDirectory,
				[receiptIdentifierEnv]: id,
			},
		});
	} catch (error) {
		await appendEvent(campaignDirectory, id, "exit", "external-runner", {
			error: String(error),
			signal: null,
			status: null,
		});
		throw error;
	}
	await appendEvent(campaignDirectory, id, "exit", "external-runner", {
		error: result.error ? String(result.error) : null,
		signal: result.signal,
		status: result.status,
	});
	return result;
};

export const runFixedCommand = async (
	campaignDirectory: string,
	id: CommandIdentity["id"],
): Promise<SpawnSyncReturns<string>> => runCommandInternal(campaignDirectory, id, false);

export const runSyntheticCommandForTests = async (
	campaignDirectory: string,
	id: CommandIdentity["id"],
): Promise<SpawnSyncReturns<string>> => runCommandInternal(campaignDirectory, id, true);

const validateNoTemporaryFiles = async (directory: string): Promise<void> => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (temporaryPattern.test(entry.name) || entry.name.endsWith(".tmp")) {
			fail(`partial atomic receipt remains: ${entry.name}`);
		}
		if (entry.isDirectory()) await validateNoTemporaryFiles(resolve(directory, entry.name));
	}
};

const median = (values: number[]): number => {
	const sorted = [...values].sort((left, right) => left - right);
	return (sorted[4] + sorted[5]) / 2;
};

const numberArray = (value: unknown, label: string): number[] => {
	if (
		!Array.isArray(value) ||
		value.some(
			(entry) =>
				typeof entry !== "number" ||
				!Number.isFinite(entry) ||
				!Number.isInteger(entry) ||
				entry <= 0,
		)
	) {
		fail(`${label} must contain positive finite integers`);
	}
	return value as number[];
};

const validateFallback = (value: unknown): FallbackEvidence => {
	if (!value || typeof value !== "object") fail("fallback evidence is missing");
	const fallback = value as Record<string, unknown>;
	const controlValues = numberArray(fallback.control, "control samples");
	const seamValues = numberArray(fallback.seam, "seam samples");
	const controlElapsed = numberArray(fallback.controlElapsedNs, "control elapsed values");
	const seamElapsed = numberArray(fallback.seamElapsedNs, "seam elapsed values");
	for (const vector of [controlValues, seamValues, controlElapsed, seamElapsed]) {
		if (vector.length !== fixedContract.orderedPairs) fail("fallback vectors require ten values");
	}
	for (const elapsed of [...controlElapsed, ...seamElapsed]) {
		if (elapsed < fixedContract.minimumElapsedNs) fail("profile region is shorter than 250ms");
	}
	const controlMedian = median(controlValues);
	const seamMedian = median(seamValues);
	const deltaPercent = ((seamMedian - controlMedian) * 100) / controlMedian;
	if (
		!Number.isFinite(controlMedian) ||
		!Number.isFinite(seamMedian) ||
		!Number.isFinite(deltaPercent)
	) {
		fail("computed median or delta is not finite");
	}
	if (fallback.controlMedian !== controlMedian || fallback.seamMedian !== seamMedian) {
		fail("recorded medians diverge from vectors");
	}
	if (fallback.deltaPercent !== deltaPercent) fail("recorded delta diverges from vectors");
	if (deltaPercent > fixedContract.thresholdPercent) fail("matrix exceeds the fixed threshold");
	return fallback as FallbackEvidence;
};

const validateProfileResult = (value: unknown): void => {
	if (!value || typeof value !== "object") fail("profiler result is missing");
	const profile = value as Record<string, unknown>;
	if (
		profile.warmupIterations !== fixedContract.warmupIterations ||
		profile.sampleIterations !== fixedContract.sampleIterations ||
		profile.filesPerIteration !== fixedContract.filesPerIteration ||
		typeof profile.elapsedNs !== "number" ||
		!Number.isFinite(profile.elapsedNs) ||
		!Number.isInteger(profile.elapsedNs) ||
		profile.elapsedNs < fixedContract.minimumElapsedNs ||
		typeof profile.nsPerParse !== "number" ||
		!Number.isFinite(profile.nsPerParse) ||
		!Number.isInteger(profile.nsPerParse) ||
		profile.nsPerParse <= 0
	) {
		fail("profiler contract diverged");
	}
};

const validateMatrixFinal = (preTrace: ReceiptEvent, final: ReceiptEvent): void => {
	if (final.payload.status !== "pass") fail("matrix final status failed");
	const preFallback = validateFallback(preTrace.payload.fallback);
	const result = final.payload.result as Record<string, unknown> | undefined;
	if (!result || JSON.stringify(result.fallback) !== JSON.stringify(preFallback)) {
		fail("pre-trace and final fallback evidence diverge");
	}
	validateFallback(result.fallback);
	const profilerBuilds = result.profilerBuilds as Record<string, unknown> | undefined;
	if (!profilerBuilds) fail("profiler builds are missing");
	validateProfileResult(profilerBuilds.control);
	validateProfileResult(profilerBuilds.seam);
	const timeProfiler = result.timeProfiler as Record<string, unknown> | undefined;
	const parserStackSamples = timeProfiler?.parserStackSamples;
	const totalSamples = timeProfiler?.totalSamples;
	if (
		!timeProfiler ||
		timeProfiler.template !== fixedContract.profiler.template ||
		timeProfiler.timeLimitSeconds !== fixedContract.profiler.timeLimitSeconds ||
		timeProfiler.finalizationGraceSeconds !== fixedContract.profiler.finalizationGraceSeconds ||
		timeProfiler.postSigintGraceSeconds !== fixedContract.profiler.postSigintGraceSeconds ||
		timeProfiler.samplePeriodUs !== fixedContract.profiler.samplePeriodUs ||
		timeProfiler.targetExitObserved !== fixedContract.profiler.targetExitObserved ||
		typeof timeProfiler.postExitSigintSent !== "boolean" ||
		typeof parserStackSamples !== "number" ||
		!Number.isFinite(parserStackSamples) ||
		!Number.isInteger(parserStackSamples) ||
		parserStackSamples < fixedContract.minimumParserStackSamples ||
		typeof totalSamples !== "number" ||
		!Number.isFinite(totalSamples) ||
		!Number.isInteger(totalSamples) ||
		totalSamples <= 0 ||
		parserStackSamples > totalSamples
	) {
		fail("Time Profiler evidence diverged");
	}
};

const validateIdentifier = async (
	campaignDirectory: string,
	manifestSha256: string,
	command: CommandIdentity,
): Promise<string> => {
	const directory = identifierDirectory(campaignDirectory, command.id);
	const identifier = await readJson<IdentifierReceipt>(resolve(directory, "identifier.json"));
	if (identifier.value.manifestSha256 !== manifestSha256) fail("identifier manifest hash diverged");
	const { version: _version, manifestSha256: _manifest, ...recorded } = identifier.value;
	if (!commandEquals(recorded, command)) fail("identifier command diverged");
	const eventsDirectory = resolve(directory, "events");
	const files = await eventFiles(eventsDirectory);
	const phases = expectedPhases(command.kind);
	if (files.length !== phases.length) fail(`incomplete receipt for ${command.id}`);
	let previousSha256 = sha256(identifier.bytes);
	const events: ReceiptEvent[] = [];
	for (let sequence = 0; sequence < files.length; sequence += 1) {
		const event = await readJson<ReceiptEvent>(resolve(eventsDirectory, files[sequence]));
		if (
			event.value.id !== command.id ||
			event.value.sequence !== sequence ||
			event.value.phase !== phases[sequence] ||
			event.value.previousSha256 !== previousSha256
		) {
			fail(`broken or reordered receipt chain for ${command.id}`);
		}
		const actor =
			event.value.phase === "start" || event.value.phase === "exit"
				? "external-runner"
				: "internal-child";
		if (event.value.actor !== actor) fail(`invalid event actor for ${command.id}`);
		previousSha256 = sha256(event.bytes);
		events.push(event.value);
	}
	const exit = events.at(-1)?.payload;
	if (!exit || exit.status !== 0 || exit.signal !== null || exit.error !== null) {
		fail(`command did not exit successfully: ${command.id}`);
	}
	const final = events.at(-2);
	if (!final || final.payload.status !== "pass") fail(`final receipt failed: ${command.id}`);
	if (command.kind === "matched-fuzz") {
		const result = final.payload.result as Record<string, unknown> | undefined;
		if (JSON.stringify(result?.seeds) !== JSON.stringify(expectedSeeds)) {
			fail("matched-fuzz seed evidence diverged");
		}
	} else {
		validateMatrixFinal(events[1], final);
	}
	return previousSha256;
};

const validateCampaignInternal = async (
	campaignDirectory: string,
	expectedManifestSha256: string,
	allowSynthetic: boolean,
): Promise<CampaignValidation> => {
	assertCampaignPath(campaignDirectory);
	assertSha256(expectedManifestSha256, "expected manifest hash");
	await validateNoTemporaryFiles(campaignDirectory);
	const validationPath = resolve(campaignDirectory, validationName);
	const existing = (await receiptPathExists(validationPath))
		? await readJson<CampaignValidation>(validationPath)
		: null;
	const { manifest, sha256: manifestSha256 } = await campaignManifest(campaignDirectory);
	if (manifestSha256 !== expectedManifestSha256) fail("manifest hash does not match expectation");
	await validateManifestShape(campaignDirectory, manifest, allowSynthetic);
	await recheckIdentityFiles(manifest);
	const terminalEventSha256 = {} as Record<(typeof expectedIds)[number], string>;
	for (let index = 0; index < expectedIds.length; index += 1) {
		if (manifest.commands[index]?.id !== expectedIds[index]) fail("command order diverged");
		const id = expectedIds[index];
		terminalEventSha256[id] = await validateIdentifier(
			campaignDirectory,
			manifestSha256,
			manifest.commands[index],
		);
	}
	const validatedAt = existing?.value.validatedAt ?? new Date().toISOString();
	if (new Date(validatedAt).toISOString() !== validatedAt) fail("validation timestamp is invalid");
	const validation: CampaignValidation = {
		version: 1,
		campaignId: manifest.campaignId,
		manifestSha256,
		contractSha256: manifest.contractSha256,
		identityDigest: manifest.identityDigest,
		identifiers: [...expectedIds],
		terminalEventSha256,
		validatedAt,
	};
	if (existing) {
		if (JSON.stringify(existing.value) !== JSON.stringify(validation)) {
			fail("existing campaign-validation receipt diverged from recomputed evidence");
		}
		return existing.value;
	}
	await writeImmutable(validationPath, validation);
	return validation;
};

export const validateFixedCampaign = async (
	campaignDirectory: string,
	expectedManifestSha256: string,
): Promise<CampaignValidation> =>
	validateCampaignInternal(campaignDirectory, expectedManifestSha256, false);

export const validateSyntheticCampaignForTests = async (
	campaignDirectory: string,
	expectedManifestSha256: string,
): Promise<CampaignValidation> =>
	validateCampaignInternal(campaignDirectory, expectedManifestSha256, true);

export const receiptPathExists = async (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

const option = (args: string[], name: string): string => {
	const index = args.indexOf(name);
	if (index < 0 || !args[index + 1]) fail(`missing ${name}`);
	return args[index + 1];
};

const assertOnlyOptions = (args: string[], allowed: readonly string[]): void => {
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index += 2) {
		if (!allowed.includes(args[index]) || !args[index + 1])
			fail(`unexpected option ${args[index]}`);
		if (seen.has(args[index])) fail(`duplicate option ${args[index]}`);
		seen.add(args[index]);
	}
};

const usage = `Usage:
  node tools/m1-receipt.ts create --campaign <absolute-path> --campaign-id <id>
  node tools/m1-receipt.ts run --campaign <absolute-path> --id <matched-fuzz|matrix-1|matrix-2|matrix-3>
  node tools/m1-receipt.ts validate --campaign <absolute-path> --expected-manifest-sha256 <sha256>
`;

const main = async (): Promise<void> => {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === "--help") {
		process.stdout.write(usage);
		return;
	}
	const operation = args.shift();
	if (operation === "create") {
		assertOnlyOptions(args, ["--campaign", "--campaign-id"]);
		const campaign = option(args, "--campaign");
		const digest = await createFixedCampaign(campaign, option(args, "--campaign-id"));
		process.stdout.write(`${JSON.stringify({ operation, campaign, manifestSha256: digest })}\n`);
		return;
	}
	if (operation === "run") {
		assertOnlyOptions(args, ["--campaign", "--id"]);
		const id = option(args, "--id");
		if (!expectedIds.includes(id as CommandIdentity["id"]))
			fail(`invalid command identifier ${id}`);
		const result = await runFixedCommand(option(args, "--campaign"), id as CommandIdentity["id"]);
		process.stdout.write(`${JSON.stringify({ operation, id, status: result.status })}\n`);
		if (result.status !== 0) process.exitCode = result.status ?? 1;
		return;
	}
	if (operation === "validate") {
		assertOnlyOptions(args, ["--campaign", "--expected-manifest-sha256"]);
		const validation = await validateFixedCampaign(
			option(args, "--campaign"),
			option(args, "--expected-manifest-sha256"),
		);
		process.stdout.write(`${JSON.stringify({ operation, validation })}\n`);
		return;
	}
	fail("expected create, run, validate, or --help");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
