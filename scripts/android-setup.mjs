// Prépare le projet Android généré par `npx cap add android` :
// permissions (appareil photo, localisation), icônes, numéro de version.
import { readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifest)) { console.error('Lancez d’abord : npx cap add android'); process.exit(1); }

let m = readFileSync(manifest, 'utf8');
const perms = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
];
const missing = perms.filter(p => !m.includes(p.match(/name="([^"]+)"/)[1] + '"'));
if (missing.length) m = m.replace('</manifest>', '    ' + missing.join('\n    ') + '\n</manifest>');
writeFileSync(manifest, m);

cpSync('android-res', 'android/app/src/main/res', { recursive: true });

const gradle = 'android/app/build.gradle';
const n = parseInt(process.env.BUILD_NUMBER || '1', 10);
let g = readFileSync(gradle, 'utf8');
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + n).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${n}"`);
writeFileSync(gradle, g);
console.log(`Projet Android prêt (version 1.0.${n}, ${missing.length} permission(s) ajoutée(s)).`);
