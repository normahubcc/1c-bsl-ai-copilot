"""Copy trusted Xvfb and missing libraries from an exact approved local image; no system install."""
import argparse
import json
from pathlib import Path
import re
import subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image',required=True)
parser.add_argument('--output',type=Path,required=True)
a=parser.parse_args()
if not re.fullmatch(r'sha256:[a-f0-9]{64}',a.image):raise ValueError('Exact local image ID required')
out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
container=subprocess.check_output(['docker','create','--pull=never','--network=none','--entrypoint=/usr/bin/true',a.image],text=True,timeout=30).strip()
try:
    subprocess.run(['docker','cp',container+':/usr/bin/Xvfb',str(out/'Xvfb')],check=True,capture_output=True,timeout=30)
    missing=subprocess.run(['ldd',str(out/'Xvfb')],capture_output=True,text=True,timeout=10)
    libraries=re.findall(r'^\s*(\S+) => not found',missing.stdout,re.M)
    for library in libraries:
        subprocess.run(['docker','cp','-L',container+':/usr/lib/x86_64-linux-gnu/'+library,str(out/library)],check=True,capture_output=True,timeout=30)
    (out/'provision.json').write_text(json.dumps({'imageId':a.image,'binary':'/usr/bin/Xvfb','copiedLibraries':libraries},indent=2))
    print(json.dumps({'binary':str(out/'Xvfb'),'libraries':libraries}))
finally:
    subprocess.run(['docker','rm',container],check=True,capture_output=True,timeout=30)
