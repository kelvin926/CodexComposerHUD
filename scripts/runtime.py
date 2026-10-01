import hashlib, pathlib, urllib.request, zipfile, tarfile

VERSION='24.15.0'
ROOT=pathlib.Path(__file__).resolve().parents[1]
CACHE=ROOT/'build/runtime-cache'
def download(platform,arch):
    CACHE.mkdir(parents=True,exist_ok=True)
    suffix='zip' if platform=='win' else 'tar.xz'
    name=f'node-v{VERSION}-{platform}-{arch}.{suffix}'
    base=f'https://nodejs.org/dist/v{VERSION}/'
    manifest=urllib.request.urlopen(base+'SHASUMS256.txt',timeout=30).read().decode('ascii')
    expected=dict((line.split()[1],line.split()[0]) for line in manifest.splitlines())[name]
    target=CACHE/name
    if not target.exists():
        with urllib.request.urlopen(base+name,timeout=60) as source,target.open('wb') as output:
            while data:=source.read(1024*1024):output.write(data)
    if hashlib.sha256(target.read_bytes()).hexdigest()!=expected:raise RuntimeError('Node checksum mismatch: '+name)
    return target
def binary(platform,arch):
    archive=download(platform,arch);prefix=f'node-v{VERSION}-{platform}-{arch}/'
    if platform=='win':
        with zipfile.ZipFile(archive) as source:return source.read(prefix+'node.exe'),source.read(prefix+'LICENSE')
    with tarfile.open(archive,'r:xz') as source:return source.extractfile(prefix+'bin/node').read(),source.extractfile(prefix+'LICENSE').read()
