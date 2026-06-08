let queue = null;

export function setRuntimeQueue(nextQueue) {
  queue = nextQueue;
}

export function getRuntimeQueue() {
  if (!queue) throw new Error('Job queue is not initialized');
  return queue;
}
