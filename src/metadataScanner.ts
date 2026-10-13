import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationMetadata, MetadataObject } from './types';

/**
 * Scans workspace for 1C:Enterprise configuration files (XML dump or EDT format)
 * to feed the LLM with real business entity names instead of hallucinations.
 *
 * Provides isolated caching per workspace root path and explicit distinction
 * between real inspected schemas and synthetic fallback demos.
 */
export class MetadataScanner {
    private static cache = new Map<string, ConfigurationMetadata>();

    public static async scanWorkspace(rootPath: string): Promise<ConfigurationMetadata> {
        const normalizedRoot = rootPath ? path.resolve(rootPath) : '';

        if (this.cache.has(normalizedRoot)) {
            return this.cache.get(normalizedRoot)!;
        }

        const objects: MetadataObject[] = [];
        let configName = 'Конфигурация 1С';
        let configVersion = '8.3';
        let foundRealMetadata = false;

        if (normalizedRoot && fs.existsSync(normalizedRoot)) {
            // Check for Configuration.xml / Configuration.mdo
            const configNameDetected = this.detectConfigurationName(normalizedRoot);
            if (configNameDetected) {
                configName = configNameDetected;
                foundRealMetadata = true;
            }

            // 1. Check for standard 1C XML dump folder or EDT structure
            const candidates = [
                path.join(normalizedRoot, 'src', 'cf'),
                path.join(normalizedRoot, 'src'),
                path.join(normalizedRoot, 'cf'),
                normalizedRoot
            ];

            for (const dir of candidates) {
                if (fs.existsSync(dir)) {
                    this.findMetadataInDir(dir, objects);
                }
            }

            if (objects.length > 0) {
                foundRealMetadata = true;
            }
        }

        const isDemoFallback = !foundRealMetadata || objects.length === 0;

        // If no 1C metadata files found on disk, provide common standard enterprise entities as fallback
        if (isDemoFallback) {
            objects.push(
                {
                    kind: 'Справочник',
                    name: 'Номенклатура',
                    synonym: 'Номенклатура',
                    fields: [{ name: 'Артикул' }, { name: 'ЕдиницаИзмерения' }, { name: 'СтавкаНДС' }]
                },
                {
                    kind: 'Справочник',
                    name: 'Контрагенты',
                    synonym: 'Контрагенты',
                    fields: [{ name: 'ИНН' }, { name: 'КПП' }, { name: 'ЮридическийАдрес' }]
                },
                {
                    kind: 'Справочник',
                    name: 'Склады',
                    synonym: 'Склады (Места хранения)'
                },
                {
                    kind: 'Документ',
                    name: 'ЗаказКлиента',
                    synonym: 'Заказ клиента',
                    fields: [{ name: 'Контрагент' }, { name: 'Договор' }, { name: 'СуммаДокумента' }],
                    tabularSections: [{
                        name: 'Товары',
                        fields: [{ name: 'Номенклатура' }, { name: 'Количество' }, { name: 'Цена' }, { name: 'Сумма' }]
                    }]
                },
                {
                    kind: 'Документ',
                    name: 'РеализацияТоваровУслуг',
                    synonym: 'Реализация товаров и услуг',
                    fields: [{ name: 'Контрагент' }, { name: 'Склад' }, { name: 'СуммаДокумента' }],
                    tabularSections: [{
                        name: 'Товары',
                        fields: [{ name: 'Номенклатура' }, { name: 'Количество' }, { name: 'Цена' }, { name: 'Сумма' }]
                    }]
                },
                {
                    kind: 'РегистрНакопления',
                    name: 'ТоварыНаСкладах',
                    synonym: 'Товары на складах (Остатки)',
                    fields: [{ name: 'Склад' }, { name: 'Номенклатура' }, { name: 'Количество' }]
                },
                {
                    kind: 'РегистрСведений',
                    name: 'ЦеныНоменклатуры',
                    synonym: 'Цены номенклатуры (Периодический)',
                    fields: [{ name: 'Номенклатура' }, { name: 'ВидЦены' }, { name: 'Цена' }]
                }
            );
        }

        const result: ConfigurationMetadata = {
            name: configName,
            version: configVersion,
            objects: objects.slice(0, 100), // Keep context compact
            isDemoFallback,
            sourcePath: normalizedRoot
        };

        this.cache.set(normalizedRoot, result);
        return result;
    }

    private static detectConfigurationName(rootPath: string): string | null {
        const possibleConfigFiles = [
            path.join(rootPath, 'Configuration.xml'),
            path.join(rootPath, 'src', 'cf', 'Configuration.xml'),
            path.join(rootPath, 'src', 'Configuration.mdo'),
            path.join(rootPath, 'cf', 'Configuration.xml')
        ];

        for (const filePath of possibleConfigFiles) {
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8').slice(0, 5000);
                    const match = content.match(/<Name>([^<]+)<\/Name>/i) || content.match(/<name>([^<]+)<\/name>/i);
                    if (match && match[1]) {
                        return match[1].trim();
                    }
                } catch (_) {}
            }
        }
        return null;
    }

    private static findMetadataInDir(dir: string, result: MetadataObject[]) {
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    if (file === 'Catalogs' || file === 'Справочники') {
                        this.extractObjectsFromFolder(fullPath, 'Справочник', result);
                    } else if (file === 'Documents' || file === 'Документы') {
                        this.extractObjectsFromFolder(fullPath, 'Документ', result);
                    } else if (file === 'AccumulationRegisters' || file === 'РегистрыНакопления') {
                        this.extractObjectsFromFolder(fullPath, 'РегистрНакопления', result);
                    } else if (file === 'InformationRegisters' || file === 'РегистрыСведений') {
                        this.extractObjectsFromFolder(fullPath, 'РегистрСведений', result);
                    }
                }
            }
        } catch (_) {}
    }

    private static extractObjectsFromFolder(folder: string, kind: MetadataObject['kind'], result: MetadataObject[]) {
        try {
            const items = fs.readdirSync(folder);
            for (const item of items) {
                const itemPath = path.join(folder, item);
                const stat = fs.statSync(itemPath);

                let cleanName = '';
                let xmlFilePath = '';

                if (stat.isFile() && (item.endsWith('.xml') || item.endsWith('.mdo'))) {
                    cleanName = item.replace(/\.(xml|mdo)$/i, '');
                    xmlFilePath = itemPath;
                } else if (stat.isDirectory()) {
                    cleanName = item;
                    // Check if there is an XML file inside with the same name
                    const candidateXml = path.join(itemPath, `${item}.xml`);
                    const candidateMdo = path.join(itemPath, `${item}.mdo`);
                    if (fs.existsSync(candidateXml)) {
                        xmlFilePath = candidateXml;
                    } else if (fs.existsSync(candidateMdo)) {
                        xmlFilePath = candidateMdo;
                    }
                }

                if (cleanName && !result.some(r => r.name === cleanName && r.kind === kind)) {
                    const metadataObj: MetadataObject = { kind, name: cleanName };

                    // Parse attributes and tabular sections if XML file is accessible and under 2MB
                    if (xmlFilePath && fs.existsSync(xmlFilePath)) {
                        try {
                            const fileStat = fs.statSync(xmlFilePath);
                            if (fileStat.size < 2 * 1024 * 1024) {
                                const content = fs.readFileSync(xmlFilePath, 'utf-8');
                                this.enrichMetadataObjectFromXml(metadataObj, content);
                            }
                        } catch (_) {}
                    }

                    result.push(metadataObj);
                }
            }
        } catch (_) {}
    }

    private static enrichMetadataObjectFromXml(obj: MetadataObject, content: string) {
        // Tabular sections: <TabularSection ...><Properties><Name>Товары</Name>
        const tsMatches = content.matchAll(/<(?:TabularSection|tabularSections)[^>]*>[\s\S]*?<(?:Name|name)>([^<]+)<\/(?:Name|name)>/gi);
        const tabularSections: { name: string; fields: { name: string }[] }[] = [];
        for (const match of tsMatches) {
            const tsName = match[1].trim();
            if (tsName && !tabularSections.some(t => t.name === tsName)) {
                tabularSections.push({ name: tsName, fields: [] });
            }
        }
        if (tabularSections.length > 0) {
            obj.tabularSections = tabularSections;
        }

        // Attributes: <Attribute ...><Properties><Name>Контрагент</Name>
        const attrMatches = content.matchAll(/<(?:Attribute|attributes)[^>]*>[\s\S]*?<(?:Name|name)>([^<]+)<\/(?:Name|name)>/gi);
        const fields: { name: string }[] = [];
        for (const match of attrMatches) {
            const attrName = match[1].trim();
            if (attrName && !fields.some(f => f.name === attrName)) {
                fields.push({ name: attrName });
            }
        }
        if (fields.length > 0) {
            obj.fields = fields.slice(0, 30);
        }

        // Synonym: <Synonym><v8:item><v8:content>Номенклатура</v8:content>
        const synMatch = content.match(/<Synonym[\s\S]*?<v8:content>([^<]+)<\/v8:content>/i);
        if (synMatch && synMatch[1]) {
            obj.synonym = synMatch[1].trim();
        }
    }

    public static formatForPrompt(metadata: ConfigurationMetadata): string {
        const header = metadata.isDemoFallback
            ? `// Метаданные (Демо-схема, файлы конфигурации не найдены в рабочей области):`
            : `// Метаданные конфигурации 1С "${metadata.name}":`;

        const lines: string[] = [header];
        const grouped: Record<string, string[]> = {};

        for (const obj of metadata.objects) {
            if (!grouped[obj.kind]) {
                grouped[obj.kind] = [];
            }
            let desc = obj.name;
            if (obj.tabularSections && obj.tabularSections.length > 0) {
                const ts = obj.tabularSections.map(t => t.name).join(', ');
                desc += ` (Табличные части: ${ts})`;
            }
            grouped[obj.kind].push(desc);
        }

        for (const [kind, list] of Object.entries(grouped)) {
            lines.push(`// ${kind}: ${list.slice(0, 15).join(', ')}`);
        }

        return lines.join('\n');
    }

    public static clearCache(rootPath?: string) {
        if (rootPath) {
            const normalized = path.resolve(rootPath);
            this.cache.delete(normalized);
        } else {
            this.cache.clear();
        }
    }
}
