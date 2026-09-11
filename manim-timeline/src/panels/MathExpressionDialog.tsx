import { useMemo, useRef, useState } from 'react';
import FloatingPanel from '@/components/FloatingPanel';
import {
  insertAtCaret,
  replacePowerOperator,
  validateMathExpressionPair,
  type MathExpressionPairStatus,
} from '@/lib/mathExpressionValidation';
import type { MathExpressionPreset } from './mathExpressionPresets';
import { GraphFieldHelpIcon } from './GraphFieldExpressionHelp';

interface MathExpressionDialogProps {
  title: string;
  sectionHelp: string;
  jsHelp: string;
  pyHelp: string;
  jsExpr: string;
  pyExpr: string;
  variables?: string[];
  presets: MathExpressionPreset[];
  snippets: MathExpressionPreset[];
  onApply: (p: { jsExpr: string; pyExpr: string }) => void;
  onClose: () => void;
}

function StatusPanel({ status }: { status: MathExpressionPairStatus }) {
  if (status.level === 'ok') {
    return (
      <div className="rounded border border-emerald-700 bg-emerald-900/25 px-2 py-1.5 text-[11px] text-emerald-200">
        ✓ Both expressions look valid.
      </div>
    );
  }
  const color =
    status.level === 'error'
      ? 'border-red-700 bg-red-900/25 text-red-200'
      : 'border-amber-700 bg-amber-900/25 text-amber-200';
  return (
    <div className={`rounded border px-2 py-1.5 text-[11px] leading-snug ${color}`}>
      {status.issues.map((issue, i) => (
        <div key={i}>
          • [{issue.dialect === 'both' ? 'both' : issue.dialect === 'js' ? 'preview' : 'export'}]{' '}
          {issue.message}
        </div>
      ))}
    </div>
  );
}

/**
 * Modal helper for one scalar expression pair. Edits a local draft —
 * Apply commits both boxes together, Cancel discards. Never touches the
 * store directly; the parent passes `onApply`.
 */
export default function MathExpressionDialog({
  title,
  sectionHelp,
  jsHelp,
  pyHelp,
  jsExpr,
  pyExpr,
  variables = ['x'],
  presets,
  snippets,
  onApply,
  onClose,
}: MathExpressionDialogProps) {
  const [draftJs, setDraftJs] = useState(jsExpr);
  const [draftPy, setDraftPy] = useState(pyExpr);
  const [lastFocus, setLastFocus] = useState<'js' | 'py'>('py');
  const jsRef = useRef<HTMLTextAreaElement | null>(null);
  const pyRef = useRef<HTMLTextAreaElement | null>(null);

  const status = useMemo(
    () =>
      validateMathExpressionPair({
        jsExpr: draftJs,
        pyExpr: draftPy,
        variables,
      }),
    [draftJs, draftPy, variables],
  );

  const insertSnippet = (jsIns: string, pyIns: string) => {
    const je = jsRef.current;
    const pe = pyRef.current;
    const rj = insertAtCaret(
      draftJs,
      je?.selectionStart ?? null,
      je?.selectionEnd ?? null,
      jsIns,
    );
    const rp = insertAtCaret(
      draftPy,
      pe?.selectionStart ?? null,
      pe?.selectionEnd ?? null,
      pyIns,
    );
    setDraftJs(rj.next);
    setDraftPy(rp.next);
    requestAnimationFrame(() => {
      if (je) je.setSelectionRange(rj.caret, rj.caret);
      if (pe) pe.setSelectionRange(rp.caret, rp.caret);
      if (lastFocus === 'js') je?.focus();
      else pe?.focus();
    });
  };

  const insertVariable = (name: string) => {
    if (lastFocus === 'js') {
      const je = jsRef.current;
      const r = insertAtCaret(
        draftJs,
        je?.selectionStart ?? null,
        je?.selectionEnd ?? null,
        name,
      );
      setDraftJs(r.next);
      requestAnimationFrame(() => {
        if (je) {
          je.setSelectionRange(r.caret, r.caret);
          je.focus();
        }
      });
    } else {
      const pe = pyRef.current;
      const r = insertAtCaret(
        draftPy,
        pe?.selectionStart ?? null,
        pe?.selectionEnd ?? null,
        name,
      );
      setDraftPy(r.next);
      requestAnimationFrame(() => {
        if (pe) {
          pe.setSelectionRange(r.caret, r.caret);
          pe.focus();
        }
      });
    }
  };

  const fixPower = () => {
    setDraftJs(replacePowerOperator(draftJs));
    setDraftPy(replacePowerOperator(draftPy));
  };

  return (
    <FloatingPanel title={title} onClose={onClose} defaultSize={{ w: 560, h: 560 }}>
      <div dir="ltr" className="flex flex-col gap-3 text-left">
        <p className="text-[11px] leading-snug text-slate-400">{sectionHelp}</p>

        <div className="flex items-center gap-1 text-xs text-slate-300">
          <span>Preview (JavaScript)</span>
          <GraphFieldHelpIcon title={jsHelp} label="Help: JavaScript formula" />
        </div>
        <textarea
          ref={jsRef}
          value={draftJs}
          onChange={(e) => setDraftJs(e.target.value)}
          onFocus={() => setLastFocus('js')}
          rows={3}
          spellCheck={false}
          dir="ltr"
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 font-mono text-left"
        />
        <div className="flex items-center gap-1 text-xs text-slate-300">
          <span>Export (Python)</span>
          <GraphFieldHelpIcon title={pyHelp} label="Help: Python formula" />
        </div>
        <textarea
          ref={pyRef}
          value={draftPy}
          onChange={(e) => setDraftPy(e.target.value)}
          onFocus={() => setLastFocus('py')}
          rows={3}
          spellCheck={false}
          dir="ltr"
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 font-mono text-left"
        />

        <StatusPanel status={status} />
        {status.hasPowerCaret && (
          <button
            type="button"
            onClick={fixPower}
            className="self-start rounded border border-amber-600 bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-800/50"
          >
            Fix: replace ^ with **
          </button>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500">
            Variables (insert at cursor in the focused box):
          </span>
          <div className="flex flex-wrap gap-1">
            {variables.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="rounded border border-sky-700 bg-sky-900/40 px-1.5 py-0.5 text-[11px] font-mono text-sky-200 hover:bg-sky-800/50"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500">
            Whole formula (replaces both boxes):
          </span>
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                title={`${p.js} / ${p.py}`}
                onClick={() => {
                  setDraftJs(p.js);
                  setDraftPy(p.py);
                }}
                className="rounded border border-slate-600 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:bg-slate-700"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500">
            Insert at cursor (updates preview + export together):
          </span>
          <div className="flex flex-wrap gap-1">
            {snippets.map((s) => (
              <button
                key={s.label}
                type="button"
                title={`Insert ${s.js} / ${s.py}`}
                onClick={() => insertSnippet(s.js, s.py)}
                className="rounded border border-slate-600 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:bg-slate-700"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply({ jsExpr: draftJs, pyExpr: draftPy })}
            className="rounded border border-blue-600 bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
          >
            Apply
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
