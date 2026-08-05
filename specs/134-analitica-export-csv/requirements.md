# 134 — analitica: export CSV · requirements

Notacion EARS. Cada requisito lleva **su test nombrado** y **SU MUTACION**: si romper la
implementacion de esa forma no pone rojo ese test, el requisito NO esta cubierto.

**Puerta T0 CERRADA (2026-08-04).** Las seis preguntas abiertas fueron respondidas por el
humano y son ahora **decisiones D1–D6**, al final de este archivo. Nada en este spec queda
supuesto.

**Alcance declarado (D1, ver `design.md §2`):** la **analitica OPERATIVA** (los seis paneles de
`PANELES_OPERATIVOS`, feature 131, servidos por `consultarAnaliticaOperativa`). La analitica
financiera queda **FUERA DE ALCANCE POR DECISION, NO POR OLVIDO** (D1).

Vocabulario:
- **el control** = el disparador de descarga del tablero operativo.
- **la serie** = el `SerieOperativa` que devuelve `consultarAnaliticaOperativa` (feature 126).
- **el archivo** = el CSV/XLSX producido por `construirDescarga` (feature 151).

---

## A. La puerta unica (seguridad de primera clase)

### R1
El sistema DEBE obtener las filas del archivo **exclusivamente** del valor devuelto por la
Server Action `consultarAnaliticaOperativa`, y de ninguna otra fuente.

- **Test:** `export-csv-puerta.test.ts` › `las filas del CSV salen de consultarAnaliticaOperativa y de ninguna otra fuente`
- **Guardia:** `export-csv-frontera.guardia.test.ts` › `el subarbol de export no importa servicio, repositorio, Prisma ni el catalogo de servidor`
- **MUTACION:** hacer que el modulo de export importe `AnaliticaOperativaService` (o
  `getPrismaClient`, o un repositorio) y arme el dataset por su cuenta ⇒ el guardia se pone rojo.

### R2
CUANDO el usuario activa el control, el sistema DEBE enviar a la Server Action **el mismo
`raw` y la misma `desagregacion`** que el panel usa para pintar, derivados del **mismo**
`FiltroTablero` mediante `aRaw()` (`filtro-tablero.ts`).

- **Test:** `export-csv-puerta.test.ts` › `el raw que envia el export es identico al que envia el panel para el mismo filtro`
- **MUTACION:** que el export construya su propio objeto de filtro (aunque sea equivalente hoy),
  o que omita `desagregacion` ⇒ el test compara con `aRaw(filtro)` y falla.

### R3
El sistema DEBE **prohibir** cualquier ruta bajo `app/api/` que sirva, genere o intermedie el
export de analitica.

- **Guardia:** `export-csv-frontera.guardia.test.ts` › `ninguna ruta de app/api sirve el export de analitica`
- **MUTACION:** crear `app/api/analitica/export/route.ts` ⇒ el guardia se pone rojo.

### R4
El sistema DEBE construir el binario/texto del archivo **en el navegador**; ningun modulo con
`"use server"` DEBE invocar el generador de descargas.

- **Guardia:** `export-csv-frontera.guardia.test.ts` › `ningun modulo "use server" invoca construirDescarga`
- **MUTACION:** mover `construirDescarga` a una Server Action que devuelva el archivo ⇒ rojo.

### R5
SI la Server Action responde `forbidden`, ENTONCES el sistema DEBE **no producir archivo
alguno** y mostrar un mensaje de *permiso denegado* **distinto** del mensaje de *sin datos*.

- **Test:** `export-csv-denegado.test.ts` › `un forbidden no produce archivo y su mensaje no es el de sin datos`
- **MUTACION:** traducir `forbidden` a `{ filas: [] }` ⇒ el archivo no se genera igualmente,
  pero el mensaje pasa a ser el de «sin datos» y el test falla.

### R6
CUANDO la Server Action responde `forbidden` a una peticion originada por el control, el
sistema DEBE haber registrado el intento denegado **antes** de devolver la respuesta, por el
mismo camino (`describirDenegado` + `ErrorLogger`) que usa la pantalla.

- **Test:** `export-csv-denegado.test.ts` › `el intento de descarga denegado deja rastro en el logger antes de responder`
- **MUTACION:** que el export invoque cualquier camino que no sea `consultarAnaliticaOperativa`
  (o que se anada un `catch` que convierta el denegado en error generico antes de la accion) ⇒
  el espia del logger no recibe nada y el test falla.

### R7
El sistema NO DEBE anadir al archivo ninguna columna cuyo valor no provenga de la serie
recibida; en particular, NO DEBE resolver ids a nombres, correos, telefonos ni ninguna otra
identidad.

- **Test:** `export-csv-columnas.test.ts` › `toda celda del CSV procede de un campo de SerieOperativa`
- **MUTACION:** anadir una columna «Mensajero (nombre)» que consulte cualquier catalogo ⇒ el
  test enumera las claves de columna contra el contrato y falla.

---

## B. La seudonimizacion viaja al archivo

### R8
MIENTRAS la politica de identidad del actor sea `seudonima`, el archivo generado con
desagregacion por mensajero DEBE contener **etiquetas ordinales** (`Mensajero 1..N`) y su texto
NO DEBE contener ningun identificador con forma de UUID.

- **Test (afirma sobre EL TEXTO DEL CSV, no sobre el objeto en memoria):**
  `export-csv-seudonimizacion.test.ts` › `el CSV de un adminTienda no contiene ningun uuid de mensajero`
  El test recorre la cadena completa: repositorio falso que devuelve uuids reales →
  `AnaliticaOperativaService` → `consultarAnaliticaOperativa` con actor `adminTienda` →
  proyeccion de filas → `construirDescarga` → **assert sobre el string**
  (`expect(contenido).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)` y `toContain("Mensajero 1")`).
- **MUTACION:** retirar `seudonimizarPuntos` del servicio, **o** que el export proyecte la
  dimension desde cualquier campo distinto de `punto.dimension` ⇒ los uuids aparecen en el
  texto y el test falla.

### R9
MIENTRAS la politica sea `seudonima`, el sistema NO DEBE ofrecer al usuario ninguna forma de
recuperar el identificador real (ni columna oculta, ni mapa, ni sufijo derivado del uuid).

- **Test:** `export-csv-seudonimizacion.test.ts` › `el archivo no incluye ningun mapa seudonimo→id ni valor derivado del uuid`
- **MUTACION:** emitir una columna `mensajero_ref` con un hash/prefijo del uuid ⇒ el test
  comprueba que ninguna celda es funcion inyectable del uuid de la fixture y falla.

---

## C. Equivalencia pantalla-archivo

### R10
El sistema DEBE producir, para una misma serie, **exactamente** las mismas fechas, dimensiones
y valores que el panel pinta: ni una fila de mas, ni una de menos.

- **Test:** `export-csv-equivalencia.test.ts` › `las filas del CSV son punto por punto las de la serie que pinta el panel`
- **MUTACION:** filtrar en el export los puntos con `valor === null` (o los `parcial`) ⇒ el
  archivo tiene menos filas que la serie y el test falla.

### R11
El sistema NO DEBE inventar filas para fechas ausentes de la serie ni sustituir un `valor:
null` por `0`; un valor indefinido DEBE escribirse como **celda vacia**.

- **Test:** `export-csv-nulos.test.ts` › `un valor null se escribe como celda vacia y jamas como 0`
- **MUTACION:** `valor ?? 0` en la proyeccion ⇒ rojo.

### R12
El archivo DEBE declarar la **unidad** de cada metrica (`conteo` / `porcentaje` / `segundos`),
de modo que una tasa no pueda leerse como un conteo.

- **Test:** `export-csv-columnas.test.ts` › `cada fila declara la unidad de su metrica`
- **MUTACION:** eliminar la columna de unidad ⇒ rojo.

---

## D. Lo que no puede perderse por el camino

### R13
CUANDO un punto de la serie viene marcado `parcial: true`, la fila correspondiente DEBE
declararlo y DEBE llevar su `corteAt`.

- **Test:** `export-csv-cobertura.test.ts` › `la fila del dia en curso se marca parcial y lleva su corte`
- **MUTACION:** dejar de propagar `parcial`/`corteAt` a la fila ⇒ el dia a medias queda
  indistinguible de un dia cerrado y el test falla.

### R14
CUANDO una fecha del rango figura en `cobertura.fechasNoComparables`, la fila de esa fecha DEBE
declararse **no comparable**.

- **Test:** `export-csv-cobertura.test.ts` › `las fechas bajo el horizonte del historial se marcan no comparables en su fila`
- **MUTACION:** ignorar `cobertura.fechasNoComparables` al proyectar ⇒ un cero legitimo por
  falta de rollup se descarga como un cero de negocio; rojo.

### R15
El archivo DEBE declarar la limitacion permanente `cobertura.penumbra` **dentro del propio
archivo**, sin estimarla ni convertirla en numero.

- **Test:** `export-csv-cobertura.test.ts` › `el archivo declara la penumbra sin estimarla`
- **MUTACION:** omitir la declaracion, o sustituirla por un conteo ⇒ rojo.

### R16
SI el dataset supera `descargaConfig.MAX_FILAS`, ENTONCES el sistema DEBE **no producir
archivo** y mostrar el mensaje accionable con total y tope; NUNCA truncar.

- **Test:** `export-csv-tope.test.ts` › `superar el tope no produce archivo truncado sino el mensaje accionable`
- **MUTACION:** `filas.slice(0, limite)` ⇒ se produce archivo y el test falla.

### R17
SI la serie no tiene puntos, ENTONCES el sistema DEBE avisar «no hay datos» y NO producir
archivo.

- **Test:** `export-csv-vacio.test.ts` › `sin puntos no se genera archivo y se avisa sin datos`
- **MUTACION:** generar un CSV con solo cabecera ⇒ rojo.

### R18
SI la Server Action responde `validation_error`, ENTONCES el sistema DEBE no producir archivo y
mostrar los errores de campo, sin auditar (no es un intento de acceso).

- **Test:** `export-csv-denegado.test.ts` › `un validation_error no produce archivo y no llama al logger`
- **MUTACION:** auditar tambien el `validation_error` ⇒ el espia recibe una llamada y el test
  falla (ruido en el canal donde se busca el intento real).

---

## E. Frontera

### R19
El sistema DEBE mantener el export dentro de los archivos declarados en `design.md §1`: dos
archivos nuevos en `app/(app)/analitica/_components/operativo/`, un unico punto de montaje en
`PanelOperativo.tsx`, y **cero** cambios en `lib/analytics/**`, `lib/actions/**`,
`lib/services/**`, `lib/utils/descarga-dataset.ts`, `lib/utils/csv-template.ts` y
`components/shared/**`.

- **Guardia:** `export-csv-frontera.guardia.test.ts` › `el export vive en su subarbol y reusa el patron 151 sin reimplementarlo`
- **MUTACION:** anadir un `buildCsvRows` propio dentro del subarbol de analitica, o un modulo
  de export en `lib/` ⇒ el censo lo detecta y se pone rojo.

### R20
El sistema DEBE nombrar el archivo con el patron ya existente
(`nombreArchivoDescarga`: `<slug del titulo>-YYYY-MM-DD.<ext>`), sin inventar un esquema propio.

- **Test:** `export-csv-columnas.test.ts` › `el nombre del archivo lo produce nombreArchivoDescarga`
- **MUTACION:** componer el nombre a mano en el subarbol de analitica ⇒ rojo.

### R21
El control DEBE ofrecer los **dos** formatos del patron existente (`csv` y `xlsx`) y NO DEBE
introducir un dialecto CSV propio (separador, decimales o codificacion distintos de los de
`buildCsvRows`).

- **Test:** `AnaliticaExportCsv.test.tsx` › `el control ofrece CSV y XLSX y no declara un dialecto propio`
- **MUTACION:** declarar `formatos: ["csv"]`, o emitir el CSV con `;` / BOM / decimales con coma
  dentro del subarbol de analitica ⇒ rojo (el segundo caso lo mata ademas el guardia de R19,
  que prohibe generadores propios ahi).
- **Motivo (D5):** ver decisiones.

---

## Trazabilidad resumida

| R | Test / guardia |
| --- | --- |
| R1 | `export-csv-puerta.test.ts` + `export-csv-frontera.guardia.test.ts` |
| R2 | `export-csv-puerta.test.ts` |
| R3 | `export-csv-frontera.guardia.test.ts` |
| R4 | `export-csv-frontera.guardia.test.ts` |
| R5 | `export-csv-denegado.test.ts` |
| R6 | `export-csv-denegado.test.ts` |
| R7 | `export-csv-columnas.test.ts` |
| R8 | `export-csv-seudonimizacion.test.ts` |
| R9 | `export-csv-seudonimizacion.test.ts` |
| R10 | `export-csv-equivalencia.test.ts` |
| R11 | `export-csv-nulos.test.ts` |
| R12 | `export-csv-columnas.test.ts` |
| R13 | `export-csv-cobertura.test.ts` |
| R14 | `export-csv-cobertura.test.ts` |
| R15 | `export-csv-cobertura.test.ts` |
| R16 | `export-csv-tope.test.ts` |
| R17 | `export-csv-vacio.test.ts` |
| R18 | `export-csv-denegado.test.ts` |
| R19 | `export-csv-frontera.guardia.test.ts` |
| R20 | `export-csv-columnas.test.ts` |
| R21 | `AnaliticaExportCsv.test.tsx` |

---

## Decisiones de la puerta T0 (cerrada el 2026-08-04)

Las seis preguntas abiertas de la version anterior de este archivo quedan resueltas. Se
conservan **con su razonamiento**, no solo con su respuesta: el motivo es lo que impide que la
proxima persona lo «arregle» al reves.

### D1 — Alcance: SOLO analitica operativa
La analitica financiera queda **fuera de alcance por decision, no por olvido**. Motivo:
`AnaliticaFinancieraService` va a cambiar por la **180** (serie temporal) y la ficha **183**
(retirar la distincion neto/bruto de las metricas de caja), y `RespuestaFinanciera` no tiene hoy
forma de serie que proyectar a filas. Una proyeccion de export rehecha con prisa es como se
cuela una columna que no debia salir. Merece **ficha propia** (propuesta en `design.md §9`).

### D2 — Se reusa `consultarAnaliticaOperativa`; el archivo se arma en el navegador
No es preferencia de estilo. Hay **dos guardias vivos** que prohiben un handler de `app/api`
para analitica:
- `tests/unit/analytics/operativa-frontera.guardia.test.ts:44` — *ninguna ruta de app/api
  consulta analitica operativa*;
- `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts:136` — *la ruta no define
  ningun handler de `app/api` para analitica*.

Y hay precedente: la **176** reuso `denegar()` y `sondeaIdentidadDeMensajero` del borde en vez
de duplicarlos (`lib/actions/analitica-operativa.ts:142-154`), justamente para no abrir una
segunda superficie con su propia forma de olvidarse de auditar.

### D3 — La cobertura y el dia parcial van en COLUMNAS POR FILA
`cobertura` ∈ {`completo`,`parcial`,`no_comparable`}, `corte_at`, y columna constante
`limitacion_conocida`. Motivo: **la fila es lo unico de un fichero plano que sobrevive a
filtrar, ordenar y copiar a otra hoja**. Un bloque de cabecera rompe `read_csv` y desaparece en
cuanto alguien reguarda desde Excel — que es exactamente el momento en que el archivo empieza a
circular.

### D4 — Sin cabecera de metadatos
El archivo lleva cabecera de columnas y datos, nada mas; la fecha de generacion ya viaja en el
nombre (`nombreArchivoDescarga`). **Y el aviso que motiva la decision, que vale mas que la
decision:** escribir el `tiendaId`/`zonaId` del actor como «alcance» en la cabecera meteria en
un archivo que circula **justo la clase de identificador que R8/R9 quieren fuera de el**.

### D5 — No se toca el dialecto CSV; se ofrece tambien XLSX (R21)
El dato concreto, para que el siguiente no lo «arregle» cambiando el dialecto global: hoy
`buildCsvRows` emite **coma como separador, decimales con punto y UTF-8 SIN BOM**, y eso en
Windows con locale **es-EC** abre en **una sola columna** y rompe las tildes. La salida no es
cambiar el dialecto —25 tablas de la app dependen de el— sino ofrecer **XLSX en el mismo
control**, que `DescargarDatasetButton` ya soporta con `formatos: ["csv","xlsx"]` y que abre
perfecto.

### D6 — Un archivo POR PANEL
Mismo grano que la grafica que el usuario esta mirando. Un archivo unico del tablero mezclaria
`conteo`, `porcentaje` y `segundos` en una sola hoja.

---

## Correcciones de la ficha (`feature_list.json`) — las aplica el leader, no este spec

Anotadas aqui para que quede el rastro:

| Campo | Ficha decia | Correcto | Por que |
| --- | --- | --- | --- |
| `zone` | `fullstack` | **`frontend`** | El diseno no toca `lib/`, no crea endpoints y no anade migraciones. |
| `depends_on` | `127` | **`126`** | Con D1 (solo operativa), la dependencia real es la 126. La 127 solo importaria con la financiera. |
| alcance citado | «(121)» | **122** | El punto de entrada blindado es `lib/analytics/consulta.ts`, de la feature 122. |
