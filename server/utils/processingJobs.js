import { initialEnrichmentJob } from './itemEnrichmentPlan.js';

function enqueuePlan(queue, plan) {
  if (!plan) return null;
  return queue.enqueue(plan.type, {
    linkId: plan.linkId,
    payload: plan.payload,
    maxAttempts: plan.maxAttempts,
  });
}

export function enqueueLinkProcessing(queue, { linkId, url, title = '' }) {
  return enqueuePlan(queue, initialEnrichmentJob('link', { linkId, url, title }));
}

export function enqueueImageProcessing(queue, { linkId, diskPath }) {
  return enqueuePlan(queue, initialEnrichmentJob('image', { linkId, diskPath }));
}

export function enqueueFileProcessing(queue, { linkId, diskPath, originalName, isHtml = false }) {
  return enqueuePlan(queue, initialEnrichmentJob('file', { linkId, diskPath, originalName, isHtml }));
}
