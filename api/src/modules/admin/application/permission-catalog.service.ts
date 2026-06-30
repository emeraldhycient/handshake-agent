import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION_CATALOG } from '@handshake-agent/contracts';

import {
  PERMISSION_REPOSITORY,
  type IPermissionRepository,
  type PermissionRecord,
} from './ports/permission.repository.port';

// ADM-04 permission catalog. The catalog is the SINGLE source of truth shared with
// the web-admin app; this service seeds it idempotently (the repo upserts by the
// unique [resourceType, resourceId, action] triple) and lists it back for the API.
@Injectable()
export class PermissionCatalogService {
  constructor(
    @Inject(PERMISSION_REPOSITORY)
    private readonly permissions: IPermissionRepository,
  ) {}

  /** Idempotent: forwards the whole compiled catalog to the repo's upsert. */
  async syncCatalog(): Promise<void> {
    await this.permissions.upsertCatalog([...PERMISSION_CATALOG]);
  }

  list(): Promise<PermissionRecord[]> {
    return this.permissions.list();
  }
}
