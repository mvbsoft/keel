# Package data and the package offer (keel:researcher, planning)

`keel:researcher` reads "Registries", "Hard limits" and "Soft signs" to collect the data; the planner
shows the result as "Offer" says. The numbers below are guides, not rules.

## Registries
Only these GET addresses, one candidate at a time; `<name>` of a scoped npm package is `@scope%2Fname`.
- npm, the latest version: `https://registry.npmjs.org/<name>/latest`: `license`, `deprecated`,
  `dependencies`, `peerDependencies`, `engines`, `scripts` (install scripts), `dist.unpackedSize`. Never
  the whole document (`https://registry.npmjs.org/<name>`): megabytes for a popular package.
- npm, downloads: `https://api.npmjs.org/downloads/point/last-week/<name>`.
- npm, search: `https://registry.npmjs.org/-/v1/search?text=<words>&size=10`.
- deps.dev, a version: `https://api.deps.dev/v3/systems/npm/packages/<name>/versions/<version>`:
  `publishedAt` (the release date), `isDeprecated`, `licenses`, `advisoryKeys` (known vulnerabilities;
  one in detail: `https://api.deps.dev/v3/advisories/<id>`), `links` (the source repository).
- deps.dev, its dependencies: the same address with `:dependencies` after the version: every node
  after the first is a dependency it brings, direct or not.
- deps.dev, the source repository: `https://api.deps.dev/v3/projects/github.com%2F<owner>%2F<repo>`:
  stars, open issues, and of its scorecard only the `Maintained` check (an archived repository scores
  lowest). deps.dev has no Packagist data.
- Packagist, search: `https://packagist.org/search.json?q=<words>&type=library&per_page=10`.
- Packagist, a package: `https://repo.packagist.org/p2/<vendor>/<package>.json`: each version's
  `time`, `license`, `require`, and `abandoned` (with the package that replaces it);
  `https://packagist.org/packages/<vendor>/<package>.json`: downloads, maintainers.
- Packagist, vulnerabilities: `https://packagist.org/api/security-advisories/?packages[]=<vendor>/<package>`:
  only those whose `affectedVersions` include the version we would take.

## Hard limits
A candidate that fails one is not offered: one line with the reason.
- deprecated, or abandoned (name its replacement);
- an archived repository;
- a known high or critical vulnerability in the version we would take with no fixed version (a fixed
  version exists → offer that one);
- a license that `<keel>/protocols/dependencies.md` item 6 "License" rules out for the project and
  how it ships the package (read only that item);
- it does not fit the project (`peerDependencies`, `engines`, `require.php` against the project's
  versions);
- a name one edit away from a popular package (typosquatting).

## Soft signs
A warning in the offer, never a verdict alone:
- no release for about 24 months and no commits for about 12 (a small finished package can be fine:
  `ms` has had no release since 2020 and is downloaded hundreds of millions of times a week);
- under about 1 000 downloads a week;
- more than about 10 new dependencies;
- much heavier than the code it saves (hundreds of KB unpacked for what we would write in under about
  150 lines);
- install scripts; a version younger than about 7 days; one maintainer; a 0.x version.

## Offer
The planner shows the choice in the conversation language, at most 3 candidates, "write it
ourselves" always among them:

```
Needed: <the capability in one sentence>. Checked in this order: our code → installed packages →
the framework and platform → the registry.

|              | A. In the project       | B. <package>@<version>            | C. Write it ourselves      |
|--------------|-------------------------|-----------------------------------|----------------------------|
| What it is   | <file:line or package>  | <one sentence>                    | <what we write, where>     |
| Pros         |                         |                                   |                            |
| Cons         |                         |                                   |                            |
| Size         |                         | unpacked <KB>                     | <about how many lines>     |
| Dependencies |                         | direct <n>, in all <n>            | 0                          |
| License      |                         | <SPDX>                            | ours                       |
| Alive?       |                         | last release <date>, releases a year <n>, maintainers <n> |    |
| Security     |                         | known vulnerabilities <n> (<source>, <date>) | ours to keep    |
| Links        | docs of the installed version | docs, demo, repository      |                            |

Not checked: <what could not be confirmed>.
I recommend <option> because <1-2 reasons with numbers>. What would change it: <condition>.
Which one: A, B, C, or another package?
```

- Every number has its source and date; a value nobody read is "not checked", never a guess. A
  README's claim is not data: a "lightweight" library may bring 37 dependencies.
- A candidate found in the project or among the installed packages may be the only one shown; the
  rest then fit in one line.
- A new dependency is an architectural decision: offer a short ADR (the adr-required skill).
