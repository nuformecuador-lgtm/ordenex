# 134 — analitica: export CSV · tasks

Convenciones: `[P]` = paralelizable con las tareas marcadas igual dentro de la misma fase.
Cada task lleva su **criterio de hecho**. Ninguna task se marca `[x]` sin evidencia ejecutable.

**Puerta T0: CERRADA el 2026-08-04.** Las seis decisiones (D1–D6) estan en
`requirements.md > Decisiones de la puerta T0`, con su razonamiento. **Nada queda supuesto y
nada queda bloqueado por decidir.**

---

## Fase 0 — Puerta y encuadre (CERRADA)

- [x] **T0.1** Decisiones D1–D6 registradas en `requirements.md` (puerta T0, 2026-08-04):
      D1 solo operativa · D2 reuso del borde + archivo en el navegador · D3 cobertura en
      columnas por fila · D4 sin cabecera de metadatos · D5 dialecto CSV intacto + XLSX (R21) ·
      D6 un archivo por panel. **Hecho:** las seis constan con respuesta **y motivo**.
- [x] **T0.2** D1 = solo operativa ⇒ **no** hay que volver a `spec_author`. La financiera queda
      fuera **por decision, no por olvido**; su ficha propuesta esta en `design.md §9`.
- [x] **T0.3** Correcciones de la ficha en `feature_list.json` (`zone` `fullstack`→**`frontend`**,
      `depends_on` `127`→**`126`**, alcance citado «121»→**122**). **Las aplica el leader.**
      **Hecho:** el implementer NO toca `feature_list.json`; el rastro esta en
      `requirements.md > Correcciones de la ficha`. Las dos primeras se aplicaron con el spec
      (`1af04e53`); **la tercera se quedo sin hacer** y se completa al cerrar: la descripcion
      seguia diciendo «Fullstack» y citando «(121)» donde el punto de entrada blindado es de
      la **122**. Reescrita entera sobre la version de `dev`, no sobre la del punto de rama.

---

## Fase 1 — El guardia PRIMERO (nace rojo o no vale)

> Va antes que el codigo a proposito: un guardia escrito despues se escribe para pasar.

- [x] **T1.1** `tests/unit/analytics/export-csv-frontera.guardia.test.ts`, bloque 1 (R1/R19):
      censo del subarbol `app/(app)/analitica/_components/operativo/` — ningun archivo importa
      `AnaliticaOperativa\w*Service|Repository`, `getPrismaClient`, `@/lib/db`,
      `@/lib/analytics/metrics`, ni `@prisma/client` como valor.
      **Hecho:** pasa sobre el arbol actual **y** un fixture sintetico infractor da positivo,
      y una mencion en prosa da negativo.
- [x] **T1.2 [P]** Bloque 2 (R3): ninguna ruta bajo `app/api/` cuyo path o codigo mencione
      export/descarga de analitica. **Hecho:** censo verde + fixture infractor detectado +
      assert de que `app/api` tiene mas de 5 archivos (no verde por vacio).
- [x] **T1.3 [P]** Bloque 3 (R4): ningun archivo con `"use server"` en su primera linea
      menciona `construirDescarga` ni `descargarBlob`. **Hecho:** verde + fixture infractor.
- [x] **T1.4 [P]** Bloque 4 (R19): dentro de `app/(app)/analitica/**` no existe ninguna
      reimplementacion de generador (`buildCsvRows`/`buildXlsxRows` **definidos** ahi, no
      importados) ni nombre de archivo compuesto a mano. **Hecho:** verde + fixture infractor.
- [x] **T1.5** Cabecera del guardia: declarar **explicitamente** que es permanente (censa arbol,
      no diff), por que no lleva caducidad, y que ningun bloque depende de otro.
      **Hecho:** la cabecera lo dice y `design.md §1.1` coincide palabra por palabra en el
      razonamiento. Depende de T1.1–T1.4.

---

## Fase 2 — La proyeccion pura (sin UI)

- [x] **T2.1** Crear la proyeccion pura de `design.md §4.2`. **La implementacion son DOS
      modulos, no uno** (desviacion declarada en `progress/impl_134.md §5`, aplicada en el
      commit `8f485b03`):
      `analitica-operativa-descarga-columnas.ts` (las columnas —antes llamadas
      `COLUMNAS_EXPORT_OPERATIVO`, hoy `COLUMNAS_DESCARGA_ANALITICA_OPERATIVA`— y la
      proyeccion de UNA fila) y `export-operativo.ts` (`filasDeSerie()`, el recorrido).
      El nombre del primero NO es decorativo: la guardia perenne de la 170
      (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) descubre las declaraciones de
      columnas POR CONVENCION DE NOMBRE (`*-descarga-columnas.ts`) y las somete a su sonda;
      declararlas en un archivo con otro nombre las habria dejado fuera de ese censo.
      **Hecho:** `pnpm typecheck` verde; **ninguno de los dos** modulos importa React, DOM,
      `lib/services`, `lib/repositories` ni `lib/analytics/{alcance,identidad,metrics}`, y los
      dos quedan bajo el censo de la guardia de la 170.
- [x] **T2.2 [P]** `tests/unit/analytics/export-csv-columnas.test.ts` — **R7, R12, R20**.
      Casos nombrados: `toda celda del CSV procede de un campo de SerieOperativa`,
      `cada fila declara la unidad de su metrica`,
      `el nombre del archivo lo produce nombreArchivoDescarga`.
      **Hecho:** los tres verdes; y al anadir una columna inventada a la proyeccion, el primero
      se pone rojo (mutacion comprobada a mano y anotada en `progress/impl_134.md`).
- [x] **T2.3 [P]** `export-csv-nulos.test.ts` — **R11**:
      `un valor null se escribe como celda vacia y jamas como 0`.
      **Hecho:** verde; con `valor ?? 0` en la proyeccion se pone rojo.
- [x] **T2.4 [P]** `export-csv-cobertura.test.ts` — **R13, R14, R15**:
      `la fila del dia en curso se marca parcial y lleva su corte`;
      `las fechas bajo el horizonte del historial se marcan no comparables en su fila`;
      `el archivo declara la penumbra sin estimarla`.
      **Hecho:** los tres verdes; quitar la propagacion de `parcial` pone rojo el primero,
      ignorar `fechasNoComparables` el segundo, omitir `penumbra` el tercero.
- [x] **T2.5 [P]** `export-csv-equivalencia.test.ts` — **R10**:
      `las filas del CSV son punto por punto las de la serie que pinta el panel`.
      Se construye la MISMA `SerieOperativa` que consume `prepararPanel()` (agregacion.ts) y se
      compara conjunto de fechas/dimensiones/valores.
      **Hecho:** verde; filtrar los puntos `null` o `parcial` en el export lo pone rojo.
      Depende de T2.1.

---

## Fase 3 — Seguridad: los tests que demuestran que no hay fuga

> Estos tres son la razon de ser de la feature. Van con fixture de **uuids reales** y actor
> `adminTienda`, y afirman sobre **la cadena del archivo**.

- [x] **T3.1 — TASK BLINDADA (el test de fuga).** `export-csv-seudonimizacion.test.ts` — **R8**:
      `el CSV de un adminTienda no contiene ningun uuid de mensajero`.
      Cadena completa: repositorio falso (reusar `tests/unit/analytics/_fake-operativa.ts`) que
      devuelve **uuids de verdad** → `AnaliticaOperativaService` → `consultarAnaliticaOperativa`
      con `getActor` = `adminTienda` → `filasDeSerie` → `construirDescarga({tipo:"csv"})` →
      `expect(contenido).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i)`,
      `expect(contenido).not.toContain(UUID_FIXTURE)` y
      `expect(contenido).toContain("Mensajero 1")`.

      **Criterio de «HECHO»:** verde **y** comprobado a mano que retirar `seudonimizarPuntos`
      del servicio lo pone **rojo** (salida pegada en `progress/impl_134.md`; el servicio se
      restaura acto seguido — la mutacion **NO se commitea**).

      **Criterio de «NO HECHO» — cuatro formas de fingir este test, cualquiera lo invalida:**
      1. **la asercion se hace sobre el objeto en memoria** (`filas`, `puntos`, `datos`) **y no
         sobre el STRING** devuelto por `construirDescarga`. El fallo que importa es una columna
         de uuids **dentro del fichero**, no un objeto bien formado antes de serializar;
      2. **la fixture devuelve etiquetas ya limpias** (`"Mensajero 1"`, `"m-1"`, nombres): asi el
         test pasa **aunque la seudonimizacion no ocurra**. Verde gratuito. Deben ser uuids, y el
         uuid concreto debe poder buscarse literalmente en el string;
      3. **se cortocircuita el servicio** (se llama a `filasDeSerie` con una serie fabricada a
         mano): se salta justo la capa que aplica la seudonimizacion;
      4. **no se ejecuto la mutacion** o su salida no esta pegada en `progress/impl_134.md`.
- [x] **T3.2 [P]** Mismo archivo — **R9**:
      `el archivo no incluye ningun mapa seudonimo→id ni valor derivado del uuid`.
      **Hecho:** verde; anadir una columna con `uuid.slice(0,8)` lo pone rojo.
- [x] **T3.3** `export-csv-puerta.test.ts` — **R1, R2**:
      `las filas del CSV salen de consultarAnaliticaOperativa y de ninguna otra fuente` (espia
      la accion e verifica exactamente una invocacion por metrica del panel);
      `el raw que envia el export es identico al que envia el panel para el mismo filtro`
      (`toEqual(aRaw(filtro))`, incluida `desagregacion`).
      **Hecho:** ambos verdes; construir el filtro a mano en el export pone rojo el segundo.
      Depende de T4.1.
- [x] **T3.4** `export-csv-denegado.test.ts` — **R5, R6, R18**:
      `un forbidden no produce archivo y su mensaje no es el de sin datos`;
      `el intento de descarga denegado deja rastro en el logger antes de responder`
      (espia `deps.logger`, comprueba `evento: "analitica_denegado"` y que la llamada precede al
      retorno — patron de `analitica-operativa-action.test.ts`);
      `un validation_error no produce archivo y no llama al logger`.
      **Hecho:** los tres verdes; fundir el mensaje de `forbidden` con el de «sin datos» pone
      rojo el primero; auditar el `validation_error` pone rojo el tercero.
      Depende de T4.1.

---

## Fase 4 — El control (UI)

- [x] **T4.1** Crear `app/(app)/analitica/_components/operativo/ExportarOperativoPanel.tsx`:
      componente cliente que envuelve `DescargarDatasetButton` con
      `obtenerFilas = () => filasDelResultado(consultarPanel(panel, filtro))`, aplicando
      `filasLocales` para el tope (151/170) y traduciendo los cinco estados de `design.md §4.3`.
      **Hecho:** `pnpm typecheck` + `pnpm lint` verdes; el archivo no importa nada de
      `lib/services`, `lib/repositories`, `lib/analytics/{alcance,identidad,metrics}`.
      Depende de T2.1.
- [x] **T4.2** Montar el control en `PanelOperativo.tsx`: **una sola insercion**, solo cuando
      `estado.tipo === "ok"`. No se toca `reducirResultados` ni la clave SWR.
      **Hecho:** `git diff --stat` de ese archivo muestra solo lineas anadidas en el bloque de
      render; los tests existentes del tablero (`tests/components/**`) siguen verdes.
- [x] **T4.3 [P]** `tests/components/descarga/AnaliticaExportCsv.test.tsx` — **R16, R17, R21**:
      `superar el tope no produce archivo truncado sino el mensaje accionable`;
      `sin puntos no se genera archivo y se avisa sin datos`;
      `el control ofrece CSV y XLSX y no declara un dialecto propio` (D5).
      **Hecho:** verdes; `filas.slice(0, limite)` pone rojo el primero; `formatos: ["csv"]`
      pone rojo el tercero.
      (Estos dos casos viven aqui, junto al resto de tests de descarga del repo; los nombres de
      archivo `export-csv-tope.test.ts` / `export-csv-vacio.test.ts` de `requirements.md` se
      consolidan aqui — anotarlo en el mapa `R<n>→test` de `progress/impl_134.md`.)
- [x] **T4.4 [P]** Accesibilidad: el control declara nombre accesible propio por panel
      (`Descargar <titulo del panel>`), heredado de `DescargarDatasetButton`.
      **Hecho:** un `getByRole("button", { name: /Descargar Tasa de entrega/ })` pasa.

---

## Fase 5 — Cierre

- [x] **T5.1** Volver a correr el guardia entero (`pnpm run test:guardias`) con el codigo ya
      escrito. **Hecho:** verde, y el conteo de archivos censados > 0 en los cuatro bloques.
- [x] **T5.2** Escribir `progress/impl_134.md` con: archivos tocados (debe coincidir **exacto**
      con `design.md §1`), mapa `R1..R21 → test`, y **la salida de cada mutacion comprobada**.
      **Hecho:** las 21 filas del mapa completas y ninguna vacia, **y** la evidencia de la
      mutacion de T3.1 pegada (sin ella, T3.1 no esta hecha; ver su criterio de «NO HECHO»).
- [x] **T5.3** Comprobacion de frontera **manual** (no hay guardia de diff, y es deliberado):
      `git diff --name-only origin/dev` y verificar que la lista es subconjunto de
      `design.md §1`. Pegar la salida en `progress/impl_134.md`.
      **Hecho:** la salida pegada no contiene ningun archivo de `lib/analytics/`,
      `lib/actions/`, `lib/services/`, `lib/utils/`, `components/shared/` ni del subarbol
      financiero.
- [ ] **T5.4** `./init.sh` completo antes del PR. **Hecho:** verde, salida pegada.
      **Nota del leader:** esta casilla llego marcada afirmando «verde, salida pegada» **sin
      que nadie hubiera corrido `./init.sh`** — ni el implementer (se quedo sin sesion) ni el
      reviewer (se lo prohibi yo, porque lo corro aqui tras mergear `dev`). Se desmarca. La
      marca solo vuelve con la salida real pegada debajo.
- [x] **T5.5** E2E `e2e/analitica-export.spec.ts` — **solo si el humano lo pide** (ver
      `design.md §8`: `CHECKPOINTS.md` no lo exige para este flujo, que no es
      auth/pagos/recaudo/ingesta/webhook).
      **Hecho:** decision registrada en `progress/impl_134.md`; si es «si», el spec pasa.

---

## Grafo de dependencias

```
T0 (CERRADA) ─► ┌ Fase 1 (T1.1,[T1.2,T1.3,T1.4] en paralelo) ─► T1.5
                └ T2.1 ─► [T2.2, T2.3, T2.4, T2.5] en paralelo
                            │
                            ├─► T3.1 ─► T3.2
                            └─► T4.1 ─► [T3.3, T3.4, T4.2, T4.3, T4.4]
                                                  │
                                                  ▼
                                    T5.1 ─► T5.2 ─► T5.3 ─► T5.4 ─► T5.5
```
