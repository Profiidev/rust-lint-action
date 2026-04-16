import fs from 'fs';

export type GitMode = '100644' | '100755' | '040000' | '160000' | '120000';

export function getFileMode(file: string, symlink: boolean): GitMode {
  const stat = symlink ? fs.lstatSync(file) : fs.statSync(file);
  if (stat.isFile()) {
    // Check if execute bit is set on file for current user
    if (stat.mode & fs.constants.S_IXUSR) {
      return '100755';
    } else {
      return '100644';
    }
  } else if (stat.isDirectory()) {
    // Technically don't need to worry about submodules because
    // they aren't applicable in our case.
    return '040000';
  } else if (stat.isSymbolicLink()) {
    return '120000';
  } else throw Error(`Unknown file mode for ${file}`);
}
