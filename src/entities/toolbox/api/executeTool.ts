import { StandardsChecker } from '../../../standardsChecker';
import { QueryBuilder } from '../../../queryBuilder';
import { ExtensionGenerator, ExtensionDirective } from '../../../extensionGenerator';
import { BDDGenerator } from '../../../bddGenerator';
import { parseVanessaSteps } from '../../bdd/model/steps';
import { BSPHelper } from '../../../bspHelper';
import { MetadataScanner } from '../../../metadataScanner';
import { TechLogAnalyzer } from '../../../techLogAnalyzer';

/** Shared by MCP and the Python Sidecar bridge. No IDE or cloud dependency. */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments должен быть объектом.');
    const text = (key: string, required = true): string => {
        const value = args[key];
        if (value === undefined && !required) return '';
        if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`Укажите ${key}.`);
        if (value.length > 500000) throw new Error(`${key}: максимум 500000 символов.`);
        return value;
    };
    const strings = (key: string, required = false): string[] => {
        const value = args[key];
        if (value === undefined && !required) return [];
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string') || value.length > 100) throw new Error(`${key} должен быть массивом строк (до 100).`);
        return value;
    };
    const boolean = (key: string, fallback: boolean): boolean => {
        const value = args[key];
        if (value === undefined) return fallback;
        if (typeof value !== 'boolean') throw new Error(`${key} должен быть логическим значением.`);
        return value;
    };
    switch (name) {
        case '1c_audit_standards': {
            const issues = StandardsChecker.auditCode(text('code'), {disabledRules:strings('disabledRules')});
            return { issuesCount: issues.length, issues, report: StandardsChecker.formatAuditReport(issues) };
        }
        case '1c_build_batch_query': {
            const root = text('workspacePath', false);
            if (root) MetadataScanner.clearCache(root);
            const metadata = root ? await MetadataScanner.scanWorkspace(root) : undefined;
            return { queryCode: QueryBuilder.generateBatchQuery({ entityName: text('entityName'), tabularSection: text('tabularSection'), registerName: text('registerName'), fields: strings('fields', true), registerType: (text('registerType', false) || 'Остатки') as 'Остатки', includeScaffolding: boolean('includeScaffolding', true), sourceMode:(text('sourceMode', false) || 'document') as 'document' | 'table', metadata }) };
        }
        case '1c_inspect_query': return QueryBuilder.inspectQuery(text('queryText'));
        case '1c_refactor_query': return QueryBuilder.refactorQuery(text('rawQuery'));
        case '1c_generate_extension':
            return { code: ExtensionGenerator.generateInterceptor({ targetMethod: text('targetMethod'), directive: text('directive') as ExtensionDirective, moduleType: (text('moduleType', false) || 'МодульОбъекта') as 'МодульОбъекта', isFunction: boolean('isFunction', false), parameters: strings('parameters'), customLogic: text('customLogic', false) || undefined }) };
        case '1c_bsp_search': {
            const query = text('query', false).toLowerCase();
            return { results: BSPHelper.STANDARD_MODULES.filter(m => `${m.module} ${m.method} ${m.description}`.toLowerCase().includes(query)) };
        }
        case '1c_scan_metadata': {
            const root = text('workspacePath');
            MetadataScanner.clearCache(root);
            const metadata = await MetadataScanner.scanWorkspace(root);
            return { configName: metadata.name, version: metadata.version, objectsCount: metadata.objects.length, objects: metadata.objects, isDemoFallback: false, summary: MetadataScanner.formatForPrompt(metadata) };
        }
        case '1c_generate_bdd_feature': {
            const entity = text('entityName', false), prompt = text('prompt', false);
            const spec = BDDGenerator.generateDocumentScenario(entity || prompt, text('tabularSection', false), text('registerName', false));
            if (prompt) spec.scenarios[0].description = [spec.scenarios[0].description, prompt].filter(Boolean).join('\n');
            spec.scenarios[0].steps = parseVanessaSteps(text('stepsText', false));
            const stepCount = spec.scenarios[0].steps.length;
            return { feature: BDDGenerator.generateFeature(spec), draft: true, stepCount, executionVerified:false, status:stepCount ? 'steps-unverified' : 'requirements-only' };
        }
        case '1c_analyze_tech_log': {
            const events = TechLogAnalyzer.parseLog(text('rawLog'));
            const diagnoses = TechLogAnalyzer.diagnose(events);
            return { eventsFound: events.length, diagnosesCount: diagnoses.length, diagnoses, report: TechLogAnalyzer.formatReport(diagnoses, events.length) };
        }
        default: throw new Error(`Неизвестный инструмент: ${name}`);
    }
}
