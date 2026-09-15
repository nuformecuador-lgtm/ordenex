# 423 — Ordenar las tablas de órdenes por número de remisión · REVISIÓN

> Revisor independiente. No se editó código: lo único que se escribió en el árbol fueron dos
> archivos temporales de verificación, ejecutados y **borrados** (§2), y este informe.
> Rama `feat/423-ordenar-por-remision`, commits `134a8b0a` (backend) y `5607bb9b` (pantalla).

## Veredicto

**OK — no hay bloqueantes.** Los 20 requisitos tienen un test que los ancla de verdad: ninguno de
los tres modos de test falso de este repo aparece en los 7 archivos de la feature (§3), y los
cuatro puntos que se pidieron mirar con lupa —la guardia de R16, R5, el `down.sql` de R19 y que
nada se haya movido fuera de `/ordenes`— se verificaron **ejecutando**, no leyendo la bitácora.

---

## 1. Checklist de `CHECKPOINTS.md`

| Punto | Estado | Cómo se comprobó |
| --- | --- | --- |
| `requirements.md` con EARS numerados | OK | R1–R20, más cuatro decisiones cerradas con su motivo |
| `design.md` con alternativa descartada y su porqué | OK | cinco (§5.1–§5.5), cada una con el defecto concreto que evita |
| `tasks.md` con todas las tasks `[x]` | INAPLICABLE | el archivo **no tiene casillas**: sus tareas son encabezados `### T<n>` (0 `[ ]`, 0 `[x]`). Se verificó una a una contra el árbol. T3.3 queda pendiente por decisión del humano |
| Cada `R<n>` mapea a un test concreto | OK | tabla de §4, verificada test por test |
| `progress/impl_423.md` contiene el mapa `R → test` | OK | dos mapas (backend y frontend) que entre los dos cubren R1–R20 |
| `pnpm run typecheck` sin errores | OK | `gate_423_completo.log:10` — «typecheck paso» |
| `pnpm run lint` sin errores | OK | 184 warnings, **0 errores**; es el baseline del árbol (no es hallazgo) |
| `pnpm test` pasa | OK | gate completo: 1.956 archivos, 28.461 pasados, 26 saltados, `INIT_EXIT=0`. **Los 26 saltados son de `AnaliticaPage` (17) y `AnaliticaShell` (9): ninguno de `integration/db`** |
| E2E para flujo crítico | INAPLICABLE | `init.sh` no ejecuta Playwright y los specs de `e2e/` están marcados «NOT EXECUTED». El flanco crítico que toca esta ficha —que la columna generada no rompa el `INSERT`— se cubre contra Postgres real (§2a) |
| RLS en tablas nuevas | n/a | no hay tabla nueva; la columna hereda permisos y políticas de `orden`, dicho en la cabecera de la migración |
| Migración reversible con `down.sql` | OK | **ejecutado por el revisor** (§2d) |
| Sin secretos hardcodeados | OK | el diff no introduce ninguna credencial ni URL |
| Webhooks con firma/idempotencia | n/a | la feature no toca ningún webhook |
| Capas separadas | OK | el cambio de servidor es **una entrada de un mapa** en el repositorio (`SORT_COLUMN`); `OrdenService` no se tocó; ningún componente conoce SQL |
| Permisos en servidor / props | n/a | no cambia ninguna superficie protegida ni añade fetch de cliente |
| Sin hardcode de país/moneda/cuenta | OK | la clave se deriva de `num_remision`, sin ninguna constante de contexto |
| `./init.sh` en verde | OK | `progress/gate_423_completo.log`, `INIT_EXIT=0` escrito dentro del log |
| `progress/review_423.md` con veredicto OK | OK | este archivo |
| Entrada en `progress/history.md` | PENDIENTE | no hay ninguna línea de la 423; es trabajo de cierre (menor 5) |

---

## 2. Lo que ejecuté yo (no me fié de la bitácora)

**(a) Los dos archivos de integración, contra Postgres real — 16/16, cero saltados.**
`orden-orden-remision-natural` (12 casos) y `orden-clave-remision-no-lanza` (4) corrieron con
`.env` presente y base alcanzable, caso por caso con `--reporter=verbose`. No hay un solo
`if (!x) return;` en ninguno de los dos, y el primer caso de cada archivo es un **contrapeso** que
mide el aislamiento del corpus: si entrara una fila ajena, las aserciones de abajo dejarían de
afirmar nada.

**(b) Los 10 archivos de unidad/guardia relacionados — 169/169.** Incluidos el que la ficha tocó
de rebote (`ordenes-listado-filtros`) y la suite del histórico
(`tests/components/HistorialAccionesModule.test.tsx`).

**(c) R16 — la guardia MIDE lo que dice medir (mutación del revisor).** El censo de
`clave-remision-solo-lectura.guardia` no es «un par de archivos elegidos a mano»: recorre
recursivamente `lib`, `app`, `components`, `hooks` y `scripts`, sobre la fuente **sin
comentarios**, y tiene un contrapeso que exige que el censo encuentre menciones. Lo comprobé
plantando una fuga en `app/(app)/ordenes/_components/_tmp_review423_fuga.ts`
(una constante que nombra `claveRemision`):

```
 Test Files  1 failed (1)
      Tests  2 failed | 10 passed (12)
```

Archivo borrado después; `git status` limpio. Además la guardia obliga a que los dos permisos de
la lista blanca **se usen** (una lista blanca con entradas de más miente) y comprueba que el
cliente singleton se construye con `omit: PRISMA_OMIT`, no solo que la constante exista.

**(d) R19 — el `down.sql` ejecutado de verdad, y revertido.** No me fié del rollback de la
bitácora: corrí las **dos sentencias del archivo, tal cual**, dentro de una transacción revertida
contra la base local, midiendo antes y después el `count(*)` y la huella
`md5(string_agg(num_remision, '|' ORDER BY id))`:

- antes: columna presente (1) e índice presente (1) — si no, el caso no probaría nada;
- después de aplicar el `down.sql`: columna 0, índice 0;
- **`count(*)` idéntico y huella idéntica** → no se tocó ni una fila de `num_remision`;
- el orden de las sentencias es el correcto: `DROP INDEX` y luego `ALTER TABLE ... DROP COLUMN`.

La transacción se revirtió, el archivo temporal se borró y volví a correr
`orden-orden-remision-natural`: 12/12 verde, la base local quedó como estaba.

**(e) R18 — `git diff origin/dev...HEAD -- lib/types/orden.ts` vacío.** El contrato público no se
amplió: `SORT_FIELDS` sigue siendo `created_at | num_guia | num_remision`. Lo que cambió es la
**columna** a la que el repositorio traduce la clave pública.

**(f) El alcance, medido en el árbol.** `SORT_COLUMN` tiene **un solo** sitio de uso
(`OrdenRepository.ts:1931`). `claveRemision` aparece en **dos** archivos de `lib/`
(`prisma-client.ts` y `OrdenRepository.ts`) y en **cero** de `app/`. Ningún otro repositorio,
service, DTO ni componente la nombra.

---

## 3. Los tres modos de test falso: buscados uno por uno, no encontrados

| Modo | Dónde podía estar | Qué encontré |
| --- | --- | --- |
| Aserción contra su propia fuente | los literales de orden (R3/R4/R9), los textos de las dos notas (R14/R20) y las etiquetas del control | **Todos escritos a mano.** `ORDEN_ASCENDENTE_ESPERADO` y `ORDEN_DESCENDENTE_ESPERADO` son dos listas independientes (la segunda **no** es un `reverse()` de la primera, y está bien: `prioridad DESC` no se invierte). Los tests de pantalla dejaron de importar del módulo que genera los textos: nombres accesibles y etiquetas están escritos en el propio archivo de test |
| Integración que se salta su cuerpo | los dos archivos de `tests/integration/db/**` | **Cero `if (!x) return;`.** `sembrarBase` revienta si faltan catálogos, y ejecuté los 16 casos viéndolos uno a uno |
| Servicio con dobles que no ve el SQL | el `ORDER BY` de R3/R4/R7/R8/R9/R13 | **No hay dobles**: todo va contra Postgres real, por el repositorio Y por `OrdenService.listar`/`listarCompleto`. La contraprueba por mutación de `SORT_COLUMN` (bitácora §3) es coherente con el literal: devolver la columna cruda pone `NA-107` entre `NA-1069` y `NA-1070`, que es exactamente lo que el `toEqual` literal rechaza |

Las mutaciones que declara la bitácora (9 en total) son verificables por lectura: cada una ataca
una aserción que existe y que no puede seguir verde con la mutación puesta. Reproduje la de R16 yo
mismo (§2c) y salió roja.

---

## 4. Mapa de trazabilidad verificado `R<n> → test`

| R | Test que lo ancla | Verificado |
| --- | --- | --- |
| R1 | `ordenamiento-ordenes` (opciones literales, y que `num_guia` **no** se ofrece) + `ordenes-listado-orden` → «R1 — ofrece los DOS campos sin desplegar nada» (lee los botones renderizados por su nombre accesible) | ejecutado |
| R2 | `orden-orden-remision-natural` → «R2 — página 1 trae las MÁS BAJAS del conjunto» (3 páginas literales + recorrido) y «R2 — por el SERVICIO…» + `ordenes-listado-orden` → «pide `sortBy: num_remision` al servidor» | ejecutado |
| R3 | `orden-orden-remision-natural` → «R3+R4 — ascendente…», con las tres comparaciones dichas una a una | ejecutado |
| R4 | el mismo caso: `72912`, `73636`, `BS-`, `NA-`, `SC-` como literal | ejecutado |
| R5 | `orden-clave-remision-no-lanza` → las 9 raras una a una, el **lote** con una rara en medio y las dos colisiones + `orden-clave-remision.guardia` → «NO contiene ningún cast a número» | ejecutado (ver menor 1) |
| R6 | `orden-clave-remision.guardia` → `COLLATE "C"`, clases enumeradas y el **censo** de migraciones posteriores + `orden-orden-remision-natural` → las 5 claves leídas por SQL crudo | ejecutado (ver menor 2) |
| R7 | `orden-orden-remision-natural` → «R7 — `prioridad` sigue mandando»: `SC-050` (la última por remisión) flota a la primera fila y el resto conserva su orden | ejecutado |
| R8 | los dos casos de 241 claves empatadas (asc y desc) + la misma página pedida dos veces | ejecutado |
| R9 | `orden-orden-remision-natural` → «R9 — descendente…» (literal independiente) + `ordenamiento-ordenes` / `ordenes-listado-orden` (etiquetas «Más altas»/«Más bajas», sin vocabulario temporal) | ejecutado |
| R10 | `ordenes-listado-orden` → los tres casos de «cambiar de campo CONSERVA la dirección», incluida la consecuencia asumida (`desc` → «Más altas») | ejecutado |
| R11 | `ordenes-module-orden` → «desde la página 3 por fecha, elegir la remisión pide la página 1» + `ordenes-listado-orden` → desde la página 2 | ejecutado |
| R12 | `ordenes-module-orden` → servidor que devuelve filas DISTINTAS por campo: la fila vieja desaparece y hay **dos** llamadas; y volver al campo anterior sirve SU respuesta | ejecutado |
| R13 | `orden-orden-remision-natural` → «R13 — la DESCARGA sale exactamente en el mismo orden», por `listarCompleto` | ejecutado |
| R14 | `ordenamiento-ordenes` → los 4 casos de `notaPrioridad`, incluido «el texto CAMBIA con el campo (no es una constante disfrazada de función)» + `ordenes-module-orden` sobre el `<caption>` real | ejecutado |
| R15 | `orden-remision-alcance.guardia` (censo de `lib/`, satélite palabra por palabra, API por clave sin `sortBy`) + `orden-orden-remision-natural` → «el orden por FECHA no cambió» + `HistorialAccionesModule.test.tsx` intacto y verde | ejecutado (ver menor 3 y §5) |
| R16 | `clave-remision-solo-lectura.guardia` (12 casos) **mutado por el revisor** + `orden-orden-remision-natural` → «el `omit` global NO impide el `orderBy`, y la clave NO viaja» (0 claves en el payload crudo y 0 en el DTO) | ejecutado + mutado |
| R17 | `orden-clave-remision-no-lanza` → «un intento de ESCRIBIR la clave lo rechaza la BASE» (con SAVEPOINT, comprobando que la orden **no nace**) + la guardia estática | ejecutado |
| R18 | diff vacío de `lib/types/orden.ts` (comprobado por el revisor) + `orden-remision-alcance.guardia` → `SORT_FIELDS` literal | ejecutado |
| R19 | `orden-clave-remision.guardia` → orden de sentencias y cero DML + **el `down.sql` ejecutado por el revisor** (§2d) | ejecutado |
| R20 | `ordenes-agrupacion-serie` (15 casos: las tres situaciones, los bordes y que el texto no enumera series) + `ordenes-module-orden` → los tres casos sobre la pantalla | ejecutado |

---

## 5. Lo que se pidió mirar con lupa

**El módulo borrado (`ordenamiento-creacion.ts` y su test).** Comprobé los **seis** casos del test
de la 356 uno por uno contra el archivo renombrado: los seis siguen ahí, ampliados a los dos campos
(arranque contra el schema, campo en la lista blanca, las cuatro combinaciones que el schema
admite, las dos direcciones, la opción por defecto primera, y «dice en palabras qué hace»). El
texto de `NOTA_PRIORIDAD` sobrevive como aserción literal de `notaPrioridad("created_at")`.
**No quedó ninguna referencia viva** a los símbolos borrados en `app/`, `lib/`, `tests/`,
`components/`, `hooks/` ni `scripts/`; las únicas coincidencias del árbol están dentro de
`.claude/worktrees/` (copia rancia de otra sesión, que ni vitest ni las guardias leen).

**El cuarto importador que `tasks.md` no listaba.** `historial-acciones-orden.ts` pasó de
`OPCIONES_ORDEN_CREACION` a `OPCIONES_DIRECCION.created_at`. Comparé las dos ramas: son el **mismo
par**, en el mismo orden, con las mismas etiquetas y los mismos iconos («Más recientes» con
`ArrowDownWideNarrow` para `desc`, «Más antiguas» con `ArrowUpNarrowWide` para `asc`). El histórico
conserva su campo (`created_at`, única clave de `HISTORIAL_SORT_FIELDS`), su dirección inicial
(`desc`) y su nombre de grupo («Ordenar por fecha»), y su suite —que asserta esos textos
**literalmente**, no importados— pasa: el histórico ordena exactamente igual que antes.

**El sentido descendente sin índice, las 3 migraciones antiguas sin `down.sql`, los 184 warnings de
lint y T3.3**: revisados y **no** contados como hallazgo, por decisión ya escrita.

---

## 6. Hallazgos

### BLOQUEANTES

Ninguno.

### menores

1. **menor — R5 se ejerce en la capa Prisma, no en las tres puertas que el requisito nombra.** El
   test inserta con `create` y `createMany`; no entra por el alta manual, la carga masiva ni la
   API. Medido antes de darlo por suficiente: las **únicas dos escrituras de `orden` en todo
   `lib/`** son `createMany` (`OrdenRepository.ts:2840` y `:2958`), o sea el mismo mecanismo que el
   test ejercita, y el gate completo —con las suites de esos tres flujos dentro— está verde. Riesgo
   real bajo; se deja dicho para que nadie lea el mapa como «se probaron las tres puertas».

2. **menor — R6 no puede medirse en dos entornos desde aquí.** Su anclaje es estructural
   (`COLLATE "C"` y clases enumeradas en el texto de la migración, con mutación probada) más las
   cinco claves leídas del Postgres local. Es lo que el design declaró y es coherente, pero el día
   del despliegue conviene dejar la evidencia barata: correr contra Supabase el mismo `SELECT` de
   `num_remision, clave_remision` para esas cinco remisiones y comprobar que da los cinco valores
   del design. Un minuto, y R6 pasa de razonado a medido.

3. **menor — `orden-remision-alcance.guardia` cubre R15 por el NOMBRE de la clave, no por el USO
   del mapa.** Asserta que solo dos archivos de `lib/` nombran `claveRemision` y que las únicas dos
   líneas del repositorio son la declaración de `SORT_COLUMN`. Un listado futuro que reutilizara
   `SORT_COLUMN[params.sortBy]` en otra consulta **no nombraría la clave** y no lo cazaría. Hoy no
   pasa (un solo sitio de uso, verificado) y ninguna otra superficie acepta `sortBy`. Sugerencia
   para quien toque esto: un caso que exija que `SORT_COLUMN` se use exactamente una vez.

4. **menor — `tasks.md` no tiene casillas.** El checkpoint «todas las tasks marcadas `[x]`» no es
   satisfacible tal como está escrito en `CHECKPOINTS.md`: el archivo usa encabezados `### T<n>`
   (0 `[ ]` y 0 `[x]`). Se verificó tarea por tarea contra el árbol. Es fricción del arnés, no de
   la ficha.

5. **menor — falta la entrada en `progress/history.md`.** Es el último punto de `CHECKPOINTS.md` y
   hoy no hay ninguna línea de la 423. Trabajo de cierre, no de implementación.

6. **menor — dos commits para toda la feature.** `docs/conventions.md` pide «un commit por task
   lógica completada»; aquí hay uno por capa (backend y pantalla). Legibles y bien descritos, pero
   más gruesos que la convención.

---

## 7. Calidad y seguridad, punto por punto

- **RLS:** sin tabla nueva. La columna generada hereda permisos y políticas de `orden`; la
  migración lo dice explícitamente, para que nadie tenga que buscarlo.
- **Idempotencia / firma de webhooks:** la feature no toca ninguno.
- **Sin hardcode de contexto ni secretos:** la clave se deriva de `num_remision` con cinco
  funciones totales; no entra ninguna constante de país, moneda ni credencial.
- **Capas:** el servidor cambió **una entrada de un `Record`** dentro del repositorio; el service
  no se tocó; la pantalla no conoce ni la columna ni el SQL —y hay una guardia que lo impide—.
- **La columna no puede escribirse desde la app:** `GENERATED ALWAYS` lo hace imposible por
  construcción, y está **ejercido** contra la base (R17), no deducido del DDL.
- **Despliegue:** el orden (migración primero, código después) y el de reversión (al revés) están
  escritos en la cabecera de los dos archivos SQL, con la consecuencia exacta de invertirlos.

---

**Veredicto: OK.** Sin bloqueantes. Los seis menores son trabajo de cierre o sugerencias; ninguno
invalida un requisito ni un checkpoint.
