import type { User } from '../types';

/** Older profile responses omit capability flags. Never infer Google from that. */
export function getAccountDeletionMethod(
  user: Pick<User, 'has_password' | 'google_linked'>,
): 'password' | 'google' {
  return user.has_password === false && user.google_linked === true ? 'google' : 'password';
}
