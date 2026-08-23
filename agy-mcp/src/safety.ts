// Safety lite: hard-refuse prompts that look like secret material or
// prod-destructive ops, plus redact secrets/home paths from responses.
// Product-specific refuses (PHI/ZK/auth paths) belong in AGY_MCP_REFUSE_EXTRA
// or a project overlay — not in this global package.

const DEFAULT_REFUSE_PATTERNS: RegExp[] = [
  /\bprivate[_ ]key\b/i,
  /\b-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(prod(uction)?\s+)?(deploy|destroy|wipe)\b/i,
  /\brm\s+-rf\b/i,
];

function extraRefusePatterns(): RegExp[] {
  const raw = process.env.AGY_MCP_REFUSE_EXTRA?.trim();
  if (!raw) return [];
  const out: RegExp[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const src = part.trim();
    if (!src) continue;
    try {
      out.push(new RegExp(src, "i"));
    } catch {
      // Skip invalid regex; doctor/caller can notice via missing refuse.
    }
  }
  return out;
}

export function refusePatterns(): RegExp[] {
  return [...DEFAULT_REFUSE_PATTERNS, ...extraRefusePatterns()];
}

export interface RefuseCheck {
  refused: boolean;
  reason?: string;
}

export function checkRefuse(prompt: string): RefuseCheck {
  for (const pattern of refusePatterns()) {
    if (pattern.test(prompt)) {
      return {
        refused: true,
        reason: `Prompt matches hard-refuse pattern (${pattern}). Secret material / prod-destructive work must stay inline with the orchestrator — do not delegate.`,
      };
    }
  }
  return { refused: false };
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9]{16,}/g, "[redacted-key]"],
  [/AKIA[0-9A-Z]{16}/g, "[redacted-key]"],
  [/(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}/gi, "[redacted-secret]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse absolute home-dir paths to a relative marker; keeps repo-relative
  // paths (which are useful) but strips the local username/machine layout.
  out = out.replace(/\/(?:Users|home)\/[^/\s]+/g, "~");
  return out;
}
