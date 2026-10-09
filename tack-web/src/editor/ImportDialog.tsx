"use client";

import { AlertTriangle, CheckCircle2, Code2 } from "lucide-react";
import { useMemo, useState } from "react";

import { describe, detectDiagram, drawable, insertDiagram, warningsOf } from "./import/diagram";
import { useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const EXAMPLES: { label: string; code: string }[] = [
  {
    label: "DBML",
    code: `Table users {
  id uuid pk
  email varchar [unique, not null]
  team uuid [ref: > teams.id]
  created_at timestamp
}

Table teams {
  id uuid pk
  name varchar
  plan varchar // "free" | "pro"
}

Table posts {
  id uuid pk
  author uuid [ref: > users.id]
  title varchar
  body text
}`,
  },
  {
    label: "Mermaid flowchart",
    code: `flowchart TD
  A([Sign up]) --> B[Verify email]
  B --> C{Verified?}
  C -->|Yes| D[Create workspace]
  C -->|No| E[Resend email]
  E -.-> B
  D --> F[(Database)]`,
  },
  {
    label: "Mermaid ER",
    code: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    string id PK
    string name
  }
  ORDER {
    int id PK
    string customer_id FK
  }`,
  },
];

/**
 * Type or paste DBML or Mermaid and get a diagram: database tables with their relationships, or
 * a flowchart. Shows what it recognised as you type. (Pasting such text straight onto the board
 * works too.)
 */
export function ImportDialog({ editor }: { editor: Editor }) {
  const open = useEditorStore((s) => s.importOpen);
  const setOpen = useEditorStore((s) => s.setImportOpen);
  const [code, setCode] = useState("");
  const detected = useMemo(() => (code.trim() ? detectDiagram(code) : null), [code]);
  const warnings = detected ? warningsOf(detected) : [];
  const ok = drawable(detected);

  const insert = () => {
    if (!ok) return;
    insertDiagram(editor, detected);
    setOpen(false);
    setCode("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Code2 className="size-5" /> Diagram from code
          </DialogTitle>
          <DialogDescription>
            Paste or type DBML for database tables and their relationships, or Mermaid for a
            flowchart or ER diagram. You can also paste it straight onto the board.
          </DialogDescription>
        </DialogHeader>

        <textarea
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              insert();
            }
          }}
          spellCheck={false}
          aria-label="DBML or Mermaid code"
          placeholder={
            "Table users {\n  id uuid pk\n  team uuid [ref: > teams.id]\n}\n\nor\n\nflowchart LR\n  A --> B"
          }
          className="text-ink placeholder:text-ink/30 focus-visible:border-primary focus-visible:ring-primary/20 h-72 w-full resize-y rounded-xl border bg-[#fafafa] p-3 font-mono text-[12.5px] leading-relaxed outline-none focus-visible:ring-3"
        />

        <div className="flex min-h-5 items-start gap-2 text-xs" aria-live="polite">
          {!detected && (
            <span className="text-ink/50">
              Try an example:{" "}
              {EXAMPLES.map((ex, i) => (
                <span key={ex.label}>
                  {i > 0 && " · "}
                  <button
                    type="button"
                    onClick={() => setCode(ex.code)}
                    className="text-primary font-semibold hover:underline"
                  >
                    {ex.label}
                  </button>
                </span>
              ))}
            </span>
          )}
          {detected && (
            <>
              {ok ? (
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-ink/80 font-medium">
                  {detected.kind === "unsupported"
                    ? `${describe(detected)}. Flowcharts and ER diagrams are.`
                    : ok
                      ? describe(detected)
                      : "Nothing to draw yet."}
                </p>
                {warnings.length > 0 && (
                  <details className="text-ink/55 mt-1">
                    <summary className="cursor-pointer">
                      {warnings.length} line{warnings.length === 1 ? "" : "s"} skipped
                    </summary>
                    <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 font-mono text-[11px]">
                      {warnings.slice(0, 50).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <span className="text-ink/40 mr-auto text-[11px]">Ctrl/⌘ Enter to draw</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink focus-visible:ring-primary/40 h-9 rounded-full px-4 text-sm font-semibold outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={insert}
            className="bg-primary focus-visible:ring-primary/40 h-9 rounded-full px-5 text-sm font-semibold text-white outline-none hover:brightness-105 focus-visible:ring-3 disabled:opacity-40"
          >
            Draw diagram
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
