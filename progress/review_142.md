# Review — Feature 142 (plantilla de carga masiva v2)

Rama revisada: `feature/142-plantilla-carga-masiva-v2` (worktree `ordenex-wt-142`),
diff `origin/dev...HEAD` (8 commits, 17 archivos).

## Veredicto

**APROBADO** — 0 bloqueantes, 7 notas menores.

## Verificación ejecutable (corrida propia del reviewer)

| Comando | Resultado medido |
| --- | --- |
| `pnpm db:generate` (DATABASE_URL dummy) | OK |
| `pnpm typecheck` | **0 errores** |
| `pnpm lint` | **0 errores / 144 warnings** |
| `pnpm test` (suite completa) | **517 archivos / 5280 tests, 0 fallos** (165s) |
| `./init.sh` | **init OK** (con el aviso esperado "no hay .env") |

Los números del implementador se confirman exactamente. El flaky ajeno
(`tests/components/LoginForm.test.tsx`) pasó en las dos corridas (suite e init.sh).

## Checklist

- [x] `requirements.md` (R1-R40 EARS), `design.md` (con alternativas descartadas A-D) y `tasks.md` presentes.
- [x] `tasks.md`: 16/16 tareas (B1-B8, F1-F4, C1-C2, T1-T2) marcadas [x], 0 sin marcar.
- [x] Trazabilidad R1-R40 a test real. Revisé caso por caso los nombres citados en
      `progress/impl_142-plantilla-carga-masiva-v2.md`; todos existen, ejercen el
      comportamiento y asertan valores concretos (no tests vacíos).
- [x] Prueba de sensibilidad (mutación). Corrí la suite contra una copia MUTADA del
      parser (alias de vitest a un fichero de scratchpad; sin tocar el repo) que
      (a) aceptaba el tercer segmento sin paréntesis y (b) ignoraba el texto tras el cierre.
      Resultado: 5 tests rojos en 2 archivos: `direccion-destinatario.test.ts` (R19, R22) y
      `bulk-orden-service.test.ts` (R19 vía sesión, R29 texto tras el paréntesis, R30/R32
      lote mixto). Los tests fallan si el comportamiento se rompe.
- [x] `./init.sh` verde y tests corridos por mí.
- [x] Sin migraciones, sin cambios de RLS, sin endpoints nuevos (R40): `git diff --name-only`
      no toca `db/` ni ningún `route.ts`.
- [x] Cero `.tsx` fuera de alcance: el único `.tsx` de app tocado es `OrdenesCargaUpload.tsx` (F2).
- [x] Sin secretos, sin hardcode de contexto de negocio, capas separadas (parser puro en
      `lib/utils/`, service sin HTTP, route sin lógica).

## Las 4 invariantes estructurales

1. **El parseo NO vive en `filaCargaSchema`.** Confirmado en `lib/types/carga-masiva.ts:60-72`:
   el schema solo declara `direccion_destinatario` como paso-a-través
   (`z.string().trim().optional().default("")`). El parseo ocurre en
   `BulkOrdenService.geoInputDesdeDireccionUnificada` (`lib/services/BulkOrdenService.ts:188-194`).
2. **Extractor inyectado por vía.** `resolveFila(raw, ctx, seen, geoInputOf)`
   (`BulkOrdenService.ts:444-452`); `cargarMasiva` inyecta `geoInputDesdeDireccionUnificada`
   (línea 288) y `cargarViaApi` inyecta `geoInputDesdeColumnasSeparadas` (línea 360), que lee
   provincia/canton/distrito/direccion con el mismo trim() que antes hacía el schema. El
   contrato público de la 88 no cambia (`docs/api/api-key-openapi.yaml` sin diff,
   `app/api/ordenes/api-key/carga/route.ts` sin diff).
3. **`resolveGeo` intacto.** El diff no toca ninguna línea de la función (los hunks están en el
   import, en bloques AÑADIDOS después de `resolveGeo`, y en `resolveFila` y las dos vías).
   Firma, orden provincia-cantón-distrito, derivación de zona_id y los siete mensajes de error
   idénticos.
4. **`bulk-orden-service.carga-api.test.ts`.** Diff puramente aditivo: un describe nuevo al
   final (2 casos R38). Ni una línea de los 21 casos previos modificada. Suite 23/23.

## Corte duro (D1)

- `REQUIRED_HEADERS = [num_remision, destinatario, telefono, direccion_destinatario]`.
- No queda ningún camino que derive geografía de las columnas viejas en la vía sesión:
  provincia/canton/distrito/direccion ya no aparecen como columnas de plantilla
  (`ORDENES_BULK_FIELDS`, 8 claves) ni como campos del schema de fila; el único consumidor de
  `findMissingHeaders` / `REQUIRED_HEADERS` es el paso de subida de órdenes.
- Archivo con formato viejo: falla en cabecera con el copy literal aprobado
  ("Faltan columnas obligatorias: direccion_destinatario. La plantilla cambió: descarga la
  plantilla nueva y vuelve a cargar tus datos.") y sin enviar chunks
  (`expect(procesarEnChunksMock).not.toHaveBeenCalled()` en
  `tests/components/OrdenesCargaUpload.test.tsx`).
- Columnas viejas presentes ADEMÁS de las obligatorias: se ignoran y se procesa igual (R10, dos tests).

## El parser, con lupa (R11-R28)

Ejercí el parser fuera de su suite (script propio en scratchpad, import directo del módulo):

- Bordes contra el spec: menos de 3 barras, exactamente 3, más de 3 (la dirección conserva las
  barras y los espacios internos), barra final, sin paréntesis, paréntesis vacío / solo
  espacios / sin cerrar, texto tras el cierre, espacios tras el cierre, provincia vacía, cantón
  vacío, valor vacío, dirección literal vacía (aceptada, cadena vacía, se persiste null),
  acentos y mayúsculas sin normalizar. Todos coinciden con R11-R28 y con las decisiones firmes
  del humano.
- Entradas que la suite NO cubre y que probé: sin espacios alrededor de las barras; barra
  dentro del paréntesis del distrito; paréntesis anidados; paréntesis antes del cantón; cierre
  sin apertura; tabuladores como separación interna; NBSP (U+00A0) como provincia o dirección;
  salto de línea dentro de la dirección; apertura suelta en la dirección; tres barras solas.
  Ninguna produjo un resultado incorrecto: todas caen o en un ok correcto o en un error de campo.
- Fuzz de 50.000 cadenas sobre el alfabeto barra, paréntesis, espacio, tab, salto, letra,
  acento, emoji y NBSP: 0 excepciones (R28) y 0 aceptaciones con provincia/cantón/distrito vacíos.
- Round-trip: reconstruir "X / prov / canton (distrito) / direccion" desde un resultado ok y
  volver a parsear devuelve exactamente las mismas partes en todos los casos probados.

## Fallo abierto vs. cerrado (antecedente feature 140)

No hay camino por el que una fila con `direccion_destinatario` malformada llegue a crearse:

- `geoInputDesdeDireccionUnificada` devuelve `{ok:false}`, `geoResult` se fuerza a no-ok,
  `fieldErrors` queda no vacío y la fila sale como error ANTES de construir `createData`.
- El parser nunca devuelve ok con provincia/cantón/distrito vacíos (verificado por fuzz), así
  que `resolveGeo` no recibe cadenas vacías por esa vía.
- `zona_id` no puede quedar nulo: `geo.zonaId` solo existe tras el guard
  `distrito.zonaId === null` que manda la fila a error.
- Defensa en profundidad comprobada: en la corrida con el parser mutado (que devolvía distrito
  vacío), la fila igual terminó en error por la rama `raw.distrito.trim() === ""` de
  `resolveGeo`, viva para la vía API key. Falla cerrado por partida doble.

## Ejemplo canónico (R4)

Medido por mí contra los XLSX reales del seed, replicando el cruce (`parseGeografiaRows` +
`parseZonaHintRows` + `normalizeZonaKey` / `canonicalZonaNombre`):

- Cartago / Cartago / Occidental: existe en el catálogo y tiene zona GAM.
- Cartago / Jimenez / Juan Vinas: existe pero sin zona (justifica la sustitución).
- Totales: 491 ternas en el catálogo, 198 con zona.

El guard `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` NO se relajó: sigue exigiendo
terna existente en `geoTernas` y pertenencia a `ternasConZona`; lo único que cambió es de dónde
sale la terna (ahora del parser real aplicado al ejemplo de la columna única).

## Hallazgos

### BLOQUEANTES

Ninguno.

### Notas menores

1. **menor — Sin test extremo a extremo de la vía sesión con la columna nueva.**
   `tests/components/OrdenesCargaUpload.test.tsx` mockea `procesarEnChunks` y los tests de ruta
   usan un service falso, así que ningún test recorre parser-cliente, `chunk/route.ts` y
   `BulkOrdenService` con `direccion_destinatario`. Verifiqué a mano que el camino no filtra
   columnas (`procesarEnChunks` reenvía el RawRow completo y `chunkBodySchema` usa
   `z.record(z.string(), z.string())` en `app/api/ordenes/carga-masiva/chunk/route.ts:44`), por
   lo que el riesgo real es bajo. Es un guard ausente, no un defecto.
2. **menor — Asserts dentro de `if (r.status === "ok")` sin fijar el status.** P. ej. el segundo
   caso R38 nuevo de `tests/unit/services/bulk-orden-service.carga-api.test.ts` y varios casos de
   `bulk-orden-service.test.ts`: si el status cambiara a forbidden, el test pasaría sin ejercer
   nada. Patrón preexistente en el repo; conviene añadir `expect(r.status).toBe("ok")` cuando se
   toquen esos archivos.
3. **menor — R32 (chips) se cubre por genericidad.** Ningún caso construye chips a partir de un
   error `direccion_destinatario`; se apoya en que `carga-masiva-error-chips.ts` agrupa por
   `campo::mensaje canónico` y es agnóstico del campo (verificado leyéndolo). El conteo en
   `conError` sí está cubierto por el caso del lote mixto.
4. **menor — Mensaje potencialmente confuso.** Una barra dentro del paréntesis del distrito
   ("CR / Cartago / Jimenez (Juan / Vinas) / X") responde "el parentesis del distrito no esta
   cerrado". Es correcto según R11 (la tercera barra corta antes), pero puede despistar al usuario.
5. **menor — CHECKPOINTS pendientes de bookkeeping del leader.** No hay entrada en
   `progress/history.md` para la 142 ni actualización de `feature_list.json` en este diff.
6. **menor — Sin E2E de ingesta de órdenes.** `CHECKPOINTS.md` pide E2E para flujos críticos; no
   existía uno de carga masiva antes de esta feature y no se añade. Deuda preexistente.
7. **menor — Cifra de la bitácora.** `impl_142-plantilla-carga-masiva-v2.md` dice "197 ternas con
   zona"; mi medición con la misma lógica da 198. Irrelevante para el veredicto.

## Conclusión

La feature cumple R1-R40 con tests reales y sensibles, respeta las cuatro invariantes
estructurales, el corte duro es efectivo, el parser resiste fuzz y bordes no cubiertos, y la
verificación ejecutable es verde en mi propia corrida. **APROBADO.**
