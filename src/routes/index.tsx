// ABOUTME: Index route — redirects to the projects view, the app's home screen.
// ABOUTME: Exists so / always lands somewhere useful.

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/projects' })
  },
})
