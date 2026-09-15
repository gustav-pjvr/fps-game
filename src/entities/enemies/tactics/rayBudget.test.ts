import { describe, expect, it } from 'vitest';
import { RayBudget, TacticalScheduler } from './rayBudget.ts';

describe('RayBudget', () => {
  it('grants what is left, flags when it runs short, and resets each tick', () => {
    const budget = new RayBudget(16);
    expect(budget.take(10)).toBe(10);
    expect(budget.exhaustedThisTick).toBe(false);
    expect(budget.take(10)).toBe(6);
    expect(budget.exhaustedThisTick).toBe(true);
    expect(budget.take(1)).toBe(0);
    budget.beginTick();
    expect(budget.remaining).toBe(16);
    expect(budget.exhaustedThisTick).toBe(false);
  });

  it('takes back unused rays, never above the per-tick amount', () => {
    const budget = new RayBudget(16);
    budget.take(8);
    budget.giveBack(5);
    expect(budget.remaining).toBe(13);
    budget.giveBack(100);
    expect(budget.remaining).toBe(16);
  });
});

describe('TacticalScheduler', () => {
  it('runs as many due jobs as the budget allows, refunding unused rays', () => {
    const scheduler = new TacticalScheduler(0.5, 8);
    scheduler.sync([1, 2, 3]);
    const budget = new RayBudget(16);
    const greedy = scheduler.update(0, budget, (_id, allowance) => allowance);
    expect(greedy).toEqual({ ran: 2, deferred: 1 });

    const frugal = new TacticalScheduler(0.5, 8);
    frugal.sync([1, 2, 3]);
    budget.beginTick();
    expect(frugal.update(0, budget, () => 2)).toEqual({ ran: 3, deferred: 0 });
  });

  it('runs a deferred job first next tick and waits out the refresh interval for the rest', () => {
    const scheduler = new TacticalScheduler(0.5, 8);
    scheduler.sync([1, 2, 3]);
    const budget = new RayBudget(16);
    const order: number[] = [];
    scheduler.update(0, budget, (id, allowance) => {
      order.push(id);
      return allowance;
    });
    budget.beginTick();
    scheduler.update(0.1, budget, (id, allowance) => {
      order.push(id);
      return allowance;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('lets nobody starve when every tick is over budget', () => {
    const scheduler = new TacticalScheduler(0, 8);
    const ids = [1, 2, 3, 4, 5];
    scheduler.sync(ids);
    const budget = new RayBudget(16);
    const runs = new Map<number, number>();
    for (let tick = 0; tick < 30; tick++) {
      budget.beginTick();
      scheduler.update(tick / 60, budget, (id, allowance) => {
        runs.set(id, (runs.get(id) ?? 0) + 1);
        return allowance;
      });
    }
    for (const id of ids) expect(runs.get(id)).toBe(12);
  });

  it('forgets jobs dropped from the list and runs new ones at once', () => {
    const scheduler = new TacticalScheduler(0.5, 8);
    scheduler.sync([1]);
    const budget = new RayBudget(16);
    scheduler.update(0, budget, () => 1);
    scheduler.sync([2]);
    budget.beginTick();
    const ran: number[] = [];
    scheduler.update(0.1, budget, (id) => {
      ran.push(id);
      return 1;
    });
    expect(ran).toEqual([2]);
  });
});
