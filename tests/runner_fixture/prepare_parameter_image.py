"""Upgrade our exact own prepared fixture to parameter protocol v2; no platform download or prod DB."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from uuid import uuid4

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
a=parser.parse_args()
profile=json.loads(a.profile.read_text())
if profile.get('schemaVersion')!=1 or profile.get('kind')!='query_text_fixture_v1' or not re.fullmatch(r'sha256:[a-f0-9]{64}',profile.get('imageId','')):raise ValueError('Select the immutable approved own v1 fixture')
out=a.output.resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
build_id=uuid4().hex
image_tag='copilot-parameters:'+build_id
fixture=Path(__file__).parent
container=subprocess.check_output(['docker','create','--pull=never','--network=none','--memory=2g','--cpus=1','--pids-limit=256','--user','1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges=true','--entrypoint=/usr/bin/python3',profile['imageId'],'/runner/worker.py','--idle'],text=True,timeout=30).strip()
(out/'build-identity.json').write_text(json.dumps({'seed':profile['imageId'],'container':container,'temporaryTag':image_tag,'buildId':build_id},indent=2))
def run(args,timeout=30):
    return subprocess.run(args,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
try:
    with (out/'build.log').open('w') as log:
        run(['docker','cp',container+':/runner/config',str(out/'config')])
        run(['docker','cp',container+':/runner/worker.py',str(out/'old-worker.py')])
        def files():return sorted((str(p.relative_to(out/'config')),digest(p)) for p in (out/'config').rglob('*') if p.is_file())
        if hashlib.sha256(canonical({'files':files(),'worker':digest(out/'old-worker.py')})).hexdigest()!=profile['fixtureHash']:raise ValueError('Seed fixture/config identity mismatch')
        module=out/'config/CommonModules/Проверки/Ext/Module.bsl'
        shutil.copy2(fixture/'Module.bsl',module);shutil.copy2(fixture/'worker.py',out/'worker.py')
        module.chmod(0o644);(out/'worker.py').chmod(0o644)
        run(['docker','cp',str(module),container+':/runner/config/CommonModules/Проверки/Ext/Module.bsl'])
        run(['docker','cp',str(out/'worker.py'),container+':/runner/worker.py'])
        run(['docker','start',container],15)
        try:
            run(['docker','exec',container,'/usr/bin/python3','/runner/worker.py','--prepare-update'],180)
        except Exception:
            evidence=out/'failure-logs';evidence.mkdir()
            for name in ['load.log','load-process.log','check.log','check-process.log','xvfb.log','diagnostic.png']:
                subprocess.run(['docker','cp',container+':/runner/prepare-work/'+name,str(evidence/name)],stdout=log,stderr=subprocess.STDOUT,timeout=10)
            raise
        image=subprocess.check_output(['docker','commit','--change','LABEL normahub.parameter_build='+build_id,container,image_tag],text=True,timeout=600).strip()
        profile.update(schemaVersion=2,kind='query_text_fixture_v2',profileId='own-query-parameters-v2',imageId=image,
            fixtureHash=hashlib.sha256(canonical({'files':files(),'worker':digest(out/'worker.py')})).hexdigest())
        (out/'profile.json').write_text(json.dumps(profile,indent=2))
        print(json.dumps({'profile':str(out/'profile.json'),'imageId':image}),flush=True)
finally:
    subprocess.run(['docker','rm','--force',container],check=True,capture_output=True,timeout=30)
