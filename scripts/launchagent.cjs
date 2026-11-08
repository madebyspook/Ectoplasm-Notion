// Print an opt-in LaunchAgent; do not install it or change the existing launcher.
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.join(__dirname, '..'));
const escape = value => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
console.log(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>Label</key><string>com.ectoplasma.notion-loader</string>
    <key>ProgramArguments</key><array>
        <string>${escape(process.execPath)}</string>
        <string>${escape(path.join(root, 'loader.js'))}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>30</integer>
    <key>StandardOutPath</key><string>/dev/null</string>
    <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>`);
