const asciiSlug = value => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const escapeBibTeX = value => String(value ?? '').replace(/[{}]/g, '\\$&');

export function toRis(papers) {
  return papers.map(paper => {
    const lines = ['TY  - JOUR'];
    for (const author of paper.authors) lines.push(`AU  - ${author}`);
    lines.push(`TI  - ${paper.title}`);
    if (paper.year) lines.push(`PY  - ${paper.year}`);
    if (paper.venue) lines.push(`JO  - ${paper.venue}`);
    if (paper.doi) lines.push(`DO  - ${paper.doi}`);
    if (paper.detailUrl) lines.push(`UR  - ${paper.detailUrl}`);
    lines.push('ER  - ');
    return lines.join('\n');
  }).join('\n\n');
}

export function toBibTeX(papers) {
  const keyCounts = new Map();

  return papers.map(paper => {
    const surname = paper.authors[0]?.trim().split(/\s+/).at(-1) ?? '';
    const firstTitleWord = paper.title.trim().split(/\s+/)[0] ?? '';
    const baseKey = `${asciiSlug(surname)}${asciiSlug(paper.year)}${asciiSlug(firstTitleWord)}` || 'paper';
    const count = (keyCounts.get(baseKey) ?? 0) + 1;
    keyCounts.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}-${count}`;
    const fields = [
      `  title = {${escapeBibTeX(paper.title)}}`,
      `  author = {${escapeBibTeX(paper.authors.join(' and '))}}`,
    ];
    if (paper.year) fields.push(`  year = {${escapeBibTeX(paper.year)}}`);
    if (paper.venue) fields.push(`  journal = {${escapeBibTeX(paper.venue)}}`);
    if (paper.doi) fields.push(`  doi = {${escapeBibTeX(paper.doi)}}`);
    if (paper.detailUrl) fields.push(`  url = {${escapeBibTeX(paper.detailUrl)}}`);
    return `@article{${key},\n${fields.join(',\n')}\n}`;
  }).join('\n\n');
}

export function toResultJson(papers, results) {
  return JSON.stringify({ generatedAt: new Date().toISOString(), papers, results }, null, 2);
}

export function toDataUrl(text, mime) {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}
