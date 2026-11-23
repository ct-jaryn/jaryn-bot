import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool, ToolRunContext } from '@jaryn/agent-core'
import { buildDocx } from './docx.ts'
import { buildXlsx } from './xlsx.ts'
import { buildPptx } from './pptx.ts'
import type { SheetCell } from './xlsx.ts'

export { buildDocx } from './docx.ts'
export { buildXlsx } from './xlsx.ts'
export type { SheetCell } from './xlsx.ts'
export { buildPptx } from './pptx.ts'
export type { Slide } from './pptx.ts'
export { createZip, readZip, crc32 } from './zip.ts'

async function writeInside(cwd: string, path: string, data: Buffer): Promise<{ path: string; bytes: number }> {
  const root = resolve(cwd)
  const target = resolve(root, path)
  if (relative(root, target).startsWith('..')) throw new Error(`path escapes workspace: ${path}`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data)
  return { path: relative(root, target), bytes: data.length }
}

export function officeTools(): Tool[] {
  return [
    {
      name: 'office.docx',
      description: 'Create a Word .docx from markdown-ish text (headings, bullets, paragraphs).',
      risk: 'write',
      schema: { type: 'object', properties: { path: { type: 'string' }, markdown: { type: 'string' }, title: { type: 'string' } }, required: ['path', 'markdown'] },
      async execute(args: any, ctx: ToolRunContext) {
        return await writeInside(ctx.cwd, String(args.path), buildDocx(String(args.markdown), args.title ? String(args.title) : undefined))
      },
    },
    {
      name: 'office.xlsx',
      description: 'Create an Excel .xlsx from rows (first row is the header).',
      risk: 'write',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
          sheet: { type: 'string' },
        },
        required: ['path', 'rows'],
      },
      async execute(args: any, ctx: ToolRunContext) {
        const rows = (args.rows ?? []) as SheetCell[][]
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('rows must be a non-empty array')
        return await writeInside(ctx.cwd, String(args.path), buildXlsx(rows, args.sheet ? String(args.sheet) : undefined))
      },
    },
    {
      name: 'office.pptx',
      description: 'Create a PowerPoint .pptx from slides (title + bullets).',
      risk: 'write',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } },
              required: ['title'],
            },
          },
        },
        required: ['path', 'slides'],
      },
      async execute(args: any, ctx: ToolRunContext) {
        const slides = (args.slides ?? []) as { title: string; bullets?: string[] }[]
        if (!Array.isArray(slides) || slides.length === 0) throw new Error('slides must be a non-empty array')
        return await writeInside(ctx.cwd, String(args.path), buildPptx(slides))
      },
    },
  ]
}

export function officePlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/office',
    inject: ['tools'],
    apply(ctx) {
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      for (const tool of officeTools()) ctx.effect(() => tools.register(tool))
    },
  })
}
