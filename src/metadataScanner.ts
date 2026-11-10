import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationMetadata, MetadataObject, MetadataField } from './types';

/**
 * Scans workspace for 1C:Enterprise configuration files (XML dump or EDT format)
 * to feed the LLM with real business entity names instead of hallucinations.
 *
 * Provides isolated caching per workspace root path and explicit distinction
 * between real inspected schemas and synthetic fallback demos.
 */
export class MetadataScanner {
    private static cache = new Map<string, { revision: string; metadata: ConfigurationMetadata }>();

    public static sourceRevision(rootPath: string): string {
        if (!rootPath) return '';
        const candidates = ['metadata.json', 'Configuration.xml', 'src/cf/Configuration.xml', 'src/Configuration.mdo', 'cf/Configuration.xml'];
        return candidates.map(relative => {
            try {
                const stat = fs.statSync(path.join(rootPath, relative));
                return `${relative}:${stat.mtimeMs}:${stat.size}`;
            } catch { return `${relative}:missing`; }
        }).join('|');
    }

    public static async scanWorkspace(rootPath: string): Promise<ConfigurationMetadata> {
        const normalizedRoot = rootPath ? path.resolve(rootPath) : '';

        const revision = this.sourceRevision(normalizedRoot);
        const cached = this.cache.get(normalizedRoot);
        if (cached?.revision === revision) return cached.metadata;
        this.cache.delete(normalizedRoot);

        const objects: MetadataObject[] = [];
        let configName = 'Конфигурация 1С';
        const configVersion = '';

        if (normalizedRoot && fs.existsSync(normalizedRoot)) {
            const jsonFile = path.join(normalizedRoot, 'metadata.json');
            if (fs.existsSync(jsonFile)) {
                const imported = this.readJsonMetadata(jsonFile, normalizedRoot);
                this.cache.set(normalizedRoot, { revision, metadata: imported });
                return imported;
            }
            // Check for Configuration.xml / Configuration.mdo
            const configNameDetected = this.detectConfigurationName(normalizedRoot);
            if (configNameDetected) {
                configName = configNameDetected;
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

        }

        // Empty means unavailable. Never invent business entities for runtime context.
        const result: ConfigurationMetadata = {
            name: configName,
            version: configVersion,
            objects,
            isDemoFallback: false,
            sourcePath: normalizedRoot
        };

        this.cache.set(normalizedRoot, { revision, metadata: result });
        return result;
    }

    private static readJsonMetadata(file: string, root: string): ConfigurationMetadata {
        if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('metadata.json превышает 8 МБ. Разделите выгрузку.');
        let input: any;
        try { input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
        catch { throw new Error('metadata.json: неверный JSON. Исправьте файл и повторите сканирование.'); }
        if (!input || !Array.isArray(input.objects)) throw new Error('metadata.json должен содержать массив objects.');
        const kinds = ['Справочник', 'Документ', 'РегистрНакопления', 'РегистрСведений', 'ПланВидовХарактеристик', 'Перечисление'];
        const validName = (v: unknown): v is string => typeof v === 'string' && /^[А-Яа-яЁёA-Za-z_][А-Яа-яЁёA-Za-z_0-9]*$/.test(v);
        const fields = (list: unknown) => {
            if (list === undefined) return undefined;
            if (!Array.isArray(list) || list.some(f => !f || !validName(f.name))) throw new Error('metadata.json: некорректное имя поля.');
            return list.map(f => ({ name: f.name, type: typeof f.type === 'string' ? f.type.slice(0, 200) : undefined, role: ['attribute','dimension','resource'].includes(f.role) ? f.role as MetadataField['role'] : undefined }));
        };
        const seen = new Set<string>();
        const objects: MetadataObject[] = input.objects.map((o: any) => {
            if (!o || !kinds.includes(o.kind) || !validName(o.name)) throw new Error('metadata.json: неизвестный вид объекта или некорректное имя.');
            const key = `${o.kind}.${o.name}`.toLowerCase();
            if (seen.has(key)) throw new Error(`metadata.json: повтор объекта ${o.name}.`);
            seen.add(key);
            if (o.tabularSections !== undefined && !Array.isArray(o.tabularSections)) throw new Error('metadata.json: tabularSections должен быть массивом.');
            return {
                kind: o.kind, name: o.name,
                registerType: ['Остатки','Обороты'].includes(o.registerType) ? o.registerType : undefined,
                synonym: typeof o.synonym === 'string' ? o.synonym.slice(0, 200) : undefined,
                fields: fields(o.fields),
                tabularSections: o.tabularSections?.map((t: any) => {
                    if (!t || !validName(t.name)) throw new Error('metadata.json: некорректная табличная часть.');
                    return { name: t.name, fields: fields(t.fields) || [] };
                })
            };
        });
        return { name: typeof input.name === 'string' ? input.name.slice(0, 200) : 'Конфигурация 1С', version: typeof input.version === 'string' ? input.version : undefined, objects, sourcePath: root, isDemoFallback: false };
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
                    } else if (file === 'ChartsOfCharacteristicTypes') {
                        this.extractObjectsFromFolder(fullPath, 'ПланВидовХарактеристик', result);
                    } else if (file === 'Enums') {
                        this.extractObjectsFromFolder(fullPath, 'Перечисление', result);
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
        const parseFields = (xml: string) => [...xml.matchAll(/<(Attribute|Dimension|Resource|attributes|dimensions|resources)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
            .map(match => {
                const name = match[2].match(/<(?:Name|name)>([^<]+)<\/(?:Name|name)>/i)?.[1]?.trim();
                const tag = match[1].toLowerCase();
                const role: MetadataField['role'] = tag.startsWith('dimension') ? 'dimension' : tag.startsWith('resource') ? 'resource' : 'attribute';
                const type = match[2].match(/<(?:v8:Type|type)>([^<]+)<\/(?:v8:Type|type)>/i)?.[1]?.trim();
                return name ? { name, role, type } : undefined;
            }).filter((field): field is { name: string; role: NonNullable<MetadataField['role']>; type: string | undefined } => !!field);
        const sections = [...content.matchAll(/<(TabularSection|tabularSections)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
        if (sections.length) obj.tabularSections = sections.map(match => {
            const name = match[2].match(/<(?:Name|name)>([^<]+)<\/(?:Name|name)>/i)?.[1]?.trim() || '';
            return { name, fields: parseFields(match[2]) };
        }).filter(section => !!section.name);
        const withoutSections = content.replace(/<(TabularSection|tabularSections)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        obj.fields = parseFields(withoutSections);
        const registerType = content.match(/<(?:RegisterType|registerType)>([^<]+)<\/(?:RegisterType|registerType)>/i)?.[1];
        if (registerType) obj.registerType = /Turnovers|Обороты/i.test(registerType) ? 'Обороты' : /Balance|Остатки/i.test(registerType) ? 'Остатки' : undefined;
        const synonym = content.match(/<Synonym[\s\S]*?<v8:content>([^<]+)<\/v8:content>/i)?.[1];
        if (synonym) obj.synonym = synonym.trim();
    }

    public static formatForPrompt(metadata: ConfigurationMetadata): string {
        if (metadata.isDemoFallback || metadata.objects.length === 0) {
            return '// Метаданные конфигурации недоступны. Имена объектов и полей требуется уточнить у пользователя.';
        }
        const header = `// Метаданные конфигурации 1С "${metadata.name.replace(/[\r\n]/g, ' ')}" (${metadata.objects.length} объектов):`;
        const lines: string[] = [header];
        const grouped: Record<string, string[]> = {};

        for (const obj of metadata.objects) {
            if (!grouped[obj.kind]) {
                grouped[obj.kind] = [];
            }
            let desc = obj.name;
            if (obj.tabularSections && obj.tabularSections.length > 0) {
                const ts = obj.tabularSections.map(t => `${t.name}[${t.fields.map(f => f.name).join(', ')}]`).join(', ');
                desc += ` (Табличные части: ${ts})`;
            }
            if (obj.fields?.length) desc += ` (Поля: ${obj.fields.slice(0, 30).map(f => f.name).join(', ')})`;
            grouped[obj.kind].push(desc);
        }

        for (const [kind, list] of Object.entries(grouped)) {
            lines.push(`// ${kind}: ${list.slice(0, 30).join(', ')}`);
            if (list.length > 30) lines.push(`// Ещё ${list.length - 30} объектов этого вида не включены в контекст.`);
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
