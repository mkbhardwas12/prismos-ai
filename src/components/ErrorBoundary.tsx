// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — React Error Boundary
// Catches rendering crashes and displays a recovery UI instead of a blank screen.

import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
  fallbackView?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[PrismOS-AI ErrorBoundary]", error, errorInfo);
  }

  handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert" aria-live="assertive">
          <div className="error-boundary-content">
            <span className="error-boundary-icon" aria-hidden="true">⚠️</span>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {this.props.fallbackView
                ? `The ${this.props.fallbackView} view encountered an error.`
                : "An unexpected error occurred in this view."}
            </p>
            {this.state.error && (
              <details className="error-boundary-details">
                <summary>Error details</summary>
                <pre>{this.state.error.message}</pre>
                {this.state.errorInfo?.componentStack && (
                  <pre className="error-boundary-stack">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}
            <div className="error-boundary-actions">
              <button
                className="error-boundary-btn error-boundary-btn-primary"
                onClick={this.handleRecover}
              >
                Try Again
              </button>
              <button
                className="error-boundary-btn error-boundary-btn-secondary"
                onClick={this.handleReload}
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
