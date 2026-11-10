const fs = require('fs'), path = require('path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
if(!process.argv[2]) throw new Error('Pass an empty isolated lab directory, mounted as /lab in the 1C container.');
const base=path.resolve(process.argv[2]);
const fixture=path.join(__dirname,'fixture');
if(fs.existsSync(path.join(base,'config'))) throw new Error('Refusing to overwrite an existing lab/config. Use a new lab directory.');
fs.mkdirSync(base,{recursive:true});fs.cpSync(fixture,path.join(base,'config'),{recursive:true});
const cli=process.env.TOOLBOX_CLI || path.join(root,'dist/toolbox-cli.js');
function tool(name,args){
 const response=JSON.parse(execFileSync(process.execPath,[cli],{input:JSON.stringify({name,arguments:args}),encoding:'utf8'}));
 if(response.error)throw new Error(response.error);return response.result;
}
const bslString=value=>'"'+value.replace(/"/g,'""').replace(/\n/g,'\n|')+'"';
async function main(){
 const metadata=tool('1c_scan_metadata',{workspacePath:base+'/config'});
 const common={entityName:'Заказ',tabularSection:'Товары',registerName:'ТоварыНаСкладах',fields:['Номенклатура=Товар','Склад','Количество=Вес'],includeScaffolding:true,workspacePath:base+'/config'};
 const variants={Текущие:{...common,sourceMode:'table'},Шапка:{...common,sourceMode:'table',fields:['Номенклатура=Товар','Склад=@СкладШапки','Количество=Вес']},Сохранённые:{...common,sourceMode:'document'}};
 let module='';
 for(const [name,options] of Object.entries(variants)){
  const code=tool('1c_build_batch_query',options).queryCode;fs.writeFileSync(base+'/generated-'+name+'.bsl',code);
  module+=`Функция Дефицит${name}(Док, ПериодКонтроля)\nТовары = Док.Товары;\nСкладШапки = Док.СкладШапки;\nСсылка = Док.Ссылка;\n${code}\nВозврат ТаблицаДефицита;\nКонецФункции\n\n`;
 }
 const originalQuery='ВЫБРАТЬ Д.Товар КАК Товар, Ост.КоличествоОстаток КАК Остаток ИЗ Документ.Заказ.Товары КАК Д ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки(&Дата,) КАК Ост ПО Д.Товар = Ост.Номенклатура И Д.Склад = Ост.Склад ГДЕ Д.Ссылка = &Ссылка УПОРЯДОЧИТЬ ПО Товар';
 const refactored=tool('1c_refactor_query',{rawQuery:originalQuery});if(!refactored.appliedOptimizations.length)throw Error('Refactoring fixture was refused');
 fs.writeFileSync(base+'/refactor-original.txt',originalQuery);fs.writeFileSync(base+'/refactor-result.txt',refactored.refactoredQuery);
 module+=`Процедура ПроверитьПреобразование(Док)
 ЗапросА = Новый Запрос(${bslString(originalQuery)});
 ЗапросА.УстановитьПараметр("Дата", Дата(2026,1,3)); ЗапросА.УстановитьПараметр("Ссылка",Док.Ссылка);
 А = ЗапросА.Выполнить().Выгрузить();
 ЗапросБ = Новый Запрос(${bslString(refactored.refactoredQuery)});
 ЗапросБ.МенеджерВременныхТаблиц = Новый МенеджерВременныхТаблиц;
 ЗапросБ.УстановитьПараметр("Дата", Дата(2026,1,3)); ЗапросБ.УстановитьПараметр("Ссылка",Док.Ссылка);
 Пакет = ЗапросБ.ВыполнитьПакет(); Б = Пакет[1].Выгрузить();
 Утверждение(А.Количество() = Б.Количество(), "refactor row count differs");
 Для Индекс = 0 По А.Количество()-1 Цикл
  Утверждение(А[Индекс].Товар = Б[Индекс].Товар, "refactor dimension differs");
  Утверждение(ТипЗнч(А[Индекс].Остаток) = ТипЗнч(Б[Индекс].Остаток), "refactor changed field type / NULL");
  Утверждение(Строка(А[Индекс].Остаток) = Строка(Б[Индекс].Остаток), "refactor changed value");
 КонецЦикла;
 Утверждение(ТипЗнч(Б[1].Остаток) = Тип("Null"), "missing balance NULL was not preserved");
КонецПроцедуры
`;
 module+=`Процедура Утверждение(Условие, Текст)
 Если Не Условие Тогда ВызватьИсключение Текст; КонецЕсли;
КонецПроцедуры

Функция Заказ(Товар = "A", Склад = "W1", Вес = 8)
 Док = Документы.Заказ.СоздатьДокумент();
 Док.Дата = Дата(2026,1,2,12,0,0);
 Док.СкладШапки = "W1";
 СтрокаТовара = Док.Товары.Добавить();
 СтрокаТовара.Товар = Товар; СтрокаТовара.Склад = Склад; СтрокаТовара.Вес = Вес;
 Возврат Док;
КонецФункции

Процедура ОстаткиДляТеста()
 Запрос = Новый Запрос("ВЫБРАТЬ Ссылка ИЗ Документ.Заказ");
 Для Каждого СтрокаДок Из Запрос.Выполнить().Выгрузить() Цикл
  СтарыйНабор = РегистрыНакопления.ТоварыНаСкладах.СоздатьНаборЗаписей();
  СтарыйНабор.Отбор.Регистратор.Установить(СтрокаДок.Ссылка); СтарыйНабор.Записать();
  Объект = СтрокаДок.Ссылка.ПолучитьОбъект(); Объект.Удалить();
 КонецЦикла;
 Док = Документы.Заказ.СоздатьДокумент(); Док.Дата = Дата(2026,1,1,12,0,0); Док.Записать();
 Набор = РегистрыНакопления.ТоварыНаСкладах.СоздатьНаборЗаписей();
 Набор.Отбор.Регистратор.Установить(Док.Ссылка);
 Для Индекс = 1 По 2 Цикл
  Движение = Набор.Добавить(); Движение.Период = Док.Дата;
  Движение.ВидДвижения = ВидДвиженияНакопления.Приход; Движение.Номенклатура = "A";
  Движение.Склад = ?(Индекс = 1, "W1", "W2"); Движение.Количество = ?(Индекс = 1, 10, 3);
 КонецЦикла;
 Набор.Записать();
КонецПроцедуры

Процедура ЗапуститьПроверки() Экспорт
 Журнал = Новый ЗаписьТекста("/lab/query-results.txt", КодировкаТекста.UTF8);
 Попытка
  ОстаткиДляТеста();
  Журнал.ЗаписатьСтроку("PASS|seed|10 at W1, 3 at W2");
 Исключение
  Журнал.ЗаписатьСтроку("FAIL|seed|" + ОписаниеОшибки()); Журнал.Закрыть(); Возврат;
 КонецПопытки;
 Период = Дата(2026,1,3);
`;
 const cases={
  sufficient:`Р = ДефицитТекущие(Заказ(), Период); Утверждение(Р.Количество() = 0, "enough stock must have no deficit");`,
  deficit:`Р = ДефицитТекущие(Заказ("A","W1",12), Период); Утверждение(Р.Количество() = 1, "one deficit expected"); Утверждение(Р[0].Дефицит = 2, "12 - 10 must equal 2");`,
  duplicates:`Док = Заказ("A","W1",6); Док.Товары.Загрузить(Док.Товары.Выгрузить()); С = Док.Товары.Добавить(); С.Товар="A"; С.Склад="W1"; С.Вес=6; Р=ДефицитТекущие(Док,Период); Утверждение(Р.Количество() = 1, "duplicates must aggregate"); Утверждение(Р[0].Требуется = 12 И Р[0].Дефицит = 2, "duplicates lost");`,
  missing_balance:`Р=ДефицитТекущие(Заказ("B","W1",1),Период); Утверждение(Р.Количество() = 1, "missing balance must remain visible"); Утверждение(Р[0].Доступно = 0 И Р[0].Дефицит = 1, "NULL must become zero");`,
  warehouse_separation:`Док=Заказ("A","W1",8); С=Док.Товары.Добавить(); С.Товар="A"; С.Склад="W2"; С.Вес=5; Р=ДефицитТекущие(Док,Период); Утверждение(Р.Количество() = 1, "warehouse stock mixed"); Утверждение(Р[0].Склад = "W2" И Р[0].Дефицит = 2, "wrong warehouse deficit");`,
  header_mapping:`Док=Заказ("A","W2",12); Р=ДефицитШапка(Док,Период); Утверждение(Р.Количество() = 1, "header result missing"); Утверждение(Р[0].Склад = "W1" И Р[0].Доступно = 10 И Р[0].Дефицит = 2, "header mapping ignored");`,
  unsaved_rows:`Док=Заказ("A","W1",6); Док.Записать(); Док.Товары[0].Вес=12; Р=ДефицитТекущие(Док,Период); Утверждение(Р.Количество()=1 И Р[0].Дефицит=2,"current changes not read"); Р=ДефицитСохранённые(Док,Период); Утверждение(Р.Количество()=0,"saved-source contract violated");`,
  empty_rows:`Док=Заказ(); Док.Товары.Очистить(); Р=ДефицитТекущие(Док,Период); Утверждение(Р.Количество()=0,"empty rows should be empty result");`,
  period_boundary:`Р=ДефицитТекущие(Заказ("A","W1",1),Дата(2025,1,1)); Утверждение(Р.Количество()=1 И Р[0].Доступно=0,"future balances leaked into period");`,
  refactor_equivalence:`Док=Заказ("A","W1",1); С=Док.Товары.Добавить(); С.Товар="B"; С.Склад="W1"; С.Вес=1; Док.Записать(); ПроверитьПреобразование(Док);`,
  posting_boundary:`Док=Заказ("A","W1",8); Док.Записать(); Набор=РегистрыНакопления.ТоварыНаСкладах.СоздатьНаборЗаписей(); Набор.Отбор.Регистратор.Установить(Док.Ссылка); С=Набор.Добавить(); С.Период=Док.Дата; С.ВидДвижения=ВидДвиженияНакопления.Расход; С.Номенклатура="A"; С.Склад="W1"; С.Количество=4; Набор.Записать(); Р=ДефицитТекущие(Док,Новый Граница(Док.МоментВремени(),ВидГраницы.Исключая)); Утверждение(Р.Количество()=0,"boundary must exclude own movements"); Р=ДефицитТекущие(Док,Период); Утверждение(Р.Количество()=1 И Р[0].Дефицит=2,"explicit after-movement period must include own movement");`
 };
 for(const [id,code] of Object.entries(cases)) module+=` Попытка\n ${code}\n Журнал.ЗаписатьСтроку("PASS|${id}");\n Исключение\n Журнал.ЗаписатьСтроку("FAIL|${id}|" + ОписаниеОшибки());\n КонецПопытки;\n`;
 module+=' Журнал.Закрыть();\nКонецПроцедуры\n';
 fs.mkdirSync(base+'/config/CommonModules/Проверки/Ext',{recursive:true});
 fs.writeFileSync(base+'/config/CommonModules/Проверки/Ext/Module.bsl',module);
 fs.writeFileSync(base+'/case-manifest.json',JSON.stringify({schema:metadata,cases:Object.keys(cases)},null,2));
 console.log('Generated exact product query scaffolds and '+Object.keys(cases).length+' engine scenarios.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
