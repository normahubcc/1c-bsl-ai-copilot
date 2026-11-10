import { canonicalJson, jsonHash, record, schemaV1 } from '../../../shared/lib/jsonContract';
import { parseBusinessContract } from '../../../entities/business-contract/model/contract';
import { compareQueryResults } from '../../../features/compare-query-results/model/compareResults';
import { assessValidationEvidence } from '../../../features/assess-validation/model/assessEvidence';

/** No vscode, filesystem, network, model call or untrusted code execution. */
export function executeVerification(value: unknown): unknown {
    canonicalJson(value);
    const request = record(value, ['schemaVersion', 'operation', 'contract', 'actual', 'expected', 'mode', 'report', 'currentBinding', 'requiredChecks'], 'request');
    schemaV1(request.schemaVersion);
    switch (request.operation) {
        case 'validate_contract': {
            record(value, ['schemaVersion', 'operation', 'contract'], 'request');
            const contract = parseBusinessContract(request.contract);
            return { schemaVersion: 1, operation: request.operation, status: 'proposal_valid', contractHash: jsonHash(contract),
                expectedHash: jsonHash(contract.assertion.expected), projectId: contract.projectId,
                approvalState: contract.approvalState, approvalVerified: false, executionVerified: false,
                limitations: ['Schema validity does not approve the requirement or execute a business check.'] };
        }
        case 'compare_contract_result': {
            record(value, ['schemaVersion', 'operation', 'contract', 'actual'], 'request');
            const contract = parseBusinessContract(request.contract);
            return { operation: request.operation, contractHash: jsonHash(contract), projectId: contract.projectId,
                ...compareQueryResults(contract.assertion.expected, request.actual, contract.assertion.mode) };
        }
        case 'compare_results':
            record(value, ['schemaVersion', 'operation', 'expected', 'actual', 'mode'], 'request');
            return { operation: request.operation, ...compareQueryResults(request.expected, request.actual, request.mode) };
        case 'assess_evidence':
            record(value, ['schemaVersion', 'operation', 'report', 'currentBinding', 'requiredChecks'], 'request');
            return { operation: request.operation, ...assessValidationEvidence(request.report, request.currentBinding, request.requiredChecks) };
        default: throw new Error('Unsupported verification operation.');
    }
}
