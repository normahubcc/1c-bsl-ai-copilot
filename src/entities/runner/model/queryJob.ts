import { additionalParameterNames, assertParameterBindings, parseQueryParameters } from './parameters';
import { randomBytes, randomUUID } from 'node:crypto';
import { canonicalJson, hash, identifier, immutable, jsonHash, oneOf, record, schemaV1, text } from '../../../shared/lib/jsonContract';
import { sha256Text } from '../../../shared/lib/sha256';
import { parseBusinessContract } from '../../business-contract/model/contract';
import { parseQueryCandidateIdentity } from '../../validation/model/queryComparison';

export const RUNNER_POLICY = immutable({ schemaVersion: 1, kind: 'selected_query_only', user: '10001:10001', network: 'none',
    memoryBytes: 2147483648, nanoCpus: 1000000000, pids: 256, deadlineMs: 120000, receiptTtlMs: 300000,
    readOnlyRoot: true, capabilities: 'drop_all', noNewPrivileges: true, seccomp: 'docker_builtin', cgroupVersion: '2',
    ipc: 'private', cgroupNamespace: 'private', hostMounts: false, imagePull: 'never',
    workTmpfsBytes: 805306368, tempTmpfsBytes: 268435456, candidateMaxChars: 64000, queryMaxChars: 24000,
    resultMaxRows: 2000, resultMaxColumns: 64, containerLifetimeSeconds: 180, autoRemove: true });

export function protocolVersion(value: unknown): 1 | 2 {
    if (value !== 1 && value !== 2) throw new Error('Unsupported runner protocol version.');
    return value;
}

export function parseRunnerProfile(value: unknown) {
    canonicalJson(value);
    const v = record(value, ['schemaVersion', 'kind', 'runnerId', 'keyId', 'projectId', 'profileId', 'imageId', 'fixtureHash', 'metadataHash', 'platformVersion', 'binaryHash'], 'profile');
    const version = protocolVersion(v.schemaVersion);
    const kind = version === 1 ? oneOf(v.kind, ['query_text_fixture_v1'], 'profile.kind') : oneOf(v.kind, ['query_text_fixture_v2'], 'profile.kind');
    const imageId = text(v.imageId, 'imageId', 71);
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Runner requires an immutable local image ID.');
    return immutable({ schemaVersion: version, kind,
        runnerId: identifier(v.runnerId, 'runnerId'), keyId: hash(v.keyId, 'keyId'), projectId: hash(v.projectId, 'projectId'),
        profileId: identifier(v.profileId, 'profileId'), imageId, fixtureHash: hash(v.fixtureHash, 'fixtureHash'),
        metadataHash: hash(v.metadataHash, 'metadataHash'), platformVersion: text(v.platformVersion, 'platformVersion', 64),
        binaryHash: hash(v.binaryHash, 'binaryHash') });
}
export type RunnerProfile = ReturnType<typeof parseRunnerProfile>;

function offset(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid UTF-16 selection offset.');
    return value;
}

/** Decode data only. No BSL evaluation, interpolation or execution of surrounding code. */
export function decodeQueryLiteral(literal: string): string {
    if (!literal.startsWith('"')) throw new Error('Select a complete BSL string literal.');
    let result = '';
    for (let i = 1; i < literal.length; i++) {
        const ch = literal[i];
        if (ch === '"') {
            if (literal[i + 1] === '"') { result += '"'; i++; continue; }
            if (i !== literal.length - 1) throw new Error('Selection contains text outside its BSL literal.');
            return result;
        }
        if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && literal[i + 1] === '\n') i++;
            const continuation = literal.slice(i + 1).match(/^[\t ]*\|/);
            if (!continuation) throw new Error('BSL multiline strings require a continuation marker.');
            result += '\n'; i += continuation[0].length;
        } else result += ch;
    }
    throw new Error('Unterminated BSL string literal.');
}

/** A narrow profile restriction; OS/container isolation is enforced separately. */
export function assertSingleQuery(query: string): void {
    if (!/^(?:\s|\/\/[^\r\n]*(?:\r?\n|$))*(?:ВЫБРАТЬ|SELECT)(?![\p{L}\p{N}_])/iu.test(query)) throw new Error('This profile accepts one SELECT query.');
    let quoted = false;
    for (let i = 0; i < query.length; i++) {
        if (query[i] === '"') {
            if (quoted && query[i + 1] === '"') i++;
            else quoted = !quoted;
        } else if (!quoted && query.slice(i, i + 2) === '//') {
            while (i < query.length && !/[\r\n]/.test(query[i])) i++;
        } else if (!quoted && query[i] === ';') throw new Error('Query batches are unsupported by this profile.');
    }
    if (quoted) throw new Error('Unterminated query string.');
}

export function parseRunnerRequest(value: unknown) {
    canonicalJson(value);
    const version = protocolVersion((value as { schemaVersion?: unknown })?.schemaVersion);
    const v = record(value, ['schemaVersion', 'operation', 'candidate', 'candidateCode', 'selection', 'contract', 'profileId', ...(version === 2 ? ['parameters'] : [])], 'request');
     oneOf(v.operation, ['run_query_fragment'], 'operation');
    const candidate = parseQueryCandidateIdentity(v.candidate), code = text(v.candidateCode, 'candidateCode', RUNNER_POLICY.candidateMaxChars);
    // UTF-8 transport must preserve every selected code unit exactly.
    if (Buffer.from(code, 'utf8').toString('utf8') !== code) throw new Error('Unpaired surrogates are unsupported by the engine transport.');
    if (sha256Text(code) !== candidate.candidateHash) throw new Error('Candidate content does not match its host identity.');
    const s = record(v.selection, ['start', 'end', 'format'], 'selection');
    const start = offset(s.start), end = offset(s.end), format = oneOf(s.format, ['query_text', 'bsl_string_literal'], 'selection.format');
    if (start >= end || end > code.length) throw new Error('Selection is outside the candidate.');
    if (format === 'query_text' && (start !== 0 || end !== code.length)) throw new Error('Plain query mode requires the entire candidate.');
    const query = format === 'query_text' ? code : decodeQueryLiteral(code.slice(start, end));
    if (!query.trim() || query.length > RUNNER_POLICY.queryMaxChars) throw new Error('Query exceeds the 24000 character profile limit.');
    assertSingleQuery(query);
    const contract = parseBusinessContract(v.contract);
    if (contract.projectId !== candidate.scopeHash) throw new Error('Contract and candidate project differ.');
    const parameters = version === 2 ? parseQueryParameters(v.parameters) : undefined;
    if (parameters) assertParameterBindings(query, parameters);
    return immutable({ schemaVersion: version, operation: 'run_query_fragment' as const,
        ...(parameters ? { parameters } : {}), candidate, candidateCode: code,
        selection: { start, end, format }, contract, profileId: identifier(v.profileId, 'profileId'), query, queryHash: sha256Text(query) });
}
export type RunnerRequest = ReturnType<typeof parseRunnerRequest>;

export function checkProfile(request: RunnerRequest, profile: RunnerProfile): void {
    if (request.schemaVersion !== profile.schemaVersion) throw new Error('Request and operator profile protocol versions differ.');
    const scope = request.contract.scope;
    if (request.candidate.scopeHash !== profile.projectId || request.profileId !== profile.profileId ||
        scope.profileId !== profile.profileId || scope.metadataHash !== profile.metadataHash || scope.platformVersion !== profile.platformVersion) {
        throw new Error('Request is outside the operator-pinned project/profile/metadata scope.');
    }
}

/** New execution preflight only. Historical v1 failed receipts remain verifiable. */
export function assertRunnableRequest(request: RunnerRequest, profile: RunnerProfile): void {
    checkProfile(request, profile);
    if (profile.schemaVersion === 1 && additionalParameterNames(request.query).length) {
        throw new Error('Профиль v1 задаёт только Дата и Ссылка. Для дополнительных параметров подключите профиль v2.');
    }
    if (profile.schemaVersion === 2) assertParameterBindings(request.query, request.parameters ?? []);
}

export interface RunnerChallenge {
    readonly schemaVersion: 1; readonly jobId: string; readonly nonce: string;
    readonly requestHash: string; readonly profileHash: string; readonly policyHash: string;
    readonly createdAt: string; readonly deadlineAt: string;
}
export function createRunnerChallenge(request: RunnerRequest, profile: RunnerProfile, now = Date.now()): RunnerChallenge {
    assertRunnableRequest(request, profile);
    return immutable({ schemaVersion: 1 as const, jobId: randomUUID(), nonce: randomBytes(32).toString('hex'),
        requestHash: jsonHash(request), profileHash: jsonHash(profile), policyHash: jsonHash(RUNNER_POLICY),
        createdAt: new Date(now).toISOString(), deadlineAt: new Date(now + RUNNER_POLICY.deadlineMs).toISOString() });
}
