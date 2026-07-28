# Feature 142 — Plantilla de carga masiva v2. Bitácora de implementación (cierre)

Rama: `feature/142-plantilla-carga-masiva-v2` (worktree `ordenex-wt-142`, base `origin/dev` @ `97f6e91`).

Este documento **consolida** la feature completa. El bloque B (backend, B1–B8) está
detallado en `progress/impl_142_backend.md`; aquí se absorbe su tabla de
trazabilidad y se cierran los bloques **F (F1–F4)**, **C (C1, C2)** y **T (T1, T2)**.

---

## 1. Archivos tocados en el bloque F/C/T

| Archivo | Tarea | Cambio |
| --- | --- | --- |
| `app/(app)/ordenes/_components/carga-masiva-fields.ts` | F1 | `ORDENES_BULK_FIELDS` pasa de 11 a **8 columnas** en el orden exacto de R1 (`destinatario, telefono, direccion_destinatario, monto_cobrar, producto, num_remision, peso, notas`), con `example` por columna y **sin** `label` (R2). Desaparecen `provincia`/`canton`/`distrito`/`direccion` (R5) |
| `app/(app)/ordenes/_components/OrdenesCargaUpload.tsx` | F2 | `mensajeCabeceraFaltante()`: si `findMissingHeaders` incluye `direccion_destinatario`, el mensaje añade el copy literal del corte duro (R8). `hint` reescrito: ya no promete columnas geográficas separadas; documenta la columna única y su formato |
| `tests/components/OrdenesCargaUpload.test.tsx` | F4 | `HEADERS_OK` migrado a la cabecera v2; 3 casos nuevos (plantilla vieja → corte duro sin request; falta otra obligatoria → sin mención de plantilla nueva; columnas extra → se procesa) |
| `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` | C1 | Reescrito. 11 casos: orden exacto de las 8 columnas, ausencia de las viejas, ejemplo por columna, cabecera = clave máquina, round-trip XLSX y CSV (headers verbatim + orden + `findMissingHeaders` vacío), y el ejemplo de `direccion_destinatario` verbatim + parseado a 4 partes |
| `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` | C2 | Reescrito. La terna sale de aplicar `parseDireccionDestinatario` al ejemplo de la columna única; se conservan las 2 aserciones contra los XLSX del seed (terna existe / distrito con zona) |
| `specs/142-plantilla-carga-masiva-v2/tasks.md` | — | F1–F4, C1, C2, T1, T2 marcadas `[x]` |
| `progress/impl_142-plantilla-carga-masiva-v2.md` | T2 | este archivo |

**Verificado sin cambios (F3, `git diff origin/dev` vacío)**:
`carga-masiva-parser.ts`, `carga-masiva-chunks.ts`, `carga-masiva-clasificacion.ts`,
`carga-masiva-error-chips.ts`. Son agnósticos del nombre de campo; el error nuevo
`direccion_destinatario` se agrupa por tipo con la lógica genérica existente
(`tests/components/CargaMasivaErrorChips.test.ts` → 7/7 sin tocarlo).

Tampoco se tocó nada de `lib/`, `app/api/` ni los tests de servicio (bloque B).

---

## 2. Desviación del spec: sustitución del ejemplo canónico

`design.md > Preguntas abiertas #4` fijaba como ejemplo
`Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente gasolinera JSM, 200m sur`,
**sustituible** si el guard de geografía contra el seed lo rechazaba.

**Lo rechazó.** Medido con C2 sobre los XLSX reales del seed:

- la terna `Cartago / Jimenez / Juan Vinas` **sí existe** en
  `public/geografia-cr-completa.xlsx`;
- pero **no recibe zona** en el cruce con `public/mapa-geografico-costa-rica.xlsx`
  (hoja `Jerarquía (revisar)`), así que la carga fallaría con
  `el distrito 'Juan Vinas' no tiene zona asignada` (R36).

Ejemplo final (sustituido, mínima desviación: misma provincia, cantón y distrito
reales con zona `GAM`):

```
Costa Rica / Cartago / Cartago (Occidental) / Frente gasolinera JSM, 200m sur
```

El guard **no se relajó**: sigue exigiendo terna existente + distrito con zona.
Del listado de ternas con zona del seed (197 en total) se eligió una de Cartago
para conservar el espíritu del ejemplo aprobado.

---

## 3. Mapa de trazabilidad `R1`–`R40` → test

Consolidado: R1–R5 y R7/R8/R10 (capa UI) son de este bloque; el resto viene de
`impl_142_backend.md` y se reproduce íntegro. **Ningún requisito queda sin test.**

| R | Archivo de test | Nombre del caso |
| --- | --- | --- |
| R1 | `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` | `R1: la plantilla tiene exactamente las 8 columnas en el orden del spec` · `R1: XLSX — los headers re-parseados conservan el orden de las 8 columnas` · `R1: CSV — los headers re-parseados conservan el orden de las 8 columnas` |
| R2 | idem | `R2: la cabecera de la plantilla usa las claves máquina (sin etiquetas divergentes)` · `R2: XLSX — la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes` · `R2: XLSX — CADA clave de columna aparece VERBATIM en los headers parseados` · `R2: CSV — la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes` · `R2: CSV — CADA clave de columna aparece VERBATIM en los headers parseados` |
| R3 | idem | `R3: cada una de las 8 columnas define un valor de ejemplo` · `R3: XLSX — el ejemplo de direccion_destinatario llega verbatim y se parsea a 4 partes` · `R3: CSV — el ejemplo de direccion_destinatario sobrevive a las comas del CSV` |
| R4 | `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` | `R4: el ejemplo de direccion_destinatario se parsea a las 4 partes` · `R4: provincia/cantón/distrito del ejemplo EXISTEN en el catálogo geográfico real` · `R4: el distrito del ejemplo TIENE zona asignada (deriva orden.zona_id)` |
| R5 | `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` + `tests/unit/types/carga-masiva.test.ts` | `R5: la plantilla NO incluye provincia, canton, distrito ni direccion` · `R6/R5: ya no exige columnas geograficas separadas` |
| R6 | `tests/unit/types/carga-masiva.test.ts` | `R6: exige exactamente num_remision, destinatario, telefono y direccion_destinatario` · `R6/R5: ya no exige columnas geograficas separadas` |
| R7 | `tests/unit/types/carga-masiva.test.ts` + `tests/components/OrdenesCargaUpload.test.tsx` | `R7: cabecera sin direccion_destinatario -> se reporta como obligatoria ausente` · `R7/R8: archivo con la plantilla VIEJA → corte duro con el copy de plantilla nueva, sin request` |
| R8 | `tests/components/OrdenesCargaUpload.test.tsx` + `tests/unit/types/carga-masiva.test.ts` | `R7/R8: archivo con la plantilla VIEJA → corte duro con el copy de plantilla nueva, sin request` (copy literal) · `R8: si falta otra obligatoria (no la dirección) NO se menciona la plantilla nueva` · `R8/R9: la plantilla vieja (4 columnas geograficas) falla la cabecera por direccion_destinatario` |
| R9 | `tests/unit/types/carga-masiva.test.ts` + `tests/unit/services/bulk-orden-service.test.ts` | `R8/R9: la plantilla vieja …` · `R9: las columnas viejas presentes en el archivo se ignoran (no hay modo compatibilidad)` · `R9/R39: la columna direccion vieja NO se usa como direccion literal` |
| R10 | `tests/unit/types/carga-masiva.test.ts` + `tests/components/OrdenesCargaUpload.test.tsx` | `R10: columnas extra desconocidas ademas de las obligatorias no producen error de cabecera` · `R10: columnas extra desconocidas además de las obligatorias → se procesa igual` |
| R11 | `tests/unit/utils/direccion-destinatario.test.ts` | `R11: solo los TRES primeros '/' son separadores; el resto queda en la direccion` |
| R12 | idem | `R12: el pais se descarta sin validarlo y no aparece en el resultado` · `R12: pais vacio, con texto arbitrario o con numeros -> mismo resultado` |
| R13 | idem | `R13: %s -> error de formato citando el formato esperado` (3 casos: sin `/`, uno, dos) |
| R14 | idem | `R14: con exactamente tres '/' produce provincia, canton, distrito y direccion` |
| R15 | idem | `R15: conserva los '/' posteriores al tercero y los espacios internos sin colapsar` |
| R16 | idem | `R16: una direccion que termina en '/' conserva ese '/' final` |
| R17 | idem | `R17: recorta extremos de provincia, canton, distrito y direccion; deja los internos` · `R17: los espacios internos de cada segmento se conservan` |
| R18 | idem | `R18: el distrito sale del primer parentesis y el canton de lo que lo precede` · `R18: un ')' dentro del distrito no confunde: cierra en el primer ')' posterior` |
| R19 | idem + `tests/unit/services/bulk-orden-service.test.ts` | `R19: sin parentesis de distrito -> error indicando que falta el distrito` · `R19: sin parentesis de distrito -> error de fila en direccion_destinatario (la zona se deriva del distrito)` |
| R20 | `tests/unit/utils/direccion-destinatario.test.ts` | `R20: %s -> error de campo` (paréntesis vacío / con solo espacios) |
| R21 | idem | `R21: parentesis abierto y no cerrado -> error de campo` |
| R22 | idem | `R22: texto no vacio despues del ')' -> error de campo` · `R22: solo espacios despues del ')' -> se ignoran sin error` |
| R23 | idem | `R23: %s -> error de campo` (provincia vacía / con solo espacios) |
| R24 | idem | `R24: %s -> error de campo` (cantón vacío / con solo espacios) |
| R25 | idem | `R25: %s -> error de obligatoriedad citando el formato esperado` (vacío / solo espacios / tabuladores) |
| R26 | idem + `bulk-orden-service.test.ts` | `R26: direccion literal vacia tras recortar espacios -> se acepta con direccion ''` · `R26/R37: direccion literal vacia -> la fila se crea y persiste direccion null` |
| R27 | idem + `bulk-orden-service.test.ts` | `R27: entrega los nombres tal cual, con acentos y mayusculas del archivo` · `R27: no colapsa espacios repetidos internos …` · `R27/R33: acentos y mayusculas en la columna unica resuelven la misma geografia` |
| R28 | `tests/unit/utils/direccion-destinatario.test.ts` | `R28: nunca lanza para ninguna entrada string` · `R28: es determinista — la misma entrada produce el mismo resultado` |
| R29 | `tests/unit/services/bulk-orden-service.test.ts` | `R29: fila imparseable -> resultado error con la clave direccion_destinatario y mensaje accionable` · `R29: %s -> error de fila bajo direccion_destinatario, sin crear la orden` (8 casos) |
| R30 | idem | `R30/R32: un lote mixto crea las validas y cuenta las imparseables en conError` |
| R31 | idem | `R31: dryRun y carga en firme clasifican igual las filas imparseables` · `R31: el mismo archivo troceado en dos lotes clasifica igual que en uno solo` |
| R32 | idem + `tests/components/CargaMasivaErrorChips.test.ts` | `R30/R32: un lote mixto crea las validas y cuenta las imparseables en conError` · agrupación por tipo verificada por la suite genérica de chips (7/7, sin cambios; F3) |
| R33 | `bulk-orden-service.test.ts` | `deriva zonaId desde el distrito resuelto` · `R27/R33: acentos y mayusculas …` |
| R34 | idem | `provincia inexistente -> error de fila con fieldError geografico` |
| R35 | idem | `canton ambiguo dentro de la provincia -> error de fila` · `canton no encontrado dentro de la provincia -> error de fila` |
| R36 | idem | `distrito sin zona asignada -> error de fila` · `distrito provisto pero inexistente en el canton -> error de fila` |
| R37 | idem | `R37: la direccion literal se persiste en el campo direccion de la orden` · `R26/R37: … persiste direccion null` |
| R38 | `tests/unit/services/bulk-orden-service.carga-api.test.ts` | `R38: fila con provincia/canton/distrito separados y SIN direccion_destinatario se crea igual` · `R38: una columna direccion_destinatario presente en el payload API es ignorada …` + los 21 casos previos del archivo, intactos |
| R39 | `tests/unit/types/carga-masiva.test.ts` + `bulk-orden-service.test.ts` | `R39: conserva la semantica de num_remision/destinatario/telefono/producto/monto_cobrar/notas` · `R39: la columna peso del archivo no se persiste (peso null)` |
| R40 | verificación B7/B8 + `tests/integration/api/*` | `git diff` vacío en ambos `route.ts`, `db/schema.prisma` y `db/migrations/`; `ordenes-carga-masiva-chunk.route.test.ts` y `ordenes-api-key-carga.route.test.ts` pasan sin tocarse |

---

## 4. Baseline vs. final (números reales)

Medidos en el worktree con `DATABASE_URL` dummy (`prisma generate` no accede a la DB).

| Métrica | Baseline de la rama (pre-bloque B) | Tras el bloque B (7 fallos dejados a propósito) | **Final (F/C/T cerrados)** |
| --- | --- | --- | --- |
| `pnpm typecheck` | 0 errores | 1 error (`carga-masiva-plantilla-roundtrip.test.ts:69`) | **0 errores** |
| `pnpm lint` | 0 errores / 144 warnings | 0 errores / 144 warnings | **0 errores / 144 warnings** |
| `pnpm test` — archivos | 1 failed / 514 passed (515) | 2 failed / 515 passed (517) | **0 failed / 517 passed (517)** |
| `pnpm test` — tests | 1 failed / 5208 passed (5209) | 7 failed / 5263 passed (5270) | **0 failed / 5280 passed (5280)** |
| `./init.sh` | — | — | **`== init OK ==`** |

Salida real de la suite final:

```
 Test Files  517 passed (517)
      Tests  5280 passed (5280)
   Duration  273.59s
```

Notas:

- **Delta de fallos vs. baseline: −1.** El único fallo del baseline
  (`tests/components/LoginForm.test.tsx`, flaky por `waitFor`, ajeno a la feature)
  pasó en esta corrida y en la de `./init.sh`. No se tocó.
- Los 7 fallos y el error de typecheck que dejó el bloque B eran exactamente
  C1 (4 tests + el typecheck) y F4 (3 tests): **cerrados**.
- `./init.sh` avisa `! no hay .env` — esperado en un worktree; no es fallo.

### Suites relevantes en verde (corridas aisladas)

- `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` → 11/11.
- `tests/components/OrdenesCargaUpload.test.tsx` → 10/10.
- `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` → 4/4.
- `tests/components/CargaMasivaErrorChips.test.ts` → 7/7 (sin tocar el archivo, F3).

---

## 5. Deuda y desviaciones

1. **Ejemplo canónico sustituido** (§2): `Cartago (Occidental)` en vez de
   `Jimenez (Juan Vinas)`, porque el segundo no tiene zona en el seed. Autorizado
   de antemano en `design.md > Preguntas abiertas #4`. El guard no se relajó.
2. **Deuda de datos del seed (no abierta aquí)**: 197 ternas del catálogo reciben
   zona en el cruce; el resto (incluida `Jimenez / Juan Vinas`) no. Cualquier
   cliente de esos distritos verá `distrito sin zona`. Es preexistente y ajeno a
   esta feature.
3. **`peso`**: sigue en la plantilla y sigue sin persistirse (`peso: null`).
   Decisión explícita del humano (R39), deuda preexistente.
4. **i18n**: los textos nuevos (`mensajeCabeceraFaltante`, `hint`) siguen en
   castellano inline, como el resto del componente. No hay capa de i18n en el
   repo; no se introduce una para esta feature.
5. **Sin migración, sin RLS, sin endpoints nuevos** (R40), confirmado en B7/B8 y
   por `git status` (ningún archivo bajo `db/`).
