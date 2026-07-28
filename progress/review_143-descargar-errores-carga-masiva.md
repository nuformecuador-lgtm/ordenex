# Review — Feature 143 · Descargar en Excel las filas con error de la carga masiva

> Reviewer. Worktree `ordenex-wt-143`, rama `feature/143-descargar-errores-carga-masiva`,
> 7 commits sobre `origin/dev @ c3e6954`. Revisado contra
> `specs/143-descargar-errores-carga-masiva/{requirements,design,tasks}.md`,
> `progress/impl_143-descargar-errores-carga-masiva.md`, `docs/architecture.md`,
> `docs/conventions.md`, `docs/verification.md` y `CHECKPOINTS.md`.

## Veredicto: **APROBADO** — 0 bloqueantes, 8 menores

---

## 1. Verificación ejecutable (corrida propia, no la del implementer)

| Comando | Resultado medido por el reviewer | Baseline del leader | Delta |
| --- | --- | --- | --- |
| `pnpm typecheck` | 2 errores, ambos `Property 'count' is missing … GestionarOrdenPanelProps` (`GestionarOrdenPanelEvidencias.test.tsx:84`, `NotaPrivadaMensajero.test.tsx:253`) | los mismos 2 | **0** |
| `pnpm lint` | 0 errores / 145 warnings; ninguno en archivos de 143 | 145 warnings | **0** |
| `pnpm test` (suite completa) | 15 fallando / 5340 pasando / 521 archivos | 14 / 5294 / 518 | ver nota |
| 9 archivos de test tocados o creados por 143 | **122 / 122 en verde** | — | — |
| `./init.sh` | **rojo**: corta en `pnpm typecheck` por los 2 errores preexistentes | igual en dev | **0** |

Nota del 15o fallo: es `tests/unit/guards/no-embalaje.test.ts`, con "Test timed out in
20000ms" en el recorrido del árbol de archivos. Reejecutado en solitario pasa en 1.26 s.
Es flakiness por carga de la corrida completa, no un fallo de contenido, y no toca 143.
Los 14 restantes son los del baseline (DataTable, LoginForm, MarcarLuegoToggle,
MisAsignacionesModule, NotaPrivadaMensajero). Ningún fallo en ningún archivo tocado por la
feature. Delta real de la feature: **0**.

## 2. Trazabilidad R1–R22 — verificada EJECUTANDO, no leyendo

Los 22 requisitos tienen al menos un test; comprobé además que existen, que ejercen lo que
dicen y que **mueren si se rompe el comportamiento**. Además de leer cada `it`, apliqué
mutaciones al código de producción y confirmé que los tests gritan (todas revertidas;
`git status` limpio al terminar):

| Mutación aplicada | Tests que fallan | Requisito blindado |
| --- | --- | --- |
| `filaCargaSchema` con `.strict()` | 2 (`R16: … DESCARTA motivo_error`, `R16: el schema NO es .strict()`) | **R16** |
| Lista blanca de cabeceras en `findMissingHeaders` (devuelve también las desconocidas) | 2 (`R14 parser SERVIDOR`, `R14 parser NAVEGADOR`) | **R14** |
| Quitar el remapeo `fila: lote[i]?.linea ?? rr.fila` (`carga-masiva-chunks.ts:99`) | 1 (`R4: con varios lotes, cada fila con error exporta SUS propios valores crudos`) | **R4 / riesgo R-1** |
| `label: key + " *"` en `ERRORES_EXPORT_FIELDS` (bug de la feature 58) | 9 en total con la siguiente: cabecera `R1/R2`, `R2` sin label, los 3 de `R14`, `R15` servidor, `R16` | **R2 / R14** |
| Prefijo inventado `Fila ${error.fila ?? 0}` cuando `fila` es `null` | 2 (`R22` con detalle y sin detalle) | **R22** |

El blindaje **no es decorativo**: los dos escenarios que el ABIERTO del backlog temía
(`.strict()` y lista blanca) rompen los tests de integración, y el desalineado
`fila` ↔ `linea` — el peor fallo posible de esta feature — hace fallar T6 con los valores
de otras filas, exactamente como se prometió.

El mapa declarado en la bitácora es **cierto**. Verificaciones notables:

- **R1/R2** — `ERRORES_EXPORT_FIELDS` copia solo `{ key }` de `ORDENES_BULK_FIELDS` (sin
  `label`, sin `example`, sin `required`) y `buildXlsxRows` escribe `label ?? key`. La
  cabecera re-parseada por el parser servidor es exactamente las 8 claves + `motivo_error`.
- **R3/R4** — orden de la clasificación (no el del archivo) y valores crudos ("abc" en
  `monto_cobrar`, "  ojo  " sin trim en `notas`) con aserciones directas.
- **R5** — tres casos: `fila: null`, línea sin correspondencia y lista de filas vacía;
  ninguno lanza y el resto del archivo se sigue generando.
- **R6/R7/R8** — prefijo una sola vez (`texto.match(/Fila /g)` de longitud 1), separadores
  `; ` y `, `, motivo genérico y determinismo con doble generación.
- **R9** — `fetch` stubeado con aserción de cero llamadas; Blob con MIME xlsx.
- **R10** — nombre determinista con fecha fija (20260305-0907) más regex de fecha local
  sobre el `anchor.download` real del componente.
- **R11/R12/R13** — botón ausente del DOM sin errores; doble click con la promesa pendiente
  produce una sola generación; rechazo produce toast, botón re-habilitado, tabla y botón de
  confirmar operativos.
- **R14/R15/R16** — ambos parsers ejercidos: `parseSpreadsheet` (servidor, sobre el binario
  real) y `matrizAArchivo` (núcleo del parser del navegador). R15 compara contra el MISMO
  archivo generado sin la columna extra, celda por celda, y comprueba que la numeración de
  línea no se desplaza.
- **R17** — cabecera incompleta: sin `onValidated`, sin request de chunks, sin botón.
- **R18** — `buildXlsxTemplate` no fue tocada (verificado en el diff) y su suite
  `carga-masiva-plantilla-roundtrip.test.ts` sigue verde sin cambios.
- **R19** — el módulo de composición es puro (sin React, sin DOM, sin `any`) y `exceljs`
  solo entra por `await import("exceljs")` DENTRO de `buildXlsxRows`.
- **R20** — dos tests: el modal en el paso `asignacion` y el componente real
  `OrdenesCargaResumen`. Ninguno ofrece descarga.
- **R21** — una sola acción de descarga, `.xlsx`, sin rastro de CSV.

## 3. Puntos calientes

1. **Round-trip.** Sólido y ejercido sobre binario real en los DOS parsers. Sobrevive
   además en los bordes reales del camino: `OrdenesCargaUpload` solo gatea con
   `findMissingHeaders` (sin lista blanca) y el body del endpoint de chunks es
   `z.record(z.string(), z.string())`, permisivo. Comentarios-ancla presentes en
   `findMissingHeaders` y en `filaCargaSchema`, ambos apuntando al test de integración.
2. **Cabeceras = clave máquina.** Confirmado; la mutación con sufijo mata 9 tests. Lección
   de la feature 58 respetada.
3. **Cruce `fila` ↔ `linea`.** T6 monta 4 filas en 2 lotes con un endpoint doble que numera
   relativo al lote; sin el remapeo, las filas 3 y 4 saldrían con los datos de 1 y 2.
   Verificado mutando el código: el test grita.
4. **Valores crudos.** `construirFilasErrorExport` lee `FilaParseada.row` tal cual; nada
   normalizado ni derivado.
5. **`motivo_error`.** Prefijo una sola vez; ausente y no inventado cuando `fila` es `null`
   o no casa con ninguna `FilaParseada`.
6. **Alcance.** Botón solo en `OrdenesCargaPreview`; paso `asignacion` sin descarga; solo
   xlsx, sin CSV.
7. **`exceljs`.** Import dinámico dentro de `buildXlsxRows`; ningún import estático.
8. **Estilo defensivo.** No lanza ante datos inesperados (salvo el contrato explícito de
   `buildXlsxRows` con `fields` vacío, coherente con `buildXlsxTemplate`).
9. **`buildXlsxTemplate`.** Intacta; el diff solo añade función y constante nuevas.

## 4. CHECKPOINTS.md, punto por punto

- [x] `requirements.md` con R1–R22 en EARS.
- [x] `design.md` con alternativas descartadas (seccion 4).
- [~] `tasks.md` existe pero NO usa casillas `[x]` (menor 1).
- [x] Cada `R<n>` mapea a al menos un test concreto (verificado ejecutando y mutando).
- [x] `progress/impl_143-….md` contiene el mapa `R<n>` a test.
- [~] `pnpm typecheck`: 2 errores preexistentes de dev, delta 0 (menor 2).
- [x] `pnpm lint`: 0 errores.
- [x] `pnpm test`: delta 0 respecto al baseline.
- [~] E2E de flujo crítico (ingesta de órdenes): no existe, deuda preexistente (menor 3).
- [n/a] RLS, migraciones y `down.sql`: la feature no toca `db/`, `app/api/` ni Prisma.
- [x] Sin secretos hardcodeados; el diff no introduce `process.env` ni credenciales.
- [n/a] Webhooks.
- [x] Patrón de capas: módulos puros sin React ni DOM; el componente cliente solo compone y
      descarga. Sin queries ni lógica de negocio nueva.
- [n/a] Permisos: sin superficie nueva de datos; todo opera sobre estado ya en el cliente.
- [x] Multi-país: nada de país, moneda ni cuenta hardcodeados. La fecha del nombre de
      archivo usa hora local, como exige R10.
- [~] `./init.sh` en verde: NO, por los 2 errores preexistentes (menor 2).
- [x] `progress/review_143-….md`: este archivo.
- [ ] Entrada en `progress/history.md` y `feature_list.json`: bookkeeping del leader.

## 5. Hallazgos

### Bloqueantes

**Ninguno.**

### Menores

1. **`tasks.md` sin casillas `[x]`.** Las tasks están como encabezados `### T1…T14`, no como
   checkboxes; `CHECKPOINTS.md` pide "todas las tasks marcadas `[x]`" y la 142 sí usó ese
   formato. Es bookkeeping de spec, no de código: la bitácora documenta cada task
   ejecutada. Convertirlas a `- [x]` antes de pasar a `done`.
2. **`./init.sh` y `pnpm typecheck` en rojo por 2 errores ajenos** (`count` en
   `GestionarOrdenPanelProps`). Preexistentes en dev, delta 0. No corregibles aquí.
3. **Sin E2E de ingesta de órdenes.** `CHECKPOINTS.md` pide E2E para flujos críticos y
   `e2e/` no tiene ningún spec de carga masiva. Deuda preexistente, ya señalada como menor
   en `review_142.md`; esta feature no la agrava.
4. **T13 no ejecutado: queda un hueco pequeño pero real.** La sustitución es en lo esencial
   suficiente: el test de componente prueba que el botón llama a `buildXlsxRows` con
   exactamente `ERRORES_EXPORT_FIELDS` y la salida de `construirFilasErrorExport`, y el de
   integración toma ese mismo trío, lo lleva a binario y lo devuelve por los dos parsers;
   la cadena queda cerrada. Lo que nadie verificó: (a) cómo se ve el `.xlsx` abierto en
   Excel o Sheets (acentos, nombre de hoja, anchos) y (b) el camino real
   `File` a `parseArchivo` con un archivo descargado de verdad. Recomendación: dos minutos
   de paseo manual del humano antes del merge. No justifica rechazar.
5. **El test del parser NAVEGADOR reimplementa la lectura de celdas.** `parsearComoNavegador`
   usa `String(cell.value)` en lugar de `celdaATexto`, y no puede invocar `parseArchivo`
   (necesita un `File`). Cubre `matrizAArchivo`, que es el núcleo de la normalización, pero
   no la coacción de celdas rich-text o fórmula de producción.
6. **Import dinámico redundante en `OrdenesCargaPreview`.** El componente importa
   `XLSX_MIME` de `@/lib/utils/xlsx-template` de forma estática y luego hace
   `await import("@/lib/utils/xlsx-template")` para `buildXlsxRows`. No rompe R19 (lo
   pesado, `exceljs`, sigue siendo dinámico dentro de la función), pero el comentario
   sugiere un beneficio de bundle que ese `await import` ya no aporta.
7. **R19 se verifica con greps del código fuente**, no con análisis del bundle. Evidencia
   indirecta, coherente con el resto del repo; el import dinámico dentro de `buildXlsxRows`
   sí queda comprobado.
8. **Bookkeeping pendiente del leader**: falta la entrada en `progress/history.md` y la
   actualización de `feature_list.json`.

## 6. Conclusión

La feature cumple R1–R22 con tests reales y sensibles (verificado por mutación, no por
lectura), respeta las decisiones cerradas con el humano (D-A, D-B, G-1, G-2, G-3), deja el
round-trip descargar→corregir→subir blindado por contrato ejecutable en ambos parsers y con
comentarios-ancla en las dos piezas frágiles, no toca backend ni datos, y su delta de
verificación respecto al baseline es 0. **APROBADO.**
