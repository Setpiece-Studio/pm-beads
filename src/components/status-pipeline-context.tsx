// ABOUTME: Project-scoped React context for status options, pipeline order, and icon names.
// ABOUTME: Lists provide their loaded pipeline; detail views receive it after rendering.

import { createContext, useContext } from 'react'
import {
  DEFAULT_STATUS_PIPELINE,
  type StatusPipeline,
} from '@/lib/beads/status-model'

const StatusPipelineContext = createContext<StatusPipeline>(
  DEFAULT_STATUS_PIPELINE,
)

export function StatusPipelineProvider({
  value,
  children,
}: {
  value: StatusPipeline
  children: React.ReactNode
}) {
  return (
    <StatusPipelineContext.Provider value={value}>
      {children}
    </StatusPipelineContext.Provider>
  )
}

export function useStatusPipeline(): StatusPipeline {
  return useContext(StatusPipelineContext)
}
