// ABOUTME: Root route shell — HTML document, global stylesheet, dark-mode init, app nav,
// ABOUTME: and the project picker. Holds the `project` search param shared by all routes.

import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useMatch,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { SearchIcon } from 'lucide-react'
import { useCallback } from 'react'
import { z } from 'zod'
import { DeferredReadStatus } from '@/components/deferred-read-status'
import { MentionProvider } from '@/components/mentions/mention-context'
import { ProjectErrorPanel } from '@/components/project-error'
import { ProjectPicker } from '@/components/project-picker'
import { StatusPipelineProvider } from '@/components/status-pipeline-context'
import { SyncRefresh } from '@/components/sync-refresh'
import { WorkspaceComposer } from '@/components/workspace-composer'
import {
  currentUserFn,
  defaultProjectFn,
  discoverProjectsFn,
  projectAccessStatusFn,
  projectShellStatusFn,
  readPersonasFn,
  readStatusPipelineFn,
} from '@/lib/beads/server-fns'
import { DEFAULT_STATUS_PIPELINE } from '@/lib/beads/status-model'
import { useDeferredRead } from '@/lib/use-deferred-read'

import appCss from '../styles.css?url'

// `data-color-mode` is what @uiw/react-md-editor keys its own syntax palette off. Without it the
// editor falls back to a `prefers-color-scheme` media query, which the stored `theme` preference
// is allowed to disagree with — choosing dark on a light OS painted near-black headings on the
// dark editor background. Set from the same resolved value as the class so the two cannot drift.
const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=stored==='light'||stored==='dark'?stored:(prefersDark?'dark':'light');document.documentElement.classList.toggle('dark',resolved==='dark');document.documentElement.setAttribute('data-color-mode',resolved);document.documentElement.style.colorScheme=resolved;}catch(e){}})();`

// The selected beads project (absolute path). Absent = the env-default project.
// Defined on the root so every route inherits it and links can preserve it.
const rootSearchSchema = z.object({
  project: z.string().optional().catch(undefined),
})

export const Route = createRootRoute({
  validateSearch: rootSearchSchema,
  // Only project identity and access checks belong in the shared blocking loader.
  loaderDeps: ({ search }) => ({ project: search.project }),
  // Never throws for a per-project read failure: the shell it feeds owns the project
  // picker, so a project bd can't open must still render with the picker intact.
  loader: async ({ deps }) => {
    // Sequential on purpose: bd's embedded dolt backend is single-writer/single-opener.
    const defaultProject = await defaultProjectFn()
    const currentUser = await currentUserFn()
    const { projectError } = await projectAccessStatusFn({
      data: { projectDir: deps.project },
    })
    return { defaultProject, currentUser, projectError }
  },
  component: RootRouteContent,
  // Last line of defense: anything the loader guard didn't catch still renders inside the
  // shell (sidebar and picker included) rather than unmounting the app.
  errorComponent: ({ error }) => <ProjectErrorPanel message={error.message} />,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'pm-beads' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

// Shared nav-link classes: muted until hovered or active (TanStack adds `.active`).
const NAV_LINK_CLASS =
  'flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground'

/** The root loader's data, or undefined when the root loader itself failed and the
 * errorComponent is rendering inside the shell. Components in the shell render either
 * way, so they must never destructure this blindly. */
function useRootLoaderData() {
  return useMatch({ from: Route.id, shouldThrow: false })?.loaderData
}

/** A project bd can't open has no content to show, so the panel replaces the whole route
 * rather than sitting above a child route that failed for the same reason. */
function RootRouteContent() {
  const loaderData = useRootLoaderData()
  const { project } = useSearch({ from: Route.id })
  const projectError = loaderData?.projectError ?? null
  const personas = useDeferredRead(
    project ?? '',
    useCallback(
      () =>
        projectError
          ? Promise.resolve({})
          : readPersonasFn({ data: { projectDir: project } }),
      [project, projectError],
    ),
    loaderData,
  )
  const pipeline = useDeferredRead(
    project ?? '',
    useCallback(
      () =>
        projectError
          ? Promise.resolve(DEFAULT_STATUS_PIPELINE)
          : readStatusPipelineFn({ data: { projectDir: project } }),
      [project, projectError],
    ),
    loaderData,
  )
  if (projectError !== null) return <ProjectErrorPanel message={projectError} />
  return (
    <StatusPipelineProvider value={pipeline.value ?? DEFAULT_STATUS_PIPELINE}>
      <MentionProvider
        personas={personas.value ?? {}}
        currentUser={loaderData?.currentUser ?? { key: 'ben', aliases: [] }}
      >
        <DeferredReadStatus {...personas} label="mention suggestions" />
        <DeferredReadStatus {...pipeline} label="status options" />
        <Outlet />
        <SyncRefresh project={project} />
      </MentionProvider>
    </StatusPipelineProvider>
  )
}

function Sidebar() {
  const loaderData = useRootLoaderData()
  const { project } = useSearch({ from: Route.id })
  const navigate = useNavigate()

  const badge = useDeferredRead(
    project ?? '',
    useCallback(async () => {
      if (loaderData?.projectError) return 0
      const result = await projectShellStatusFn({
        data: { projectDir: project },
      })
      if (result.projectError) throw new Error(result.projectError)
      return result.openAsks
    }, [project, loaderData?.projectError]),
    loaderData,
  )
  const openAsks = badge.value ?? 0

  const currentPath = project ?? null
  const currentName =
    currentPath === null
      ? (loaderData?.defaultProject.name ?? 'Projects')
      : (currentPath.split('/').filter(Boolean).pop() ?? currentPath)

  // No border between nav and content — the sidebar/content gray step does the separating.
  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 bg-sidebar p-3 text-sidebar-foreground">
      <div className="mb-2 flex items-center gap-1">
        <ProjectPicker
          currentName={currentName}
          currentPath={currentPath}
          discoverProjects={() => discoverProjectsFn()}
          onSelect={(path) =>
            navigate({
              to: '.',
              search: (prev) => ({ ...prev, project: path ?? undefined }),
            })
          }
        />
        <Link
          to="/search"
          search={{ project }}
          aria-label="Search"
          title="Search"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
        >
          <SearchIcon className="size-4" />
        </Link>
        <WorkspaceComposer key={project ?? ''} project={project} />
      </div>
      <Link to="/inbox" search={{ project }} className={NAV_LINK_CLASS}>
        Inbox
        {openAsks > 0 && (
          <span className="ml-auto rounded-full bg-sky-500/15 px-1.5 py-px text-[11px] font-medium text-sky-700 dark:text-sky-300">
            {openAsks}
            <span className="sr-only"> beads with open asks</span>
          </span>
        )}
      </Link>
      <DeferredReadStatus {...badge} label="inbox count" />
      <Link to="/projects" search={{ project }} className={NAV_LINK_CLASS}>
        Projects
      </Link>
      <Link to="/issues" search={{ project }} className={NAV_LINK_CLASS}>
        Issues
      </Link>
      <Link to="/memories" search={{ project }} className={NAV_LINK_CLASS}>
        Memories
      </Link>
      <Link to="/settings" search={{ project }} className={NAV_LINK_CLASS}>
        Settings
      </Link>
    </nav>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme-init script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <div className="flex h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
