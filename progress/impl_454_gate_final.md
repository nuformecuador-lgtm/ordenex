# 454 — gate final: los ultimos rojos del gate completo

Rama `feature/454-gate-final`, desde `origin/feature/454-estado-al-aprobar-cierre-final` (b99f0b8a).
Busqueda: se uso grep/lectura directa (archivos de test y SQL de migraciones, fuera del alcance util del grafo).

## A — `rutas-336-retiradas` › «los censos compartidos conservan su contenido»

**Causa (medida).** f70c8cc1 anadio en `caja-173-alcance.guardia.test.ts` (it «los verificadores de solo
lectura no escriben») la regex literal `/\$executeRaw(?:Unsafe)?\s*\(?`?[^;]*/g`. El quitacomentarios
(`tests/fixtures/sin-comentarios.ts`) no reconoce literales de regex —limitacion documentada en su
cabecera— y toma ese acento grave como apertura de plantilla: desde ahi trata el resto del archivo como
cadena y deja de quitar los comentarios. Medido con `codigoSinComentarios` sobre el archivo:

- antes: contiene `mis-pagos`, en la linea 619 (un comentario `/** ... */`);
- despues: no contiene `mis-pagos`.

**Arreglo.** Solo en el test de la 173: el acento grave de la regex se escribe `\x60` (misma semantica en
un literal de regex, sin el caracter). No se toca el quitacomentarios ni la guardia 336.

**Pruebas.**
- `caja-173-alcance` + `rutas-336-retiradas`: 2 archivos, 46/46 verdes.
- Mutaciones sobre la 173 (aplicadas y revertidas por script):
  - M-A quitar `scripts/contraste-454.ts` de `VERIFICADORES_SOLO_LECTURA` → 2 rojos (CIERRE de la lista, y
    solo-lectura).
  - M-B anadir `` await tx.$executeRaw`UPDATE orden SET estado = estado`; `` al script → 1 rojo (solo-lectura):
    la regex sigue capturando la forma con plantilla.
  - M-C anadir `await tx.$executeRawUnsafe("DELETE FROM orden");` → 1 rojo.

## B — tres downs de `notificacion_evento` («CONTROL: SIN filas ... el down corre entero»)

Archivos: `notificacion-evento-bloqueo-cierre-migration`, `-gasto-fijo-migration`,
`-webhook-suscripcion-migration` (4 casos rojos en total).

**Error exacto** (los 4): `22P02 la sintaxis de entrada no es valida para el enum notificacion_evento:
«cierre_dia_rechazado»`, en el `ALTER COLUMN ... USING` del down que recrea el enum con su lista antigua.

**Veredicto: (1) datos locales creados fuera de los tests.** No es efecto de la 454:
- Ninguna migracion de la 454 (M1 `job_tipo_webhook_evento`, M2 `orden_evento`, M3 `retiro_estados_454`)
  toca `notificacion_evento` / `notificacion_entidad_tipo` (la unica mencion en M3 es un comentario); las
  columnas con ese enum siguen siendo solo `notificacion.evento` y `push_envio_dia.evento`.
- `git diff origin/dev...HEAD` sobre los 3 tests, `_postgres-real.ts` y los 3 `down.sql`: vacio.
- `cierre_dia_rechazado` entro el 2026-09-13 (`20260913120000_notificacion_evento_cierre_rechazado`),
  posterior a los tres downs (08-23, 08-29, 09-09); cada control solo aparta SUS valores (`NUEVOS`).

**Filas que lo provocan** (consulta en transaccion READ ONLY sobre la base local compartida), todas
creadas el 2026-09-24 entre 07:16 y 07:39 UTC —fuera de tests, que corren en transaccion revertida—:

| id | evento | entidad_tipo | created_at (UTC) |
| --- | --- | --- | --- |
| 225f9468-bc55-42f6-8b35-ddcec17a2146 | cierre_dia_rechazado | cierre_dia_rechazo | 07:21:15.866 |
| 69886203-de3d-4af5-9926-5ea6f19cd037 | cierre_dia_rechazado | cierre_dia_rechazo | 07:28:31.642 |
| 410b4153-1ee0-4194-b4fe-c83577bddaae | webhook_suscripcion_pausada | webhook_suscripcion_pausa | 07:39:14.278 |

Fuera de la lista de cada down: bloqueo-cierre (08-23) ve ademas 8 `cierre_dia_vencido` y 3
`mensajero_bloqueado_por_cierres`, pero esos son sus propios `NUEVOS` y los aparta; gasto-fijo y
webhook-suscripcion ven las 3 filas de la tabla (y sus `entidad_tipo`). El primer valor que Postgres no
puede castear es `cierre_dia_rechazado` en los tres.

**Prueba causal (experimento controlado, no commiteado).** Copia temporal de los 3 archivos identica salvo
un `DELETE` de esas 3 ids DENTRO de la misma transaccion revertida, justo antes de
`soltarDependientesPosterioresDelEnumDeEventos`:
- originales: 4 failed | 53 passed (57);
- copia: 3 files passed, 57/57.
Las copias se borraron. No se borro ni modifico ningun dato, ni ningun test de otras fichas.

Consecuencia: en esta base los 4 casos seguiran rojos en cualquier rama (dev incluido, como midio el
revisor en f05b7c3f) hasta que esas 3 filas desaparezcan. Deuda aparte, no de la 454: esos controles
solo apartan sus propios valores y son fragiles frente a cualquier fila de un valor POSTERIOR.

## Archivos

- modificado: `tests/unit/guards/caja-173-alcance.guardia.test.ts` (una linea + comentario)
- creado: `progress/impl_454_gate_final.md`, `progress/gate_454_gate_final.log`

## Gate completo

`./init.sh` → `progress/gate_454_gate_final.log` (INIT_EXIT dentro).

- typecheck, lint y guardias: verdes. `rutas-336-retiradas` y `caja-173-alcance`: verdes (A cerrado).
- `Test Files 3 failed | 2128 passed (2131)` · `Tests 4 failed | 30435 passed | 26 skipped (30465)`.
- Los 4 rojos son EXACTAMENTE los 4 casos de B (los 3 archivos de downs de `notificacion_evento`), todos
  por las 3 filas locales de la tabla de arriba. `INIT_EXIT=1`.
- La integracion con base NO se salto (26 skipped en total, no los ~78 archivos de `integration/db`).

Veredicto: A arreglado y probado con mutaciones; B es contenido de la base local compartida (no 454),
probado causalmente; el gate completo queda rojo solo por B.
