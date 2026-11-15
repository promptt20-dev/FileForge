import crypto from 'node:crypto';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';

export interface HashTaskInput {
  path: string;
  size: number;
  mode: 'partial' | 'full';
}

export interface HashTaskOutput {
  path: string;
  hash: string | null;
  error?: string;
}

// Self-contained worker script so worker_threads executes reliably in both tsx dev and compiled Node/Electron builds
const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const crypto = require('node:crypto');

async function computePartialHash(filePath, size) {
  const chunkSize = 4096;
  const hash = crypto.createHash('sha256');
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const headLen = Math.min(chunkSize, size);
    const headBuf = Buffer.alloc(headLen);
    await fd.read(headBuf, 0, headLen, 0);
    hash.update(headBuf);

    if (size > chunkSize * 2) {
      const tailBuf = Buffer.alloc(chunkSize);
      await fd.read(tailBuf, 0, chunkSize, size - chunkSize);
      hash.update(tailBuf);
    }
    hash.update(String(size));
    return hash.digest('hex');
  } finally {
    await fd.close();
  }
}

function computeFullStreamingHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 65536 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

(async () => {
  const tasks = workerData.tasks || [];
  const results = [];
  for (const task of tasks) {
    try {
      const h = task.mode === 'partial'
        ? await computePartialHash(task.path, task.size)
        : await computeFullStreamingHash(task.path);
      results.push({ path: task.path, hash: h });
    } catch (err) {
      results.push({ path: task.path, hash: null, error: err && err.message ? err.message : 'Hash failed' });
    }
  }
  parentPort.postMessage(results);
})();
`;

export function runHashWorkerBatch(tasks: HashTaskInput[]): Promise<HashTaskOutput[]> {
  if (tasks.length === 0) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { tasks },
    });

    worker.on('message', (results: HashTaskOutput[]) => {
      resolve(results);
    });

    worker.on('error', (err) => {
      reject(err);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Hash worker exited with non-zero code ${code}`));
      }
    });
  });
}

export async function computeSingleFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 65536 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}
