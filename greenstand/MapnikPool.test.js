const MapnikPool = require('./MapnikPool');

describe('MapnikPool', () => {
  it('reuses an idle map for the same configuration key', async () => {
    const create = jest.fn(async (key) => ({ key }));
    const reset = jest.fn();
    const pool = new MapnikPool({ max: 2, create, reset });

    const first = await pool.acquire('tile-a');
    await pool.release(first);
    const second = await pool.acquire('tile-a');

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith(first);
    await pool.release(second);
    await pool.drain();
  });

  it('bounds concurrent maps and services queued requests after release', async () => {
    const resolvers = [];
    const create = jest.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const pool = new MapnikPool({ max: 1, create, acquireTimeout: 100 });

    const firstPromise = pool.acquire('tile-a');
    await Promise.resolve();
    const queuedPromise = pool.acquire('tile-b');
    expect(pool.pendingCount).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);

    const first = { key: 'tile-a' };
    resolvers[0](first);
    await expect(firstPromise).resolves.toBe(first);
    await pool.release(first);
    expect(create).toHaveBeenCalledTimes(2);

    const second = { key: 'tile-b' };
    resolvers[1](second);
    await expect(queuedPromise).resolves.toBe(second);
    await pool.release(second);
    await pool.drain();
  });

  it('destroys a map when a render operation fails', async () => {
    const resource = {};
    const destroy = jest.fn();
    const pool = new MapnikPool({
      max: 1,
      create: async () => resource,
      destroy,
    });

    await expect(
      pool.use('tile-a', async () => {
        throw new Error('render failed');
      }),
    ).rejects.toThrow('render failed');
    expect(destroy).toHaveBeenCalledWith(resource);
    expect(pool.size).toBe(0);
  });

  it('rejects a request that waits longer than acquireTimeout', async () => {
    const pool = new MapnikPool({
      max: 1,
      acquireTimeout: 10,
      create: async (key) => ({ key }),
    });
    const first = await pool.acquire('tile-a');
    await expect(pool.acquire('tile-b')).rejects.toThrow(/Timed out/);
    await pool.release(first);
    await pool.drain();
  });

  it('drains idle maps and waits for active work to be released', async () => {
    const destroy = jest.fn();
    const pool = new MapnikPool({
      max: 2,
      create: async (key) => ({ key }),
      destroy,
    });
    const resource = await pool.acquire('tile-a');
    const drainPromise = pool.drain();
    let drained = false;
    drainPromise.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    await pool.release(resource);
    await drainPromise;
    expect(drained).toBe(true);
    expect(destroy).toHaveBeenCalledWith(resource);
  });
});
