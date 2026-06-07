
const { spawn } = require('child_process');

const a = spawn('node',['sendgift.js'],{stdio:'inherit'});
const b = spawn('node',['bot.js'],{stdio:'inherit'});

a.on('exit', c => process.exit(c||0));
b.on('exit', c => process.exit(c||0));
