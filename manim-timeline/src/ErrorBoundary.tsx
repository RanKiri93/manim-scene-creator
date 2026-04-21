import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a failed paint shows text instead of a blank page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-mono text-sm">
          <h1 className="text-lg text-red-400 mb-2">Something went wrong</h1>
          <p className="text-slate-400 mb-4">
            The UI crashed while rendering. Open the browser developer console (F12) for the full
            stack trace.
          </p>
          <pre className="bg-slate-950 border border-slate-700 rounded p-3 overflow-auto text-xs text-red-300 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="mt-4 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
