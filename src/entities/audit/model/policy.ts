import { BSLToken, BSLTokenType } from '../../../bslTokenizer';
import { StandardIssue } from '../../../types';

export interface AuditOptions { disabledRules?: readonly string[]; }

/** Explicit rule suppression; directives in string literals are never interpreted. */
export function applyAuditPolicy(issues: StandardIssue[], tokens: BSLToken[], options: AuditOptions): StandardIssue[] {
    const directives = tokens.filter(t => t.type === BSLTokenType.COMMENT).flatMap(token => {
        const match = token.value.match(/^\/\/\s*normahub-(disable-next-line|disable|enable)\s+([A-Z0-9,-]+(?:\s*,\s*[A-Z0-9-]+)*)/i);
        return match ? [{line:token.line,action:match[1].toLowerCase(),rules:match[2].toUpperCase().split(/\s*,\s*/)}] : [];
    });
    const disabled = new Set(options.disabledRules || []);
    return issues.filter(issue => {
        if (disabled.has(issue.rule)) return false;
        let suppressed = false;
        for (const directive of directives) {
            if (!directive.rules.includes(issue.rule)) continue;
            if (directive.action === 'disable-next-line' && directive.line + 1 === issue.line) return false;
            if (directive.action !== 'disable-next-line' && directive.line <= issue.line) suppressed = directive.action === 'disable';
        }
        return !suppressed;
    });
}
