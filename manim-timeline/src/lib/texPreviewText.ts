/** TeX commands the canvas can show as a character (the export typesets the real TeX). */
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  infty: '∞', to: '→', rightarrow: '→', circ: '°', sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥',
};

/**
 * Rough plain-text stand-in for a short Hebrew + math label on the canvas: `$` removed, common
 * commands as characters (`\Delta x` → `Δx`), other commands and braces dropped.
 */
export function texPreviewText(source: string): string {
  return source
    .replace(/\$/g, '')
    .replace(/\\([A-Za-z]+)\s*/g, (_, name: string) => SYMBOLS[name] ?? '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
