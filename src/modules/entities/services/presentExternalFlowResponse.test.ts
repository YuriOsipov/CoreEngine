import { describe, expect, it } from 'vitest'
import { presentExternalFlowResponse } from './presentExternalFlowResponse'

function harness() {
  const toasts: Array<{ severity: string; detail: string }> = []
  let refreshed = false
  let opened: File | null = null
  return {
    toasts,
    opened: () => opened,
    refreshed: () => refreshed,
    present: (
      body: unknown,
      options?: { refreshAfterRun?: boolean; previewFile?: boolean; attachFile?: boolean },
    ) =>
      presentExternalFlowResponse({
        body,
        successMessage: 'Layout success.',
        refreshAfterRun: options?.refreshAfterRun !== false,
        previewFile: options?.previewFile === true,
        attachFile: options?.attachFile === true,
        refresh: async () => {
          refreshed = true
        },
        toast: {
          add: (message) => {
            toasts.push({ severity: message.severity, detail: message.detail })
          },
        },
        t: (_key, fallback) => fallback ?? _key,
        openFile: (file) => {
          opened = file
        },
        saveFile: async (file) => {
          opened = file
          toasts.push({ severity: 'success', detail: 'saved' })
        },
      }),
  }
}

describe('presentExternalFlowResponse', () => {
  it('toasts an error and skips refresh when Success is false', async () => {
    const run = harness()
    const outcome = await run.present({
      sync: true,
      result: { Success: false, Message: 'Rejected.' },
    })
    expect(outcome).toBe('error')
    expect(run.toasts).toEqual([{ severity: 'error', detail: 'Rejected.' }])
    expect(run.refreshed()).toBe(false)
    expect(run.opened()).toBeNull()
  })

  it('stays silent when a sync file is shown even if Message is set', async () => {
    const run = harness()
    await run.present(
      {
        sync: true,
        Success: true,
        Message: 'Quote sent.',
        FileName: 'note.txt',
        Data: 'aGk=',
      },
      { previewFile: true },
    )
    expect(run.toasts).toEqual([])
    expect(run.opened()?.name).toBe('note.txt')
  })

  it('opens the file without a toast when the sync response is shown', async () => {
    const run = harness()
    const outcome = await run.present(
      {
        sync: true,
        Success: true,
        FileName: '813-536x354.jpg',
        Data: 'aGk=',
      },
      { previewFile: true },
    )
    expect(outcome).toBe('success')
    expect(run.toasts).toEqual([])
    expect(run.opened()?.name).toBe('813-536x354.jpg')
    expect(run.refreshed()).toBe(true)
  })

  it('does not open or save a file unless the action options are on', async () => {
    const run = harness()
    await run.present({
      sync: true,
      Success: true,
      Message: 'Quote sent.',
      FileName: 'note.txt',
      Data: 'aGk=',
    })
    expect(run.opened()).toBeNull()
    expect(run.toasts).toEqual([{ severity: 'success', detail: 'Quote sent.' }])
  })

  it('saves without a preview when only attach is on', async () => {
    const run = harness()
    await run.present(
      {
        sync: true,
        Success: true,
        Message: 'Quote sent.',
        FileName: 'note.txt',
        Data: 'aGk=',
      },
      { attachFile: true },
    )
    expect(run.opened()?.name).toBe('note.txt')
    expect(run.toasts.map((item) => item.detail)).toEqual(['Quote sent.', 'saved'])
  })

  it('toasts the action Success message when the flow is not sync', async () => {
    const run = harness()
    const outcome = await run.present(
      {
        Success: true,
        Message: 'Quote sent.',
        FileName: 'note.txt',
        Data: 'aGk=',
      },
      { previewFile: true, attachFile: true },
    )
    expect(outcome).toBe('success')
    expect(run.toasts).toEqual([{ severity: 'success', detail: 'Layout success.' }])
    expect(run.opened()).toBeNull()
    expect(run.refreshed()).toBe(true)
  })
})
