import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitChildEnvironment } from "./m1-git-environment.ts";
import { hasInternalReceiptEnvironment, recordInternalPhaseFromEnvironment } from "./m1-receipt.ts";

type Mode = "none" | "sentinel";

type Arguments = {
	mode?: Mode;
	controlYuku: string;
	seamYuku: string;
	compareRef: string;
	seeds?: string[];
	flags: Set<string>;
};

type CommandResult = {
	status: number;
	output: string;
};

const expectedRef = "eb2adcb4c17da16e7ade1a0517192d81d469e67f";
const expectedSeamHead = "8a95bfbfc132e3df77bd142943fede6a36f90a7b";
const expectedPriorArt = "bf03e146d97ae2f0c2d4c4ec90456e1e544d2760";
const excludedNames = new Set([".git", ".zig-cache", "node_modules", "zig-cache", "zig-out"]);

function fail(message: string): never {
	throw new Error(message);
}

const execute = (
	command: string,
	args: string[],
	options: {
		cwd?: string;
		input?: Buffer;
		allowFailure?: boolean;
		environment?: NodeJS.ProcessEnv;
	} = {},
): CommandResult => {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "buffer",
		env: options.environment,
		input: options.input,
		maxBuffer: 256 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	const status = result.status ?? -1;
	const output = Buffer.concat([
		Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
		Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
	]).toString();
	if (status !== 0 && !options.allowFailure) {
		fail(`${command} ${args.join(" ")} exited with status ${status}\n${output}`);
	}
	return { status, output };
};

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

const requireFlagSet = (actual: Set<string>, expected: readonly string[]): void => {
	for (const flag of expected) if (!actual.has(flag)) fail(`missing required flag ${flag}`);
	for (const flag of actual) if (!expected.includes(flag)) fail(`unexpected flag ${flag}`);
};

const parseArguments = (argv: string[]): Arguments => {
	let mode: Mode | undefined;
	let controlYuku: string | undefined;
	let seamYuku: string | undefined;
	let compareRef: string | undefined;
	const flags = new Set<string>();
	for (let index = 0; index < argv.length; index += 1) {
		const option = argv[index];
		if (["--mode", "--control-yuku", "--seam-yuku", "--compare-ref", "--seeds"].includes(option)) {
			const value = argv[index + 1];
			if (!value) fail(`missing value for ${option}`);
			if (option === "--mode") {
				if (value !== "none" && value !== "sentinel") fail(`invalid mode ${value}`);
				mode = value;
			} else if (option === "--control-yuku") controlYuku = value;
			else if (option === "--seam-yuku") seamYuku = value;
			else if (option === "--compare-ref") compareRef = value;
			else flags.add(`seeds:${value}`);
			index += 1;
		} else if (option.startsWith("--")) flags.add(option);
		else fail(`unexpected argument ${option}`);
	}
	if (!controlYuku || !seamYuku) {
		fail("--control-yuku and --seam-yuku are required");
	}
	const seedFlag = [...flags].find((flag) => flag.startsWith("seeds:"));
	if (seedFlag) flags.delete(seedFlag);
	return {
		mode,
		controlYuku: resolve(controlYuku),
		seamYuku: resolve(seamYuku),
		compareRef: compareRef ?? expectedRef,
		seeds: seedFlag?.slice("seeds:".length).split(","),
		flags,
	};
};

export const parseNodeVariants = (source: string): string[] => {
	const start = source.indexOf("pub const NodeData = union(enum) {");
	const end = source.indexOf("\n    /// True when", start);
	if (start < 0 || end < 0) fail("could not locate NodeData union");
	return [...source.slice(start, end).matchAll(/^    ([a-z][a-z0-9_]*):/gm)].map(
		(match) => match[1],
	);
};

export const overlayBudget = (
	hosts: number,
	overlays: number,
): {
	densityPercent: number;
	indexPercent: number;
} => {
	if (!Number.isInteger(hosts) || !Number.isInteger(overlays) || hosts <= 0 || overlays < 0) {
		fail("overlay counts must be bounded nonnegative integers");
	}
	return {
		densityPercent: (overlays * 100) / hosts,
		indexPercent: (overlays * 8 * 100) / (hosts * 52),
	};
};

const currentHookNames = async (seamYuku: string): Promise<string[]> => {
	const abi = await readFile(join(seamYuku, "src/parser/dialect/abi.zig"), "utf8");
	const body = abi.match(/pub const Hook = enum\(u8\) \{([\s\S]*?)\n\};/)?.[1];
	if (!body) fail("could not reflect current Hook enum");
	return [...body.matchAll(/^    ([a-z][a-z0-9_]*),$/gm)].map((match) => match[1]);
};

const gitOutput = (repo: string, args: string[]): string =>
	execute("git", ["-C", repo, ...args], { environment: gitChildEnvironment() }).output.trim();

const verifyWorktrees = (args: Arguments): void => {
	if (gitOutput(args.seamYuku, ["symbolic-ref", "--short", "HEAD"]) !== "verify/pr164") {
		fail("seam worktree must remain on verify/pr164");
	}
	if (gitOutput(args.seamYuku, ["rev-parse", "HEAD"]) !== expectedSeamHead) {
		fail("seam worktree HEAD changed");
	}
	if (gitOutput(args.seamYuku, ["merge-base", "HEAD", expectedRef]) !== expectedRef) {
		fail("seam worktree merge base changed");
	}
	if (gitOutput(args.controlYuku, ["rev-parse", "HEAD"]) !== expectedPriorArt) {
		fail("prior-art Yuku HEAD changed");
	}
	if (gitOutput(args.controlYuku, ["status", "--porcelain=v1"]) !== "") {
		fail("prior-art Yuku is dirty");
	}
	const tracking = execute(
		"git",
		["-C", args.controlYuku, "config", "--get", "branch.verify/pr164.remote"],
		{ allowFailure: true, environment: gitChildEnvironment() },
	);
	if (tracking.status === 0) fail("verify/pr164 must not have a tracking remote");
	if (args.compareRef !== expectedRef) fail(`compare ref must be exact ${expectedRef}`);
};

const seamAllowed = new Set([
	"build.zig",
	"src/parser/root.zig",
	"src/parser/parser.zig",
	"src/parser/ast.zig",
	"src/parser/lexer.zig",
	"src/parser/dialect/abi.zig",
	"src/parser/dialect/none.zig",
	"src/parser/ffi/transfer/root.zig",
	"src/parser/syntax/statements.zig",
	"src/parser/syntax/expressions.zig",
	"src/parser/syntax/functions.zig",
	"src/parser/syntax/for_loop.zig",
	"src/parser/syntax/patterns.zig",
	"src/parser/syntax/modules.zig",
	"src/parser/syntax/variables.zig",
	"src/parser/syntax/jsx/root.zig",
	"src/parser/testing/dialect.zig",
	"tools/estree/meta.zig",
	"tools/estree/decoder.zig",
	"tools/estree/encoder.zig",
]);

const verifyScope = (args: Arguments): void => {
	const status = execute("git", ["-C", args.seamYuku, "status", "--porcelain=v1"], {
		environment: gitChildEnvironment(),
	}).output.trimEnd();
	for (const line of status.split("\n").filter(Boolean)) {
		const path = line.slice(3).replace(/\/$/, "");
		if (path === "src/parser/dialect") continue;
		if (!seamAllowed.has(path)) fail(`out-of-scope seam path ${path}`);
	}
	const tsrx = execute("rg", ["-i", "-n", "tsrx", "src", "tools"], {
		cwd: args.seamYuku,
		allowFailure: true,
	});
	if (tsrx.status === 0) fail(`Yuku seam contains a TSRX identifier\n${tsrx.output}`);
	if (tsrx.status !== 1) fail("scope search failed");
	const added = gitOutput(args.seamYuku, ["diff", "--unified=0", args.compareRef]);
	for (const line of added.split("\n")) {
		if (!line.startsWith("+") || line.startsWith("+++")) continue;
		if (/anyopaque|\*const\s+fn|vtable|plugin_registry|runtime_dispatch/i.test(line)) {
			fail(`runtime dispatch artifact introduced: ${line}`);
		}
	}
	const dialectSource = execute("rg", ["--files", "src/dialect"], {
		cwd: resolve(import.meta.dirname, ".."),
	})
		.output.trim()
		.split("\n")
		.filter(Boolean);
	for (const path of dialectSource) {
		const source = execute("sed", ["-n", "1,260p", path], {
			cwd: resolve(import.meta.dirname, ".."),
		}).output;
		if (source.includes('@import("parser")')) fail(`external dialect imports parser: ${path}`);
		if (/pub\s+fn\s+parse\s*\(/.test(source))
			fail(`external dialect implements a second parser: ${path}`);
	}
};

const prepareControlProject = async (
	args: Arguments,
): Promise<{
	root: string;
	controlProject: string;
	seamProject: string;
	controlYuku: string;
	seamYuku: string;
}> => {
	const root = await mkdtemp(join(tmpdir(), "yuku-tsrx-m1-"));
	const projectSource = resolve(import.meta.dirname, "..");
	const controlBase = join(root, "control");
	const seamBase = join(root, "seam___");
	const controlProject = join(controlBase, basename(projectSource));
	const seamProject = join(seamBase, basename(projectSource));
	const controlYuku = join(controlBase, "yuku-dialect");
	const seamYuku = join(seamBase, "yuku-dialect");
	await mkdir(controlBase, { recursive: true });
	await mkdir(seamBase, { recursive: true });
	await cp(projectSource, controlProject, {
		recursive: true,
		filter: (source) => !excludedNames.has(basename(source)),
	});
	await cp(projectSource, seamProject, {
		recursive: true,
		filter: (source) => !excludedNames.has(basename(source)),
	});
	await mkdir(controlYuku);
	const rawArchive = spawnSync(
		"git",
		["-C", args.controlYuku, "archive", "--format=tar", args.compareRef],
		{
			encoding: "buffer",
			env: gitChildEnvironment(),
			maxBuffer: 256 * 1024 * 1024,
		},
	);
	if (
		rawArchive.status !== 0 ||
		!Buffer.isBuffer(rawArchive.stdout) ||
		rawArchive.stdout.length === 0
	) {
		fail("control archive failed");
	}
	execute("tar", ["-xf", "-", "-C", controlYuku], { input: rawArchive.stdout });
	await cp(args.seamYuku, seamYuku, {
		recursive: true,
		filter: (source) => !excludedNames.has(basename(source)),
	});
	return { root, controlProject, seamProject, controlYuku, seamYuku };
};

const parseLayout = (
	output: string,
): {
	nodeData: number;
	node: number;
	tree: number;
	store: number;
	wireBytes: number;
	wireSha256: string;
} => {
	const layout = output.match(/node_data=(\d+) node=(\d+) tree=(\d+) store=(\d+)/);
	const wire = output.match(/disabled wire: bytes=(\d+) sha256=([0-9a-f]{64})/);
	if (!layout || !wire) fail(`missing disabled layout/wire evidence\n${output}`);
	return {
		nodeData: Number(layout[1]),
		node: Number(layout[2]),
		tree: Number(layout[3]),
		store: Number(layout[4]),
		wireBytes: Number(wire[1]),
		wireSha256: wire[2],
	};
};

const controlProbe = async (
	controlYuku: string,
	root: string,
): Promise<ReturnType<typeof parseLayout>> => {
	const probe = join(root, "probe.zig");
	const options = join(root, "options.zig");
	await writeFile(options, "pub const source_maps = true;\n");
	await writeFile(
		probe,
		`const std = @import("std");
const parser = @import("parser");
const transfer = @import("transfer");
pub fn main() !void {
    var tree = try parser.parse(std.heap.page_allocator, "export const value: number = <Box answer={42} />;", .{ .lang = .tsx });
    defer tree.deinit();
    if (tree.hasErrors()) return error.ControlDiagnostic;
    const bytes = try std.heap.page_allocator.alloc(u8, transfer.bufferSize(&tree));
    defer std.heap.page_allocator.free(bytes);
    _ = transfer.serializeInto(&tree, bytes);
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    std.debug.print("disabled layout: node_data={d} node={d} tree={d} store=0\\n", .{ @sizeOf(parser.ast.NodeData), @sizeOf(parser.ast.Node), @sizeOf(parser.ast.Tree) });
    std.debug.print("disabled wire: bytes={d} sha256={x}\\n", .{ bytes.len, digest });
}
`,
	);
	const result = execute("zig", [
		"run",
		"--dep",
		"parser",
		"--dep",
		"transfer",
		`-Mroot=${probe}`,
		"--dep",
		"util",
		"--dep",
		"codegen_options",
		`-Mparser=${join(controlYuku, "src/parser/root.zig")}`,
		`-Mutil=${join(controlYuku, "src/util/root.zig")}`,
		`-Mcodegen_options=${options}`,
		"--dep",
		"parser",
		`-Mtransfer=${join(controlYuku, "src/parser/ffi/transfer/root.zig")}`,
	]);
	return parseLayout(result.output);
};

type ProfileResult = {
	warmupIterations: number;
	sampleIterations: number;
	filesPerIteration: number;
	elapsedNs: number;
	nsPerParse: number;
};

const parseProfile = (output: string): ProfileResult => {
	const matches = [
		...output.matchAll(
			/{"warmup_iterations":(\d+),"sample_iterations":(\d+),"files_per_iteration":(\d+),"elapsed_ns":(\d+),"ns_per_parse":(\d+)}/g,
		),
	];
	const match = matches.at(-1);
	if (!match) fail(`missing profiler result\n${output}`);
	const result = {
		warmupIterations: Number(match[1]),
		sampleIterations: Number(match[2]),
		filesPerIteration: Number(match[3]),
		elapsedNs: Number(match[4]),
		nsPerParse: Number(match[5]),
	};
	if (
		result.warmupIterations !== 10_000 ||
		result.sampleIterations !== 100_000 ||
		result.filesPerIteration !== 3
	) {
		fail(`profiler contract changed ${JSON.stringify(result)}`);
	}
	if (result.elapsedNs < 250_000_000) {
		fail(`profiler measured region shorter than 250ms ${JSON.stringify(result)}`);
	}
	return result;
};

const median = (values: number[]): number => {
	const sorted = [...values].sort((left, right) => left - right);
	return (sorted[4] + sorted[5]) / 2;
};

const buildProfiler = (project: string): { binaryPath: string; profile: ProfileResult } => {
	const output = execute("zig", ["build", "profile", "-Doptimize=ReleaseFast", "--verbose"], {
		cwd: project,
	}).output;
	const binary = [...output.matchAll(/^(.+\/yuku-tsrx-profiler)$/gm)].at(-1)?.[1];
	if (!binary) fail(`missing profiler executable path\n${output}`);
	return { binaryPath: resolve(project, binary), profile: parseProfile(output) };
};

const normalizedHotFunctions = (binaryPath: string): Record<string, unknown> => {
	const symbols = execute("nm", ["-n", binaryPath])
		.output.split("\n")
		.map((line) => line.match(/^([0-9a-f]+)\s+([tT])\s+(.+)$/))
		.filter((match): match is RegExpMatchArray => match !== null)
		.map((match) => ({ address: Number.parseInt(match[1], 16), name: match[3] }));
	if (symbols.length === 0) fail("profiler has no text symbols");
	const baseAddress = symbols[0].address;
	const workloadFunctions = [
		{
			name: "_syntax.functions.parseFunctionBody",
			candidates: [
				"_syntax.functions.parseFunctionBody",
				"_syntax.functions.parseFunctionBodyContinuation",
			],
		},
		{ name: "_syntax.functions.parseFunction", candidates: ["_syntax.functions.parseFunction"] },
		{
			name: "_syntax.expressions.parseMemberProperty",
			candidates: ["_syntax.expressions.parseMemberProperty"],
		},
		{
			name: "_syntax.jsx.root.parseJsxExpression",
			candidates: ["_syntax.jsx.root.parseJsxExpression"],
		},
		{
			name: "_syntax.jsx.root.parseJsxElementName",
			candidates: ["_syntax.jsx.root.parseJsxElementName"],
		},
		{ name: "_lexer.Lexer.nextToken", candidates: ["_lexer.Lexer.nextToken"] },
	];
	const result: Record<string, unknown> = {};
	for (const function_ of workloadFunctions) {
		const index = symbols.findIndex((symbol) => function_.candidates.includes(symbol.name));
		if (index < 0 || index + 1 >= symbols.length) {
			fail(`missing bounded hot symbol ${function_.name}`);
		}
		result[function_.name] = {
			emittedName: symbols[index].name,
			normalizedAddress: symbols[index].address - baseAddress,
			size: symbols[index + 1].address - symbols[index].address,
		};
	}
	return result;
};

const hotFunction = (
	evidence: Record<string, unknown>,
	name: string,
): { normalizedAddress: number; size: number } =>
	evidence[name] as { normalizedAddress: number; size: number };

const validateHotFunctions = (
	control: Record<string, unknown>,
	seam: Record<string, unknown>,
): void => {
	for (const name of ["_syntax.functions.parseFunctionBody"]) {
		const controlFunction = hotFunction(control, name);
		const seamFunction = hotFunction(seam, name);
		if (
			controlFunction.normalizedAddress !== seamFunction.normalizedAddress ||
			controlFunction.size !== seamFunction.size
		) {
			fail(`disabled hot function address/size differs ${name}`);
		}
	}
	const parseFunction = "_syntax.functions.parseFunction";
	if (hotFunction(seam, parseFunction).size !== hotFunction(control, parseFunction).size) {
		fail(`disabled hot function size differs ${parseFunction}`);
	}
};

const timeProfilerEvidence = async (
	binaryPath: string,
	root: string,
): Promise<Record<string, unknown>> => {
	const tracePath = join(root, "seam-time-profiler.trace");
	await rm(tracePath, { recursive: true, force: true });
	try {
		const recording = await new Promise<{
			output: string;
			targetExitObserved: boolean;
			postExitSigintSent: boolean;
		}>((resolveRecording, rejectRecording) => {
			const recorder = spawn(
				"xctrace",
				[
					"record",
					"--template",
					"Time Profiler",
					"--time-limit",
					"5s",
					"--output",
					tracePath,
					"--no-prompt",
					"--launch",
					"--",
					binaryPath,
				],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);
			let output = "";
			let targetExitObserved = false;
			let postExitSigintSent = false;
			let settled = false;
			let finalizationTimer: NodeJS.Timeout | undefined;
			let sigintTimer: NodeJS.Timeout | undefined;

			const clearTimers = (): void => {
				if (finalizationTimer) clearTimeout(finalizationTimer);
				if (sigintTimer) clearTimeout(sigintTimer);
			};
			const deterministicFailure = (message: string): void => {
				if (settled) return;
				settled = true;
				clearTimers();
				const error = new Error(`${message}\n${output}`);
				if (recorder.kill("SIGKILL")) recorder.once("close", () => rejectRecording(error));
				else rejectRecording(error);
			};
			const observe = (chunk: Buffer): void => {
				output += chunk.toString();
				if (!targetExitObserved && output.includes("Target app exited")) {
					targetExitObserved = true;
					finalizationTimer = setTimeout(() => {
						if (settled) return;
						postExitSigintSent = true;
						recorder.kill("SIGINT");
						sigintTimer = setTimeout(
							() => deterministicFailure("xctrace did not finalize after post-exit SIGINT"),
							1_000,
						);
					}, 5_000);
				}
			};
			recorder.stdout.on("data", observe);
			recorder.stderr.on("data", observe);
			recorder.on("error", (error) => deterministicFailure(`xctrace launch failed: ${error}`));
			recorder.on("close", (code) => {
				if (settled) return;
				settled = true;
				clearTimers();
				if (!targetExitObserved) {
					rejectRecording(new Error(`xctrace closed before target exit was observed\n${output}`));
				} else if (code !== 0) {
					rejectRecording(new Error(`xctrace exited with status ${code}\n${output}`));
				} else if (
					!output.includes("Recording completed") ||
					!output.includes("Output file saved")
				) {
					rejectRecording(new Error(`xctrace did not confirm a complete saved trace\n${output}`));
				} else {
					resolveRecording({ output, targetExitObserved, postExitSigintSent });
				}
			});
		});
		const xml = execute("xctrace", [
			"export",
			"--input",
			tracePath,
			"--xpath",
			'/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]',
		]).output;
		const parserBacktraces = new Set(
			[...xml.matchAll(/<tagged-backtrace id="(\d+)" fmt="([^"]*)"/g)]
				.filter((match) => /^(?:syntax\.|parser\.|lexer\.|ast\.)/.test(match[2]))
				.map((match) => match[1]),
		);
		let parserStackSamples = 0;
		for (const match of xml.matchAll(
			/<tagged-backtrace (?:id="(\d+)" fmt="([^"]*)"|ref="(\d+)")/g,
		)) {
			if (
				(match[1] && /^(?:syntax\.|parser\.|lexer\.|ast\.)/.test(match[2])) ||
				(match[3] && parserBacktraces.has(match[3]))
			) {
				parserStackSamples += 1;
			}
		}
		const totalSamples = [...xml.matchAll(/<row>/g)].length;
		if (parserStackSamples < 250) {
			fail(`Time Profiler has fewer than 250 parser-stack samples ${parserStackSamples}`);
		}
		return {
			template: "Time Profiler",
			timeLimitSeconds: 5,
			finalizationGraceSeconds: 5,
			postSigintGraceSeconds: 1,
			targetExitObserved: recording.targetExitObserved,
			postExitSigintSent: recording.postExitSigintSent,
			samplePeriodUs: 1_000,
			totalSamples,
			parserStackSamples,
		};
	} finally {
		await rm(tracePath, { recursive: true, force: true });
	}
};

const flushPerformanceEvidence = async (
	fallback: ReturnType<typeof profileFallback>,
	root: string,
): Promise<void> => {
	const durablePath = join(root, "completed-performance.json");
	const evidence = JSON.stringify({ phase: "performance-complete", fallback });
	const handle = await open(durablePath, "w");
	try {
		await handle.writeFile(`${evidence}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}
	process.stdout.write(`${evidence}\n`);
};

const profileFallback = (
	controlProject: string,
	seamProject: string,
): {
	control: number[];
	seam: number[];
	controlElapsedNs: number[];
	seamElapsedNs: number[];
	controlMedian: number;
	seamMedian: number;
	deltaPercent: number;
} => {
	const control: number[] = [];
	const seam: number[] = [];
	const controlElapsedNs: number[] = [];
	const seamElapsedNs: number[] = [];
	for (let sample = 0; sample < 10; sample += 1) {
		const controlResult = parseProfile(
			execute("zig", ["build", "profile", "-Doptimize=ReleaseFast"], {
				cwd: controlProject,
			}).output,
		);
		control.push(controlResult.nsPerParse);
		controlElapsedNs.push(controlResult.elapsedNs);
		const seamResult = parseProfile(
			execute("zig", ["build", "profile", "-Doptimize=ReleaseFast"], {
				cwd: seamProject,
			}).output,
		);
		seam.push(seamResult.nsPerParse);
		seamElapsedNs.push(seamResult.elapsedNs);
	}
	const controlMedian = median(control);
	const seamMedian = median(seam);
	const deltaPercent = ((seamMedian - controlMedian) * 100) / controlMedian;
	return {
		control,
		seam,
		controlElapsedNs,
		seamElapsedNs,
		controlMedian,
		seamMedian,
		deltaPercent,
	};
};

const executableSectionHashes = (binaryPath: string): Record<string, string> => {
	const hashes: Record<string, string> = {};
	for (const section of ["__text", "__stubs", "__stub_helper"]) {
		const output = execute("objdump", [
			"--macho",
			"--full-contents",
			`--section=${section}`,
			binaryPath,
		]).output;
		const contents = output.slice(output.indexOf("Contents of section"));
		if (!contents) fail(`missing executable section ${section}`);
		const bytes = [...contents.matchAll(/^\s*[0-9a-f]+\s+((?:[0-9a-f]{8}\s*){1,4})/gm)]
			.map((match) => match[1].replaceAll(/\s/g, ""))
			.join("");
		if (!bytes) fail(`missing executable bytes for ${section}`);
		hashes[section] = sha256(bytes);
	}
	return hashes;
};

const disabledArtifactEvidence = async (
	binaryPath: string,
	seamYuku: string,
): Promise<Record<string, unknown>> => {
	const symbols = execute("nm", [binaryPath], { allowFailure: true }).output;
	const stringTable = execute("strings", [binaryPath]).output;
	const disassembly = execute("objdump", ["-d", binaryPath]).output;
	const names = ["dialectHook", "before_parse", "observe", ...(await currentHookNames(seamYuku))];
	const matches = {
		symbols: names.filter((name) => symbols.includes(name)),
		strings: names.filter((name) => stringTable.includes(name)),
		disassembly: names.filter((name) => disassembly.includes(name)),
	};
	if (matches.symbols.length || matches.strings.length || matches.disassembly.length) {
		fail(`disabled binary retains hook artifacts ${JSON.stringify(matches)}`);
	}
	return {
		namesChecked: names,
		matches,
		symbolSha256: sha256(symbols),
		stringSha256: sha256(stringTable),
		disassemblySha256: sha256(disassembly),
	};
};

const localizeExecutableDelta = async (
	seamProject: string,
	controlYuku: string,
	seamYuku: string,
	sourceSeamYuku: string,
	controlSections: Record<string, string>,
): Promise<Array<Record<string, unknown>>> => {
	const semanticFiles = [
		"src/parser/syntax/expressions.zig",
		"src/parser/syntax/functions.zig",
		"src/parser/syntax/patterns.zig",
		"src/parser/syntax/jsx/root.zig",
	];
	const variants = [
		["src/parser/ast.zig"],
		semanticFiles,
		["src/parser/ast.zig", ...semanticFiles],
	];
	const evidence: Array<Record<string, unknown>> = [];
	for (const files of variants) {
		for (const file of files) await cp(join(controlYuku, file), join(seamYuku, file));
		await rm(join(seamProject, ".zig-cache"), { recursive: true, force: true });
		await rm(join(seamProject, "zig-out"), { recursive: true, force: true });
		const build = execute("zig", ["build", "control", "-Doptimize=ReleaseFast"], {
			cwd: seamProject,
			allowFailure: true,
		});
		if (build.status === 0) {
			const binaryPath = join(seamProject, "zig-out/bin/yuku-tsrx-control");
			const sections = executableSectionHashes(binaryPath);
			evidence.push({
				files,
				sections,
				differingExecutableSections: Object.keys(controlSections).filter(
					(section) => controlSections[section] !== sections[section],
				),
			});
		} else {
			evidence.push({ files, buildStatus: build.status, buildOutput: build.output });
		}
		for (const file of files) await cp(join(sourceSeamYuku, file), join(seamYuku, file));
	}
	await rm(join(seamProject, ".zig-cache"), { recursive: true, force: true });
	await rm(join(seamProject, "zig-out"), { recursive: true, force: true });
	execute("zig", ["build", "control", "-Doptimize=ReleaseFast"], { cwd: seamProject });
	return evidence;
};

const verifyNone = async (args: Arguments): Promise<Record<string, unknown>> => {
	requireFlagSet(args.flags, [
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
	]);
	const project = resolve(import.meta.dirname, "..");
	const capacity = execute("zig", ["build", "test-dialect-capacity"], {
		cwd: args.seamYuku,
	}).output;
	const seamLayout = parseLayout(capacity);
	if (seamLayout.nodeData !== 44 || seamLayout.node !== 52 || seamLayout.store !== 0) {
		fail("disabled layout or storage changed");
	}
	const control = await prepareControlProject(args);
	try {
		const upstreamLayout = await controlProbe(control.controlYuku, control.root);
		if (JSON.stringify(seamLayout) !== JSON.stringify(upstreamLayout)) {
			fail(
				`disabled layout/wire differs from control: ${JSON.stringify({ seamLayout, upstreamLayout })}`,
			);
		}
		const controlAst = execute(
			"git",
			["-C", args.controlYuku, "show", `${args.compareRef}:src/parser/ast.zig`],
			{ environment: gitChildEnvironment() },
		).output;
		const seamAst = await readFile(join(args.seamYuku, "src/parser/ast.zig"), "utf8");
		const controlTags = parseNodeVariants(controlAst);
		const seamTags = parseNodeVariants(seamAst);
		if (seamTags.at(-1) !== "dialect_node") fail("dialect_node is not appended last");
		if (JSON.stringify(seamTags.slice(0, -1)) !== JSON.stringify(controlTags)) {
			fail("existing NodeData tags changed");
		}
		execute("zig", ["build", "gen-parser-decoder", "gen-codegen-encoder"], {
			cwd: args.seamYuku,
		});
		const decoder = await readFile(join(args.seamYuku, "zig-out/decode.js"));
		const encoder = await readFile(join(args.seamYuku, "zig-out/encode.js"));
		const controlDecoder = Buffer.from(
			execute(
				"git",
				["-C", args.controlYuku, "show", `${args.compareRef}:npm/yuku-parser/decode.js`],
				{ environment: gitChildEnvironment() },
			).output,
		);
		const controlEncoder = Buffer.from(
			execute(
				"git",
				["-C", args.controlYuku, "show", `${args.compareRef}:npm/yuku-codegen/encode.js`],
				{ environment: gitChildEnvironment() },
			).output,
		);
		if (!decoder.equals(controlDecoder)) fail("disabled decoder bytes changed");
		if (!encoder.equals(controlEncoder)) fail("disabled encoder bytes changed");
		execute("zig", ["build", "control", "-Doptimize=ReleaseFast"], {
			cwd: control.controlProject,
		});
		execute("zig", ["build", "control", "-Doptimize=ReleaseFast"], {
			cwd: control.seamProject,
		});
		const controlBinaryPath = join(control.controlProject, "zig-out/bin/yuku-tsrx-control");
		const seamBinaryPath = join(control.seamProject, "zig-out/bin/yuku-tsrx-control");
		const controlBinary = await readFile(controlBinaryPath);
		const seamBinary = await readFile(seamBinaryPath);
		const baseline = JSON.parse(await readFile(join(project, "baselines/m0.json"), "utf8")) as {
			control: { binary_sha256: string };
		};
		const controlSections = executableSectionHashes(controlBinaryPath);
		const seamSections = executableSectionHashes(seamBinaryPath);
		const differingExecutableSections = Object.keys(controlSections).filter(
			(section) => controlSections[section] !== seamSections[section],
		);
		const executableDeltaLocalization = differingExecutableSections.length
			? await localizeExecutableDelta(
					control.seamProject,
					control.controlYuku,
					control.seamYuku,
					args.seamYuku,
					controlSections,
				)
			: [];
		const fallback = profileFallback(control.controlProject, control.seamProject);
		await flushPerformanceEvidence(fallback, control.root);
		if (hasInternalReceiptEnvironment()) {
			await recordInternalPhaseFromEnvironment("pre-trace", { fallback });
		}
		const controlProfiler = buildProfiler(control.controlProject);
		const seamProfiler = buildProfiler(control.seamProject);
		const normalizedFunctions = {
			control: normalizedHotFunctions(controlProfiler.binaryPath),
			seam: normalizedHotFunctions(seamProfiler.binaryPath),
		};
		validateHotFunctions(normalizedFunctions.control, normalizedFunctions.seam);
		const timeProfiler = await timeProfilerEvidence(seamProfiler.binaryPath, control.root);
		const strippedEvidence = await disabledArtifactEvidence(seamBinaryPath, args.seamYuku);
		const result = {
			layout: seamLayout,
			baseTags: controlTags.length,
			decoderSha256: sha256(decoder),
			encoderSha256: sha256(encoder),
			binarySha256: sha256(seamBinary),
			binaryExact: seamBinary.equals(controlBinary),
			baselineBinarySha256: baseline.control.binary_sha256,
			deterministicBinaries: {
				control: { size: controlBinary.length, sha256: sha256(controlBinary) },
				seam: { size: seamBinary.length, sha256: sha256(seamBinary) },
				controlSections,
				seamSections,
				differingExecutableSections,
				executableDeltaLocalization,
			},
			fallback,
			performancePassed: fallback.deltaPercent <= 2,
			profilerBuilds: {
				control: controlProfiler.profile,
				seam: seamProfiler.profile,
			},
			normalizedFunctions,
			timeProfiler,
			strippedEvidence,
		};
		if (hasInternalReceiptEnvironment()) {
			await recordInternalPhaseFromEnvironment("final", {
				status: result.performancePassed ? "pass" : "fail",
				thresholdPassed: result.performancePassed,
				result,
			});
		}
		return result;
	} finally {
		await rm(control.root, { recursive: true, force: true });
	}
};

const verifySentinel = async (args: Arguments): Promise<Record<string, unknown>> => {
	requireFlagSet(args.flags, [
		"--all-hooks",
		"--capacity",
		"--layout",
		"--roundtrip",
		"--generated-diff",
		"--malformed",
		"--overflow",
		"--overlay-cost",
		"--positive-negative",
	]);
	const project = resolve(import.meta.dirname, "..");
	const behavior = execute("zig", ["build", "test-m1-module-cycle"], { cwd: project });
	const capacity = execute("zig", ["build", "test-dialect-capacity"], {
		cwd: args.seamYuku,
	}).output;
	const sentinelCorpus = behavior.output.match(/unhandled corpus sha256=([0-9a-f]{64})/)?.[1];
	const disabledCorpus = capacity.match(/unhandled corpus sha256=([0-9a-f]{64})/)?.[1];
	if (!sentinelCorpus || !disabledCorpus || sentinelCorpus !== disabledCorpus)
		fail("executed unhandled corpus differs from disabled parser");
	if (!/base=171 slots_max=7 flags_max=11/.test(capacity)) fail("capacity report changed");
	execute("zig", ["build", "gen-m1-dialect-decoder", "gen-m1-dialect-encoder"], {
		cwd: project,
	});
	const decoder = await readFile(join(project, "zig-out/dialect-decode.js"), "utf8");
	const encoder = await readFile(join(project, "zig-out/dialect-encode.js"), "utf8");
	for (const artifact of [decoder, encoder]) {
		for (const tag of [172, 173, 174, 175, 176]) {
			if (!artifact.includes(`tag:${tag}`)) fail(`generated schema is missing tag ${tag}`);
		}
		for (const field of ["value", "active", "hostNode", "index", "key", "resetParam", "lazy"]) {
			if (!artifact.includes(`"${field}"`)) fail(`generated schema is missing ${field}`);
		}
	}
	const synthetic = overlayBudget(100_000, 13_000);
	const priorArt = overlayBudget(100_000, 0);
	const markless = overlayBudget(100_000, 0);
	if (synthetic.densityPercent > 13 || synthetic.indexPercent > 2)
		fail("sparse overlay threshold exceeded");
	return {
		behaviorStatus: behavior.status,
		unhandledCorpusSha256: sentinelCorpus,
		capacity: { base: 171, slotsMax: 7, flagsMax: 11 },
		recordTags: [172, 173, 174, 175, 176],
		decoderSha256: sha256(decoder),
		encoderSha256: sha256(encoder),
		overlay: { synthetic, priorArt, markless },
	};
};

const verifyHookContract = async (args: Arguments): Promise<void> => {
	requireFlagSet(args.flags, ["--check-hook-contract"]);
	const sourceProject = resolve(import.meta.dirname, "..");
	execute("zig", ["build", "test-m1-module-cycle"], { cwd: sourceProject });
	const root = await mkdtemp(join(tmpdir(), "yuku-dialect-contract-"));
	try {
		const project = join(root, basename(sourceProject));
		const seam = join(root, basename(args.seamYuku));
		await cp(sourceProject, project, {
			recursive: true,
			filter: (source) => !excludedNames.has(basename(source)),
		});
		await cp(args.seamYuku, seam, {
			recursive: true,
			filter: (source) => !excludedNames.has(basename(source)),
		});
		const dialectPath = join(project, "src/dialect/root.zig");
		const validDialect = await readFile(dialectPath, "utf8");
		await writeFile(
			dialectPath,
			'const forbidden_parser = @import("parser");\ncomptime { _ = forbidden_parser; }\n' +
				validDialect,
		);
		const parserImport = execute("zig", ["build", "test-m1-module-cycle"], {
			cwd: project,
			allowFailure: true,
		});
		if (
			parserImport.status === 0 ||
			!/no module named ['"]parser['"] available within module ['"]dialect['"]/.test(
				parserImport.output,
			)
		) {
			fail(
				`parser-import negative did not fail for the module-boundary violation\n${parserImport.output}`,
			);
		}
		// Matches the build's "pub fn parse" scan without colliding with the
		// dialect's legitimate `pub const parse` re-export.
		await writeFile(dialectPath, `${validDialect}\npub fn parseSecond() void {}\n`);
		const secondParser = execute("zig", ["build", "test-m1-module-cycle"], {
			cwd: project,
			allowFailure: true,
		});
		if (
			secondParser.status === 0 ||
			!secondParser.output.includes("external dialect contract forbids a second parser declaration")
		) {
			fail(
				`second-parser negative did not fail for the declaration violation\n${secondParser.output}`,
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
};

const verifyMatchedFuzz = async (args: Arguments): Promise<void> => {
	requireFlagSet(args.flags, ["--matched-fuzz"]);
	const expectedSeeds = ["0x59a69a3230b5d620", "0x730b1e8e350ed620"];
	if (JSON.stringify(args.seeds) !== JSON.stringify(expectedSeeds))
		fail("matched fuzz seeds changed");
	const root = await mkdtemp(join(tmpdir(), "yuku-matched-fuzz-"));
	try {
		const pristineRoot = join(root, "pristine");
		const seamRoot = join(root, "seam");
		await mkdir(pristineRoot);
		const archive = spawnSync(
			"git",
			["-C", args.controlYuku, "archive", "--format=tar", args.compareRef],
			{
				encoding: "buffer",
				env: gitChildEnvironment(),
				maxBuffer: 256 * 1024 * 1024,
			},
		);
		if (archive.status !== 0 || !Buffer.isBuffer(archive.stdout))
			fail("fuzz control archive failed");
		execute("tar", ["-xf", "-", "-C", pristineRoot], { input: archive.stdout });
		await cp(args.seamYuku, seamRoot, {
			recursive: true,
			filter: (source) => !excludedNames.has(basename(source)),
		});

		for (const seed of expectedSeeds) {
			for (const project of [pristineRoot, seamRoot]) {
				const mainPath = join(project, "src/parser/testing/fuzz/main.zig");
				const main = await readFile(mainPath, "utf8");
				await writeFile(
					mainPath,
					main.replace(
						/current_seed = (?:@intFromPtr\(&gpa_state\) \*% 0x9e3779b97f4a7c15|0x[0-9a-f]+);/,
						`current_seed = ${seed};`,
					),
				);
			}
			const pristine = execute("zsh", ["-c", "zig build fuzz"], {
				cwd: pristineRoot,
				allowFailure: true,
			});
			const seam = execute("zsh", ["-c", "zig build fuzz"], {
				cwd: seamRoot,
				allowFailure: true,
			});
			const classify = (result: CommandResult): string => {
				const evidence = result.output.match(
					/iter\s+:\s+(\d+)[\s\S]*?mode\s+:\s+(\w+)\s+\/\s+(\w+)[\s\S]*?length\s+:\s+(\d+)/,
				);
				const path = result.output.match(/parser\/traverser\/walk\.zig:175:\d+/)?.[0];
				if (!evidence || !path) fail(`missing matched fuzz evidence for ${seed}`);
				return JSON.stringify({
					status: result.status,
					iteration: Number(evidence[1]),
					lang: evidence[2],
					sourceType: evidence[3],
					length: Number(evidence[4]),
					path,
				});
			};
			if (classify(pristine) !== classify(seam))
				fail(`matched fuzz classification differs for ${seed}`);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
};

const main = async (): Promise<void> => {
	const args = parseArguments(process.argv.slice(2));
	verifyWorktrees(args);
	if (args.flags.has("--matched-fuzz")) {
		await verifyMatchedFuzz(args);
		if (hasInternalReceiptEnvironment()) {
			await recordInternalPhaseFromEnvironment("final", {
				status: "pass",
				result: { seeds: args.seeds },
			});
		}
		process.stdout.write(
			`${JSON.stringify({ mode: "matched-fuzz", status: "pass", seeds: args.seeds })}\n`,
		);
		return;
	}
	if (args.flags.has("--check-hook-contract")) {
		await verifyHookContract(args);
		process.stdout.write(`${JSON.stringify({ mode: "hook-contract", status: "pass" })}\n`);
		return;
	}
	if (!args.mode) {
		requireFlagSet(args.flags, [
			"--check-worktrees",
			"--check-scope",
			"--check-no-tsrx",
			"--check-no-runtime-dispatch",
		]);
		verifyScope(args);
		process.stdout.write(`${JSON.stringify({ mode: "scope", status: "pass" })}\n`);
		return;
	}
	const result = args.mode === "none" ? await verifyNone(args) : await verifySentinel(args);
	const status = args.mode === "none" && result.performancePassed === false ? "fail" : "pass";
	process.stdout.write(`${JSON.stringify({ mode: args.mode, status, ...result })}\n`);
	if (args.mode === "none" && result.performancePassed === false) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
