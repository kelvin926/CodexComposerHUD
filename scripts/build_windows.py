import pathlib, shutil, subprocess, zipfile, hashlib, os
from runtime import ROOT,binary

if os.name!='nt':raise SystemExit('Windows is required for the .NET Framework build.')
stage=(ROOT/'build/windows-stage').resolve();build=(ROOT/'build').resolve();assert stage.is_relative_to(build)
if stage.exists():shutil.rmtree(stage)
program=stage/'CodexComposerHUD';program.mkdir(parents=True)
for folder in ['lib','ui','tests','installer-src']:shutil.copytree(ROOT/folder,program/folder)
for name in ['launcher.mjs','launcher.cs','package.json','README.md','LICENSE','PRICING.md']:shutil.copyfile(ROOT/name,program/name)
shutil.copytree(ROOT/'docs',program/'docs')
runtime,license=binary('win','x64');(program/'runtime').mkdir();(program/'runtime/node.exe').write_bytes(runtime);(program/'runtime/Node-LICENSE.txt').write_bytes(license)
csc=pathlib.Path(os.environ.get('WINDIR',r'C:\Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
def compile(out,files,extra=()):subprocess.run([str(csc),'/nologo','/target:winexe','/reference:System.Windows.Forms.dll',*extra,'/out:'+str(out),*[str(file) for file in files]],check=True)
compile(program/'Codex Composer HUD.exe',[ROOT/'launcher.cs']);shutil.copyfile(program/'Codex Composer HUD.exe',program/'Stop HUD.exe')
compile(program/'Uninstall.exe',[ROOT/'installer-src/Common.cs',ROOT/'installer-src/Uninstall.cs'])
dist=ROOT/'dist';dist.mkdir(exist_ok=True);payload=dist/'CodexComposerHUD.zip'
with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for file in program.rglob('*'):
        if file.is_file():archive.write(file,file.relative_to(stage))
compile(dist/'CodexComposerHUD-Setup.exe',[ROOT/'installer-src/Common.cs',ROOT/'installer-src/Setup.cs'],['/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/resource:'+str(payload)+',payload.zip'])
for file in [payload,dist/'CodexComposerHUD-Setup.exe']:(dist/(file.name+'.sha256')).write_text(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name+'\n',encoding='ascii')
print('Windows packages:',dist)
