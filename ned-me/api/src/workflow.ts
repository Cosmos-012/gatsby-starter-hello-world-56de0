export type State = 'draft' | 'submitted' | 'review' | 'validated' | 'approved' | 'published' | 'archived';
export type Role = 'admin' | 'me_manager' | 'data_entry' | 'reviewer' | 'viewer';

// Qui peut effectuer quelle transition (le graphe lui-même est aussi imposé par la base).
const RULES: Record<string, Role[]> = {
  'draft>submitted': ['data_entry', 'me_manager', 'admin'],
  'submitted>review': ['reviewer', 'me_manager', 'admin'],
  'review>validated': ['reviewer', 'me_manager', 'admin'],
  'validated>approved': ['me_manager', 'admin'],
  'approved>published': ['me_manager', 'admin'],
  'published>archived': ['me_manager', 'admin'],
  'submitted>draft': ['reviewer', 'me_manager', 'admin'],
  'review>draft': ['reviewer', 'me_manager', 'admin'],
  'validated>draft': ['me_manager', 'admin'],
};

export function canTransition(from: State, to: State, roles: readonly string[]): boolean {
  const allowed = RULES[`${from}>${to}`];
  return !!allowed && roles.some((r) => (allowed as string[]).includes(r));
}
export function transitionExists(from: State, to: State): boolean {
  return `${from}>${to}` in RULES;
}
/** Transitions que ces rôles peuvent effectuer depuis un état (pour n'afficher que des actions réellement permises). */
export function nextStates(from: State, roles: readonly string[]): State[] {
  return Object.keys(RULES).filter((k) => k.startsWith(`${from}>`)).map((k) => k.split('>')[1] as State).filter((to) => canTransition(from, to, roles));
}
