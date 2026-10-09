import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 15000,
      refetchInterval: (query) =>
        [
          'tasks',
          'task',
          'team',
          'task-summary',
          'mission-comments',
          'mission-proposals',
          'incoming-invitations',
          'members',
          'team-invitations',
          'invitations',
          'team-members',
        ].includes(String(query.queryKey[0]))
          ? 30000
          : false,
      refetchIntervalInBackground: false,
    },
  },
});
