/**
 * Core SOQL subset → CoreEngine findManyRecords params.
 * Never executes SQL; only compiles to Directus-style filter/fields/sort.
 *
 * Supported:
 *   SELECT fields|* FROM entity
 *   [WHERE expr] [ORDER BY field [ASC|DESC], ...] [LIMIT n] [OFFSET n]
 *
 * WHERE: = != > >= < <= LIKE IN IS NULL / IS NOT NULL, AND/OR, parentheses.
 */
import type { RecordsListParams } from '../adapters/records/types.js'
import { MAX_LIST_OFFSET } from './listQueryPolicy.js'

export interface ParsedSoql {
  collection: string
  params: RecordsListParams
}

export class SoqlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoqlParseError'
  }
}

type TokenKind =
  | 'ident'
  | 'number'
  | 'string'
  | 'star'
  | 'comma'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eof'

interface Token {
  kind: TokenKind
  value: string
  raw: string
}

const KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'order',
  'by',
  'asc',
  'desc',
  'limit',
  'offset',
  'and',
  'or',
  'not',
  'in',
  'like',
  'is',
  'null',
  'true',
  'false',
])

const UNSUPPORTED = [
  'group',
  'having',
  'join',
  'inner',
  'left',
  'right',
  'outer',
  'union',
  'insert',
  'update',
  'delete',
  'upsert',
  'with',
  'using',
  'typeof',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'fields',
]

/** PascalCase / camelCase / mixed → snake_case; already-snake stays snake. */
export function toSnakeIdent(raw: string): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return trimmed
  if (trimmed.includes('_') && trimmed === trimmed.toLowerCase()) {
    return trimmed.toLowerCase()
  }
  const withUnderscores = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  return withUnderscores.replace(/[-\s]+/g, '_').toLowerCase()
}

function normalizeFieldPath(path: string): string {
  return path
    .split('.')
    .map((part) => toSnakeIdent(part.trim()))
    .filter(Boolean)
    .join('.')
}

function tokenize(input: string): Token[] {
  const src = input.trim()
  if (!src) throw new SoqlParseError('SOQL query is empty')
  const tokens: Token[] = []
  let i = 0

  const push = (kind: TokenKind, value: string, raw = value) => {
    tokens.push({ kind, value, raw })
  }

  while (i < src.length) {
    const ch = src[i]!

    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    if (ch === "'") {
      i += 1
      let value = ''
      while (i < src.length) {
        const c = src[i]!
        if (c === "'") {
          if (src[i + 1] === "'") {
            value += "'"
            i += 2
            continue
          }
          i += 1
          break
        }
        value += c
        i += 1
      }
      push('string', value, `'${value}'`)
      continue
    }

    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < src.length && /[0-9]/.test(src[i + 1]!))) {
      let raw = ''
      while (i < src.length && /[0-9.]/.test(src[i]!)) {
        raw += src[i]
        i += 1
      }
      push('number', raw)
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let raw = ''
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) {
        raw += src[i]
        i += 1
      }
      push('ident', raw)
      continue
    }

    if (ch === '*') {
      push('star', '*')
      i += 1
      continue
    }
    if (ch === ',') {
      push('comma', ',')
      i += 1
      continue
    }
    if (ch === '.') {
      push('dot', '.')
      i += 1
      continue
    }
    if (ch === '(') {
      push('lparen', '(')
      i += 1
      continue
    }
    if (ch === ')') {
      push('rparen', ')')
      i += 1
      continue
    }
    if (ch === '!' && src[i + 1] === '=') {
      push('neq', '!=')
      i += 2
      continue
    }
    if (ch === '<' && src[i + 1] === '>') {
      push('neq', '<>')
      i += 2
      continue
    }
    if (ch === '>' && src[i + 1] === '=') {
      push('gte', '>=')
      i += 2
      continue
    }
    if (ch === '<' && src[i + 1] === '=') {
      push('lte', '<=')
      i += 2
      continue
    }
    if (ch === '=') {
      push('eq', '=')
      i += 1
      continue
    }
    if (ch === '>') {
      push('gt', '>')
      i += 1
      continue
    }
    if (ch === '<') {
      push('lt', '<')
      i += 1
      continue
    }

    throw new SoqlParseError(`Unexpected character "${ch}" in SOQL`)
  }

  push('eof', '')
  return tokens
}

class Parser {
  private pos = 0
  private predicates = 0
  private nesting = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: 'eof', value: '', raw: '' }
  }

  private advance(): Token {
    const tok = this.peek()
    if (tok.kind !== 'eof') this.pos += 1
    return tok
  }

  private matchIdent(...words: string[]): boolean {
    const tok = this.peek()
    if (tok.kind !== 'ident') return false
    const lower = tok.value.toLowerCase()
    if (!words.includes(lower)) return false
    this.advance()
    return true
  }

  private expectIdent(...words: string[]): string {
    const tok = this.peek()
    if (tok.kind !== 'ident') {
      throw new SoqlParseError(`Expected ${words.join('/')}, got ${tok.kind}`)
    }
    const lower = tok.value.toLowerCase()
    if (words.length && !words.includes(lower)) {
      throw new SoqlParseError(`Expected ${words.join('/')}, got "${tok.value}"`)
    }
    this.advance()
    return tok.value
  }

  private expect(kind: TokenKind, label?: string): Token {
    const tok = this.peek()
    if (tok.kind !== kind) {
      throw new SoqlParseError(`Expected ${label ?? kind}, got ${tok.kind}`)
    }
    return this.advance()
  }

  private rejectUnsupportedKeywords(): void {
    for (const tok of this.tokens) {
      if (tok.kind !== 'ident') continue
      const lower = tok.value.toLowerCase()
      if (UNSUPPORTED.includes(lower)) {
        throw new SoqlParseError(
          `Unsupported SOQL keyword "${tok.value}" in this subset`,
        )
      }
    }
  }

  parse(): ParsedSoql {
    this.rejectUnsupportedKeywords()
    this.expectIdent('select')

    const fields = this.parseSelectFields()

    if (!this.matchIdent('from')) {
      const tok = this.peek()
      if (tok.kind === 'ident' || tok.kind === 'dot' || tok.kind === 'star') {
        throw new SoqlParseError(
          `Expected FROM after SELECT fields (missing comma between fields?). Got "${tok.raw || tok.value}"`,
        )
      }
      throw new SoqlParseError(
        `Expected FROM after SELECT fields, got ${tok.kind}${tok.raw ? ` "${tok.raw}"` : ''}`,
      )
    }
    const collectionRaw = this.expectIdent()
    if (KEYWORDS.has(collectionRaw.toLowerCase())) {
      throw new SoqlParseError(`Invalid FROM entity "${collectionRaw}"`)
    }
    const collection = toSnakeIdent(collectionRaw)

    let filter: Record<string, unknown> | null = null
    if (this.matchIdent('where')) {
      filter = this.parseOrExpr()
    }

    let sort: string[] | null = null
    if (this.matchIdent('order')) {
      this.expectIdent('by')
      sort = this.parseOrderBy()
    }

    let limit: number | undefined
    if (this.matchIdent('limit')) {
      limit = this.parseIntLiteral('LIMIT')
    }

    let offset: number | undefined
    if (this.matchIdent('offset')) {
      offset = this.parseIntLiteral('OFFSET')
    }

    if (this.peek().kind !== 'eof') {
      throw new SoqlParseError(
        `Unexpected token "${this.peek().raw || this.peek().kind}" after SOQL query`,
      )
    }

    return {
      collection,
      params: {
        fields,
        filter,
        sort,
        limit: limit ?? 100,
        offset: offset ?? 0,
      },
    }
  }

  /**
   * SELECT * → null (all columns).
   * SELECT *, account_id.name → ['*', 'account_id.name'] (all + relation expand).
   * SELECT id, name → ['id', 'name'].
   */
  private parseSelectFields(): string[] | null {
    const fields: string[] = []
    let sawStar = false

    const pushItem = () => {
      if (this.peek().kind === 'star') {
        this.advance()
        sawStar = true
        if (!fields.includes('*')) fields.push('*')
        return
      }
      fields.push(this.parseFieldPath())
    }

    pushItem()
    while (this.peek().kind === 'comma') {
      this.advance()
      pushItem()
    }

    if (!fields.length) {
      throw new SoqlParseError('SELECT requires at least one field')
    }
    if (fields.length > SOQL_LIMITS.maxSelectFields) {
      throw new SoqlParseError(`SELECT must list <= ${SOQL_LIMITS.maxSelectFields} fields`)
    }
    if (sawStar && fields.length === 1) return null
    return fields
  }

  private parseFieldPath(): string {
    const parts: string[] = [this.expectIdent()]
    while (this.peek().kind === 'dot') {
      this.advance()
      parts.push(this.expectIdent())
    }
    if (parts.length - 1 > SOQL_LIMITS.maxRelationDepth) {
      throw new SoqlParseError(
        `Relation paths must be <= ${SOQL_LIMITS.maxRelationDepth} levels deep`,
      )
    }
    return normalizeFieldPath(parts.join('.'))
  }

  private parseOrderBy(): string[] {
    const sort: string[] = []
    for (;;) {
      const field = this.parseFieldPath()
      let desc = false
      if (this.matchIdent('desc')) desc = true
      else this.matchIdent('asc')
      sort.push(desc ? `-${field}` : field)
      if (this.peek().kind !== 'comma') break
      this.advance()
    }
    return sort
  }

  private parseIntLiteral(label: string): number {
    const tok = this.expect('number', label)
    const n = Number(tok.value)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new SoqlParseError(`${label} must be a non-negative integer`)
    }
    return n
  }

  private parseOrExpr(): Record<string, unknown> {
    const parts: Record<string, unknown>[] = [this.parseAndExpr()]
    while (this.matchIdent('or')) {
      parts.push(this.parseAndExpr())
    }
    if (parts.length === 1) return parts[0]!
    return { _or: parts }
  }

  private parseAndExpr(): Record<string, unknown> {
    const parts: Record<string, unknown>[] = [this.parsePrimaryExpr()]
    while (this.matchIdent('and')) {
      parts.push(this.parsePrimaryExpr())
    }
    if (parts.length === 1) return parts[0]!
    return { _and: parts }
  }

  private parsePrimaryExpr(): Record<string, unknown> {
    if (this.peek().kind === 'lparen') {
      this.advance()
      this.nesting += 1
      if (this.nesting > SOQL_LIMITS.maxNestingDepth) {
        throw new SoqlParseError(
          `WHERE parentheses must nest <= ${SOQL_LIMITS.maxNestingDepth} levels`,
        )
      }
      const inner = this.parseOrExpr()
      this.expect('rparen', ')')
      this.nesting -= 1
      return inner
    }
    this.predicates += 1
    if (this.predicates > SOQL_LIMITS.maxPredicates) {
      throw new SoqlParseError(`WHERE must have <= ${SOQL_LIMITS.maxPredicates} conditions`)
    }
    return this.parseComparison()
  }

  private parseComparison(): Record<string, unknown> {
    const field = this.parseFieldPath()

    if (this.matchIdent('is')) {
      const negated = this.matchIdent('not')
      this.expectIdent('null')
      return { [field]: negated ? { _nnull: true } : { _null: true } }
    }

    if (this.matchIdent('like')) {
      const patternTok = this.expect('string', 'LIKE pattern')
      return { [field]: likeToOp(patternTok.value) }
    }

    if (this.matchIdent('in')) {
      this.expect('lparen', '(')
      const values: unknown[] = []
      if (this.peek().kind === 'rparen') {
        throw new SoqlParseError('IN list cannot be empty')
      }
      for (;;) {
        values.push(this.parseLiteral())
        if (values.length > SOQL_LIMITS.maxInListValues) {
          throw new SoqlParseError(`IN lists must have <= ${SOQL_LIMITS.maxInListValues} values`)
        }
        if (this.peek().kind !== 'comma') break
        this.advance()
      }
      this.expect('rparen', ')')
      return { [field]: { _in: values } }
    }

    if (this.matchIdent('not')) {
      this.expectIdent('in')
      this.expect('lparen', '(')
      const values: unknown[] = []
      if (this.peek().kind === 'rparen') {
        throw new SoqlParseError('NOT IN list cannot be empty')
      }
      for (;;) {
        values.push(this.parseLiteral())
        if (values.length > SOQL_LIMITS.maxInListValues) {
          throw new SoqlParseError(`IN lists must have <= ${SOQL_LIMITS.maxInListValues} values`)
        }
        if (this.peek().kind !== 'comma') break
        this.advance()
      }
      this.expect('rparen', ')')
      return { [field]: { _nin: values } }
    }

    const opTok = this.peek()
    const opMap: Partial<Record<TokenKind, string>> = {
      eq: '_eq',
      neq: '_neq',
      gt: '_gt',
      gte: '_gte',
      lt: '_lt',
      lte: '_lte',
    }
    const op = opMap[opTok.kind]
    if (!op) {
      throw new SoqlParseError(
        `Expected comparison operator after "${field}", got ${opTok.kind}`,
      )
    }
    this.advance()
    const value = this.parseLiteral()
    return { [field]: { [op]: value } }
  }

  private parseLiteral(): unknown {
    const tok = this.peek()
    if (tok.kind === 'string') {
      this.advance()
      return tok.value
    }
    if (tok.kind === 'number') {
      this.advance()
      const n = Number(tok.value)
      if (!Number.isFinite(n)) {
        throw new SoqlParseError(`Invalid number "${tok.value}"`)
      }
      return n
    }
    if (tok.kind === 'ident') {
      const lower = tok.value.toLowerCase()
      if (lower === 'true') {
        this.advance()
        return true
      }
      if (lower === 'false') {
        this.advance()
        return false
      }
      if (lower === 'null') {
        this.advance()
        return null
      }
    }
    throw new SoqlParseError(`Expected literal, got ${tok.kind}`)
  }
}

function likeToOp(pattern: string): Record<string, unknown> {
  const hasLeading = pattern.startsWith('%')
  const hasTrailing = pattern.endsWith('%')
  const inner = pattern.replace(/^%/, '').replace(/%$/, '')
  if (pattern.includes('%', 1) && pattern.indexOf('%') !== pattern.length - 1) {
    // middle wildcards → contains on stripped % for best-effort
    return { _contains: pattern.replace(/%/g, '') }
  }
  if (hasLeading && hasTrailing) {
    return { _contains: inner }
  }
  if (!hasLeading && hasTrailing) {
    return { _starts_with: inner }
  }
  if (hasLeading && !hasTrailing) {
    return { _contains: inner }
  }
  return { _eq: pattern }
}

/** Cost guards — keep in sync with docs/README (SOQL subset). */
export const SOQL_LIMITS = {
  maxQueryLength: 8_000,
  maxTokens: 1_000,
  maxSelectFields: 100,
  maxRelationDepth: 3,
  maxPredicates: 100,
  maxNestingDepth: 8,
  maxInListValues: 500,
} as const

export function parseSoql(query: string): ParsedSoql {
  if (query.length > SOQL_LIMITS.maxQueryLength) {
    throw new SoqlParseError(`SOQL query must be <= ${SOQL_LIMITS.maxQueryLength} characters`)
  }
  const tokens = tokenize(query)
  if (tokens.length > SOQL_LIMITS.maxTokens) {
    throw new SoqlParseError(`SOQL query must be <= ${SOQL_LIMITS.maxTokens} tokens`)
  }
  const parsed = new Parser(tokens).parse()
  if ((parsed.params.offset ?? 0) > MAX_LIST_OFFSET) {
    throw new SoqlParseError(`OFFSET must be <= ${MAX_LIST_OFFSET}`)
  }
  return parsed
}
