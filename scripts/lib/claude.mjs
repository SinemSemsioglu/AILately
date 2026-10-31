// Tool-less Claude Code calls for the data scripts: `claude -p` with a JSON schema, so analysis runs on the
// Claude subscription instead of the API. Every tool is disabled and the call runs in an empty folder:
// the inputs are untrusted text (tweets, bios), so the model reading them can only answer, never act.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const NO_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent'];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-claude-'));

// Run one tool-less Claude Code call with `input` on stdin; returns the schema-validated output.
export function claude(prompt, input, schema) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--disallowedTools', ...NO_TOOLS];
    const child = spawn('claude', args, { cwd: sandbox, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      try {
        const res = JSON.parse(out);
        if (res.is_error || !res.structured_output) throw new Error(res.result || 'no structured output');
        resolve(res.structured_output);
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${e.message} ${err.slice(0, 300)}`));
      }
    });
    child.stdin.end(input);
  });
}

export async function withRetries(fn, label, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries) throw e;
      console.warn(`  ${label} failed (${e.message.slice(0, 120)}), retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}
