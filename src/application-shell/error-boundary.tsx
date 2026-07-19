import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

export interface ShellErrorBoundaryProps {
  readonly children: ReactNode;
  readonly renderFallback: (retry: () => void) => ReactNode;
  readonly resetKey: string | null;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ShellErrorBoundaryState {
  readonly failed: boolean;
}

export class ShellErrorBoundary extends Component<
  ShellErrorBoundaryProps,
  ShellErrorBoundaryState
> {
  public override state: ShellErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ShellErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  public override componentDidUpdate(previous: ShellErrorBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  public override render(): ReactNode {
    return this.state.failed
      ? this.props.renderFallback(this.retry)
      : this.props.children;
  }
}
