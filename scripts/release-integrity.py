"""Fail-closed verification of the five ChengJing release packages.

Stage reports bind actual bytes to one source commit. Android packages must
contain exactly the freshly built frontend, not stale checked-in WebView assets.
"""
import argparse
import hashlib
import json
import pathlib
import struct
import subprocess
import zipfile

ROOT = pathlib.Path.cwd()
OUT = ROOT / 'release'
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
SHA = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
FILES = {
    'macos': [f'ChengJing-{VERSION}-arm64.dmg'],
    'windows': [f'ChengJing-{VERSION}-{arch}-Installer.exe' for arch in ('x64', 'arm64')],
    'android': [f'ChengJing-{VERSION}-Android.apk', f'ChengJing-{VERSION}-Android-Play.aab'],
}

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def digest(file):
    with file.open('rb') as stream:
        value = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
        return value.hexdigest()

def record(name):
    file = OUT / name
    require(file.is_file() and file.stat().st_size > 1_000_000, f'Missing or invalid package: {name}')
    if name.endswith('.exe'):
        expected = 0xAA64 if '-arm64-' in name else 0x8664
        with file.open('rb') as stream:
            dos = stream.read(64)
            require(dos[:2] == b'MZ', f'Invalid executable: {name}')
            stream.seek(struct.unpack_from('<I', dos, 0x3C)[0])
            pe = stream.read(6)
            require(pe[:4] == b'PE\0\0' and struct.unpack_from('<H', pe, 4)[0] == expected,
                    f'Wrong Windows architecture: {name}')
    return {'name': name, 'bytes': file.stat().st_size, 'sha256': digest(file)}

def check_android_frontend():
    dist = ROOT / 'dist'
    expected = {p.relative_to(dist).as_posix(): digest(p) for p in dist.rglob('*') if p.is_file()}
    require('index.html' in expected and len(expected) > 1, 'Frontend has not been built')
    for name, prefix in zip(FILES['android'], ('assets/public/', 'base/assets/public/')):
        with zipfile.ZipFile(OUT / name) as archive:
            actual = {i.filename[len(prefix):]: hashlib.sha256(archive.read(i)).hexdigest()
                      for i in archive.infolist() if i.filename.startswith(prefix) and not i.is_dir()}
        require(actual == expected, f'Stale or missing Android frontend assets: {name}')
    signing = json.loads((OUT / 'android-signing.json').read_text(encoding='utf-8'))
    require(signing.get('verified') is True, 'Android signature verification is missing')
    require(signing.get('version') == VERSION, 'Android version mismatch')
    require(signing.get('versionCode') == json.loads((ROOT / 'release-version.json').read_text())['androidVersionCode'],
            'Android versionCode mismatch')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', choices=FILES)
    parser.add_argument('--assemble', action='store_true')
    parser.add_argument('--remote', type=pathlib.Path)
    args = parser.parse_args()
    require(sum((bool(args.stage), args.assemble, bool(args.remote))) == 1, 'Choose exactly one operation')
    OUT.mkdir(exist_ok=True)
    if args.stage:
        if args.stage == 'android':
            check_android_frontend()
        report = {'platform': args.stage, 'version': VERSION, 'sourceSha': SHA,
                  'files': [record(name) for name in FILES[args.stage]]}
        (OUT / f'build-{args.stage}.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
    elif args.assemble:
        records = []
        for stage, names in FILES.items():
            report = json.loads((OUT / f'build-{stage}.json').read_text())
            require(report['version'] == VERSION and report['sourceSha'] == SHA,
                    f'Mixed source commits or versions: {stage}')
            actual = [record(name) for name in names]
            require(report['files'] == actual, f'Artifact integrity mismatch: {stage}')
            records.extend(actual)
        require(len(records) == 5, 'All five installation packages are required')
        (OUT / 'release-manifest.json').write_text(json.dumps({'version': VERSION, 'sourceSha': SHA, 'files': records}, indent=2) + '\n')
        (OUT / 'SHA256SUMS').write_text(''.join(f"{row['sha256']}  {row['name']}\n" for row in records))
        (OUT / 'release-assets.txt').write_text('\n'.join(row['name'] for row in records) + '\nSHA256SUMS\nrelease-manifest.json\n')
        print(f'PASS: five packages, one version, one commit: {VERSION} / {SHA}')
    else:
        remote = json.loads(args.remote.read_text())
        require(remote['target_commitish'] == SHA, 'Release points to the wrong commit')
        require(remote['draft'] is True and remote['prerelease'] is False, 'Release must remain a draft until verified')
        actual = {item['name']: item for item in remote['assets']}
        names = (OUT / 'release-assets.txt').read_text().splitlines()
        require(set(actual) == set(names), 'Remote release is missing packages or contains unexpected files')
        for name in names:
            item = actual[name]
            require(item['state'] == 'uploaded' and item['size'] == (OUT / name).stat().st_size,
                    f'Incomplete release upload: {name}')
            require(item.get('digest') == 'sha256:' + digest(OUT / name), f'Remote checksum mismatch: {name}')
        print('PASS: every uploaded release asset matches its verified build artifact')

if __name__ == '__main__':
    main()
