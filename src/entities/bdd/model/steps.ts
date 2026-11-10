import type { BDDScenarioStep, BDDTableColumn } from '../../../bddGenerator';

/** Format explicit user/library steps; no natural-language-to-library guessing. */
export function parseVanessaSteps(text: string): BDDScenarioStep[] {
    const steps: BDDScenarioStep[] = [];
    const keywords: Record<string, BDDScenarioStep['keyword']> = {дано:'Дано',допустим:'Дано',когда:'Когда',тогда:'Тогда',и:'И',но:'Но',given:'Дано',when:'Когда',then:'Тогда',and:'И',but:'Но'};
    let headers: string[] | undefined;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
        const value = line.trim();
        if (!value || value.startsWith('#')) continue;
        const match = value.match(/^(Дано|Допустим|Когда|Тогда|И|Но|Given|When|Then|And|But)\s+(.+)$/i);
        if (match) {
            if (headers && !steps.at(-1)?.table?.length) throw new Error('Таблица шага содержит заголовок без строк данных.');
            steps.push({keyword:keywords[match[1].toLowerCase()],action:match[2]}); headers = undefined; continue; }
        if (value.startsWith('|') && value.endsWith('|') && steps.length) {
            const cells: string[] = []; let cell = '', escaped = false;
            for (const ch of value.slice(1,-1)) {
                if (escaped) { cell += ch === 'n' ? '\n' : ['|','\\'].includes(ch) ? ch : '\\'+ch; escaped = false; }
                else if (ch === '\\') escaped = true;
                else if (ch === '|') { cells.push(cell.trim()); cell = ''; }
                else cell += ch;
            }
            if (escaped) throw new Error(`Шаги Vanessa, строка ${index + 1}: незавершённое экранирование ячейки.`);
            cells.push(cell.trim());
            if (!headers) headers = cells;
            else {
                if (cells.length !== headers.length) throw new Error(`Шаги Vanessa, строка ${index + 1}: число ячеек не совпадает с заголовком.`);
                const row: BDDTableColumn[] = headers.map((name,i) => ({name,value:cells[i]}));
                (steps.at(-1)!.table ||= []).push(row);
            }
            continue;
        }
        throw new Error(`Шаги Vanessa, строка ${index + 1}: ожидается Дано, Когда, Тогда, И или таблица шага.`);
    }
    if (headers && !steps.at(-1)?.table?.length) throw new Error('Таблица шага содержит заголовок без строк данных.');
    return steps;
}
