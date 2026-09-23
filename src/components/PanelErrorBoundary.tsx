import { RotateCcw, TriangleAlert, X } from "lucide-react";
import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
  active?: boolean;
  onRetry?: () => void;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}
interface State { error?: Error }

export function PanelFailure({ name, error, retry, close }: {
  name: string; error: Error; retry: () => void; close?: () => void;
}) {
  return <section className="panel-crash" role="alert">
    <TriangleAlert size={24} aria-hidden="true" />
    <h3>{name}暂时无法显示</h3>
    <p>可以重新打开此页面。未保存的页面内编辑可能需要重新输入。</p>
    <div className="panel-crash-actions">
      <button className="btn" onClick={retry}><RotateCcw size={14} />重新打开页面</button>
      {close && <button className="btn" onClick={close}><X size={14} />关闭</button>}
    </div>
    <details><summary>错误详情</summary><pre>{error.message}</pre></details>
  </section>;
}

/** Isolates render/lifecycle failures. Async operations handle errors at their own boundary. */
export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(reason: unknown): State {
    return { error: reason instanceof Error ? reason : new Error(String(reason)) };
  }
  private retry = () => {
    this.props.onRetry?.();
    this.setState({ error: undefined });
  };
  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A failed hidden feature must not obscure the newly selected feature.
    if (this.props.active === false) return null;
    return this.props.fallback?.(error, this.retry) ??
      <PanelFailure name={this.props.name} error={error} retry={this.retry} />;
  }
}
