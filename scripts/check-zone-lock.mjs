#!/usr/bin/env node
// check-zone-lock.mjs — Validacion LOCAL del arnes (capa local del candado).
// No depende de jq: usa node, garantizado en este repo. Lo invoca init.sh.
// Regla dura (exit 1): una feature por zona en in_progress. Aviso blando:
// ancla Jira faltante. (El check de specs sigue en init.sh, jq-gated.)
import { readFileSync, existsSync } from 'node:fs';

const FL = 'feature_list.json';
if (!existsSync(FL)) {
  console.log('! no hay feature_list.json, se omite el check local');
  process.exit(0);
}

let features;
try {
  ({ features } = JSON.parse(readFileSync(FL, 'utf8')));
} catch (e) {
  console.error(`✗ feature_list.json no es JSON valido: ${e.message}`);
  process.exit(1);
}

let hardFail = false;

// Regla 1: maximo un in_progress por zone
const inProgress = features.filter((f) => f.status === 'in_progress');
const byZone = {};
for (const f of inProgress) {
  if (f.zone) (byZone[f.zone] ??= []).push(f);
}
const dupes = Object.entries(byZone).filter(([, fs]) => fs.length > 1);
if (dupes.length) {
  for (const [zone, fs] of dupes) {
    console.error(`✗ zona '${zone}' con >1 feature in_progress: ${fs.map((f) => f.name).join(', ')}`);
  }
  hardFail = true;
} else {
  console.log(`✓ regla una-feature-por-zona respetada (in_progress=${inProgress.length})`);
}

// Aviso blando: ancla con Jira (ver docs/jira-sync.md)
const noAnchor = features.filter((f) => !f.jira);
if (noAnchor.length) {
  console.log(`! features sin ancla Jira (campo "jira"): ${noAnchor.length} — sincroniza con KAN (docs/jira-sync.md)`);
} else {
  console.log('✓ todas las features tienen ancla Jira');
}

// Recordatorio del candado de nube (init.sh no puede consultar el MCP)
console.log('! candado de zona: valida tambien en la NUBE (Jira In Progress) antes de arrancar (docs/jira-sync.md)');

process.exit(hardFail ? 1 : 0);
