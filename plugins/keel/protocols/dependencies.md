# Protocol: dependencies

Topic of the `env` specialist group. Question: are new or changed packages needed, consistent,
legal to ship and trustworthy?

## Checklist
1. Which manifest entries were added, removed or bumped (name, old and new range, ecosystem)? Runtime,
   dev-only, or a lock-only change?
2. **Manifest and lock agree.** A manifest change without a lock change (or the reverse) breaks locked
   installs: `npm ci`, `uv lock --check`, Composer's stale-lock warning, Gradle and NuGet locked mode.
3. **Lock committed** where the project's convention expects it (applications and deployables; an
   existing lock for the same ecosystem shows the convention).
4. **Pinning style.** The new entry follows the project's existing style; no floating spec (`*`,
   `latest`, a branch, an unpinned git URL) in a project that otherwise pins.
5. **Duplicate.** Does the project already have a library for the same job (second HTTP client, date
   library, JSON or YAML parser), or does the standard library cover it? Cite the existing manifest
   line and a use of it.
6. **License.** The new package's license (from lock metadata, the installed package's manifest,
   `*.dist-info/METADATA`, `Cargo.toml`, a vendored LICENSE) against the project's license and how it
   ships: copyleft (GPL, AGPL, SSPL) or source-available (BUSL, Commons Clause) in permissive or
   proprietary shipped code; missing or `UNLICENSED`. Cannot read it locally → "license unverified".
7. **Known vulnerabilities** for the exact resolved version: only from an installed scanner with a
   local database, an advisory id the repository cites, or a well-known advisory id tied to the
   resolved version. Otherwise "not scanned"; never from memory.
8. **Maintenance and authenticity** from local evidence only: an explicit deprecation in the lock or
   manifest, an archived notice; a name one edit away from a popular package already used in the
   repository (typosquatting); a package name that does not resolve in the lock (possibly hallucinated).
9. **Install-time code**: new `postinstall`/`preinstall` scripts, native binaries, a `setup.py` doing
   network calls.
10. **Transitive weight**: a large new subtree in the lock for a small feature.
11. **Dev vs runtime**: a test or build tool in runtime dependencies, or the reverse.
12. **Source of resolution**: a registry URL, `resolved` field, index URL or `replace` directive now
    pointing to a private, mirror or git source.
13. **Install commands** in Dockerfiles and CI consistent with the lock (`npm ci`, hash-checked pip).

## Evidence
- Lock mismatch: the manifest line, the missing lock entry, the command that will fail.
- License: the project's license and the dependency's license, both cited, plus the incompatibility.
- Duplicate: the existing dependency and an existing use, plus the new use.
- Typosquatting or abandonment: concrete local evidence. "I do not know this package" is not evidence.

## Do not flag
- Routine lock refreshes, unless they move a major version the change relies on.
- A missing lock for libraries where the ecosystem says not to commit one.
- "Old" versions without an advisory id; update bots own staleness.
- Unknown packages without the signals above.
- Range style (`^` vs `~`) that matches the project's convention.
- Vulnerabilities in dev-only tools as production-critical (minor unless the tool handles untrusted
  input in CI); licenses of dev-only tools that are not shipped.

## Severity
- **critical**: a probable typosquatted or non-existent package used by the change; an advisory of
  high or critical severity for the resolved version with a reachable use; a license that makes the
  project's distribution unlawful; a manifest/lock mismatch that breaks CI or deploy installs.
- **important**: a duplicate heavy dependency; a floating spec in a pinned project; new install
  scripts or native binaries; no lock for an application; runtime/dev misplacement; a resolution
  source changed to a non-registry location.
- **minor**: a small helper the standard library covers; a `0.x` version; a single-maintainer package.

## Principles
- A new package must be needed, maintained, licensed for the project and trusted.
- Lock files change with manifests; known vulnerabilities and licenses are checked.
- A name one typo away from a popular package is a red flag.
