import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDocx, buildPptx, buildXlsx, readZip } from '../src/index.ts'

const names = (buf: Buffer) => [...readZip(buf).keys()].sort()

test('docx package has required parts and text', () => {
  const buf = buildDocx('# 标题\n\n正文一段\n- 要点一\n- 要点二', '测试')
  const files = readZip(buf)
  assert.ok(files.has('[Content_Types].xml'))
  assert.ok(files.has('_rels/.rels'))
  const doc = files.get('word/document.xml')!.toString('utf8')
  assert.match(doc, /标题/)
  assert.match(doc, /要点一/)
  assert.match(files.get('[Content_Types].xml')!.toString(), /wordprocessingml/)
})

test('xlsx package has sheet with inline strings and numbers', () => {
  const buf = buildXlsx([['名称', '数量'], ['苹果', 3], ['梨', 5]], '统计')
  const files = readZip(buf)
  assert.ok(files.has('xl/workbook.xml'))
  const sheet = files.get('xl/worksheets/sheet1.xml')!.toString('utf8')
  assert.match(sheet, /苹果/)
  assert.match(sheet, /<v>3<\/v>/)
  assert.match(files.get('xl/workbook.xml')!.toString(), /统计/)
})

test('pptx package has master, layout, theme and slides', () => {
  const buf = buildPptx([{ title: '封面', bullets: ['第一点'] }, { title: '第二页', bullets: ['A', 'B'] }])
  const files = names(buf)
  for (const part of ['ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/_rels/presentation.xml.rels']) {
    assert.ok(files.includes(part), `missing ${part}`)
  }
  const slide = readZip(buf).get('ppt/slides/slide1.xml')!.toString('utf8')
  assert.match(slide, /封面/)
  assert.match(slide, /第一点/)
})
