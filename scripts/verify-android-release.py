"""Verify release signatures and Android package identity without reading secrets."""
import json
import os
import pathlib
import re
import subprocess

root = pathlib.Path.cwd()
plan = json.loads((root / 'release-version.json').read_text())
config = json.loads((root / 'android/google-oauth.json').read_text())
version = plan['version']
expected_sha1 = re.sub('[^0-9A-Fa-f]', '', config['releaseCertificateSha1']).lower()
# Pin the known production identity, not merely a mutable build-time setting.
assert expected_sha1 == plan['androidCertificateSha1'].replace(':', '').lower(), 'Recorded Android signing identity changed'
sdk = pathlib.Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
tools = sdk / 'build-tools/36.0.0'
apk = root / 'release' / f'ChengJing-{version}-Android.apk'
aab = root / 'release' / f'ChengJing-{version}-Android-Play.aab'

def run(*args):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, text=True, check=True)
    return result.stdout + result.stderr

apk_signature = run(tools / 'apksigner', 'verify', '--verbose', '--print-certs', apk)
sha1s = re.findall(r'Signer #\d+ certificate SHA-1 digest:\s*([0-9a-fA-F]+)', apk_signature)
assert len(sha1s) == 1 and sha1s[0].lower() == expected_sha1, 'APK differs from the original production signer'
assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in apk_signature, 'APK v2 signature is missing'
badging = run(tools / 'aapt', 'dump', 'badging', apk)
package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
assert package and package[1] == 'tw.techtarian.chengjing' and int(package[2]) == plan['androidVersionCode'] and package[3] == version, 'APK version or package identity mismatch'
verification = run('jarsigner', '-J-Duser.language=en', '-J-Duser.country=US', '-verify', aab)
assert 'jar verified.' in verification and 'jar is unsigned.' not in verification, 'AAB is unsigned or invalid'
certificate = run('keytool', '-J-Duser.language=en', '-J-Duser.country=US', '-printcert', '-jarfile', aab)
aab_sha1 = re.findall(r'SHA1:\s*([0-9A-Fa-f:]+)', certificate)
assert aab_sha1 and all(value.replace(':', '').lower() == expected_sha1 for value in aab_sha1), 'AAB differs from the recorded production/upload signer'
report = {'verified': True, 'version': version, 'versionCode': plan['androidVersionCode'], 'applicationId': package[1], 'certificateSha1': config['releaseCertificateSha1'], 'apkV2Signature': True, 'aabJarSignature': True}
(root / 'release/android-signing.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
