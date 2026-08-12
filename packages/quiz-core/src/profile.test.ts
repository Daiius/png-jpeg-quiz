import { describe, expect, it } from 'vitest'
import {
  buildProfileId,
  ENCODE_PROFILES,
  findProfile,
  profileIdSchema,
  STANDARD_PROFILE_ID,
} from './profile.ts'

describe('ENCODE_PROFILES', () => {
  it('20 プロファイルある（prd/01 §3.2）', () => {
    expect(ENCODE_PROFILES).toHaveLength(20)
  })

  it('ID が重複しない', () => {
    const ids = new Set(ENCODE_PROFILES.map((p) => p.id))
    expect(ids.size).toBe(ENCODE_PROFILES.length)
  })

  it('すべての ID が命名規則に合う', () => {
    for (const profile of ENCODE_PROFILES) {
      expect(profileIdSchema.safeParse(profile.id).success).toBe(true)
    }
  })

  it('標準プロファイルはちょうど 1 つで、q80-420-oxi-v1', () => {
    const standards = ENCODE_PROFILES.filter((p) => p.isStandard)
    expect(standards).toHaveLength(1)
    expect(standards[0]?.id).toBe('q80-420-oxi-v1')
    expect(STANDARD_PROFILE_ID).toBe('q80-420-oxi-v1')
  })

  it('順序が決定的（seed の冪等性のため）', () => {
    expect(ENCODE_PROFILES[0]?.id).toBe('q60-420-oxi-v1')
    expect(ENCODE_PROFILES.at(-1)?.id).toBe('q95-444-raw-v1')
  })
})

describe('buildProfileId', () => {
  it('品質・サブサンプリング・PNG 最適化から組み立てる', () => {
    expect(buildProfileId(80, '4:2:0', true)).toBe('q80-420-oxi-v1')
    expect(buildProfileId(95, '4:4:4', false)).toBe('q95-444-raw-v1')
  })
})

describe('findProfile', () => {
  it('知らない ID には undefined', () => {
    expect(findProfile('q80-420-oxi-v1')?.jpegQuality).toBe(80)
    expect(findProfile('std-v1')).toBeUndefined()
  })
})

describe('profileIdSchema', () => {
  it('エイリアスのような ID を拒否する（prd/01 §3.1）', () => {
    expect(profileIdSchema.safeParse('std-v1').success).toBe(false)
    expect(profileIdSchema.safeParse('q85-420-oxi-v1').success).toBe(false)
    expect(profileIdSchema.safeParse('q80-411-oxi-v1').success).toBe(false)
  })
})
