import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { ActivityList } from './ActivityList';

function ActivityHistory({
  teamId,
  taskId,
  onDismiss,
}: {
  teamId: string;
  taskId?: string;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="activity-dialog"
      aria-labelledby="activity-history-title"
      onCancel={onDismiss}
      onClose={(event) => {
        // StrictMode may queue a close event while remounting an already-open dialog.
        if (!event.currentTarget.open) onDismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onDismiss();
      }}
    >
      <header className="activity-dialog-header">
        <div>
          <span className="eyebrow">CREW TIMELINE</span>
          <h2 id="activity-history-title">
            {taskId ? 'Mission activity history' : 'Team activity history'}
          </h2>
        </div>
        <button
          className="activity-dialog-close"
          aria-label="Close activity history"
          onClick={onDismiss}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="activity-dialog-content">
        <ActivityList teamId={teamId} taskId={taskId} />
      </div>
    </dialog>,
    document.body,
  );
}

export function ActivityPreview({
  teamId,
  taskId,
}: {
  teamId: string;
  taskId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="activity-preview"
      aria-label={taskId ? 'Recent mission activity' : 'Recent team activity'}
    >
      <div className="activity-preview-heading">
        <h2 className="panel-title">
          {taskId ? 'Latest activity' : 'Latest team activity'}
        </h2>
        <button
          className="secondary"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <History size={15} aria-hidden="true" />
          View history
        </button>
      </div>
      <ActivityList teamId={teamId} taskId={taskId} latestOnly />
      {open && (
        <ActivityHistory
          teamId={teamId}
          taskId={taskId}
          onDismiss={() => setOpen(false)}
        />
      )}
    </section>
  );
}
