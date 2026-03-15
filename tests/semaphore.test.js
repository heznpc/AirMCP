import { describe, test, expect } from '@jest/globals';
import { Semaphore } from '../dist/shared/semaphore.js';

describe('Semaphore', () => {
  test('allows up to maxConcurrent slots', async () => {
    const sem = new Semaphore(2);
    const log = [];

    const task = async (id, delay) => {
      await sem.acquire();
      log.push(`start-${id}`);
      await new Promise(r => setTimeout(r, delay));
      log.push(`end-${id}`);
      sem.release();
    };

    await Promise.all([task('a', 50), task('b', 50), task('c', 50)]);

    // a and b start concurrently, c waits
    expect(log[0]).toBe('start-a');
    expect(log[1]).toBe('start-b');
    // c starts only after a or b finishes
    const cStartIdx = log.indexOf('start-c');
    expect(cStartIdx).toBeGreaterThanOrEqual(3);
  });

  test('release unblocks queued acquire', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const pending = sem.acquire().then(() => { acquired = true; });

    // Not yet acquired
    await new Promise(r => setTimeout(r, 10));
    expect(acquired).toBe(false);

    // Release unblocks
    sem.release();
    await pending;
    expect(acquired).toBe(true);

    sem.release();
  });

  test('double release is guarded (logs error, does not go negative)', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    sem.release();

    // Capture console.error
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    sem.release(); // double release

    console.error = origError;

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('double-release');
  });

  test('works with maxConcurrent = 1 (mutex)', async () => {
    const sem = new Semaphore(1);
    const order = [];

    const task = async (id) => {
      await sem.acquire();
      order.push(id);
      await new Promise(r => setTimeout(r, 10));
      sem.release();
    };

    await Promise.all([task(1), task(2), task(3)]);

    expect(order).toEqual([1, 2, 3]);
  });

  test('handles high concurrency', async () => {
    const sem = new Semaphore(3);
    let maxRunning = 0;
    let running = 0;

    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      await sem.acquire();
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 5));
      running--;
      sem.release();
    });

    await Promise.all(tasks.map(t => t()));

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(running).toBe(0);
  });
});
