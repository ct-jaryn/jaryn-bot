import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool, Risk } from '@jaryn/agent-core'

export interface ConnectorToolConfig {
  name: string
  description: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  risk?: Risk
  inputSchema?: object
  bodyFromArgs?: boolean
}

export interface ConnectorAuth {
  type: 'bearer' | 'api_key'
  header?: string
  env?: string
}

export interface ConnectorServerConfig {
  id: string
  name: string
  baseUrl: string
  auth?: ConnectorAuth
  headers?: Record<string, string>
  tools: ConnectorToolConfig[]
}

export interface ConnectorsConfig {
  servers?: ConnectorServerConfig[]
}

function authHeader(server: ConnectorServerConfig): Record<string, string> {
  if (!server.auth) return {}
  const value = server.auth.env ? process.env[server.auth.env] : undefined
  if (!value) return {}
  if (server.auth.type === 'bearer') return { authorization: `Bearer ${value}` }
  return { [server.auth.header ?? 'x-api-key']: value }
}

export class ConnectorService {
  private servers: ConnectorServerConfig[]
  constructor(config: ConnectorsConfig = {}) {
    this.servers = config.servers ?? []
  }

  list(): { id: string; name: string; tools: string[] }[] {
    return this.servers.map((s) => ({ id: s.id, name: s.name, tools: s.tools.map((t) => `${s.id}.${t.name}`) }))
  }

  tools(): Tool[] {
    const out: Tool[] = []
    for (const server of this.servers) {
      for (const tool of server.tools) {
        out.push({
          name: `${server.id}.${tool.name}`,
          description: `[${server.name}] ${tool.description}`,
          risk: tool.risk ?? 'network',
          schema: tool.inputSchema ?? { type: 'object', properties: {} },
          execute: async (args) => this.call(server, tool, args),
        })
      }
    }
    return out
  }

  private async call(server: ConnectorServerConfig, tool: ConnectorToolConfig, args: Record<string, unknown>): Promise<unknown> {
    let path = tool.path.replace(/:([a-zA-Z_][\w]*)/g, (_m, key: string) => encodeURIComponent(String(args[key] ?? '')))
    const method = tool.method ?? 'GET'
    const rest = { ...args }
    for (const key of Object.keys(args)) if (path.includes(String(args[key]))) delete rest[key]
    let body: string | undefined
    if (method !== 'GET' && tool.bodyFromArgs !== false) body = JSON.stringify(rest)
    const res = await fetch(new URL(path, server.baseUrl), {
      method,
      headers: {
        'content-type': 'application/json',
        ...(server.headers ?? {}),
        ...authHeader(server),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`connector ${server.id}.${tool.name} HTTP ${res.status}: ${text.slice(0, 300)}`)
    try { return JSON.parse(text) } catch { return { status: res.status, text: text.slice(0, 4000) } }
  }
}

export function buildAuthorizeUrl(server: ConnectorServerConfig & { auth: { type: 'oauth2'; authorizeUrl: string; clientId: string; redirectUri: string; scopes: string[] } }, state: string): string {
  const url = new URL(server.auth.authorizeUrl)
  url.searchParams.set('client_id', server.auth.clientId)
  url.searchParams.set('redirect_uri', server.auth.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', server.auth.scopes.join(' '))
  url.searchParams.set('state', state)
  return url.toString()
}

export function connectorsPlugin(cfg: ConnectorsConfig = {}): Plugin<ConnectorsConfig> {
  return definePlugin({
    name: '@jaryn/connectors',
    provides: ['connectors'],
    inject: ['tools'],
    apply(ctx, config = {}) {
      const service = new ConnectorService({ servers: [...(cfg.servers ?? []), ...(config.servers ?? [])] })
      ctx.provide('connectors', service)
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      for (const tool of service.tools()) ctx.effect(() => tools.register(tool))
    },
  })
}
