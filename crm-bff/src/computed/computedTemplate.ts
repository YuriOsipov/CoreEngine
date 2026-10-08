/**
 * Computed-field template evaluator (BFF copy).
 * Dialect compatible with https://github.com/rezo-labs/directus-extension-computed-interface
 */

const TEMPLATE_BLOCK = /\{\{([\s\S]*?)\}\}/g

function isString(value: unknown): value is string {
  return typeof value === 'string' || value instanceof String
}

export function findValueByPath(
  obj: Record<string, unknown>,
  path: string,
): { value: unknown; found: boolean } {
  let value: unknown = obj
  for (const segment of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return { value: null, found: false }
    }
    const record = value as Record<string, unknown>
    if (!(segment in record)) {
      return { value: null, found: false }
    }
    value = record[segment]
  }
  return { value, found: true }
}

export function parseOp(exp: string): { op: string; args: string[] } | null {
  const match = exp.trim().match(/^([A-Z_]+)\((.+)\)$/)
  if (!match) return null

  const args: string[] = []
  const op = match[1]
  const innerExp = match[2]

  let braceCount = 0
  let i = 0
  let j = 0
  let inQuote = false
  let escapeNext = false

  for (; i < innerExp.length; i += 1) {
    const c = innerExp[i]
    if (c === '(' && !inQuote) braceCount += 1
    else if (c === ')' && !inQuote) braceCount -= 1
    else if (c === ',' && !inQuote && braceCount === 0) {
      args.push(innerExp.slice(j, i).trim())
      j = i + 1
    } else if (c === '"' && !escapeNext) inQuote = !inQuote
    else if (c === '\\' && inQuote) {
      escapeNext = true
      continue
    }
    escapeNext = false
  }

  if (j < i) {
    args.push(innerExp.slice(j, i).trim())
  }

  return { op, args }
}

function toSlug(str: unknown): string {
  if (typeof str !== 'string') return ''

  let res = str.replace(/^\s+|\s+$/g, '').toLowerCase()
  const from =
    'àáãảạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệđùúủũụưừứửữựòóỏõọôồốổỗộơờớởỡợìíỉĩịäëïîöüûñçýỳỹỵỷ'
  const to =
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeduuuuuuuuuuuoooooooooooooooooiiiiiaeiiouuncyyyyy'
  for (let i = 0, l = from.length; i < l; i += 1) {
    res = res.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i))
  }

  return res
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function parseExpression(
  exp: string,
  values: Record<string, unknown>,
  defaultValues: Record<string, unknown> = {},
): unknown {
  if (!values) return ''

  exp = exp.trim()

  if (exp.startsWith('"') && exp.endsWith('"')) {
    return exp.slice(1, -1).replace(/\\"/g, '"')
  }

  const resolved = findValueByPath(values, exp)
  if (resolved.found && resolved.value !== null) {
    return resolved.value
  }

  const defaults = findValueByPath(defaultValues, exp)
  if (defaults.found) {
    return defaults.value
  }

  if (exp === '$NOW') {
    return new Date()
  }

  if (exp.startsWith('$CURRENT_USER')) {
    if (exp === '$CURRENT_USER') {
      return (values.__currentUser as { id?: unknown } | undefined)?.id
    }
    return findValueByPath({ $CURRENT_USER: values.__currentUser }, exp).value
  }

  const opMatch = parseOp(exp)
  if (opMatch) {
    const { op, args } = opMatch

    if (args.length === 1) {
      const valueA = parseExpression(args[0], values, defaultValues)
      if (op === 'INT') return parseInt(String(valueA), 10)
      if (op === 'FLOAT') return parseFloat(String(valueA))
      if (op === 'STRING') return String(valueA)
      if (op === 'DATE') return new Date(String(valueA))
      if (op === 'SLUG') return toSlug(valueA)
      if (op === 'CURRENCY') return new Intl.NumberFormat().format(Number(valueA))
      if (op === 'ABS') return Math.abs(Number(valueA))
      if (op === 'SQRT') return Math.sqrt(Number(valueA))
      if (op === 'SUM' && Array.isArray(valueA)) {
        return valueA.reduce((partialSum, a) => partialSum + Number(a), 0)
      }
      if (op === 'AVERAGE' && Array.isArray(valueA)) {
        return (
          valueA.reduce((partialSum, a) => partialSum + Number(a), 0) /
          valueA.length
        )
      }
      if (op === 'CEIL') return Math.ceil(Number(valueA))
      if (op === 'FLOOR') return Math.floor(Number(valueA))
      if (op === 'ROUND') return Math.round(Number(valueA))
      if (op === 'EXP') return Math.exp(Number(valueA))
      if (op === 'LOG') return Math.log(Number(valueA))
      if (op === 'MAX' && Array.isArray(valueA)) {
        return Math.max(...valueA.map(Number))
      }
      if (op === 'MIN' && Array.isArray(valueA)) {
        return Math.min(...valueA.map(Number))
      }
      if (op === 'NULL') return valueA === null
      if (op === 'NOT_NULL') return valueA !== null
      if (op === 'NOT') return !valueA
      if (op === 'LENGTH' && (Array.isArray(valueA) || isString(valueA))) {
        return valueA.length
      }
      if (op === 'FIRST' && (Array.isArray(valueA) || isString(valueA))) {
        return valueA[0]
      }
      if (op === 'LAST' && (Array.isArray(valueA) || isString(valueA))) {
        return valueA[valueA.length - 1]
      }
      if (op === 'JSON_PARSE') return JSON.parse(String(valueA))
      if (op === 'JSON_STRINGIFY') return JSON.stringify(valueA)
    } else if (args.length === 2) {
      const valueA = parseExpression(args[0], values, defaultValues)
      const valueB = parseExpression(args[1], values, defaultValues)

      if (op === 'SUM') return Number(valueA) + Number(valueB)
      if (op === 'SUBTRACT') return Number(valueA) - Number(valueB)
      if (op === 'MULTIPLY') return Number(valueA) * Number(valueB)
      if (op === 'DIVIDE') return Number(valueA) / Number(valueB)
      if (op === 'REMAINDER') return Number(valueA) % Number(valueB)
      if (op === 'DATE_ADD_DAYS') {
        const base =
          valueA instanceof Date ? new Date(valueA.getTime()) : new Date(String(valueA ?? ''))
        const days = Number(valueB)
        if (!Number.isFinite(base.getTime()) || !Number.isFinite(days)) return null
        base.setUTCHours(0, 0, 0, 0)
        base.setUTCDate(base.getUTCDate() + days)
        return base.toISOString()
      }
      if (op === 'MAX') return Math.max(Number(valueA), Number(valueB))
      if (op === 'MIN') return Math.min(Number(valueA), Number(valueB))
      if (op === 'POWER') return Math.pow(Number(valueA), Number(valueB))
      if (op === 'CONCAT') {
        if (Array.isArray(valueA)) return valueA.concat(valueB as never)
        return String(valueA) + String(valueB)
      }
      if (op === 'EQUAL') return valueA === valueB
      if (op === 'NOT_EQUAL') return valueA !== valueB
      if (op === 'GT') return Number(valueA) > Number(valueB)
      if (op === 'GTE') return Number(valueA) >= Number(valueB)
      if (op === 'LT') return Number(valueA) < Number(valueB)
      if (op === 'LTE') return Number(valueA) <= Number(valueB)
      if (op === 'AND') return valueA && valueB
      if (op === 'OR') return valueA || valueB
      if (
        op === 'JSON_GET' &&
        typeof valueA === 'object' &&
        valueA !== null &&
        !Array.isArray(valueA)
      ) {
        return findValueByPath(valueA as Record<string, unknown>, String(valueB))
          .value
      }
    } else if (args.length === 3) {
      const valueA = parseExpression(args[0], values, defaultValues)
      const valueB = parseExpression(args[1], values, defaultValues)
      const valueC = parseExpression(args[2], values, defaultValues)
      if (op === 'IF') return valueA === true ? valueB : valueC
    } else if (args.length % 2 === 0 && op === 'IFS') {
      for (let i = 0; i < args.length; i += 2) {
        if (parseExpression(args[i], values, defaultValues) === true) {
          return parseExpression(args[i + 1], values, defaultValues)
        }
      }
      return null
    }
  }

  if (!Number.isNaN(parseFloat(exp))) {
    return parseFloat(exp)
  }

  return ''
}

/** Evaluate a computed-field template against a record. */
export function evaluateComputedTemplate(
  template: string,
  values: Record<string, unknown>,
): unknown {
  const trimmed = template.trim()
  if (!trimmed) return null

  const blocks = [...trimmed.matchAll(TEMPLATE_BLOCK)]
  if (blocks.length === 0) return null

  if (blocks.length === 1 && blocks[0][0] === trimmed) {
    return parseExpression(blocks[0][1].trim(), values)
  }

  const rendered = trimmed.replace(
    TEMPLATE_BLOCK,
    (_match, expression: string) => {
      const result = parseExpression(String(expression).trim(), values)
      return result === null || result === undefined ? '' : String(result)
    },
  )

  const numeric = Number(rendered)
  if (
    rendered !== '' &&
    Number.isFinite(numeric) &&
    /^-?\d*(\.\d+)?([eE][+-]?\d+)?$/.test(rendered.trim())
  ) {
    return numeric
  }

  return rendered
}
