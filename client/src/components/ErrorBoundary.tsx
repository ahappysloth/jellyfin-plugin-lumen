import { Component, type ComponentChildren } from 'preact';

interface Props {
  fallback: ComponentChildren;
  onError?: (error: unknown) => void;
  children: ComponentChildren;
}

/** Contains render errors: a failing row or view shows `fallback` instead of breaking the page. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static override getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[Lumen]', error);
    this.props.onError?.(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
