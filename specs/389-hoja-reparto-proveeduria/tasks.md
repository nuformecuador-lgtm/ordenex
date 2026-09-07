# Ficha 389 — Tareas

> Checklist verificable. `[P]` = paralelizable con las de su mismo bloque.
> Cada tarea lleva su criterio de **HECHO**. Sin criterio, no está hecha.
>
> **Secuencia de bloques:** T0 → B (backend) → C (contrato de descarga) → F (frontend) →
> G (guardias) → V (verificación). **B y F no se paralelizan entre sí:** la ficha es `fullstack` y
> F consume el contrato que B publica.

---

## T0 — Antes de tocar nada (bloqueante)

- [ ] **T0.1 — Confirmar EN DISCO** (no en el índice del MCP, que devuelve de más) los ocho
      símbolos de los que cuelga todo el diseño: `cifrasDelGrupo`, `ordenesQueAportan`,
      `OrdenQueAporta.claves`, `repartoDeOrden`, `construirDescarga`, `buildXlsxRows`,
      `DataTableDescarga`, `filaDescargaAnaliticaProductos`.
      **HECHO:** tabla símbolo → archivo → línea en `progress/impl_389.md`. Si alguno no está,
      **PARAR** y avisar al leader antes de escribir código.

- [ ] **T0.2 — Comprobar que `repartoDeOrden([])` devuelve `tienda: null`**, no `"0.00"`.
      Es la premisa de R14 y está escrita en `design.md §2.2`; si fuera falsa, R14 necesita código
      propio.
      **HECHO:** una línea en la bitácora citando el cuerpo de la función, o un test de una línea.

- [ ] **T0.3 — Fotografiar en VERDE los tests de descarga que NO se deben tocar** y anotar sus
      números de partida: `tests/unit/utils/descarga-dataset.test.ts`,
      `tests/integration/descarga-dataset-roundtrip.test.ts`,
      `tests/integration/descarga-170-volumen.test.ts`,
      `tests/components/descarga/ControlDescargaTransversal.test.tsx`,
      `tests/unit/descarga/cobertura-tablas.guardia.test.ts`,
      `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts`,
      `tests/unit/descarga/columnas-sensibles.guardia.test.ts`,
      `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts`.
      **HECHO:** los conteos, medidos, en la bitácora. **Regla de la ficha: si al terminar hubo que
      EDITAR alguno de estos archivos (salvo la ampliación explícita de G1), el diseño falló** —
      es la prueba operativa de R1 y R5.

- [ ] **T0.4 — Anotar el veredicto del gate.** El diff tocará `lib/types/`, así que
      `./init.sh --rapido` **se negará** (`design.md §9`).
      **HECHO:** en la bitácora, escrito antes de empezar: «el gate de esta ficha es `./init.sh`
      completo». Sin sorpresa al final.

---

## B — Backend: la cifra restringida

- [ ] **B1** — `lib/types/conteo-productos.ts`: `DineroSoloEsteProductoDTO` y el campo
      **requerido** `soloEsteProducto` en `DineroProductoDTO`, con su docstring (por qué cuelga de
      `dinero` y no de la fila).
      **HECHO:** compila el tipo y el typecheck **enrojece** en los literales de test que
      construyen un `DineroProductoDTO` — ese rojo es la señal de que el campo es requerido.

- [ ] **B2** — `ConteoProductosService.cifrasDelGrupo`: filtrar `claves.length === 1` y derivar la
      cifra con la MISMA maquinaria (`design.md §2.2`). **Ni una fórmula de dinero nueva.**
      **HECHO:** `Number(`, `parseFloat(`, `parseInt(` y `.toFixed(` **ausentes** del diff de este
      archivo; la cifra sale de `repartoDeOrden`, no de una resta escrita a mano. Depende de B1.

- [ ] **B3** — `tests/unit/analytics/conteo-productos-solo-un-producto.test.ts`. Los siete casos:
      1. una orden de UN producto entra en la base de su fila (R10);
      2. una orden de DOS productos no entra en la base de **ninguna** de las dos (R10/R13);
      3. `2 * Base C. 1 * base c.` es **una sola clave** ⇒ cuenta como orden de un solo producto
         (R11);
      4. la base es `liquidado.tienda` del subconjunto y cumple `ordenex + tienda = recaudado`
         sobre él (R12);
      5. sin órdenes solas ⇒ `tienda: null` y `ordenes: 0`, **nunca `"0.00"`** (R14);
      6. Σ de las bases de todas las filas = el total de las órdenes de un solo producto, **contado
         una vez** (R15);
      7. una orden pendiente (sin cierre aprobado) NO entra en la base (⟨Q1⟩ escrita como test).
      **HECHO:** los siete verdes, y la mutación **M1** (§Mutaciones) los pone rojos. Depende de B2.

- [ ] **B4 [P]** — Actualizar los literales `DineroProductoDTO` de los tests existentes
      (`ProductosDescargaColumnas`, `ProductosTablaDinero`, `analitica-productos-descarga-columnas`,
      `dinero-producto-no-sumable.guardia`, y los que el typecheck delate).
      **HECHO:** typecheck verde y **ningún cambio de comportamiento** en esos archivos: solo el
      campo nuevo en el literal. Depende de B1.

---

## C — El contrato de descarga (la puerta OPT-IN)

- [ ] **C1** — `lib/types/descarga.ts`: `RefCelda`, `DescargaColumnaHoja`, `DescargaHojaExtra` y
      `DescargaConfig.hojaExtra?`. Sin dominio: ni producto, ni tienda, ni dinero.
      **HECHO:** el módulo sigue sin importar React, Prisma, `lib/services`, `lib/actions` ni nada
      de `app/`.

- [ ] **C2** — `lib/utils/xlsx-template.ts`: `buildXlsxRows(columns, rows, sheetName, hojaExtra?)`.
      Escribe el aviso, la cabecera, las filas, las fórmulas, los formatos y (A2) los totales.
      Referencias de celda con `worksheet.getColumn(i).letter`, **nunca** con una conversión
      índice→letra escrita a mano (`design.md §4.4`).
      **HECHO:** los tres consumidores previos de `buildXlsxRows` compilan **sin tocarse**; sin el
      cuarto argumento el libro sigue teniendo UNA hoja. Depende de C1.

- [ ] **C3** — `lib/utils/descarga-dataset.ts`: pasar `hojaExtra` en el camino `xlsx` e
      **ignorarlo** en el camino `csv`, con el porqué en el docstring. **`exceljs` NO se importa
      aquí** (sigue dentro de `buildXlsxRows`).
      **HECHO:** el diff de este archivo no contiene la cadena `exceljs`. Depende de C2.

- [ ] **C4** — `tests/unit/utils/xlsx-hoja-extra.test.ts`, **leyendo el `.xlsx` de vuelta** con
      `ExcelJS.Workbook.xlsx.load` (no afirmando sobre el objeto que se acaba de construir). Casos:
      dos hojas en orden (R4); la hoja 1 **idéntica** con y sin la extra (R2); celda de entrada
      vacía (R24); las derivadas son `formula`, no valor (R25/R26); guarda del vacío (R27); la
      fórmula de la fila N apunta a la fila N con **0 y con 5** líneas de aviso (R28); el resto es
      `base − proveeduría` (R29); el importe llega con los **mismos dígitos** (R30/R31); el nombre
      de hoja se sanea (R32); mismas filas y mismo orden que la hoja 1 (R33).
      **HECHO:** todos verdes y las mutaciones **M2, M3, M4** los ponen rojos. Depende de C2.

- [ ] **C5** — `tests/unit/utils/descarga-dataset-hoja-extra.test.ts`: sin `hojaExtra` el libro
      tiene UNA hoja y el mismo contenido de hoy (R1); con `tipo: "csv"` **y** `hojaExtra`
      declarada, el texto es **byte a byte** el mismo que sin ella (R3).
      **HECHO:** los dos verdes; **M5** pone rojo el del CSV. Depende de C3.

---

## F — Frontend: la hoja de productos

- [ ] **F1** — `.../entregas/reparto-proveeduria-descarga-columnas.ts`:
      `COLUMNAS_DESCARGA_REPARTO_PROVEEDURIA` (las siete de `design.md §4.2`) y
      `filaRepartoProveeduria(fila)`. El encabezado de la base **sin** `MARCA_NO_SUMABLE_ARCHIVO`
      y diciendo que solo cuenta órdenes de un producto (R17).
      **HECHO:** el módulo es puro (sin React, sin DOM, sin servicio) y no contiene ninguna de las
      cuatro llamadas prohibidas. Depende de B1 y C1.

- [ ] **F2** — `filaDescargaAnaliticaProductos`: emitir `reparto_base` y `reparto_ordenes`
      **solo con `conDinero`**, como STRING tal cual y entero. Ni una conversión.
      **HECHO:** sin concesión, la fila **no** lleva ninguna de las dos claves — el mismo caso que
      ya cubre R67 de la 347, ampliado. Depende de B1.

- [ ] **F3 [P]** — `.../entregas/reparto-proveeduria-aviso.ts`: los tres conteos
      (`design.md §2.4`) y las líneas del aviso (R18, R19, R22, R23).
      **HECHO:** el módulo **no** vive bajo la convención `*-descarga-columnas.ts`
      (`design.md §6`), y su única exportación con nombre de función devuelve `string[]`.

- [ ] **F4** — `ProductosTabla.tsx`: declarar `hojaExtra` en el objeto `descarga` **solo cuando
      `conDinero`**. `ambitoColumnas` sigue bajando como **propiedad abreviada** (la 388 lo dejó
      escrito y medido). El objeto de la hoja se construye con `useMemo` sobre los datos, y
      `columnasArchivo`/`ambitoColumnas` **no se tocan**.
      **HECHO:** el diff de este archivo son ≤ 8 líneas y `ambito-columnas.guardia` sigue verde.
      Depende de F1, F2, F3, C3.

- [ ] **F5** — `tests/unit/descarga/reparto-proveeduria-descarga-columnas.test.ts`: la **aserción
      de orden que NOMBRA la constante** (obligatoria, `design.md §6.1`), el conteo de respaldo por
      fila (R16) y el encabezado sin marca de no-sumable (R17).
      **HECHO:** `columnas-asercion-de-orden.guardia` sigue verde **y** cuenta una constante más.
      Depende de F1.

- [ ] **F6 [P]** — `tests/unit/descarga/reparto-proveeduria-aviso.test.ts`: los cuatro textos
      (R18, R19, R22, R23), la suma exacta de los tres conteos (R20) y **el caso de la orden con
      tres productos, que se cuenta UNA vez** (R21).
      **HECHO:** verdes, y **M6** (contar el multiproducto sumando `ordenesAcompanadas`) pone rojo
      R20 y R21. Depende de F3.

- [ ] **F7** — `tests/components/descarga/ProductosHojaReparto.test.tsx`, montando el consumidor
      real: con la concesión el archivo lleva **dos** hojas (R4 de punta a punta); **sin** ella no
      lleva la hoja de reparto (R6); con `limite_excedido` tampoco (R7); ocultar «Para la tienda»
      en el selector **no** cambia la hoja de reparto (R8); y `consultarConteoProductos` se llama
      **una sola vez** al descargar (R9).
      **HECHO:** los cinco verdes; **M7** (declarar `hojaExtra` sin condicionar a `conDinero`) pone
      rojo R6 **y** R7. Depende de F4.

---

## G — Guardias

- [ ] **G1** — Ampliar `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts`:
      **añadir los dos módulos nuevos a `FUENTES_CON_DINERO`** (`design.md §6.3`). Es la única
      edición permitida de los archivos de T0.3, y se hace **por escrito y con motivo**.
      **HECHO:** la guardia sigue con su autocomprobación intacta y barre ahora dos archivos más.
      Depende de F1, F3.

- [ ] **G2 [P]** — `tests/unit/descarga/hoja-extra-optin.guardia.test.ts` (guardia perenne):
      **ninguna tabla del árbol declara `hojaExtra` salvo la de productos**, censada por
      convención (barrido de `app/` + `components/`), con **autocomprobación** — un canario
      sintético que SÍ la declara tiene que ser detectado, o la guardia estaría verde por vacío.
      **HECHO:** la guardia cae con el canario y pasa con el árbol real. Es la red perenne de R5.

- [ ] **G3 [P]** — Comprobar que `columnas-sensibles.guardia` **no lanza** con el módulo nuevo:
      declara columnas **y** una proyección, y ninguna función exportada devuelve algo que no sea
      un objeto (`design.md §6`).
      **HECHO:** la guardia verde, con el módulo nuevo **listado** en su salida de censo.

---

## V — Verificación

- [ ] **V1** — **`./init.sh` COMPLETO** (no `--rapido`: el gate se niega, `design.md §9`), con
      `INIT_EXIT=$?` escrito **dentro** del log y en su propia línea, y **sin `tail` en la
      tubería**.
      **HECHO:** `INIT_EXIT=0` citado, más el número de `skipped` **contados y explicados** y la
      línea «DATABASE_URL resuelta» — sin ella, los tests contra Postgres se saltan y el gate
      miente en verde.

- [ ] **V2** — **Verificación humana en la app real.** No hay E2E en este repo y no se inventa uno
      aquí: `/analitica` con un actor **con** el dinero concedido → tabla de productos →
      «Descargar» → abrir el `.xlsx` **en Excel y en Google Sheets** y comprobar, con captura:
      (a) la hoja «Productos» está igual que antes; (b) la hoja de reparto trae el aviso con sus
      números; (c) al escribir `30 %` en una fila, las dos celdas derivadas se rellenan solas y
      suman la base; (d) la celda del porcentaje vacía deja las derivadas vacías, **no en cero**.
      **HECHO:** capturas y el resultado de los cuatro puntos en `progress/impl_389.md`. Doce mil
      tests no vieron siete textos rotos que mirar la app sí vio: este paso no es opcional.

- [ ] **V3** — Confirmar que **ningún archivo de T0.3 se editó** salvo G1.
      **HECHO:** `git diff --name-only` contra la base, contrastado con la lista de T0.3.

- [ ] **V4** — Escribir `progress/impl_389.md` con el mapa `R<n> → test`, las mutaciones medidas y
      lo que quede vivo. **Y COMMITEARLO**: un informe sin commitear describe el disco, no la rama.

---

## Mutaciones — cada requisito se mide, no se declara

Se aplican al árbol real, se corre la suite y **se revierten desde copia** (nunca `git checkout`:
suele haber trabajo sin commitear). Cada una anota su alcance y sus rojos.

| # | Mutación | Debe poner rojo |
| --- | --- | --- |
| **M1** | `claves.length === 1` → `claves.length >= 1` (o sea, la salida A: todas las órdenes) | B3 casos 2 y 6 (R10, R13, R15) |
| **M2** | escribir el importe como `Number(fila.reparto_base)` en vez de fórmula literal | C4 (R30/R31) **y** G1 |
| **M3** | quitar la guarda `IF(…="","",…)` de las fórmulas | C4 (R27) |
| **M4** | escribir la fórmula sin contar las líneas de aviso (off-by-one) | C4 (R28), en la variante de 5 líneas |
| **M5** | pasar `hojaExtra` también en el camino `csv` | C5 (R3) |
| **M6** | calcular el multiproducto como `Σ fila.ordenesAcompanadas` | F6 (R20, R21) |
| **M7** | declarar `hojaExtra` sin condicionarlo a `conDinero` | F7 (R6, R7) |
| **M8** | declarar `hojaExtra` en una segunda tabla cualquiera | G2 |

**Autocomprobación obligatoria:** cada mutación debe venir con la **línea de fallo copiada** del
log. Este árbol ya se comió un arnés de mutaciones que reportó 9/9 supervivientes **sin haber
ejecutado un solo test**.

---

## Trazabilidad `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `descarga-dataset-hoja-extra` › sin hoja declarada, el libro tiene UNA hoja y el contenido de hoy |
| R2 | `xlsx-hoja-extra` › la hoja de datos es idéntica con y sin la hoja extra |
| R3 | `descarga-dataset-hoja-extra` › con CSV la hoja extra se ignora: mismo texto byte a byte |
| R4 | `xlsx-hoja-extra` › dos hojas, en ese orden · y de punta a punta en `ProductosHojaReparto` |
| R5 | `hoja-extra-optin.guardia` (G2) + T0.3/V3 (los tests de las otras tablas, sin editar) |
| R6 | `ProductosHojaReparto` › sin la concesión el archivo no lleva la hoja de reparto |
| R7 | `ProductosHojaReparto` › con `limite_excedido` tampoco |
| R8 | `ProductosHojaReparto` › ocultar «Para la tienda» no cambia la hoja de reparto |
| R9 | `ProductosHojaReparto` › descargar consulta el servidor una sola vez |
| R10 | `conteo-productos-solo-un-producto` › casos 1 y 2 |
| R11 | `conteo-productos-solo-un-producto` › caso 3 (`2 * Base C. 1 * base c.`) |
| R12 | `conteo-productos-solo-un-producto` › caso 4 |
| R13 | `conteo-productos-solo-un-producto` › caso 2 |
| R14 | `conteo-productos-solo-un-producto` › caso 5 · y `xlsx-hoja-extra` › base ausente ⇒ celda vacía |
| R15 | `conteo-productos-solo-un-producto` › caso 6 |
| R16 | `reparto-proveeduria-descarga-columnas` › la fila lleva el conteo que respalda su base |
| R17 | `reparto-proveeduria-descarga-columnas` › el encabezado de la base no lleva la marca de no-sumable |
| R18 | `reparto-proveeduria-aviso` › dice que solo usa las órdenes de un único producto |
| R19 | `reparto-proveeduria-aviso` › da los dos motivos, cada uno con su número |
| R20 | `reparto-proveeduria-aviso` › los tres conteos suman el total del recorte |
| R21 | `reparto-proveeduria-aviso` › la orden con tres productos se cuenta UNA vez |
| R22 | `reparto-proveeduria-aviso` › dice que la hoja de datos no cambió |
| R23 | `reparto-proveeduria-aviso` › dice que la base es solo de lo liquidado |
| R24 | `xlsx-hoja-extra` › la celda del porcentaje sale vacía |
| R25 | `xlsx-hoja-extra` › las derivadas son fórmulas que referencian la celda del porcentaje |
| R26 | `xlsx-hoja-extra` › ninguna celda derivada lleva valor precalculado |
| R27 | `xlsx-hoja-extra` › sin porcentaje, las derivadas quedan vacías y no en cero |
| R28 | `xlsx-hoja-extra` › la fórmula de la fila N apunta a la fila N (con 0 y con 5 líneas de aviso) |
| R29 | `xlsx-hoja-extra` › el resto es `base − proveeduría` |
| R30 | `xlsx-hoja-extra` › la celda lleva los mismos dígitos que el STRING · + `dinero-producto-no-sumable.guardia` ampliada (G1) |
| R31 | `xlsx-hoja-extra` › un importe de once dígitos llega intacto |
| R32 | `xlsx-hoja-extra` › el nombre de la hoja cumple las reglas de Excel y es estable |
| R33 | `xlsx-hoja-extra` › mismas filas y mismo orden que la hoja de datos |

---

## Lo que esta ficha NO hace

1. **No prorratea** el importe entre los productos de una orden. No es deuda: no se puede sin el
   precio unitario (`design.md §7.1`).
2. **No persiste el porcentaje.** No hay tabla, no hay migración, no hay RLS nueva.
3. **No toca la hoja de datos**, ni el selector de columnas, ni los dos ámbitos de la 388.
4. **No arregla el punto ciego de `ambito-columnas.guardia`** — eso es la ficha **391**.
5. **No añade CSV** a la tabla de productos: hoy solo ofrece `xlsx`, y esta ficha no lo cambia.
