#!/usr/bin/env node
// jira-sync.mjs — Sync desatendido entre feature_list.json y Jira (proyecto KAN).
// NO usa el MCP (que es OAuth interactivo): habla directo con la REST API de Jira
// v3 con un API token, para poder correr en cron/CI. Sin dependencias externas.
//
// Config por variables de entorno:
//   JIRA_SITE        p.ej. singularis-su.atlassian.net   (o JIRA_BASE_URL completo)
//   JIRA_EMAIL       email de la cuenta Atlassian
//   JIRA_API_TOKEN   token de https://id.atlassian.com/manage-profile/security/api-tokens
//   JIRA_PROJECT     key del proyecto (default: KAN)
//
// Modos:
//   check            (default) READ-ONLY. Reporta drift entre JSON y Jira. Exit 1 si hay drift.
//   push [--apply]   JSON -> Jira: transiciona el estado de cada issue al del JSON. Dry-run sin --apply.
//   pull [--apply]   Jira -> JSON: actualiza el status local segun Jira (Jira gana). Dry-run sin --apply.
//
// IMPORTANTE: 'check' es seguro. 'push'/'pull' mutan; requieren --apply explicito.
// Regla de conflicto (docs/jira-sync.md): el status lo gana Jira (pull); la estructura
// del backlog la gana feature_list.json (el humano lo cura).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FL = 'feature_list.json';
const PROJECT = process.env.JIRA_PROJECT || 'KAN';
const SITE = process.env.JIRA_SITE || '';
const BASE = process.env.JIRA_BASE_URL || (SITE ? `https://${SITE}` : '');
const EMAIL = process.env.JIRA_EMAIL || '';
const TOKEN = process.env.JIRA_API_TOKEN || '';

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('-')) || 'check';
const apply = args.includes('--apply');

// Mapas de estado (ver docs/jira-sync.md)
const JIRA_TO_ARNES = { 'To Do': 'pending', 'In Progress': 'in_progress', 'In Review': 'in_progress', Done: 'done' };
const ARNES_TO_TRANSITION = { pending: '11', in_progress: '21', done: '41' };

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

function requireAuth() {
  if (!BASE) die('falta JIRA_SITE o JIRA_BASE_URL');
  if (!EMAIL) die('falta JIRA_EMAIL');
  if (!TOKEN) die('falta JIRA_API_TOKEN (crealo en https://id.atlassian.com/manage-profile/security/api-tokens)');
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/rest/api/3${path}`, {
    ...opts,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${path} -> HTTP ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Trae todas las issues del proyecto (paginado por nextPageToken).
async function fetchAllIssues() {
  const out = [];
  let nextPageToken;
  do {
    const body = { jql: `project = ${PROJECT}`, fields: ['status', 'labels', 'summary'], maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await api('/search/jql', { method: 'POST', body: JSON.stringify(body) });
    for (const issue of page.issues || []) out.push(issue);
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);
  return out;
}

function fidOf(issue) {
  const l = (issue.fields?.labels || []).find((x) => /^fid-\d+$/.test(x));
  return l ? Number(l.slice(4)) : null;
}

function loadFeatures() {
  if (!existsSync(FL)) die(`no existe ${FL}`);
  return JSON.parse(readFileSync(FL, 'utf8')).features;
}

// Reconcilia y devuelve el drift.
function reconcile(features, issues) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const jiraById = new Map();
  const orphanIssues = [];
  for (const is of issues) {
    const fid = fidOf(is);
    if (fid == null) orphanIssues.push(is.key);
    else jiraById.set(fid, is);
  }
  const statusDrift = []; // {id, key, local, jira}
  const missingInJira = []; // features sin issue
  for (const f of features) {
    const is = jiraById.get(f.id);
    if (!is) {
      missingInJira.push(f.id);
      continue;
    }
    const jiraStatus = JIRA_TO_ARNES[is.fields.status.name] ?? `?(${is.fields.status.name})`;
    if (jiraStatus !== f.status) statusDrift.push({ id: f.id, key: is.key, local: f.status, jira: jiraStatus });
  }
  const extraInJira = [...jiraById.keys()].filter((id) => !byId.has(id));
  return { statusDrift, missingInJira, extraInJira, orphanIssues, jiraById };
}

async function cmdCheck() {
  requireAuth();
  const features = loadFeatures();
  const issues = await fetchAllIssues();
  const { statusDrift, missingInJira, extraInJira, orphanIssues } = reconcile(features, issues);
  console.log(`Jira ${PROJECT}: ${issues.length} issues · feature_list.json: ${features.length} features`);
  let drift = false;
  if (statusDrift.length) {
    drift = true;
    console.log(`\n✗ Drift de estado (${statusDrift.length}):`);
    for (const d of statusDrift) console.log(`  ${d.key} (F${d.id}): local='${d.local}' vs jira='${d.jira}'`);
  } else console.log('✓ sin drift de estado');
  if (missingInJira.length) {
    drift = true;
    console.log(`\n✗ Features sin issue en Jira: ${missingInJira.map((i) => 'F' + i).join(', ')}`);
  }
  if (extraInJira.length) console.log(`\n! fid en Jira que no estan en el JSON: ${extraInJira.map((i) => 'F' + i).join(', ')}`);
  if (orphanIssues.length) console.log(`\n! issues en Jira sin label fid-<n>: ${orphanIssues.join(', ')}`);
  process.exit(drift ? 1 : 0);
}

async function cmdPush() {
  requireAuth();
  const features = loadFeatures();
  const issues = await fetchAllIssues();
  const { statusDrift } = reconcile(features, issues);
  if (!statusDrift.length) return console.log('✓ nada que empujar: estados ya alineados');
  console.log(`${apply ? 'PUSH' : 'DRY-RUN'} — ${statusDrift.length} issue(s) a transicionar (JSON -> Jira):`);
  for (const d of statusDrift) {
    const tid = ARNES_TO_TRANSITION[d.local];
    if (!tid) {
      console.log(`  ${d.key} (F${d.id}): status local '${d.local}' sin transicion mapeada, SKIP`);
      continue;
    }
    console.log(`  ${d.key} (F${d.id}): '${d.jira}' -> '${d.local}' (transition ${tid})${apply ? '' : ' [dry-run]'}`);
    if (apply) {
      await api(`/issue/${d.key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: tid } }) });
    }
  }
  if (!apply) console.log('\n(sin cambios: agrega --apply para ejecutar)');
}

async function cmdPull() {
  requireAuth();
  let raw = readFileSync(FL, 'utf8');
  const features = loadFeatures();
  const issues = await fetchAllIssues();
  const { statusDrift } = reconcile(features, issues);
  if (!statusDrift.length) return console.log('✓ nada que traer: estados ya alineados');
  console.log(`${apply ? 'PULL' : 'DRY-RUN'} — ${statusDrift.length} status local a actualizar (Jira -> JSON):`);
  const wanted = new Map(statusDrift.map((d) => [d.id, d.jira]));
  // Pasada por lineas: rastrea el id de la feature actual y reemplaza su "status".
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  let curId = null;
  for (let i = 0; i < lines.length; i++) {
    const idm = lines[i].match(/^\s*"id":\s*(\d+),/);
    if (idm) curId = Number(idm[1]);
    const sm = lines[i].match(/^(\s*)"status":\s*"([^"]*)"(,?)\s*$/);
    if (sm && curId != null && wanted.has(curId)) {
      const next = wanted.get(curId);
      console.log(`  F${curId}: '${sm[2]}' -> '${next}'${apply ? '' : ' [dry-run]'}`);
      lines[i] = `${sm[1]}"status": "${next}"${sm[3]}`;
      wanted.delete(curId);
    }
  }
  if (apply) {
    writeFileSync(FL, lines.join(eol), 'utf8');
    console.log('✓ feature_list.json actualizado');
  } else {
    console.log('\n(sin cambios: agrega --apply para ejecutar)');
  }
}

const cmds = { check: cmdCheck, push: cmdPush, pull: cmdPull };
if (!cmds[mode]) die(`modo desconocido '${mode}'. Usa: check | push [--apply] | pull [--apply]`);
cmds[mode]().catch((e) => die(e.message));
