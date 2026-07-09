/**
 * Shared Hooks Infra - Common Library Exports
 *
 * This module re-exports all utilities from the lib directory
 * for convenient single-import usage.
 *
 * @module hooks-infra/lib
 *
 * @example
 * ```typescript
 * import {
 *   outputSilentSuccess,
 *   outputDeny,
 *   readHookInput,
 *   getToolName
 * } from './lib/index.js';
 * ```
 */

// Output helpers for producing hook responses
export {
  outputSilentSuccess,
  outputSuccess,
  outputWarning,
  outputDeny,
  outputAllow,
  outputAllowWithContext,
  outputWithContext,
  outputStderrWarning,
  outputWithNotification,
  truncateForLLM,
  outputWarningBudgeted,
  outputContextBudgeted,
  outputRetry,
  outputDefer,
  outputSessionTitle,
  outputAnswerQuestion,
  outputMessageDisplay,
  outputMessageDisplayHide,
} from './output.js';

// Input parsing for reading hook JSON from stdin
export {
  readHookInput,
  parseHookInput,
  getToolName,
  getFilePath,
  getCommand,
  getSessionId,
  getAgentId,
  getAgentType,
  getProjectDir,
  getContent,
  getPattern,
  getOldString,
  getNewString,
  getField,
  getToolInput,
  stripProxyPrefix,
} from './input.js';

// Logging utilities for structured logging and audit trail
export {
  logDebug,
  logInfo,
  logWarn,
  logError,
  logPermission,
  logPermissionEntry,
  createLogger,
  createScopedLogger,
  resetLogLevel,
  resetLogDir,
  getCurrentLogLevel,
  getHookLogPath,
  getPermissionLogPath,
  getLogDir,
} from './logging.js';

// Path utility functions (security-critical for ME-001 symlink bypass prevention)
export {
  // Core path resolution
  resolveRealPath,
  normalizePath,
  // Project boundary checking
  isWithinProject,
  // Protected path checking
  isProtectedPath,
  isPathProtected,
  // Path traversal detection
  hasPathTraversal,
  // Path comparison utilities
  isSamePath,
  makeRelativeToProject,
  makeAbsolute,
  // Pattern exports for custom validation
  ENV_PATTERNS,
  GIT_PATTERNS,
  SSH_PATTERNS,
  CREDENTIAL_PATTERNS,
  SYSTEM_DIR_PATTERNS,
  ALL_PROTECTED_PATTERNS,
} from './path-utils.js';

// Type exports from path-utils
export type { ProtectedPathResult, ProtectionCategory } from './path-utils.js';

// Composable guard functions for hook entry checks
export {
  runGuards,
  guardTool,
  guardBash,
  guardWriteEdit,
  guardHasCommand,
  guardHasFilePath,
  guardFileExtension,
  guardWithinProject,
  guardSkipInternal,
} from './guards.js';

// Guard types
export type { GuardResult, GuardFn } from './guards.js';

// Continuity library for session persistence
export {
  CONTINUITY_DIRS,
  isContinuityInitialized,
  ensureContinuityStructure,
  createDefaultSharedContext,
  createDefaultLedger,
  getCurrentLedgerPath,
  getLatestHandoffPath,
  getContinuityStatus,
  formatTimestamp,
} from './continuity.js';

// Type exports from continuity
export type { ContinuityStatus } from './continuity.js';

// Read cache for delta-mode token optimization
export {
  computeDelta,
  computeContentHash,
  getCacheRoot,
  getSessionDir,
  getReadsPath,
  ensureSessionDir,
  readEntry,
  writeEntry,
  snapshotFileToCache,
  evictOldSessions,
  getSessionSizeBytes,
  MAX_DELTA_LINES,
  MAX_DELTA_CHARS,
} from './read-cache/index.js';

export type { CachedRead, DeltaResult } from './read-cache/index.js';

// Dangerous bash pattern registry
export {
  matchDangerousBash,
  FILESYSTEM_PATTERNS,
  HTTP_PATTERNS,
} from './dangerous-bash/index.js';

export type { Category, Match, Pattern } from './dangerous-bash/index.js';

// Handoff JSON schema (cross-session durable state)
export {
  HANDOFF_SCHEMA_VERSION,
  scrubPHIFromString,
  scrubPHI,
  buildHandoff,
  validateHandoff,
  formatHandoffSummary,
} from './handoff-schema.js';

export type { HandoffJson, HandoffTrigger, OpenMr } from './handoff-schema.js';

// Terminal escape sequence helpers (CC v2.1.141 terminalSequence)
export { buildWindowTitleSequence, sanitizeTitleSegment } from './terminal-sequence.js';

// PHI / PII redactor for output-side scrubbing (CC v2.1.152 MessageDisplay)
export { DEFAULT_PHI_PATTERNS, redactPhi } from './phi-redactor.js';
export type { PhiPattern, RedactionResult } from './phi-redactor.js';
