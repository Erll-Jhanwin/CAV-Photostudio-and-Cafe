import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const buildIndex = resolve('frontend', 'build', 'index.html');

if (!existsSync(buildIndex)) {
  console.error(
    'React build output is missing. Run `npm run build` before `npx cap sync android`; expected frontend/build/index.html.'
  );
  process.exit(1);
}
