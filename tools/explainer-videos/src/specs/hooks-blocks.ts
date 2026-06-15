import { COLORS, type BlocksSpec, totalFrames } from "../blocks/catalog";

export { totalFrames };

// All-block explainer of pre/post hooks using airport security analogy.
// 60s @ 30fps = 1800 frames.

export const hooksBlocksSpec: BlocksSpec = {
  videoTitle: "Hooks = Airport Security & Customs",
  videoSubtitle: "Pre-hooks block before • Post-hooks review after",
  durationSeconds: 60,
  fps: 30,
  footer: "claude-dev-kit • hooks",
  scenes: [
    {
      kind: "intro",
      id: "intro",
      durationFrames: 180,
      title: "Hooks: Claude Code's Safety Layer",
      subtitle: "Two checkpoints around every action",
      cards: [
        {
          label: "PRE-HOOK",
          role: "SECURITY",
          icon: "🛂",
          color: COLORS.pre,
        },
        {
          label: "POST-HOOK",
          role: "CUSTOMS",
          icon: "📋",
          color: COLORS.post,
        },
      ],
      narration: "Two checkpoints around every action.",
    },
    {
      kind: "concrete-flow",
      id: "denied",
      durationFrames: 210,
      title: "Dangerous request? Refused.",
      accent: COLORS.danger,
      input: {
        label: "REQUEST",
        value: "rm -rf /",
        color: COLORS.danger,
      },
      action: {
        title: "SECURITY",
        sub: "scans the bag",
        icon: "🛂",
        color: COLORS.pre,
      },
      output: {
        kind: "stamp",
        text: "DENIED",
        sub: "dangerous command",
        color: COLORS.danger,
        icon: "🚫",
      },
      narration: "Dangerous bag? Security refuses it at the gate.",
    },
    {
      kind: "flow-row",
      id: "pre-flow",
      durationFrames: 240,
      title: "How a pre-hook works",
      accent: COLORS.pre,
      boxes: [
        {
          title: "Claude",
          sub: "asks to do something",
          color: COLORS.warn,
        },
        {
          title: "SECURITY",
          sub: "scans the request",
          bullets: [
            "dangerous command?",
            "secret token?",
            "PHI / restricted path?",
          ],
          color: COLORS.pre,
        },
        {
          title: "Decision",
          sub: "allow • deny • redact",
          color: COLORS.neutral,
        },
      ],
      narration: "Security checks every request before it runs.",
    },
    {
      kind: "concrete-flow",
      id: "secret",
      durationFrames: 210,
      title: "Secret in the bag? Redacted.",
      accent: COLORS.warn,
      input: {
        label: "PROMPT",
        value: "token=sk-abc123",
        color: COLORS.danger,
      },
      action: {
        title: "SECURITY",
        sub: "redacts secrets",
        icon: "🔒",
        color: COLORS.warn,
      },
      output: {
        kind: "code",
        label: "CLEAN",
        value: "token=••••••",
        color: COLORS.pre,
      },
      narration: "Secret detected? Redact it. Then board.",
    },
    {
      kind: "flow-row",
      id: "post-flow",
      durationFrames: 240,
      title: "How a post-hook works",
      accent: COLORS.post,
      boxes: [
        {
          title: "Tool",
          sub: "just finished",
          color: COLORS.neutral,
        },
        {
          title: "CUSTOMS",
          sub: "reviews what happened",
          bullets: [
            "lint changed files",
            "save state",
            "surface error patterns",
          ],
          color: COLORS.post,
        },
        {
          title: "Claude",
          sub: "sees feedback next turn",
          color: COLORS.warn,
        },
      ],
      narration: "After it lands, Customs reviews and reports back.",
    },
    {
      kind: "concrete-flow",
      id: "feedback",
      durationFrames: 210,
      title: "Customs notes what changed",
      accent: COLORS.post,
      input: {
        label: "TOOL",
        value: "Edit done ✓",
        color: COLORS.neutral,
      },
      action: {
        title: "CUSTOMS",
        sub: "reviews arrival",
        icon: "📋",
        color: COLORS.post,
      },
      output: {
        kind: "notes",
        notes: [
          { icon: "📝", text: "biome: 2 errors", color: COLORS.warn },
          { icon: "💾", text: "saved state", color: COLORS.post },
          { icon: "⚠", text: "TODO pattern", color: COLORS.warn },
        ],
      },
      narration: "Lint. Save state. Flag patterns.",
    },
    {
      kind: "fan-out",
      id: "fanout",
      durationFrames: 240,
      title: "ONE crew • EVERY terminal",
      accent: COLORS.warn,
      source: {
        title: "shared/hooks-infra",
        sub: "the shared codebase",
        bullets: ["security checks", "customs reviews", "common library"],
      },
      targets: [
        { label: "ctk", color: COLORS.pre },
        { label: "dtk", color: COLORS.post },
        { label: "atk", color: COLORS.warn },
        { label: "ftk", color: COLORS.danger },
        { label: "etk", color: COLORS.neutral },
        { label: "wtk", color: COLORS.post },
      ],
      narration: "Same officers staff every terminal. Write once.",
    },
    {
      kind: "recap",
      id: "recap",
      durationFrames: 270,
      title: "The takeaway",
      cards: [
        {
          title: "PRE-HOOKS  •  Security",
          color: COLORS.pre,
          bullets: [
            "Block dangerous commands",
            "Redact secrets",
            "Refuse before execution",
          ],
        },
        {
          title: "POST-HOOKS  •  Customs",
          color: COLORS.post,
          bullets: [
            "Lint changed files",
            "Surface error patterns",
            "Save state for continuity",
          ],
        },
      ],
      footnote: "Write once. Run everywhere.",
      narration: "Pre refuses. Post reacts. One codebase, seven plugins.",
    },
  ],
};
