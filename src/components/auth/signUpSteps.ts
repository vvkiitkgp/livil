import { passwordProblem } from '../../../shared/services/passwordPolicy';
import { USERNAME_RE, type UsernameStatus } from './usernameCheck';

/**
 * What stops each sign-up step from going on, as the line the person sees — or null when
 * the step is complete. Pure, so both sign-up paths and their tests share one set of rules.
 */

export type NameStep = { kind: 'name'; displayName: string };
export type UsernameStep = { kind: 'username'; username: string; status: UsernameStatus };
export type AccountStep = { kind: 'account'; email: string; password: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function stepProblem(step: NameStep | UsernameStep | AccountStep): string | null {
  switch (step.kind) {
    case 'name':
      return step.displayName.trim() ? null : 'Add your name.';
    case 'username':
      if (!USERNAME_RE.test(step.username)) {return 'Use 3–30 letters, numbers or _.';}
      if (step.status === 'taken') {return 'That username is taken. Try another.';}
      return null;
    case 'account':
      if (!EMAIL_RE.test(step.email.trim())) {return 'Enter a valid email.';}
      return passwordProblem(step.password);
  }
}
