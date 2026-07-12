export function normalizePaper(raw = {}) {
  const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const authors = Array.isArray(raw.authors) ? raw.authors.map(clean).filter(Boolean) : [];
  const pdfUrl = clean(raw.pdfUrl);
  return { id: clean(raw.id), title: clean(raw.title), authors, year: clean(raw.year), venue: clean(raw.venue), snippet: clean(raw.snippet), detailUrl: clean(raw.detailUrl), pdfUrl, doi: clean(raw.doi), status: pdfUrl ? 'pdf' : 'metadata' };
}

export function matchesAuthor(paper, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  return !needle || paper.authors.some(a => a.toLocaleLowerCase().includes(needle));
}

export function buildPdfFilename(paper) {
  const clean = value => String(value || 'Unknown').replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  const stem = `${clean(paper.authors[0])} - ${clean(paper.year)} - ${clean(paper.title)}`.slice(0, 180).trim();
  return `${stem || 'paper'}.pdf`;
}
