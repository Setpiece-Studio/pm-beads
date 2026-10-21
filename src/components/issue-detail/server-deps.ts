// ABOUTME: Wires the issue-detail edit hook's injected deps to the real beads server functions,
// ABOUTME: bound to a project dir. Kept separate so component tests never import @tanstack/react-start.

import {
  addCommentFn,
  addDependencyFn,
  addLabelFn,
  answerAskFn,
  clearPrUrlFn,
  closeIssueFn,
  createSubIssueFn,
  getIssueActivityFn,
  getIssueFn,
  getPrStateFn,
  listIssuesFn,
  relateFn,
  removeDependencyFn,
  removeLabelFn,
  saveTextFieldFn,
  setPrUrlFn,
  unrelateFn,
  updateIssueFn,
} from '@/lib/beads/server-fns'
import type { IssueEditDeps } from './use-issue-edits'

/** Build issue-detail edit deps targeting the given beads project; undefined = env default. */
export function makeIssueEditServerDeps(projectDir?: string): IssueEditDeps {
  return {
    getIssue: (id) => getIssueFn({ data: { id, projectDir } }),
    answerAsk: (id, key, answer) =>
      answerAskFn({ data: { id, key, answer, projectDir } }),
    updateIssue: (id, fields) =>
      updateIssueFn({ data: { id, fields, projectDir } }),
    saveTextField: (id, field, value, baseline) =>
      saveTextFieldFn({ data: { id, field, value, baseline, projectDir } }),
    closeIssue: (id, reason) =>
      closeIssueFn({ data: { id, reason, projectDir } }),
    addLabel: (id, label) => addLabelFn({ data: { id, label, projectDir } }),
    removeLabel: (id, label) =>
      removeLabelFn({ data: { id, label, projectDir } }),
    addDependency: (issueId, dependsOnId, type) =>
      addDependencyFn({ data: { issueId, dependsOnId, type, projectDir } }),
    removeDependency: (issueId, dependsOnId) =>
      removeDependencyFn({ data: { issueId, dependsOnId, projectDir } }),
    relate: (a, b) => relateFn({ data: { a, b, projectDir } }),
    unrelate: (a, b) => unrelateFn({ data: { a, b, projectDir } }),
    // all:true so the picker can target any issue (incl. closed); it filters out the
    // current issue and already-linked ones client-side.
    listCandidates: () => listIssuesFn({ data: { all: true, projectDir } }),
    getActivity: (id) => getIssueActivityFn({ data: { id, projectDir } }),
    addComment: (id, text) => addCommentFn({ data: { id, text, projectDir } }),
    createSubIssue: (input) =>
      createSubIssueFn({ data: { ...input, projectDir } }),
    setPrUrl: (id, ref) => setPrUrlFn({ data: { id, ref, projectDir } }),
    clearPrUrl: (id) => clearPrUrlFn({ data: { id, projectDir } }),
    getPrState: (url) => getPrStateFn({ data: { url, projectDir } }),
  }
}
