import { Compass, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <div className="error-box" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        className="secondary"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
export function LoadingState({
  label = 'Loading workspace…',
  cards = 3,
}: {
  label?: string;
  cards?: number;
}) {
  return (
    <div
      className="loading-state"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="loading-label">
        <LoaderCircle size={17} aria-hidden="true" />
        {label}
      </span>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="empty-panel">
      <div className="empty-icon">
        <Compass size={27} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  );
}
