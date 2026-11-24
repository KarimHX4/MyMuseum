// Copie les fichiers de l'application web dans dist/, le dossier qu'embarque l'APK Android.
import { rmSync, mkdirSync, cpSync } from 'node:fs';
const files = ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icons'];
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of files) cpSync(f, 'dist/' + f, { recursive: true });
console.log('dist/ prêt');
