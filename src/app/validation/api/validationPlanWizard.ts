import { additionalParameterNames, parseScalarParameter, QueryParameter } from '../../../entities/runner/model/parameters';
import * as vscode from 'vscode';
import { QueryCandidateArtifact } from '../../../entities/validation/model/queryComparison';
import { RunnerProfile } from '../../../entities/runner/model/queryJob';
import { QueryResultSet } from '../../../entities/business-contract/model/resultSet';
import { queryChoices } from '../../../features/create-validation-plan/model/queryChoices';
import { createUserPlan } from '../../../features/create-validation-plan/model/createPlan';
import { parseColumns, parseTypedCsv } from '../../../features/create-validation-plan/model/typedCsv';
import { readLocalText } from '../../../shared/lib/readLocalJson';
import type { ValidationNativeUi } from './previewValidation';

/** Native inputs only. Expectations come from the user, never from the generated query or engine result. */
export async function validationPlanWizard(artifact: QueryCandidateArtifact, profile: RunnerProfile,
    ui: ValidationNativeUi, t: (text: string) => string, guard: () => void) {
    const pick = async (items: { action: string; label: string; description?: string; detail?: string }[], title: string) => {
        guard(); const result = await ui.pick(items, { title: t(title), ignoreFocusOut: true }); guard(); return result;
    };
    const ask = async (prompt: string, validate: (value: string) => void, optional = false) => {
        guard();
        const value = await (ui.input ?? (options => vscode.window.showInputBox(options)))({
            title: t('План проверки запроса'), prompt: t(prompt), ignoreFocusOut: true,
            validateInput: value => { try { if (value || !optional) validate(value); return undefined; } catch (error) { return t(error instanceof Error ? error.message : 'Некорректные данные.'); } }
        });
        guard(); if (value !== undefined) { if (value || !optional) validate(value); } return value;
    };
    const required = (value: string) => { if (!value.trim() || value.length > 8000) throw new Error('Введите от 1 до 8000 символов.'); };
    const choices = queryChoices(artifact.code);
    if (!choices.length) throw new Error('Полный SELECT не найден. Конкатенация и динамические запросы этим профилем не поддерживаются.');
    const selected = await pick(choices.map((c, i) => ({ action: String(i), label: t('Запрос, строка') + ' ' + c.line,
        description: c.format, detail: c.query.slice(0, 1200) })), 'Выберите запрос для проверки');
    if (!selected) return undefined;
    const choice = choices[Number(selected.action)]; if (!choice) throw new Error('Неизвестный диапазон запроса.');
    const names = additionalParameterNames(choice.query);
    if (names.length > 32) throw new Error('Запрос превышает лимит 32 дополнительных параметров.');
    if (names.length && profile.schemaVersion === 1) throw new Error('Профиль v1 задаёт только Дата и Ссылка. Для дополнительных параметров подключите профиль v2.');
    const parameters: QueryParameter[] = [];
    for (const name of names) {
        const typeLabels: Record<string, string> = { string: 'Строка (string)', number: 'Число (number)',
            boolean: 'Логическое (boolean)', date: 'Дата (date)', null: 'NULL' };
        const type = await pick(Object.entries(typeLabels).map(([action, label]) => ({ action, label: t(label) })), 'Тип параметра запроса');
        if (!type) return;
        if (!['string', 'number', 'boolean', 'date', 'null'].includes(type.action)) throw new Error('Неизвестный тип параметра.');
        let value;
        if (type.action === 'null') value = parseScalarParameter({ type: 'null' });
        else {
            const parse = (text: string) => parseScalarParameter({ type: type.action, value: type.action === 'number' ? text.trim().replace(',', '.')
                : type.action === 'boolean' ? (/^(true|истина)$/i.test(text.trim()) ? true : /^(false|ложь)$/i.test(text.trim()) ? false : text) : text });
            guard();
            const text = await (ui.input ?? (options => vscode.window.showInputBox(options)))({ title: t('Значение параметра') + ': ' + name,
                prompt: t('Число — десятичное; дата — YYYY-MM-DDTHH:mm:ss; boolean — true/false. Строка может быть пустой.'),
                ignoreFocusOut: true, validateInput: input => { try { parse(input); return undefined; } catch (error) { return t(error instanceof Error ? error.message : 'Некорректные данные.'); } } });
            guard(); if (text === undefined) return; value = parse(text);
        }
        parameters.push({ name, value });
    }
    const requirement = await ask('Опишите требуемый результат независимо от AI-кода.', required); if (requirement === undefined) return;
    const reference = await ask('Ссылка или номер требования. Хешируется введённое описание, содержимое ссылки не загружается.', value => { required(value); if (value.length > 1024) throw new Error('Сократите ссылку до 1024 символов.'); }); if (reference === undefined) return;
    const precondition = await ask('Условия тестовых данных и ограничения сценария (обязательно).', value => {
        required(value); if (value.length > 2000) throw new Error('Сократите условия до 2000 символов.');
    }); if (precondition === undefined) return;
    const assumption = await ask('Допущения и неизвестные условия; оставьте пустым, если их нет.', value => {
        if (value.length > 2000) throw new Error('Сократите условия до 2000 символов.');
    }, true); if (assumption === undefined) return;
    const source = await pick([{ action: 'manual', label: t('Ввести ожидаемые строки') },
        { action: 'csv', label: t('Загрузить ожидаемые строки из CSV'), description: t('UTF-8; разделитель ; и колонки Имя:тип') }], 'Ожидаемый результат');
    if (!source) return;
    let expected: QueryResultSet;
    if (source.action === 'csv') {
        guard(); const files = await ui.file({ title: t('Выберите CSV ожидаемого результата'), canSelectMany: false,
            canSelectFiles: true, canSelectFolders: false, filters: { CSV: ['csv'] } }); guard();
        if (!files?.length) return;
        if (files.length !== 1 || files[0].scheme !== 'file') throw new Error('Выберите один локальный CSV-файл.');
        expected = parseTypedCsv(await readLocalText(files[0].fsPath, guard));
    } else if (source.action === 'manual') {
        const header = await ask('Колонки через ; в формате Имя:тип. Типы: string, number, boolean, date, reference.', value => { parseColumns(value); });
        if (header === undefined) return;
        const rows: string[] = [];
        while (true) {
            const action = await pick([
                ...(rows.length < 2000 ? [{ action: 'add', label: t('Добавить ожидаемую строку') }] : []),
                ...(rows.length ? [{ action: 'remove', label: t('Удалить последнюю строку') }] : []),
                { action: 'finish', label: t(rows.length ? 'Подтвердить ожидаемые строки' : 'Подтвердить пустой результат'), description: String(rows.length) }
            ], 'Ожидаемый результат');
            if (!action) return;
            if (action.action === 'finish') break;
            if (action.action === 'remove') { rows.pop(); continue; }
            if (action.action !== 'add') throw new Error('Неизвестное действие таблицы.');
            const row = await ask('Значения через ;. NULL и UNDEFINED без кавычек; строки с ; или буквальным NULL — в двойных кавычках.', value => { parseTypedCsv(header + '\n' + value + '\n'); if (!value.length) throw new Error('Для пустой строки используйте двойные кавычки.'); });
            if (row === undefined) return;
            rows.push(row);
        }
        expected = parseTypedCsv(header + '\n' + rows.join('\n') + (rows.length ? '\n' : ''));
    } else throw new Error('Неизвестный источник ожидаемых строк.');
    const mode = await pick([{ action: 'multiset', label: t('Сравнить строки без учёта порядка'), description: t('Дубликаты учитываются') },
        { action: 'ordered', label: t('Учитывать порядок строк') }], 'Правило сравнения');
    if (!mode) return;
    if (mode.action !== 'multiset' && mode.action !== 'ordered') throw new Error('Неизвестный режим сравнения.');
    const plan = createUserPlan(artifact, profile, choice, { requirement, reference, preconditions: [precondition],
        assumptions: assumption ? [assumption] : [], mode: mode.action, expected, parameters });
    const action = t('Подготовить задание');
    guard(); const confirmed = await ui.confirm(t('Создать предложенный контракт проверки?'), { modal: true,
        detail: [t('Это ожидания пользователя. Они не являются утверждённым бизнес-контрактом.'), requirement,
            t('Выбранный запрос') + ':\n' + choice.query.slice(0, 1200), t('Параметры Дата и Ссылка заданы учебной конфигурацией. Дополнительные параметры:') + '\n' + JSON.stringify(parameters, null, 2).slice(0, 5000), t('Ожидаемых строк') + ': ' + expected.rows.length,
            JSON.stringify(expected, null, 2).slice(0, 5000), t('Полный BSL и применение кода не проверяются.')].join('\n\n') }, action); guard();
    return confirmed === action ? plan : undefined;
}
