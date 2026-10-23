import type { StorageStatus } from '@pfa/shared';

interface Props {
  storage: StorageStatus | null;
}

/**
 * States plainly which database the numbers on screen came from.
 *
 * A local JSON file and a shared PostgreSQL instance look identical from the
 * UI, so the difference is spelled out rather than left to be assumed.
 */
export function StorageNote({ storage }: Props): JSX.Element | null {
  if (!storage) return null;

  return (
    <p className="storage-note">
      <strong>
        {storage.kind === 'postgres' ? 'Shared database' : 'This computer only'}
      </strong>{' '}
      {storage.description}
    </p>
  );
}
