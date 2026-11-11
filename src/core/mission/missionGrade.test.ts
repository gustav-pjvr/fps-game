import { describe, expect, it } from 'vitest';
import { GRADE_PAR_SECONDS, missionGrade, missionScore } from './missionGrade.ts';

describe('missionGrade', () => {
  it('gives an S to a clean run inside par', () => {
    expect(missionScore({ seconds: 240, damageTaken: 0, redeploysUsed: 0 })).toBe(100);
    expect(missionGrade({ seconds: GRADE_PAR_SECONDS, damageTaken: 100, redeploysUsed: 0 })).toBe('S');
  });

  it('takes a point for every 6 seconds over par, 30 at most', () => {
    expect(missionScore({ seconds: GRADE_PAR_SECONDS + 60, damageTaken: 0, redeploysUsed: 0 })).toBe(90);
    expect(missionScore({ seconds: GRADE_PAR_SECONDS + 3600, damageTaken: 0, redeploysUsed: 0 })).toBe(70);
  });

  it('takes a point for every 12 damage, 30 at most', () => {
    expect(missionScore({ seconds: 0, damageTaken: 120, redeploysUsed: 0 })).toBe(90);
    expect(missionScore({ seconds: 0, damageTaken: 5000, redeploysUsed: 0 })).toBe(70);
  });

  it('takes 20 for each redeploy, so one rules out an S and two an A', () => {
    expect(missionGrade({ seconds: 0, damageTaken: 0, redeploysUsed: 1 })).toBe('A');
    expect(missionGrade({ seconds: 0, damageTaken: 0, redeploysUsed: 2 })).toBe('B');
  });

  it('grades S from 90, A from 75, B from 55 and C below', () => {
    expect(missionGrade({ seconds: 0, damageTaken: 132, redeploysUsed: 0 })).toBe('A');
    expect(missionGrade({ seconds: 0, damageTaken: 312, redeploysUsed: 0 })).toBe('B');
    expect(missionGrade({ seconds: 0, damageTaken: 400, redeploysUsed: 1 })).toBe('C');
    expect(missionGrade({ seconds: GRADE_PAR_SECONDS + 3600, damageTaken: 5000, redeploysUsed: 2 })).toBe('C');
  });
});
