# 184 — analitica financiera: export de la serie · requirements

> Rama: `feature/184-analitica-financiera-export`, cortada de `origin/dev` @ `80aa3721`.
> Todo hecho de inventario citado aqui se leyo en el arbol de `C:/w184`. No se cita ninguna
> otra sesion.

Notacion EARS. Cada requisito lleva **su test nombrado** y **SU MUTACION**: si romper la
implementacion de esa forma no pone rojo ese test, el requisito NO esta cubierto. Es la
convencion de la **134**, que esta feature hereda entera.

> ✅ **PUERTA T0 CERRADA (2026-08-08).** Las seis preguntas abiertas fueron respondidas por el
> humano, todas con la recomendacion, y son ahora las **decisiones D1–D6** del final de este
> archivo, **conservadas con su motivo**. Nada aqui queda supuesto y ningun requisito queda
> condicionado a una respuesta futura: los requisitos estan **afirmados**. Ninguna decision se
> reabre sin una decision humana nueva y fechada.

---

## 0. Contexto heredado (no se reabre)

- **Esta feature es la ficha propuesta en `specs/134-analitica-export-csv/design.md` §9.** La
  analitica financiera quedo fuera de la 134 **por decision (D1), no por olvido**. Las garantias
  de la 134 no se renegocian aqui: se **replican** sobre otro borde. La correspondencia esta
  en la tabla de §1.
- **Sus dos dependencias ya aterrizaron y estan en este arbol.** Verificado leyendo el codigo,
  no la ficha:
  - la **180** publica la serie: `AnaliticaFinancieraService` construye `serieDensa(...)` y
    declara `granularidad: granularidadDe(consulta.rango)` en las vistas temporales
    (`lib/services/AnaliticaFinancieraService.ts:182,360-361,421-422,598`), y las no temporales
    declaran `"no_temporal"` (`:456,480,510`). **La forma de serie es estable y proyectable a
    filas TAL CUAL: esta feature NO tiene que tocar el servicio, y por eso `zone: frontend` se
    sostiene.**
  - la **183** cambio que significan las cifras: `ImporteAnalitico` es una **union discriminada**
    `ImporteConNeto | ImporteSoloBruto` por campo `forma`
    (`lib/types/analitica-financiera.ts:73-101`). `ingreso_flete`, `ingreso_comision_cod` e
    `ingreso_iva` publican **solo bruto**; `egresos` conserva los dos y su `neto` significa ahora
    *lo que realmente salio de caja* (`specs/183-analitica-neto-bruto-caja/requirements.md` §1).
    **El export no puede etiquetar columnas con la semantica vieja neto/bruto:** ver R13/R14.
- **El alcance por rol es frontera de seguridad (122/127).** Las diez financieras son `total`
  para `maestro`/`admin` y `prohibido` para los otros tres roles; la region financiera solo se
  renderiza para `esAccesoTotal(actor.rol)` (`app/(app)/analitica/page.tsx:94`,
  `lib/auth/acceso-total.ts:5`). Esta feature **no toca** ese gate ni escribe una lista de roles.
- **El borde ya audita en el orden correcto.** `consultarMetricaFinanciera` llama
  `logger.logError(describirDenegado(...))` y **despues** devuelve `{status:"forbidden"}`
  (`lib/actions/analitica-financiera.ts:99-110`), con la trampa del 403 mudo documentada en
  `:32-35`. Esta feature hereda ese orden **por no escribir borde propio**, y lo prueba (R7).
- **El patron de descarga es el de la 151 (+148 +170) y se reusa entero**, sin generador ni
  dialecto propios: `lib/types/descarga.ts`, `lib/utils/csv-template.ts` (`buildCsvRows`),
  `lib/utils/descarga-dataset.ts` (`construirDescarga`, `nombreArchivoDescarga`),
  `components/shared/DescargarDatasetButton.tsx`, `components/shared/descargar-blob.ts`,
  `components/shared/descarga-resultado.ts` (`filasLocales`, tope unico).
- **La 189 (`done`) no impone un «Anexo A» a esta feature.** Verificado en `progress/impl_189.md`:
  fija clave, encabezado y **orden** de 12 constantes ya existentes, ninguna de analitica. Lo que
  SI deja es el **molde** que esta feature adopta (R29): dos aserciones por constante —clave y
  encabezado— con el esperado **escrito a mano**, nunca `COLUMNAS.map(...)` a los dos lados.

### ⚠️ Aviso de numeracion: «184» en el codigo NO es esta feature

`specs/188-deuda-170-listados-completos/requirements.md:3-24` lo declara: aquella ficha **era la
184** y se renumero a **188**. Hoy hay 111 archivos que citan `Feature 184 — …` en comentarios,
una constante `PENDIENTES_184`, 60 mensajes de commit y un bloque en
`components/shared/descarga-resultado.ts:99` («RETIRADO por la feature 184 (T H.2)») que hablan
de **la 188**, no de esta. **Ningun artefacto de esta feature debe rotularse solo con el numero:**
los comentarios de cabecera escriben `Feature 184 — analitica financiera: export de la serie`.

---

## 1. Las garantias de la 134 que se replican, una por una

| Garantia de la 134 | Su requisito alli | Aqui |
|---|---|---|
| Puerta unica: las filas salen del mismo punto de entrada que la pantalla | R1 | **R1** |
| El mismo filtro que la pantalla, sin reconstruirlo | R2 | **R2** |
| Cero rutas de `app/api` para el export de analitica | R3 | **R3** |
| El archivo se arma en el navegador; ningun `"use server"` llama al generador | R4 | **R4** |
| `forbidden` ⇒ sin archivo y mensaje distinto del de «sin datos» | R5 | **R6** |
| El denegado se audita **ANTES** de responder, por el mismo camino que la pantalla | R6 | **R7** |
| `validation_error` ⇒ sin archivo y **sin** auditar | R18 | **R8** |
| Toda celda procede de un campo del DTO recibido; no se resuelve ningun id | R7 | **R11** |
| Ningun identificador de persona/entidad en el archivo | R8/R9 | **R10**, **R12** |
| Equivalencia pantalla-archivo: ni una fila de mas ni de menos | R10 | **R19** |
| `null` jamas se sustituye por `0`; no se inventan filas | R11 | **R20** |
| La unidad/semantica de la cifra viaja en el archivo | R12 | **R15**, **R16**, **R17** |
| Sin datos ⇒ aviso y ningun archivo | R17 | **R21** |
| Tope ⇒ sin archivo y mensaje accionable, nunca truncar | R16 | **R22** |
| Frontera de archivos declarada | R19 | **R23** |
| Nombre por `nombreArchivoDescarga` | R20 | **R24** |
| CSV **y** XLSX, sin dialecto propio | R21 | **R25** |
| **SIN cabecera de metadatos con el alcance del actor** | D4 | **R10** (+ guardia) |

Vocabulario de este documento:

- **el borde** = la Server Action `consultarMetricaFinanciera` (`lib/actions/analitica-financiera.ts`).
- **la vista** = una `VistaFinanciera` del `ResultadoFinancieroVistas` que devuelve el borde.
- **la vista temporal** = aquella cuya `granularidad` no niega la serie (`esVistaTemporal`,
  `app/(app)/analitica/_components/financiero/adaptar.ts:226`).
- **el control** = el disparador de descarga de UNA vista temporal.
- **el archivo** = el CSV/XLSX que produce `construirDescarga` (151).

---

## 2. Requisitos

### A. La puerta unica (seguridad de primera clase)

#### R1
El sistema DEBE obtener las filas del archivo **exclusivamente** del valor devuelto por el borde
`consultarMetricaFinanciera`, y de ninguna otra fuente.

- **Test:** `export-financiero-puerta.test.ts` › `las filas del archivo salen de consultarMetricaFinanciera y de ninguna otra fuente`
- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `el subarbol de export no importa servicio, repositorio, Prisma, next/headers ni el resolutor de actor`
- **MUTACION:** que el subarbol importe `AnaliticaFinancieraService`, `getPrismaClient`, un
  repositorio o `resolveActorFromSession` y arme el dataset por su cuenta ⇒ el guardia se pone rojo.

#### R2
CUANDO el usuario activa el control, el sistema DEBE enviar al borde **el mismo `metricaId` que
rotula la seccion** y **el mismo objeto de filtro** que la pantalla usa para pintar
(`FILTRO_FINANCIERO_POR_DEFECTO`, `app/(app)/analitica/_components/financiero/rango.ts:29`),
y NO DEBE construir un filtro propio ni escribir ningun preset ni ninguna fecha.

- **Test:** `export-financiero-puerta.test.ts` › `el filtro que envia el export es el MISMO objeto que usa la pantalla, no uno equivalente`
  (asercion de **identidad referencial**, `toBe`, contra la constante importada; no `toEqual`).
- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `el subarbol de export no escribe ningun preset de rango ni ninguna fecha`
- **MUTACION:** sustituir el argumento por un literal `{ rango: "mes" }` —hoy equivalente— ⇒ el
  `toBe` falla y el guardia detecta el preset escrito a mano.

#### R3
El sistema DEBE **prohibir** cualquier ruta bajo `app/api/` que sirva, genere o intermedie el
export de analitica financiera.

- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `ninguna ruta de app/api sirve el export de analitica financiera`
- **MUTACION:** crear `app/api/analitica/financiera/export/route.ts` ⇒ rojo.

#### R4
El sistema DEBE construir el binario/texto del archivo **en el navegador**; ningun modulo con
`"use server"` DEBE invocar el generador de descargas.

- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `ningun modulo "use server" invoca construirDescarga`
- **MUTACION:** mover la generacion a una Server Action que devuelva el archivo ⇒ rojo.

#### R5
El sistema NO DEBE pasar al borde su tercer argumento (`deps`) desde codigo de produccion: el
actor lo resuelve siempre el borde.

- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `produccion invoca el borde con dos argumentos: la inyeccion es solo de tests`
- **MUTACION:** pasar `{ getActor }` desde el control ⇒ el guardia lo detecta (y seria una segunda
  autoridad sobre «quien eres», lo que R9 de la 132 prohibe en `cargar.ts:10-14`).

#### R6
SI el borde responde `forbidden`, ENTONCES el sistema DEBE **no producir archivo alguno** y
mostrar un mensaje de *permiso denegado* **distinto** del mensaje de *sin datos*.

- **Test:** `export-financiero-denegado.test.ts` › `un forbidden no produce archivo y su mensaje no es el de sin datos`
- **MUTACION:** traducir `forbidden` a `{ filas: [] }` ⇒ no hay archivo igualmente, pero el
  mensaje pasa a ser el de «sin datos» y el test falla.

#### R7
CUANDO el borde responde `forbidden` a una peticion originada por el control, el sistema DEBE
haber registrado el intento denegado **ANTES** de devolver la respuesta, por el mismo camino
(`describirDenegado` + `ErrorLogger`) que usa la pantalla.

- **Test:** `export-financiero-denegado.test.ts` › `el intento de descarga denegado deja rastro en el logger ANTES de responder`
  El test recorre el borde real con `deps` de test (actor de rol prohibido + logger espia) y
  afirma sobre una **secuencia compartida**: `["auditoria", "respuesta"]`, no solo sobre el
  numero de llamadas.
- **MUTACION 1:** invertir las dos sentencias del borde (responder y luego registrar) ⇒ la
  secuencia sale `["respuesta","auditoria"]` y el test falla.
- **MUTACION 2:** que el export envuelva la llamada en un `catch` que convierta el denegado en
  error generico antes de llegar al borde ⇒ el espia no recibe nada y el test falla.

#### R8
SI el borde responde `validation_error`, ENTONCES el sistema DEBE no producir archivo y mostrar
los errores de campo, **sin auditar** (no es un intento de acceso).

- **Test:** `export-financiero-denegado.test.ts` › `un validation_error no produce archivo y no llama al logger`
- **MUTACION:** auditar tambien el `validation_error` ⇒ el espia recibe una llamada y el test
  falla (ruido en el canal donde se busca el intento real).

#### R9
SI el borde responde `error`, ENTONCES el sistema DEBE no producir archivo y mostrar el mensaje
que el borde ya devolvio saneado, sin componer uno propio a partir del error original.

- **Test:** `export-financiero-denegado.test.ts` › `un error del borde no produce archivo y transporta el mensaje ya saneado`
- **MUTACION:** concatenar el texto del error original ⇒ el test compara con el mensaje del borde y falla.

### B. Nada del alcance del actor llega al archivo

#### R10
El archivo DEBE contener **unicamente** la cabecera de columnas declarada y sus filas de datos.
El sistema NO DEBE emitir cabecera de metadatos, ni ninguna celda o encabezado que contenga
`tiendaId`, `zonaId`, `mensajeroId`, el rol del actor ni ningun otro identificador de su alcance.

- **Guardia:** `export-financiero-alcance.guardia.test.ts` › `ninguna columna ni ninguna celda declara el alcance del actor`
  Tres bloques, cada uno con **autocomprobacion por fixture sintetico** (patron de
  `modulo-puro.guardia.test.ts` y de §1.1 de la 134): (a) censo del subarbol contra el vocabulario
  del alcance (`tiendaId`, `zonaId`, `mensajeroId`, `actor`, `alcance`, `rol`, `sesion`,
  `cookies`, `next/headers`); (b) el contrato de columnas comparado contra una lista escrita a
  mano; (c) el **TEXTO** del archivo producido por `construirDescarga` sobre un DTO fixture,
  comprobando que no aparece ninguna forma de uuid (`/[0-9a-f]{8}-[0-9a-f]{4}-/i`).
- **Herencia:** la guardia perenne de la 170
  (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) descubre el modulo **por convencion
  de nombre** y le aplica su sonda; no se reimplementa aqui (R26).
- **MUTACION:** anadir una fila o columna «Alcance: <tiendaId>» ⇒ (a) y (c) se ponen rojos.

#### R11
El sistema NO DEBE anadir al archivo ninguna celda cuyo valor no provenga de un campo del DTO
recibido, **con una unica excepcion nombrada: la columna `limitacion_conocida` de R30**. En
particular NO DEBE resolver ids a nombres, correos o telefonos, ni consultar catalogo alguno.

- **Test:** `export-financiero-columnas.test.ts` › `toda celda del archivo procede de un campo del DTO salvo la limitacion declarada`
  El caso enumera las celdas, comprueba el origen de todas y **nombra** la unica exenta: si
  aparecieran dos celdas sin origen en el DTO, falla.
- **MUTACION 1:** anadir una columna «Tienda (nombre)» que consulte cualquier catalogo ⇒ el test
  enumera las claves contra el contrato y falla; y el guardia de frontera (R1) marca el import.
- **MUTACION 2:** anadir una **segunda** celda de texto propio (por ejemplo un rotulo de alcance)
  ⇒ el test ve dos exentas donde declara una y falla. **La excepcion es de una, no una puerta.**

#### R12
El sistema DEBE producir archivo **solo** para vistas **temporales**. SI la vista referida no es
temporal, ENTONCES el sistema DEBE no producir archivo y decirlo.

> Este es el requisito que mantiene los **cubos por tienda** fuera del archivo mientras la ficha
> **181** no exista: hoy esos cubos viajan con el `tiendaId` **crudo**
> (`TableroFinanciero.tsx:22-24` lo declara en pantalla), y en una vista temporal la clave del
> cubo es una fecha por construccion (R24 de la 180). **La exclusion no es documental: es
> ejecutable.** Lo fija **D1**, y con el motivo escrito ahi: en (c)/(d) el archivo habria
> llevado el id crudo.

- **Test:** `export-financiero-alcance.guardia.test.ts` › `una vista no temporal no produce archivo aunque sus cubos vengan con identificadores`
  El fixture usa cubos con forma de uuid: si algun dia se produjera archivo, el test lo ve.
- **MUTACION:** aceptar cualquier vista con filas ⇒ el fixture produce un archivo con uuids y el test falla.

### C. La semantica del dinero, dicha en el archivo (180 + 183)

#### R13
El archivo DEBE publicar los importes con **la misma forma** que el DTO: donde el importe publica
`bruto` y `neto`, salen los dos; donde publica **solo `bruto`**, la columna de `neto` **NO DEBE
existir** en ese archivo —ni vacia, ni en cero, ni derivada del bruto—.

- **Test:** `export-financiero-forma.test.ts` › `una vista solo_bruto no emite ninguna columna de neto` y › `una vista bruto_y_neto emite las dos, distinguibles`
- **MUTACION:** `neto: importe.neto ?? importe.bruto` o una columna de neto vacia ⇒ rojo. Es
  literalmente R23 de la 183 trasladado al archivo: en la 132 la celda ausente significa «no se
  sabe» y aqui la verdad es «**no aplica**».

#### R14
El sistema NO DEBE decidir la forma del importe por el **id de la metrica**: la decide la `forma`
del DTO.

- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `el subarbol de export no decide por el id de ninguna metrica financiera`
  (mismo censo, y con los mismos ids importados, que
  `tests/unit/guards/tablero-financiero.guardia.test.ts` (f))
- **MUTACION:** `if (metricaId === "ingreso_flete")` ⇒ rojo. Es R22 de la 183.

#### R15
Cada fila DEBE declarar la **granularidad** del cubo al que corresponde (`dia` o `semana`), tomada
del DTO.

- **Test:** `export-financiero-grano.test.ts` › `cada fila declara el grano del cubo y una serie semanal no se escribe como diaria`
- **MUTACION:** eliminar la columna ⇒ una serie semanal descargada se lee como diaria y afirma
  **siete veces mas dinero por punto** (el defecto que la 186 documenta en `adaptar.ts:196-228`); rojo.

#### R16
Cada fila DEBE declarar si su metrica es **acumulada** (saldo al corte) o de **flujo**, tomandolo
de `esAcumulado` del DTO y no de una lista de ids.

- **Test:** `export-financiero-grano.test.ts` › `la fila de una metrica acumulada se declara saldo al corte y no movimiento del periodo`
- **MUTACION:** omitir la columna ⇒ el saldo al corte de la cuenta por pagar se descarga
  indistinguible de un flujo del periodo y se suma entre fechas; rojo.

#### R17
Cada fila DEBE declarar la **moneda** del importe, leida del propio importe. El sistema NO DEBE
escribir ningun simbolo de moneda, codigo ISO ni literal de idioma.

- **Test:** `export-financiero-columnas.test.ts` › `la moneda de cada fila sale del importe y no de un literal`
- **MUTACION:** escribir el codigo a mano ⇒ el test compara contra la fixture (que usa un codigo
  distinto del de produccion) y falla.

#### R18
El sistema DEBE escribir cada importe **tal cual llega**: cadena de escala 2. NO DEBE convertirlo
a `number`, redondearlo, reformatearlo ni anadirle separador de miles.

- **Test:** `export-financiero-columnas.test.ts` › `el importe se escribe literal, sin conversion a number ni reformateo`
- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `el subarbol de export no importa aNumero ni convierte dinero a number`
- **MUTACION:** proyectar con `aNumero(...)` ⇒ un importe con mas digitos que `2^53` cambia en el
  archivo y el guardia marca el import.
- **Coste declarado (D2):** en Excel con locale es-EC la columna puede llegar como **texto** y el
  usuario tiene que convertirla. Se acepta a cambio de no abrir una segunda frontera del dinero.

### D. Equivalencia pantalla-archivo

#### R19
El sistema DEBE producir, para una misma vista, **exactamente** las mismas filas que el DTO trae:
una por fila, en el orden recibido, ni una de mas ni una de menos.

- **Test:** `export-financiero-equivalencia.test.ts` › `las filas del archivo son fila por fila las del DTO que pinta la pantalla`
- **MUTACION:** filtrar los cubos con importe cero —la serie de la 180 es **densa** a proposito
  (⟨D3⟩)— ⇒ el archivo tiene menos filas y el test falla.

#### R20
El sistema NO DEBE inventar filas para cubos ausentes, ni ordenar, ni fusionar, ni agrupar la cola
en «Otros», ni sustituir ningun valor por `0`.

- **Test:** `export-financiero-equivalencia.test.ts` › `el export no reordena, no agrupa la cola ni rellena cubos`
- **MUTACION:** aplicar `agruparCola` ⇒ «Otros» no significa nada en un eje de tiempo y se comeria
  el final de la serie (⟨D7⟩ de la 186); rojo.

#### R21
SI la vista no tiene filas, ENTONCES el sistema DEBE avisar «no hay datos» y NO producir archivo.

- **Test:** `export-financiero-vacio.test.ts` › `sin filas no se genera archivo y se avisa sin datos`
- **MUTACION:** generar un archivo con solo cabecera ⇒ rojo (un archivo de cabecera sola se
  reenvia y se lee como «no hubo movimiento», que es otra afirmacion).

#### R22
SI el dataset supera `descargaConfig.MAX_FILAS`, ENTONCES el sistema DEBE **no producir archivo**
y mostrar el mensaje accionable con total y tope; NUNCA truncar. El tope DEBE ser el unico de la
app, aplicado por `filasLocales` (170).

- **Test:** `export-financiero-vacio.test.ts` › `superar el tope no produce archivo truncado sino el mensaje accionable`
- **MUTACION:** `filas.slice(0, limite)` o declarar un segundo tope ⇒ rojo.

### E. Frontera, reuso y montaje

#### R23
El sistema DEBE mantener el export dentro de los archivos declarados en `design.md` §1: **tres
archivos nuevos** en `app/(app)/analitica/_components/export-financiero/`, **una sola insercion**
en `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx`, y **cero** cambios en
`lib/**`, `components/shared/**`, `lib/utils/descarga-dataset.ts`, `lib/utils/csv-template.ts` y
el resto de `app/(app)/analitica/_components/financiero/**`.

- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `el export vive en su subarbol y reusa el patron 151 sin reimplementarlo`
- **MUTACION:** escribir un generador CSV propio o un modulo de export en `lib/` ⇒ el censo lo detecta.

#### R24
El sistema DEBE nombrar el archivo con el patron existente (`nombreArchivoDescarga`:
`<slug del titulo>-YYYY-MM-DD.<ext>`) a partir del **mismo titulo que rotula la seccion en
pantalla**, sin componer un esquema propio.

- **Test:** `AnaliticaFinancieraExport.test.tsx` › `el nombre del archivo lo produce nombreArchivoDescarga a partir del titulo de la seccion`
- **MUTACION:** componer el nombre a mano ⇒ rojo.

#### R25
El control DEBE ofrecer los **dos** formatos del patron existente (`csv` y `xlsx`) y NO DEBE
introducir un dialecto CSV propio (separador, decimales o codificacion distintos de los de
`buildCsvRows`).

- **Test:** `AnaliticaFinancieraExport.test.tsx` › `el control ofrece CSV y XLSX y no declara un dialecto propio`
- **MUTACION:** declarar `formatos: ["csv"]`, o emitir con `;`/BOM/decimales con coma ⇒ rojo (el
  segundo caso lo mata ademas el guardia de R23). **Motivo:** D5 de la 134 —el dialecto global no
  se toca porque ~25 tablas dependen de el; la salida es ofrecer XLSX en el mismo control—.

#### R26
El modulo que declara las columnas DEBE llamarse segun la convencion `*-descarga-columnas.ts`,
para quedar bajo el censo y la sonda de la guardia perenne de la 170.

- **Test:** `export-financiero-frontera.guardia.test.ts` › `el modulo de columnas sigue la convencion de nombre que la guardia de la 170 descubre`
  (contrapeso: ademas se comprueba que
  `tests/unit/descarga/columnas-sensibles.guardia.test.ts` **carga** el modulo nuevo)
- **MUTACION:** declarar las columnas en un archivo con otro nombre ⇒ quedarian fuera del censo de
  la 170 y este caso se pone rojo.

#### R27
El control DEBE renderizarse **solo** donde la region financiera se renderiza. El sistema NO DEBE
declarar ninguna lista de roles nueva ni ninguna condicion de permiso propia.

- **Guardia:** `export-financiero-frontera.guardia.test.ts` › `el subarbol de export no escribe ninguna lista de roles ni ninguna condicion de permiso`
- **Test:** `AnaliticaFinancieraExport.test.tsx` › `el control cuelga de la seccion de la vista y no se monta fuera de ella`
- **MUTACION:** un `if (rol === "maestro")` en el control ⇒ el censo de roles (mismo mecanismo que
  el censo (e) de `tablero-financiero.guardia.test.ts`) se pone rojo.

#### R28
El sistema NO DEBE pasar al control ninguna prop cuyo valor sea una funcion, y NO DEBE anadir la
directiva de cliente a ningun archivo de `app/(app)/analitica/_components/financiero/`.

- **Guardia (ya existente, debe seguir VERDE sin tocarlo):**
  `tests/unit/guards/tablero-financiero.guardia.test.ts` › `ningun archivo de la feature declara use client` y
  › `ningun archivo pasa avisoRecorte ni ninguna otra prop-funcion a un componente cliente`
- **MUTACION:** poner `"use client"` en `TableroFinanciero.tsx` (arrastraria el borde financiero y
  con el Prisma al bundle del navegador) o pasar `obtenerFilas={...}` desde el servidor (falla en
  **render**, no en compilacion) ⇒ el guardia vivo se pone rojo.

#### R29
La lista de columnas, sus encabezados y su **orden** DEBEN quedar fijados por un test con el
esperado **escrito a mano**, en los dos juegos de columnas (con neto y solo bruto).

- **Test:** `analitica-financiera-descarga-columnas.test.ts` › `las columnas con neto se declaran en su orden` y › `las columnas solo bruto se declaran en su orden`
- **MUTACION:** reordenar dos columnas o quitar una ⇒ rojo. Es el molde de la 189
  (`progress/impl_189.md` §1): **nunca** `COLUMNAS.map(...)` a los dos lados, que es la tautologia
  que este repo lleva semanas cazando.

### F. La limitacion declarada (D3)

#### R30
Cada fila DEBE llevar una columna `limitacion_conocida` con un **texto constante** que declare que
el **ultimo cubo del rango puede estar en curso**. El sistema NO DEBE estimar esa limitacion, NO
DEBE convertirla en un numero y NO DEBE calcular en el cliente cual es el cubo en curso.

> **Esta es la UNICA celda del archivo cuyo texto no sale del DTO, y esta puesta a proposito.**
> Se declara aqui, en R11 y en la cabecera del modulo de columnas para que la proxima persona no
> la borre creyendola un descuido. Existe porque Q2 de la 180 decidio —y sigue vigente— que el
> servicio **no marca** el cubo en curso: marcarlo exigiria inyectarle un reloj y romper su
> determinismo (R26 de la 180). Con los presets vigentes el `hasta` es el inicio del dia CR
> siguiente, asi que el ultimo cubo casi siempre esta a medias y **el DTO no lo dice**. Sin esta
> columna, un archivo circula con su ultimo punto por debajo de la realidad y nada lo advierte.
> Calcularlo en el cliente (la opcion descartada de D3) seria inventar la informacion que el
> servidor se nego a publicar **y** meter una segunda definicion del dia de Costa Rica en el
> navegador.

- **Test:** `export-financiero-grano.test.ts` › `todas las filas declaran la limitacion del ultimo cubo, con el mismo texto y sin estimarla`
- **MUTACION 1:** eliminar la columna ⇒ rojo.
- **MUTACION 2:** sustituir el texto por una marca calculada `parcial: true/false` por fila ⇒ el
  caso comprueba que **todas** las filas llevan el mismo valor constante y falla; y el guardia de
  frontera marca el `Date`/reloj introducido en el subarbol.

---

## 3. Trazabilidad resumida

| R | Test / guardia |
| --- | --- |
| R1 | `export-financiero-puerta.test.ts` + `export-financiero-frontera.guardia.test.ts` |
| R2 | `export-financiero-puerta.test.ts` + `export-financiero-frontera.guardia.test.ts` |
| R3 | `export-financiero-frontera.guardia.test.ts` |
| R4 | `export-financiero-frontera.guardia.test.ts` |
| R5 | `export-financiero-frontera.guardia.test.ts` |
| R6 | `export-financiero-denegado.test.ts` |
| R7 | `export-financiero-denegado.test.ts` |
| R8 | `export-financiero-denegado.test.ts` |
| R9 | `export-financiero-denegado.test.ts` |
| R10 | `export-financiero-alcance.guardia.test.ts` |
| R11 | `export-financiero-columnas.test.ts` |
| R12 | `export-financiero-alcance.guardia.test.ts` |
| R13 | `export-financiero-forma.test.ts` |
| R14 | `export-financiero-frontera.guardia.test.ts` |
| R15 | `export-financiero-grano.test.ts` |
| R16 | `export-financiero-grano.test.ts` |
| R17 | `export-financiero-columnas.test.ts` |
| R18 | `export-financiero-columnas.test.ts` + `export-financiero-frontera.guardia.test.ts` |
| R19 | `export-financiero-equivalencia.test.ts` |
| R20 | `export-financiero-equivalencia.test.ts` |
| R21 | `export-financiero-vacio.test.ts` |
| R22 | `export-financiero-vacio.test.ts` |
| R23 | `export-financiero-frontera.guardia.test.ts` |
| R24 | `AnaliticaFinancieraExport.test.tsx` |
| R25 | `AnaliticaFinancieraExport.test.tsx` |
| R26 | `export-financiero-frontera.guardia.test.ts` |
| R27 | `export-financiero-frontera.guardia.test.ts` + `AnaliticaFinancieraExport.test.tsx` |
| R28 | `tests/unit/guards/tablero-financiero.guardia.test.ts` (vivo, no se toca) |
| R29 | `analitica-financiera-descarga-columnas.test.ts` |
| R30 | `export-financiero-grano.test.ts` |

---

## Decisiones de la puerta T0 — **CERRADA el 2026-08-08**

> Las seis preguntas abiertas de la version anterior de este archivo quedan resueltas **por
> decision humana, todas con la recomendacion**. Se conservan **con su razonamiento y con las
> alternativas descartadas**, no solo con su respuesta: el motivo es lo que impide que la proxima
> persona lo «arregle» al reves dentro de seis meses. **Ninguna vuelve a abrirse sin una decision
> humana nueva y fechada.**

| Decision | Respuesta | Efecto |
|---|---|---|
| **D1** vistas que entran | **(a)** solo las **temporales** | R12 tal como esta escrito. Los cubos por tienda quedan FUERA; la **181** no se resuelve aqui |
| **D2** forma del importe | **(a)** cadena literal escala 2 | R18. Coste en Excel es-EC declarado, no oculto |
| **D3** limitacion del ultimo cubo | **(a)** columna constante `limitacion_conocida` | **R30**, y la excepcion nombrada de R11 |
| **D4** rango consultado | **(a)** el archivo NO lo declara | R10. Sin columnas `desde`/`hasta` |
| **D5** grano del control | **uno por vista** | §4.2 del design y su alternativa 4 descartada |
| **D6** tocar `TableroFinanciero.tsx` | **si**, con la condicion integra | R28, y el guardia vivo queda verde **sin tocarlo** |

### D1 — BLOQUEANTE (cerrada). Solo las vistas TEMPORALES

La ficha dice «export de las metricas financieras»; el titulo dice «export de **la serie**». No
son lo mismo. Hoy el DTO publica tres clases de vista:

| Clase | Vistas | Que hay en el `cubo` |
|---|---|---|
| temporal | las 7 de `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` | una fecha `YYYY-MM-DD` |
| por metodo de pago | `cod_recaudado__por_metodo` | `"efectivo"`, `"simpe"`, `"transferencia"` |
| por tienda | `cod_recaudado__por_tienda`, `cuenta_por_pagar_tienda` | **el `tiendaId` CRUDO** |
| conciliacion | `conciliacion_cierres` | no tiene vistas: conteos + `cierresDescuadrados` (ids de CIERRE) |

**Motivo, y es de seguridad y no de alcance:** en una vista temporal la clave del cubo **es una
fecha por construccion** (R24 de la 180 prohibe ids de persona o tienda en el DTO del desglose),
asi que **el archivo no puede llevar un identificador ni por descuido**. Con los cubos por tienda
dentro si lo llevaria: el `tiendaId` es en este esquema una FK a `usuario` (`feature_list.json`,
ficha 181), y una pantalla se cierra pero **un archivo se guarda, se reenvia por WhatsApp y se
abre seis meses despues** (aviso §7 de la 122, citado por la 134). Y la sonda de la guardia de la
170 **no lo atraparia**: la celda leeria `fila.cubo`, cuyo nombre de campo es inocente.
**La 181 NO se resuelve dentro de la 184** —es ficha propia, `pending`—; lo que la 184 decide es
**no heredar su problema**.

**Descartadas:** (b) temporales + por metodo de pago —no anade fuga, pero tampoco lo ha pedido
ninguna pantalla y ensancha el contrato de columnas sin motivo—; (c) todas las vistas —el id crudo
entra al archivo—; (d) todas + conciliacion —ademas de (c), `cierresDescuadrados` son ids de
CIERRE—.

### D2 — El importe viaja como CADENA literal de escala 2

`DescargaCelda` admite `string | number | null`. Hoy el DTO publica `"22042.40"` (cadena, escala 2)
y `lib/types/analitica-financiera.ts:12-14` declara que **ningun `number` representa dinero en
ninguna frontera**. Pero `buildCsvRows` emite **decimales con punto** y Excel con locale es-EC
puede no reconocer `"22042.40"` como numero: el usuario tendria que convertir la columna.

**Motivo:** `lib/types/analitica-financiera.ts:12-14` declara que **ningun `number` representa
dinero en ninguna frontera**. Hoy hay exactamente **una** frontera string→number en la app,
`aNumero` (`adaptar.ts:132`), declarada «solo para pintar, nunca para calcular», y devuelve `null`
en el no finito —un `null` en el archivo se leeria como «no se sabe»—.

**Coste aceptado y declarado, no oculto:** `buildCsvRows` emite decimales con punto, y en Excel con
locale es-EC la columna puede llegar como **texto**; el usuario tiene que convertirla. Se paga a
cambio de no abrir una segunda frontera del dinero. (Y la salida para quien necesita sumar en Excel
ya existe: el mismo control ofrece **XLSX**, R25.)

**Descartadas:** (b) `number` en XLSX y cadena en CSV —crearia **dos archivos distintos** del mismo
dato con el mismo nombre—; (c) `number` en los dos —la segunda frontera del dinero, con su `null`
disfrazado de «no se sabe»—.

### D3 — El archivo lleva la columna constante `limitacion_conocida`

Q2 de la 180 decidio (a): el servicio **no marca** el cubo en curso, porque marcarlo exigiria
inyectarle un reloj y romper su determinismo (R26 de la 180). Con los presets vigentes el `hasta`
es el inicio del dia CR siguiente, asi que **el ultimo cubo casi siempre esta a medias**, y el DTO
no lo dice.

**Lo que hay que dejar dicho, y esta dicho en R30, en R11 y en la cabecera del modulo de columnas:
es la UNICA celda del archivo cuyo texto no sale del DTO.** No es un descuido y no se borra. Roza
R11 a proposito, y por eso R11 la nombra como **excepcion unica** y su test comprueba que **no hay
una segunda**: la exencion es de una celda, no una puerta abierta.

Va **en columna por fila** y no en un bloque de cabecera por la misma razon que D3 de la 134: la
fila es lo unico de un fichero plano que sobrevive a filtrar, ordenar y copiar a otra hoja; una
cabecera de metadatos rompe `read_csv` y desaparece en cuanto alguien reguarda desde Excel —justo
el momento en que el archivo empieza a circular—.

**Descartadas:** (b) no decir nada —deja circulando un archivo cuyo ultimo punto es menor que la
realidad sin que nada lo advierta—; (c) calcular el cubo en curso en el cliente y marcarlo —seria
**inventar** la informacion que el servidor se nego a publicar (Q2 de la 180: marcarlo exigiria
inyectarle un reloj y romper su determinismo, R26 de la 180) y ademas meteria una **segunda
definicion del dia de Costa Rica** en el navegador, en una capa donde ningun guardia de
`lib/analytics` mira—.

### D4 — El archivo NO declara el rango consultado

El nombre del archivo lleva la fecha de **generacion**, no el rango. El rango se deduce de los
cubos, salvo en las **acumuladas**, donde cada fila es un saldo al corte y el `desdeFecha` no se
lee de ninguna fila.

Sin columnas `desde`/`hasta`. **Motivo, y no es ahorro:** la 134 lo evito (su D4) y el argumento
sigue siendo que **cuanta menos constante de contexto lleve un archivo que circula, menos
superficie hay para que un dia alguien anada ahi el alcance del actor**. Una columna constante de
contexto es la primera piedra de una cabecera de metadatos.

**Limite declarado:** en las metricas **acumuladas** cada fila es un saldo al corte, asi que el
`desdeFecha` del rango no se lee de ninguna fila. Quien necesite el rango exacto lo tiene en la
pantalla (`CabeceraPanel` lo pinta, `TableroFinanciero.tsx:175-177`); el archivo dice **que** cifra
es cada fila (R16) y **de que dia** (R15), que es lo que hace falta para no leerla mal.

**Descartada:** (b) dos columnas constantes `desde`/`hasta` del `datos.rango` —no filtra nada por
si misma, el rango no es identificador, y es la opcion defendible que se dejo fuera; si algun dia
se quiere, se anaden dos columnas y R10 no cambia—.

### D5 — Un control POR VISTA, con el grano de la grafica

**Motivo:** mismo grano que la grafica que el usuario esta mirando (D6 de la 134). Un archivo unico
de la region mezclaria **flujos y saldos al corte en una sola hoja** —la peor confusion posible en
un archivo de dinero— y, con D1, serian siete llamadas encadenadas antes de producir nada.

**Coste declarado:** siete controles a la vista. Lo absorbe el nombre accesible que
`DescargarDatasetButton` compone (`Descargar <titulo>`), que dice cual descarga cada uno.

**Descartada:** un control unico de la region.

### D6 — Se acepta la unica insercion en `TableroFinanciero.tsx`

Es el **unico** archivo ajeno que esta feature toca, con **una** insercion de JSX en `SeccionVista`.
No hay alternativa sin tocarlo: el arbol financiero es 100% servidor y no existe hoy ningun
componente de cliente en la region donde colgar el control. Riesgo de merge: textual y trivial (una
insercion, ninguna decision de rol ni de forma cambiada).

**Aceptada con la condicion INTEGRA**, que es parte de la decision y no una nota: la insercion
**no** anade `"use client"` a ese archivo, **no** pasa ninguna prop-funcion, **no** nombra valores
de granularidad ni ids de metrica, y `tests/unit/guards/tablero-financiero.guardia.test.ts` queda
**VERDE SIN TOCARLO** (R28). Editar ese guardia para que pase **invalida la decision**.

**Descartada:** meter el control dentro de `_components/financiero/` y relajar el censo —§1.1 del
design: el censo tiene razon, la directiva de cliente ahi arrastraria el borde financiero y con el
Prisma al bundle del navegador—.
