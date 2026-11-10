"""Offline native replay; separate isolated profile, no credential input or inference."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import socket
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(mode=0o700, parents=True, exist_ok=False)
workspace = out / 'workspace'
workspace.mkdir()
(workspace / '.vscode').mkdir()
(workspace / '.vscode/settings.json').write_text(json.dumps({'normahub1c.enableInlineCompletion': False, 'editor.inlineSuggest.enabled': True,
    'editor.quickSuggestions': False, 'editor.suggestOnTriggerCharacters': False, 'workbench.startupEditor': 'none'}))
companion = out / 'companion'
companion.mkdir()
(companion / 'package.json').write_text(json.dumps({'name': 'acceptance', 'publisher': 'copilot', 'version': '0.0.1', 'engines': {'vscode': '^1.100.0'}, 'main': './main.cjs', 'activationEvents': ['*']}))
(companion / 'main.cjs').write_text('exports.activate=context=>context;')
keep = ['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','TMPDIR']
env = {k: os.environ[k] for k in keep if k in os.environ}
env.update({'LIVE_ACCEPTANCE_OUTPUT': str(out), 'LIVE_ACCEPTANCE_INPUT': str(args.input.resolve())})
binary = shutil.which('code')
profile = ['--user-data-dir', str(out/'profile'), '--extensions-dir', str(out/'extensions')]
installed = subprocess.run([binary,*profile,'--install-extension',str(root/'1c-bsl-ai-copilot-1.0.9.vsix')], env=env, capture_output=True, text=True, timeout=60)
(out/'install.log').write_text(installed.stdout+installed.stderr)
installed.check_returncode()
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
with (out/'launch.log').open('w') as log:
    process = subprocess.Popen([binary,*profile,'--new-window','--wait','--disable-workspace-trust','--disable-updates','--disable-telemetry','--disable-gpu','--no-sandbox','--remote-debugging-port='+str(port),
        '--extensionDevelopmentPath='+str(companion),'--extensionTestsPath='+str(Path(__file__).with_name('acceptance.cjs')),str(workspace)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    browser=None
    automation=sync_playwright().start()
    handled=set()
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        ready=out/'ready.json'
        if ready.exists():
            try:
                case=json.loads(ready.read_text())['id']
                if case not in handled:
                    if browser is None:
                        browser=automation.chromium.connect_over_cdp('http://127.0.0.1:'+str(port))
                    pages=[p for c in browser.contexts for p in c.pages if 'workbench' in p.url]
                    if pages:
                        page=pages[0]
                        page.bring_to_front()
                        page.wait_for_timeout(300)
                        info={'url':page.url,'title':page.title(),'active':page.evaluate('document.activeElement?.tagName'),'ghost':page.locator('.ghost-text').all_text_contents()}
                        page.keyboard.press('Tab')
                        (out/('tab-'+case+'.json')).write_text(json.dumps(info))
                        handled.add(case)
            except Exception as error:
                (out/'automation-error.txt').write_text(str(error))
        result=out/'results.json'
        if result.exists():
            data=json.loads(result.read_text())
            if data.get('completed'):
                print(json.dumps({'completed':True,'statuses':[(r['id'],r['status'],r['providerInvocations']) for r in data['results']]}))
                process.wait(timeout=30)
                automation.stop()
                break
        time.sleep(.1)
    else:
        process.terminate()
        raise RuntimeError('No complete native acceptance result')
