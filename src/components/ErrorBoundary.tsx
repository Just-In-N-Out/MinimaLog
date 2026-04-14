import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging (console.error is kept in production)
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.href = "/auth";
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            backgroundColor: "#fff",
            color: "#000",
          }}
        >
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "12px" }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "16px",
              color: "#666",
              textAlign: "center",
              marginBottom: "24px",
              maxWidth: "300px",
            }}
          >
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "12px 24px",
                fontSize: "16px",
                fontWeight: "600",
                backgroundColor: "#f3f4f6",
                color: "#000",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleRetry}
              style={{
                padding: "12px 24px",
                fontSize: "16px",
                fontWeight: "600",
                backgroundColor: "#000",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
              }}
            >
              Return to Login
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
