"""One-time, explicit three-way reconciliation of the split v0.10.6 history.

Run only after merging the pinned v0.10.6 tag into the v0.10.10 lineage.
Resolve individual conflicting hunks; never choose one entire source tree.
The deleted Database view's only later addition (EmptyTrashButton) is ported
into LibraryView. Legacy fragment operations address canonical capture cards.
"""
from pathlib import Path
import re
import subprocess

EXPECTED = {
    'electron/mcp-server.cjs', 'package-lock.json', 'package.json',
    'src/components/Sidebar.tsx', 'src/lib/aiActions.ts', 'src/lib/brain.ts',
    'src/lib/mcpWorkspace.ts', 'src/views/DatabaseView.tsx', 'src/views/LibraryView.tsx',
}
actual = set(subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=U'], text=True).splitlines())
if actual != EXPECTED:
    raise SystemExit(f'Unexpected merge conflicts; manual review required: {sorted(actual)}')
if subprocess.check_output(['git', 'rev-parse', 'MERGE_HEAD^{}'], text=True).strip() != '3b83e51d6a25ceff38ec7b9872bb0653b665dc39':
    raise SystemExit('Unexpected previous-release commit')
pattern = re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> v0\.10\.6\n', re.S)

def resolve(file, count, choose):
    path = Path(file)
    index = 0
    def replacement(match):
        nonlocal index
        value = choose(index, match[1], match[2])
        index += 1
        return value
    source = pattern.sub(replacement, path.read_text())
    if index != count or re.search(r'^(<<<<<<<|=======|>>>>>>>)', source, re.M):
        raise RuntimeError(f'Unexpected conflict shape: {file}')
    path.write_text(source)

resolve('package.json', 1, lambda i, ours, theirs: ours)
resolve('package-lock.json', 2, lambda i, ours, theirs: ours)
resolve('src/components/Sidebar.tsx', 1, lambda i, ours, theirs:
        'import { getHiddenTaskIds } from "../lib/activeContent";\n' + theirs)
resolve('src/lib/brain.ts', 1, lambda i, ours, theirs: ours + theirs)
resolve('src/lib/aiActions.ts', 3, lambda i, ours, theirs:
        'import { createFragment, db, deleteBoardPermanently, getOrCreateJournal, moveCardToTrash } from "../db";\n' if i == 0 else
        ours + 'import { runGlobalHistoryAction } from "./globalHistory";\n' if i == 1 else ours)
resolve('src/lib/mcpWorkspace.ts', 3, lambda i, ours, theirs:
        theirs.replace('createCard, db,', 'createCard, createFragment, db,').replace('deleteFragmentPermanently, ', '') +
        'import { isActiveCard, isVisibleCard } from "./cardVisibility";\nimport { getHiddenTaskIds } from "./activeContent";\n' if i == 0 else
        theirs[:theirs.index('    neuronModel:')] + ours[ours.index('    neuronModel:'):] if i == 1 else ours + theirs)
resolve('electron/mcp-server.cjs', 1, lambda i, ours, theirs:
        theirs[:theirs.index('    neurons:')] + ours[ours.index('    neurons:'):])
resolve('src/views/LibraryView.tsx', 1, lambda i, ours, theirs:
        ours.replace('{t("library.trash")}</button></div>', '{t("library.trash")}</button>{collection === "trash" && <EmptyTrashButton/>}</div>'))

path = Path('src/lib/sidebarOrder.ts')
source = path.read_text().replace(', "database"', '').replace(
    'const input = Array.isArray(value) ? value : [];',
    'const input = Array.isArray(value) ? value.map(id => id === "database" ? "library" : id) : [];')
path.write_text(source)

path = Path('src/lib/mcpWorkspace.ts')
source = path.read_text().replace('createCard, createFragment, db,', 'createCard, createFragment, db, moveCardToTrash,').replace(
    'getCaptureCard, migrateLegacyFragments }', 'getCaptureCard, migrateLegacyFragments, updateCaptureFragment }')
source = source.replace('Cards go to trash; board and fragment deletion removes related local graph edges.',
                        'Cards and fragment aliases go to trash; board deletion removes related local graph edges.')

def replace(old, new):
    global source
    if source.count(old) != 1:
        raise RuntimeError('Unexpected MCP merge context: ' + old[:80])
    source = source.replace(old, new)

replace('const current = await table.get(id);\n  if (!current)',
        'const current = tableName === "fragments" ? await getCaptureCard(id) : await table.get(id);\n  if (!current)')
replace('  if (tableName === "tasks") return updateTask(', '''  if (tableName === "fragments") {
    const record = await updateCaptureFragment(id, { text: patch.text as string | undefined, pinned: patch.pinned as boolean | undefined, tagIds: patch.tagIds as string[] | undefined });
    return { table: tableName, record };
  }
  if (tableName === "tasks") return updateTask(''')
replace('const tables = wholeWorkspace ? deletableTables : [tableName];',
        'const tables = wholeWorkspace ? deletableTables.filter(name => name !== "fragments") : [tableName];')
replace('''    const table = db.table(name);
    const ids = (args.all === true ? await table.toCollection().primaryKeys() : [...new Set(args.ids as string[])]) as string[];''',
'''    const table = db.table(name === "fragments" ? "cards" : name);
    const ids = (args.all === true ? name === "fragments" ? await db.cards.filter(isCaptureCard).primaryKeys() : await table.toCollection().primaryKeys() : [...new Set(args.ids as string[])]) as string[];''')
replace('''      const record = await table.get(id);
      if (!record) continue;
      if (name === "cards") {''',
'''      const record = name === "fragments" ? await getCaptureCard(id) : await table.get(id);
      if (!record) continue;
      if (name === "fragments") {
        if (args.permanent === true) await deleteCardPermanently(record.id, true);
        else await moveCardToTrash(record.id);
      } else if (name === "cards") {''')
replace('      else if (name === "fragments") await deleteFragmentPermanently(id);\n', '')
replace('if (operation === "update" && (!id || !await db.table(table).get(id)))',
        'if (operation === "update" && (!id || !(table === "fragments" ? await getCaptureCard(id) : await db.table(table).get(id))))')
replace('''    await db.fragments.update(id, { text: content, ...(typeof args.pinned === "boolean" ? { pinned: args.pinned } : {}), updatedAt: Date.now() });
    return db.fragments.get(id);''',
'''    return updateCaptureFragment(id, { text: content, ...(typeof args.pinned === "boolean" ? { pinned: args.pinned } : {}) });''')
replace('''    const table = db.table(tableName);
    const requestedId = identifier(request.arguments.id);
    const row = requestedId ? await table.get(requestedId) : undefined;
    const rows = requestedId ? row ? [row] : [] : await (cursor ? table.where(":id").above(cursor) : table.orderBy(":id")).limit(limit + 1).toArray();''',
'''    const table = db.table(tableName === "fragments" ? "cards" : tableName);
    const requestedId = identifier(request.arguments.id);
    const row = requestedId ? tableName === "fragments" ? await getCaptureCard(requestedId) : await table.get(requestedId) : undefined;
    const collection = cursor ? table.where(":id").above(cursor) : table.orderBy(":id");
    const sourceRows = requestedId ? row ? [row] : [] : await (tableName === "fragments" ? collection.filter(isCaptureCard) : collection).limit(limit + 1).toArray();
    const rows = tableName === "fragments" ? sourceRows.map(cardAsFragment) : sourceRows;''')
if 'deleteFragmentPermanently' in source or 'db.fragments' in source:
    raise RuntimeError('Stale fragment writes remain in MCP')
path.write_text(source)
subprocess.run(['git', 'rm', 'src/views/DatabaseView.tsx'], check=True)
subprocess.run(['git', 'add', '-u'], check=True)
subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
print('Resolved reviewed merge hunks; retained unified Library and canonical capture-card aliases.')
