/**
 * 1C BSL Vanessa-Automation BDD Generator
 * Generates Russian Gherkin (.feature) files for 1C:Enterprise UI & Integration testing.
 * Compliant with Vanessa-Automation and TurboConf step libraries.
 */

export interface BDDTableColumn {
    name: string;
    value: string | number;
}

export interface BDDScenarioStep {
    keyword: 'Дано' | 'Когда' | 'Тогда' | 'И';
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
     * Generates a complete .feature file compliant with Vanessa-Automation.
     */
    public static generateFeature(options: BDDFeatureOptions): string {
        const lines: string[] = [];

        lines.push('# language: ru');
        lines.push('');
        lines.push(`Функционал: ${options.featureName}`);
        if (options.role) {
            lines.push(`  Как ${options.role}`);
        }
        if (options.objective) {
            lines.push(`  Я хочу ${options.objective}`);
        }
        if (options.businessValue) {
            lines.push(`  Чтобы ${options.businessValue}`);
        }
        lines.push('');

        // Контекст (предусловия)
        lines.push('Контекст:');
        const user = options.contextUser || 'Администратор';
        lines.push(`  Дано Я открыл сеанс пользователя "${user}"`);
        lines.push('  И Я открыл навигационную панель');
        lines.push('');

        // Сценарии
        for (const scenario of options.scenarios) {
            lines.push(`  Сценарий: ${scenario.name}`);
            if (scenario.description) {
                lines.push(`    # ${scenario.description}`);
            }

            for (const step of scenario.steps) {
                lines.push(`    ${step.keyword} ${step.action}`);
                if (step.table && step.table.length > 0) {
                    const headers = step.table[0].map(c => `'${c.name}'`);
                    lines.push(`      | ${headers.join(' | ')} |`);
                    for (const row of step.table) {
                        const vals = row.map(c => `'${c.value}'`);
                        lines.push(`      | ${vals.join(' | ')} |`);
                    }
                }
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Generates standard document posting BDD scenario
     */
    public static generateDocumentScenario(
        docName: string,
        tabularSection = 'Товары',
        registerName = 'ТоварыНаСкладах'
    ): BDDFeatureOptions {
        return {
            featureName: `Проведение и валидация документа "${docName}"`,
            role: 'Менеджер по продажам / Кладовщик',
            objective: `быстро создавать и проводить документ "${docName}" с проверкой остатков`,
            businessValue: 'исключить отрицательные остатки на складах и гарантировать целостность данных',
            contextUser: 'Администратор',
            scenarios: [
                {
                    name: `Успешное создание и проведение документа "${docName}"`,
                    steps: [
                        {
                            keyword: 'Когда',
                            action: `в командном интерфейсе я выбираю "Основное" -> "${docName}"`
                        },
                        {
                            keyword: 'Тогда',
                            action: `открылось окно "${docName}"`
                        },
                        {
                            keyword: 'И',
                            action: 'я нажимаю кнопку "Создать"'
                        },
                        {
                            keyword: 'Тогда',
                            action: `открылось окно "${docName} (создание)"`
                        },
                        {
                            keyword: 'И',
                            action: 'я заполняю реквизит "Организация" значением "Основная организация"'
                        },
                        {
                            keyword: 'И',
                            action: 'я заполняю реквизит "Склад" значением "Основной склад"'
                        },
                        {
                            keyword: 'И',
                            action: `в табличной части "${tabularSection}" я нажимаю кнопку "Добавить"`
                        },
                        {
                            keyword: 'И',
                            action: `в табличной части "${tabularSection}" я заполняю текущую строку:`,
                            table: [
                                [
                                    { name: 'Номенклатура', value: 'Тестовый товар А' },
                                    { name: 'Количество', value: 5 },
                                    { name: 'Цена', value: 1200 }
                                ]
                            ]
                        },
                        {
                            keyword: 'И',
                            action: 'я нажимаю кнопку "Провести и закрыть"'
                        },
                        {
                            keyword: 'Тогда',
                            action: `открылось окно "${docName}"`
                        },
                        {
                            keyword: 'И',
                            action: `я проверяю движения документа по регистру "${registerName}"`
                        }
                    ]
                },
                {
                    name: `Контроль превышения остатка при проведении "${docName}"`,
                    steps: [
                        {
                            keyword: 'Когда',
                            action: `в командном интерфейсе я выбираю "Основное" -> "${docName}"`
                        },
                        {
                            keyword: 'И',
                            action: 'я нажимаю кнопку "Создать"'
                        },
                        {
                            keyword: 'И',
                            action: `в табличной части "${tabularSection}" я заполняю текущую строку:`,
                            table: [
                                [
                                    { name: 'Номенклатура', value: 'Тестовый товар Недостача' },
                                    { name: 'Количество', value: 999999 }
                                ]
                            ]
                        },
                        {
                            keyword: 'И',
                            action: 'я нажимаю кнопку "Провести"'
                        },
                        {
                            keyword: 'Тогда',
                            action: 'я жду появления сообщения об ошибке "Недостаточно товара на складе"'
                        }
                    ]
                }
            ]
        };
    }

    /**
     * Parses freeform natural language intent into a structured BDD feature
     */
    public static parseNaturalLanguageToFeature(prompt: string): string {
        const trimmed = prompt.trim();
        let targetName = '';

        // 1. Quoted identifier: "ЗаказПокупателя" or «Реализация»
        const quotedMatch = trimmed.match(/["«']([а-яА-ЯёЁa-zA-Z0-9_]+)["»']/);
        if (quotedMatch) {
            targetName = quotedMatch[1];
        }

        // 2. Keyword followed by identifier: документа ЗаказПокупателя
        if (!targetName) {
            const keywordMatch = trimmed.match(/(?:документ[а-яё]*|справочник[а-яё]*|регистр[а-яё]*)\s+([а-яА-ЯёЁa-zA-Z0-9_]+)/i);
            if (keywordMatch) {
                targetName = keywordMatch[1];
            }
        }

        // 3. Fallback: CamelCase 1C identifier
        if (!targetName) {
            const words = trimmed.split(/\s+/);
            const camelWord = words.find(w => /^[А-ЯЁ][а-яё]+[А-ЯЁ][а-яёА-ЯЁ0-9_]*/.test(w));
            if (camelWord) {
                targetName = camelWord.replace(/[^А-ЯЁа-яё0-9_]/g, '');
            }
        }

        if (!targetName) {
            targetName = 'РеализацияТоваровУслуг';
        }

        const featureOptions = this.generateDocumentScenario(targetName);
        return this.generateFeature(featureOptions);
    }
}
