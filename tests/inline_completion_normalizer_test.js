// Unit tests for normalizeInlineCompletion (Prompt 4).
// Pure module: no VS Code API, no I/O, no mocks needed.
const assert = require('node:assert/strict');
const { normalizeInlineCompletion } = require('../out/inlineCompletionNormalizer');

const input = (overrides = {}) => ({
  prefix: '',
  suffix: '',
  currentLineBeforeCursor: '',
  maxLines: 20,
  maxChars: 1000,
  ...overrides,
});

function run() {
  // 1. plain BSL continuation passes through untouched, high confidence
  {
    const r = normalizeInlineCompletion('Сообщить("Готово");', input());
    assert.ok(r);
    assert.equal(r.text, 'Сообщить("Готово");');
    assert.equal(r.confidence, 'high');
    assert.equal(r.removedWrapper, false);
    assert.equal(r.lineCount, 1);
    assert.equal(r.charCount, Array.from('Сообщить("Готово");').length);
  }
  console.log('  ✓ plain BSL continuation (high confidence)');

  // 2. fenced BSL block is unwrapped
  {
    const r = normalizeInlineCompletion('```bsl\nСообщить("ok");\n```', input());
    assert.ok(r);
    assert.equal(r.text, 'Сообщить("ok");');
    assert.equal(r.confidence, 'medium');
    assert.equal(r.removedWrapper, true);
  }
  console.log('  ✓ fenced BSL unwrapped');

  // 3. fenced code without language is unwrapped
  {
    const r = normalizeInlineCompletion('```\nИтог = Итог + 1;\n```', input());
    assert.ok(r);
    assert.equal(r.text, 'Итог = Итог + 1;');
  }
  console.log('  ✓ fenceless-language block unwrapped');

  // 4. Russian explanation with colon intro is removed, code extracted
  {
    const r = normalizeInlineCompletion('Вот продолжение кода:\nСообщить("Готово");', input());
    assert.ok(r);
    assert.equal(r.text, 'Сообщить("Готово");');
    assert.equal(r.confidence, 'medium');
  }
  console.log('  ✓ Russian intro explanation removed');

  // 4b. deictic intro without colon is removed; bare BSL words survive
  {
    const r = normalizeInlineCompletion('Вот код\nСообщить("x");', input());
    assert.ok(r);
    assert.equal(r.text, 'Сообщить("x");');
    const bare = normalizeInlineCompletion('Результат', input());
    assert.ok(bare, 'bare identifier must not be eaten as an intro');
  }
  console.log('  ✓ colonless intro removed, bare identifiers kept');

  // 5. prefix echo is deduplicated (anchored, no inner rewrite).
  //    NB: prefix carries the pre-cursor code, so `"ok");` correctly closes it.
  {
    const r = normalizeInlineCompletion('Сообщить("ok");',
      input({ prefix: 'Процедура Т()\n    Сообщить(', currentLineBeforeCursor: '    Сообщить(' }));
    assert.ok(r);
    assert.equal(r.text, '"ok");');
  }
  console.log('  ✓ prefix echo deduplicated');

  // 6. pure echo of the current line is dropped
  {
    assert.equal(normalizeInlineCompletion('Сообщить(',
      input({ currentLineBeforeCursor: 'Сообщить(' })), null);
  }
  console.log('  ✓ pure echo returns null');

  // 7. duplicated suffix is removed
  {
    const r = normalizeInlineCompletion('Сообщить("x");\nКонецЕсли;',
      input({ suffix: 'КонецЕсли;\nКонецПроцедуры' }));
    assert.ok(r);
    assert.equal(r.text, 'Сообщить("x");');
  }
  console.log('  ✓ suffix duplication removed');

  // 8. multiline procedure passes intact
  {
    const proc = 'Процедура Обработать() Экспорт\n\tЗапрос = Новый Запрос;\n\tЗапрос.Выполнить();\nКонецПроцедуры';
    const r = normalizeInlineCompletion(proc, input());
    assert.ok(r);
    assert.equal(r.text, proc);
    assert.equal(r.lineCount, 4);
  }
  console.log('  ✓ multiline procedure intact');

  // 9. Cyrillic strings with parens/semicolons inside quotes are untouched
  {
    const raw = 'Строка = "Текст (в скобках) и ; точка";';
    const r = normalizeInlineCompletion(raw, input());
    assert.ok(r);
    assert.equal(r.text, raw, 'string literal must survive byte-identical');
  }
  console.log('  ✓ quoted strings with syntax chars preserved');

  // 10. comments with syntax chars do not break parsing; comment + code kept
  {
    const raw = '// вызов (тест); проверка\nСообщить("x");';
    const r = normalizeInlineCompletion(raw, input());
    assert.ok(r);
    assert.equal(r.text, raw);
  }
  console.log('  ✓ comments with parens kept alongside code');

  // 11. empty / whitespace / non-string responses are dropped
  {
    assert.equal(normalizeInlineCompletion('', input()), null);
    assert.equal(normalizeInlineCompletion('   \n  \n', input()), null);
    assert.equal(normalizeInlineCompletion(undefined, input()), null);
    assert.equal(normalizeInlineCompletion('```\n```', input()), null);
  }
  console.log('  ✓ empty responses return null');

  // 12. JSON responses are dropped
  {
    assert.equal(normalizeInlineCompletion('{"code": "Сообщить();"}', input()), null);
    assert.equal(normalizeInlineCompletion('```json\n{"a": 1}\n```', input()), null);
    assert.equal(normalizeInlineCompletion('[1, 2, 3]', input()), null);
  }
  console.log('  ✓ JSON responses return null');

  // 13. oversized responses are dropped (lines and chars)
  {
    const three = 'Сообщить(1);\nСообщить(2);\nСообщить(3);';
    assert.equal(normalizeInlineCompletion(three, input({ maxLines: 2 })), null);
    assert.equal(normalizeInlineCompletion('Сообщить("длинная строка");', input({ maxChars: 10 })), null);
    assert.ok(normalizeInlineCompletion(three, input({ maxLines: 3 })));
  }
  console.log('  ✓ oversized responses return null');

  // 14. malformed responses: unbalanced brackets and unclosed quotes.
  //    (`Если (А > Б Тогда` without `;` is a tolerated continuation, not an
  //    obvious break — a full BSL parser is explicitly out of scope.)
  {
    assert.equal(normalizeInlineCompletion('Сообщить("x";', input()), null);
    assert.equal(normalizeInlineCompletion('Если (А > Б Тогда;', input({ prefix: '' })), null);
    assert.equal(normalizeInlineCompletion('Сообщить("oops);', input()), null);
    assert.equal(normalizeInlineCompletion('Таблица[0;', input()), null);
    assert.ok(normalizeInlineCompletion('Если (А > Б Тогда', input({ prefix: '' })),
      'unterminated control line is a continuation, not an obvious break');
  }
  console.log('  ✓ unbalanced brackets/quotes return null');

  // 14b. escaped quotes do NOT count as unclosed
  {
    const raw = 'Сообщить("экранированная ""кавычка"" ок");';
    const r = normalizeInlineCompletion(raw, input());
    assert.ok(r);
    assert.equal(r.text, raw);
  }
  console.log('  ✓ escaped BSL quotes accepted');

  // 15. valid control-flow continuations pass
  {
    assert.ok(normalizeInlineCompletion('Если Условие Тогда', input()));
    assert.ok(normalizeInlineCompletion('Для Каждого Стр Из Таблица Цикл', input()));
    assert.ok(normalizeInlineCompletion('Попытка', input()));
    assert.ok(normalizeInlineCompletion('Иначе', input()));
    assert.ok(normalizeInlineCompletion('Возврат Истина;', input()));
  }
  console.log('  ✓ Если / Для Каждого / Попытка continuations pass');

  // 16. comments-only responses carry no completable code
  {
    assert.equal(normalizeInlineCompletion('// просто комментарий', input()), null);
    assert.equal(normalizeInlineCompletion('// один\n// два', input()), null);
  }
  console.log('  ✓ comments-only returns null');

  // 17. markdown explanations are dropped (headers, quotes, lists, tables)
  {
    assert.equal(normalizeInlineCompletion('# Продолжение\nСообщить("x");', input()), null);
    assert.equal(normalizeInlineCompletion('> вот код\nСообщить("x");', input()), null);
    assert.equal(normalizeInlineCompletion('- Сообщить("x");', input()), null);
    assert.equal(normalizeInlineCompletion('| a | b |\n|---|---|', input()), null);
    assert.equal(normalizeInlineCompletion('Сообщить("x");\nНадеюсь, это поможет', input()), null);
  }
  console.log('  ✓ markdown/plain-text explanations return null');

  // 18. no accidental removal of meaningful code
  {
    const r = normalizeInlineCompletion('СообщитьВФайл("x");',
      input({ currentLineBeforeCursor: 'Сообщить(' }));
    assert.ok(r, 'similar-but-different identifier must survive');
    assert.equal(r.text, 'СообщитьВФайл("x");');
    const q = normalizeInlineCompletion('Запрос = Новый Запрос;',
      input({ currentLineBeforeCursor: 'Другое = 1;' }));
    assert.ok(q);
    assert.equal(q.text, 'Запрос = Новый Запрос;');
  }
  console.log('  ✓ no accidental removal of meaningful code');

  // 19. stray fences and braces outside strings are rejected; braces in strings OK
  {
    assert.equal(normalizeInlineCompletion('Сообщить("x"); ```', input()), null);
    assert.equal(normalizeInlineCompletion('Данные = {ключ: 1};', input()), null);
    const ok = normalizeInlineCompletion('Шаблон = "{Имя}";', input());
    assert.ok(ok, 'braces inside string literals are legal');
  }
  console.log('  ✓ stray fences/braces rejected, in-string braces kept');

  // 20. block balance is prefix-aware (closers need openers)
  {
    const withOpener = normalizeInlineCompletion('Сообщить("x");\nКонецЕсли;',
      input({ prefix: 'Если Ошибка Тогда\n\tСообщить("x");' }));
    assert.ok(withOpener, 'closer matching a prefix opener is valid');
    assert.equal(normalizeInlineCompletion('КонецЕсли;', input({ prefix: '' })), null);
  }
  console.log('  ✓ prefix-aware block balance');

  // 21. directives and preprocessor lines are code, never stripped
  {
    const r = normalizeInlineCompletion('&НаКлиенте\nПроцедура Тест()', input());
    assert.ok(r);
    assert.ok(r.text.includes('&НаКлиенте'));
    assert.ok(normalizeInlineCompletion('#Область МояОбласть', input()));
  }
  console.log('  ✓ directives/preprocessor preserved');

  console.log('Normalizer: 23/23 passed (pure, deterministic).');
}

run();
