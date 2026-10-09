import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, Pencil, Trash2 } from 'lucide-react';
import { commentsApi, type MissionComment } from '../../api/comments.api';
import { ApiError } from '../../api/client';
import { ErrorMessage, Pagination, LoadingState } from '../common/Feedback';
import type { Page } from '../../api/teams.api';

function CommentRow({
  comment,
  teamId,
  taskId,
  refresh,
}: {
  comment: MissionComment;
  teamId: string;
  taskId: string;
  refresh: () => Promise<Page<MissionComment> | undefined>;
}) {
  const [draft, setDraft] = useState<{ body: string; version: number } | null>(
    null,
  );
  const [validation, setValidation] = useState('');
  const save = useMutation({
    mutationFn: () =>
      commentsApi.update(
        teamId,
        taskId,
        comment.id,
        draft!.body.trim(),
        draft!.version,
      ),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      commentsApi.remove(teamId, taskId, comment.id, comment.version),
    onSuccess: refresh,
  });
  const busy = save.isPending || remove.isPending;
  async function reload() {
    const latest = (await refresh())?.items.find(
      (item) => item.id === comment.id,
    );
    setDraft(
      latest && draft ? { body: latest.body, version: latest.version } : null,
    );
    save.reset();
    remove.reset();
    setValidation('');
  }
  return (
    <li className="mission-comment">
      <div className="comment-heading">
        <span className="avatar">{comment.author.name[0]?.toUpperCase()}</span>
        <div>
          <strong>{comment.author.name}</strong>
          <time dateTime={comment.createdAt}>
            {new Date(comment.createdAt).toLocaleString()}
          </time>
          {comment.editedAt && (
            <span
              className="comment-edited"
              title={`Edited ${new Date(comment.editedAt).toLocaleString()}`}
            >
              Edited
            </span>
          )}
        </div>
        {!draft && (
          <div className="comment-actions">
            {comment.canEdit && (
              <button
                className="quiet"
                aria-label={`Edit comment by ${comment.author.name}`}
                disabled={busy}
                onClick={() => {
                  setDraft({ body: comment.body, version: comment.version });
                  setValidation('');
                  save.reset();
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                Edit
              </button>
            )}
            {comment.canDelete && (
              <button
                className="danger-text"
                aria-label={`Delete comment by ${comment.author.name}`}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(`Delete ${comment.author.name}'s comment?`)
                  )
                    remove.mutate();
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>
      {draft ? (
        <form
          className="comment-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.body.trim()) {
              setValidation('Write a comment before saving');
              return;
            }
            setValidation('');
            save.mutate();
          }}
        >
          <label htmlFor={`edit-comment-${comment.id}`}>
            Edit comment by {comment.author.name}
          </label>
          <textarea
            id={`edit-comment-${comment.id}`}
            value={draft.body}
            onChange={(event) =>
              setDraft({ ...draft, body: event.target.value })
            }
            rows={3}
            maxLength={4000}
            disabled={busy}
            aria-invalid={!!validation}
          />
          <p className="comment-counter">{draft.body.length} / 4000</p>
          <ErrorMessage error={validation} />
          <div className="action-row">
            <button className="primary" disabled={busy}>
              {save.isPending ? 'Saving…' : 'Save comment'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                save.reset();
                setValidation('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="comment-body">{comment.body}</p>
      )}
      <ErrorMessage error={save.error || remove.error} />
      {((save.error instanceof ApiError && save.error.status === 409) ||
        (remove.error instanceof ApiError && remove.error.status === 409)) && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void reload()}
        >
          Reload comment
        </button>
      )}
    </li>
  );
}

export function MissionDiscussion({
  teamId,
  taskId,
}: {
  teamId: string;
  taskId: string;
}) {
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [body, setBody] = useState('');
  const [validation, setValidation] = useState('');
  const comments = useQuery({
    queryKey: ['mission-comments', teamId, taskId, page],
    queryFn: () => commentsApi.list(teamId, taskId, page),
  });
  async function refresh() {
    await Promise.all(
      ['task-activity', 'team-activity'].map((key) =>
        cache.invalidateQueries({ queryKey: [key, teamId] }),
      ),
    );
    await cache.invalidateQueries({
      queryKey: ['mission-comments', teamId, taskId],
      refetchType: 'none',
    });
    const result = await comments.refetch();
    if (result.data && page > result.data.pages) setPage(result.data.pages);
    return result.data;
  }
  const create = useMutation({
    mutationFn: () => commentsApi.create(teamId, taskId, body.trim()),
    onSuccess: async () => {
      setBody('');
      setValidation('');
      const latest = await refresh();
      if (latest) setPage(latest.pages);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setValidation('Write a comment before posting');
      return;
    }
    setValidation('');
    create.mutate();
  }
  return (
    <section
      className="mission-discussion"
      aria-labelledby="discussion-heading"
    >
      <div className="discussion-heading">
        <h2 id="discussion-heading" className="panel-title">
          <MessageCircle size={18} aria-hidden="true" />
          Mission discussion
        </h2>
        <span>{comments.data?.total ?? 0} comments</span>
        <button
          className="quiet"
          disabled={comments.isFetching}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
      <ErrorMessage error={comments.error} />
      {comments.isPending && (
        <LoadingState label="Loading discussion…" cards={1} />
      )}
      {comments.data?.total === 0 && (
        <p className="discussion-empty">
          No comments yet. Share progress or ask your crew a question.
        </p>
      )}
      <ol className="mission-comments">
        {comments.data?.items.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            teamId={teamId}
            taskId={taskId}
            refresh={refresh}
          />
        ))}
      </ol>
      {comments.data && (
        <Pagination
          page={page}
          pages={comments.data.pages}
          onChange={setPage}
        />
      )}
      <form className="comment-composer" onSubmit={submit}>
        <label htmlFor="new-comment">Add a comment</label>
        <textarea
          id="new-comment"
          placeholder="Share an update or ask a question about this mission…"
          rows={3}
          maxLength={4000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={create.isPending || comments.isPending || comments.isError}
          aria-invalid={!!validation}
          aria-describedby="comment-help"
        />
        <p id="comment-help" className="comment-counter">
          Plain text · {body.length} / 4000
        </p>
        <ErrorMessage error={validation || create.error} />
        <button
          className="primary"
          disabled={create.isPending || comments.isPending || comments.isError}
        >
          <Send size={15} aria-hidden="true" />
          {create.isPending ? 'Posting…' : 'Post comment'}
        </button>
      </form>
    </section>
  );
}
