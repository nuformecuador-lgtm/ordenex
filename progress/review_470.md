# Revisión — ficha 470 · Descargas sin tope de filas

> Reviewer, 2026-10-03. Rama `feature/470-descargas-sin-tope` en `350bd74a` (base `fce7664a`; `origin/dev` = `21be9635`,
> solo un `chore` de ficha encima). Spec: `specs/470-descargas-sin-tope/` con la alternativa A1 aprobada (el xlsx lo
> arma el navegador; los conjuntos grandes viajan por el bucket privado `descargas` con URL firmada de 5 min).
> Búsqueda de código: hice lecturas dirigidas de archivo y grep (los símbolos venían censados con archivo:línea
> en el design y en `impl_470.md`); el grafo no hizo falta.

## Veredicto: **APROBADA**

Ningún bloqueante. La seguridad del bucket y de la URL, la conservación de permisos y el no-truncado resisten las
mutaciones que les hice. Gate completo verde, ejecutado por mí. El `next build` también pasa. Los menores de abajo
no bloquean el despliegue. M1 sí hay que cerrarlo antes de pasar la ficha a `done`.

## Gate (ejecutado por el reviewer)

`./init.sh` **completo**: el diff toca `lib/types/` y `vercel.json`, así que el modo rápido se negaría. Lo corrí con
el `.env` del árbol principal copiado (ya borrado), `pnpm install --frozen-lockfile` y `db:generate` en el worktree.
Log: `progress/gate_review_470.log`, sin `tail`, con `INIT_EXIT` escrito dentro.

```
✓ typecheck paso · ✓ lint paso
✓ DATABASE_URL resuelta: los 329 archivos de tests contra Postgres SI se ejecutan
 Test Files  2390 passed (2390)
      Tests  33130 passed | 26 skipped (33156)
INIT_EXIT=0
```

Coincide exactamente con lo que declaró el implementador (33.130 / 26 skipped, los de siempre). No hubo ningún flake.
Además: `pnpm exec next build` (sin `migrate-deploy`) → `BUILD_EXIT=0`, y la ruta `ƒ /api/cron/purga-descargas` aparece
en la tabla de rutas. El gate no corre el build (lección #829).

## Mutaciones (todas se revirtieron; el árbol queda limpio)

| Mutación | Resultado |
|---|---|
| `lib/actions/descargas.ts:57`: quitar la validación `z.enum` de la clave (aceptar cualquier `nombre`) | **MUERTA**: 2 rojos en `preparar-descarga.test.ts` (`"constructor"` y `"toString"` llegaban a ejecutar `Object.prototype`). Los nombres corrientes los frena además el `typeof accion !== "function"` |
| `lib/storage/SupabaseAlmacenDescargas.ts:88`: `createBucket(..., { public: true })` | **MUERTA**: «createBucket PRIVADO y UN reintento» en rojo |
| `registro-descargas.ts`: un envoltorio que reenvía `deps` (`(input, deps) => listarOrdenesCompleto(input, deps)`) | **MUERTA**: «cada entrada es un envoltorio de a lo sumo UN argumento» en rojo |

## Checklist

### Seguridad
- [x] **Bucket PRIVADO**: `createBucket(bucket, { public: false })` (`SupabaseAlmacenDescargas.ts:88`) y la mutación
  muere. **En producción**: `GET …/storage/v1/object/public/descargas/tmp/b5389192-….json.gz`, anónimo y de solo
  lectura, sobre un objeto que dejó el recorrido T6.1, responde `400 "Bucket not found"`. Así responde Supabase cuando
  el bucket existe pero es privado; que exista lo prueban las URLs firmadas que funcionaron en T6.1. T7.3 lo confirma
  por SQL.
- [x] **La ruta no es adivinable**: `tmp/<randomUUID()>.json.gz` (`SupabaseAlmacenDescargas.ts:81`), sin datos de
  usuario ni de filtros. Hay test con una regex estricta de UUID v4 y dos rutas distintas (R9).
- [x] **URL firmada de 300 s**: `TTL_URL_SEGUNDOS` 300 por defecto (`lib/config/descarga.ts:95`). `createSignedUrl(ruta, ttl)`
  y la superficie del cliente ni siquiera expone `getPublicUrl`. En T6.1, `exp − iat = 300` y la misma URL a los
  384–395 s da `400 InvalidJWT` (`progress/recorrido_470/ttl-url-firmada.json`). Los tokens van redactados en lo
  commiteado.
- [x] **`prepararDescargaAction` solo acepta las claves del registro**: `z.enum(NOMBRES_DESCARGA)` + `typeof`. Los
  prototipos (`__proto__`, `constructor`, `toString`) se rechazan sin ejecutar nada.
- [x] **La sesión y los permisos no cambian**: la acción original se llama dentro de la misma petición de la Server
  Action, así que lee las mismas cookies. Las 33 firmas reales son `(input, deps = {})`, salvo `listarCoberturaDistritos(deps)`.
  Su envoltorio la llama sin argumentos, y lo comprobé una por una. Cada acción sigue resolviendo sesión, zod y rol:
  un rol no puede descargar nada que hoy no pueda ver.
- [x] **No se reenvía `deps` desde el navegador**: los envoltorios tienen aridad ≤ 1 (hay test y la mutación muere).
- [x] **El cron exige su secreto**: es el mismo `loadCronConfig().CORTE_DIARIO_SECRET` que `purga-pdf-cargas`, con Bearer
  y comparación exacta. Sin secreto, con uno incorrecto o sin secreto configurado responde 401 y no construye nada
  (4 casos con test). `middleware.ts:34` deja pasar `/api/cron` para que la ruta se autentique sola, igual que las demás.
  La respuesta lleva solo conteos (R20).
- [x] Sin secretos hardcodeados. Sin tablas, migraciones ni RLS nuevas (design §6). `next.config.ts` no tiene un
  `connect-src` que bloquee el `fetch` a Supabase (la CSP es solo `frame-ancestors`).

### Ninguna descarga existente se rompe
- [x] **Las 33 de Familia A pasan por `descargarDatos`**. Revisé el diff de los 26 archivos de `app/` y de `EstadoCuenta.tsx`:
  cada uno cambia una llamada y un import, con la misma entrada que antes. La guardia `descargas-por-registro`
  (R24) lee el mapa clave → símbolo del propio registro, se prueba en las dos direcciones y exige ≥ 500 fuentes.
  Las excepciones van por archivo + símbolo y cubren un único uso.
- [x] **Familia B solo pierde el tope**: `filasLocales` sigue igual y lee `MAX_FILAS` = 1.048.575 (R23, con test a
  5.001 y 20.000).
- [x] **Nada se trunca**: por encima de 1.048.575 los servicios siguen devolviendo `limite_excedido`, como antes con
  5.000, y el armado comprueba hoja a hoja antes de llamar a exceljs (`comprobarLimiteExcel`). El aviso de Excel es
  accionable: nombra la hoja, las filas y el máximo, y dice «Acota el periodo o los filtros» (R2, con test del texto
  literal y sin `descargarBlob`).
- [x] Errores de transporte (almacén o firma caídos, URL caducada, gzip corrupto): `descargarDatos` lanza y el
  `catch` de siempre da el aviso de fallo sin archivo (R15/R16, con tests en 3 pantallas tipo que usan el
  `descargarDatos` real).
- [x] Recorrido T6.1 por las dos vías: los archivos directo y almacén son idénticos celda a celda (caja con detalle
  y órdenes).

### Los tests no tocan el Storage real
- [x] `almacen-descargas.test.ts` mockea `createServerClient` y lo delata si alguien lo llama.
  `preparar-descarga.test.ts` y `cron-purga-descargas.test.ts` mockean la clase del almacén. Los tres tests de
  pantalla que delegan en la acción real lo hacen con el umbral por defecto (2 MB) y fixtures pequeñas, así que van
  por la vía directa. El `.env` no define `DESCARGA_*`. Ver M3: no hay una red global.

### Trazabilidad R1..R24
- [x] Cada R tiene al menos un test concreto (mapa en `progress/impl_470.md`, partes de servidor y de pantalla). Los
  revisé por nombre de caso: R1/R4 en `wallet-caja-kardex-470` (con mutación del tope a 10), R2 en
  `descarga-dataset-excel` y `DescargarDataset`, R3 en `descarga-config`, R5/R6/R10/R11/R15 en `entrega-descarga` y
  `preparar-descarga` (borde `<=` exacto), R7/R16 en `descarga-datos` (gzip real, HTTP 400/403/404, red, JSON
  ilegible), R8 en `archivo-identico-470` y `codec-descarga`, R9/R10/R14/R17 en `almacen-descargas`, R12/R13 en
  `preparar-descarga`, R17–R20 en `cron-purga-descargas`, R21/R22 en `DescargarDataset`, R23 en
  `descarga-resultado-470` y R24 en la guardia.
- [x] Los tests adaptados son legítimos y no se borró ninguno sin sustituto (la lista de archivos borrados del diff
  contra dev está vacía):
  - 26 archivos ganan `vi.mock` del tope a 5.000 para probar la mecánica N/N+1 sin OOM; sus aserciones no cambian.
  - 6 aserciones pasan de `toEqual([])` a `[undefined]`, consecuencia directa de la aridad 1 de R13.
  - `descarga-config` se reescribió al contrato R3.
  - `dinero-productos-sql` afirma 1.048.575: es el contrato ⟨Q4⟩, que reutiliza el tope común.
  - El censo de crons pasa de 10 a 11, con la entrada escrita a mano.
  - Tres guardias de camino aceptan `descargarDatos("<clave>"`.

### vercel.json
- [x] `{ "path": "/api/cron/purga-descargas", "schedule": "*/15 * * * *" }`: JSON válido y cron de 5 campos. El plan ya
  admite crons por minuto (`procesar-jobs`), y la ruta existe en el build.

### CHECKPOINTS.md
- [x] requirements EARS R1..R24 · [x] design con alternativa descartada (armar en servidor, §1/A1) · [ ] **tasks.md
  todo `[x]`**: las 30 tareas siguen en `[ ]` → M1
- [x] mapa R → test en `impl_470.md` · [x] typecheck · [x] lint · [x] `pnpm test` (en el gate)
- [x] E2E: no aplica. No toca auth, pagos, recaudo, ingesta ni webhooks (y no hay harness E2E). Lo sustituye el
  recorrido T6.1 con Playwright por las dos vías.
- [x] RLS / migraciones: no hay ninguna nueva · [x] sin secretos · [x] webhooks: no hay nuevos
- [x] Capas: el cron es solo HTTP + secreto y delega en `PurgaDescargasService`, que no conoce HTTP ni Storage
  concreto. El almacén queda detrás de `lib/interfaces/external/IAlmacenDescargas.ts` y las interfaces de servicio
  están en `lib/interfaces/services/`.
- [x] Permisos: no hay superficie nueva por encima de las 33 acciones (ver Seguridad) · [x] sin país, moneda ni
  cuenta hardcodeados
- [x] `./init.sh` verde · [x] este informe · [ ] entrada en `progress/history.md`: la escribe el LEADER al cerrar

## Hallazgos

### Bloqueantes
Ninguno.

### Menores
- **M1 (proceso, cerrar antes de `done`)**: `specs/470-descargas-sin-tope/tasks.md` tiene las 30 tareas en `[ ]`.
  T1.1–T6.1 están hechas y tienen evidencia (código, tests, `impl_470.md`, `progress/recorrido_470/`), así que hay que
  marcarlas `[x]`. T7.1–T7.4 son del LEADER después del despliegue y quedan en `[ ]` con ese dueño. No bloquea el
  despliegue: por construcción, T7 no puede estar en `[x]` antes de desplegar. Pero CHECKPOINTS no deja pasar la
  ficha a `done` sin esto ni sin la entrada en `history.md`.
- **M2 (riesgo K4, aceptado en el design)**: dos pantallas usan una acción `…Completo` para pintar, no para descargar.
  Pierden el corte de 5.000 y su respuesta no pasa por el almacén:
  - `app/(app)/novedades/_components/useNovedadesFiltro.ts:164/245` (barra de filtro de novedades).
  - `app/(app)/analitica/_components/finanzas/cargar-kpis.ts:237-238` (KPIs con saldos de tiendas y cuentas por
    pagar).

  Hoy son conjuntos acotados (novedades abiertas, tiendas, mensajeros, y producción está casi vacía desde el 25-08).
  Si algún día pasan de ~4,5 MB, Vercel corta la respuesta y esa pantalla falla. Ese caso no trunca y no afecta a
  la descarga. El comentario de `useNovedadesFiltro.ts:36` dice todavía «5000», igual que
  `lib/repositories/DineroProductosRepository.ts:97` y `ProductosTabla.tsx:1126`: ahora es el límite de Excel.
- **M3 (red de tests)**: no hay ninguna red global que impida a un test de pantalla llegar al Storage real.
  `prepararDescargaAction` construye `SupabaseAlmacenDescargas` real (`lib/actions/descargas.ts:42-44`), y los tests
  que delegan en la acción real solo evitan Storage porque sus fixtures pesan menos de 2 MB. Una fixture futura más
  grande escribiría en el Storage de producción con el `.env` local. Propuesta para otra ficha: un mock de
  `@/lib/supabase/client` en `tests/setup/` o un umbral enorme en el entorno de test.
- **M4 (superficie)**: `prepararDescargaAction` expone `deps` como tercer parámetro de una Server Action
  (`lib/actions/descargas.ts:54`), como hacen las demás acciones del repo. Un cliente malicioso solo podría colar
  referencias a otras Server Actions, que ya puede invocar directamente: no hay escalada. Lo anoto por completitud.
- **M5 (memoria del servidor)**: sin el corte de 5.000, una descarga enorme (cientos de miles de filas) carga todo el
  conjunto en una sola función de Vercel antes de serializarlo. Si no cabe, falla con el aviso genérico y sin
  archivo, nunca truncado. T5 mide 200.000 órdenes en ~0,9 GB de RSS para serializar y gzip, y 2,2 GB de heap para
  el xlsx **en el navegador** (Q1 queda abierta para una ficha futura).
- **M6 (códec)**: un `undefined` dentro de un array llega como `null`, y `Map`/`Set` lanzan (la Server Action sí los
  transportaba). No encontré DTOs con `Map`/`Set` en `lib/types` y la comparación del archivo final pasa. Sin acción.
- **M7 (estado de producción)**: el recorrido T6.1 dejó 2 objetos privados en `descargas/tmp/` del Storage de
  producción. El cron de purga no existe allí hasta desplegar, así que seguirán ahí hasta la primera corrida.
  Son ilegibles sin token (verificado arriba).
- **M8**: `esBucketInexistente` (`SupabaseAlmacenDescargas.ts:52`) acepta cualquier «not found». En el peor caso intenta
  crear un bucket privado y el reintento falla con el aviso genérico. Es inocuo.

## Para el leader (despliegue)
- T7.1: borra `DESCARGA_MAX_FILAS` de Vercel si existe; ya no tiene efecto (R3).
- T7.3: `SELECT id, public FROM storage.buckets WHERE id='descargas'` ⇒ `public = false`. Comprueba también que el
  cron responde 200 en los logs y que los 2 objetos de T6.1 desaparecen tras la primera purga.
- T7.2/T7.4: la descarga de la caja con detalle (≥ 14.153 filas) y la de Órdenes sin filtros, en producción.
