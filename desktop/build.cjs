const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
function run(script, args, env = {}, cwd = root) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(path.join(root, 'frontend/node_modules/react-scripts/scripts/build.js'), [], { REACT_APP_API_URL: '/api', GENERATE_SOURCEMAP: 'false' }, path.join(root,'frontend'));
run(path.join(root, 'node_modules/electron-builder/cli.js'), ['--win', 'portable', '--x64', '--publish', 'never']);
