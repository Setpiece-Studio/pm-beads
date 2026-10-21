// ABOUTME: Inbox excludes message-only, mention-only, and ordinary agent activity.
import { expect, test } from '@playwright/test'
import { readSeed, runBd, sendMessage } from './support/bd'

test('only asks reach the inbox, even through retired tab and unread URLs', async ({ page }) => {
  const { alphaId } = readSeed()
  await sendMessage({ subject: 'About Alpha', body: 'Question.', to: 'ben', from: 'agent-alpha', issueId: alphaId })
  await sendMessage({ subject: 'Standalone handoff', body: 'Hello.', to: 'ben', from: 'agent-alpha' })
  await runBd(['comment', alphaId, '--actor', 'agent-alpha', '--', '@ben please look at this'])
  await page.goto('/inbox?tab=activity&scope=agents&unread=true')
  await expect(page.getByText('No open asks.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Agents|Mine|Mark.*read/i })).toHaveCount(0)
  await expect(page.getByText('Standalone handoff')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Open asks' })).toHaveCount(0)
})
