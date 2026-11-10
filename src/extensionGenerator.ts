import { bslString, identifier } from './shared/bsl/text';
import { methodParameter } from './shared/bsl/parameters';

/**
 * 1C:Enterprise Configuration Extension (cfe) Code Generator.
 * 
 * Generates editable BSL scaffolds. Original method signatures must be verified:
 * 1. &Вместо with ПродолжитьВызов(...)
 * 2. &Перед with precondition checks and Отказ flag handling
 * 3. &После with post-processing and event logging
 * 4. &ИзменениеИКонтроль is refused without the original method
 * 5. Managed Form extension scaffolds (ПриСозданииНаСервере, dynamic UI injection)
 * 6. Automatic signature inference for well-known 1C event handlers
 */

export type ExtensionDirective = 'Вместо' | 'Перед' | 'После' | 'ИзменениеИКонтроль';

export interface ExtensionMethodOptions {
    targetMethod: string;
    directive: ExtensionDirective;
    moduleType: 'ОбщийМодуль' | 'МодульОбъекта' | 'МодульМенеджера' | 'МодульФормы';
    isFunction: boolean;
    parameters: string[];
    description?: string;
    customLogic?: string;
    compilationDirective?: '&НаКлиенте' | '&НаСервере' | '&НаКлиентеНаСервереБезКонтекста' | '&НаСервереБезКонтекста';
}

const CANONICAL_SIGNATURES: Record<string, { params: string[]; isFunction?: boolean; defaultDirective?: string }> = {
    'ОбработкаПроведения': { params: ['Отказ', 'РежимПроведения'] },
    'ОбработкаУдаленияПроведения': { params: ['Отказ'] },
    'ОбработкаЗаполнения': { params: ['ДанныеЗаполнения', 'СтандартнаяОбработка'] },
    'ОбработкаПроверкиЗаполнения': { params: ['Отказ', 'ПроверяемыеРеквизиты'] },
    'ПриЗаписи': { params: ['Отказ'] },
    'ПриСозданииНаСервере': { params: ['Отказ', 'СтандартнаяОбработка'], defaultDirective: '&НаСервере' },
    'ПриОткрытии': { params: ['Отказ'], defaultDirective: '&НаКлиенте' },
    'ПередЗакрытием': { params: ['Отказ', 'ЗавершениеРаботы', 'ТекстПредупреждения', 'СтандартнаяОбработка'], defaultDirective: '&НаКлиенте' },
    'ПослеЗаписи': { params: ['ПараметрыЗаписи'], defaultDirective: '&НаКлиенте' },
    'ОбработкаОповещения': { params: ['ИмяСобытия', 'Параметр', 'Источник'], defaultDirective: '&НаКлиенте' },
};

export class ExtensionGenerator {
    /**
     * Generates a scaffold; known-event inference is case insensitive and module scoped.
     */
    public static generateInterceptor(options: ExtensionMethodOptions): string {
        options = { ...options, targetMethod: identifier(options.targetMethod, 'Перехватываемый метод') };
        if (!['МодульОбъекта', 'МодульФормы', 'ОбщийМодуль', 'МодульМенеджера'].includes(options.moduleType)) throw new Error('Укажите поддерживаемый тип модуля.');
        if (!['Вместо', 'Перед', 'После'].includes(options.directive)) {
            throw new Error('&ИзменениеИКонтроль требует исходного метода поставщика. Создайте такой перехват в Конфигураторе; генерация без исходника недоступна.');
        }
        if (options.isFunction && options.directive !== 'Вместо') {
            throw new Error('Для функции поддерживается &Вместо с возвратом результата.');
        }
        const known = Object.entries(CANONICAL_SIGNATURES).find(([name]) => name.toLowerCase() === options.targetMethod.toLowerCase());
        const signature = known?.[1];
        const canonical = signature && (signature.defaultDirective ? options.moduleType === 'МодульФормы' : options.moduleType === 'МодульОбъекта') ? signature : undefined;
        let params = options.parameters;
        if ((!params || params.length === 0) && canonical) {
            params = canonical.params;
        }

        if (canonical && !!canonical.isFunction !== options.isFunction) throw new Error('Вид метода не соответствует сигнатуре события платформы.');
        const isFunc = canonical ? !!canonical.isFunction : options.isFunction;
        const keyword = isFunc ? 'Функция' : 'Процедура';
        const endKeyword = isFunc ? 'КонецФункции' : 'КонецПроцедуры';
        const parsed = (params || []).map(methodParameter);
        if (new Set(parsed.map(p => p.name.toLowerCase())).size !== parsed.length) throw new Error('Параметры не должны повторяться.');
        const paramsList = parsed.map(p => p.declaration).join(', ');
        const callParams = parsed.map(p => p.name).join(', ');
        const directiveName = `&${options.directive}("${options.targetMethod}")`;

        let compilationHeader = '';
        if (options.moduleType === 'МодульФормы' || options.compilationDirective || canonical?.defaultDirective) {
            const comp = options.compilationDirective || canonical?.defaultDirective || '&НаСервере';
            if (!['&НаКлиенте','&НаСервере','&НаКлиентеНаСервереБезКонтекста','&НаСервереБезКонтекста'].includes(comp)) throw new Error('Неизвестная директива компиляции.');
            compilationHeader = `${comp}\n`;
        }

        let body = '';

        switch (options.directive) {
            case 'Вместо':
                if (isFunc) {
                    body = `    // Кастомная логика расширения перед вызовом типового метода
    ${options.customLogic || '// Дополнительная предобработка параметров'}

    // Вызов оригинальной типовой функции поставщика
    Результат = ПродолжитьВызов(${callParams});

    // Постобработка результата
    Возврат Результат;`;
                } else {
                    body = `    // Кастомная логика расширения
    ${options.customLogic || '// Предварительные действия'}

    // Вызов оригинальной типовой процедуры поставщика
    ПродолжитьВызов(${callParams});

    // Постобработка`;
                }
                break;

            case 'Перед':
                body = `    // Логика, выполняемая ДО вызова типового метода поставщика
    ${options.customLogic || '// Валидация входных данных или проверка прав'}
    // При необходимости прерывания типового выполнения:
    // Отказ = Истина;`;
                break;

            case 'После':
                body = `    // Логика, выполняемая ПОСЛЕ успешного завершения типового метода
    ${options.customLogic || '// Регистрация события, отправка уведомления или запись дополнительных данных'}`;
                break;


        }

        return `// BSL-шаблон. Сверьте сигнатуру и контекст в Конфигураторе.
// &${options.directive} перехват для метода "${options.targetMethod}"
${compilationHeader}${directiveName}
${keyword} Расш_${options.targetMethod}(${paramsList})
${body}
${endKeyword}`;
    }

    /**
     * Generates a complete Managed Form extension handler with dynamic button injection.
     */
    public static generateFormButtonExtension(buttonName: string, buttonTitle: string, commandName: string, parentName = 'КоманднаяПанель'): string {
        buttonName = identifier(buttonName, 'Имя кнопки');
        commandName = identifier(commandName, 'Имя команды');
        parentName = identifier(parentName, 'Имя командной панели');
        if (!buttonTitle?.trim()) throw new Error('Введите заголовок кнопки.');
        const title = bslString(buttonTitle);
        return `// Шаблон для модуля управляемой формы расширения.
// Укажите реальную командную панель и реализуйте обработчик команды.
&НаСервере
&После("ПриСозданииНаСервере")
Процедура Расш_ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)
    РодительКнопки = Элементы.Найти("${parentName}");
    Если РодительКнопки = Неопределено Тогда
        ВызватьИсключение "Не найдена командная панель ${parentName}. Укажите её имя в шаблоне.";
    КонецЕсли;
    // 1. Создание команды формы в расширении
    КомандаФормы = Команды.Добавить("${commandName}");
    КомандаФормы.Действие = "Расш_${commandName}";
    КомандаФормы.Заголовок = ${title};
    КомандаФормы.Подсказка = ${title};

    // 2. Добавление кнопки в командную панель формы
    КнопкаФормы = Элементы.Добавить("${buttonName}", Тип("КнопкаФормы"), РодительКнопки);
    КнопкаФормы.ИмяКоманды = "${commandName}";
    КнопкаФормы.Вид = ВидКнопкиФормы.КнопкаКоманднойПанели;
КонецПроцедуры

&НаКлиенте
Процедура Расш_${commandName}(Команда)
    // Обработчик нажатия добавленной кнопки на клиенте
    // TODO: реализуйте действие команды.
    // Заголовок: ${buttonTitle.replace(/[\r\n]/g, " ")}
КонецПроцедуры`;
    }

    /**
     * Generates Posting handler extension with additional movements without modifying base config.
     */
    public static generatePostingExtension(registerName: string): string {
        return `&После("ОбработкаПроведения")
Процедура Расш_ОбработкаПроведения(Отказ, РежимПроведения)
    Если Отказ Тогда
        Возврат;
    КонецЕсли;

    // Формирование движений по дополнительному регистру расширения
    Движения.${registerName}.Записывать = Истина;
    
    Для Каждого СтрокаТЧ Из ЭтотОбъект.Товары Цикл
        Движение = Движения.${registerName}.ДобавитьРасход();
        Движение.Период = ЭтотОбъект.Дата;
        Движение.Номенклатура = СтрокаТЧ.Номенклатура;
        Движение.Количество = СтрокаТЧ.Количество;
    КонецЦикла;
КонецПроцедуры`;
    }
}
