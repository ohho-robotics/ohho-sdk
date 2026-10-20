#!/usr/bin/env node
/**
 * Generate TypeScript, C#, and Python from ohho.telemetry.v1 JSON Schemas.
 *
 *   node scripts/codegen-telemetry.mjs          # write
 *   node scripts/codegen-telemetry.mjs --check  # exit 1 if stale
 *
 * Outputs are LF. C# targets netstandard2.1 and Newtonsoft.Json (namespace Ohho.Schemas).
 * Python is pydantic v2.
 */

import { compileFromFile } from "json-schema-to-typescript";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "packages/schemas/ohho.telemetry.v1");
const TS_FILE = path.join(ROOT, "packages/schemas/src/generated/telemetry.generated.ts");
const TS_VERSION_FILE = path.join(
  ROOT,
  "packages/schemas/src/generated/telemetry-version.generated.ts",
);
const CS_FILE = path.join(ROOT, "generated/csharp/Ohho.Schemas/TelemetryV1.generated.cs");
const PY_FILE = path.join(ROOT, "generated/python/ohho_schemas/telemetry_v1.py");
const PY_INIT = path.join(ROOT, "generated/python/ohho_schemas/__init__.py");

const check = process.argv.includes("--check");

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
    return { kind: "array", items: fieldType(docs, fromFile, schema.items) };
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
  const wires = new Set(fields.map((field) => field.wire));
  return {
    kind: "object",
    name: node.title,
    description: node.description || "",
    estopSource: node["x-ohho-estop-source"] === true,
    safetyFlags: wires.has("deadman") && wires.has("estop") && wires.has("mode"),
    echoFactory: node.title === "HeartbeatEcho",
    fields,
  };
}

function buildModel(docs, manifest) {
  const defs = docs.get("defs.json").$defs;
  /** @type {Map<string, object>} */
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
      if (field.type.kind === "ref" && !types.has(field.type.name)) {
        throw new Error(`${type.name}.${field.wire} references unknown ${field.type.name}`);
      }
      if (field.type.kind === "array" && field.type.items.kind === "ref" && !types.has(field.type.items.name)) {
        throw new Error(`${type.name}.${field.wire} items reference unknown ${field.type.items.name}`);
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
    if (type.items.kind !== "ref" || type.items.refKind !== "object") {
      throw new Error(`array ${field.wire} must contain objects`);
    }
    const loop = [
      `for (int i = 0; i < ${prop}.Length; i++)`,
      `{`,
      `    if (${prop}[i] == null)`,
      `    {`,
      `        throw new InvalidOperationException(${csharpString(`${field.wire} contains null`)});`,
      `    }`,
      `    ${prop}[i].Validate();`,
      `}`,
    ];
    if (field.required) {
      return [
        `if (${prop} == null)`,
        `{`,
        `    throw new InvalidOperationException(${csharpString(`${field.wire} is required`)});`,
        `}`,
        ...loop,
      ];
    }
    return [`if (${prop} != null)`, `{`, ...loop.map((line) => `    ${line}`), `}`];
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
    const min = type.minimum == null ? "null" : formatDouble(type.minimum);
    const max = type.maximum == null ? "null" : formatDouble(type.maximum);
    return [`OhhoValidate.Finite(${csharpString(field.wire)}, ${prop}, ${min}, ${max});`];
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
    "// Generated by scripts/codegen-telemetry.mjs — do not edit.",
    `// Schema ${manifest.id} version ${manifest.version}.`,
    "// Newtonsoft.Json, namespace Ohho.Schemas, netstandard2.1.",
    "",
    "using System;",
    "using System.Text.RegularExpressions;",
    "using System.Runtime.Serialization;",
    "using Newtonsoft.Json;",
    "using Newtonsoft.Json.Converters;",
    "",
    "namespace Ohho.Schemas",
    "{",
    "    /// <summary>Rejects integer spellings of enum values such as 0 for sim.</summary>",
    "    public sealed class OhhoStringEnumConverter : StringEnumConverter",
    "    {",
    "        public OhhoStringEnumConverter()",
    "        {",
    "            AllowIntegerValues = false;",
    "        }",
    "    }",
    "",
    "    /// <summary>Rejects numeric spellings of booleans such as 1 for true.</summary>",
    "    public sealed class OhhoBoolConverter : JsonConverter",
    "    {",
    "        public override bool CanConvert(Type objectType)",
    "        {",
    "            return objectType == typeof(bool);",
    "        }",
    "",
    "        public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)",
    "        {",
    "            if (reader.TokenType != JsonToken.Boolean)",
    "            {",
    "                throw new JsonSerializationException(\"Expected a JSON boolean.\");",
    "            }",
    "            return (bool)reader.Value;",
    "        }",
    "",
    "        public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)",
    "        {",
    "            writer.WriteValue((bool)value);",
    "        }",
    "    }",
    "",
    "    /// <summary>",
    "    /// Serializer settings for these schemas. Unknown members are errors.",
    "    /// A default object is not a motion permit; call Validate after reading.",
    "    /// </summary>",
    "    public static class OhhoJson",
    "    {",
    "        public static readonly JsonSerializerSettings Settings = CreateSettings();",
    "",
    "        private static JsonSerializerSettings CreateSettings()",
    "        {",
    "            JsonSerializerSettings settings = new JsonSerializerSettings",
    "            {",
    "                MissingMemberHandling = MissingMemberHandling.Error,",
    "                DateParseHandling = DateParseHandling.None,",
    "            };",
    "            settings.Converters.Add(new OhhoBoolConverter());",
    "            return settings;",
    "        }",
    "    }",
    "",
    "    internal static class OhhoValidate",
    "    {",
    "        public static void Finite(string name, double value, double? minimum, double? maximum)",
    "        {",
    "            if (double.IsNaN(value) || double.IsInfinity(value))",
    "            {",
    "                throw new InvalidOperationException(name + \" must be a finite number\");",
    "            }",
    "            if (minimum.HasValue && value < minimum.Value)",
    "            {",
    "                throw new InvalidOperationException(name + \" is below the minimum\");",
    "            }",
    "            if (maximum.HasValue && value > maximum.Value)",
    "            {",
    "                throw new InvalidOperationException(name + \" is above the maximum\");",
    "            }",
    "        }",
    "",
    "        public static void Whole(string name, long value, long? minimum, long? maximum)",
    "        {",
    "            if (minimum.HasValue && value < minimum.Value)",
    "            {",
    "                throw new InvalidOperationException(name + \" is below the minimum\");",
    "            }",
    "            if (maximum.HasValue && value > maximum.Value)",
    "            {",
    "                throw new InvalidOperationException(name + \" is above the maximum\");",
    "            }",
    "        }",
    "",
    "        public static void Text(string name, string value, bool required, int? minLength, int? maxLength, string pattern)",
    "        {",
    "            if (value == null)",
    "            {",
    "                if (required)",
    "                {",
    "                    throw new InvalidOperationException(name + \" is required\");",
    "                }",
    "                return;",
    "            }",
    "            if (minLength.HasValue && value.Length < minLength.Value)",
    "            {",
    "                throw new InvalidOperationException(name + \" is too short\");",
    "            }",
    "            if (maxLength.HasValue && value.Length > maxLength.Value)",
    "            {",
    "                throw new InvalidOperationException(name + \" is too long\");",
    "            }",
    "            if (pattern != null && !Regex.IsMatch(value, pattern, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50)))",
    "            {",
    "                throw new InvalidOperationException(name + \" does not match the schema pattern\");",
    "            }",
    "        }",
    "    }",
    "",
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
      lines.push(
        `        [JsonProperty(${csharpString(field.wire)}, Required = ${required})]`,
      );
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
    if (type.estopSource) {
      lines.push("            bool stopped = Active || Latched;");
      lines.push("            if (stopped && Source == EstopSource.None)");
      lines.push("            {");
      lines.push(
        "                throw new InvalidOperationException(\"estop source must not be none while active or latched\");",
      );
      lines.push("            }");
      lines.push("            if (!stopped && Source != EstopSource.None)");
      lines.push("            {");
      lines.push(
        "                throw new InvalidOperationException(\"estop source must be none when the e-stop is clear and unlatched\");",
      );
      lines.push("            }");
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

    if (type.safetyFlags) {
      lines.push("");
      lines.push("        /// <summary>");
      lines.push("        /// True only when deadman is asserted, e-stop is clear and unlatched with source none,");
      lines.push("        /// and neither subsystem mode is fault. Missing flags return false.");
      lines.push("        /// This is not a safety gate: it does not apply caps, joint limits, watchdogs, or staleness.");
      lines.push("        /// </summary>");
      lines.push("        public bool SafetyFlagsAllowMotion()");
      lines.push("        {");
      lines.push("            if (Estop == null || Mode == null)");
      lines.push("            {");
      lines.push("                return false;");
      lines.push("            }");
      lines.push("            if (!Deadman)");
      lines.push("            {");
      lines.push("                return false;");
      lines.push("            }");
      lines.push("            if (Estop.Active)");
      lines.push("            {");
      lines.push("                return false;");
      lines.push("            }");
      lines.push("            if (Estop.Latched)");
      lines.push("            {");
      lines.push("                return false;");
      lines.push("            }");
      lines.push("            if (Estop.Source != EstopSource.None)");
      lines.push("            {");
      lines.push("                return false;");
      lines.push("            }");
      lines.push("            if (Mode.Base == SubsystemMode.Fault || Mode.Arm == SubsystemMode.Fault)");
      lines.push("            {");
      lines.push("                return false;");
      lines.push("            }");
      lines.push("            return true;");
      lines.push("        }");
    }

    if (type.echoFactory) {
      lines.push("");
      lines.push("        /// <summary>");
      lines.push("        /// Copy seq and t_client unchanged and stamp the server clock.");
      lines.push("        /// serverTimeSeconds is seconds since the Unix epoch and must be finite and &gt;= 0.");
      lines.push("        /// </summary>");
      lines.push("        public static HeartbeatEcho Echo(Heartbeat heartbeat, double serverTimeSeconds)");
      lines.push("        {");
      lines.push("            if (heartbeat == null)");
      lines.push("            {");
      lines.push("                throw new ArgumentNullException(nameof(heartbeat));");
      lines.push("            }");
      lines.push(
        "            if (double.IsNaN(serverTimeSeconds) || double.IsInfinity(serverTimeSeconds) || serverTimeSeconds < 0d)",
      );
      lines.push("            {");
      lines.push(
        "                throw new ArgumentOutOfRangeException(nameof(serverTimeSeconds), \"server time must be a finite number of seconds >= 0\");",
      );
      lines.push("            }");
      lines.push("            heartbeat.Validate();");
      lines.push("            HeartbeatEcho echo = new HeartbeatEcho();");
      lines.push("            echo.V = heartbeat.V;");
      lines.push("            echo.Seq = heartbeat.Seq;");
      lines.push("            echo.TClient = heartbeat.TClient;");
      lines.push("            echo.T = serverTimeSeconds;");
      lines.push("            echo.Validate();");
      lines.push("            return echo;");
      lines.push("        }");
    }

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
  }
  if (type.kind === "string") {
    if (type.minLength != null) args.push(`min_length=${type.minLength}`);
    if (type.maxLength != null) args.push(`max_length=${type.maxLength}`);
    if (type.pattern != null) args.push(`pattern=${pyPattern(type.pattern)}`);
  }
  if (field.description) {
    args.push(`description=${pyString(field.description)}`);
  }
  const value = args.length === 0 ? "" : ` = Field(${args.join(", ")})`;
  return `    ${field.wire}: ${annotation}${value}`;
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

function emitPython(manifest, ordered) {
  const lines = [
    '"""Generated OhhO telemetry models. Do not edit.',
    "",
    "Generated by scripts/codegen-telemetry.mjs.",
    `Schema ${manifest.id} version ${manifest.version}.`,
    "pydantic v2. Explicit JSON null is invalid; omit the field.",
    "safety_flags_allow_motion is not a safety gate.",
    '"""',
    "",
    "from __future__ import annotations",
    "",
    "import math",
    "from enum import Enum",
    "from typing import Optional",
    "",
    "from pydantic import BaseModel, ConfigDict, Field, model_validator",
    "",
    "",
    "class OhhoModel(BaseModel):",
    '    """Shared model settings for ohho.telemetry.v1."""',
    "",
    '    model_config = ConfigDict(extra="forbid")',
    "",
    "    @model_validator(mode=\"before\")",
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

    lines.push(`class ${type.name}(OhhoModel):`);
    if (type.description) {
      lines.push(`    """${type.description}"""`);
      lines.push("");
    }
    for (const field of type.fields) {
      lines.push(pyField(field));
    }
    if (type.estopSource) {
      lines.push("");
      lines.push('    @model_validator(mode="after")');
      lines.push("    def _estop_source_rule(self) -> EstopState:");
      lines.push("        stopped = self.active or self.latched");
      lines.push("        if stopped and self.source == EstopSource.NONE:");
      lines.push(
        '            raise ValueError("estop source must not be none while active or latched")',
      );
      lines.push("        if (not stopped) and self.source != EstopSource.NONE:");
      lines.push(
        '            raise ValueError("estop source must be none when the e-stop is clear and unlatched")',
      );
      lines.push("        return self");
    }
    if (type.safetyFlags) {
      lines.push("");
      lines.push("    def safety_flags_allow_motion(self) -> bool:");
      lines.push('        """True only for an asserted deadman with a clear, unlatched e-stop.');
      lines.push("");
      lines.push("        Fault on either subsystem returns false. Missing flags return false.");
      lines.push("        This does not apply caps, joint limits, watchdogs, or staleness.");
      lines.push('        """');
      lines.push("        if self.estop is None or self.mode is None:");
      lines.push("            return False");
      lines.push("        if self.deadman is not True:");
      lines.push("            return False");
      lines.push("        if self.estop.active is not False:");
      lines.push("            return False");
      lines.push("        if self.estop.latched is not False:");
      lines.push("            return False");
      lines.push("        if self.estop.source != EstopSource.NONE:");
      lines.push("            return False");
      lines.push(
        "        if self.mode.base == SubsystemMode.FAULT or self.mode.arm == SubsystemMode.FAULT:",
      );
      lines.push("            return False");
      lines.push("        return True");
    }
    if (type.echoFactory) {
      lines.push("");
      lines.push("    @classmethod");
      lines.push(
        "    def from_heartbeat(cls, heartbeat: Heartbeat, server_time_seconds: float) -> HeartbeatEcho:",
      );
      lines.push('        """Copy seq and t_client unchanged and stamp the server clock."""');
      lines.push(
        "        if isinstance(server_time_seconds, bool) or not isinstance(server_time_seconds, (int, float)):",
      );
      lines.push(
        '            raise ValueError("server time must be a finite number of seconds >= 0")',
      );
      lines.push(
        "        if not math.isfinite(float(server_time_seconds)) or server_time_seconds < 0:",
      );
      lines.push(
        '            raise ValueError("server time must be a finite number of seconds >= 0")',
      );
      lines.push("        return cls(");
      lines.push("            v=heartbeat.v,");
      lines.push("            seq=heartbeat.seq,");
      lines.push("            t_client=heartbeat.t_client,");
      lines.push("            t=float(server_time_seconds),");
      lines.push("        )");
    }
    lines.push("");
    lines.push("");
  }

  return lf(lines.join("\n"));
}

function emitPythonInit(ordered) {
  const names = ordered.map((type) => type.name);
  const lines = [
    '"""Generated OhhO telemetry models (ohho.telemetry.v1). Do not edit."""',
    "",
    "from ohho_schemas.telemetry_v1 import (",
    ...names.map((name) => `    ${name},`),
    ")",
    "",
    "__all__ = [",
    ...names.map((name) => `    "${name}",`),
    "]",
    "",
  ];
  return lf(lines.join("\n"));
}

function emitVersionModule(manifest) {
  return lf(
    [
      "/** @generated by scripts/codegen-telemetry.mjs — do not edit. */",
      `export const TELEMETRY_SCHEMA_ID = ${JSON.stringify(manifest.id)};`,
      `export const TELEMETRY_SCHEMA_VERSION = ${JSON.stringify(manifest.version)};`,
      `export const TELEMETRY_SCHEMA_VERSION_PATTERN = ${JSON.stringify(manifest.versionPattern)};`,
    ].join("\n"),
  );
}

async function emitTypeScript(manifest, docs) {
  const chunks = [
    "/**",
    " * @generated by scripts/codegen-telemetry.mjs — do not edit.",
    ` * Schema ${manifest.id} version ${manifest.version}.`,
    " */",
    "",
  ];
  const seen = new Set();
  const dir = await mkdtemp(path.join(tmpdir(), "ohho-telemetry-"));
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
      console.error(`missing ${path.relative(ROOT, filePath)} — run npm run codegen:telemetry`);
      return false;
    }
    if (existing !== body) {
      console.error(`stale ${path.relative(ROOT, filePath)} — run npm run codegen:telemetry`);
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

  const types = buildModel(docs, manifest);
  const ordered = topo(types);
  const csharp = emitCSharp(manifest, ordered);
  const python = emitPython(manifest, ordered);
  const pythonInit = emitPythonInit(ordered);
  const versionModule = emitVersionModule(manifest);
  const typescript = await emitTypeScript(manifest, docs);

  const results = await Promise.all([
    writeOrCheck(TS_FILE, typescript),
    writeOrCheck(TS_VERSION_FILE, versionModule),
    writeOrCheck(CS_FILE, csharp),
    writeOrCheck(PY_FILE, python),
    writeOrCheck(PY_INIT, pythonInit),
  ]);
  if (results.some((ok) => !ok)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
