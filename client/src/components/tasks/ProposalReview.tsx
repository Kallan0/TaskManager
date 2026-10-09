import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { tasksApi, type Task } from '../../api/tasks.api';
import { ErrorMessage } from '../common/Feedback';
import { ApiError } from '../../api/client';
export function ProposalReview({
  task,
  onReviewed,
  onReload,
}: {
  task: Task;
  onReviewed: (task: Task) => Promise<unknown>;
  onReload: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      tasksApi.review(task.teamId, task.id, decision, task.version, reason),
    onSuccess: onReviewed,
  });
  return (
    <section className="proposal-review">
      <h2 className="panel-title">Celestial approval</h2>
      <p>
        Review the proposed details before adding this mission to the crew’s
        list and board.
      </p>
      <label htmlFor="rejection-reason">Reason if rejecting (optional)</label>
      <textarea
        id="rejection-reason"
        maxLength={500}
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={review.isPending}
      />
      <ErrorMessage error={review.error} />
      {review.error instanceof ApiError && review.error.status === 409 && (
        <button
          className="secondary"
          onClick={async () => {
            await onReload();
            review.reset();
          }}
        >
          Reload proposal
        </button>
      )}
      <div className="action-row">
        <button
          className="primary"
          disabled={review.isPending}
          onClick={() => review.mutate('approved')}
        >
          Approve mission
        </button>
        <button
          className="secondary danger-button"
          disabled={review.isPending}
          onClick={() => review.mutate('rejected')}
        >
          Reject proposal
        </button>
      </div>
    </section>
  );
}
