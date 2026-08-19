# Publish runbook

The operator checklist for putting `yuku-tsrx` on npm. It is adapted from the
same document in `oxc-tsrx`, which has been executed end to end, and it keeps
that document's safety posture: manual dispatch only, dry-run by default, a
typed confirmation phrase before anything irreversible, and no long-lived
registry token anywhere.

**Nothing here has been executed yet.** As of this writing all three names
return 404 from the registry, which is the state this runbook starts from.

## What ships

Three packages:

1. `@yuku-tsrx/binding-darwin-arm64` — the macOS arm64 native addon
2. `@yuku-tsrx/binding-linux-x64-gnu` — the linux x64 glibc native addon
3. `yuku-tsrx` — the JavaScript API, which loads one of the two

That is fewer platforms than the twelve `npm/yuku-tsrx/package.json` used to
list. 0.1.0 ships exactly the two that are built and exercised today; the rest
were placeholders in a template, not packages anyone has produced.

### The order is not negotiable

`yuku-tsrx` last, always. It lists both bindings in `optionalDependencies`, and
npm resolves those at install time against whatever is on the registry at that
moment. Publish the meta package first and you open a window in which a
consumer installs the JavaScript with no addon behind it, and gets no error
saying so — the JavaScript imports fine and throws on the first parse.

`.github/workflows/publish.yml` enforces the order. So does
`scripts/release-local.mjs`.

## Before anything: the license

`docs/site.config.mjs` records that no license has been chosen for this
repository, and there is no `LICENSE` file. So every manifest currently says
`"license": "UNLICENSED"`, which is the accurate description of a repository
that has granted nobody any rights — not a placeholder value someone forgot to
change.

Publishing an unlicensed package to a public registry is a decision only the
owner can make. Two things have to happen before `mode: publish` will run:

1. Add a `LICENSE` file at the repository root.
2. Change `"license"` in all three manifests under `npm/yuku-tsrx/` to the
   matching SPDX identifier. `oxc-tsrx`, the sibling project, is MIT.

`publish.yml` refuses publish mode until both are true, and
`scripts/release-local.mjs` prints a warning about it on every rehearsal.

## The one-time setup only the owner can do

npm configures a trusted publisher **on a package that already exists**. Both
the [`npm trust` docs](https://docs.npmjs.com/cli/v11/commands/npm-trust)
("Package must exist: The package you're configuring must already exist on the
npm registry") and the [trusted publishing
guide](https://docs.npmjs.com/trusted-publishers) ("Navigate to your package
settings on npmjs.com") say so, and
[npm/cli#8544](https://github.com/npm/cli/issues/8544), "Allow publishing
initial version with OIDC", is still open. PyPI lets you pre-register a
publisher for a name nobody has taken. npm does not.

All three names are brand new. So the first publish of each one cannot use
OIDC, and that is what steps 1 and 2 are for.

### Step 1: bootstrap the three names

From the owner's laptop, with interactive authentication. This writes to the
registry, so it needs the owner's explicit publication approval in its own
right. Do not create a long-lived automation token for it.

```sh
npm install -g npm@latest   # `npm trust` needs 11.15.0 or newer
npm login                   # interactive, 2FA at the prompt
npm whoami                  # confirm the right account

node scripts/publish-placeholders.mjs            # rehearse, publishes nothing
node scripts/publish-placeholders.mjs --publish  # the real one-time run
```

The script publishes a `0.0.0` stub of each name: a `package.json` and a
one-line README saying it is a placeholder. Three details in it matter:

- `--tag bootstrap`, so `latest` is never pointed at a placeholder and
  `npm install yuku-tsrx` cannot resolve one.
- `"provenance": false`, because a laptop cannot produce a provenance
  attestation and `provenance: true` makes the publish fail outright rather
  than skip the attestation.
- any name that already exists is skipped, never republished over.

**The organization has to exist first.** The two binding packages are scoped
`@yuku-tsrx/...`, so an npm organization named exactly `yuku-tsrx` has to own
that scope. Create it at <https://www.npmjs.com/org/create> on the free plan,
which allows unlimited public packages. If the scoped publishes fail with E404
or E402, this is why; create the org and re-run.

### Step 2: configure the trusted publisher on each of the three packages

The script prints these steps when it finishes, so they are here mainly for
reading ahead. Two equivalent ways.

**Option A, the CLI.** npm's docs describe a five minute window after the first
2FA prompt in which further `npm trust` calls do not re-prompt.

```sh
for name in \
  @yuku-tsrx/binding-darwin-arm64 \
  @yuku-tsrx/binding-linux-x64-gnu \
  yuku-tsrx
do
  npm trust github "$name" \
    --repo compiled-run/yuku-tsrx \
    --file publish.yml \
    --allow-publish \
    --yes
  sleep 2
done
npm trust list yuku-tsrx    # confirm it saved
```

`npm trust` needs npm 11.15.0 or newer, account-level 2FA enabled, and write
access to each package. Granular access tokens with the "bypass 2FA" option do
not work for it.

**Option B, the website.** For each of the three packages:

1. Sign in at [npmjs.com](https://www.npmjs.com/).
2. Go to **Packages**, click the package name.
3. Open the **Settings** tab.
4. Find the **Trusted publisher** section.
5. Under **Select your publisher**, click **GitHub Actions**.
6. **Organization or user**: `compiled-run`
7. **Repository**: `yuku-tsrx`
8. **Workflow filename**: `publish.yml` (just the filename with its extension,
   not a path — not `.github/workflows/publish.yml`)
9. **Environment name**: leave empty. `publish.yml` declares no GitHub
   environment. If one is ever added, this field must be filled in to match, or
   publishing breaks.
10. **Allowed actions**: tick **npm publish**.
11. Save.

Every field is case sensitive and npm does not validate them when you save. A
typo shows up only later, as a failed publish with `ENEEDAUTH`.

### Step 3: publish 0.1.0 from CI

See "Running the publish" below.

### Step 4: clean up the placeholders

Only after 0.1.0 is on the registry, so that each package still has a real
version left:

```sh
npm unpublish "<name>@0.0.0"
```

Never unpublish a placeholder while it is the only version of a package.
Removing the last version removes the package, and removing the package removes
its trusted publisher configuration with it.

### Step 5 (optional hardening, later)

Once a trusted publish has actually worked:

- On each package: **Settings → Publishing access → Require two-factor
  authentication and disallow tokens**. Trusted publishing keeps working; only
  token authentication is switched off.
- Consider switching the trusted publisher to stage-only
  (`--allow-stage-publish` without `--allow-publish`). CI then runs
  `npm stage publish` and a human approves each release with 2FA before it
  becomes installable.

## Rehearsing from a laptop

`scripts/release-local.mjs` checks everything the workflow checks, against the
tree `zig build` just wrote, on a machine with no registry credentials. It
cannot publish: there is no publish mode and no code path that runs
`npm publish` without `--dry-run`.

```sh
zig build                          # darwin-arm64 addon + the meta package
zig build -Dtarget=x86_64-linux-gnu  # linux-x64-gnu addon
node scripts/release-local.mjs --strip-linux --dry-run
```

Both builds need a checkout of the Yuku branch from
[yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164) in a
sibling directory named `yuku-minimal-seam`, plus Zig 0.16.

What it asserts, in order: every manifest's version, `publishConfig.access`,
`publishConfig.provenance`, `repository`, and (for bindings) `os`, `cpu` and
`libc`; that every path each manifest declares in its own `files` array is
really in the staged directory; that each addon's magic bytes are the binary
format its `os`/`cpu` claims; and that the meta package's
`optionalDependencies` are exactly the two bindings, each pinned to this exact
version rather than to a range.

`--strip-linux` runs `llvm-objcopy --strip-debug` on the ELF addon. Both
platforms build in Debug — deliberately, and for consistency: the addon 0.1.0
ships is the addon this project has been testing against all along, and
switching one platform to `ReleaseFast` for the release would make the shipped
binary the one nobody ran. But a Debug ELF carries about 58MB of DWARF that no
consumer can use, and npm would ship every byte of it. `--strip-debug` only,
never `--strip-all`: the dynamic symbol table is how Node finds
`napi_register_module_v1`.

Measured on 2026-08-19: the linux addon goes from 70,086,553 to 12,087,440
bytes, and the three tarballs come out at 2.7MB, 2.5MB and 39.5kB packed.

## Running the publish

GitHub → **Actions** → **Publish to npm** → **Run workflow**.

| Input | Rehearsal | Real publish |
| --- | --- | --- |
| `version` | `0.1.0` | `0.1.0` |
| `mode` | `dry-run` | `publish` |
| `confirm` | leave empty | `PUBLISH 0.1.0` |
| `dist_tag` | leave empty | leave empty (means `latest`) |

Run the rehearsal first, and read its log. A dry run exercises every step
except the two that write: it builds both addons from the dispatched revision,
gates the staged manifests, and runs `npm publish --dry-run` on all three
packages.

The confirmation phrase is checked in a separate `gate` job that runs before
the two Zig builds, so a typo costs one cheap job rather than two full builds.

### What the workflow does, and why it is shaped this way

Authentication is npm Trusted Publishing over GitHub Actions OIDC. There is no
`NPM_TOKEN` in the file and none is needed: the npm CLI notices the OIDC
environment that `permissions: id-token: write` creates, exchanges the
short-lived GitHub token for a short-lived registry token, and publishes.
`id-token: write` is granted on the publish job only.

Two deliberate differences from the `oxc-tsrx` workflow this was adapted from:

**No release-candidate artifact.** There, the publish job downloads a
`release-candidate-<sha>` artifact produced by a separate reviewed workflow, and
refuses to publish bytes that came from anywhere else. yuku-tsrx has no
candidate workflow to download from, so the equivalent guarantee is built the
only other honest way: the build jobs compile the addons from the dispatched
revision, on that run, and the publish job consumes nothing but their artifacts.
The property preserved is "the bytes published were built from a named revision
by CI, not uploaded by a human". The mechanism differs because the
infrastructure does.

**Each addon is built on its own native runner.** Zig can cross-compile a darwin
addon from linux, and napi-zig's own release mode does exactly that, but nothing
in this repository has ever proven that path end to end. 0.1.0 ships what is
proven: darwin-arm64 from `macos-14`, linux-x64-gnu from `ubuntu-24.04`.

The gate that runs before either write is `scripts/release-local.mjs` — the same
file a laptop rehearsal runs, so the two cannot drift apart.

After a real publish the workflow installs `yuku-tsrx@<version>` from the
registry into a project outside the workspace, resolves the binding through the
published `optionalDependencies` the way a consumer's first install does, and
parses a real `.tsrx` source through the installed addon. That is a backstop and
only a backstop: npm versions are immutable and unpublish is restricted, so
nothing after the publish step can prevent a bad release. It can only find one,
and the only remedy is deprecate and patch. Prevention lives in the gate.

## Troubleshooting

**`ENEEDAUTH` or `E403` on publish.** Nearly always a trusted publisher
configuration mismatch. Check, in this order: the workflow filename field says
exactly `publish.yml` and not a path; the repository field says
`compiled-run/yuku-tsrx` with that exact case; the environment field is empty;
the package actually exists on the registry (step 1); npm on the runner is
11.5.1 or newer (the workflow asserts this).

**`E404` publishing a scoped binding.** The `yuku-tsrx` organization does not
exist, or the account is not a member of it.

**`E402` publishing a scoped binding.** The scope defaulted to private.
`--access public` and `publishConfig.access: "public"` are both set, so this
should not happen; if it does, check the organization's default visibility.

**"You cannot publish over the previously published versions."** The version is
already on the registry. npm versions are immutable. Pick the next patch.

**The gate fails with "declares X in files but ... does not exist".** The staged
tree is incomplete — usually a build that did not run, or ran for one target
only. Re-run both builds.
