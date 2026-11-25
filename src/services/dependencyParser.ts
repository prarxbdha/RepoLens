/**
 * Conservative, read-only dependency manifest parsers.
 * Manifests are untrusted text: they are never executed or evaluated as code.
 */

export interface DeclaredDependency {
  name: string;
  version: string;
  kind?: string;
}

export type DependencyScope = "production" | "development" | "other";

export interface ParsedManifest {
  path: string;
  ecosystem: string;
  packageManager: string;
  production: DeclaredDependency[];
  development: DeclaredDependency[];
  other: DeclaredDependency[];
}

export interface FrameworkIndicator {
  name: string;
  category: string;
  source: string;
  inferred: true;
}

export const MANIFEST_INFO: Record<string, { ecosystem: string; packageManager: string }> = {
  "package.json": { ecosystem: "JavaScript/TypeScript", packageManager: "npm/yarn/pnpm" },
  "cargo.toml": { ecosystem: "Rust", packageManager: "Cargo" },
  "requirements.txt": { ecosystem: "Python", packageManager: "pip" },
  "pyproject.toml": { ecosystem: "Python", packageManager: "pip/Poetry/uv" },
  "pom.xml": { ecosystem: "Java", packageManager: "Maven" },
  "build.gradle": { ecosystem: "Java/Kotlin/Groovy", packageManager: "Gradle" },
  "build.gradle.kts": { ecosystem: "Java/Kotlin/Groovy", packageManager: "Gradle" },
  "go.mod": { ecosystem: "Go", packageManager: "Go modules" },
  "composer.json": { ecosystem: "PHP", packageManager: "Composer" },
};

const FRAMEWORK_CATEGORIES: Record<string, string> = {
  react: "frontend framework",
  next: "frontend framework",
  vue: "frontend framework",
  nuxt: "frontend framework",
  angular: "frontend framework",
  svelte: "frontend framework",
  "@sveltejs/kit": "frontend framework",
  "@nestjs/core": "backend framework",
  express: "backend framework",
  fastify: "backend framework",
  django: "backend framework",
  flask: "backend framework",
  fastapi: "backend framework",
  gin: "backend framework",
  rails: "backend framework",
  spring: "backend framework",
  laravel: "backend framework",
  tailwindcss: "styling",
  bootstrap: "styling",
  jest: "test framework",
  vitest: "test framework",
  mocha: "test framework",
  pytest: "test framework",
  junit: "test framework",
  typescript: "language tooling",
  eslint: "static analysis",
  prettier: "formatting",
};

function dependency(name: string, version: unknown, kind?: string): DeclaredDependency {
  const cleanName = name.trim();
  const cleanVersion = typeof version === "string" && version.trim() !== "" ? version.trim() : "*";
  return kind === undefined ? { name: cleanName, version: cleanVersion } : { name: cleanName, version: cleanVersion, kind };
}

function jsonDependencies(value: unknown): DeclaredDependency[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([name]) => name.trim() !== "")
    .map(([name, version]) => dependency(name, version));
}

function parseJsonManifest(path: string, content: string): ParsedManifest {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("manifest root is not a JSON object");
  }
  const data = parsed as Record<string, unknown>;
  const isComposer = path.toLowerCase().endsWith("composer.json");
  const prod = jsonDependencies(data.dependencies);
  const dev = jsonDependencies(isComposer ? data["require-dev"] : data.devDependencies);
  const other = [
    ...jsonDependencies(data.optionalDependencies).map((item) => ({ ...item, kind: "optional" })),
    ...jsonDependencies(data.peerDependencies).map((item) => ({ ...item, kind: "peer" })),
  ];
  const info = MANIFEST_INFO[path.toLowerCase().split("/").pop() ?? ""] ?? MANIFEST_INFO["package.json"]!;
  return { path, ...info, production: prod, development: dev, other };
}

function parseRequirements(path: string, content: string): ParsedManifest {
  const production: DeclaredDependency[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (line === "" || line.startsWith("-") || /^(https?:|git\+)/i.test(line)) continue;
    const match = /^([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)\s*(.*)$/.exec(line);
    if (match === null) continue;
    production.push(dependency(match[1]!, match[2] || "*"));
  }
  return { path, ...MANIFEST_INFO["requirements.txt"]!, production, development: [], other: [] };
}

interface TomlSection {
  name: string;
  lines: string[];
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function tomlSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      current = header[1]!.trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current === "") current = "root";
    const bucket = sections.get(current) ?? [];
    bucket.push(line);
    sections.set(current, bucket);
  }
  return sections;
}

function tomValueToVersion(value: string): string {
  const trimmed = value.trim();
  const inlineVersion = /\bversion\s*=\s*["']([^"']+)["']/.exec(trimmed);
  if (inlineVersion !== null) return inlineVersion[1]!;
  const quoted = /^["']([^"']+)["']/.exec(trimmed);
  return quoted === null ? "*" : quoted[1]!;
}

function tomlArrayStrings(lines: string[], key: string): string[] {
  const joined = lines.join("\n");
  const pattern = new RegExp(`(?:^|\\n)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "i");
  const match = pattern.exec(joined);
  if (match === null) return [];
  const items: string[] = [];
  for (const item of match[1]!.split(/,(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/)) {
    const version = tomValueToVersion(item.trim());
    if (version !== "*" || item.trim() !== "") items.push(version);
  }
  return items;
}

function tomlAssignments(lines: string[]): DeclaredDependency[] {
  const result: DeclaredDependency[] = [];
  for (const line of lines) {
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (match === null) continue;
    const name = match[1]!;
    if (name === "python" || name === "python-version" || name === "requires-python") continue;
    result.push(dependency(name, tomValueToVersion(match[2]!)));
  }
  return result;
}

const DEV_GROUP_NAMES = new Set(["dev", "develop", "development", "test", "testing"]);

function parsePyproject(path: string, content: string): ParsedManifest {
  const sections = tomlSections(content);
  const production: DeclaredDependency[] = [];
  const development: DeclaredDependency[] = [];
  const other: DeclaredDependency[] = [];

  for (const item of tomlArrayStrings(sections.get("project") ?? [], "dependencies")) {
    const match = /^([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)\s*(.*)$/.exec(item);
    if (match !== null) production.push(dependency(match[1]!, match[2] || "*"));
  }
  for (const [sectionName, lines] of sections) {
    if (sectionName === "project.optional-dependencies" || sectionName === "dependency-groups") {
      for (const line of lines) {
        const match = /^([A-Za-z0-9_.-]+)\s*=\s*\[/.exec(line);
        if (match === null) continue;
        const values = tomlArrayStrings(lines, match[1]!);
        const target = DEV_GROUP_NAMES.has(match[1]!.toLowerCase()) ? development : other;
        for (const value of values) {
          const dep = /^([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)\s*(.*)$/.exec(value);
          if (dep !== null) target.push(dependency(dep[1]!, dep[2] || "*", sectionName === "dependency-groups" ? "group" : "extra"));
        }
      }
    } else if (sectionName === "tool.poetry.dependencies") {
      production.push(...tomlAssignments(lines));
    } else if (
      sectionName === "tool.poetry.dev-dependencies" ||
      /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(sectionName)
    ) {
      development.push(...tomlAssignments(lines));
    }
  }
  return { path, ...MANIFEST_INFO["pyproject.toml"]!, production, development, other };
}

function parseCargo(path: string, content: string): ParsedManifest {
  const sections = tomlSections(content);
  const production: DeclaredDependency[] = [];
  const development: DeclaredDependency[] = [];
  const other: DeclaredDependency[] = [];
  for (const [sectionName, lines] of sections) {
    const target = sectionName === "dev-dependencies" || sectionName.endsWith(".dev-dependencies")
      ? development
      : sectionName === "build-dependencies" || sectionName.endsWith(".build-dependencies")
        ? other
        : sectionName === "dependencies" ||
            sectionName.startsWith("target.") ||
            sectionName === "workspace.dependencies"
          ? production
          : null;
    if (target !== null) {
      for (const item of tomlAssignments(lines)) {
        target.push(sectionName === "workspace.dependencies" ? { ...item, kind: "workspace" } : item);
      }
    }
  }
  return { path, ...MANIFEST_INFO["cargo.toml"]!, production, development, other };
}

function parsePom(path: string, content: string): ParsedManifest {
  const production: DeclaredDependency[] = [];
  const development: DeclaredDependency[] = [];
  const other: DeclaredDependency[] = [];
  for (const match of content.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
    const block = match[1] ?? "";
    const value = (tag: string): string => {
      const found = new RegExp(`<${tag}\\s*>[\\s\\S]*?<\\/${tag}\\s*>`, "i").exec(block);
      return found === null ? "" : found[0].replace(/<\/?[^>]+>/g, "").trim();
    };
    const group = value("groupId");
    const artifact = value("artifactId");
    if (artifact === "") continue;
    const name = group === "" ? artifact : `${group}:${artifact}`;
    const scope = value("scope").toLowerCase();
    const dep = dependency(name, value("version") || "*", scope === "" ? undefined : scope);
    if (scope === "test" || scope === "provided") development.push(dep);
    else if (scope === "import" || scope === "system") other.push(dep);
    else production.push(dep);
  }
  return { path, ...MANIFEST_INFO["pom.xml"]!, production, development, other };
}

function parseGradle(path: string, content: string): ParsedManifest {
  const production: DeclaredDependency[] = [];
  const development: DeclaredDependency[] = [];
  const other: DeclaredDependency[] = [];
  const configurationPattern =
    /\b(implementation|api|compile|runtimeOnly|runtime|compileOnly|testImplementation|testCompile|testRuntimeOnly|androidTestImplementation|annotationProcessor|kapt|ksp)\s*\(?\s*["']([^"']+)["']/gi;
  for (const match of content.matchAll(configurationPattern)) {
    const configuration = (match[1] ?? "").toLowerCase();
    const coordinates = (match[2] ?? "").split(":");
    if (coordinates.length < 2) continue;
    const name = `${coordinates[0]}:${coordinates[1]}`;
    const dep = dependency(name, coordinates[2] ?? "*", configuration);
    if (configuration.startsWith("test") || configuration.startsWith("androidtest")) {
      development.push(dep);
    } else if (
      configuration === "compileonly" ||
      configuration === "annotationprocessor" ||
      configuration === "kapt" ||
      configuration === "ksp"
    ) {
      other.push(dep);
    } else {
      production.push(dep);
    }
  }
  const info = MANIFEST_INFO[path.toLowerCase().split("/").pop() ?? ""] ?? MANIFEST_INFO["build.gradle"]!;
  return { path, ...info, production, development, other };
}

function parseGoMod(path: string, content: string): ParsedManifest {
  const production: DeclaredDependency[] = [];
  let inRequire = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("require (")) {
      inRequire = true;
      continue;
    }
    if (inRequire && line === ")") {
      inRequire = false;
      continue;
    }
    if (inRequire || line.startsWith("require ")) {
      const parts = line.replace(/^require\s+/, "").split(/\s+/);
      if (parts.length < 2 || parts[0] === undefined) continue;
      const indirect = line.includes("// indirect");
      production.push(dependency(parts[0]!, parts[1]!, indirect ? "indirect" : undefined));
    }
  }
  return { path, ...MANIFEST_INFO["go.mod"]!, production, development: [], other: [] };
}

/** Parses one manifest. Unknown file names are rejected; content is never executed. */
export function parseManifest(path: string, content: string): ParsedManifest {
  const name = path.toLowerCase().split("/").pop() ?? "";
  if (name === "package.json" || name === "composer.json") return parseJsonManifest(path, content);
  if (name === "requirements.txt") return parseRequirements(path, content);
  if (name === "pyproject.toml") return parsePyproject(path, content);
  if (name === "cargo.toml") return parseCargo(path, content);
  if (name === "pom.xml") return parsePom(path, content);
  if (name === "build.gradle" || name === "build.gradle.kts") return parseGradle(path, content);
  if (name === "go.mod") return parseGoMod(path, content);
  throw new Error(`Unsupported manifest: ${path}`);
}

export function frameworkIndicators(
  manifests: readonly ParsedManifest[],
  limit = 40,
): FrameworkIndicator[] {
  const seen = new Set<string>();
  const result: FrameworkIndicator[] = [];
  for (const manifest of manifests) {
    const deps = [...manifest.production, ...manifest.development, ...manifest.other];
    for (const dep of deps) {
      const key = dep.name.toLowerCase().replace(/\[.*$/, "");
      const category = FRAMEWORK_CATEGORIES[key];
      if (category === undefined) continue;
      const dedupe = `${category}:${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      result.push({ name: key, category, source: manifest.path, inferred: true });
      if (result.length >= limit) return result;
    }
  }
  return result;
}
