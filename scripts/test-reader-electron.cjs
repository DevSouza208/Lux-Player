const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(root, 'tests/reader-electron.cjs')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { const file = path.join(root, 'release/reader-validation/result.txt'); if (fs.existsSync(file)) console.log(fs.readFileSync(file, 'utf8')); process.exitCode = code || 0; });
