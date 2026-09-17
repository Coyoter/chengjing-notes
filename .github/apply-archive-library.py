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
