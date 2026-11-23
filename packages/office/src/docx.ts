import { createZip } from './zip.ts'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function paragraph(text: string, opts: { bold?: boolean; size?: number; heading?: boolean } = {}): string {
  const runProps = [
    opts.bold || opts.heading ? '<w:b/>' : '',
    opts.size ? `<w:sz w:val="${opts.size}"/>` : opts.heading ? '<w:sz w:val="32"/>' : '',
  ].join('')
  const pPr = opts.heading ? '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' : ''
  return `<w:p>${pPr}<w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`
}

/** Build a .docx from markdown-ish text: "# " headings, "- " bullets, blank lines. */
export function buildDocx(markdown: string, title = 'jaryn document'): Buffer {
  const body: string[] = []
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) { body.push('<w:p/>'); continue }
    if (/^#\s+/.test(line)) body.push(paragraph(line.replace(/^#\s+/, ''), { heading: true }))
    else if (/^[-*]\s+/.test(line)) body.push(paragraph('• ' + line.replace(/^[-*]\s+/, '')))
    else if (/^\d+\.\s+/.test(line)) body.push(paragraph(line))
    else body.push(paragraph(line))
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`
  return createZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: document },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(title)}</dc:title></cp:coreProperties>` },
  ])
}
