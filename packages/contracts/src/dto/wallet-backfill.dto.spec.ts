import { describe, it, expect } from 'vitest'
import {
  BackfillNetworksRequestSchema,
  BackfillReportSchema,
  PerNetworkTallySchema,
  BackfillFailureSchema,
} from './wallet-backfill.dto'

describe('BackfillNetworksRequestSchema', () => {
  it('parses an empty object (all fields optional)', () => {
    const result = BackfillNetworksRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('parses valid batchSize and dryRun', () => {
    const result = BackfillNetworksRequestSchema.safeParse({
      batchSize: 50,
      dryRun: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.batchSize).toBe(50)
      expect(result.data.dryRun).toBe(true)
    }
  })

  it('rejects non-positive batchSize', () => {
    expect(
      BackfillNetworksRequestSchema.safeParse({ batchSize: 0 }).success,
    ).toBe(false)
    expect(
      BackfillNetworksRequestSchema.safeParse({ batchSize: -1 }).success,
    ).toBe(false)
  })

  it('rejects non-integer batchSize', () => {
    expect(
      BackfillNetworksRequestSchema.safeParse({ batchSize: 1.5 }).success,
    ).toBe(false)
  })

  it('rejects non-boolean dryRun', () => {
    expect(
      BackfillNetworksRequestSchema.safeParse({ dryRun: 'yes' }).success,
    ).toBe(false)
  })
})

describe('PerNetworkTallySchema', () => {
  it('parses valid tally', () => {
    const result = PerNetworkTallySchema.safeParse({ alreadyHad: 3, provisioned: 2 })
    expect(result.success).toBe(true)
  })

  it('rejects negative counts', () => {
    expect(
      PerNetworkTallySchema.safeParse({ alreadyHad: -1, provisioned: 0 }).success,
    ).toBe(false)
    expect(
      PerNetworkTallySchema.safeParse({ alreadyHad: 0, provisioned: -1 }).success,
    ).toBe(false)
  })

  it('rejects missing fields', () => {
    expect(PerNetworkTallySchema.safeParse({ alreadyHad: 1 }).success).toBe(false)
    expect(PerNetworkTallySchema.safeParse({ provisioned: 1 }).success).toBe(false)
  })
})

describe('BackfillFailureSchema', () => {
  it('parses valid failure record', () => {
    const result = BackfillFailureSchema.safeParse({
      userId: 'uuid-1',
      error: 'Provider timeout',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing userId or error', () => {
    expect(BackfillFailureSchema.safeParse({ error: 'boom' }).success).toBe(false)
    expect(BackfillFailureSchema.safeParse({ userId: 'id' }).success).toBe(false)
  })
})

describe('BackfillReportSchema', () => {
  it('parses a valid full report', () => {
    const report = {
      usersScanned: 42,
      perNetwork: {
        TRON: { alreadyHad: 40, provisioned: 2 },
        ETH: { alreadyHad: 38, provisioned: 4 },
      },
      failures: [{ userId: 'bad-user', error: 'Timeout' }],
    }
    const result = BackfillReportSchema.safeParse(report)
    expect(result.success).toBe(true)
  })

  it('parses a zero-failures report', () => {
    const result = BackfillReportSchema.safeParse({
      usersScanned: 0,
      perNetwork: {},
      failures: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative usersScanned', () => {
    const result = BackfillReportSchema.safeParse({
      usersScanned: -1,
      perNetwork: {},
      failures: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid perNetwork entries', () => {
    const result = BackfillReportSchema.safeParse({
      usersScanned: 1,
      perNetwork: { TRON: { alreadyHad: -1, provisioned: 0 } },
      failures: [],
    })
    expect(result.success).toBe(false)
  })
})
