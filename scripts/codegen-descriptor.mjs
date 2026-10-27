#!/usr/bin/env node
/**
 * Generate TypeScript, C#, and Python from ohho.descriptor.v1 JSON Schemas.
 *
 *   node scripts/codegen-descriptor.mjs          # write
 *   node scripts/codegen-descriptor.mjs --check  # exit 1 if stale
 *
 * Outputs are LF. C# lives in namespace Ohho.Schemas and reuses OhhoJson /
 * OhhoValidate from the telemetry generator (netstandard2.1, Newtonsoft.Json).
 * Python is pydantic v2.
 *
 * Hard-cap maximums are the OmniBot ceilings. This script refuses to emit a
 * schema that raises them.
 */

import { compileFromFile } from "json-schema-to-typescript";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "packages/schemas/ohho.descriptor.v1");
const TS_FILE = path.join(ROOT, "packages/schemas/src/generated/descriptor.generated.ts");
const TS_VERSION_FILE = path.join(
  ROOT,
  "packages/schemas/src/generated/descriptor-version.generated.ts",
);
const CS_FILE = path.join(ROOT, "generated/csharp/Ohho.Schemas/DescriptorV1.generated.cs");
const PY_FILE = path.join(ROOT, "generated/python/ohho_schemas/descriptor_v1.py");

const check = process.argv.includes("--check");

/** OmniBot ceilings. Do not raise these. */
const HARD_CEILINGS = {
  max_vx_mps: 0.2,
  max_vy_mps: 0.2,
  max_wz_rad_s: 1,
  max_accel_x_mps2: 0.5,
  max_accel_y_mps2: 0.5,
  max_accel_wz_rad_s2: 2,
  max_joint_step_rad: 0.15,
};

const DRIVE_CEILINGS = {
  vx_mps: 0.2,
  vy_mps: 0.2,
  wz_rad_s: 1,
};

function lf(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  if (text.includes("\r")) {
    throw new Error(`${path.relative(ROOT, filePath)} must use LF line endings`);
  }
  return JSON.parse(text);
}

function assertCeilings(defs) {
  const hard = defs.$defs.HardSafetyCaps.properties;
  for (const [key, ceiling] of Object.entries(HARD_CEILINGS)) {
    if (hard[key].maximum !== ceiling) {
      throw new Error(`HardSafetyCaps.${key} maximum must stay ${ceiling}`);
    }
  }
  const drive = defs.$defs.DriveCaps.properties;
  for (const [key, ceiling] of Object.entries(DRIVE_CEILINGS)) {
    if (drive[key].maximum !== ceiling) {
      throw new Error(`DriveCaps.${key} maximum must stay ${ceiling}`);
    }
  }
}

function decodePointer(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveRef(docs, fromFile, ref) {
  const hash = ref.indexOf("#");
  const filePart = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? "" : ref.slice(hash + 1);
  const fileName = filePart === "" ? fromFile : filePart;
  const doc = docs.get(fileName);
  if (!doc) {
    throw new Error(`unresolved schema file "${fileName}" in ${ref}`);
  }
  if (pointer === "") {
    return { fileName, node: doc };
  }
  let node = doc;
  for (const raw of pointer.split("/").slice(1)) {
    const key = decodePointer(raw);
    if (node == null || !Object.prototype.hasOwnProperty.call(node, key)) {
      throw new Error(`missing JSON pointer ${ref}`);
    }
    node = node[key];
  }
  return { fileName, node };
}

function classify(node) {
  if (Array.isArray(node.enum)) {
    return "enum";
  }
  if (node.type === "object" || node.properties) {
    return "object";
  }
  if (node.type === "array") {
    return "array";
  }
  if (
    node.type === "string" ||
    node.type === "number" ||
    node.type === "integer" ||
    node.type === "boolean"
  ) {
    return "primitive";
  }
  throw new Error(`unsupported schema node: ${JSON.stringify(node).slice(0, 180)}`);
}

function primitiveType(node) {
  if (node.type === "string") {
    return {
      kind: "string",
      description: node.description || "",
      minLength: node.minLength,
      maxLength: node.maxLength,
      pattern: node.pattern,
    };
  }
  if (node.type === "number" || node.type === "integer") {
    return {
      kind: node.type,
      description: node.description || "",
      minimum: node.minimum,
      maximum: node.maximum,
      exclusiveMinimum: node.exclusiveMinimum,
      exclusiveMaximum: node.exclusiveMaximum,
    };
  }
  return { kind: "boolean", description: node.description || "" };
}

function fieldType(docs, fromFile, schema) {
  if (schema.$ref) {
    const resolved = resolveRef(docs, fromFile, schema.$ref);
    const kind = classify(resolved.node);
    if (kind === "enum" || kind === "object") {
      if (!resolved.node.title) {
        throw new Error(`named type missing title: ${schema.$ref}`);
      }
      return { kind: "ref", name: resolved.node.title, refKind: kind };
    }
    if (kind === "primitive") {
      return primitiveType(resolved.node);
    }
    throw new Error(`$ref is not a named type: ${schema.$ref}`);
  }
  const kind = classify(schema);
  if (kind === "primitive") {
    return primitiveType(schema);
  }
  if (kind === "array") {
    if (!schema.items || Array.isArray(schema.items)) {
      throw new Error("array items must be a single schema");
    }
    return {
      kind: "array",
      items: fieldType(docs, fromFile, schema.items),
      minItems: schema.minItems,
      maxItems: schema.maxItems,
    };
  }
  throw new Error("inline objects and enums must be a $ref so names stay stable");
}

function buildObject(docs, fromFile, node) {
  if (node.additionalProperties !== false) {
    throw new Error(`${node.title || fromFile} must set additionalProperties false`);
  }
  if (!node.title) {
    throw new Error(`object schema in ${fromFile} is missing a title`);
  }
  const required = new Set(node.required || []);
  const fields = [];
  for (const [wire, propSchema] of Object.entries(node.properties || {})) {
    const type = fieldType(docs, fromFile, propSchema);
    let description = propSchema.description || "";
    if (!description && propSchema.$ref) {
      description = resolveRef(docs, fromFile, propSchema.$ref).node.description || "";
    }
    if (!description && type.description) {
      description = type.description;
    }
    if (!required.has(wire) && type.kind !== "ref" && type.kind !== "array") {
      throw new Error(`optional primitive "${wire}" on ${node.title} is not supported`);
    }
    fields.push({
      wire,
      required: required.has(wire),
      description,
      type,
    });
  }
  for (const name of required) {
    if (!fields.some((field) => field.wire === name)) {
      throw new Error(`${node.title} requires missing property ${name}`);
    }
  }
  return {
    kind: "object",
    name: node.title,
    description: node.description || "",
    fields,
  };
}

function buildModel(docs, manifest) {
  const defs = docs.get("defs.json").$defs;
  const types = new Map();
  for (const node of Object.values(defs)) {
    const kind = classify(node);
    if (kind === "primitive" || kind === "array") {
      continue;
    }
    if (kind === "enum") {
      if (!node.title) {
        throw new Error("enum is missing a title");
      }
      if (node.type !== "string") {
        throw new Error(`${node.title} enum must be a string`);
      }
      types.set(node.title, {
        kind: "enum",
        name: node.title,
        description: node.description || "",
        values: node.enum.slice(),
      });
      continue;
    }
    types.set(node.title, buildObject(docs, "defs.json", node));
  }
  for (const fileName of manifest.messages) {
    const node = docs.get(fileName);
    const built = buildObject(docs, fileName, node);
    if (types.has(built.name)) {
      throw new Error(`duplicate type name ${built.name}`);
    }
    types.set(built.name, built);
  }
  for (const type of types.values()) {
    if (type.kind !== "object") {
      continue;
    }
    for (const field of type.fields) {
      const item = field.type.kind === "array" ? field.type.items : field.type;
      if (item.kind === "ref" && !types.has(item.name)) {
        throw new Error(`${type.name}.${field.wire} references unknown ${item.name}`);
      }
    }
  }
  return types;
}

function depsOf(type) {
  if (type.kind !== "object") {
    return [];
  }
  const deps = [];
  for (const field of type.fields) {
    if (field.type.kind === "ref") {
      deps.push(field.type.name);
    } else if (field.type.kind === "array" && field.type.items.kind === "ref") {
      deps.push(field.type.items.name);
    }
  }
  return deps;
}

function topo(types) {
  const visiting = new Set();
  const visited = new Set();
  const out = [];
  function visit(name) {
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`type cycle at ${name}`);
    }
    visiting.add(name);
    for (const dep of depsOf(types.get(name))) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    out.push(types.get(name));
  }
  for (const name of [...types.keys()].sort()) {
    visit(name);
  }
  return out;
}

function pascal(wire) {
  const name = wire
    .split("_")
    .map((part) => (part.length === 0 ? "" : part[0].toUpperCase() + part.slice(1)))
    .join("");
  if (!/^[A-Za-z]/.test(name)) {
    throw new Error(`cannot make a C# name from ${wire}`);
  }
  return name;
}

function enumMember(value) {
  const name = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  if (!name) {
    throw new Error(`cannot make an enum member from ${value}`);
  }
  return name;
}

function pyEnumMember(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function csharpString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function csharpVerbatim(value) {
  return `@"${value.replace(/"/g, '""')}"`;
}

function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function csharpDoc(description, indent) {
  if (!description) {
    return [];
  }
  return [`${indent}/// <summary>${xmlEscape(description)}</summary>`];
}

function formatDouble(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite number ${value}`);
  }
  return Number.isInteger(value) ? `${value}d` : `${value}d`;
}

function csharpFieldType(type) {
  if (type.kind === "string") return "string";
  if (type.kind === "number") return "double";
  if (type.kind === "integer") return "long";
  if (type.kind === "boolean") return "bool";
  if (type.kind === "ref") return type.name;
  if (type.kind === "array") return `${csharpFieldType(type.items)}[]`;
  throw new Error(`unknown field type ${type.kind}`);
}

function csharpBound(type) {
  const min = type.minimum == null ? "null" : formatDouble(type.minimum);
  const max = type.maximum == null ? "null" : formatDouble(type.maximum);
  return { min, max };
}

function csharpNumberTail(wire, prop, type, indent) {
  const lines = [];
  if (type.exclusiveMinimum != null) {
    lines.push(
      `if (${prop} <= ${formatDouble(type.exclusiveMinimum)})`,
      `{`,
      `    throw new InvalidOperationException(${csharpString(`${wire} must be greater than the exclusive minimum`)});`,
      `}`,
    );
  }
  if (type.exclusiveMaximum != null) {
    lines.push(
      `if (${prop} >= ${formatDouble(type.exclusiveMaximum)})`,
      `{`,
      `    throw new InvalidOperationException(${csharpString(`${wire} must be less than the exclusive maximum`)});`,
      `}`,
    );
  }
  return lines.map((line) => (indent ? `${indent}${line}` : line));
}

function csharpArrayBody(field) {
  const prop = pascal(field.wire);
  const type = field.type;
  const lines = [];
  if (type.minItems != null) {
    lines.push(
      `if (${prop}.Length < ${type.minItems})`,
      `{`,
      `    throw new InvalidOperationException(${csharpString(`${field.wire} is too short`)});`,
      `}`,
    );
  }
  if (type.maxItems != null) {
    lines.push(
      `if (${prop}.Length > ${type.maxItems})`,
      `{`,
      `    throw new InvalidOperationException(${csharpString(`${field.wire} is too long`)});`,
      `}`,
    );
  }
  const items = type.items;
  if (items.kind === "ref" && items.refKind === "object") {
    lines.push(
      `for (int i = 0; i < ${prop}.Length; i++)`,
      `{`,
      `    if (${prop}[i] == null)`,
      `    {`,
      `        throw new InvalidOperationException(${csharpString(`${field.wire} contains null`)});`,
      `    }`,
      `    ${prop}[i].Validate();`,
      `}`,
    );
    return lines;
  }
  if (items.kind === "ref" && items.refKind === "enum") {
    return lines;
  }
  if (items.kind === "string") {
    const min = items.minLength == null ? "null" : String(items.minLength);
    const max = items.maxLength == null ? "null" : String(items.maxLength);
    const pattern = items.pattern == null ? "null" : csharpVerbatim(items.pattern);
    lines.push(
      `for (int i = 0; i < ${prop}.Length; i++)`,
      `{`,
      `    OhhoValidate.Text(${csharpString(field.wire)}, ${prop}[i], true, ${min}, ${max}, ${pattern});`,
      `}`,
    );
    return lines;
  }
  if (items.kind === "number") {
    const { min, max } = csharpBound(items);
    lines.push(
      `for (int i = 0; i < ${prop}.Length; i++)`,
      `{`,
      `    OhhoValidate.Finite(${csharpString(field.wire)}, ${prop}[i], ${min}, ${max});`,
    );
    for (const extra of csharpNumberTail(field.wire, `${prop}[i]`, items, "    ")) {
      lines.push(extra);
    }
    lines.push(`}`);
    return lines;
  }
  throw new Error(`unsupported array ${field.wire}`);
}

function csharpValidateLines(field) {
  const prop = pascal(field.wire);
  const type = field.type;
  if (type.kind === "ref") {
    if (type.refKind === "enum") {
      return [];
    }
    if (field.required) {
      return [
        `if (${prop} == null)`,
        `{`,
        `    throw new InvalidOperationException(${csharpString(`${field.wire} is required`)});`,
        `}`,
        `${prop}.Validate();`,
      ];
    }
    return [`if (${prop} != null)`, `{`, `    ${prop}.Validate();`, `}`];
  }
  if (type.kind === "array") {
    const body = csharpArrayBody(field);
    if (field.required) {
      return [
        `if (${prop} == null)`,
        `{`,
        `    throw new InvalidOperationException(${csharpString(`${field.wire} is required`)});`,
        `}`,
        ...body,
      ];
    }
    return [`if (${prop} != null)`, `{`, ...body.map((line) => `    ${line}`), `}`];
  }
  if (type.kind === "string") {
    const min = type.minLength == null ? "null" : String(type.minLength);
    const max = type.maxLength == null ? "null" : String(type.maxLength);
    const pattern = type.pattern == null ? "null" : csharpVerbatim(type.pattern);
    return [
      `OhhoValidate.Text(${csharpString(field.wire)}, ${prop}, ${field.required ? "true" : "false"}, ${min}, ${max}, ${pattern});`,
    ];
  }
  if (type.kind === "number") {
    const { min, max } = csharpBound(type);
    return [
      `OhhoValidate.Finite(${csharpString(field.wire)}, ${prop}, ${min}, ${max});`,
      ...csharpNumberTail(field.wire, prop, type, ""),
    ];
  }
  if (type.kind === "integer") {
    const min = type.minimum == null ? "null" : `${type.minimum}L`;
    const max = type.maximum == null ? "null" : `${type.maximum}L`;
    return [`OhhoValidate.Whole(${csharpString(field.wire)}, ${prop}, ${min}, ${max});`];
  }
  return [];
}

function emitCSharp(manifest, ordered) {
  const lines = [
    "// <auto-generated/>",
    "// Generated by scripts/codegen-descriptor.mjs — do not edit.",
    `// Schema ${manifest.id} version ${manifest.version}.`,
    "// Newtonsoft.Json, namespace Ohho.Schemas, netstandard2.1.",
    "// Uses OhhoJson and OhhoValidate from the telemetry schema file.",
    "// Hard-cap maximums are the OmniBot ceilings and must not be raised.",
    "",
    "using System;",
    "using Newtonsoft.Json;",
    "using Newtonsoft.Json.Converters;",
    "using System.Runtime.Serialization;",
    "",
    "namespace Ohho.Schemas",
    "{",
  ];

  for (const type of ordered) {
    if (type.kind === "enum") {
      lines.push(...csharpDoc(type.description, "    "));
      lines.push("    [JsonConverter(typeof(OhhoStringEnumConverter))]");
      lines.push(`    public enum ${type.name}`);
      lines.push("    {");
      type.values.forEach((value, index) => {
        lines.push(`        [EnumMember(Value = ${csharpString(value)})]`);
        lines.push(`        ${enumMember(value)} = ${index},`);
        lines.push("");
      });
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }
      lines.push("    }");
      lines.push("");
      continue;
    }

    lines.push(...csharpDoc(type.description, "    "));
    lines.push("    [JsonObject(MemberSerialization = MemberSerialization.OptIn)]");
    lines.push(`    public sealed class ${type.name}`);
    lines.push("    {");
    for (const field of type.fields) {
      const prop = pascal(field.wire);
      const csharpType = csharpFieldType(field.type);
      const required = field.required ? "Required.Always" : "Required.DisallowNull";
      lines.push(...csharpDoc(field.description, "        "));
      lines.push(`        [JsonProperty(${csharpString(field.wire)}, Required = ${required})]`);
      lines.push(`        public ${csharpType} ${prop} { get; set; }`);
      lines.push("");
    }
    lines.push("        /// <summary>Throws when this object does not satisfy the schema constraints.</summary>");
    lines.push("        public void Validate()");
    lines.push("        {");
    for (const field of type.fields) {
      for (const line of csharpValidateLines(field)) {
        lines.push(`            ${line}`);
      }
    }
    lines.push("        }");
    lines.push("");
    lines.push("        /// <summary>Deserialize and validate. Unknown fields and explicit nulls are errors.</summary>");
    lines.push(`        public static ${type.name} Parse(string json)`);
    lines.push("        {");
    lines.push("            if (json == null)");
    lines.push("            {");
    lines.push("                throw new ArgumentNullException(nameof(json));");
    lines.push("            }");
    lines.push(
      `            ${type.name} value = JsonConvert.DeserializeObject<${type.name}>(json, OhhoJson.Settings);`,
    );
    lines.push("            if (value == null)");
    lines.push("            {");
    lines.push(
      `                throw new JsonSerializationException(${csharpString(`${type.name} JSON was null.`)});`,
    );
    lines.push("            }");
    lines.push("            value.Validate();");
    lines.push("            return value;");
    lines.push("        }");
    lines.push("    }");
    lines.push("");
  }

  lines.push("}");
  return lf(lines.join("\n"));
}

function pyString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function pyPattern(value) {
  if (value.includes('"') || value.includes("\n") || value.endsWith("\\")) {
    throw new Error(`pattern cannot be embedded as a Python raw string: ${value}`);
  }
  return `r"${value}"`;
}

function stripForTypeScript(value) {
  if (Array.isArray(value)) {
    return value.map(stripForTypeScript);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "allOf" || key.startsWith("x-")) {
        continue;
      }
      out[key] = stripForTypeScript(child);
    }
    return out;
  }
  return value;
}

function pyInner(type) {
  if (type.kind === "string") return "str";
  if (type.kind === "number") return "float";
  if (type.kind === "integer") return "int";
  if (type.kind === "boolean") return "bool";
  if (type.kind === "ref") return type.name;
  if (type.kind === "array") return `list[${pyInner(type.items)}]`;
  throw new Error(`unknown field type ${type.kind}`);
}

function pyField(field) {
  const type = field.type;
  const inner = pyInner(type);
  const annotation = field.required ? inner : `Optional[${inner}]`;
  const args = [];
  if (!field.required) {
    args.push("default=None");
  }
  if (type.kind === "boolean" || type.kind === "integer") {
    args.push("strict=True");
  }
  if (type.kind === "string" || type.kind === "number" || type.kind === "integer") {
    if (type.minimum != null) args.push(`ge=${type.minimum}`);
    if (type.maximum != null) args.push(`le=${type.maximum}`);
    if (type.exclusiveMinimum != null) args.push(`gt=${type.exclusiveMinimum}`);
    if (type.exclusiveMaximum != null) args.push(`lt=${type.exclusiveMaximum}`);
  }
  if (type.kind === "string") {
    if (type.minLength != null) args.push(`min_length=${type.minLength}`);
    if (type.maxLength != null) args.push(`max_length=${type.maxLength}`);
    if (type.pattern != null) args.push(`pattern=${pyPattern(type.pattern)}`);
  }
  if (type.kind === "array") {
    if (type.minItems != null) args.push(`min_length=${type.minItems}`);
    if (type.maxItems != null) args.push(`max_length=${type.maxItems}`);
  }
  if (field.description) {
    args.push(`description=${pyString(field.description)}`);
  }
  const value = args.length === 0 ? "" : ` = Field(${args.join(", ")})`;
  return `    ${field.wire}: ${annotation}${value}`;
}

function emitPython(manifest, ordered) {
  const lines = [
    '"""Generated OhhO robot descriptor models. Do not edit.',
    "",
    "Generated by scripts/codegen-descriptor.mjs.",
    `Schema ${manifest.id} version ${manifest.version}.`,
    "pydantic v2. Explicit JSON null is invalid; omit the field.",
    "Hard-cap maximums are the OmniBot ceilings and must not be raised.",
    '"""',
    "",
    "from __future__ import annotations",
    "",
    "from enum import Enum",
    "",
    "from pydantic import BaseModel, ConfigDict, Field, model_validator",
    "",
    "",
    "class DescriptorModel(BaseModel):",
    '    """Shared model settings for ohho.descriptor.v1."""',
    "",
    '    model_config = ConfigDict(extra="forbid")',
    "",
    '    @model_validator(mode="before")',
    "    @classmethod",
    "    def _reject_null(cls, data: object) -> object:",
    "        if isinstance(data, dict):",
    "            for key, value in data.items():",
    "                if value is None:",
    '                    raise ValueError(key + " must not be null; omit the field")',
    "        return data",
    "",
    "",
  ];

  for (const type of ordered) {
    if (type.kind === "enum") {
      lines.push(`class ${type.name}(str, Enum):`);
      if (type.description) {
        lines.push(`    """${type.description}"""`);
        lines.push("");
      }
      for (const value of type.values) {
        lines.push(`    ${pyEnumMember(value)} = ${pyString(value)}`);
      }
      lines.push("");
      lines.push("");
      continue;
    }

    lines.push(`class ${type.name}(DescriptorModel):`);
    if (type.description) {
      lines.push(`    """${type.description}"""`);
      lines.push("");
    }
    for (const field of type.fields) {
      lines.push(pyField(field));
    }
    lines.push("");
    lines.push("");
  }

  return lf(lines.join("\n"));
}

function emitVersionModule(manifest) {
  return lf(
    [
      "/** @generated by scripts/codegen-descriptor.mjs — do not edit. */",
      `export const DESCRIPTOR_SCHEMA_ID = ${JSON.stringify(manifest.id)};`,
      `export const DESCRIPTOR_SCHEMA_VERSION = ${JSON.stringify(manifest.version)};`,
      `export const DESCRIPTOR_SCHEMA_VERSION_PATTERN = ${JSON.stringify(manifest.versionPattern)};`,
    ].join("\n"),
  );
}

async function emitTypeScript(manifest, docs) {
  const chunks = [
    "/**",
    " * @generated by scripts/codegen-descriptor.mjs — do not edit.",
    ` * Schema ${manifest.id} version ${manifest.version}.`,
    " * Hard-cap maximums are the OmniBot ceilings and must not be raised.",
    " */",
    "",
  ];
  const seen = new Set();
  const dir = await mkdtemp(path.join(tmpdir(), "ohho-descriptor-"));
  try {
    for (const [fileName, doc] of docs) {
      await writeFile(path.join(dir, fileName), lf(JSON.stringify(stripForTypeScript(doc))), "utf8");
    }
    for (const fileName of manifest.messages) {
      const ts = await compileFromFile(path.join(dir, fileName), {
        bannerComment: "",
        additionalProperties: false,
        enableConstEnums: true,
      });
      const parts = ts.trim().split(/\n(?=export )/);
      for (const block of parts) {
        const match = block.match(/^export (?:type|interface) (\w+)/);
        if (match) {
          if (seen.has(match[1])) {
            continue;
          }
          seen.add(match[1]);
        }
        chunks.push(block.trimEnd(), "");
      }
    }
    return lf(chunks.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeOrCheck(filePath, content) {
  const body = lf(content);
  if (body.includes("\r")) {
    throw new Error(`generator produced CR in ${path.relative(ROOT, filePath)}`);
  }
  if (check) {
    let existing = "";
    try {
      existing = await readFile(filePath, "utf8");
    } catch {
      console.error(`missing ${path.relative(ROOT, filePath)} — run npm run codegen:descriptor`);
      return false;
    }
    if (existing !== body) {
      console.error(`stale ${path.relative(ROOT, filePath)} — run npm run codegen:descriptor`);
      return false;
    }
    return true;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body, "utf8");
  console.log(`wrote ${path.relative(ROOT, filePath)}`);
  return true;
}

async function main() {
  const manifest = await readJson(path.join(SCHEMA_DIR, "manifest.json"));
  const versionRe = new RegExp(manifest.versionPattern);
  if (!versionRe.test(manifest.version)) {
    throw new Error("manifest version does not match versionPattern");
  }
  const docs = new Map();
  docs.set("defs.json", await readJson(path.join(SCHEMA_DIR, "defs.json")));
  for (const fileName of manifest.messages) {
    docs.set(fileName, await readJson(path.join(SCHEMA_DIR, fileName)));
  }
  const defsPattern = docs.get("defs.json").$defs.SchemaVersion.pattern;
  if (defsPattern !== manifest.versionPattern) {
    throw new Error("SchemaVersion.pattern does not match manifest.versionPattern");
  }
  assertCeilings(docs.get("defs.json"));

  const types = buildModel(docs, manifest);
  const ordered = topo(types);
  const results = await Promise.all([
    writeOrCheck(TS_FILE, await emitTypeScript(manifest, docs)),
    writeOrCheck(TS_VERSION_FILE, emitVersionModule(manifest)),
    writeOrCheck(CS_FILE, emitCSharp(manifest, ordered)),
    writeOrCheck(PY_FILE, emitPython(manifest, ordered)),
  ]);
  if (results.some((ok) => !ok)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
