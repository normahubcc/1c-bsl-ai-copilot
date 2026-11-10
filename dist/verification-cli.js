"use strict";

// src/shared/lib/jsonContract.ts
var import_node_crypto = require("node:crypto");
var import_node_util = require("node:util");
function canonicalJson(value) {
  let nodes = 0;
  let bytes2 = 0;
  const maxBytes = 2 * 1024 * 1024;
  const account = (length) => {
    bytes2 += length;
    if (bytes2 > maxBytes) throw new Error("JSON exceeds 2 MiB.");
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
function record(value, allowed, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected an object.`);
  if (import_node_util.types.isProxy(value)) throw new Error(`${path}: proxies are unsupported.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path}: expected a plain object.`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.includes(key)) throw new Error(`${path}: unsupported property.`);
    if (!("value" in descriptor)) throw new Error(`${path}: accessors are unsupported.`);
  }
  return value;
}
function text(value, path, max = 1024) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /\u0000/.test(value)) throw new Error(`${path}: expected nonempty text (max ${max}).`);
  return value;
}
function identifier(value, path) {
  const result = text(value, path, 160);
  if (!/^[\p{L}\p{N}_.:/@-]+$/u.test(result)) throw new Error(`${path}: invalid identifier.`);
  return result;
}
function hash(value, path) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${path}: expected lowercase SHA-256.`);
  return value;
}
function array(value, path, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${path}: expected an array (max ${max}).`);
  return value;
}
function oneOf(value, choices, path) {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${path}: unsupported value.`);
  return value;
}
function positiveInteger(value, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${path}: expected a positive safe integer.`);
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

// src/entities/business-contract/model/resultSet.ts
var VALUE_TYPES = ["null", "undefined", "boolean", "string", "number", "date", "reference", "empty_reference"];
function decimal(value, path) {
  const source = text(value, path, 258);
  if (!/^-?\d{1,128}(?:\.\d{1,128})?$/.test(source)) throw new Error(`${path}: use a decimal string without exponent.`);
  const negative = source.startsWith("-");
  const [integer, fraction = ""] = (negative ? source.slice(1) : source).split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const tail = fraction.replace(/0+$/, "");
  const result = whole + (tail ? "." + tail : "");
  return negative && result !== "0" ? "-" + result : result;
}
function localDate(value, path) {
  const source = text(value, path, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(source)) throw new Error(`${path}: expected a local 1C date without timezone.`);
  const [year, month, day, hour, minute, second] = source.split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new Error(`${path}: invalid calendar date.`);
  return source;
}
function metadata(value, path) {
  const result = text(value, path, 256);
  if (!/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)+$/u.test(result)) throw new Error(`${path}: expected a qualified metadata name.`);
  return result;
}
function parseValue(value, path) {
  const cell = record(value, ["type", "value", "metadata", "id"], path);
  const type = oneOf(cell.type, VALUE_TYPES, `${path}.type`);
  if (type === "null" || type === "undefined") {
    record(value, ["type"], path);
    return { type };
  }
  if (type === "reference" || type === "empty_reference") {
    record(value, type === "reference" ? ["type", "metadata", "id"] : ["type", "metadata"], path);
    const name = metadata(cell.metadata, `${path}.metadata`);
    if (type === "empty_reference") return { type, metadata: name };
    const id = text(cell.id, `${path}.id`, 36);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || /^0{8}(?:-0{4}){3}-0{12}$/.test(id)) throw new Error(`${path}.id: expected nonempty UUID; use empty_reference explicitly.`);
    return { type, metadata: name, id: id.toLowerCase() };
  }
  record(value, ["type", "value"], path);
  if (type === "boolean") {
    if (typeof cell.value !== "boolean") throw new Error(`${path}.value: expected boolean.`);
    return { type, value: cell.value };
  }
  if (type === "string") {
    if (typeof cell.value !== "string" || cell.value.length > 16384) throw new Error(`${path}.value: expected string (max 16384).`);
    return { type, value: cell.value };
  }
  return { type, value: type === "number" ? decimal(cell.value, `${path}.value`) : localDate(cell.value, `${path}.value`) };
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

// src/entities/business-contract/model/contract.ts
function parseBusinessContract(value) {
  canonicalJson(value);
  const source = record(value, ["schemaVersion", "id", "version", "projectId", "intent", "requirement", "scope", "preconditions", "assumptions", "assertion", "approvalState"], "contract");
  schemaV1(source.schemaVersion);
  const requirement = record(source.requirement, ["reference", "sha256"], "requirement");
  const scope = record(source.scope, ["metadataHash", "profileId", "platformVersion"], "scope");
  const assertion = record(source.assertion, ["kind", "mode", "expected"], "assertion");
  const lines = (value2, path) => array(value2, path, 50).map((line, index) => text(line, `${path}[${index}]`, 2e3));
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

// src/entities/validation/model/evidence.ts
var BINDING_HASH_FIELDS = ["snapshotHash", "candidateHash", "contractHash", "fixtureHash", "profileHash", "policyHash"];
var LEVELS = ["structure", "static", "compile", "behavior", "ui", "performance"];
var STATUSES = ["passed", "failed", "not_run", "unsupported", "cancelled"];
function parseValidationBinding(value) {
  canonicalJson(value);
  const source = record(value, ["schemaVersion", "projectId", ...BINDING_HASH_FIELDS], "binding");
  schemaV1(source.schemaVersion);
  return immutable({
    schemaVersion: 1,
    projectId: identifier(source.projectId, "binding.projectId"),
    snapshotHash: hash(source.snapshotHash, "snapshotHash"),
    candidateHash: hash(source.candidateHash, "candidateHash"),
    contractHash: hash(source.contractHash, "contractHash"),
    fixtureHash: hash(source.fixtureHash, "fixtureHash"),
    profileHash: hash(source.profileHash, "profileHash"),
    policyHash: hash(source.policyHash, "policyHash")
  });
}
function timestamp(value, path) {
  const result = text(value, path, 24), time = Date.parse(result);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) throw new Error(`${path}: expected a valid UTC ISO timestamp with milliseconds.`);
  return result;
}
function parseValidationReport(value) {
  canonicalJson(value);
  const source = record(value, ["schemaVersion", "binding", "startedAt", "finishedAt", "expiresAt", "checks"], "report");
  schemaV1(source.schemaVersion);
  const startedAt = timestamp(source.startedAt, "startedAt"), finishedAt = timestamp(source.finishedAt, "finishedAt"), expiresAt = timestamp(source.expiresAt, "expiresAt");
  if (Date.parse(startedAt) > Date.parse(finishedAt) || Date.parse(finishedAt) > Date.parse(expiresAt)) throw new Error("Report timestamps are out of order.");
  const checks = array(source.checks, "checks", 100).map((value2, index) => {
    const path = `checks[${index}]`;
    const check = record(value2, ["id", "level", "status", "reason", "evidence"], path);
    const status = oneOf(check.status, STATUSES, `${path}.status`);
    const reason = check.reason === void 0 ? void 0 : text(check.reason, `${path}.reason`, 2e3);
    if (status !== "passed" && !reason) throw new Error(`${path}: explain a check that did not pass.`);
    const evidence = array(check.evidence, `${path}.evidence`, 20).map((value3, index2) => {
      const artifact = record(value3, ["artifactId", "sha256"], `${path}.evidence[${index2}]`);
      return { artifactId: identifier(artifact.artifactId, "artifactId"), sha256: hash(artifact.sha256, "artifact.sha256") };
    });
    if ((status === "passed" || status === "failed") && !evidence.length) throw new Error(`${path}: completed checks require evidence references.`);
    return {
      id: identifier(check.id, `${path}.id`),
      level: oneOf(check.level, LEVELS, `${path}.level`),
      status,
      ...reason ? { reason } : {},
      evidence
    };
  });
  if (new Set(checks.map((check) => check.id)).size !== checks.length) throw new Error("Validation check IDs must be unique.");
  return immutable({ schemaVersion: 1, binding: parseValidationBinding(source.binding), startedAt, finishedAt, expiresAt, checks });
}

// src/features/assess-validation/model/assessEvidence.ts
function assessValidationEvidence(reportValue, currentValue, requiredValue, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a valid nonnegative epoch millisecond value.");
  const report = parseValidationReport(reportValue), current = parseValidationBinding(currentValue);
  const required = array(requiredValue, "requiredChecks", 100).map((id, index) => identifier(id, `requiredChecks[${index}]`));
  if (!required.length || new Set(required).size !== required.length) throw new Error("Specify unique nonempty required check IDs.");
  const changedBindings = BINDING_HASH_FIELDS.filter((field) => report.binding[field] !== current[field]);
  const byId = new Map(report.checks.map((check) => [check.id, check]));
  const missingChecks = required.filter((id) => !byId.has(id));
  const uncompletedChecks = required.filter((id) => byId.has(id) && byId.get(id).status !== "passed");
  const failedChecks = report.checks.filter((check) => check.status === "failed").map((check) => check.id);
  const reasons = [];
  let status;
  if (report.binding.projectId !== current.projectId) {
    status = "scope_mismatch";
    reasons.push("project_mismatch");
  } else if (changedBindings.length) {
    status = "stale";
    reasons.push("binding_changed");
  } else if (Date.parse(report.finishedAt) > now) {
    status = "invalid_time";
    reasons.push("report_from_future");
  } else if (Date.parse(report.expiresAt) <= now) {
    status = "stale";
    reasons.push("report_expired");
  } else if (failedChecks.length) {
    status = "failed";
    reasons.push("check_failed");
  } else if (required.some((id) => byId.get(id)?.status === "cancelled")) {
    status = "cancelled";
    reasons.push("required_check_cancelled");
  } else if (missingChecks.length || uncompletedChecks.length) {
    status = "incomplete";
    reasons.push("required_checks_not_passed");
  } else {
    status = "reported_pass";
    reasons.push("caller_report_is_consistent_but_not_authenticated");
  }
  return immutable({
    schemaVersion: 1,
    status,
    reasons,
    reportHash: jsonHash(report),
    currentBindingHash: jsonHash(current),
    changedBindings,
    missingChecks,
    uncompletedChecks,
    failedChecks,
    checks: report.checks,
    scope: "caller_supplied_report",
    executionVerified: false,
    approvalVerified: false,
    canApply: false,
    limitations: [
      "Artifact hashes are references, not proof that those artifacts exist or were produced by a trusted runner.",
      "The current binding must be captured by a trusted adapter; this local API does not read editor or database state.",
      "No server approval, tenant authorization or automatic apply is implemented by this assessment."
    ]
  });
}

// src/app/verification/api/executeVerification.ts
function executeVerification(value) {
  canonicalJson(value);
  const request = record(value, ["schemaVersion", "operation", "contract", "actual", "expected", "mode", "report", "currentBinding", "requiredChecks"], "request");
  schemaV1(request.schemaVersion);
  switch (request.operation) {
    case "validate_contract": {
      record(value, ["schemaVersion", "operation", "contract"], "request");
      const contract = parseBusinessContract(request.contract);
      return {
        schemaVersion: 1,
        operation: request.operation,
        status: "proposal_valid",
        contractHash: jsonHash(contract),
        expectedHash: jsonHash(contract.assertion.expected),
        projectId: contract.projectId,
        approvalState: contract.approvalState,
        approvalVerified: false,
        executionVerified: false,
        limitations: ["Schema validity does not approve the requirement or execute a business check."]
      };
    }
    case "compare_contract_result": {
      record(value, ["schemaVersion", "operation", "contract", "actual"], "request");
      const contract = parseBusinessContract(request.contract);
      return {
        operation: request.operation,
        contractHash: jsonHash(contract),
        projectId: contract.projectId,
        ...compareQueryResults(contract.assertion.expected, request.actual, contract.assertion.mode)
      };
    }
    case "compare_results":
      record(value, ["schemaVersion", "operation", "expected", "actual", "mode"], "request");
      return { operation: request.operation, ...compareQueryResults(request.expected, request.actual, request.mode) };
    case "assess_evidence":
      record(value, ["schemaVersion", "operation", "report", "currentBinding", "requiredChecks"], "request");
      return { operation: request.operation, ...assessValidationEvidence(request.report, request.currentBinding, request.requiredChecks) };
    default:
      throw new Error("Unsupported verification operation.");
  }
}

// src/verificationCli.ts
var import_node_util2 = require("node:util");
var chunks = [];
var bytes = 0;
process.stdin.on("data", (chunk) => {
  bytes += chunk.length;
  if (bytes > 2 * 1024 * 1024) {
    process.stdout.write(JSON.stringify({ error: { code: "REQUEST_TOO_LARGE", message: "Maximum request size is 2 MiB." } }));
    process.exit(1);
  }
  chunks.push(chunk);
});
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(new import_node_util2.TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify({ result: executeVerification(input) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: { code: "INVALID_REQUEST", message: error instanceof SyntaxError ? "Malformed JSON." : error instanceof Error ? error.message : "Verification failed." } }));
    process.exitCode = 1;
  }
});
