import { array, identifier, immutable, jsonHash } from '../../../shared/lib/jsonContract';
import { BINDING_HASH_FIELDS, parseValidationBinding, parseValidationReport } from '../../../entities/validation/model/evidence';

/** Checks report consistency/freshness only. Caller-supplied evidence is never promoted to authenticated execution. */
export function assessValidationEvidence(reportValue: unknown, currentValue: unknown, requiredValue: unknown, now = Date.now()) {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('now must be a valid nonnegative epoch millisecond value.');
    const report = parseValidationReport(reportValue), current = parseValidationBinding(currentValue);
    const required = array(requiredValue, 'requiredChecks', 100).map((id, index) => identifier(id, `requiredChecks[${index}]`));
    if (!required.length || new Set(required).size !== required.length) throw new Error('Specify unique nonempty required check IDs.');
    const changedBindings = BINDING_HASH_FIELDS.filter(field => report.binding[field] !== current[field]);
    const byId = new Map(report.checks.map(check => [check.id, check]));
    const missingChecks = required.filter(id => !byId.has(id));
    const uncompletedChecks = required.filter(id => byId.has(id) && byId.get(id)!.status !== 'passed');
    const failedChecks = report.checks.filter(check => check.status === 'failed').map(check => check.id);
    const reasons: string[] = [];
    let status: 'scope_mismatch' | 'stale' | 'invalid_time' | 'failed' | 'cancelled' | 'incomplete' | 'reported_pass';
    if (report.binding.projectId !== current.projectId) { status = 'scope_mismatch'; reasons.push('project_mismatch'); }
    else if (changedBindings.length) { status = 'stale'; reasons.push('binding_changed'); }
    else if (Date.parse(report.finishedAt) > now) { status = 'invalid_time'; reasons.push('report_from_future'); }
    else if (Date.parse(report.expiresAt) <= now) { status = 'stale'; reasons.push('report_expired'); }
    else if (failedChecks.length) { status = 'failed'; reasons.push('check_failed'); }
    else if (required.some(id => byId.get(id)?.status === 'cancelled')) { status = 'cancelled'; reasons.push('required_check_cancelled'); }
    else if (missingChecks.length || uncompletedChecks.length) { status = 'incomplete'; reasons.push('required_checks_not_passed'); }
    else { status = 'reported_pass'; reasons.push('caller_report_is_consistent_but_not_authenticated'); }
    return immutable({ schemaVersion: 1 as const, status, reasons, reportHash: jsonHash(report), currentBindingHash: jsonHash(current),
        changedBindings, missingChecks, uncompletedChecks, failedChecks,
        checks: report.checks, scope: 'caller_supplied_report' as const, executionVerified: false as const,
        approvalVerified: false as const, canApply: false as const,
        limitations: ['Artifact hashes are references, not proof that those artifacts exist or were produced by a trusted runner.',
            'The current binding must be captured by a trusted adapter; this local API does not read editor or database state.',
            'No server approval, tenant authorization or automatic apply is implemented by this assessment.'] });
}
