import { execSync } from 'node:child_process';
import { ROOT } from './harness';

/** Builds the action once, the specs run the bundled `dist/index.js` like the runner does */
export default function setup(): void {
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}
