import { useAppState } from '../state/store.js';

export function Toasts(): JSX.Element | null {
  const { toasts } = useAppState();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" data-ui-layer="true" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
