// ABOUTME: Shared wire schema for the workspace composer and resumable follow-up writes.
import { z } from 'zod'

export const createDraftSchema = z.object({
  title: z.string().trim().min(1),
  type: z.string().trim().min(1),
  priority: z.number().int().min(0).max(4),
  description: z.string().optional(),
  status: z.string().trim().min(1).optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string().trim().min(1)).optional(),
  parent: z.string().trim().min(1).optional(),
  dependencies: z.array(z.string().trim().min(1)).optional(),
  prLink: z.string().optional(),
  design: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  notes: z.string().optional(),
  createdId: z.string().min(1).optional(),
  completedSteps: z.array(z.string()).optional(),
})
export type CreateDraft = z.infer<typeof createDraftSchema>
