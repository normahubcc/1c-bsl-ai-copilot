import { localizeHostMessage, translateText, UiLanguage } from '../../../shared/i18n/translator';
import type { TechLogDiagnosis } from '../../../techLogAnalyzer';

/** Structured local reports are translated; code, raw exception text and identifiers are preserved. */
export function localizePresentation(message: Record<string, any>, language: UiLanguage): Record<string, any> {
    const result = localizeHostMessage(message, language);
    if (language !== 'en' || message.type !== 'techLogResult' || !Array.isArray(message.diagnoses) || !message.diagnoses.length) return result;
    const t = (source: string) => translateText(source, language);
    const lines = ['## 1C technological log analysis', '', `Events recognized: ${message.count}. Findings: **${message.diagnoses.length}**`, ''];
    if (message.truncated) lines.unshift('The log exceeds 500 KB. Only the initial events were analyzed.', '');
    (message.diagnoses as TechLogDiagnosis[]).forEach((diagnosis, index) => {
        const badge = diagnosis.severity === 'critical' ? 'CRITICAL' : diagnosis.severity === 'warning' ? 'WARNING' : 'INFO';
        lines.push(`### ${index + 1}. [${badge}] ${t(diagnosis.title)}`, `- **Category:** ${t(diagnosis.category)}`);
        if (diagnosis.affectedModule) lines.push(`- **Module and line:** ${diagnosis.affectedModule}${diagnosis.affectedLine ? ` (line ${diagnosis.affectedLine})` : ''}`);
        lines.push(`- **Details:** ${diagnosis.category === 'Исключение / Ошибка (EXCP)' ? diagnosis.description : t(diagnosis.description)}`);
        if (diagnosis.metrics.durationSec !== undefined) lines.push(`- **Duration:** ${diagnosis.metrics.durationSec.toFixed(2)} s`);
        if (diagnosis.metrics.regions) lines.push(`- **Lock region:** ${diagnosis.metrics.regions}`);
        lines.push('', '**What to check:**', ...diagnosis.recommendations.map(t), '');
    });
    result.report = lines.join('\n');
    return result;
}
