import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationMetadata, MetadataObject } from './types';

/**
 * Scans workspace for 1C:Enterprise configuration files (XML dump or EDT format)
 * to feed the LLM with real business entity names instead of hallucinations.
 */
export class MetadataScanner {
    private static cachedMetadata: ConfigurationMetadata | null = null;

    public static async scanWorkspace(rootPath: string): Promise<ConfigurationMetadata> {
        if (this.cachedMetadata) {
            return this.cachedMetadata;
        }

        const objects: MetadataObject[] = [];

        // 1. Check for standard 1C XML dump folder or EDT structure
        const candidates = [
            path.join(rootPath, 'src', 'cf'),
            path.join(rootPath, 'src'),
            path.join(rootPath, 'cf'),
            rootPath
        ];

        for (const dir of candidates) {
            if (fs.existsSync(dir)) {
                this.findMetadataInDir(dir, objects);
            }
        }

        // If no 1C metadata files found on disk, provide common standard enterprise entities
        if (objects.length === 0) {
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

        this.cachedMetadata = {
            name: 'Конфигурация 1С',
            version: '8.3',
            objects: objects.slice(0, 50) // Keep context compact
        };

        return this.cachedMetadata;
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
                const cleanName = item.replace(/\.xml$/, '');
                if (cleanName && !result.some(r => r.name === cleanName)) {
                    result.push({ kind, name: cleanName });
                }
            }
        } catch (_) {}
    }

    public static formatForPrompt(metadata: ConfigurationMetadata): string {
        const lines: string[] = ['// Доступные метаданные конфигурации 1С:'];
        const grouped: Record<string, string[]> = {};

        for (const obj of metadata.objects) {
            if (!grouped[obj.kind]) {
                grouped[obj.kind] = [];
            }
            let desc = obj.name;
            if (obj.tabularSections && obj.tabularSections.length > 0) {
                const ts = obj.tabularSections.map(t => t.name).join(', ');
                desc += ` (ТЧ: ${ts})`;
            }
            grouped[obj.kind].push(desc);
        }

        for (const [kind, list] of Object.entries(grouped)) {
            lines.push(`// ${kind}: ${list.slice(0, 10).join(', ')}`);
        }

        return lines.join('\n');
    }

    public static clearCache() {
        this.cachedMetadata = null;
    }
}
