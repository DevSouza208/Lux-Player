const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(root,'tests/game-admin-electron.cjs')],{cwd:root,env,windowsHide:true,stdio:'ignore'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{const file=path.join(root,'release/game-admin-validation/result.txt');if(fs.existsSync(file))console.log(fs.readFileSync(file,'utf8'));process.exitCode=code??1;});
