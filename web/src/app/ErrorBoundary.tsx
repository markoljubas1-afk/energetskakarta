import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Where the failure happened, for logs. */
  area: string;
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Contains a failure to one part of the page and lets the user retry it. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.area}] render failed`, error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
