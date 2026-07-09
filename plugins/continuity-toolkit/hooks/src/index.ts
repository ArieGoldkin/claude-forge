/**
 * Continuity Plugin - Hook System Entry Point
 *
 * This module provides the hook registry and exports all public APIs
 * for the TypeScript hook system.
 *
 * @module continuity-hooks
 */

import type { HookFunction } from './types.js';

// =============================================================================
// HOOK METADATA TYPE
// =============================================================================

export interface RegisteredHookMetadata {
  name: string;
  description: string;
  handler: HookFunction;
}

// =============================================================================
// HOOK REGISTRY
// =============================================================================

const hooks: Map<string, RegisteredHookMetadata> = new Map();

export function registerHook(name: string, description: string, handler: HookFunction): void {
  hooks.set(name, { name, description, handler });
}

export function getHook(name: string): RegisteredHookMetadata | undefined {
  return hooks.get(name);
}

export function listHooks(): string[] {
  return Array.from(hooks.keys());
}

export function hasHook(name: string): boolean {
  return hooks.has(name);
}

export function unregisterHook(name: string): boolean {
  return hooks.delete(name);
}

export function clearHooks(): void {
  hooks.clear();
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export {
  outputSilentSuccess,
  outputSuccess,
  outputWarning,
  outputDeny,
  outputAllow,
  outputAllowWithContext,
  outputPromptContext,
  outputStopContext,
  outputWithContext,
  outputStderrWarning,
  outputWithNotification,
  outputAsk,
  outputRetry,
  outputDefer,
  outputSessionTitle,
  outputAnswerQuestion,
} from './lib/output.js';

export {
  readHookInput,
  readHookInputAsync,
  parseHookInput,
  getToolName,
  getFilePath,
  getCommand,
  getSessionId,
  getProjectDir,
  getContent,
  getPattern,
  getOldString,
  getNewString,
  getField,
  getToolInput,
  getWorktreePath,
  getWorktreeBranch,
} from './lib/input.js';

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
  getCurrentLogLevel,
  getHookLogPath,
  getPermissionLogPath,
  getLogDir,
} from './lib/logging.js';

export type {
  ToolName,
  FileWriteToolName,
  ReadOnlyToolName,
  HookInput,
  ToolInput,
  BashToolInput,
  FileToolInput,
  UserPromptInput,
  PermissionDecision,
  HookSpecificOutput,
  HookResult,
  HookFunction,
  AsyncHookFunction,
  SyncHookFunction,
  HookEvent,
  HookConfig,
  HookMatcher,
  HooksConfig,
  HookMetadata,
  HookRegistry,
  HookEnvironment,
  SecurityPatterns,
  LogLevel,
  PermissionLogEntry,
  HookLogger,
  SessionHeartbeat,
  DirtyTracking,
  SharedContext,
} from './types.js';

export {
  isBashToolInput,
  isFileToolInput,
  isUserPromptInput,
  getHookEnvironment,
} from './types.js';

// =============================================================================
// HOOK REGISTRATION
// =============================================================================

import { sessionLoader } from './lifecycle/session-loader.js';
registerHook('lifecycle/session-loader', 'Load continuity context at session start', sessionLoader);

import { sessionEnd } from './lifecycle/session-end.js';
registerHook('lifecycle/session-end', 'Mark session as cleanly ended', sessionEnd);

import { preCompactSaver } from './lifecycle/pre-compact-saver.js';
registerHook(
  'lifecycle/pre-compact-saver',
  'Save state before context compaction',
  preCompactSaver
);

import { securityBlocker } from './pretool/security-blocker.js';
registerHook(
  'pretool/security-blocker',
  'Block dangerous operations (security-critical)',
  securityBlocker
);

import { autoApproveSafeBash } from './permission/auto-approve-safe-bash.js';
registerHook(
  'permission/auto-approve-safe-bash',
  'Auto-approve read-only bash commands',
  autoApproveSafeBash
);

import { autoApproveProjectWrites } from './permission/auto-approve-project-writes.js';
registerHook(
  'permission/auto-approve-project-writes',
  'Auto-approve safe file writes within project',
  autoApproveProjectWrites
);

import { profileEvaluator } from './permission/profile-evaluator.js';
registerHook(
  'permission/profile-evaluator',
  'Evaluate operations against declarative permission profiles',
  profileEvaluator
);

import { permissionRequestCombined } from './permission/permission-request-combined.js';
registerHook(
  'permission/permission-request-combined',
  'Auto-approve on permission dialog (PermissionRequest event)',
  permissionRequestCombined
);

import { gitValidator } from './pretool/git-validator.js';
registerHook(
  'pretool/git-validator',
  'Validate git commit messages and branch names',
  gitValidator
);

import { bashCombined } from './pretool/bash-combined.js';
registerHook(
  'pretool/bash-combined',
  'Combined Bash validation (safe-bash, profile, git-validator, security)',
  bashCombined
);

import { preflightContextInjector } from './pretool/preflight-context-injector.js';
registerHook(
  'pretool/preflight-context-injector',
  'Inject pwd/branch/remote/worktree context before destructive commands',
  preflightContextInjector
);

import { writeCombined } from './pretool/write-combined.js';
registerHook(
  'pretool/write-combined',
  'Combined Write/Edit validation (project-writes, profile, security)',
  writeCombined
);

import { dirtyStateTracker } from './posttool/dirty-state-tracker.js';
registerHook(
  'posttool/dirty-state-tracker',
  'Track file edits for dirty flag auto-handoff',
  dirtyStateTracker
);

import { contextMonitor } from './prompt/context-monitor.js';
registerHook(
  'prompt/context-monitor',
  'Inject context window usage warnings at tier thresholds',
  contextMonitor
);

import { secretDetector } from './posttool/secret-detector.js';
registerHook(
  'posttool/secret-detector',
  'Detect leaked secrets in command output and warn user',
  secretDetector
);

import { errorWarner } from './posttool/error-warner.js';
registerHook(
  'posttool/error-warner',
  'Provide helpful tips for common errors in command output',
  errorWarner
);

import { failureLogger } from './posttool/failure-logger.js';
registerHook(
  'posttool/failure-logger',
  'Log tool failures and provide contextual fix hints',
  failureLogger
);

import { lintChecker } from './posttool/lint-checker.js';
registerHook(
  'posttool/lint-checker',
  'Run ruff on Python files after write operations and report lint errors',
  lintChecker
);

import { instructionsLoaded } from './lifecycle/instructions-loaded.js';
registerHook(
  'lifecycle/instructions-loaded',
  'Log and validate loaded CLAUDE.md files',
  instructionsLoaded
);

import { teammateIdleSaver } from './lifecycle/teammate-idle-saver.js';
registerHook(
  'lifecycle/teammate-idle-saver',
  'Auto-save continuity state on teammate idle',
  teammateIdleSaver
);

import { taskCompletedLogger } from './lifecycle/task-completed-logger.js';
registerHook('lifecycle/task-completed-logger', 'Log task completion metrics', taskCompletedLogger);

import { taskCreatedLogger } from './lifecycle/task-created-logger.js';
registerHook('lifecycle/task-created-logger', 'Log task creation events', taskCreatedLogger);

import { worktreeCreate } from './lifecycle/worktree-create.js';
registerHook(
  'lifecycle/worktree-create',
  'Initialize continuity for new worktrees',
  worktreeCreate
);

import { worktreeRemove } from './lifecycle/worktree-remove.js';
registerHook(
  'lifecycle/worktree-remove',
  'Archive continuity state for removed worktrees',
  worktreeRemove
);

import { stopStateSaver } from './lifecycle/stop-state-saver.js';
registerHook(
  'lifecycle/stop-state-saver',
  'Capture final session state on Claude stop',
  stopStateSaver
);

import { stopFailureHandler } from './lifecycle/stop-failure-handler.js';
registerHook(
  'lifecycle/stop-failure-handler',
  'Log API errors that terminate a turn (StopFailure event)',
  stopFailureHandler
);

import { reviewLogger } from './posttool/review-logger.js';
registerHook(
  'posttool/review-logger',
  'Log review submissions to JSONL history file',
  reviewLogger
);

// PermissionDenied hooks (CC 2.1.88+)
import { permissionDeniedCombined } from './permissiondenied/permissiondenied-combined.js';
registerHook(
  'permissiondenied/permissiondenied-combined',
  'Combined PermissionDenied: retry safe ops, log denials, notify on repeated denials',
  permissionDeniedCombined
);

import { hipaaContextInjector } from './prompt/hipaa-context-injector.js';
registerHook(
  'prompt/hipaa-context-injector',
  'Inject HIPAA compliance context on keyword match (once per session)',
  hipaaContextInjector
);

import { phiOutputRedactor } from './messagedisplay/phi-output-redactor.js';
registerHook(
  'messagedisplay/phi-output-redactor',
  'Redact high-confidence PHI/PII patterns in assistant output (opt-in via CONTINUITY_PHI_OUTPUT_REDACT=1, CC v2.1.152+)',
  phiOutputRedactor
);

import sessionTitle from './prompt/session-title.js';
registerHook(
  'prompt/session-title',
  'Auto-set session title from git branch name (once per session, CC 2.1.94+)',
  sessionTitle
);

import { readCacheHook } from './pretool/read-cache.js';
registerHook(
  'pretool/read-cache',
  'Intercept redundant Read calls and inject a unified diff against the per-session cache',
  readCacheHook
);

import { readCacheWriterHook } from './posttool/read-cache-writer.js';
registerHook(
  'posttool/read-cache-writer',
  'Persist the just-read file content into the per-session delta cache',
  readCacheWriterHook
);

import { readCacheInvalidatorHook } from './posttool/read-cache-invalidator.js';
registerHook(
  'posttool/read-cache-invalidator',
  'Refresh the delta-cache base after Write/Edit/MultiEdit so post-edit reads are not intercepted with a stale diff',
  readCacheInvalidatorHook
);

import { bashOutputMeasurerHook } from './posttool/bash-output-measurer.js';
registerHook(
  'posttool/bash-output-measurer',
  'Record bash command + output sizes for token-savings measurement (Spike B feasibility)',
  bashOutputMeasurerHook
);
