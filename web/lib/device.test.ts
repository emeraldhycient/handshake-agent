import { beforeEach, describe, expect, it } from 'vitest'
import { getDeviceFingerprint } from './device'

describe('getDeviceFingerprint', () => {
  beforeEach(() => {
    localStorage.removeItem('ha.deviceFingerprint')
  })

  it('returns a string with length >= 8', () => {
    const fingerprint = getDeviceFingerprint()
    expect(typeof fingerprint).toBe('string')
    expect(fingerprint.length).toBeGreaterThanOrEqual(8)
  })

  it('returns the same value on subsequent calls', () => {
    const first = getDeviceFingerprint()
    const second = getDeviceFingerprint()
    expect(second).toBe(first)
  })

  it('persists to localStorage under ha.deviceFingerprint', () => {
    const fingerprint = getDeviceFingerprint()
    const stored = localStorage.getItem('ha.deviceFingerprint')
    expect(stored).toBe(fingerprint)
  })
})
