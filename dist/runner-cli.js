"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/runnerCli.ts
var import_node_crypto8 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var fs = __toESM(require("node:fs/promises"));
var path = __toESM(require("node:path"));

// src/shared/lib/readLocalJson.ts
var import_promises = require("node:fs/promises");
var import_node_fs = require("node:fs");
var import_node_util2 = require("node:util");

// src/shared/lib/jsonContract.ts
var import_node_crypto = require("node:crypto");
var import_node_util = require("node:util");
function canonicalJson(value) {
  let nodes = 0;
  let bytes = 0;
  const maxBytes = 2 * 1024 * 1024;
  const account = (length) => {
    bytes += length;
    if (bytes > maxBytes) throw new Error("JSON exceeds 2 MiB.");
  };
  const encodeString = (value2) => {
    if (value2.length > maxBytes) throw new Error("JSON exceeds 2 MiB.");
    const encoded = JSON.stringify(value2);
    account(Buffer.byteLength(encoded, "utf8"));
    return encoded;
  };
  const ancestors = /* @__PURE__ */ new Set();
  const visit = (item, depth) => {
    if (++nodes > 2e5 || depth > 24) throw new Error("JSON exceeds structural limits.");
    if (typeof item === "string") return encodeString(item);
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      const encoded = JSON.stringify(item);
      account(encoded.length);
      return encoded;
    }
    if (!item || typeof item !== "object") throw new Error("Only finite JSON values are supported.");
    if (import_node_util.types.isProxy(item)) throw new Error("JSON proxies are not supported.");
    if (ancestors.has(item)) throw new Error("Cyclic JSON is not supported.");
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("Expected plain JSON containers.");
    if (Object.getOwnPropertySymbols(item).length) throw new Error("JSON symbol properties are not supported.");
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const descriptor of Object.values(descriptors)) {
      if (!("value" in descriptor)) throw new Error("JSON accessors are not supported.");
    }
    let result2;
    if (Array.isArray(item)) {
      const keys = Object.keys(item);
      if (Object.getOwnPropertyNames(item).length !== item.length + 1 || keys.length !== item.length || keys.some((key, index) => key !== String(index))) throw new Error("Expected a dense JSON array without extra properties.");
      account(2 + Math.max(0, item.length - 1));
      result2 = "[" + Array.prototype.map.call(item, (child) => visit(child, depth + 1)).join(",") + "]";
    } else {
      const keys = Object.keys(item).sort();
      account(2 + Math.max(0, keys.length - 1));
      result2 = "{" + keys.map((key) => {
        const encodedKey = encodeString(key);
        account(1);
        return encodedKey + ":" + visit(descriptors[key].value, depth + 1);
      }).join(",") + "}";
    }
    ancestors.delete(item);
    return result2;
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(result, "utf8") > maxBytes) throw new Error("JSON exceeds 2 MiB.");
  return result;
}
function jsonHash(value) {
  return (0, import_node_crypto.createHash)("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function record(value, allowed, path2) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path2}: expected an object.`);
  if (import_node_util.types.isProxy(value)) throw new Error(`${path2}: proxies are unsupported.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path2}: expected a plain object.`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.includes(key)) throw new Error(`${path2}: unsupported property.`);
    if (!("value" in descriptor)) throw new Error(`${path2}: accessors are unsupported.`);
  }
  return value;
}
function text(value, path2, max = 1024) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /\u0000/.test(value)) throw new Error(`${path2}: expected nonempty text (max ${max}).`);
  return value;
}
function identifier(value, path2) {
  const result = text(value, path2, 160);
  if (!/^[\p{L}\p{N}_.:/@-]+$/u.test(result)) throw new Error(`${path2}: invalid identifier.`);
  return result;
}
function hash(value, path2) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${path2}: expected lowercase SHA-256.`);
  return value;
}
function array(value, path2, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${path2}: expected an array (max ${max}).`);
  return value;
}
function oneOf(value, choices, path2) {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${path2}: unsupported value.`);
  return value;
}
function positiveInteger(value, path2) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${path2}: expected a positive safe integer.`);
  return value;
}
function schemaV1(value) {
  if (value !== 1) throw new Error("Unsupported schemaVersion; expected 1.");
}
function immutable(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

// src/shared/lib/readLocalJson.ts
var MAX_BYTES = 2 * 1024 * 1024;
async function readLocalText(path2, assertCurrent, regularFileMessage = "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0444\u0430\u0439\u043B.") {
  assertCurrent();
  const file = await (0, import_promises.open)(path2, import_node_fs.constants.O_RDONLY | (import_node_fs.constants.O_NONBLOCK ?? 0));
  try {
    assertCurrent();
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(regularFileMessage);
    if (stat.size > MAX_BYTES) throw new Error("\u0424\u0430\u0439\u043B \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043F\u0440\u0435\u0432\u044B\u0448\u0430\u0435\u0442 2 MiB.");
    const chunks = [];
    let total = 0;
    while (true) {
      assertCurrent();
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_BYTES + 1 - total));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      assertCurrent();
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_BYTES) throw new Error("\u0424\u0430\u0439\u043B \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043F\u0440\u0435\u0432\u044B\u0448\u0430\u0435\u0442 2 MiB.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    let text2;
    try {
      text2 = new import_node_util2.TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
    } catch {
      throw new Error("\u0424\u0430\u0439\u043B \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u0432 UTF-8.");
    }
    assertCurrent();
    return text2;
  } finally {
    await file.close();
  }
}
async function readLocalJson(path2, assertCurrent) {
  const text2 = await readLocalText(path2, assertCurrent, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0431\u044B\u0447\u043D\u044B\u0439 JSON-\u0444\u0430\u0439\u043B.");
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 JSON \u0432 \u0444\u0430\u0439\u043B\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438.");
  }
  canonicalJson(parsed);
  assertCurrent();
  return parsed;
}

// src/entities/runner/model/receipt.ts
var import_node_crypto4 = require("node:crypto");

// src/entities/business-contract/model/resultSet.ts
var VALUE_TYPES = ["null", "undefined", "boolean", "string", "number", "date", "reference", "empty_reference"];
function decimal(value, path2) {
  const source = text(value, path2, 258);
  if (!/^-?\d{1,128}(?:\.\d{1,128})?$/.test(source)) throw new Error(`${path2}: use a decimal string without exponent.`);
  const negative = source.startsWith("-");
  const [integer, fraction = ""] = (negative ? source.slice(1) : source).split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const tail = fraction.replace(/0+$/, "");
  const result = whole + (tail ? "." + tail : "");
  return negative && result !== "0" ? "-" + result : result;
}
function localDate(value, path2) {
  const source = text(value, path2, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(source)) throw new Error(`${path2}: expected a local 1C date without timezone.`);
  const [year, month, day, hour, minute, second] = source.split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new Error(`${path2}: invalid calendar date.`);
  return source;
}
function metadata(value, path2) {
  const result = text(value, path2, 256);
  if (!/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)+$/u.test(result)) throw new Error(`${path2}: expected a qualified metadata name.`);
  return result;
}
function parseValue(value, path2) {
  const cell = record(value, ["type", "value", "metadata", "id"], path2);
  const type = oneOf(cell.type, VALUE_TYPES, `${path2}.type`);
  if (type === "null" || type === "undefined") {
    record(value, ["type"], path2);
    return { type };
  }
  if (type === "reference" || type === "empty_reference") {
    record(value, type === "reference" ? ["type", "metadata", "id"] : ["type", "metadata"], path2);
    const name = metadata(cell.metadata, `${path2}.metadata`);
    if (type === "empty_reference") return { type, metadata: name };
    const id = text(cell.id, `${path2}.id`, 36);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || /^0{8}(?:-0{4}){3}-0{12}$/.test(id)) throw new Error(`${path2}.id: expected nonempty UUID; use empty_reference explicitly.`);
    return { type, metadata: name, id: id.toLowerCase() };
  }
  record(value, ["type", "value"], path2);
  if (type === "boolean") {
    if (typeof cell.value !== "boolean") throw new Error(`${path2}.value: expected boolean.`);
    return { type, value: cell.value };
  }
  if (type === "string") {
    if (typeof cell.value !== "string" || cell.value.length > 16384) throw new Error(`${path2}.value: expected string (max 16384).`);
    return { type, value: cell.value };
  }
  return { type, value: type === "number" ? decimal(cell.value, `${path2}.value`) : localDate(cell.value, `${path2}.value`) };
}
function parseResultSet(value) {
  canonicalJson(value);
  const source = record(value, ["columns", "rows"], "result");
  const columns = array(source.columns, "columns", 64).map((column, index) => text(column, `columns[${index}]`, 128));
  if (!columns.length || new Set(columns.map((column) => column.toLowerCase())).size !== columns.length) throw new Error("Columns must be nonempty and unique ignoring case.");
  const rows = array(source.rows, "rows", 2e3).map((row, index) => {
    const cells = array(row, `rows[${index}]`, columns.length);
    if (cells.length !== columns.length) throw new Error(`rows[${index}]: column count differs.`);
    return cells.map((cell, col) => parseValue(cell, `rows[${index}][${col}]`));
  });
  return immutable({ columns, rows });
}

// src/entities/runner/model/parameters.ts
var NAME = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/;
var FIXTURE_PARAMETERS = ["\u0414\u0430\u0442\u0430", "\u0421\u0441\u044B\u043B\u043A\u0430"];
var reserved = new Set(FIXTURE_PARAMETERS.map((s) => s.toLowerCase()));
function queryParameterNames(query) {
  const names = /* @__PURE__ */ new Map();
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    if (query[i] === '"') {
      if (quoted && query[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && query.slice(i, i + 2) === "//") {
      while (i < query.length && !/[\r\n]/.test(query[i])) i++;
    } else if (!quoted && query[i] === "&") {
      const match = query.slice(i + 1).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
      if (!match) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0438\u043C\u044F \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u0430 \u0437\u0430\u043F\u0440\u043E\u0441\u0430.");
      const name = match[0];
      if (name.length > 64 || !NAME.test(name)) throw new Error("\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u0438\u043C\u0435\u043D\u0430 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432 \u0434\u043E 64 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432: \u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430, \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430, \u0446\u0438\u0444\u0440\u044B \u0438 _.");
      names.set(name.toLowerCase(), name);
      i += name.length;
    }
  }
  return [...names.values()];
}
function additionalParameterNames(query) {
  return queryParameterNames(query).filter((n) => !reserved.has(n.toLowerCase()));
}
function parseScalarParameter(value) {
  canonicalJson(value);
  const cell = parseResultSet({ columns: ["Value"], rows: [[value]] }).rows[0][0];
  if (!["string", "number", "boolean", "date", "null"].includes(cell.type)) throw new Error("\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440: \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B string, number, boolean, date \u0438\u043B\u0438 null.");
  if (cell.type === "number" && cell.value.replace(/[-.]/g, "").length > 38) throw new Error("\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440 \u0447\u0438\u0441\u043B\u0430 \u043F\u0440\u0435\u0432\u044B\u0448\u0430\u0435\u0442 \u043B\u0438\u043C\u0438\u0442 \u043F\u0440\u043E\u0444\u0438\u043B\u044F 38 \u0446\u0438\u0444\u0440.");
  if (cell.type === "string" && (cell.value.includes("\0") || Buffer.from(cell.value, "utf8").toString("utf8") !== cell.value)) throw new Error("\u0421\u0442\u0440\u043E\u043A\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B.");
  return cell;
}
function parseQueryParameters(value) {
  const seen = /* @__PURE__ */ new Set();
  const parsed = array(value, "parameters", 32).map((item, i) => {
    const p = record(item, ["name", "value"], `parameters[${i}]`), name = text(p.name, "parameter.name", 64);
    if (!NAME.test(name)) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0438\u043C\u044F \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u0430 \u0437\u0430\u043F\u0440\u043E\u0441\u0430.");
    const lower = name.toLowerCase();
    if (reserved.has(lower)) throw new Error("\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0414\u0430\u0442\u0430 \u0438 \u0421\u0441\u044B\u043B\u043A\u0430 \u0437\u0430\u0434\u0430\u044E\u0442\u0441\u044F \u0434\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u043E\u0439 \u0444\u0438\u043A\u0441\u0442\u0443\u0440\u043E\u0439 \u0438 \u043D\u0435 \u043F\u0435\u0440\u0435\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u044F\u044E\u0442\u0441\u044F.");
    if (seen.has(lower)) throw new Error("\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u044E\u0442\u0441\u044F \u0431\u0435\u0437 \u0443\u0447\u0451\u0442\u0430 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430.");
    seen.add(lower);
    return { name, value: parseScalarParameter(p.value) };
  });
  if (Buffer.byteLength(canonicalJson(parsed), "utf8") > 128 * 1024) throw new Error("\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u043F\u0440\u0435\u0432\u044B\u0448\u0430\u044E\u0442 \u043B\u0438\u043C\u0438\u0442 128 KiB.");
  return immutable(parsed.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}
function assertParameterBindings(query, parameters) {
  const required = additionalParameterNames(query), used = new Set(required.map((n) => n.toLowerCase()));
  if (required.length > 32) throw new Error("\u0417\u0430\u043F\u0440\u043E\u0441 \u043F\u0440\u0435\u0432\u044B\u0448\u0430\u0435\u0442 \u043B\u0438\u043C\u0438\u0442 32 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432.");
  const provided = new Set(parameters.map((p) => p.name.toLowerCase()));
  if (required.some((n) => !provided.has(n.toLowerCase()))) throw new Error("\u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u0432\u0441\u0435\u0445 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432 \u0437\u0430\u043F\u0440\u043E\u0441\u0430.");
  if (parameters.some((p) => !used.has(p.name.toLowerCase()))) throw new Error("\u041F\u0435\u0440\u0435\u0434\u0430\u043D \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u043C \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u043C.");
}

// src/entities/runner/model/queryJob.ts
var import_node_crypto3 = require("node:crypto");

// src/shared/lib/sha256.ts
var import_node_crypto2 = require("node:crypto");
var TEXT_HASH_ENCODING = "utf16le";
function sha256Text(value) {
  return (0, import_node_crypto2.createHash)("sha256").update(value, TEXT_HASH_ENCODING).digest("hex");
}

// src/entities/business-contract/model/contract.ts
function parseBusinessContract(value) {
  canonicalJson(value);
  const source = record(value, ["schemaVersion", "id", "version", "projectId", "intent", "requirement", "scope", "preconditions", "assumptions", "assertion", "approvalState"], "contract");
  schemaV1(source.schemaVersion);
  const requirement = record(source.requirement, ["reference", "sha256"], "requirement");
  const scope = record(source.scope, ["metadataHash", "profileId", "platformVersion"], "scope");
  const assertion = record(source.assertion, ["kind", "mode", "expected"], "assertion");
  const lines = (value2, path2) => array(value2, path2, 50).map((line, index) => text(line, `${path2}[${index}]`, 2e3));
  return immutable({
    schemaVersion: 1,
    id: identifier(source.id, "id"),
    version: positiveInteger(source.version, "version"),
    projectId: identifier(source.projectId, "projectId"),
    intent: text(source.intent, "intent", 8e3),
    requirement: { reference: text(requirement.reference, "requirement.reference"), sha256: hash(requirement.sha256, "requirement.sha256") },
    scope: { metadataHash: hash(scope.metadataHash, "scope.metadataHash"), profileId: identifier(scope.profileId, "scope.profileId"), platformVersion: text(scope.platformVersion, "scope.platformVersion", 64) },
    preconditions: lines(source.preconditions, "preconditions"),
    assumptions: lines(source.assumptions, "assumptions"),
    assertion: { kind: oneOf(assertion.kind, ["query_rows_equal"], "assertion.kind"), mode: oneOf(assertion.mode, ["multiset", "ordered"], "assertion.mode"), expected: parseResultSet(assertion.expected) },
    approvalState: oneOf(source.approvalState, ["proposed"], "approvalState")
  });
}

// src/entities/validation/model/queryComparison.ts
function parseQueryCandidateIdentity(value) {
  canonicalJson(value);
  const source = record(value, ["schemaVersion", "taskId", "scopeHash", "snapshotHash", "contextHash", "candidateHash", "textHashEncoding"], "candidate");
  schemaV1(source.schemaVersion);
  return immutable({
    schemaVersion: 1,
    taskId: identifier(source.taskId, "candidate.taskId"),
    scopeHash: hash(source.scopeHash, "candidate.scopeHash"),
    snapshotHash: hash(source.snapshotHash, "candidate.snapshotHash"),
    contextHash: hash(source.contextHash, "candidate.contextHash"),
    candidateHash: hash(source.candidateHash, "candidate.candidateHash"),
    textHashEncoding: oneOf(source.textHashEncoding, [TEXT_HASH_ENCODING], "candidate.textHashEncoding")
  });
}

// src/entities/runner/model/queryJob.ts
var RUNNER_POLICY = immutable({
  schemaVersion: 1,
  kind: "selected_query_only",
  user: "10001:10001",
  network: "none",
  memoryBytes: 2147483648,
  nanoCpus: 1e9,
  pids: 256,
  deadlineMs: 12e4,
  receiptTtlMs: 3e5,
  readOnlyRoot: true,
  capabilities: "drop_all",
  noNewPrivileges: true,
  seccomp: "docker_builtin",
  cgroupVersion: "2",
  ipc: "private",
  cgroupNamespace: "private",
  hostMounts: false,
  imagePull: "never",
  workTmpfsBytes: 805306368,
  tempTmpfsBytes: 268435456,
  candidateMaxChars: 64e3,
  queryMaxChars: 24e3,
  resultMaxRows: 2e3,
  resultMaxColumns: 64,
  containerLifetimeSeconds: 180,
  autoRemove: true
});
function protocolVersion(value) {
  if (value !== 1 && value !== 2) throw new Error("Unsupported runner protocol version.");
  return value;
}
function parseRunnerProfile(value) {
  canonicalJson(value);
  const v = record(value, ["schemaVersion", "kind", "runnerId", "keyId", "projectId", "profileId", "imageId", "fixtureHash", "metadataHash", "platformVersion", "binaryHash"], "profile");
  const version = protocolVersion(v.schemaVersion);
  const kind = version === 1 ? oneOf(v.kind, ["query_text_fixture_v1"], "profile.kind") : oneOf(v.kind, ["query_text_fixture_v2"], "profile.kind");
  const imageId = text(v.imageId, "imageId", 71);
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Runner requires an immutable local image ID.");
  return immutable({
    schemaVersion: version,
    kind,
    runnerId: identifier(v.runnerId, "runnerId"),
    keyId: hash(v.keyId, "keyId"),
    projectId: hash(v.projectId, "projectId"),
    profileId: identifier(v.profileId, "profileId"),
    imageId,
    fixtureHash: hash(v.fixtureHash, "fixtureHash"),
    metadataHash: hash(v.metadataHash, "metadataHash"),
    platformVersion: text(v.platformVersion, "platformVersion", 64),
    binaryHash: hash(v.binaryHash, "binaryHash")
  });
}
function offset(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid UTF-16 selection offset.");
  return value;
}
function decodeQueryLiteral(literal) {
  if (!literal.startsWith('"')) throw new Error("Select a complete BSL string literal.");
  let result = "";
  for (let i = 1; i < literal.length; i++) {
    const ch = literal[i];
    if (ch === '"') {
      if (literal[i + 1] === '"') {
        result += '"';
        i++;
        continue;
      }
      if (i !== literal.length - 1) throw new Error("Selection contains text outside its BSL literal.");
      return result;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && literal[i + 1] === "\n") i++;
      const continuation = literal.slice(i + 1).match(/^[\t ]*\|/);
      if (!continuation) throw new Error("BSL multiline strings require a continuation marker.");
      result += "\n";
      i += continuation[0].length;
    } else result += ch;
  }
  throw new Error("Unterminated BSL string literal.");
}
function assertSingleQuery(query) {
  if (!/^(?:\s|\/\/[^\r\n]*(?:\r?\n|$))*(?:ВЫБРАТЬ|SELECT)(?![\p{L}\p{N}_])/iu.test(query)) throw new Error("This profile accepts one SELECT query.");
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    if (query[i] === '"') {
      if (quoted && query[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && query.slice(i, i + 2) === "//") {
      while (i < query.length && !/[\r\n]/.test(query[i])) i++;
    } else if (!quoted && query[i] === ";") throw new Error("Query batches are unsupported by this profile.");
  }
  if (quoted) throw new Error("Unterminated query string.");
}
function parseRunnerRequest(value) {
  canonicalJson(value);
  const version = protocolVersion(value?.schemaVersion);
  const v = record(value, ["schemaVersion", "operation", "candidate", "candidateCode", "selection", "contract", "profileId", ...version === 2 ? ["parameters"] : []], "request");
  oneOf(v.operation, ["run_query_fragment"], "operation");
  const candidate = parseQueryCandidateIdentity(v.candidate), code = text(v.candidateCode, "candidateCode", RUNNER_POLICY.candidateMaxChars);
  if (Buffer.from(code, "utf8").toString("utf8") !== code) throw new Error("Unpaired surrogates are unsupported by the engine transport.");
  if (sha256Text(code) !== candidate.candidateHash) throw new Error("Candidate content does not match its host identity.");
  const s = record(v.selection, ["start", "end", "format"], "selection");
  const start = offset(s.start), end = offset(s.end), format = oneOf(s.format, ["query_text", "bsl_string_literal"], "selection.format");
  if (start >= end || end > code.length) throw new Error("Selection is outside the candidate.");
  if (format === "query_text" && (start !== 0 || end !== code.length)) throw new Error("Plain query mode requires the entire candidate.");
  const query = format === "query_text" ? code : decodeQueryLiteral(code.slice(start, end));
  if (!query.trim() || query.length > RUNNER_POLICY.queryMaxChars) throw new Error("Query exceeds the 24000 character profile limit.");
  assertSingleQuery(query);
  const contract = parseBusinessContract(v.contract);
  if (contract.projectId !== candidate.scopeHash) throw new Error("Contract and candidate project differ.");
  const parameters = version === 2 ? parseQueryParameters(v.parameters) : void 0;
  if (parameters) assertParameterBindings(query, parameters);
  return immutable({
    schemaVersion: version,
    operation: "run_query_fragment",
    ...parameters ? { parameters } : {},
    candidate,
    candidateCode: code,
    selection: { start, end, format },
    contract,
    profileId: identifier(v.profileId, "profileId"),
    query,
    queryHash: sha256Text(query)
  });
}
function checkProfile(request, profile) {
  if (request.schemaVersion !== profile.schemaVersion) throw new Error("Request and operator profile protocol versions differ.");
  const scope = request.contract.scope;
  if (request.candidate.scopeHash !== profile.projectId || request.profileId !== profile.profileId || scope.profileId !== profile.profileId || scope.metadataHash !== profile.metadataHash || scope.platformVersion !== profile.platformVersion) {
    throw new Error("Request is outside the operator-pinned project/profile/metadata scope.");
  }
}
function assertRunnableRequest(request, profile) {
  checkProfile(request, profile);
  if (profile.schemaVersion === 1 && additionalParameterNames(request.query).length) {
    throw new Error("\u041F\u0440\u043E\u0444\u0438\u043B\u044C v1 \u0437\u0430\u0434\u0430\u0451\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0414\u0430\u0442\u0430 \u0438 \u0421\u0441\u044B\u043B\u043A\u0430. \u0414\u043B\u044F \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043F\u0440\u043E\u0444\u0438\u043B\u044C v2.");
  }
  if (profile.schemaVersion === 2) assertParameterBindings(request.query, request.parameters ?? []);
}
function createRunnerChallenge(request, profile, now = Date.now()) {
  assertRunnableRequest(request, profile);
  return immutable({
    schemaVersion: 1,
    jobId: (0, import_node_crypto3.randomUUID)(),
    nonce: (0, import_node_crypto3.randomBytes)(32).toString("hex"),
    requestHash: jsonHash(request),
    profileHash: jsonHash(profile),
    policyHash: jsonHash(RUNNER_POLICY),
    createdAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + RUNNER_POLICY.deadlineMs).toISOString()
  });
}

// src/entities/runner/model/isolation.ts
function parseIsolationEvidence(value) {
  canonicalJson(value);
  const v = record(value, ["uid", "memory", "swap", "pids", "cpu", "seccomp", "noNewPrivileges", "capabilities", "rootReadOnly", "interfaces"], "kernel");
  if (v.uid !== 10001 || v.memory !== String(RUNNER_POLICY.memoryBytes) || v.swap !== "0" || v.pids !== String(RUNNER_POLICY.pids) || typeof v.cpu !== "string" || !/^([1-9]\d*) \1$/.test(v.cpu) || v.seccomp !== "2" || v.noNewPrivileges !== "1" || v.capabilities !== "0000000000000000" || v.rootReadOnly !== true || JSON.stringify(v.interfaces) !== '["lo"]') {
    throw new Error("Effective kernel isolation does not meet the fixed profile.");
  }
  return immutable({
    uid: 10001,
    memory: v.memory,
    swap: v.swap,
    pids: v.pids,
    cpu: v.cpu,
    seccomp: "2",
    noNewPrivileges: "1",
    capabilities: "0000000000000000",
    rootReadOnly: true,
    interfaces: ["lo"]
  });
}

// src/entities/runner/model/receipt.ts
function runnerKeyId(key) {
  const publicKey = key.type === "private" ? (0, import_node_crypto4.createPublicKey)(key) : key;
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("An Ed25519 runner key is required.");
  return (0, import_node_crypto4.createHash)("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}
function parseEngineObservation(value) {
  canonicalJson(value);
  const version = protocolVersion(value?.schemaVersion);
  const v = record(value, ["schemaVersion", "nonce", "platformVersion", "binaryHash", "status", "actual", "reason", "logHash", ...version === 2 ? ["parametersHash"] : []], "engine");
  const status = oneOf(v.status, ["completed", "failed", "unsupported"], "engine.status");
  const reason = v.reason === null ? null : text(v.reason, "engine.reason", 4e3);
  if (status !== "completed" && !reason) throw new Error("Uncompleted engine checks require a reason.");
  if (status !== "completed" && v.actual !== null) throw new Error("An uncompleted engine check cannot return actual rows.");
  return immutable({
    schemaVersion: version,
    ...version === 2 ? { parametersHash: hash(v.parametersHash, "parametersHash") } : {},
    nonce: hash(v.nonce, "nonce"),
    platformVersion: text(v.platformVersion, "platformVersion", 64),
    binaryHash: hash(v.binaryHash, "binaryHash"),
    status,
    actual: status === "completed" ? parseResultSet(v.actual) : null,
    reason,
    logHash: hash(v.logHash, "logHash")
  });
}
function timestamp(value) {
  const result = text(value, "timestamp", 24);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error("Invalid UTC timestamp.");
  return result;
}
function parseRunnerChallenge(value) {
  canonicalJson(value);
  const v = record(value, ["schemaVersion", "jobId", "nonce", "requestHash", "profileHash", "policyHash", "createdAt", "deadlineAt"], "challenge");
  schemaV1(v.schemaVersion);
  const createdAt = timestamp(v.createdAt), deadlineAt = timestamp(v.deadlineAt);
  if (Date.parse(deadlineAt) - Date.parse(createdAt) !== RUNNER_POLICY.deadlineMs) throw new Error("Invalid job deadline.");
  return immutable({
    schemaVersion: 1,
    jobId: identifier(v.jobId, "jobId"),
    nonce: hash(v.nonce, "nonce"),
    requestHash: hash(v.requestHash, "requestHash"),
    profileHash: hash(v.profileHash, "profileHash"),
    policyHash: hash(v.policyHash, "policyHash"),
    createdAt,
    deadlineAt
  });
}
function assertRunnerChallengeBinding(request, profile, challenge) {
  checkProfile(request, profile);
  if (challenge.requestHash !== jsonHash(request) || challenge.profileHash !== jsonHash(profile) || challenge.policyHash !== jsonHash(RUNNER_POLICY)) {
    throw new Error("Runner challenge/profile/request binding mismatch.");
  }
}
function assertBinding(request, profile, challenge, observation) {
  assertRunnerChallengeBinding(request, profile, challenge);
  if (observation.schemaVersion !== request.schemaVersion || request.schemaVersion === 2 && observation.parametersHash !== jsonHash(request.parameters)) throw new Error("Engine parameter binding mismatch.");
  if (observation.nonce !== challenge.nonce || observation.binaryHash !== profile.binaryHash || observation.platformVersion !== profile.platformVersion) {
    throw new Error("Runner job/profile/engine binding mismatch.");
  }
}
function payload(request, profile, challenge, observation, isolation, startedAt, finishedAt) {
  assertBinding(request, profile, challenge, observation);
  if (Date.parse(startedAt) < Date.parse(challenge.createdAt) || Date.parse(finishedAt) < Date.parse(startedAt) || Date.parse(finishedAt) > Date.parse(challenge.deadlineAt)) throw new Error("Execution is outside its job lease.");
  return immutable({
    schemaVersion: request.schemaVersion,
    ...request.schemaVersion === 2 ? { parameters: request.parameters, parametersHash: jsonHash(request.parameters) } : {},
    kind: "selected_query_execution",
    runnerId: profile.runnerId,
    keyId: profile.keyId,
    job: challenge,
    candidate: request.candidate,
    queryHash: request.queryHash,
    selection: request.selection,
    contractHash: jsonHash(request.contract),
    expectedHash: jsonHash(request.contract.assertion.expected),
    observation,
    isolation: parseIsolationEvidence(isolation),
    startedAt,
    finishedAt,
    expiresAt: new Date(Date.parse(finishedAt) + RUNNER_POLICY.receiptTtlMs).toISOString(),
    scope: "selected_query_only",
    fullBslExecution: "not_run",
    approvalVerified: false,
    canApply: false
  });
}
function signRunnerReceipt(request, profile, challenge, observation, isolation, privatePem, startedAt, finishedAt) {
  const key = (0, import_node_crypto4.createPrivateKey)(privatePem);
  if (runnerKeyId(key) !== profile.keyId) throw new Error("Runner signing key differs from its pinned profile.");
  const body = payload(request, profile, challenge, observation, isolation, timestamp(startedAt), timestamp(finishedAt));
  return immutable({
    schemaVersion: request.schemaVersion,
    algorithm: "Ed25519",
    payload: body,
    signature: (0, import_node_crypto4.sign)(null, Buffer.from(canonicalJson(body), "utf8"), key).toString("base64")
  });
}
function verifyRunnerEvidence(value, request, profile, challengeValue, publicPem, now = Date.now()) {
  canonicalJson(value);
  const envelope = record(value, ["schemaVersion", "algorithm", "payload", "signature"], "receipt");
  if (protocolVersion(envelope.schemaVersion) !== request.schemaVersion) throw new Error("Receipt protocol differs from the expected request.");
  oneOf(envelope.algorithm, ["Ed25519"], "algorithm");
  const key = (0, import_node_crypto4.createPublicKey)(publicPem);
  if (runnerKeyId(key) !== profile.keyId) throw new Error("The public key is not pinned to this runner profile.");
  const encoded = text(envelope.signature, "signature", 88), signature = Buffer.from(encoded, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== encoded || !(0, import_node_crypto4.verify)(null, Buffer.from(canonicalJson(envelope.payload)), key, signature)) throw new Error("Invalid runner signature.");
  const v = record(envelope.payload, [
    "schemaVersion",
    "kind",
    "runnerId",
    "keyId",
    "job",
    "candidate",
    "queryHash",
    "selection",
    "contractHash",
    "expectedHash",
    "observation",
    "isolation",
    "startedAt",
    "finishedAt",
    "expiresAt",
    "scope",
    "fullBslExecution",
    "approvalVerified",
    "canApply",
    ...request.schemaVersion === 2 ? ["parameters", "parametersHash"] : []
  ], "payload");
  const challenge = parseRunnerChallenge(challengeValue), observation = parseEngineObservation(v.observation);
  const expected = payload(request, profile, challenge, observation, parseIsolationEvidence(v.isolation), timestamp(v.startedAt), timestamp(v.finishedAt));
  if (canonicalJson(expected) !== canonicalJson(envelope.payload)) throw new Error("Receipt does not match the expected job/candidate/contract.");
  if (!Number.isSafeInteger(now) || now < 0 || Date.parse(expected.finishedAt) > now) throw new Error("Receipt timestamp is in the future.");
  const expired = now >= Date.parse(expected.expiresAt);
  const assessment = immutable({
    schemaVersion: 1,
    signatureVerified: true,
    status: expired ? "stale" : observation.status,
    queryExecutionVerified: !expired && observation.status === "completed",
    receiptHash: jsonHash(value),
    scope: "selected_query_only",
    sourceFreshness: "must_be_revalidated_by_host",
    fullBslExecution: "not_run",
    executionVerified: false,
    approvalVerified: false,
    canApply: false
  });
  return immutable({ assessment, payload: expected });
}
function verifyRunnerReceipt(...args) {
  return verifyRunnerEvidence(...args).assessment;
}

// src/app/runner/api/executeQueryJob.ts
var import_node_crypto6 = require("node:crypto");

// src/entities/runner/model/preparedJob.ts
function parsePreparedQueryJob(value, profile, now = Date.now()) {
  canonicalJson(value);
  const v = record(value, ["schemaVersion", "operation", "request", "challenge"], "preparedJob");
  schemaV1(v.schemaVersion);
  oneOf(v.operation, ["prepared_query_job"], "operation");
  const request = parseRunnerRequest(v.request), challenge = parseRunnerChallenge(v.challenge);
  assertRunnerChallengeBinding(request, profile, challenge);
  if (!Number.isSafeInteger(now) || now < Date.parse(challenge.createdAt) || now >= Date.parse(challenge.deadlineAt)) {
    throw new Error("Prepared job lease is expired or in the future. Prepare a new job in the IDE.");
  }
  return immutable({ request, challenge });
}

// src/features/run-query/api/dockerQueryRuntime.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto5 = require("node:crypto");
var import_node_util3 = require("node:util");
var KERNEL_PROBE = `import json,os,pathlib
p=pathlib.Path('/sys/fs/cgroup')
s=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
ro=any(line.split()[4]=='/' and 'ro' in line.split()[5].split(',') for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines())
print(json.dumps(dict(uid=os.getuid(),memory=(p/'memory.max').read_text().strip(),swap=(p/'memory.swap.max').read_text().strip(),pids=(p/'pids.max').read_text().strip(),cpu=(p/'cpu.max').read_text().strip(),seccomp=s['Seccomp'].strip(),noNewPrivileges=s['NoNewPrivs'].strip(),capabilities=s['CapEff'].strip(),rootReadOnly=ro,interfaces=sorted(os.listdir('/sys/class/net')))))`;
var runDockerCommand = (args, input, timeoutMs, signal) => new Promise((resolve2, reject) => {
  if (signal?.aborted) {
    reject(new Error("Runner job cancelled."));
    return;
  }
  const child = (0, import_node_child_process.spawn)("docker", [...args], { shell: false, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
  const output = [], errors = [];
  let bytes = 0, errorBytes = 0, failure;
  const stop = (reason) => {
    failure ??= new Error(reason);
    child.kill("SIGKILL");
  };
  const timer = setTimeout(() => stop("Docker command exceeded its deadline."), timeoutMs);
  const cancel = () => stop("Runner job cancelled.");
  signal?.addEventListener("abort", cancel, { once: true });
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) stop("Docker output exceeds 2 MiB.");
    else output.push(chunk);
  });
  child.stderr.on("data", (chunk) => {
    errorBytes += chunk.length;
    if (errorBytes > 32768) stop("Docker diagnostics exceed 32 KiB.");
    else errors.push(chunk);
  });
  child.stdin.on("error", () => {
  });
  const clean = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  };
  child.once("error", (error) => {
    clean();
    reject(error);
  });
  child.once("close", (code) => {
    clean();
    if (failure) reject(failure);
    else if (code !== 0) reject(new Error(`Docker command failed (${code}): ${Buffer.concat(errors).toString("utf8").slice(-1e3)}`));
    else {
      try {
        resolve2(new import_node_util3.TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(output)));
      } catch {
        reject(new Error("Docker returned invalid UTF-8."));
      }
    }
  });
  child.stdin.end(input);
});
var DockerQueryRuntime = class {
  constructor(command = runDockerCommand) {
    this.command = command;
  }
  command;
  async execute(request, profile, challenge, signal) {
    const name = "copilot-query-" + (0, import_node_crypto5.randomUUID)();
    const remaining = () => {
      if (signal?.aborted) throw new Error("Runner job cancelled.");
      const value = Date.parse(challenge.deadlineAt) - Date.now();
      if (value <= 0) throw new Error("Runner job exceeded its lease.");
      return value;
    };
    const call = (args, input) => this.command(args, input, Math.min(3e4, remaining()), signal);
    const info = JSON.parse(await call(["info", "--format", "{{json .}}"]));
    if (info.CgroupVersion !== "2" || !info.MemoryLimit || !info.SwapLimit || !info.CpuCfsQuota || !info.PidsLimit || !info.SecurityOptions?.some((item) => item.startsWith("name=seccomp"))) throw new Error("Required Docker limits/seccomp are unavailable.");
    const owner = "normahub.copilot.nonce";
    let cleanupNeeded = false;
    try {
      cleanupNeeded = true;
      await call([
        "create",
        "--rm",
        "--pull",
        "never",
        "--name",
        name,
        "--label",
        `${owner}=${challenge.nonce}`,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges=true",
        "--pids-limit",
        String(RUNNER_POLICY.pids),
        "--memory",
        String(RUNNER_POLICY.memoryBytes),
        "--memory-swap",
        String(RUNNER_POLICY.memoryBytes),
        "--cpus",
        "1",
        "--user",
        RUNNER_POLICY.user,
        "--ipc",
        "private",
        "--cgroupns",
        "private",
        "--ulimit",
        "nofile=1024:1024",
        "--tmpfs",
        "/work:rw,nosuid,nodev,size=805306368,uid=10001,gid=10001,mode=0700",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=268435456,mode=1777",
        "--env",
        "HOME=/work/home",
        "--env",
        "LANG=ru_RU.UTF-8",
        "--env",
        "LC_ALL=ru_RU.UTF-8",
        "--entrypoint",
        "/usr/bin/timeout",
        profile.imageId,
        "--signal=KILL",
        String(RUNNER_POLICY.containerLifetimeSeconds),
        "/usr/bin/python3",
        "/runner/worker.py",
        "--idle"
      ]);
      const inspection = JSON.parse(await call(["inspect", name]))[0];
      assertContainerPolicy(inspection, profile.imageId, challenge.nonce);
      await call(["start", name]);
      const isolation = parseIsolationEvidence(JSON.parse(await call(["exec", name, "/usr/bin/python3", "-c", KERNEL_PROBE])));
      const response = await this.command(
        ["exec", "-i", name, "/usr/bin/python3", "/runner/worker.py"],
        JSON.stringify({
          schemaVersion: request.schemaVersion,
          nonce: challenge.nonce,
          query: request.query,
          ...request.schemaVersion === 2 ? { parameters: request.parameters, parametersHash: jsonHash(request.parameters) } : {}
        }),
        remaining(),
        signal
      );
      const observation = parseEngineObservation(JSON.parse(response));
      remaining();
      return { engine: observation, isolation };
    } finally {
      if (cleanupNeeded) {
        const raw = await this.command(["container", "ls", "-a", "--filter", `name=^/${name}$`, "--format", "{{json .}}"], void 0, 15e3);
        if (raw.trim()) {
          const inspection = JSON.parse(await this.command(["inspect", name], void 0, 15e3))[0];
          if (inspection.Config?.Labels?.[owner] !== challenge.nonce) throw new Error("Refusing cleanup of a container with a different owner.");
          if (!/^[a-f0-9]{64}$/.test(inspection.Id)) throw new Error("Invalid owned container ID.");
          await this.command(["rm", "--force", inspection.Id], void 0, 15e3);
        }
      }
    }
  }
};
function assertContainerPolicy(value, imageId, nonce) {
  const h = value?.HostConfig, c = value?.Config;
  const allowedEnv = /* @__PURE__ */ new Set(["PATH", "HOME", "LANG", "LC_ALL"]);
  if (!h || !c || value.Image !== imageId || c.Image !== imageId || c.User !== RUNNER_POLICY.user || c.Labels?.["normahub.copilot.nonce"] !== nonce || h.NetworkMode !== "none" || h.ReadonlyRootfs !== true || h.AutoRemove !== true || h.Privileged || h.Memory !== RUNNER_POLICY.memoryBytes || h.MemorySwap !== RUNNER_POLICY.memoryBytes || h.NanoCpus !== RUNNER_POLICY.nanoCpus || h.PidsLimit !== RUNNER_POLICY.pids || !h.CapDrop?.includes("ALL") || h.CapAdd?.length || !h.SecurityOpt?.includes("no-new-privileges=true") || h.SecurityOpt.some((option) => /unconfined/.test(option)) || h.IpcMode !== "private" || h.PidMode || h.CgroupnsMode !== "private" || h.Binds?.length || h.Devices?.length || h.DeviceRequests?.length || Object.keys(h.PortBindings || {}).length || (value.Mounts || []).some((mount) => mount.Type !== "tmpfs") || Object.keys(h.Tmpfs || {}).sort().join(",") !== "/tmp,/work" || h.Tmpfs["/work"] !== "rw,nosuid,nodev,size=805306368,uid=10001,gid=10001,mode=0700" || h.Tmpfs["/tmp"] !== "rw,nosuid,nodev,size=268435456,mode=1777" || JSON.stringify(c.Entrypoint) !== '["/usr/bin/timeout"]' || JSON.stringify(c.Cmd) !== JSON.stringify(["--signal=KILL", String(RUNNER_POLICY.containerLifetimeSeconds), "/usr/bin/python3", "/runner/worker.py", "--idle"]) || (c.Env || []).some((env) => !allowedEnv.has(env.split("=")[0]))) throw new Error("Effective container policy does not match the fixed runner profile.");
}

// src/features/compare-query-results/model/compareResults.ts
function compareQueryResults(expectedValue, actualValue, requestedMode) {
  const mode = oneOf(requestedMode, ["multiset", "ordered"], "comparison mode");
  const expected = parseResultSet(expectedValue), actual = parseResultSet(actualValue);
  const columnsMatch = canonicalJson(expected.columns) === canonicalJson(actual.columns);
  const differences = [];
  let missingRows = 0, unexpectedRows = 0, differenceEntries = 0;
  const add = (entry) => {
    differenceEntries++;
    if (entry.side === "expected") missingRows += entry.count;
    else unexpectedRows += entry.count;
    if (differences.length < 20) differences.push(entry);
  };
  if (columnsMatch && mode === "ordered") {
    for (let index = 0; index < Math.max(expected.rows.length, actual.rows.length); index++) {
      const left = expected.rows[index], right = actual.rows[index];
      if (left !== void 0 && right !== void 0 && canonicalJson(left) === canonicalJson(right)) continue;
      if (left !== void 0) add({ side: "expected", row: left, count: 1, index });
      if (right !== void 0) add({ side: "actual", row: right, count: 1, index });
    }
  } else if (columnsMatch) {
    const entries = /* @__PURE__ */ new Map();
    for (const [side, result] of [["expected", expected], ["actual", actual]]) {
      for (const row of result.rows) {
        const key = canonicalJson(row);
        const entry = entries.get(key) ?? { row, expected: 0, actual: 0 };
        entry[side]++;
        entries.set(key, entry);
      }
    }
    for (const entry of entries.values()) {
      const delta = entry.expected - entry.actual;
      if (delta) add({ side: delta > 0 ? "expected" : "actual", row: entry.row, count: Math.abs(delta) });
    }
  }
  return immutable({
    schemaVersion: 1,
    scope: "provided_data_only",
    status: !columnsMatch ? "schema_mismatch" : differenceEntries ? "different" : "equal",
    mode,
    expectedHash: jsonHash(expected),
    actualHash: jsonHash(actual),
    expectedColumns: expected.columns,
    actualColumns: actual.columns,
    expectedRowCount: expected.rows.length,
    actualRowCount: actual.rows.length,
    missingRows: columnsMatch ? missingRows : null,
    unexpectedRows: columnsMatch ? unexpectedRows : null,
    differences,
    truncated: differenceEntries > differences.length,
    executionVerified: false,
    approvalVerified: false,
    limitations: ["Only the supplied typed values are compared.", "No engine execution, independent oracle approval, metadata qualifiers or performance are established."]
  });
}

// src/app/runner/api/executeQueryJob.ts
async function executeQueryJob(requestValue, profileValue, privatePem, runtime = new DockerQueryRuntime(), signal) {
  const request = parseRunnerRequest(requestValue), profile = parseRunnerProfile(profileValue);
  checkProfile(request, profile);
  return executeKnownJob(request, profile, createRunnerChallenge(request, profile), privatePem, runtime, signal);
}
async function executePreparedQueryJob(jobValue, profileValue, privatePem, runtime = new DockerQueryRuntime(), signal) {
  const profile = parseRunnerProfile(profileValue), prepared = parsePreparedQueryJob(jobValue, profile);
  return executeKnownJob(prepared.request, profile, prepared.challenge, privatePem, runtime, signal);
}
async function executeKnownJob(request, profile, challenge, privatePem, runtime, signal) {
  assertRunnableRequest(request, profile);
  const key = (0, import_node_crypto6.createPrivateKey)(privatePem);
  if (runnerKeyId(key) !== profile.keyId) throw new Error("Signing key is outside the pinned runner profile.");
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const { engine: observation, isolation } = await runtime.execute(request, profile, challenge, signal);
  if (signal?.aborted) throw new Error("Runner job cancelled.");
  const receipt = signRunnerReceipt(request, profile, challenge, observation, isolation, privatePem, startedAt, (/* @__PURE__ */ new Date()).toISOString());
  const publicKey = (await import("node:crypto")).createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const assessment = verifyRunnerReceipt(receipt, request, profile, challenge, publicKey);
  const comparison = observation.actual ? compareQueryResults(request.contract.assertion.expected, observation.actual, request.contract.assertion.mode) : null;
  return immutable({ challenge, receipt, assessment, comparison });
}

// src/entities/runner/model/connection.ts
var import_node_crypto7 = require("node:crypto");
function parseRunnerConnection(value) {
  canonicalJson(value);
  const v = record(value, ["schemaVersion", "profile", "publicKeyPem"], "connection");
  schemaV1(v.schemaVersion);
  const profile = parseRunnerProfile(v.profile), pem2 = text(v.publicKeyPem, "publicKeyPem", 2048).trim();
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem2)) throw new Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 SPKI. \u041F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u0435 \u043A\u043B\u044E\u0447\u0438 \u043D\u0435 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u044E\u0442\u0441\u044F.");
  const key = (0, import_node_crypto7.createPublicKey)(pem2);
  if (runnerKeyId(key) !== profile.keyId) throw new Error("\u041F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043D\u0435 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u043F\u0440\u043E\u0444\u0438\u043B\u044E \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440\u0430.");
  return immutable({ schemaVersion: 1, profile, publicKeyPem: key.export({ type: "spki", format: "pem" }).toString() });
}

// src/runnerCli.ts
var cancellation = new AbortController();
process.once("SIGINT", () => cancellation.abort());
process.once("SIGTERM", () => cancellation.abort());
var guard = () => {
  if (cancellation.signal.aborted) throw new Error("Runner command cancelled.");
};
var failureDirectory;
function options(command, allowed) {
  const result = {};
  for (let i = 3; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1];
    if (!allowed.includes(flag) || result[flag] || !value || value.startsWith("--")) throw new Error(`Invalid ${command} arguments.`);
    result[flag] = value;
  }
  if (allowed.some((flag) => !result[flag])) throw new Error(`Required ${command} flags: ${allowed.join(" ")}`);
  return result;
}
async function pem(filename, privateKey = false) {
  const handle = await fs.open(filename, import_node_fs2.constants.O_RDONLY | (import_node_fs2.constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384 || privateKey && ((stat.mode & 63) !== 0 || process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Require an owned private runner key with mode 0600; key files must be regular and small.");
    }
    const buffer = Buffer.alloc(16385), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16384) throw new Error("Key file exceeds its size limit.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
var load = (filename) => readLocalJson(filename, guard);
var save = (filename, value) => fs.writeFile(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 384 });
async function main() {
  const command = process.argv[2];
  if (command === "init-key") {
    const o = options(command, ["--directory"]), directory = path.resolve(o["--directory"]);
    await fs.mkdir(directory, { mode: 448 });
    const pair = (0, import_node_crypto8.generateKeyPairSync)("ed25519");
    await fs.writeFile(path.join(directory, "private.pem"), pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 384, flag: "wx" });
    await fs.writeFile(path.join(directory, "public.pem"), pair.publicKey.export({ type: "spki", format: "pem" }), { mode: 420, flag: "wx" });
    console.log(JSON.stringify({ ok: true, keyId: runnerKeyId(pair.publicKey), directory }));
  } else if (command === "export-connection") {
    const o = options(command, ["--profile", "--public-key", "--output"]);
    const connection = parseRunnerConnection({ schemaVersion: 1, profile: await load(o["--profile"]), publicKeyPem: await pem(o["--public-key"]) });
    await save(path.resolve(o["--output"]), connection);
    console.log(JSON.stringify({ ok: true, output: path.resolve(o["--output"]), keyId: connection.profile.keyId }));
  } else if (command === "run" || command === "run-prepared") {
    const inputFlag = command === "run" ? "--request" : "--job";
    const o = options(command, [inputFlag, "--profile", "--private-key", "--output"]);
    const request = await load(o[inputFlag]), profile = await load(o["--profile"]), key = await pem(o["--private-key"], true);
    const directory = path.resolve(o["--output"]);
    await fs.mkdir(directory, { mode: 448 });
    failureDirectory = directory;
    const execute = command === "run" ? executeQueryJob : executePreparedQueryJob;
    const result = await execute(request, profile, key, void 0, cancellation.signal);
    await save(path.join(directory, "challenge.json"), result.challenge);
    await save(path.join(directory, "receipt.json"), result.receipt);
    await save(path.join(directory, "assessment.json"), { ...result.assessment, comparison: result.comparison });
    await save(path.join(directory, "result.json"), { schemaVersion: 1, operation: "signed_query_result", jobId: result.challenge.jobId, receipt: result.receipt });
    console.log(JSON.stringify({
      ok: true,
      output: directory,
      queryExecutionVerified: result.assessment.queryExecutionVerified,
      comparison: result.comparison?.status ?? null,
      fullBslExecution: "not_run",
      approvalVerified: false,
      canApply: false
    }));
    if (!result.assessment.queryExecutionVerified || result.comparison?.status !== "equal") process.exitCode = 2;
  } else if (command === "verify") {
    const o = options(command, ["--request", "--profile", "--challenge", "--receipt", "--public-key"]);
    const request = parseRunnerRequest(await load(o["--request"]));
    const receipt = await load(o["--receipt"]);
    const result = verifyRunnerReceipt(
      receipt,
      request,
      parseRunnerProfile(await load(o["--profile"])),
      await load(o["--challenge"]),
      await pem(o["--public-key"])
    );
    const actual = receipt.payload.observation.actual;
    const comparison = actual ? compareQueryResults(request.contract.assertion.expected, actual, request.contract.assertion.mode) : null;
    console.log(JSON.stringify({ ok: true, ...result, comparison }));
    if (!result.queryExecutionVerified || comparison?.status !== "equal") process.exitCode = 2;
  } else if (command === "key-id") {
    const o = options(command, ["--public-key"]);
    console.log(JSON.stringify({ ok: true, keyId: runnerKeyId((0, import_node_crypto8.createPublicKey)(await pem(o["--public-key"]))) }));
  } else throw new Error("Use init-key, key-id, export-connection, run, run-prepared or verify; this is an explicit operator CLI.");
}
main().catch(async (error) => {
  const failure = { ok: false, cancelled: cancellation.signal.aborted, error: error instanceof Error ? error.message : "Runner command failed." };
  if (failureDirectory) await save(path.join(failureDirectory, "failure.json"), failure).catch(() => {
  });
  console.log(JSON.stringify(failure));
  process.exitCode = 1;
});
