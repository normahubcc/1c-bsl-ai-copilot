/**
 * 1C:Enterprise Configuration Extension (cfe) Code Generator.
 * 
 * Generates standards-compliant extension interceptors:
 * 1. &Вместо with ПродолжитьВызов(...)
 * 2. &Перед with precondition checks and Отказ flag handling
 * 3. &После with post-processing and event logging
 * 4. &ИзменениеИКонтроль with #Вставка / #КонецВставки and #Удаление / #КонецУдаления
 * 5. Managed Form extension scaffolds (ПриСозданииНаСервере, dynamic UI injection)
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
}

export class ExtensionGenerator {
    /**
     * Generates a fully compliant 1C Extension method interceptor.
     */
    public static generateInterceptor(options: ExtensionMethodOptions): string {
        const keyword = options.isFunction ? 'Функция' : 'Процедура';
        const endKeyword = options.isFunction ? 'КонецФункции' : 'КонецПроцедуры';
        const paramsList = options.parameters.join(', ');
        const directiveName = `&${options.directive}("${options.targetMethod}")`;

        let body = '';

        switch (options.directive) {
            case 'Вместо':
                if (options.isFunction) {
                    body = `    // Кастомная логика расширения перед вызовом типового метода
    ${options.customLogic || '// Дополнительная предобработка параметров'}

    // Вызов оригинальной типовой функции поставщика
    Результат = ПродолжитьВызов(${paramsList});

    // Постобработка результата
    Возврат Результат;`;
                } else {
                    body = `    // Кастомная логика расширения
    ${options.customLogic || '// Предварительные действия'}

    // Вызов оригинальной типовой процедуры поставщика
    ПродолжитьВызов(${paramsList});

    // Постобработка`;
                }
                break;

            case 'Перед':
                body = `    // Логика, выполняемая ДО вызова типового метода поставщика
    ${options.customLogic || '// Валидация входных данных или проверка прав'}
    // При необходимости прерывания типового выполнения (если есть параметр Отказ):
    // Отказ = Истина;`;
                break;

            case 'После':
                body = `    // Логика, выполняемая ПОСЛЕ успешного завершения типового метода
    ${options.customLogic || '// Регистрация события, отправка уведомления или запись дополнительных данных'}`;
                break;

            case 'ИзменениеИКонтроль':
                body = `    // Типовой код поставщика остается без изменений
    // ... оригинальные строки метода ...

#Вставка
    // [NormaHub Extension] Вставка нового функционала без снятия с поддержки
    ${options.customLogic || 'Сообщить("Выполнен модифицированный участок логики расширения");'}
#КонецВставки

    // ... продолжение оригинального кода ...`;
                break;
        }

        return `// &${options.directive} перехват для метода "${options.targetMethod}"
${directiveName}
${keyword} Расш_${options.targetMethod}(${paramsList})
${body}
${endKeyword}`;
    }

    /**
     * Generates a complete Managed Form extension handler with dynamic button injection.
     */
    public static generateFormButtonExtension(buttonName: string, buttonTitle: string, commandName: string): string {
        return `&После("ПриСозданииНаСервере")
Процедура Расш_ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)
    // 1. Создание команды формы в расширении
    КомандаФормы = Команды.Добавить("${commandName}");
    КомандаФормы.Действие = "Расш_${commandName}";
    КомандаФормы.Заголовок = "${buttonTitle}";
    КомандаФормы.Подсказка = "${buttonTitle} (добавлено расширением NormaHub)";

    // 2. Добавление кнопки в командную панель формы
    КнопкаФормы = Элементы.Добавить("${buttonName}", Тип("КнопкаФормы"), Элементы.КоманднаяПанель);
    КнопкаФормы.ИмяКоманды = "${commandName}";
    КнопкаФормы.Вид = ВидКнопкиФормы.КнопкаКоманднойПанели;
КонецПроцедуры

&НаКлиенте
Процедура Расш_${commandName}(Команда)
    // Обработчик нажатия добавленной кнопки на клиенте
    ПоказатьОповещениеПользователя("${buttonTitle}", , "Команда успешно выполнена.");
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
