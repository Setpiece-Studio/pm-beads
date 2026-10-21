// ABOUTME: TanStack Start server functions exposing the beads queries and mutations to the
// ABOUTME: client, with zod-validated inputs. projectDir is optional and guarded; absent
// ABOUTME: means the env-default project (PM_BEADS_PROJECT_DIR).

import { homedir } from 'node:os'
import { basename } from 'node:path'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { VIEW_ROUTES } from '@/components/views/view-params'
import { issuesWithOpenAsks } from './asks'
import { beadsProjectDir } from './cli'
import { createDraftSchema } from './create-draft'
import { createWorkspaceIssue } from './create-workspace-issue'
import { stoppedDoltServerError } from './dolt-server'
import { markActivityRead, markActivityUnread } from './inbox-store'
import { humanAddresses, messageScopes } from './messages'
import {
  addComment,
  addDependency,
  addLabel,
  answerAsk,
  clearPrUrl,
  closeIssue,
  commentAsViewer,
  createIssue,
  createSubIssue,
  deleteMemory,
  guardedTextFieldSchema,
  markMessageRead,
  markMessagesRead,
  markMessageUnread,
  relateIssues,
  removeDependency,
  removeLabel,
  saveTextField,
  sendAcknowledgment,
  sendMessage,
  setPrUrl,
  unrelateIssues,
  updateIssue,
  updateIssueFieldsSchema,
} from './mutations'
import {
  personasSchema,
  readNotifierConfig,
  replacePersonas,
} from './notifier-store'
import {
  applyPrBackfill,
  scanPrBackfill,
  skipPrBackfill,
} from './pr-backfill-run'
import { resolvePrRef } from './pr-remote'
import { getPrState } from './pr-state'
import { sweepMergedPrs } from './pr-sweep-run'
import { bdOptionsFor, discoverProjects, parseScanDirs } from './projects'
import {
  getIssue,
  getIssueActivity,
  getMemory,
  getThread,
  listEpics,
  listIssueComments,
  listIssues,
  listMemories,
  listMessages,
  readActivityInbox,
  readInbox,
} from './queries'
import {
  readSyncConfig,
  readSyncStatus,
  resolveSyncConflict,
  syncProject,
} from './remote-sync'
import { updateSidecar } from './sidecar'
import { readStatusPipeline } from './status-config'
import { deleteView, readViews, saveView } from './views-store'

const projectDir = z.string().optional()

function selectedProjectDir(dir: string | undefined): string {
  return bdOptionsFor(dir).cwd ?? beadsProjectDir()
}

export const readPersonasFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(
    ({ data }) =>
      readNotifierConfig(selectedProjectDir(data?.projectDir)).personas,
  )

export const currentUserFn = createServerFn({ method: 'GET' }).handler(() => {
  const [key, ...aliases] = humanAddresses()
  return { key: key as string, aliases }
})

export const replacePersonasFn = createServerFn({ method: 'POST' })
  .validator(z.object({ personas: personasSchema, projectDir }))
  .handler(({ data }) =>
    replacePersonas(selectedProjectDir(data.projectDir), data.personas),
  )

const listIssuesInput = z
  .object({
    statuses: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    parent: z.string().optional(),
    directParent: z.string().optional(),
    all: z.boolean().optional(),
    projectDir,
  })
  .optional()

export const listIssuesFn = createServerFn({ method: 'GET' })
  .validator(listIssuesInput)
  .handler(({ data }) => {
    const { projectDir: dir, ...filters } = data ?? {}
    return listIssues(filters, bdOptionsFor(dir))
  })

export const getIssueFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) => getIssue(data.id, bdOptionsFor(data.projectDir)))

export const readStatusPipelineFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(({ data }) => readStatusPipeline(bdOptionsFor(data?.projectDir)))

export const listEpicsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(({ data }) => listEpics(bdOptionsFor(data?.projectDir)))

export const listIssueCommentsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) =>
    listIssueComments(data.id, bdOptionsFor(data.projectDir)),
  )

export const getIssueActivityFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) =>
    getIssueActivity(data.id, bdOptionsFor(data.projectDir)),
  )

export const addCommentFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      text: z.string().trim().min(1),
      projectDir,
    }),
  )
  .handler(({ data }) =>
    addComment(data.id, data.text.trim(), bdOptionsFor(data.projectDir)),
  )
const listMessagesInput = z
  .object({
    scope: z.enum(messageScopes).optional(),
    includeClosed: z.boolean().optional(),
    projectDir,
  })
  .optional()

export const listMessagesFn = createServerFn({ method: 'GET' })
  .validator(listMessagesInput)
  .handler(({ data }) => {
    const { projectDir: dir, ...filters } = data ?? {}
    return listMessages(filters, bdOptionsFor(dir))
  })

export const getThreadFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) => getThread(data.id, bdOptionsFor(data.projectDir)))

/** The inbox route's whole payload for one scope: viewer address plus reply threads. */
export const readInboxFn = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({ scope: z.enum(messageScopes).optional(), projectDir })
      .optional(),
  )
  .handler(({ data }) =>
    readInbox({ scope: data?.scope }, bdOptionsFor(data?.projectDir)),
  )

/** The inbox's reply: the same comment write, signed with the viewer's configured address so
 * the feed recognizes Ben's own answer instead of surfacing it back to him. */
export const commentAsViewerFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      text: z.string().trim().min(1),
      projectDir,
    }),
  )
  .handler(({ data }) =>
    commentAsViewer(data.id, data.text.trim(), bdOptionsFor(data.projectDir)),
  )

/** The Activity tab's payload: the feed, its read state, and which fetch path answered. */
export const readActivityInboxFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(({ data }) =>
    readActivityInbox(bdOptionsFor(data?.projectDir).cwd ?? beadsProjectDir()),
  )

const activityReadInput = z.object({
  ids: z.array(z.string().min(1)),
  projectDir,
})

/** Mark activity items read. `since` rides along when the feed was capped, so the sidecar's
 * window floor advances with the read state rather than letting trimmed items resurface. */
export const markActivityReadFn = createServerFn({ method: 'POST' })
  .validator(activityReadInput.extend({ since: z.string().min(1).optional() }))
  .handler(({ data }) =>
    markActivityRead(
      bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir(),
      data.ids,
      data.since,
    ),
  )

export const markActivityUnreadFn = createServerFn({ method: 'POST' })
  .validator(activityReadInput)
  .handler(({ data }) =>
    markActivityUnread(
      bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir(),
      data.ids,
    ),
  )

/** Validate the selected directory and detect an explicitly stopped server without loading issues. */
export const projectAccessStatusFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(async ({ data }) => {
    try {
      const options = bdOptionsFor(data?.projectDir)
      return {
        projectError: await stoppedDoltServerError(
          options.cwd ?? beadsProjectDir(),
        ),
      }
    } catch (error) {
      return { projectError: errorMessage(error) }
    }
  })

/** Background inbox count, read after rendering from the shared project issue snapshot. */
export const projectShellStatusFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(async ({ data }) => {
    try {
      const options = bdOptionsFor(data?.projectDir)
      const stoppedServer = await stoppedDoltServerError(
        options.cwd ?? beadsProjectDir(),
      )
      if (stoppedServer !== null)
        return { openAsks: 0, projectError: stoppedServer }
      const issues = await listIssues({ all: true }, options)
      return { openAsks: issuesWithOpenAsks(issues).length, projectError: null }
    } catch (error) {
      return { openAsks: 0, projectError: errorMessage(error) }
    }
  })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const listMemoriesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(({ data }) => listMemories(bdOptionsFor(data?.projectDir)))

export const getMemoryFn = createServerFn({ method: 'GET' })
  .validator(z.object({ key: z.string().min(1), projectDir }))
  .handler(({ data }) => getMemory(data.key, bdOptionsFor(data.projectDir)))

/** Scans PM_BEADS_SCAN_DIRS for beads projects; always includes the env default. */
export const discoverProjectsFn = createServerFn({ method: 'GET' }).handler(
  () =>
    discoverProjects(
      parseScanDirs(process.env.PM_BEADS_SCAN_DIRS, homedir()),
      beadsProjectDir(),
    ),
)

/** The env-default project (PM_BEADS_PROJECT_DIR / cwd) for sidebar display. */
export const defaultProjectFn = createServerFn({ method: 'GET' }).handler(
  () => {
    const path = beadsProjectDir()
    return { path, name: basename(path) }
  },
)

/** Resolve an optional caller dir to the absolute project dir, .beads-guarded. */
function viewsDirFor(dir: string | undefined): string {
  return bdOptionsFor(dir).cwd ?? beadsProjectDir()
}

const viewParamsInput = z.object({
  view: z.string().optional(),
  grouping: z.string().optional(),
  ordering: z.string().optional(),
  display: z.string().optional(),
  filter: z.string().optional(),
})

export const listViewsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }).optional())
  .handler(({ data }) => readViews(viewsDirFor(data?.projectDir)))

export const saveViewFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().trim().min(1),
      route: z.enum(VIEW_ROUTES),
      params: viewParamsInput,
      projectDir,
    }),
  )
  .handler(({ data }) =>
    saveView(viewsDirFor(data.projectDir), {
      name: data.name.trim(),
      route: data.route,
      params: data.params,
    }),
  )

export const deleteViewFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) => deleteView(viewsDirFor(data.projectDir), data.id))

// Derived from the mutation's own field schema so a field added there cannot go missing here.
// `parent` is omitted on purpose: re-parenting is not something this endpoint offers.
const updateIssueInput = z.object({
  id: z.string().min(1),
  fields: updateIssueFieldsSchema.omit({ parent: true }),
  projectDir,
})

export const updateIssueFn = createServerFn({ method: 'POST' })
  .validator(updateIssueInput)
  .handler(({ data }) =>
    updateIssue(data.id, data.fields, bdOptionsFor(data.projectDir)),
  )

// The guarded counterpart to updateIssueFn, for the five fields an editor replaces wholesale.
// Separate rather than a flag on updateIssueFn because it answers a different question: not
// "did the write fail" but "is the text you are replacing still the text you read".
export const saveTextFieldFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      field: guardedTextFieldSchema,
      value: z.string(),
      baseline: z.string(),
      projectDir,
    }),
  )
  .handler(({ data }) =>
    saveTextField(
      data.id,
      data.field,
      data.value,
      data.baseline,
      bdOptionsFor(data.projectDir),
    ),
  )

export const answerAskFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      key: z.string().min(1),
      answer: z.string().trim().min(1).nullable(),
      projectDir,
    }),
  )
  .handler(({ data }) =>
    answerAsk(
      data.id,
      data.key,
      data.answer,
      humanAddresses()[0],
      bdOptionsFor(data.projectDir),
    ),
  )

export const closeIssueFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      reason: z.string().optional(),
      projectDir,
    }),
  )
  .handler(({ data }) =>
    closeIssue(data.id, data.reason, bdOptionsFor(data.projectDir)),
  )

const createIssueInput = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  priority: z.number().int().min(0).max(4),
  description: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  design: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  notes: z.string().optional(),
  projectDir,
})

export const createIssueFn = createServerFn({ method: 'POST' })
  .validator(createIssueInput)
  .handler(({ data }) => {
    const { projectDir: dir, ...input } = data
    return createIssue(input, bdOptionsFor(dir))
  })

export const createWorkspaceIssueFn = createServerFn({ method: 'POST' })
  .validator(createDraftSchema.extend({ projectDir }))
  .handler(({ data }) => {
    const { projectDir: dir, ...input } = data
    return createWorkspaceIssue(input, bdOptionsFor(dir))
  })

export const readRemoteSyncFn = createServerFn({ method: 'GET' })
  .validator(z.object({ projectDir }))
  .handler(({ data }) => {
    const dir = bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir()
    return { config: readSyncConfig(dir), status: readSyncStatus(dir) }
  })
export const configureRemoteSyncFn = createServerFn({ method: 'POST' })
  .validator(z.object({ projectDir, enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const dir = bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir()
    await updateSidecar(dir, (sidecar) => {
      sidecar.sync = { ...readSyncConfig(dir), enabled: data.enabled }
    })
  })
export const runRemoteSyncFn = createServerFn({ method: 'POST' })
  .validator(z.object({ projectDir }))
  .handler(({ data }) =>
    syncProject(bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir()),
  )
export const resolveRemoteConflictFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectDir,
      token: z.string().min(1),
      side: z.enum(['ours', 'theirs']),
    }),
  )
  .handler(({ data }) =>
    resolveSyncConflict(
      bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir(),
      data.token,
      data.side,
    ),
  )

// Mirrors CreateSubIssueInput: the flat create fields plus the parent to file it under and the
// optional assignee/labels the inline composer's chip row can set at creation time.
const createSubIssueInput = z.object({
  parentId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  priority: z.number().int().min(0).max(4),
  description: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  projectDir,
})

export const createSubIssueFn = createServerFn({ method: 'POST' })
  .validator(createSubIssueInput)
  .handler(({ data }) => {
    const { projectDir: dir, ...input } = data
    return createSubIssue(input, bdOptionsFor(dir))
  })

const sendMessageInput = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  replyTo: z.string().min(1).optional(),
  issueIds: z.array(z.string().min(1)).optional(),
  /** Deprecated single-issue alias for `issueIds`; merged ahead of it by sendMessage. */
  issueId: z.string().min(1).optional(),
  projectDir,
})

export const sendMessageFn = createServerFn({ method: 'POST' })
  .validator(sendMessageInput)
  .handler(({ data }) => {
    const { projectDir: dir, ...input } = data
    return sendMessage(input, bdOptionsFor(dir))
  })

const sendAcknowledgmentInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  issueId: z.string().min(1),
  commentId: z.string().min(1),
  body: z.string().optional(),
  projectDir,
})

/** Agent-facing operation: acknowledge one durable comment with an ephemeral typed receipt. */
export const sendAcknowledgmentFn = createServerFn({ method: 'POST' })
  .validator(sendAcknowledgmentInput)
  .handler(({ data }) => {
    const { projectDir: dir, ...input } = data
    return sendAcknowledgment(input, bdOptionsFor(dir))
  })

export const markMessageReadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) =>
    markMessageRead(data.id, bdOptionsFor(data.projectDir)),
  )

export const markMessagesReadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(z.string().min(1)), projectDir }))
  .handler(({ data }) =>
    markMessagesRead(data.ids, bdOptionsFor(data.projectDir)),
  )

export const markMessageUnreadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) =>
    markMessageUnread(data.id, bdOptionsFor(data.projectDir)),
  )

const labelInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  projectDir,
})

export const addLabelFn = createServerFn({ method: 'POST' })
  .validator(labelInput)
  .handler(({ data }) =>
    addLabel(data.id, data.label, bdOptionsFor(data.projectDir)),
  )

export const removeLabelFn = createServerFn({ method: 'POST' })
  .validator(labelInput)
  .handler(({ data }) =>
    removeLabel(data.id, data.label, bdOptionsFor(data.projectDir)),
  )

const dependencyInput = z.object({
  issueId: z.string().min(1),
  dependsOnId: z.string().min(1),
  type: z.string().min(1),
  projectDir,
})

// Remove takes the same shape minus `type`: bd's remove-dependency is keyed on the edge endpoints.
const removeDependencyInput = dependencyInput.omit({ type: true })

export const addDependencyFn = createServerFn({ method: 'POST' })
  .validator(dependencyInput)
  .handler(({ data }) =>
    addDependency(
      data.issueId,
      data.dependsOnId,
      data.type,
      bdOptionsFor(data.projectDir),
    ),
  )

export const removeDependencyFn = createServerFn({ method: 'POST' })
  .validator(removeDependencyInput)
  .handler(({ data }) =>
    removeDependency(
      data.issueId,
      data.dependsOnId,
      bdOptionsFor(data.projectDir),
    ),
  )

const relateInput = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  projectDir,
})

export const relateFn = createServerFn({ method: 'POST' })
  .validator(relateInput)
  .handler(({ data }) =>
    relateIssues(data.a, data.b, bdOptionsFor(data.projectDir)),
  )

export const unrelateFn = createServerFn({ method: 'POST' })
  .validator(relateInput)
  .handler(({ data }) =>
    unrelateIssues(data.a, data.b, bdOptionsFor(data.projectDir)),
  )

/** Link a PR to a bead. `ref` is whatever the rail's input took — a full url, "#N", or "N" —
 * and is resolved HERE because a bare number needs the project's `git remote get-url origin`,
 * which only the server can read. */
export const setPrUrlFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1),
      ref: z.string().trim().min(1),
      projectDir,
    }),
  )
  .handler(async ({ data }) => {
    const options = bdOptionsFor(data.projectDir)
    const url = await resolvePrRef(
      data.ref.trim(),
      options.cwd ?? beadsProjectDir(),
    )
    return setPrUrl(data.id, url, options)
  })

export const clearPrUrlFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), projectDir }))
  .handler(({ data }) => clearPrUrl(data.id, bdOptionsFor(data.projectDir)))

/** Live PR state for a linked url. Runs gh OUTSIDE the bd mutex — it is a GitHub call, not a
 * bd one, and must not queue behind serialized bd spawns — and fails soft to `unknown`. */
export const getPrStateFn = createServerFn({ method: 'GET' })
  .validator(z.object({ url: z.string().min(1), projectDir }))
  .handler(({ data }) =>
    getPrState(
      data.url,
      bdOptionsFor(data.projectDir).cwd ?? beadsProjectDir(),
    ),
  )

/** Close the open beads whose linked PR has merged, for one project. POST because it writes:
 * a comment and a close per matching bead, each stamped `--actor pm-beads`. `dryRun` returns
 * the same result shape with nothing written, so the toolbar can preview a sweep. */
export const sweepMergedPrsFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ projectDir, dryRun: z.boolean().optional() }).optional(),
  )
  .handler(({ data }) => {
    const options = bdOptionsFor(data?.projectDir)
    return sweepMergedPrs({
      projectDir: options.cwd ?? beadsProjectDir(),
      dryRun: data?.dryRun ?? false,
    })
  })

/**
 * One approved backfill proposal, on the wire. Validated rather than trusted: the comment and
 * close reason are re-derived server-side from these fields (pr-backfill's backfillAction), so
 * nothing a client sends decides what a bead's audit trail says.
 */
const backfillProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.string(),
  issue_type: z.string(),
  prUrl: z.string().min(1),
  prNumber: z.number().int().positive(),
  prTitle: z.string(),
  mergedAt: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  actions: z.tuple([
    z.literal('set-pr-url'),
    z.union([z.literal('close'), z.literal('comment-only')]),
  ]),
  previousPrUrl: z.string().optional(),
})

/** Scan the project's merged PR history into backfill proposals. POST despite writing nothing:
 * it is an explicit, expensive, user-triggered action (one gh call over months of history) and
 * must never be prefetched or cached as a GET would invite. */
export const scanPrBackfillFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ projectDir, daysBack: z.number().optional() }).optional(),
  )
  .handler(({ data }) => {
    const options = bdOptionsFor(data?.projectDir)
    const scan: Parameters<typeof scanPrBackfill>[0] = {
      projectDir: options.cwd ?? beadsProjectDir(),
    }
    if (data?.daysBack !== undefined) scan.daysBack = data.daysBack
    return scanPrBackfill(scan)
  })

/** Apply exactly the proposals a person checked in the review list: pr_url, then a comment and
 * (for a plain open bead) a close, each stamped `--actor pm-beads`. */
export const applyPrBackfillFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ proposals: z.array(backfillProposalSchema), projectDir }),
  )
  .handler(({ data }) => {
    const options = bdOptionsFor(data.projectDir)
    return applyPrBackfill({
      projectDir: options.cwd ?? beadsProjectDir(),
      proposals: data.proposals,
    })
  })

/** Dismiss beads from the review list for good — recorded in the project's sidecar under
 * `backfill.skipped`, so a re-scan never proposes them again. */
export const skipPrBackfillFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(z.string().min(1)), projectDir }))
  .handler(({ data }) => {
    const options = bdOptionsFor(data.projectDir)
    return skipPrBackfill(options.cwd ?? beadsProjectDir(), data.ids)
  })

export const deleteMemoryFn = createServerFn({ method: 'POST' })
  .validator(z.object({ key: z.string().min(1), projectDir }))
  .handler(({ data }) => deleteMemory(data.key, bdOptionsFor(data.projectDir)))
