import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
from runtime import ROOT, binary

if sys.platform != 'darwin': raise SystemExit('macOS is required for the native app and installer build.')
version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
stage=(ROOT/'build/macos-stage').resolve()
assert stage.is_relative_to((ROOT/'build').resolve())
if stage.exists():shutil.rmtree(stage)
app=stage/'CodexComposerHUD.app'; contents=app/'Contents'; resources=contents/'Resources'; program=resources/'hud'
program.mkdir(parents=True); (contents/'MacOS').mkdir()
shutil.copyfile(ROOT/'assets/app-icon.icns',resources/'AppIcon.icns')
for folder in ['lib','ui','tests']:shutil.copytree(ROOT/folder,program/folder)
for name in ['launcher-linux.mjs','launcher-macos.mjs','package.json','LICENSE','PRICING.md']:shutil.copyfile(ROOT/name,program/name)
shutil.copyfile(ROOT/'docs/macos.md',program/'README.md')
node,license_text=binary('darwin','arm64');(program/'runtime').mkdir();(program/'runtime/node').write_bytes(node);(program/'runtime/node').chmod(0o755);(program/'runtime/Node-LICENSE.txt').write_bytes(license_text)
plist={'CFBundleName':'Codex Composer HUD','CFBundleDisplayName':'Codex Composer HUD','CFBundleIdentifier':'io.github.kelvin926.codexcomposerhud','CFBundleVersion':version,'CFBundleShortVersionString':version,'CFBundlePackageType':'APPL','CFBundleExecutable':'CodexComposerHUD','CFBundleIconFile':'AppIcon.icns','LSMinimumSystemVersion':'13.5','NSHighResolutionCapable':True}
with (contents/'Info.plist').open('wb') as f:plistlib.dump(plist,f)
subprocess.run(['clang','-arch','arm64','-mmacosx-version-min=13.5','-fobjc-arc','-framework','Cocoa',str(ROOT/'packaging/macos/Launcher.m'),str(ROOT/'packaging/macos/AutoSetup.m'),'-o',str(contents/'MacOS/CodexComposerHUD')],check=True)
subprocess.run(['codesign','--force','--sign','-','--deep',str(app)],check=True)
dist=ROOT/'dist';dist.mkdir(exist_ok=True)
zip_path=dist/'CodexComposerHUD-macOS-arm64.zip';pkg_path=dist/'CodexComposerHUD-macOS-arm64.pkg'
subprocess.run(['ditto','-c','-k','--keepParent',str(app),str(zip_path)],check=True)
subprocess.run(['pkgbuild','--component',str(app),'--identifier',plist['CFBundleIdentifier'],'--version',version,'--install-location','/Applications','--scripts',str(ROOT/'packaging/macos/scripts'),str(pkg_path)],check=True)
for file in [zip_path,pkg_path]:(dist/(file.name+'.sha256')).write_text(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name+'\n',encoding='ascii')
print('macOS ARM64 packages:',dist)
