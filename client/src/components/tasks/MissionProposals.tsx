import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '../../api/tasks.api';
import {
  ErrorMessage,
  Pagination,
  LoadingState,
  EmptyState,
} from '../common/Feedback';
export function MissionProposals({ teamId }: { teamId: string }) {
  const [state, setState] = useState<'pending' | 'rejected'>('pending');
  const [page, setPage] = useState(1);
  const proposals = useQuery({
    queryKey: ['mission-proposals', teamId, state, page],
    queryFn: () => tasksApi.list(teamId, { approval: state }, page),
  });
  return (
    <section className="content-panel mission-proposals">
      <div className="proposal-heading">
        <div>
          <h2 className="panel-title">Mission proposals</h2>
          <p className="muted small-text">
            Holy Knights propose. The Celestial approves missions for the crew.
          </p>
        </div>
        <label>
          Review status
          <select
            aria-label="Proposal review status"
            value={state}
            onChange={(event) => {
              setState(event.target.value as typeof state);
              setPage(1);
            }}
          >
            <option value="pending">Awaiting approval</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      <ErrorMessage error={proposals.error} />
      {proposals.isPending && (
        <LoadingState label="Loading proposals…" cards={2} />
      )}
      {proposals.data?.total === 0 && (
        <EmptyState
          title={
            state === 'pending'
              ? 'No proposals awaiting approval.'
              : 'No rejected proposals.'
          }
          description={
            state === 'pending'
              ? 'The review queue is clear. New Holy Knight proposals will appear here.'
              : 'Rejected proposals will appear here with their review decision.'
          }
        />
      )}
      <ul className="proposal-list">
        {proposals.data?.items.map((proposal) => (
          <li key={proposal.id}>
            <div>
              <Link to={`/teams/${teamId}/tasks/${proposal.id}`}>
                {proposal.title}
              </Link>
              <small>
                Proposed by {proposal.creator?.name ?? 'Former user'} ·{' '}
                {new Date(proposal.createdAt).toLocaleString()}
              </small>
            </div>
            <Link
              className="secondary"
              to={`/teams/${teamId}/tasks/${proposal.id}`}
            >
              {proposal.canReview ? 'Review proposal' : 'View proposal'}
            </Link>
          </li>
        ))}
      </ul>
      {proposals.data && (
        <Pagination
          page={page}
          pages={proposals.data.pages}
          onChange={setPage}
        />
      )}
    </section>
  );
}
