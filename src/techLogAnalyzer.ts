/**
 * 1C Technological Log (ТЖ - Технологический Журнал) Analyzer
 * Parses 1C:Enterprise server tech log events (TLOCK, TDEADLOCK, EXCP, SDBL, DBPOSTGR, DBMSSQL)
 * and produces Senior-grade root-cause diagnosis and code-level architectural fixes.
 */

export interface TechLogEvent {
    timestamp: string;
    durationMicrosec: number;
    durationSec: number;
    event: 'TLOCK' | 'TDEADLOCK' | 'EXCP' | 'SDBL' | 'DBPOSTGR' | 'DBMSSQL' | 'OTHER';
    level: number;
    process?: string;
    processName?: string;
    clientId?: string;
    context?: string;
    contextLocation?: {
        module: string;
        line: number;
        codeSnippet?: string;
    };
    properties: Record<string, string>;
    rawText: string;
}

export interface TechLogDiagnosis {
    severity: 'critical' | 'warning' | 'info';
    category: 'Транзакционные блокировки (TLOCK)' | 'Взаимные блокировки (TDEADLOCK)' | 'Исключение / Ошибка (EXCP)' | 'Медленный запрос к СУБД' | 'Общий анализ';
    title: string;
    description: string;
    affectedModule?: string;
    affectedLine?: number;
    metrics: {
        durationSec?: number;
        waitConnections?: string;
        regions?: string;
        sqlSnippet?: string;
    };
    recommendations: string[];
}

export class TechLogAnalyzer {
    /**
     * Parses raw 1C Tech Log text into structured event list
     */
    public static parseLog(rawLog: string): TechLogEvent[] {
        const events: TechLogEvent[] = [];
        const lines = rawLog.split('\n');
        let currentEventText = '';

        for (const line of lines) {
            // 1C Tech log event starts with MM:SS.microsec-duration,EVENT,Level
            if (/^\d{2}:\d{2}\.\d{4,6}-\d+,\w+,\d+/.test(line.trim())) {
                if (currentEventText) {
                    const parsed = this.parseSingleEvent(currentEventText);
                    if (parsed) events.push(parsed);
                }
                currentEventText = line.trim();
            } else if (currentEventText) {
                // Continuation of multiline event (e.g. Context or SQL query)
                currentEventText += '\n' + line;
            }
        }

        if (currentEventText) {
            const parsed = this.parseSingleEvent(currentEventText);
            if (parsed) events.push(parsed);
        }

        return events;
    }

    private static parseSingleEvent(eventText: string): TechLogEvent | null {
        const headerMatch = eventText.match(/^(\d{2}:\d{2}\.\d{4,6})-(\d+),(\w+),(\d+),(.*)/s);
        if (!headerMatch) return null;

        const timestamp = headerMatch[1];
        const durationMicrosec = parseInt(headerMatch[2], 10);
        const durationSec = durationMicrosec / 1000000;
        const rawEvent = headerMatch[3].toUpperCase();
        const level = parseInt(headerMatch[4], 10);
        const payload = headerMatch[5] || '';

        const eventType = (['TLOCK', 'TDEADLOCK', 'EXCP', 'SDBL', 'DBPOSTGR', 'DBMSSQL'].includes(rawEvent)
            ? rawEvent
            : 'OTHER') as TechLogEvent['event'];

        // Parse key-value properties: key=value or key='value'
        const properties: Record<string, string> = {};
        const propRegex = /([a-zA-Z0-9_:]+)=(?:'([^']*)'|([^,]*))(?:,|$)/gs;
        let match;
        while ((match = propRegex.exec(payload)) !== null) {
            const key = match[1];
            const val = match[2] !== undefined ? match[2] : match[3];
            if (key) {
                properties[key] = val ? val.trim() : '';
            }
        }

        const context = properties['Context'] || properties['context'] || '';
        let contextLocation: TechLogEvent['contextLocation'] | undefined;

        if (context) {
            // Context format: "Документ.РеализацияТоваровУслуг.МодульОбъекта : 142 : Движения.Записать()"
            const ctxParts = context.split(':').map(s => s.trim());
            if (ctxParts.length >= 2) {
                const lineNum = parseInt(ctxParts[1], 10);
                contextLocation = {
                    module: ctxParts[0],
                    line: isNaN(lineNum) ? 0 : lineNum,
                    codeSnippet: ctxParts.slice(2).join(':').trim()
                };
            }
        }

        return {
            timestamp,
            durationMicrosec,
            durationSec,
            event: eventType,
            level,
            process: properties['process'],
            processName: properties['p:processName'] || properties['processName'],
            clientId: properties['t:clientID'] || properties['clientID'],
            context,
            contextLocation,
            properties,
            rawText: eventText
        };
    }

    /**
     * Diagnoses events and provides architectural and code-level fixes
     */
    public static diagnose(events: TechLogEvent[]): TechLogDiagnosis[] {
        const diagnoses: TechLogDiagnosis[] = [];

        for (const ev of events) {
            switch (ev.event) {
                case 'TLOCK': {
                    const regions = ev.properties['Regions'] || ev.properties['regions'] || 'Не указаны';
                    const waitConns = ev.properties['WaitConnections'] || ev.properties['waitConnections'] || '';
                    const durationSec = ev.durationSec;
                    const isLongWait = durationSec >= 5;

                    diagnoses.push({
                        severity: isLongWait ? 'critical' : 'warning',
                        category: 'Транзакционные блокировки (TLOCK)',
                        title: `Ожидание на управляемой блокировке: ${durationSec.toFixed(2)} сек.`,
                        description: `Сеанс ожидал освобождения блокировки по пространству "${regions}". Конфликт с соединением: ${waitConns || 'не определено'}.`,
                        affectedModule: ev.contextLocation?.module,
                        affectedLine: ev.contextLocation?.line,
                        metrics: {
                            durationSec,
                            waitConnections: waitConns,
                            regions
                        },
                        recommendations: [
                            '1. Уменьшите время активной транзакции: вынесите тяжелые вычисления и чтение за пределы транзакции.',
                            '2. Используйте явные управляемые блокировки (БлокировкаДанных) с максимальной детализацией по измерениям регистра (Организация, Склад, Номенклатура).',
                            '3. Проверьте разделение итогов регистра накопления (Свойства регистра -> Использовать разделение итогов).'
                        ]
                    });
                    break;
                }

                case 'TDEADLOCK': {
                    const deadlocks = ev.properties['DeadlockConnectionList'] || '';
                    diagnoses.push({
                        severity: 'critical',
                        category: 'Взаимные блокировки (TDEADLOCK)',
                        title: 'Обнаружен DEADLOCK (Взаимная блокировка сеансов)',
                        description: `Взаимная блокировка между транзакциями: ${deadlocks}. Платформа принудительно прервала одну из транзакций.`,
                        affectedModule: ev.contextLocation?.module,
                        affectedLine: ev.contextLocation?.line,
                        metrics: {
                            waitConnections: deadlocks
                        },
                        recommendations: [
                            '1. Соблюдайте строго единый порядок захвата таблиц во всех документах конфигурации (например: сначала Справочник -> затем Регистр1 -> затем Регистр2).',
                            '2. Захватывайте строки в упорядоченном виде (Сортировать по Номенклатура.Ссылка перед блокировкой).',
                            '3. Не допускайте эскалации блокировок СУБД (MS SQL / PostgreSQL) из-за отсутствия индексов.'
                        ]
                    });
                    break;
                }

                case 'EXCP': {
                    const descr = ev.properties['Descr'] || ev.properties['descr'] || 'Необработанное исключение';
                    diagnoses.push({
                        severity: 'critical',
                        category: 'Исключение / Ошибка (EXCP)',
                        title: 'Необработанное системное исключение платформы 1С',
                        description: descr,
                        affectedModule: ev.contextLocation?.module,
                        affectedLine: ev.contextLocation?.line,
                        metrics: {},
                        recommendations: [
                            '1. Локализуйте точку сбоя по стеку вызова Context.',
                            '2. Добавьте защитный блок Попытка ... Исключение с логированием в ЖурналРегистрации.',
                            '3. Проверьте валидность типов и отсутствие мутабельных значений при передаче клиент-сервер.'
                        ]
                    });
                    break;
                }

                case 'SDBL':
                case 'DBPOSTGR':
                case 'DBMSSQL': {
                    const durationSec = ev.durationSec;
                    const sql = ev.properties['Sql'] || ev.properties['sql'] || '';
                    const isVerySlow = durationSec >= 3;

                    diagnoses.push({
                        severity: isVerySlow ? 'critical' : 'warning',
                        category: 'Медленный запрос к СУБД',
                        title: `Медленный SQL-запрос (${ev.event}): ${durationSec.toFixed(2)} сек.`,
                        description: `Запрос выполнялся ${durationSec.toFixed(2)} с на уровне базы данных. Возможен Scan таблицы вместо Index Seek.`,
                        affectedModule: ev.contextLocation?.module,
                        affectedLine: ev.contextLocation?.line,
                        metrics: {
                            durationSec,
                            sqlSnippet: sql.substring(0, 150) + (sql.length > 150 ? '...' : '')
                        },
                        recommendations: [
                            '1. Проверьте план выполнения запроса (EXPLAIN ANALYZE для PostgreSQL / Showplan для MS SQL).',
                            '2. Исключите соединения с виртуальными таблицами (используйте временные таблицы с ИНДЕКСИРОВАТЬ ПО).',
                            '3. Проверьте условия WHERE на саргабельность: избегайте функций над индексированными колонками (ПОДСТРОКА, НАЧАЛОПЕРИОДА).'
                        ]
                    });
                    break;
                }

                default:
                    break;
            }
        }

        return diagnoses;
    }

    /**
     * Formats diagnostic results into a readable markdown report
     */
    public static formatReport(diagnoses: TechLogDiagnosis[]): string {
        if (diagnoses.length === 0) {
            return '✅ Событий с критическими блокировками или ошибками в переданном логе не обнаружено.';
        }

        const lines: string[] = [];
        lines.push(`## 📊 Отчет диагностики Технологического Журнала 1С (ТЖ)\n`);
        lines.push(`Обнаружено инцидентов: **${diagnoses.length}**\n`);

        diagnoses.forEach((d, idx) => {
            const badge = d.severity === 'critical' ? '🔴 [КРИТИЧНО]' : d.severity === 'warning' ? '🟡 [ВНИМАНИЕ]' : 'ℹ️ [ИНФО]';
            lines.push(`### ${idx + 1}. ${badge} ${d.title}`);
            lines.push(`- **Категория:** ${d.category}`);
            if (d.affectedModule) {
                lines.push(`- **Модуль и строка:** \`${d.affectedModule}\` ${d.affectedLine ? `(стр. ${d.affectedLine})` : ''}`);
            }
            lines.push(`- **Суть проблемы:** ${d.description}`);

            if (d.metrics.durationSec !== undefined) {
                lines.push(`- **Длительность:** \`${d.metrics.durationSec.toFixed(2)} сек.\``);
            }
            if (d.metrics.regions) {
                lines.push(`- **Область блокировки:** \`${d.metrics.regions}\``);
            }

            lines.push(`\n**💡 Рекомендации эксперта по High-Load 1С:**`);
            for (const rec of d.recommendations) {
                lines.push(`  ${rec}`);
            }
            lines.push('');
        });

        return lines.join('\n');
    }
}
