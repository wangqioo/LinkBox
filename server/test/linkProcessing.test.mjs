import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueFileProcessing,
  enqueueImageProcessing,
  enqueueLinkProcessing,
} from '../utils/processingJobs.js';

test('enqueueLinkProcessing schedules metadata job with link url and optional title', () => {
  const jobs = [];
  const queue = {
    enqueue(type, options) {
      jobs.push({ type, ...options });
    },
  };

  enqueueLinkProcessing(queue, {
    linkId: 123,
    url: 'https://example.com/article',
    title: 'Example title',
  });

  assert.deepEqual(jobs, [{
    type: 'link.fetchMetadata',
    linkId: 123,
    payload: {
      url: 'https://example.com/article',
      title: 'Example title',
    },
    maxAttempts: 3,
  }]);
});

test('enqueueImageProcessing schedules image description job', () => {
  const jobs = [];
  const queue = {
    enqueue(type, options) {
      jobs.push({ type, ...options });
    },
  };

  enqueueImageProcessing(queue, {
    linkId: 321,
    diskPath: '/tmp/uploaded.png',
  });

  assert.deepEqual(jobs, [{
    type: 'image.describe',
    linkId: 321,
    payload: { diskPath: '/tmp/uploaded.png' },
    maxAttempts: 3,
  }]);
});

test('enqueueFileProcessing schedules file extraction job', () => {
  const jobs = [];
  const queue = {
    enqueue(type, options) {
      jobs.push({ type, ...options });
    },
  };

  enqueueFileProcessing(queue, {
    linkId: 456,
    diskPath: '/tmp/uploaded.html',
    originalName: 'note.html',
    isHtml: true,
  });

  assert.deepEqual(jobs, [{
    type: 'file.extractMarkdown',
    linkId: 456,
    payload: {
      diskPath: '/tmp/uploaded.html',
      originalName: 'note.html',
      isHtml: true,
    },
    maxAttempts: 3,
  }]);
});
