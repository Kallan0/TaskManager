import { useQuery } from '@tanstack/react-query';
import { ApiError, authApi } from '../api/client';
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}
