'use strict';
// Small sample projects for the scan tests, written to a temporary folder on demand so that
// fake secret files never live in the repository. CANARY marks content that must never be read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANARY = 'KEEL-CANARY-not-a-real-secret-7f3a';

const PROJECTS = {
  'js-monorepo': {
    'package.json': JSON.stringify({ name: 'shop', private: true, scripts: { test: 'pnpm -r test', lint: 'eslint .', typecheck: 'tsc -b', deploy: 'vercel --prod' } }),
    'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'packages/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'vitest run', lint: 'eslint src' } }),
    'packages/api/src/server.ts': 'export const port = 3000;\n',
    'packages/api/src/routes/orders.ts': 'export const orders = [];\n',
    'packages/web/package.json': JSON.stringify({ name: 'web', scripts: { test: 'vitest run' } }),
    'packages/web/src/App.tsx': 'export const App = () => null;\n',
    '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: git config --global user.email ci@shop.test\n      - run: pnpm install --frozen-lockfile\n      - run: |\n          pnpm -r test\n          pnpm lint\n',
    'AGENTS.md': '# Rules\n',
    'docs/adr/0001-monorepo.md': '# Monorepo\n',
    '.env': `STRIPE_KEY=${CANARY}\n`,
    '.env.example': 'STRIPE_KEY=\n',
    'node_modules/left-pad/index.js': 'module.exports = 1;\n',
  },
  python: {
    'pyproject.toml': '[project]\nname = "billing"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n\n[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n',
    'uv.lock': 'version = 1\n',
    '.python-version': '3.12\n',
    'src/billing/__init__.py': '',
    'src/billing/invoice.py': 'def total(items):\n    return sum(items)\n',
    'tests/test_invoice.py': 'def test_total():\n    assert True\n',
    'alembic.ini': '[alembic]\nscript_location = alembic\n',
    'alembic/versions/0001_init.py': 'revision = "0001"\n',
    'Dockerfile': 'FROM python:3.12\n',
    'compose.yaml': 'services: {}\n',
    'openapi.yaml': 'openapi: 3.1.0\n',
    'secrets/prod.pem': CANARY,
  },
  'php-legacy': {
    'index.php': '<?php require "system/startup.php";\n',
    'system/startup.php': '<?php\n',
    'admin/controller/catalog/product.php': '<?php class ControllerCatalogProduct {}\n',
    'catalog/view/theme/default/template/home.twig': '<div></div>\n',
    'system/library/mailer/composer.json': JSON.stringify({ name: 'vendor/mailer' }),
    'system/library/mailer/src/Mailer.php': '<?php class Mailer {}\n',
    'config/credentials.json': `{"db_password": "${CANARY}"}`,
    'bin/cron': '#!/usr/bin/env php\n<?php echo 1;\n',
  },
  csharp: {
    'Shop.sln': 'Microsoft Visual Studio Solution File\n',
    'global.json': '{ "sdk": { "version": "8.0.100" } }\n',
    'src/Shop/Shop.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
    'src/Shop/Program.cs': 'class Program { static void Main() {} }\n',
    'tests/Shop.Tests/Shop.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
    'tests/Shop.Tests/OrderTests.cs': 'public class OrderTests {}\n',
    'src/Shop/Migrations/20260101_Init.cs': 'class Init {}\n',
  },
  cpp: {
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nproject(engine CXX)\nadd_subdirectory(src)\n',
    'CMakePresets.json': '{ "version": 6 }\n',
    'src/CMakeLists.txt': 'add_library(engine engine.cpp)\n',
    'src/engine.cpp': 'int f() { return 1; }\n',
    'src/engine.h': 'int f();\n',
    'tests/CMakeLists.txt': 'add_executable(t t.cpp)\n',
    'tests/t.cpp': 'int main() {}\n',
    '.clang-tidy': 'Checks: "*"\n',
    'server.key': CANARY,
  },
  go: {
    'go.mod': 'module example.com/svc\n\ngo 1.23\n',
    'go.sum': '',
    'main.go': 'package main\nfunc main() {}\n',
    'internal/store/store.go': 'package store\n',
    'internal/store/store_test.go': 'package store\n',
    '.golangci.yml': 'linters: {}\n',
    'Makefile': 'test:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n\ndeploy:\n\tkubectl apply -f k8s/\n',
    'api/service.proto': 'syntax = "proto3";\n',
  },
  rust: {
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n',
    'Cargo.lock': '',
    'rust-toolchain.toml': '[toolchain]\nchannel = "1.82"\n',
    'crates/core/Cargo.toml': '[package]\nname = "core"\n',
    'crates/core/src/lib.rs': 'pub fn f() {}\n',
    'crates/cli/Cargo.toml': '[package]\nname = "cli"\n',
    'crates/cli/src/main.rs': 'fn main() {}\n',
    'id_ed25519': CANARY,
  },
};

function makeProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `keel-${name}-`));
  for (const [rel, content] of Object.entries(PROJECTS[name])) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

module.exports = { makeProject, CANARY, NAMES: Object.keys(PROJECTS) };
