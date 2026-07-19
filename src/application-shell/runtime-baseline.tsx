import { createRoot } from "react-dom/client";

export interface RuntimeBaselineProps {
  readonly label: string;
}

export function RuntimeBaseline({ label }: RuntimeBaselineProps) {
  return <output>{label}</output>;
}

export function mountRuntimeBaseline(
  container: HTMLElement,
  label: string,
): () => void {
  const root = createRoot(container);
  root.render(<RuntimeBaseline label={label} />);
  return () => root.unmount();
}
