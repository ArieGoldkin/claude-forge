/**
 * Shared Hooks Infra - Output Helper Functions
 *
 * TypeScript port of scripts/lib/common.sh output functions.
 * These functions produce JSON output that Claude Code expects from hooks.
 *
 * @module output
 */

import type { HookResult } from '../types.js';

/**
 * Output silent success - hook completed, no user-visible output.
 *
 * Use this when the hook allows an operation to proceed without
 * needing to display any message to the user.
 *
 * @returns HookResult with continue=true and suppressOutput=true
 *
 * @example
 * ```typescript
 * // Allow operation silently
 * console.log(JSON.stringify(outputSilentSuccess()));
 * // Output: {"continue":true,"suppressOutput":true}
 * ```
 */
export function outputSilentSuccess(): HookResult {
  return {
    continue: true,
    suppressOutput: true,
  };
}

/**
 * Output success with message - hook completed, show message to user.
 *
 * Use this when you want to allow an operation but also display
 * an informational message to the user.
 *
 * @param message - The message to display to the user
 * @returns HookResult with continue=true and systemMessage
 *
 * @example
 * ```typescript
 * console.log(JSON.stringify(outputSuccess("File validated successfully")));
 * // Output: {"continue":true,"systemMessage":"File validated successfully"}
 * ```
 */
export function outputSuccess(message: string): HookResult {
  return {
    continue: true,
    systemMessage: message,
  };
}

/**
 * Output warning - continue but show warning to user.
 *
 * Use this when you want to allow an operation but warn the user
 * about something they should be aware of. The warning symbol
 * is prepended to the message.
 *
 * @param message - The warning message to display
 * @returns HookResult with continue=true and warning systemMessage
 *
 * @example
 * ```typescript
 * console.log(JSON.stringify(outputWarning("File is very large")));
 * // Output: {"continue":true,"systemMessage":"\u26a0 File is very large"}
 * ```
 */
export function outputWarning(message: string): HookResult {
  return {
    continue: true,
    systemMessage: `\u26a0 ${message}`,
  };
}

/**
 * Output deny/block - block the tool call, WITHOUT stopping the agent's turn.
 *
 * Use this when the hook determines an operation should be blocked. The reason
 * is included both as stopReason and in hookSpecificOutput for permission hooks.
 *
 * The denial is carried by `permissionDecision: 'deny'` alone — deliberately NOT
 * by `continue: false`, which per CC's hook docs "takes precedence over any
 * event-specific decision fields" and ends the agent's turn outright. See the
 * inline note in the body for the measurement behind that (#65).
 *
 * @param reason - The reason for blocking the operation
 * @returns HookResult with continue=true and a deny decision
 *
 * @example
 * ```typescript
 * console.log(JSON.stringify(outputDeny("Access to .env files is not allowed")));
 * // Output: {"continue":true,"stopReason":"Access to .env files is not allowed",
 * //          "hookSpecificOutput":{"permissionDecision":"deny",
 * //                                "permissionDecisionReason":"Access to .env files is not allowed"}}
 * ```
 */
export function outputDeny(
  reason: string,
  hookEventName: 'PreToolUse' | 'PermissionRequest' = 'PreToolUse'
): HookResult {
  return {
    // NOT `continue: false` (#65). Per CC's hook docs, `continue: false` "takes
    // precedence over any event-specific decision fields" and stops the agent
    // processing entirely — which is what killed dispatched subagents the moment
    // they touched a protected literal. The denial is carried by
    // `permissionDecision` alone, which blocks the tool call and lets the agent
    // receive the reason and carry on.
    //
    // The tool STILL does not execute. `isDenyDecision` above treats
    // permissionDecision:'deny' as blocking regardless of `continue`, and the
    // combined wrappers short-circuit on it before any auto-approve path
    // (single-sourced in ctk 2.12.1 precisely so this change is safe).
    //
    // Measured: a two-cell experiment where both agents hit a real denial and
    // were told writing their report was mandatory — the continue:false cell
    // died between two writes, the continue:true cell survived and reported.
    //
    // `stopReason` is retained: CC ignores it when continue is true, but our own
    // hooks and tests read it as the human-readable denial text.
    continue: true,
    stopReason: reason,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Does this result deny the operation?
 *
 * A denial can be carried two ways, and BOTH must count:
 *
 * - `continue: false` — the historical shape emitted by {@link outputDeny}. Per
 *   CC's hook docs this "takes precedence over any event-specific decision
 *   fields" and stops the agent's turn entirely.
 * - `permissionDecision: 'deny'` with `continue: true` — blocks the single tool
 *   call while letting the agent continue. `read-cache` already emits this.
 *
 * WHY THIS IS SHARED (#65). Three combined hooks each carried a private copy
 * that tested only `continue === false`. A denial expressed the second way was
 * therefore not recognised as blocking, and execution fell through to the
 * auto-approve fast path — converting a security denial into a SILENT
 * AUTO-ALLOW. Widening is strictly safe: it can classify more results as
 * denials, never fewer.
 *
 * Keep this the single definition. Three copies is how the gap opened.
 */
export function isDenyDecision(result: HookResult): boolean {
  return result.continue === false || result.hookSpecificOutput?.permissionDecision === 'deny';
}

/**
 * Output allow with permission decision.
 *
 * Use this in permission hooks to auto-approve an operation.
 * This signals to Claude Code that the operation is pre-approved
 * and should proceed without user confirmation.
 *
 * @returns HookResult with continue=true, suppressOutput=true, and allow decision
 *
 * @example
 * ```typescript
 * console.log(JSON.stringify(outputAllow()));
 * // Output: {"continue":true,"suppressOutput":true,
 * //          "hookSpecificOutput":{"permissionDecision":"allow"}}
 * ```
 */
export function outputAllow(
  hookEventName: 'PreToolUse' | 'PermissionRequest' = 'PreToolUse'
): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'allow',
    },
  };
}

/**
 * Output allow with context injection.
 *
 * Use this in permission hooks to auto-approve an operation while also
 * providing additional context that will be injected into the conversation.
 *
 * @param context - Additional context to provide about the allowed operation
 * @returns HookResult with continue=true, suppressOutput=true, and context
 *
 * @example
 * ```typescript
 * console.log(JSON.stringify(outputAllowWithContext("File is in safe directory")));
 * // Output: {"continue":true,"suppressOutput":true,
 * //          "hookSpecificOutput":{"permissionDecision":"allow",
 * //                                "additionalContext":"File is in safe directory"}}
 * ```
 */
export function outputAllowWithContext(
  context: string,
  hookEventName: 'PreToolUse' | 'PermissionRequest' = 'PreToolUse'
): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'allow',
      additionalContext: context,
    },
  };
}

/**
 * Output prompt context injection - inject invisible context for Claude.
 *
 * Use this in UserPromptSubmit hooks to inject compliance reminders,
 * domain context, or other guidance that Claude sees but the user doesn't.
 * The context is added to Claude's system context for the current message.
 *
 * @param context - Additional context to inject into Claude's context
 * @returns HookResult with continue=true, suppressOutput=true, and context
 *
 * @example
 * ```typescript
 * console.log(JSON.stringify(outputPromptContext("Remember: PHI must be encrypted at rest")));
 * // Output: {"continue":true,"suppressOutput":true,
 * //          "hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
 * //                                "additionalContext":"Remember: PHI must be encrypted at rest"}}
 * ```
 */
export function outputPromptContext(context: string): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  };
}

/**
 * Output Stop/SubagentStop feedback context for Claude (CC v2.1.163+).
 *
 * Use this in Stop or SubagentStop hooks to give Claude feedback and keep
 * the turn going without the output being labeled a hook error. Caution:
 * a Stop hook that ALWAYS injects context keeps the turn alive indefinitely
 * (the v2.1.78 infinite-loop hazard) — gate on a condition that converges.
 *
 * @param context - Feedback to inject into Claude's context
 * @param hookEventName - 'Stop' (default) or 'SubagentStop'
 * @returns HookResult with continue=true, suppressOutput=true, and context
 */
export function outputStopContext(
  context: string,
  hookEventName: 'Stop' | 'SubagentStop' = 'Stop'
): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context,
    },
  };
}

/**
 * Output PostToolUse invisible context for Claude.
 *
 * Use this in PostToolUse hooks to inject additional context that Claude
 * sees but the user doesn't. The context appears in additionalContext.
 *
 * @param context - Additional context to inject
 * @returns HookResult with continue=true, suppressOutput=true, and context
 *
 * @example
 * ```typescript
 * outputWithContext("Tip: use --no-cache for fresh builds");
 * ```
 */
export function outputWithContext(context: string): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: context,
    },
  };
}

/**
 * Output ask with optional modified input.
 *
 * Use this in PreToolUse hooks to prompt the user for approval while
 * optionally modifying the tool input. The user sees the permission prompt
 * with any input modifications applied.
 *
 * Available since Claude Code v2.1.0 (ask decision) and v2.0.10 (updatedInput).
 *
 * @param updatedInput - Optional modified tool input to substitute
 * @returns HookResult with ask decision and optional updatedInput
 *
 * @example
 * ```typescript
 * // Ask user, no input modification
 * console.log(JSON.stringify(outputAsk()));
 *
 * // Ask user with modified command
 * console.log(JSON.stringify(outputAsk({ command: "npm test --no-cache" })));
 * ```
 */
export function outputAsk(
  updatedInput?: Record<string, unknown>,
  hookEventName: 'PreToolUse' | 'PermissionRequest' = 'PreToolUse'
): HookResult {
  const result: HookResult = {
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'ask',
      ...(updatedInput !== undefined && { updatedInput }),
    },
  };
  return result;
}

/**
 * Output a warning to stderr that the user sees but Claude does not.
 *
 * Writes the message to stderr and exits with code 2, which causes
 * Claude Code to display the message to the user without injecting
 * it into the conversation context.
 *
 * @param message - The warning message for the user
 */
export function outputStderrWarning(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/**
 * Output dual-channel: systemMessage visible to user + additionalContext for Claude.
 *
 * Use this when both the user and Claude need to see feedback, but with
 * different content. The user sees the systemMessage in their terminal,
 * while Claude receives the additionalContext in its conversation context.
 *
 * @param userMsg - Message shown to the user (systemMessage)
 * @param claudeCtx - Context injected for Claude (additionalContext)
 * @returns HookResult with both systemMessage and additionalContext
 *
 * @example
 * ```typescript
 * outputWithNotification(
 *   "Lint errors found",
 *   "Fix these lint errors before continuing: E401, E501"
 * );
 * ```
 */
export function outputWithNotification(
  userMsg: string,
  claudeCtx: string,
  hookEventName: 'PreToolUse' | 'PostToolUse' = 'PostToolUse'
): HookResult {
  return {
    continue: true,
    systemMessage: userMsg,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: claudeCtx,
    },
  };
}

/**
 * Output retry — tell Claude Code to retry the denied tool call (CC 2.1.88+).
 *
 * Use this in PermissionDenied hooks when the denial was incorrect
 * (e.g., a safe command blocked by auto-mode classifier).
 *
 * @returns HookResult with retry=true
 */
export function outputRetry(): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      retry: true,
    },
  };
}

/**
 * Output session title — set session title from UserPromptSubmit hooks (CC 2.1.94+).
 *
 * Use this in UserPromptSubmit hooks to auto-title sessions.
 * The title appears in the session card and --resume picker.
 *
 * @param title - The session title to set
 * @returns HookResult with sessionTitle in hookSpecificOutput
 *
 * @example
 * ```typescript
 * // Auto-title from branch name
 * outputSessionTitle("feat/user-auth");
 * ```
 */
export function outputSessionTitle(title: string): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      sessionTitle: title,
    },
  };
}

/**
 * Output transformed assistant message for the MessageDisplay event
 * (CC v2.1.152+). The transformed text replaces the original at display
 * time. Use for output-side redaction, formatting, or annotation.
 *
 * Field names follow the established `hookSpecificOutput.hookEventName`
 * + payload convention. CC version older than 2.1.152 will silently
 * ignore the unknown `hookEventName`, so this is safe to ship across
 * versions.
 *
 * @param transformedText - The text to display in place of the original
 * @returns HookResult with the MessageDisplay payload
 *
 * @example
 * ```typescript
 * outputMessageDisplay("SSN: [REDACTED]");
 * ```
 */
export function outputMessageDisplay(transformedText: string): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'MessageDisplay',
      // `displayContent`, NOT `transformedMessage`.
      //
      // THIS IS THE ONE LOAD-BEARING FACT IN THIS MODULE THAT NO TEST CAN
      // VERIFY. The suite pins the key against drift — reverting it fails three
      // phi tests — but a test can only check what we emit, never what Claude
      // Code consumes. `transformedMessage` was wrong for a year precisely
      // because nothing could contradict it. So here is the reproduction, not
      // just the conclusion (a reviewer could not re-derive it: `claude` on
      // PATH is often a shim, and the real binary is elsewhere):
      //
      //   B=/opt/homebrew/Caskroom/claude-code@latest/2.1.220/claude
      //   strings -a "$B" | grep -c transformedMessage   # -> 0
      //   strings -a "$B" | grep -c displayContent       # -> 9
      //   strings -a "$B" | grep displayContent          # doc string + schema
      //
      // The doc string reads "Output JSON with hookSpecificOutput containing
      // displayContent to replace the delta on screen"; the schema branch for
      // MessageDisplay has exactly this one field; and the dispatch code seeds
      // its output with the original delta, overriding only when
      // `displayContent !== undefined`. Re-run this against a new CC before
      // trusting it — the version is in the path.
      //
      // Under the old name CC dropped the key, displayed the unredacted text,
      // and phi-output-redactor still logged "Redacted N match(es)" — an audit
      // line asserting a redaction that never happened, which is worse than no
      // hook. Exactly the defect this release fixes on the INPUT side (a
      // handler reading a name CC never sends), in the opposite direction.
      // Found by adversarial review of #56.
      displayContent: transformedText,
    },
  };
}

/**
 * Output a directive to hide the assistant message at display time
 * (CC v2.1.152+ MessageDisplay event).
 *
 * Stronger than transform — the message is not shown to the user at all.
 * Use sparingly: an unexplained hidden message is confusing UX. Prefer
 * `outputMessageDisplay()` with a redaction placeholder unless full
 * suppression is required.
 *
 * @returns HookResult with hide directive
 */
export function outputMessageDisplayHide(): HookResult {
  // Suppression is an EMPTY `displayContent`, not a `hide` flag. The
  // MessageDisplay branch of CC 2.1.220's hookSpecificOutput schema has exactly
  // one field; `hide` occurs nowhere in the binary and the dispatch code has no
  // handling for it. The previous implementation returned `{ hide: true }`, so
  // any caller believing it had suppressed a message displayed it in full.
  // Never reached by phi-output-redactor, but shipped. Found by adversarial
  // review of #56.
  return outputMessageDisplay('');
}

/**
 * Output answer for AskUserQuestion — auto-answer via PreToolUse hook (CC 2.1.85+).
 *
 * Use this in PreToolUse hooks to satisfy AskUserQuestion by providing
 * the answer via updatedInput alongside permissionDecision: "allow".
 * Enables headless integrations that collect answers via their own UI.
 *
 * @param answer - The answer to provide (set as the question response)
 * @returns HookResult with allow decision and updatedInput
 *
 * @example
 * ```typescript
 * // Auto-answer a question from external UI
 * outputAnswerQuestion({ answer: "yes, proceed with migration" });
 * ```
 */
export function outputAnswerQuestion(updatedInput: Record<string, unknown>): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput,
    },
  };
}

/**
 * Output defer — pause execution for headless sessions (CC 2.1.89+).
 *
 * Use this in PreToolUse hooks when a tool call requires out-of-band
 * approval (e.g., CI gate, external review). The session pauses and
 * can be resumed with `claude -p --resume`.
 *
 * @returns HookResult with permissionDecision='defer'
 */
export function outputDefer(): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'defer',
    },
  };
}

// =============================================================================
// OUTPUT BUDGETING HELPERS
// =============================================================================

/**
 * Truncate text with LLM-friendly strategies.
 *
 * Applies maxLines first, then maxChars, to keep output within token budgets.
 * The default strategy is 'tail' because for error output the end is usually
 * the most relevant part.
 *
 * @param text - The text to truncate
 * @param options - Truncation options
 * @param options.maxChars - Maximum characters (default 500)
 * @param options.maxLines - Maximum lines (default 20)
 * @param options.strategy - Truncation strategy: 'head', 'tail', or 'middle' (default 'tail')
 * @returns The truncated text, or the original if within budget
 *
 * @example
 * ```typescript
 * // Keep last 500 chars (default)
 * truncateForLLM(longErrorOutput);
 *
 * // Keep first 10 lines, max 300 chars
 * truncateForLLM(logOutput, { strategy: 'head', maxLines: 10, maxChars: 300 });
 *
 * // Keep first 3 + last 7 lines with middle omitted
 * truncateForLLM(stackTrace, { strategy: 'middle', maxLines: 10 });
 * ```
 */
export function truncateForLLM(
  text: string,
  options: {
    maxChars?: number;
    maxLines?: number;
    strategy?: 'head' | 'tail' | 'middle';
  } = {}
): string {
  const { maxChars = 500, maxLines = 20, strategy = 'tail' } = options;

  let result = text;

  // Apply maxLines first
  const lines = result.split('\n');
  if (lines.length > maxLines) {
    switch (strategy) {
      case 'head': {
        result = lines.slice(0, maxLines).join('\n');
        const omittedLines = lines.length - maxLines;
        result += `\n... (truncated, ${omittedLines} more lines)`;
        break;
      }
      case 'tail': {
        const omittedLines = lines.length - maxLines;
        result = `(truncated, ${omittedLines} lines omitted) ...\n${lines.slice(-maxLines).join('\n')}`;
        break;
      }
      case 'middle': {
        const headCount = 3;
        const tailCount = maxLines - headCount;
        const omittedLines = lines.length - maxLines;
        const headPart = lines.slice(0, headCount).join('\n');
        const tailPart = lines.slice(-tailCount).join('\n');
        result = `${headPart}\n... (${omittedLines} lines omitted)\n${tailPart}`;
        break;
      }
    }
  }

  // Apply maxChars
  if (result.length > maxChars) {
    switch (strategy) {
      case 'head': {
        const omittedChars = result.length - maxChars;
        result = `${result.slice(0, maxChars)}... (truncated, ${omittedChars} more chars)`;
        break;
      }
      case 'tail': {
        const omittedChars = result.length - maxChars;
        result = `(truncated, ${omittedChars} chars omitted) ...${result.slice(-maxChars)}`;
        break;
      }
      case 'middle': {
        const headChars = Math.floor(maxChars / 2);
        const tailChars = maxChars - headChars;
        const omittedChars = result.length - maxChars;
        result = `${result.slice(0, headChars)}... (${omittedChars} chars omitted) ...${result.slice(-tailChars)}`;
        break;
      }
    }
  }

  return result;
}

/**
 * Output warning with automatic truncation for LLM token budgets.
 *
 * Like outputWarning but auto-truncates the message using tail strategy
 * (keeping the end, which is most relevant for errors).
 *
 * @param message - The warning message to display (will be truncated if needed)
 * @param maxChars - Maximum characters for the message (default 500)
 * @returns HookResult with continue=true and truncated warning systemMessage
 *
 * @example
 * ```typescript
 * outputWarningBudgeted(veryLongLintOutput, 300);
 * ```
 */
export function outputWarningBudgeted(message: string, maxChars = 500): HookResult {
  return outputWarning(truncateForLLM(message, { maxChars }));
}

/**
 * Output prompt context with automatic truncation for LLM token budgets.
 *
 * Like outputPromptContext but auto-truncates the context using tail strategy.
 *
 * @param context - Additional context to inject (will be truncated if needed)
 * @param maxChars - Maximum characters for the context (default 1000)
 * @returns HookResult with continue=true, suppressOutput=true, and truncated context
 *
 * @example
 * ```typescript
 * outputContextBudgeted(longComplianceContext, 800);
 * ```
 */
export function outputContextBudgeted(context: string, maxChars = 1000): HookResult {
  return outputPromptContext(truncateForLLM(context, { maxChars }));
}
