/** Navigation is grouped by the task a developer wants to complete. */
export const workspaceTools = [
    { id: 'queries-gen', name: 'Запрос по описанию', group: 'Создать', mode: 'ИИ', description: 'Пакет запроса 1С с параметрами и временными таблицами.', symbol: 'SQL' },
    { id: 'queries-batch', name: 'Проведение документа', group: 'Создать', mode: 'Локально', description: 'Шаблон запроса для документа, табличной части и регистра.', symbol: 'BSL' },
    { id: 'extensions', name: 'Расширение конфигурации', group: 'Создать', mode: 'Локально', description: 'Перехваты методов и команды управляемой формы.', symbol: '&' },
    { id: 'bdd', name: 'Сценарий Vanessa BDD', group: 'Создать', mode: 'Локально', description: 'Сценарий поведения документа в формате Gherkin.', symbol: 'BDD' },
    { id: 'queries-refactor', name: 'Оптимизация запроса', group: 'Проверить', mode: 'Локально', description: 'Разбор запроса и оптимизация его структуры по ИТС.', symbol: 'SQL' },
    { id: 'audit', name: 'Аудит стандартов', group: 'Проверить', mode: 'Локально', description: 'Замечания к модулю или фрагменту кода с рекомендациями.', symbol: '✓' },
    { id: 'bsp', name: 'Библиотека БСП', group: 'Проверить', mode: 'Локально', description: 'Поиск типовых методов, сигнатур и примеров вызова.', symbol: '{}' },
    { id: 'techlog', name: 'Технологический журнал', group: 'Исследовать', mode: 'Локально', description: 'Блокировки, исключения и медленные SQL-запросы.', symbol: 'TJ' },
    { id: 'metadata', name: 'Метаданные проекта', group: 'Исследовать', mode: 'Локально', description: 'Структура объектов конфигурации из рабочей области.', symbol: 'XML' },
    { id: 'sidecar', name: 'Конфигуратор и Sidecar', group: 'Исследовать', mode: 'Подключение', description: 'Статус локального помощника, EPF и TurboConf.', symbol: '↔' }
];
