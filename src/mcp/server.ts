/**
 * 1C:Enterprise Model Context Protocol (MCP) Server.
 * 
 * Exposes 1C architecture intelligence (Metadata, ITS Standards, BSP, Query Builder, Extension Generator)
 * to any MCP-compliant AI client (Cursor, Windsurf, Claude Code, Cline, AGY).
 * 
 * Transport: JSON-RPC 2.0 over STDIO.
 */

import * as readline from 'readline';
import { StandardsChecker } from '../standardsChecker';
import { BSPHelper } from '../bspHelper';
import { QueryBuilder } from '../queryBuilder';
import { ExtensionGenerator, ExtensionDirective } from '../extensionGenerator';
import { MetadataScanner } from '../metadataScanner';
import { BDDGenerator } from '../bddGenerator';
import { TechLogAnalyzer } from '../techLogAnalyzer';

interface McpRequest {
    jsonrpc: string;
    id?: string | number | null;
    method: string;
    params?: any;
}

interface McpResponse {
    jsonrpc: string;
    id?: string | number | null;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export class McpServer1C {
    private rl: readline.Interface;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });
    }

    public start() {
        this.rl.on('line', (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
                const request: McpRequest = JSON.parse(trimmed);
                this.handleRequest(request);
            } catch (err: any) {
                this.sendError(null, -32700, `Parse error: ${err.message}`);
            }
        });
    }

    private handleRequest(req: McpRequest) {
        switch (req.method) {
            case 'initialize':
                this.sendResult(req.id, {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: '1c-bsl-ai-copilot-mcp',
                        version: '1.0.0'
                    }
                });
                break;

            case 'notifications/initialized':
                // Client notification, no response required
                break;

            case 'tools/list':
                this.sendResult(req.id, {
                    tools: this.getToolsList()
                });
                break;

            case 'tools/call':
                this.handleToolCall(req.id, req.params);
                break;

            case 'ping':
                this.sendResult(req.id, {});
                break;

            default:
                if (req.id !== undefined) {
                    this.sendError(req.id, -32601, `Method not found: ${req.method}`);
                }
                break;
        }
    }

    private getToolsList() {
        return [
            {
                name: '1c_audit_standards',
                description: 'Аудит BSL-кода на соответствие стандартам разработки фирмы «1С» (ИТС) и БСП: поиск вызовов в циклах, отсутствия блокировок данных, мутабельных значений и др.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Исходный код на встроенном языке 1С (BSL)'
                        }
                    },
                    required: ['code']
                }
            },
            {
                name: '1c_build_batch_query',
                description: 'Генерация профессионального пакета запросов 1С по стандартам ИТС: временные таблицы (ПОМЕСТИТЬ ВТ_), индексирование (ИНДЕКСИРОВАТЬ ПО), виртуальные таблицы с параметрами среза и МенеджерВременныхТаблиц.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        entityName: {
                            type: 'string',
                            description: 'Имя документа или справочника (например, ЗаказКлиента, РеализацияТоваровУслуг)'
                        },
                        tabularSection: {
                            type: 'string',
                            description: 'Имя табличной части (например, Товары)'
                        },
                        registerName: {
                            type: 'string',
                            description: 'Имя регистра накопления для контроля остатков (например, ТоварыНаСкладах)'
                        },
                        registerType: {
                            type: 'string',
                            enum: ['Остатки', 'Обороты', 'СрезПоследних'],
                            description: 'Тип виртуальной таблицы регистра'
                        },
                        includeScaffolding: {
                            type: 'boolean',
                            description: 'Включать ли BSL-код создания объекта Запрос и обхода выборки'
                        }
                    },
                    required: ['entityName', 'tabularSection', 'registerName']
                }
            },
            {
                name: '1c_inspect_query',
                description: 'Статический анализ текста запроса 1С на антипаттерны производительности СУБД (прямые соединения с виртуальными таблицами, отсутствие индексов на ВТ, пропущенный ЕСТЬNULL).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        queryText: {
                            type: 'string',
                            description: 'Текст запроса 1С'
                        }
                    },
                    required: ['queryText']
                }
            },
            {
                name: '1c_generate_extension',
                description: 'Генерация безопасного перехвата метода для расширения конфигурации (cfe) без снятия конфигурации с поддержки (&Вместо, &Перед, &После, &ИзменениеИКонтроль).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        targetMethod: {
                            type: 'string',
                            description: 'Имя типовой процедуры или функции (например, ОбработкаПроведения, ПриСозданииНаСервере)'
                        },
                        directive: {
                            type: 'string',
                            enum: ['Вместо', 'Перед', 'После', 'ИзменениеИКонтроль'],
                            description: 'Директива расширения 1С'
                        },
                        isFunction: {
                            type: 'boolean',
                            description: 'Является ли метод функцией (true) или процедурой (false)'
                        },
                        parameters: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Список параметров метода (например, ["Отказ", "РежимПроведения"])'
                        },
                        customLogic: {
                            type: 'string',
                            description: 'Пользовательская бизнес-логика для вставки в перехват'
                        }
                    },
                    required: ['targetMethod', 'directive']
                }
            },
            {
                name: '1c_bsp_search',
                description: 'Поиск стандартных методов Библиотеки Стандартных Подсистем (БСП) фирмы «1С» для исключения дублирования и тяжелых ручных вызовов.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Поисковый запрос (например: "чтение реквизита", "длительные операции", "строки")'
                        }
                    }
                }
            },
            {
                name: '1c_scan_metadata',
                description: 'Сканирование метаданных конфигурации 1С (Configuration.xml или проект EDT) для построения контекста справочников, документов и регистров.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        workspacePath: {
                            type: 'string',
                            description: 'Абсолютный путь к каталогу конфигурации 1С'
                        }
                    },
                    required: ['workspacePath']
                }
            },
            {
                name: '1c_generate_bdd_feature',
                description: 'Генерация BDD-сценариев Vanessa-Automation (.feature) на русском языке (Gherkin) для тестирования документов, справочников и бизнес-процессов 1С.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        entityName: {
                            type: 'string',
                            description: 'Имя документа или бизнес-сущности (например: ЗаказКлиента, РеализацияТоваровУслуг)'
                        },
                        tabularSection: {
                            type: 'string',
                            description: 'Имя табличной части (по умолчанию: Товары)'
                        },
                        registerName: {
                            type: 'string',
                            description: 'Имя регистра для валидации движений (по умолчанию: ТоварыНаСкладах)'
                        },
                        prompt: {
                            type: 'string',
                            description: 'Произвольное текстовое описание сценария тестирования на естественном языке'
                        }
                    }
                }
            },
            {
                name: '1c_analyze_tech_log',
                description: 'Глубокий экспертный анализ фрагментов Технологического Журнала 1С (ТЖ): события TLOCK, TDEADLOCK, EXCP, SDBL/DBPOSTGR/DBMSSQL с локализацией в коде BSL и архитектурными рекомендациями High-Load.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        rawLog: {
                            type: 'string',
                            description: 'Сырой текст фрагмента технологического журнала 1С'
                        }
                    },
                    required: ['rawLog']
                }
            },
            {
                name: '1c_refactor_query',
                description: 'Интеллектуальный рефакторинг текста запроса 1С по стандартам ИТС: вынесение прямых соединений с виртуальными таблицами во временные таблицы с индексированием, оборачивание полей в ЕСТЬNULL и уничтожение ВТ.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        rawQuery: {
                            type: 'string',
                            description: 'Исходный текст запроса 1С для оптимизации'
                        }
                    },
                    required: ['rawQuery']
                }
            }
        ];
    }

    private async handleToolCall(id: string | number | null | undefined, params: any) {
        if (!params || !params.name) {
            this.sendError(id, -32602, 'Missing tool name in params');
            return;
        }

        const args = params.arguments || {};

        try {
            switch (params.name) {
                case '1c_audit_standards': {
                    const code = args.code || '';
                    const issues = StandardsChecker.auditCode(code);
                    const report = StandardsChecker.formatAuditReport(issues);
                    this.sendToolResponse(id, {
                        issuesCount: issues.length,
                        issues,
                        report
                    });
                    break;
                }

                case '1c_build_batch_query': {
                    const generated = QueryBuilder.generateBatchQuery({
                        entityName: args.entityName,
                        tabularSection: args.tabularSection,
                        registerName: args.registerName,
                        registerType: args.registerType || 'Остатки',
                        fields: ['Номенклатура', 'Количество'],
                        includeScaffolding: args.includeScaffolding !== false
                    });
                    this.sendToolResponse(id, { queryCode: generated });
                    break;
                }

                case '1c_inspect_query': {
                    const queryText = args.queryText || '';
                    const result = QueryBuilder.inspectQuery(queryText);
                    this.sendToolResponse(id, result);
                    break;
                }

                case '1c_refactor_query': {
                    const rawQuery = args.rawQuery || '';
                    const result = QueryBuilder.refactorQuery(rawQuery);
                    this.sendToolResponse(id, result);
                    break;
                }

                case '1c_generate_extension': {
                    const interceptor = ExtensionGenerator.generateInterceptor({
                        targetMethod: args.targetMethod,
                        directive: args.directive as ExtensionDirective,
                        moduleType: 'МодульОбъекта',
                        isFunction: Boolean(args.isFunction),
                        parameters: args.parameters || ['Отказ'],
                        customLogic: args.customLogic
                    });
                    this.sendToolResponse(id, { code: interceptor });
                    break;
                }

                case '1c_bsp_search': {
                    const q = (args.query || '').toLowerCase();
                    const filtered = BSPHelper.STANDARD_MODULES.filter(m =>
                        !q ||
                        m.module.toLowerCase().includes(q) ||
                        m.method.toLowerCase().includes(q) ||
                        m.description.toLowerCase().includes(q)
                    );
                    this.sendToolResponse(id, {
                        results: filtered
                    });
                    break;
                }

                case '1c_scan_metadata': {
                    const wsPath = args.workspacePath || '';
                    const metadata = await MetadataScanner.scanWorkspace(wsPath);
                    const summary = MetadataScanner.formatForPrompt(metadata);
                    this.sendToolResponse(id, {
                        configName: metadata.name,
                        version: metadata.version,
                        objectsCount: metadata.objects.length,
                        summary
                    });
                    break;
                }

                case '1c_generate_bdd_feature': {
                    let featureContent = '';
                    if (args.prompt) {
                        featureContent = BDDGenerator.parseNaturalLanguageToFeature(args.prompt);
                    } else {
                        const entityName = args.entityName || 'РеализацияТоваровУслуг';
                        const spec = BDDGenerator.generateDocumentScenario(
                            entityName,
                            args.tabularSection || 'Товары',
                            args.registerName || 'ТоварыНаСкладах'
                        );
                        featureContent = BDDGenerator.generateFeature(spec);
                    }
                    this.sendToolResponse(id, { feature: featureContent });
                    break;
                }

                case '1c_analyze_tech_log': {
                    const rawLog = args.rawLog || '';
                    const parsedEvents = TechLogAnalyzer.parseLog(rawLog);
                    const diagnoses = TechLogAnalyzer.diagnose(parsedEvents);
                    const report = TechLogAnalyzer.formatReport(diagnoses);
                    this.sendToolResponse(id, {
                        eventsFound: parsedEvents.length,
                        diagnosesCount: diagnoses.length,
                        diagnoses,
                        report
                    });
                    break;
                }

                default:
                    this.sendError(id, -32601, `Unknown tool: ${params.name}`);
                    break;
            }
        } catch (err: any) {
            this.sendToolResponse(id, { error: err.message }, true);
        }
    }

    private sendToolResponse(id: string | number | null | undefined, data: any, isError = false) {
        this.sendResult(id, {
            content: [
                {
                    type: 'text',
                    text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
                }
            ],
            isError
        });
    }

    private sendResult(id: string | number | null | undefined, result: any) {
        const resp: McpResponse = {
            jsonrpc: '2.0',
            id,
            result
        };
        process.stdout.write(JSON.stringify(resp) + '\n');
    }

    private sendError(id: string | number | null | undefined, code: number, message: string) {
        const resp: McpResponse = {
            jsonrpc: '2.0',
            id,
            error: { code, message }
        };
        process.stdout.write(JSON.stringify(resp) + '\n');
    }
}

if (require.main === module) {
    const server = new McpServer1C();
    server.start();
}
