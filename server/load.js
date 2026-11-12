// Node-only helper: load reference data from disk.
import { readFileSync } from 'node:fs';
import { buildCorridors } from './corridors.js';
export const loadCorridors = (infraPath, anchPath) =>
  buildCorridors(JSON.parse(readFileSync(infraPath, 'utf8')), JSON.parse(readFileSync(anchPath, 'utf8')));
