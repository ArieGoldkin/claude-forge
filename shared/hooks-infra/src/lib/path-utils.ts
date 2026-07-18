/**
 * Shared Hooks Infra - Path Utility Functions
 *
 * TypeScript port of path utilities from scripts/lib/common.sh.
 * These functions are SECURITY-CRITICAL for preventing symlink bypass attacks (ME-001).
 *
 * IMPORTANT: The isWithinProject function MUST resolve symlinks before checking
 * boundaries. A symlink inside the project pointing to /etc/passwd must be
 * detected as OUTSIDE the project.
 *
 * Usage:
 *   import { resolveRealPath, normalizePath, isWithinProject, isProtectedPath } from './lib/path-utils.js';
 *
 *   const realPath = resolveRealPath('./symlink-to-etc-passwd');
 *   if (!isWithinProject(realPath)) {
 *     // Block operation - symlink points outside project
 *   }
 *
 * @module hooks/lib/path-utils
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// =============================================================================
// PROTECTED PATTERNS
// These patterns define files/directories that should NEVER be modified.
// Ported from scripts/pre-tool-use-security.sh
// =============================================================================

/**
 * Environment file patterns - ALWAYS blocked.
 * These files typically contain secrets and credentials.
 */
const ENV_PATTERNS: readonly RegExp[] = [
  /\.env$/,
  /\.env\..*$/,
  /\.envrc$/,
  /\.env_/,
  /\.env-/,
] as const;

/**
 * Git internals patterns - ALWAYS blocked.
 * Direct modification of .git/ can corrupt repositories.
 */
const GIT_PATTERNS: readonly RegExp[] = [
  /^\.git\//,
  /^\.git$/,
  /\/\.git\//,
  /\/\.git$/,
  /\.gitconfig$/,
] as const;

/**
 * SSH key and certificate patterns - ALWAYS blocked.
 * SSH keys must be managed manually for security.
 */
const SSH_PATTERNS: readonly RegExp[] = [
  /\.ssh\/id_/,
  /\.ssh\/.*\.pem$/,
  /\.ssh\/.*_rsa$/,
  /\.ssh\/.*_dsa$/,
  /\.ssh\/.*_ed25519$/,
  /\.ssh\/.*_ecdsa$/,
  /\.ssh\/known_hosts$/,
  /\.ssh\/authorized_keys$/,
] as const;

/**
 * Credential file patterns - ALWAYS blocked.
 * These files contain sensitive authentication data.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\.aws\/credentials$/,
  /\.npmrc$/,
  /\.pypirc$/,
  /secrets\.ya?ml$/,
  /credentials\.json$/,
  /\.netrc$/,
  /\.pgpass$/,
  /\.kube\/config$/,
  /\.docker\/config\.json$/,
] as const;

/**
 * System directory patterns - ALWAYS blocked.
 * These require elevated privileges and manual authorization.
 */
const SYSTEM_DIR_PATTERNS: readonly RegExp[] = [
  /^\/etc\//,
  /^\/usr\//,
  /^\/var\//,
  /^\/sys\//,
  /^\/proc\//,
  /^\/boot\//,
  /^\/root\//,
  // macOS specific — CC v2.1.113 expanded dangerous-removal targets
  /^\/private\/etc\//,
  /^\/private\/var\//,
  // Carve-out mirrors security-blocker BASH_SENSITIVE_PATTERNS: CC's
  // harness-managed scratchpad (/private/tmp/claude-<uid>/…) must stay
  // writable or forked skills/subagents die on their first scratchpad write.
  /^\/private\/tmp\/(?!claude-\d+\/)/,
  /^\/private\/home\//,
] as const;

/**
 * All protected patterns combined for convenience.
 */
const ALL_PROTECTED_PATTERNS: readonly RegExp[] = [
  ...ENV_PATTERNS,
  ...GIT_PATTERNS,
  ...SSH_PATTERNS,
  ...CREDENTIAL_PATTERNS,
  ...SYSTEM_DIR_PATTERNS,
] as const;

// =============================================================================
// PATTERN EXPORTS
// Exported for use by other modules that need to check specific pattern types.
// =============================================================================

export {
  ENV_PATTERNS,
  GIT_PATTERNS,
  SSH_PATTERNS,
  CREDENTIAL_PATTERNS,
  SYSTEM_DIR_PATTERNS,
  ALL_PROTECTED_PATTERNS,
};

// =============================================================================
// PATH RESOLUTION FUNCTIONS
// =============================================================================

/**
 * Resolve symlinks in a path to get the real filesystem path.
 *
 * SECURITY: This function is critical for preventing symlink bypass attacks.
 * A malicious symlink inside the project could point to /etc/passwd or other
 * sensitive files outside the project boundary.
 *
 * Behavior:
 * - If the file exists: returns the fully resolved real path (all symlinks followed)
 * - If the file doesn't exist: walks up the directory tree to find the closest
 *   existing ancestor, resolves its symlinks, and appends the remaining path components
 *
 * This handles cases like macOS where /var is a symlink to /private/var.
 *
 * Equivalent to bash: resolve_real_path()
 *
 * @param inputPath - Path to resolve (can be relative or absolute)
 * @returns Absolute path with all symlinks resolved
 *
 * @example
 * ```typescript
 * // Symlink: ./link -> /etc/passwd
 * resolveRealPath('./link');  // Returns '/etc/passwd'
 *
 * // Regular file
 * resolveRealPath('./src/index.ts');  // Returns '/full/path/to/src/index.ts'
 *
 * // Non-existent file
 * resolveRealPath('./new-file.ts');  // Returns '/full/path/to/new-file.ts'
 * ```
 */
export function resolveRealPath(inputPath: string): string {
  // CC<2.1.88 compat: file_path is now always absolute since CC 2.1.88.
  // Relative-to-absolute fallback kept for backward compatibility.
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(getProjectDir(), inputPath);

  try {
    // Try to resolve the full path including all symlinks
    return fs.realpathSync(absolutePath);
  } catch {
    // File doesn't exist - walk up the directory tree to find closest existing ancestor
    return resolveClosestAncestor(absolutePath);
  }
}

/**
 * Walk up the directory tree to find the closest existing ancestor,
 * resolve its symlinks, and append the remaining path components.
 *
 * @internal
 */
function resolveClosestAncestor(absolutePath: string): string {
  const components: string[] = [];
  let currentPath = absolutePath;

  // Walk up the directory tree
  while (currentPath !== path.dirname(currentPath)) {
    try {
      // Try to resolve this path
      const resolved = fs.realpathSync(currentPath);
      // Success! Now append the remaining components
      return components.length > 0 ? path.join(resolved, ...components.reverse()) : resolved;
    } catch {
      // This path doesn't exist, save the component and try parent
      components.push(path.basename(currentPath));
      currentPath = path.dirname(currentPath);
    }
  }

  // Reached the root without finding existing path
  // This shouldn't happen on normal systems, but handle gracefully
  return path.resolve(absolutePath);
}

/**
 * Normalize a path without following symlinks.
 *
 * Performs the following normalizations:
 * - Removes redundant ./ components
 * - Resolves ../ components
 * - Collapses multiple consecutive slashes
 * - Handles empty input (returns '.')
 *
 * This function does NOT follow symlinks. Use resolveRealPath() for that.
 *
 * Equivalent to bash: normalize_path()
 *
 * @param inputPath - Path to normalize
 * @returns Normalized path
 *
 * @example
 * ```typescript
 * normalizePath('./src//file.ts');  // Returns 'src/file.ts'
 * normalizePath('./foo/../bar/./baz');  // Returns 'bar/baz'
 * normalizePath('');  // Returns '.'
 * ```
 */
export function normalizePath(inputPath: string): string {
  if (!inputPath) {
    return '.';
  }

  // Use path.normalize to handle ./ and ../ components and collapse slashes
  let normalized = path.normalize(inputPath);

  // Remove leading ./ if present (path.normalize keeps it)
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  // Handle edge case of empty result after normalization
  if (!normalized) {
    return '.';
  }

  return normalized;
}

// =============================================================================
// PROJECT BOUNDARY CHECKING
// =============================================================================

/**
 * Get the project directory from environment or current working directory.
 *
 * @internal Use getProjectDir from input.ts for external access.
 */
function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd();
}

/**
 * Check if a path is within the project directory boundary.
 *
 * SECURITY CRITICAL: This function MUST resolve symlinks FIRST before checking
 * boundaries. This prevents symlink bypass attacks (ME-001) where a symlink
 * inside the project points to a file outside the project.
 *
 * Algorithm:
 * 1. Resolve symlinks in the input path to get the real path
 * 2. Resolve symlinks in the project directory to get the real project root
 * 3. Check if the real path starts with the real project root
 *
 * Equivalent to bash: is_within_project()
 *
 * @param inputPath - Path to check (can be relative or absolute, may contain symlinks)
 * @param projectDir - Project directory to check against (optional, defaults to CLAUDE_PROJECT_DIR)
 * @returns true if the resolved path is within the resolved project directory
 *
 * @example
 * ```typescript
 * // Normal file inside project
 * isWithinProject('./src/index.ts');  // true
 *
 * // Symlink inside project pointing to /etc/passwd
 * // ./evil-link -> /etc/passwd
 * isWithinProject('./evil-link');  // false (resolved path is outside project)
 *
 * // Absolute path outside project
 * isWithinProject('/etc/passwd');  // false
 * ```
 */
export function isWithinProject(inputPath: string, projectDir?: string): boolean {
  const projectRoot = projectDir || getProjectDir();

  // SECURITY: Resolve symlinks in BOTH the input path AND the project directory
  // This ensures we compare actual filesystem locations, not just string paths
  const resolvedPath = resolveRealPath(inputPath);
  const resolvedProjectRoot = resolveRealPath(projectRoot);

  // Ensure project root ends with separator for accurate prefix matching
  // This prevents false positives like /project matching /project-other
  const projectRootWithSep = resolvedProjectRoot.endsWith(path.sep)
    ? resolvedProjectRoot
    : resolvedProjectRoot + path.sep;

  // Check if resolved path starts with resolved project root
  // Also allow exact match for the project root itself
  return resolvedPath === resolvedProjectRoot || resolvedPath.startsWith(projectRootWithSep);
}

// =============================================================================
// PROTECTED PATH CHECKING
// =============================================================================

/**
 * Protection category type.
 */
export type ProtectionCategory = 'env' | 'git' | 'ssh' | 'credential' | 'system';

/**
 * Result of checking if a path is protected.
 */
export interface ProtectedPathResult {
  /**
   * Whether the path matches any protected pattern.
   */
  isProtected: boolean;

  /**
   * The category of protection (if protected).
   */
  category?: ProtectionCategory;

  /**
   * Human-readable reason for the protection (if protected).
   */
  reason?: string;
}

/**
 * Pattern check configuration.
 * @internal
 */
interface PatternCheckConfig {
  patterns: readonly RegExp[];
  category: ProtectionCategory;
  reason: string;
}

/**
 * All pattern checks in order of precedence.
 * @internal
 */
const PATTERN_CHECKS: readonly PatternCheckConfig[] = [
  {
    patterns: ENV_PATTERNS,
    category: 'env',
    reason: 'Environment files contain sensitive credentials',
  },
  {
    patterns: GIT_PATTERNS,
    category: 'git',
    reason: 'Git internals should be modified using git commands',
  },
  {
    patterns: SSH_PATTERNS,
    category: 'ssh',
    reason: 'SSH keys and certificates must be managed manually',
  },
  {
    patterns: CREDENTIAL_PATTERNS,
    category: 'credential',
    reason: 'Credential files must be managed manually or via secrets manager',
  },
  {
    patterns: SYSTEM_DIR_PATTERNS,
    category: 'system',
    reason: 'System directories require elevated privileges and manual authorization',
  },
] as const;

/**
 * Check if any path in the list matches any pattern in the config.
 * @internal
 */
function matchesPatternConfig(
  pathsToCheck: readonly string[],
  config: PatternCheckConfig
): boolean {
  for (const checkPath of pathsToCheck) {
    for (const pattern of config.patterns) {
      if (pattern.test(checkPath)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a path matches any protected patterns.
 *
 * Protected paths include:
 * - Environment files (.env, .envrc, etc.)
 * - Git internals (.git/, .gitconfig)
 * - SSH keys and certificates
 * - Credential files (.aws/credentials, .npmrc, etc.)
 * - System directories (/etc, /usr, /var, etc.)
 *
 * SECURITY: This function checks BOTH the normalized path AND the resolved
 * real path. A symlink bypass attempt will be caught because the resolved
 * path will match system directory patterns.
 *
 * @param inputPath - Path to check
 * @returns Object indicating if path is protected and why
 *
 * @example
 * ```typescript
 * isProtectedPath('.env');
 * // { isProtected: true, category: 'env', reason: 'Environment files contain sensitive credentials' }
 *
 * isProtectedPath('/etc/passwd');
 * // { isProtected: true, category: 'system', reason: 'System directories require elevated privileges' }
 *
 * isProtectedPath('./src/index.ts');
 * // { isProtected: false }
 * ```
 */
export function isProtectedPath(inputPath: string): ProtectedPathResult {
  // Normalize the path for pattern matching
  const normalized = normalizePath(inputPath);

  // SECURITY: Also resolve symlinks to catch bypass attempts
  const resolved = resolveRealPath(inputPath);

  // Paths to check (both normalized and resolved)
  const pathsToCheck = [normalized, resolved] as const;

  // Check each pattern category
  for (const config of PATTERN_CHECKS) {
    if (matchesPatternConfig(pathsToCheck, config)) {
      return {
        isProtected: true,
        category: config.category,
        reason: config.reason,
      };
    }
  }

  return { isProtected: false };
}

/**
 * Quick check if a path is protected (boolean only).
 *
 * Use this for simple boolean checks. Use isProtectedPath() if you need
 * the category and reason for logging or error messages.
 *
 * @param inputPath - Path to check
 * @returns true if path matches any protected pattern
 */
export function isPathProtected(inputPath: string): boolean {
  return isProtectedPath(inputPath).isProtected;
}

// =============================================================================
// PATH TRAVERSAL DETECTION
// =============================================================================

/**
 * Check if a path contains path traversal sequences.
 *
 * Path traversal using '..' can be used to escape the project directory.
 * This function detects such attempts.
 *
 * @param inputPath - Path to check
 * @returns true if path contains '..' traversal sequences
 *
 * @example
 * ```typescript
 * hasPathTraversal('../etc/passwd');  // true
 * hasPathTraversal('./src/../lib/file.ts');  // true (even if it resolves inside project)
 * hasPathTraversal('./src/file.ts');  // false
 * ```
 */
export function hasPathTraversal(inputPath: string): boolean {
  // Normalize first to handle edge cases like ../ at different positions
  const normalized = path.normalize(inputPath);

  // Check for .. at the start (escaping current directory)
  if (normalized.startsWith('..')) {
    return true;
  }

  // Check for .. anywhere in the path that hasn't been resolved away
  // path.normalize will resolve foo/../bar to bar, but ../foo stays as ../foo
  if (normalized.includes('..')) {
    return true;
  }

  return false;
}

// =============================================================================
// PATH COMPARISON UTILITIES
// =============================================================================

/**
 * Check if two paths point to the same filesystem location.
 *
 * Resolves symlinks in both paths before comparison.
 *
 * @param path1 - First path to compare
 * @param path2 - Second path to compare
 * @returns true if both paths resolve to the same location
 */
export function isSamePath(path1: string, path2: string): boolean {
  const resolved1 = resolveRealPath(path1);
  const resolved2 = resolveRealPath(path2);
  return resolved1 === resolved2;
}

/**
 * Make a path relative to the project directory.
 *
 * @param absolutePath - Absolute path to convert
 * @param projectDir - Project directory (optional, defaults to CLAUDE_PROJECT_DIR)
 * @returns Relative path from project directory
 */
export function makeRelativeToProject(absolutePath: string, projectDir?: string): string {
  const projectRoot = projectDir || getProjectDir();
  return path.relative(projectRoot, absolutePath);
}

/**
 * Make a path absolute, resolving it relative to the project directory.
 *
 * @param inputPath - Path to make absolute (may be relative or absolute)
 * @param projectDir - Project directory (optional, defaults to CLAUDE_PROJECT_DIR)
 * @returns Absolute path
 */
export function makeAbsolute(inputPath: string, projectDir?: string): string {
  // CC<2.1.88 compat: file_path is now always absolute since CC 2.1.88.
  // Relative-to-absolute fallback kept for backward compatibility.
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  const projectRoot = projectDir || getProjectDir();
  return path.resolve(projectRoot, inputPath);
}
