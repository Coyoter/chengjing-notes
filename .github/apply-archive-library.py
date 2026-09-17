"""Apply the reviewed, checksummed source changes in an isolated CI branch."""
import gzip
import hashlib
import json
from pathlib import Path

root = Path.cwd().resolve()
payload = b''.join((root / f'.github/archive-library.part{i}').read_bytes() for i in range(4))
changes = json.loads(gzip.decompress(payload))
assert isinstance(changes, list) and len(changes) == 44
for change in changes:
    path = (root / change['path']).resolve()
    assert root in path.parents, 'Invalid destination'
    if change['base'] is None:
        assert not path.exists(), f'Already exists: {path}'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(change['content'], encoding='utf-8')
    else:
        text = path.read_text(encoding='utf-8')
        assert hashlib.sha256(text.encode()).hexdigest() == change['base'], f'Base mismatch: {path}'
        if 'content' in change and change['content'] is None:
            path.unlink()
        else:
            for start, end, replacement in reversed(change['parts']):
                assert 0 <= start <= end <= len(text)
                text = text[:start] + replacement + text[end:]
            assert hashlib.sha256(text.encode()).hexdigest() == change['result'], f'Result mismatch: {path}'
            path.write_text(text, encoding='utf-8')
    print(f'Applied {change["path"]}')

def replace_once(relative, old, new):
    path = root / relative
    text = path.read_text(encoding='utf-8')
    assert text.count(old) == 1, f'Expected one correction target: {relative}'
    path.write_text(text.replace(old, new), encoding='utf-8')

replace_once('scripts/qa-archive-library.mjs',
    'assert.equal(await page.locator(".library-card").filter({ hasText: "ActiveControl" }).count(), 0);',
    'await page.locator(".library-card").filter({ hasText: "ActiveControl" }).waitFor({ state: "detached" });')
replace_once('scripts/qa-archive-library.mjs',
    'await probe.waitFor(); await probe.click({ button: "right" });',
    'await probe.waitFor(); await probe.click(); await page.locator(".project-kanban-inspector").waitFor(); await probe.click({ button: "right" });')
replace_once('src/components/LibraryStructuredContent.tsx',
    'colSpan={selectionMode ? 7 : 6}', 'colSpan={selectionMode ? 6 : 5}')
