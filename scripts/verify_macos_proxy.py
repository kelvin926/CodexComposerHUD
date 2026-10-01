import pathlib, plistlib, subprocess, tempfile

root=pathlib.Path(__file__).resolve().parents[1]
launcher=root/'build/macos-stage/CodexComposerHUD.app/Contents/MacOS/CodexComposerHUD'
with tempfile.TemporaryDirectory(prefix='hud-icon-fixture-') as temporary:
    vendor=pathlib.Path(temporary)/'Codex.app'
    resources=vendor/'Contents/Resources';resources.mkdir(parents=True)
    original=(root/'assets/app-icon.icns').read_bytes()
    (resources/'VendorIcon.icns').write_bytes(original)
    with (vendor/'Contents/Info.plist').open('wb') as output:
        plistlib.dump({'CFBundleName':'Codex','CFBundleIdentifier':'test.codex.vendor','CFBundlePackageType':'APPL','CFBundleIconFile':'VendorIcon.icns'},output)
    proxy=pathlib.Path(subprocess.check_output([str(launcher),'--create-launch-proxy',str(vendor)],text=True).strip())
    assert (proxy/'Contents/Resources/VendorIcon.icns').read_bytes()==original
    with (proxy/'Contents/Info.plist').open('rb') as stream: info=plistlib.load(stream)
    assert info['CFBundleName']=='Codex' and info['CFBundleIconFile']=='VendorIcon.icns'
    assert info['LSUIElement'] and info['HUDLaunchProxy']
    subprocess.run(['codesign','--verify','--strict',str(proxy)],check=True)
    subprocess.run([str(proxy/'Contents/MacOS/launch'),'--check-bundle'],check=True)
    print('Native launch proxy preserves the vendor icon and resolves the bundled runtime.')
