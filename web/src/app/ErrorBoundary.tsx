import { Component, type ErrorInfo, type ReactNode } from "react";

import { ChunkLoadError, reloadPage } from "./chunks";

interface Props {
  /** Where the failure happened, for logs. */
  area: string;
  /** `reset` retries; `error` is what was thrown, so the message can say what went wrong. */
  fallback: (reset: () => void, error: unknown) => ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
  error: unknown;
}

/** Contains a failure to one part of the page and lets the user retry it. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.area}] render failed`, error, info.componentStack);
  }

  // A part of the code that failed to load fails again on every render (chunks.ts), so only a reload helps.
  reset = (): void => {
    if (this.state.error instanceof ChunkLoadError) {
      reloadPage();
      return;
    }
    this.setState({ failed: false, error: null });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset, this.state.error) : this.props.children;
  }
}
