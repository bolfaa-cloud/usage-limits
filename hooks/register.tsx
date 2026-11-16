import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { LimitItem } from '../types'

const LABELS: Record<string, string> = {
  five_hour: '5ч',
  seven_day: 'Неделя',
  spend_limit: 'Расход',
}
const ORDER = ['five_hour', 'seven_day']
const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const items = atom({ plugin: 'usage-limits', key: 'items' } as const, [] as LimitItem[])

const pad = (n: number) => String(n).padStart(2, '0')

function rank(kind: string): number {
  const i = ORDER.indexOf(kind)
  return i === -1 ? ORDER.length : i
}

function untilText(ms: number): string {
  if (ms <= 0) return 'сейчас'
  const totalMin = Math.ceil(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${pad(m)}м`
  return `${m}м`
}

function atText(at: Date, now: Date): string {
  const hm = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  return at.toDateString() === now.toDateString() ? hm : `${DAYS[at.getDay()]} ${hm}`
}

function toItems(limits: SessionRateLimit[], nowMs: number): LimitItem[] {
  const now = new Date(nowMs)
  return [...limits]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map(l => {
      let reset = ''
      if (l.resetsAt) {
        const at = new Date(l.resetsAt)
        reset = `сброс через ${untilText(at.getTime() - nowMs)} (${atText(at, now)})`
      }
      return { name: LABELS[l.kind] ?? l.kind, percent: l.percentUsed, reset }
    })
}

function levelColor(p: number): 'success' | 'warning' | 'error' {
  if (p >= 80) return 'error'
  if (p >= 50) return 'warning'
  return 'success'
}

const BAR = 12

function barParts(p: number): [string, string] {
  const filled = Math.max(0, Math.min(BAR, Math.round((p / 100) * BAR)))
  return ['▰'.repeat(filled), '▱'.repeat(BAR - filled)]
}

let limits: SessionRateLimit[] = []
let ticking = false

async function refresh($: EngineInterface) {
  const next = toItems(limits, await $.clock.now())
  await update($, items, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined)
    try {
      limits = (await $.session.usage()).rateLimits
    } catch {}
    await refresh($)
    if (!ticking) {
      ticking = true
      $.clock.every(60_000, () => refresh($))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || limits.length === 0) {
      limits = e.rateLimits
      await refresh($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, items)

    if (list.length === 0) {
      return (
        <Box>
          <Text dimColor>Лимиты Claude: ждём первый ответ модели…</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.map(item => {
          const color = levelColor(item.percent)
          const [full, empty] = barParts(item.percent)
          return (
            <Box key={item.name} flexDirection="row" columnGap={1}>
              <Box width={7}>
                <Text weight="bold">{item.name}</Text>
              </Box>
              <Text>
                <Text color={color}>{full}</Text>
                <Text color="subtle">{empty}</Text>
              </Text>
              <Box width={5} justifyContent="flex-end">
                <Text color={color} weight="bold">
                  {Math.round(item.percent)}%
                </Text>
              </Box>
              {item.reset ? <Text dimColor> {item.reset}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
