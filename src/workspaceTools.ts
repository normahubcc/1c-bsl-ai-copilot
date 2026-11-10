/** Navigation is grouped by the task a developer wants to complete. */
export const workspaceTools = [
    { id: 'queries-gen', name: 'Запрос по описанию', group: 'Создать', mode: 'ИИ', description: 'Пакет запроса 1С с параметрами и временными таблицами.', symbol: 'SQL' },
    { id: 'queries-batch', name: 'Запрос контроля дефицита', group: 'Шаблоны и БСП', mode: 'Локально', description: 'Шаблон запроса для документа, табличной части и регистра.', symbol: 'BSL' },
    { id: 'extensions', name: 'Расширение конфигурации', group: 'Шаблоны и БСП', mode: 'Локально', description: 'Перехваты методов и команды управляемой формы.', symbol: '&' },
    { id: 'bdd', name: 'Черновик Vanessa BDD', group: 'Шаблоны и БСП', mode: 'Локально', description: 'Каркас с требованиями или AI-черновик .feature.', symbol: 'BDD' },
    { id: 'queries-refactor', name: 'Подготовить пакет запроса', group: 'Проверить', mode: 'Локально', description: 'Подготовка пакета из одного SELECT с виртуальным JOIN.', symbol: 'SQL' },
    { id: 'audit', name: 'Проверить и объяснить BSL', group: 'Проверить', mode: 'Локально', description: 'Локальные замечания и AI-объяснение выделенного кода.', symbol: '✓' },
    { id: 'bsp', name: 'Библиотека БСП', group: 'Шаблоны и БСП', mode: 'Локально', description: 'Поиск типовых методов, сигнатур и примеров вызова.', symbol: '{}' },
    { id: 'techlog', name: 'Технологический журнал', group: 'Исследовать', mode: 'Локально', description: 'Блокировки, исключения и медленные SQL-запросы.', symbol: 'TJ' },
    { id: 'metadata', name: 'Метаданные проекта', group: 'Исследовать', mode: 'Локально', description: 'Структура объектов конфигурации из рабочей области.', symbol: 'XML' },
];
