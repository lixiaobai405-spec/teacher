function createSemaphore(limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('Semaphore limit must be a positive integer');
  }

  let active = 0;
  const waiting = [];

  function acquire() {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve)).then(() => {
      active += 1;
    });
  }

  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }

  return Object.freeze({
    async run(work) {
      await acquire();
      try {
        return await work();
      } finally {
        release();
      }
    },
  });
}

module.exports = { createSemaphore };
