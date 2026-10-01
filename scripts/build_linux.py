"""Build Ubuntu packages on any Python host without running target binaries."""
import hashlib
import io
import json
import pathlib
import tarfile

from runtime import ROOT, binary

VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version'] + '-1'
MTIME = 1790812800


def normalized(file):
    return file.read_text(encoding='utf-8-sig').replace('\r\n', '\n').encode('utf-8')


def tar_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz', compresslevel=6) as archive:
        directories = set()
        for name, _, _ in entries:
            for parent in pathlib.PurePosixPath(name).parents:
                if str(parent) != '.':
                    directories.add('./' + parent.as_posix().lstrip('./') + '/')
        for name in sorted(directories, key=lambda value: (value.count('/'), value)):
            info = tarfile.TarInfo(name)
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mtime = MTIME
            archive.addfile(info)
        for name, data, mode in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = mode
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mtime = MTIME
            archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


def ar_member(name, data):
    fields = [(name + '/').ljust(16), '0'.ljust(12), '0'.ljust(6),
              '0'.ljust(6), '100644'.ljust(8), str(len(data)).ljust(10), '`\n']
    header = ''.join(fields).encode('ascii')
    assert len(header) == 60
    return header + data + (b'\n' if len(data) % 2 else b'')


def build(architecture, node_arch):
    node, license_text = binary('linux', node_arch)
    runtime_dir = ROOT / 'build' / ('runtime-' + node_arch)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / 'node').write_bytes(node)
    (runtime_dir / 'node').chmod(0o755)

    entries = []
    for folder in ['lib', 'ui', 'tests']:
        for file in sorted((ROOT / folder).rglob('*')):
            if file.is_file():
                entries.append(('./opt/codex-composer-hud/' + file.relative_to(ROOT).as_posix(),
                                normalized(file), 0o644))
    for name in ['launcher-linux.mjs', 'package.json', 'LICENSE', 'PRICING.md']:
        entries.append(('./opt/codex-composer-hud/' + name, normalized(ROOT / name), 0o644))
    entries.append(('./opt/codex-composer-hud/README.md', normalized(ROOT / 'docs/ubuntu.md'), 0o644))
    entries.append(('./opt/codex-composer-hud/runtime/node', node, 0o755))
    entries.append(('./opt/codex-composer-hud/runtime/Node-LICENSE.txt', license_text, 0o644))
    packaging = ROOT / 'packaging/linux'
    for name, destination, mode in [
        ('codex-composer-hud', './usr/bin/codex-composer-hud', 0o755),
        ('codex-composer-hud.desktop', './usr/share/applications/codex-composer-hud.desktop', 0o644),
    ]:
        entries.append((destination, normalized(packaging / name), mode))
    entries.append(('./usr/share/icons/hicolor/512x512/apps/codex-composer-hud.png',(ROOT/'assets/app-icon-linux.png').read_bytes(),0o644))
    entries.append(('./etc/xdg/autostart/codex-composer-hud.desktop',b'[Desktop Entry]\nType=Application\nName=Codex Composer HUD automatic connection\nExec=/usr/bin/codex-composer-hud --watch --quiet\nTerminal=false\nX-GNOME-Autostart-enabled=true\n',0o644))
    size = sum(len(data) for _, data, _ in entries) // 1024
    control = f'''Package: codex-composer-hud
Version: {VERSION}
Architecture: {architecture}
Maintainer: kelvin926 <52805466+kelvin926@users.noreply.github.com>
Section: utils
Priority: optional
Installed-Size: {size}
Depends: libc6 (>= 2.28), libstdc++6, ca-certificates
Recommends: libnotify-bin, fonts-noto-cjk
Description: Context, quota and credit HUD for the ChatGPT Codex composer
 Temporary in-memory UI for the Linux ChatGPT desktop app.
 Includes the Node runtime and Korean usage displays.
'''.encode('utf-8')
    controls = [('./control', control, 0o644)]
    controls.extend(('./' + name, normalized(packaging / name), 0o755)
                    for name in ['prerm', 'postinst'])
    payload = (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
               + ar_member('control.tar.gz', tar_bytes(controls))
               + ar_member('data.tar.gz', tar_bytes(entries)))
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    name = f'codex-composer-hud_{VERSION}_{architecture}.deb'
    (dist / name).write_bytes(payload)
    checksum = hashlib.sha256(payload).hexdigest()
    (dist / (name + '.sha256')).write_text(checksum + '  ' + name + '\n', encoding='ascii')
    print(name, checksum)


if __name__ == '__main__':
    for architecture, node_arch in [('amd64', 'x64'), ('arm64', 'arm64')]:
        build(architecture, node_arch)
