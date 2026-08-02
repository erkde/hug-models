#!/usr/bin/env node

import { runCli } from './command.js';

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(`hug-models: ${error.message}`);
  process.exitCode = 1;
}
