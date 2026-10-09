import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { useState } from 'react';
import { ErrorMessage } from '../common/Feedback';
import { crewNameSuggestions } from './crewTheme';
const schema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(80),
  description: z.string().trim().max(2000),
});
export type TeamValues = z.infer<typeof schema>;
export function TeamForm({
  initial,
  onSubmit,
  label = 'Create team',
}: {
  initial?: TeamValues;
  onSubmit: (values: TeamValues) => Promise<unknown>;
  label?: string;
}) {
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError: fieldError,
    formState: { errors, isSubmitting },
  } = useForm<TeamValues>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { name: '', description: '' },
  });
  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        setSuccess(false);
        try {
          await onSubmit(values);
          setSuccess(true);
        } catch (caught) {
          if (caught instanceof ApiError)
            caught.error.details?.forEach((detail) => {
              if (detail.field === 'name' || detail.field === 'description')
                fieldError(detail.field, { message: detail.message });
            });
          setError(caught);
        }
      })}
      noValidate
    >
      <div className="field">
        <label htmlFor="team-name">Team name</label>
        <input
          id="team-name"
          placeholder="e.g. Straw Hat"
          maxLength={80}
          {...register('name')}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'team-name-error' : undefined}
        />
        {errors.name && (
          <small id="team-name-error" className="field-error">
            {errors.name.message}
          </small>
        )}
      </div>
      {!initial && (
        <fieldset className="crew-suggestions">
          <legend>One Piece crew name suggestions</legend>
          <p>Pick a name for your crew, or write your own above.</p>
          <div>
            {crewNameSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={watch('name') === name}
                disabled={isSubmitting}
                onClick={() =>
                  setValue('name', name, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="team-description">
          Description <span className="muted">(optional)</span>
        </label>
        <textarea
          id="team-description"
          placeholder="What will your team work on?"
          rows={4}
          maxLength={2000}
          {...register('description')}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <small className="field-error">{errors.description.message}</small>
        )}
      </div>
      <ErrorMessage error={error} />
      {success && label !== 'Create team' && (
        <p className="success-message" role="status">
          Team settings saved.
        </p>
      )}
      <button className="primary" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : label}
      </button>
    </form>
  );
}
