/**
 * Generuje wszystkie modele: uruchamia skrypty Blendera w trybie --background.
 * Sciezka do Blendera: zmienna BLENDER albo "blender" z PATH (na Windows domyslna instalacja).
 *   npm run art            - wszystkie katalogi
 *   npm run art -- goods   - jeden katalog
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const CATALOGS = ['nature', 'units', 'goods', 'buildings'];
const WIN_DEFAULT = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const blender = process.env.BLENDER ?? (process.platform === 'win32' && existsSync(WIN_DEFAULT) ? WIN_DEFAULT : 'blender');
const wanted = process.argv.slice(2).filter((a) => CATALOGS.includes(a));
for (const cat of wanted.length ? wanted : CATALOGS) {
  const out = execFileSync(blender, ['--background', '--factory-startup', '--python', `art/scripts/${cat}.py`], { encoding: 'utf8' });
  const lines = out.split('\n').filter((l) => l.startsWith('MODEL'));
  console.log(`${cat}: ${lines.length} modeli`);
  for (const l of lines) console.log('  ' + l.slice(6));
}
