/**
 * 1C BSL Vanessa-Automation BDD Generator
 * Generates Russian Gherkin (.feature) files for 1C:Enterprise UI & Integration testing.
 * Local scaffolds and formatting of explicitly supplied steps. No step-library inference.
 */

export interface BDDTableColumn {
    name: string;
    value: string | number;
}

export interface BDDScenarioStep {
    keyword: 'Дано' | 'Когда' | 'Тогда' | 'И' | 'Но';
    action: string;
    table?: BDDTableColumn[][];
}

export interface BDDScenario {
    name: string;
    description?: string;
    steps: BDDScenarioStep[];
}

export interface BDDFeatureOptions {
    featureName: string;
    role?: string;
    objective?: string;
    businessValue?: string;
    contextUser?: string;
    scenarios: BDDScenario[];
}

export class BDDGenerator {
    /**
     * Formats a Gherkin draft; callers must verify steps against their Vanessa library.
     */
    public static generateFeature(options: BDDFeatureOptions): string {
        const lines: string[] = [];
        const singleLine = (value: string) => {
            if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new Error('Имя или действие Gherkin должно занимать одну непустую строку.');
            return value.trim();
        };

        lines.push('# language: ru');
        lines.push('');
        lines.push(`Функционал: ${singleLine(options.featureName)}`);
        if (options.role) {
            lines.push(`  Как ${singleLine(options.role)}`);
        }
        if (options.objective) {
            lines.push(`  Я хочу ${singleLine(options.objective)}`);
        }
        if (options.businessValue) {
            lines.push(`  Чтобы ${singleLine(options.businessValue)}`);
        }
        lines.push('');

        lines.push('# Черновик: свяжите требования с реальными шагами установленной библиотеки Vanessa.');
        if (options.contextUser) lines.push(`# Пользователь: ${options.contextUser.replace(/[\r\n]/g, ' ')}`);
        lines.push('');

        // Сценарии
        for (const scenario of options.scenarios) {
            lines.push(`  Сценарий: ${singleLine(scenario.name)}`);
            if (scenario.description) {
                for (const line of scenario.description.split(/\r?\n/)) lines.push(`    # ${line}`);
            }

            if (!scenario.steps.length) lines.push('    # TODO: добавьте предусловия, действия и проверку ожидаемого результата.');
            for (const step of scenario.steps) {
                if (!['Дано','Когда','Тогда','И','Но'].includes(step.keyword)) throw new Error('Неподдерживаемое ключевое слово шага Gherkin.');
                lines.push(`    ${step.keyword} ${singleLine(step.action)}`);
                if (step.table && step.table.length > 0) {
                    const escapeCell = (v: string | number) => String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '\\n');
                    const headers = step.table[0].map(c => escapeCell(c.name));
                    lines.push(`      | ${headers.join(' | ')} |`);
                    for (const row of step.table) {
                        if (row.length !== headers.length || row.some((c,i) => c.name !== step.table![0][i].name)) throw new Error('Колонки таблицы Gherkin должны совпадать во всех строках.');
                        const vals = row.map(c => escapeCell(c.value));
                        lines.push(`      | ${vals.join(' | ')} |`);
                    }
                }
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /** Local scaffold uses only supplied names. It does not invent UI steps or test data. */
    public static generateDocumentScenario(docName: string, tabularSection = '', registerName = ''): BDDFeatureOptions {
        if (!docName?.trim()) throw new Error('Укажите проверяемый документ или требование.');
        const clean = (v: string) => v.replace(/[\r\n]/g, ' ').trim();
        return {
            featureName: `Проверка ${clean(docName)}`,
            scenarios: [{
                name: `Поведение ${clean(docName)}`,
                description: [tabularSection && `Табличная часть: ${clean(tabularSection)}`, registerName && `Регистр: ${clean(registerName)}`].filter(Boolean).join('\n'),
                steps: []
            }]
        };
    }

    /** Preserve the complete requirement in a draft; AI generation is a separate explicit action. */
    public static parseNaturalLanguageToFeature(prompt: string): string {
        if (!prompt?.trim()) throw new Error('Опишите требование для сценария.');
        return this.generateFeature({
            featureName: 'Проверка требования',
            scenarios: [{ name: 'Ожидаемое поведение', description: prompt.trim(), steps: [] }]
        });
    }
}
