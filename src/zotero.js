const toCreator = author => {
  const name = String(author ?? '').trim();
  const separator = name.lastIndexOf(' ');
  if (separator < 0) return { creatorType: 'author', name };
  return {
    creatorType: 'author',
    firstName: name.slice(0, separator),
    lastName: name.slice(separator + 1),
  };
};

export function toZoteroItems(papers) {
  return papers.map(paper => ({
    itemType: 'journalArticle',
    title: paper.title,
    creators: paper.authors.map(toCreator),
    date: paper.year,
    publicationTitle: paper.venue,
    DOI: paper.doi,
    url: paper.detailUrl,
    abstractNote: paper.snippet,
    attachments: paper.pdfUrl ? [{
      title: 'Full Text PDF',
      url: paper.pdfUrl,
      mimeType: 'application/pdf',
    }] : [],
  }));
}

export function buildZoteroRequest(papers) {
  return {
    url: 'http://127.0.0.1:23119/connector/saveItems',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Zotero-Connector-API-Version': '3',
      },
      body: JSON.stringify({ items: toZoteroItems(papers) }),
    },
  };
}
