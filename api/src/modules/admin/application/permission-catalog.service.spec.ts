import { PERMISSION_CATALOG } from '@handshake-agent/contracts';

import { PermissionCatalogService } from './permission-catalog.service';
import type {
  IPermissionRepository,
  PermissionCatalogEntry,
  PermissionRecord,
} from './ports/permission.repository.port';

function makeRepo(): {
  repo: IPermissionRepository;
  upserts: PermissionCatalogEntry[][];
  listResult: PermissionRecord[];
} {
  const upserts: PermissionCatalogEntry[][] = [];
  const listResult: PermissionRecord[] = [
    {
      id: 'p1',
      resourceType: 'api_route',
      resourceId: 'GET /admin/admins',
      action: 'read',
      category: 'Access',
      description: 'List admin users',
    },
  ];
  const repo: IPermissionRepository = {
    upsertCatalog(entries): Promise<void> {
      upserts.push(entries);
      return Promise.resolve();
    },
    list: () => Promise.resolve(listResult),
    findByRole: () => Promise.resolve([]),
  };
  return { repo, upserts, listResult };
}

describe('PermissionCatalogService', () => {
  it('syncCatalog forwards the full catalog to upsertCatalog', async () => {
    const { repo, upserts } = makeRepo();

    await new PermissionCatalogService(repo).syncCatalog();

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toEqual([...PERMISSION_CATALOG]);
  });

  it('list returns the repository rows', async () => {
    const { repo, listResult } = makeRepo();

    const result = await new PermissionCatalogService(repo).list();

    expect(result).toBe(listResult);
  });
});
