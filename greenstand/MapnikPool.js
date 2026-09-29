const log = require('loglevel');

/**
 * Bounded pool for configured Mapnik maps.
 *
 * Maps are keyed by their immutable datasource/style configuration (the tile
 * coordinate and request parameters in the server). A map is never shared by
 * two renders at once, which keeps Mapnik's mutable extent isolated.
 */
class MapnikPool {
  constructor(options = {}) {
    const {
      max = 8,
      min = 2,
      acquireTimeout = 5000,
      create,
      reset = () => undefined,
      destroy = () => undefined,
    } = options;

    if (!Number.isInteger(max) || max < 1) {
      throw new TypeError('MapnikPool max must be a positive integer');
    }
    if (!Number.isInteger(min) || min < 0) {
      throw new TypeError('MapnikPool min must be a non-negative integer');
    }
    if (typeof create !== 'function') {
      throw new TypeError('MapnikPool requires a create function');
    }

    this.max = max;
    this.min = Math.min(min, max);
    this.acquireTimeout = acquireTimeout;
    this.create = create;
    this.reset = reset;
    this.destroyResource = destroy;
    this.idle = new Map();
    this.resources = new Map();
    this.waiters = [];
    this.closed = false;
    this.creating = 0;
  }

  get size() {
    return this.resources.size + this.creating;
  }

  get idleCount() {
    let count = 0;
    for (const resources of this.idle.values()) count += resources.length;
    return count;
  }

  get activeCount() {
    return this.resources.size - this.idleCount;
  }

  get pendingCount() {
    return this.waiters.length;
  }

  _idleFor(key) {
    if (!this.idle.has(key)) this.idle.set(key, []);
    return this.idle.get(key);
  }

  _takeIdle(key) {
    const resources = this.idle.get(key);
    if (!resources || resources.length === 0) return undefined;
    const resource = resources.pop();
    if (resources.length === 0) this.idle.delete(key);
    const entry = this.resources.get(resource);
    entry.state = 'leased';
    return resource;
  }

  _findWaiterWithIdle() {
    return this.waiters.findIndex(({ key }) => {
      const resources = this.idle.get(key);
      return resources && resources.length > 0;
    });
  }

  _takeAnyIdle() {
    for (const resources of this.idle.values()) {
      if (resources.length > 0) return resources[resources.length - 1];
    }
    return undefined;
  }

  _removeWaiter(waiter) {
    const index = this.waiters.indexOf(waiter);
    if (index !== -1) this.waiters.splice(index, 1);
  }

  _settleWaiter(waiter, resource) {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.settled = true;
    waiter.resolve(resource);
  }

  async _createForWaiter(waiter) {
    this.creating += 1;
    try {
      const resource = await waiter.create(waiter.key);
      if (this.closed || waiter.settled) {
        await this._destroyUntracked(resource);
        return;
      }
      this.resources.set(resource, { key: waiter.key, state: 'leased' });
      this._settleWaiter(waiter, resource);
    } catch (error) {
      if (!waiter.settled) {
        this._settleWaiterError(waiter, error);
      } else {
        log.error('Mapnik map creation failed after timeout:', error);
      }
    } finally {
      this.creating -= 1;
      this._pump();
      this._checkDrained();
    }
  }

  _settleWaiterError(waiter, error) {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.settled = true;
    waiter.reject(error);
  }

  _pump() {
    if (this.closed) return;

    while (this.waiters.length > 0) {
      const idleIndex = this._findWaiterWithIdle();
      if (idleIndex !== -1) {
        const waiter = this.waiters.splice(idleIndex, 1)[0];
        const resource = this._takeIdle(waiter.key);
        this._settleWaiter(waiter, resource);
        continue;
      }

      if (this.resources.size + this.creating >= this.max) {
        const idleResource = this._takeAnyIdle();
        if (!idleResource) return;
        // A cached map for another tile cannot satisfy this waiter. Evict it
        // before creating the requested configuration, preserving the bound.
        this.destroy(idleResource);
        continue;
      }
      const waiter = this.waiters.shift();
      this._createForWaiter(waiter);
    }
  }

  acquire(key = 'default', create = this.create) {
    if (this.closed) return Promise.reject(new Error('MapnikPool is closed'));

    const idleResource = this._takeIdle(key);
    if (idleResource) return Promise.resolve(idleResource);

    if (this.resources.size + this.creating < this.max) {
      const waiter = this._newWaiter(key, create);
      this._createForWaiter(waiter);
      return waiter.promise;
    }

    const waiter = this._newWaiter(key, create);
    this.waiters.push(waiter);
    return waiter.promise;
  }

  _newWaiter(key, create) {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const waiter = {
      key,
      create,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      settled: false,
    };

    if (this.acquireTimeout > 0) {
      waiter.timer = setTimeout(() => {
        if (waiter.settled) return;
        this._removeWaiter(waiter);
        this._settleWaiterError(
          waiter,
          new Error(`Timed out acquiring Mapnik map for key: ${key}`),
        );
      }, this.acquireTimeout);
    }
    return waiter;
  }

  async release(resource) {
    const entry = this.resources.get(resource);
    if (!entry || entry.state !== 'leased') return false;

    try {
      await this.reset(resource);
      if (this.closed) {
        this.resources.delete(resource);
        await this._destroyUntracked(resource);
        this._checkDrained();
        return true;
      }
      entry.state = 'idle';
      this._idleFor(entry.key).push(resource);
    } catch (error) {
      await this.destroy(resource);
      log.warn('Destroyed Mapnik map while resetting it:', error);
      return false;
    }
    this._pump();
    return true;
  }

  async destroy(resource) {
    const entry = this.resources.get(resource);
    if (!entry) return false;
    this.resources.delete(resource);
    if (entry.state === 'idle') {
      const resources = this.idle.get(entry.key);
      const index = resources ? resources.indexOf(resource) : -1;
      if (index !== -1) resources.splice(index, 1);
      if (resources && resources.length === 0) this.idle.delete(entry.key);
    }
    await this._destroyUntracked(resource);
    this._pump();
    this._checkDrained();
    return true;
  }

  async _destroyUntracked(resource) {
    try {
      await this.destroyResource(resource);
    } catch (error) {
      log.warn('Error destroying Mapnik map:', error);
    }
  }

  _checkDrained() {
    if (
      this.closed &&
      this.resources.size === 0 &&
      this.creating === 0 &&
      this.drainResolve
    ) {
      this.drainResolve();
      this.drainResolve = undefined;
    }
  }

  async use(key, operation, create = this.create) {
    const resource = await this.acquire(key, create);
    let failed = false;
    try {
      return await operation(resource);
    } catch (error) {
      failed = true;
      await this.destroy(resource);
      throw error;
    } finally {
      if (!failed && this.resources.has(resource)) await this.release(resource);
    }
  }

  /** Pre-create a configured key's maps during a controlled warmup phase. */
  async warmup(key, create = this.create, count = this.min) {
    const resources = await Promise.all(
      Array.from({ length: Math.min(count, this.max) }, () =>
        this.acquire(key, create),
      ),
    );
    await Promise.all(resources.map((resource) => this.release(resource)));
  }

  async drain() {
    this.closed = true;
    const error = new Error('MapnikPool is closed');
    for (const waiter of this.waiters.splice(0)) {
      this._settleWaiterError(waiter, error);
    }
    const idleResources = [];
    for (const [resource, entry] of this.resources.entries()) {
      if (entry.state === 'idle') idleResources.push(resource);
    }
    await Promise.all(idleResources.map((resource) => this.destroy(resource)));
    if (this.resources.size === 0 && this.creating === 0) return;
    await new Promise((resolve) => {
      this.drainResolve = resolve;
    });
  }
}

module.exports = MapnikPool;
