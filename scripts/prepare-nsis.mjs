import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const templateUrl = new URL(
  '../node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh',
  import.meta.url,
)
const templatePath = fileURLToPath(templateUrl)
const source = await readFile(templatePath, 'utf8')

const original = [
  '    !insertmacro skipPageIfUpdated',
  '    !insertmacro MUI_PAGE_DIRECTORY',
].join('\n')
const patched = [
  '    !insertmacro skipPageIfUpdated',
  '    !define MUI_PAGE_CUSTOMFUNCTION_SHOW normalizeDirectoryPage',
  '    !insertmacro MUI_PAGE_DIRECTORY',
].join('\n')
const previousPatch = [
  '    !insertmacro skipPageIfUpdated',
  '    !define MUI_PAGE_CUSTOMFUNCTION_SHOW normalizeDirectoryPage',
  '    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE stopNormalizeDirectoryPage',
  '    !insertmacro MUI_PAGE_DIRECTORY',
].join('\n')

if (!source.includes(patched)) {
  const target = source.includes(previousPatch) ? previousPatch : original

  if (!source.includes(target)) {
    throw new Error('Unsupported electron-builder NSIS directory-page template')
  }

  await writeFile(templatePath, source.replace(target, patched), 'utf8')
}
