import { identifier } from '../../../shared/bsl/text';
import { ConfigurationMetadata } from '../../../types';

export interface FieldMapping { target: string; source: string; header: boolean; }

/** РегистрПоле=ПолеСтроки or РегистрПоле=@РеквизитШапки. */
export function parseFieldMapping(value: string): FieldMapping {
    if (typeof value !== 'string') throw new Error('Поле: укажите идентификатор 1С.');
    const parts = value.split('=');
    if (parts.length > 2) throw new Error('Сопоставление поля: используйте ПолеРегистра=ПолеСтроки или ПолеРегистра=@РеквизитШапки.');
    const target = identifier(parts[0], 'Поле регистра');
    const source = (parts[1] ?? parts[0]).trim(), header = source.startsWith('@');
    return {target, source:identifier(header ? source.slice(1) : source, 'Поле источника'), header};
}

/** Validate only supplied real schema; missing metadata is reported, never replaced with demo fields. */
export function validateBatchSchema(metadata: ConfigurationMetadata, entity: string, tabular: string, register: string, mappings: FieldMapping[]): string[] {
    if (metadata.isDemoFallback || !metadata.objects.length) return ['Метаданные недоступны: имена и типы полей не проверены.'];
    const parts = entity.split('.'), kind = parts.length === 2 ? parts[0] : 'Документ', name = parts.at(-1)!;
    const object = metadata.objects.find(o => o.kind === kind && o.name.toLowerCase() === name.toLowerCase());
    const accumulation = metadata.objects.find(o => o.kind === 'РегистрНакопления' && o.name.toLowerCase() === register.replace(/^РегистрНакопления\./, '').toLowerCase());
    if (!object) throw new Error(`Объект ${entity} не найден в метаданных проекта.`);
    if (!accumulation) throw new Error(`Регистр ${register} не найден в метаданных проекта.`);
    if (accumulation.registerType === 'Обороты') throw new Error('Для контроля дефицита нужен регистр остатков, а не оборотов.');
    const section = object.tabularSections?.find(t => t.name.toLowerCase() === tabular.toLowerCase());
    if (!section) throw new Error(`Табличная часть ${tabular} не найдена в метаданных проекта.`);
    const warnings: string[] = [];
    for (let i = 0; i < mappings.length; i++) {
        const field = mappings[i];
        const sourceFields = field.header ? object.fields : section.fields;
        const source = sourceFields?.find(f => f.name.toLowerCase() === field.source.toLowerCase());
        const destination = accumulation.fields?.find(f => f.name.toLowerCase() === field.target.toLowerCase());
        if (!source) throw new Error(`Поле источника ${field.source} не найдено в метаданных проекта.`);
        if (!destination) throw new Error(`Поле регистра ${field.target} не найдено в метаданных проекта.`);
        const expected = i === mappings.length - 1 ? 'resource' : 'dimension';
        if (destination.role && destination.role !== expected) throw new Error(`Поле регистра ${field.target}: неверная роль для шаблона дефицита.`);
        if (expected === 'resource' && [source.type,destination.type].some(t => t && /^(?:Строка|Булево|Дата|String|Boolean|Date|xs:(?:string|boolean|date)|cfg:(?:CatalogRef|DocumentRef)|СправочникСсылка|ДокументСсылка)/i.test(t))) throw new Error('Ресурс контроля дефицита должен быть числовым.');
        if (!source.type || !destination.type) warnings.push(`Типы поля ${field.target} требуют проверки в 1С.`);
    }
    for (const dimension of accumulation.fields?.filter(f => f.role === 'dimension') || []) {
        if (!mappings.slice(0,-1).some(m => m.target.toLowerCase() === dimension.name.toLowerCase())) throw new Error(`Не сопоставлено измерение регистра ${dimension.name}.`);
    }
    if (!accumulation.fields?.some(f => f.role)) warnings.push('Роли измерений и ресурсов не описаны в метаданных: проверьте полноту измерений.');
    return [...new Set(warnings)];
}
