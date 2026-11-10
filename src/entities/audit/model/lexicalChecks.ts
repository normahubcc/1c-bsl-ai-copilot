import { BSLToken, BSLTokenType } from '../../../bslTokenizer';
import { StandardIssue } from '../../../types';

/** Narrow lexical checks. Receiver evidence is required; this does not infer arbitrary object types. */
export function lexicalChecks(all: BSLToken[]): StandardIssue[] {
    const tokens = all.filter(t => t.type !== BSLTokenType.COMMENT);
    const issues: StandardIssue[] = [], queries = new Map<string, boolean>();
    const low = (i: number) => tokens[i]?.value.toLowerCase();
    const add = (i: number, rule: string, severity: StandardIssue['severity'], message: string, suggestion: string) => issues.push({line:tokens[i].line,rule,severity,message,suggestion});
    const isQuery = (name: string) => queries.get(name) ?? /^(?:запрос|query)$/.test(name);
    let loops = 0, posting = false, postingLine = 0, locked = false;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i], value = low(i);
        if (token.type === BSLTokenType.STRING_LITERAL) continue;
        if (['процедура','функция','procedure','function'].includes(value)) {
            queries.clear(); loops = 0; posting = low(i + 1) === 'обработкапроведения'; postingLine = i; locked = false;
        }
        if (['конецпроцедуры','конецфункции','endprocedure','endfunction'].includes(value)) {
            if (posting && !locked) add(postingLine,'ITS-LOCK-001','warning',
                'В ОбработкаПроведения не найдена явная БлокировкаДанных; проверьте механизм блокировок вызываемого кода.',
                'Проверьте транзакцию и блокировки в вызываемом коде. Если они уже обеспечены, подавите это правило для обработчика.');
            posting = false; loops = 0; queries.clear();
        }
        if (posting && ['новый','new'].includes(value) && /^(?:блокировкаданных|datalock)$/.test(low(i + 1))) locked = true;
        if (['цикл','do'].includes(value)) loops++;
        if (['конеццикла','enddo'].includes(value)) loops = Math.max(0, loops - 1);
        if (token.type === BSLTokenType.IDENTIFIER && low(i + 1) === '=' && low(i - 1) !== '.') {
            queries.set(value, /^(?:новый|new)$/.test(low(i + 2)) && /^(?:запрос|query)$/.test(low(i + 3)));
        }
        if (loops && /^(?:выполнить|выполнитьпакет|execute|executebatch)$/.test(value) && low(i - 1) === '.' && low(i + 1) === '(' && isQuery(low(i - 2))) {
            add(i,'ITS-PERF-001','error','Выполнение запроса внутри цикла (Запрос.Выполнить()).',
                'Перенесите чтение данных в запрос до цикла; проверьте возможность пакетной обработки.');
        }
        if (/^(?:текст|text)$/.test(value) && low(i - 1) === '.' && low(i + 1) === '=' && isQuery(low(i - 2))) {
            let plus = false, dynamic = false;
            for (let j = i + 2; j < tokens.length && low(j) !== ';'; j++) {
                if (low(j) === '+') plus = true;
                if (tokens[j].type === BSLTokenType.IDENTIFIER && !(isQuery(low(j)) && low(j + 1) === '.') && !/^(?:текст|text)$/.test(low(j))) dynamic = true;
            }
            if (plus && dynamic) add(i,'ITS-SEC-001','warning',
                'Динамическая склейка текста запроса со строковыми переменными (риск 1С-инъекции).',
                'Передавайте значения через параметры запроса. Динамические имена полей и условия проверяйте по разрешённому списку.');
        }
        if (/^(?:предупреждение|вопрос|ввестистроку|ввестичисло|warning|doquerybox)$/.test(value) && low(i - 1) !== '.' && !/^(?:процедура|функция|procedure|function)$/.test(low(i - 1)) && low(i + 1) === '(') {
            add(i,'ITS-UI-003','warning',`Использование модального окна (${token.value}). Запрещено в веб-клиенте и мобильном клиенте.`,
                'Используйте асинхронный API целевой версии платформы: ПоказатьПредупреждение(), ПоказатьВопрос() или поддерживаемый async/await.');
        }
    }
    return issues;
}
