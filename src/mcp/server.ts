import { executeTool } from '../entities/toolbox/api/executeTool';
/**
 * 1C:Enterprise Model Context Protocol (MCP) Server.
 * 
 * Exposes 1C architecture intelligence (Metadata, ITS Standards, BSP, Query Builder, Extension Generator)
 * to any MCP-compliant AI client (Cursor, Windsurf, Claude Code, Cline, AGY).
 * 
 * Transport: JSON-RPC 2.0 over STDIO.
 */

import * as readline from 'readline';

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
        if (!req || typeof req !== 'object' || Array.isArray(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string' ||
            (req.id !== undefined && req.id !== null && typeof req.id !== 'string' && typeof req.id !== 'number')) {
            this.sendError(null, -32600, 'Invalid JSON-RPC request');
            return;
        }
        if (req.id === undefined) return; // Notifications never receive a JSON-RPC response.
        if (req.params !== undefined && (!req.params || typeof req.params !== 'object' || Array.isArray(req.params))) {
            this.sendError(req.id, -32602, 'MCP params must be an object');
            return;
        }
        switch (req.method) {
            case 'initialize':
                this.sendResult(req.id, {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: '1c-bsl-ai-copilot-mcp',
                        version: '1.0.8'
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
                description: 'Аудит BSL-кода на соответствие стандартам разработки фирмы «1С» (ИТС) и БСП: поиск вызовов в циклах, отсутствия блокировок данных, модальных вызовов; ограниченный набор эвристик, без гарантии полноты ИТС.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Исходный код на встроенном языке 1С (BSL)'
                        },
                        disabledRules: {type:'array',items:{type:'string'},description:'Отключённые правила локального аудита.'}
                    },
                    required: ['code']
                }
            },
            {
                name: '1c_build_batch_query',
                description: 'Шаблон контроля дефицита по явно заданным полям: временные таблицы (ПОМЕСТИТЬ ВТ_), индексирование (ИНДЕКСИРОВАТЬ ПО), виртуальные таблицы с параметрами среза и МенеджерВременныхТаблиц.',
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
                            enum: ['Остатки'],
                            description: 'Тип виртуальной таблицы регистра'
                        },
                        fields: { type: 'array', minItems: 2, items: { type: 'string' }, description: 'Все измерения и один числовой ресурс последним. Сопоставления: Номенклатура=Товар, Склад=@СкладШапки, Количество=Вес.' },
                        sourceMode: {type:'string',enum:['document','table'],description:'document: сохранённые строки базы; table: текущая табличная часть модуля объекта на сервере.'},
                        workspacePath: {type:'string',description:'Путь к проекту для проверки имён полей по реальным метаданным.'},
                        includeScaffolding: {
                            type: 'boolean',
                            description: 'Включать ли BSL-код создания объекта Запрос и обхода выборки'
                        }
                    },
                    required: ['entityName', 'tabularSection', 'registerName', 'fields']
                }
            },
            {
                name: '1c_inspect_query',
                description: 'Локальные структурные проверки и подсказки производительности запроса 1С. syntaxChecked=false, isValid=null не подтверждает синтаксис; false означает найденную структурную ошибку.',
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
                description: 'BSL-шаблон перехвата метода для расширения конфигурации (cfe) без снятия конфигурации с поддержки (&Вместо, &Перед, &После).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        targetMethod: {
                            type: 'string',
                            description: 'Имя типовой процедуры или функции (например, ОбработкаПроведения, ПриСозданииНаСервере)'
                        },
                        directive: {
                            type: 'string',
                            enum: ['Вместо', 'Перед', 'После'],
                            description: 'Директива расширения 1С'
                        },
                        moduleType: {
                            type: 'string',
                            enum: ['ОбщийМодуль', 'МодульОбъекта', 'МодульМенеджера', 'МодульФормы'],
                            description: 'Тип модуля; определяет применимость сигнатуры события. По умолчанию МодульОбъекта.'
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
                description: 'Оформление .feature с полным требованием и явными шагами из библиотеки Vanessa. stepCount и executionVerified показывают состав черновика; исполнение не подтверждается.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        entityName: {
                            type: 'string',
                            description: 'Имя документа или бизнес-сущности (например: ЗаказКлиента, РеализацияТоваровУслуг)'
                        },
                        tabularSection: {
                            type: 'string',
                            description: 'Имя табличной части, если известно'
                        },
                        registerName: {
                            type: 'string',
                            description: 'Имя регистра, если известно'
                        },
                        stepsText: {
                            type: 'string',
                            description: 'Реальные шаги Дано/Когда/Тогда или Given/When/Then с таблицами из вашей библиотеки Vanessa.'
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
                description: 'Локальный разбор поддерживаемых событий Технологического Журнала 1С (ТЖ): события TLOCK, TDEADLOCK, EXCP, SDBL/DBPOSTGR/DBMSSQL с локализацией в коде BSL и архитектурными рекомендациями High-Load.',
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
                description: 'Подготовка пакета из одного SELECT с одним виртуальным JOIN. Сохраняет имена полей и семантику NULL; неподдерживаемый вход возвращает без изменений с reason. Выборка становится вторым результатом пакета.',
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

        const args = params.arguments === undefined ? {} : params.arguments;

        try {
            const result = await executeTool(params.name, args);
            this.sendToolResponse(id, result);
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
