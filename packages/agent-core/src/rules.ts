import type { Risk } from './types.ts'

export type RuleEffect = 'allow' | 'ask' | 'deny'
export type RuleScope = 'once' | 'thread' | 'session' | 'always'

export interface ApprovalRule {
  id?: string
  tool?: string
  risk?: Risk[]
  effect: RuleEffect
  scope?: RuleScope
  pathPrefix?: string
  reason?: string
}

export interface RuleDecision {
  effect: RuleEffect
  rule?: ApprovalRule
  reason?: string
}

/** Deterministic rule engine: deny > ask > allow; first match within an effect level wins. */
export class RuleEngine {
  private rules: ApprovalRule[]
  constructor(rules: ApprovalRule[] = []) {
    this.rules = rules
  }

  setRules(rules: ApprovalRule[]): void {
    this.rules = [...rules]
  }

  addRule(rule: ApprovalRule): void {
    this.rules.push(rule)
  }

  list(): ApprovalRule[] {
    return [...this.rules]
  }

  evaluate(input: { tool: string; risk: Risk; args?: Record<string, unknown> }): RuleDecision | undefined {
    const matched = this.rules.filter((rule) => this.matches(rule, input))
    if (matched.length === 0) return undefined
    for (const effect of ['deny', 'ask', 'allow'] as RuleEffect[]) {
      const hit = matched.find((rule) => rule.effect === effect)
      if (hit) return { effect, rule: hit, reason: hit.reason }
    }
    return undefined
  }

  private matches(rule: ApprovalRule, input: { tool: string; risk: Risk; args?: Record<string, unknown> }): boolean {
    if (rule.tool && !globMatch(rule.tool, input.tool)) return false
    if (rule.risk && rule.risk.length > 0 && !rule.risk.includes(input.risk)) return false
    if (rule.pathPrefix) {
      const path = String(input.args?.path ?? input.args?.file ?? '')
      if (!path.startsWith(rule.pathPrefix)) return false
    }
    return true
  }
}

export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  return re.test(value)
}

export interface GrantPersistence {
  load(): { sessionId: string; tool: string }[]
  save(grant: { sessionId: string; tool: string }): void
  remove(sessionId: string, tool: string): void
}

/** Session-scoped grants: "allow this tool for this session", plus optional persisted "always" grants. */
export class GrantStore {
  private once = new Set<string>()
  private session = new Map<string, Set<string>>()
  private always = new Set<string>()
  private persistence?: GrantPersistence

  attachPersistence(persistence: GrantPersistence): void {
    this.persistence = persistence
    for (const grant of persistence.load()) this.session.get(grant.sessionId)?.add(grant.tool) ?? this.always.add(grant.tool)
  }

  grantAlways(tool: string, sessionId = '*'): void {
    this.always.add(tool)
    this.persistence?.save({ sessionId, tool })
  }

  /** Persist a session grant as always (survives restarts). */
  promoteToAlways(sessionId: string, tool: string): void {
    this.always.add(tool)
    this.persistence?.save({ sessionId, tool })
  }

  key(sessionId: string, tool: string): string {
    return `${sessionId}::${tool}`
  }

  grantOnce(sessionId: string, tool: string): void {
    this.once.add(this.key(sessionId, tool))
  }

  grantSession(sessionId: string, tool: string): void {
    const set = this.session.get(sessionId) ?? new Set<string>()
    set.add(tool)
    this.session.set(sessionId, set)
  }

  /** Consumes a once-grant if present; returns true when the call is pre-approved. */
  consume(sessionId: string, tool: string): boolean {
    const key = this.key(sessionId, tool)
    if (this.once.delete(key)) return true
    if (this.always.has(tool)) return true
    return this.session.get(sessionId)?.has(tool) ?? false
  }

  clear(sessionId?: string): void {
    if (!sessionId) { this.once.clear(); this.session.clear(); this.always.clear(); return }
    for (const key of [...this.once]) if (key.startsWith(`${sessionId}::`)) this.once.delete(key)
    this.session.delete(sessionId)
  }
}
