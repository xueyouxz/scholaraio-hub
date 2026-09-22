import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Shown in place of the children after they throw. */
  fallback: (error: Error) => ReactNode;
  /**
   * Try the children again when this changes. A renderer that throws on a
   * half-streamed input usually succeeds once more of it has arrived.
   */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error?: Error;
  resetKey?: unknown;
}

/** Contain a render failure to the subtree that caused it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    return { error: undefined, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[render]", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
