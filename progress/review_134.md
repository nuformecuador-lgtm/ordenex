# 134 - analitica: export CSV - REVIEW

Revisor: agente REVIEWER. Worktree `C:/w134`, rama `feature/134-analitica-export-csv`.
Rango revisado: `git diff 64957dca..HEAD` (8 commits, incluido `1af04e53` con el spec).

**VEREDICTO: OK (APROBADO).** Cero hallazgos bloqueantes. Ocho hallazgos menores, listados
abajo; ninguno impide el merge.

Todo lo que sigue lo medi yo en este worktree. La bitacora del implementer se usa solo para
contrastar, nunca como fuente.

---

## 1. Checklist de CHECKPOINTS.md

### Especificacion
- [x] `specs/134-analitica-export-csv/requirements.md` con 21 requisitos EARS numerados + D1-D6.
- [x] `design.md` con 7 alternativas descartadas y su porque (seccion 6).
- [~] `tasks.md`: todas `[x]` **salvo T0.3**, sin marcar, y asignada explicitamente al leader.
      El trabajo ESTA hecho (`feature_list.json` en el commit del spec `1af04e53`: `zone`
      fullstack->frontend, `depends_on` 127->[126], alta de la ficha 184). Solo falta la marca.
      **Menor 1.**

### Trazabilidad
- [x] Los 21 R mapean a un caso NOMBRADO que muere bajo su mutacion. Verificado por mi, mutacion
      a mutacion (seccion 3). Cero cobertura aparente.
- [x] `progress/impl_134.md` seccion 3 contiene el mapa R1..R21 -> test, sin filas vacias.

### Calidad de codigo
- [x] `pnpm typecheck`: **verde, 0 errores**.
- [x] `pnpm lint`: **0 errores, 44 warnings**, todos `no-unused-vars` en archivos ajenos y
      preexistentes. **Cero** en archivos de la 134 (filtre la salida por analitica/export-csv/
      descarga: vacia).
- [x] Tests: seccion 5. NO corri `./init.sh` completo, por instruccion del leader.
- [x] E2E: no aplica. El flujo no es auth/pagos/recaudo/ingesta/webhook, asi que CHECKPOINTS no
      lo exige. Decision registrada en `impl_134.md` seccion 7.

### Datos y seguridad
- [x] **Cero migraciones, cero tablas nuevas**: RLS sin cambios y sin `down.sql` que exigir.
      Verificado en el diff: ni un archivo bajo `prisma/` o `db/`.
- [x] Ningun secreto hardcodeado. El unico valor de configuracion es `descargaConfig.MAX_FILAS`,
      leido de `lib/config/descarga.ts`, no un literal duplicado.
- [x] Webhooks: no aplica.

### Patron de capas
- [x] **Cero codigo de servidor**, como afirma el spec. Los tres archivos de produccion importan
      solo la Server Action de la 126, tipos, `components/shared/*` y hermanos del subarbol. Ni
      servicio, ni repositorio, ni Prisma, ni `lib/analytics/*`. Lo prueban las mutaciones R1,
      R3, R4 y R19.
- [x] Auditoria / 403 / seudonimizacion **se heredan** del borde y del servicio; no se
      reimplementan. Verificado leyendo los tres archivos y con las mutaciones R6 y R8.

### Permisos y multi-pais
- [x] El gating vive donde ya vivia (`prepararConsultaAnalitica` + `denegar`, borde de la 126).
      El control de cliente no fetchea nada sensible: recibe `panel` y `filtro` por props.
- [x] Sin hardcode de pais, moneda ni cuenta.

### Verificacion final
- [ ] `./init.sh` completo: **NO ejecutado por mi** (instruccion expresa del leader, que lo
      correra tras mergear `dev`). **Reserva declarada de esta revision.**
- [x] Este archivo existe y su veredicto es OK.
- [ ] `progress/history.md` **no tiene entrada de la 134**. **Menor 3** (cierre del leader).

---

## 2. Los cinco puntos de sospecha que el leader marco

### 2.1 T3.1 (task BLINDADA): los cuatro criterios de NO HECHO, uno por uno

**Veredicto: T3.1 ESTA HECHA.** Los cuatro criterios se cumplen.

1. **Asercion sobre el STRING del fichero, no sobre el objeto en memoria. CUMPLE.**
   `export-csv-seudonimizacion.test.ts:53-73` arma el texto con
   `construirDescarga({tipo:"csv", ...})` y devuelve `String(archivo.contenido)`. Las aserciones
   (:80-82) son `not.toContain(UUID_A)`, `not.toContain(UUID_B)` y
   `not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i)` **sobre ese string**. Ademas
   `toContain("Mensajero 1")`, `toContain("Mensajero 2")` y un conteo de lineas de datos, para
   que "no hay uuids" no lo cumpla tambien un archivo vacio.
2. **La fixture devuelve UUIDS DE VERDAD. CUMPLE.**
   `UUID_A = "3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa"` y `UUID_B = "3f0a7c62-2222-...-bbbbbbbbbbbb"`,
   inyectados como `mensajeroId` de los cubos del repositorio falso, y buscados LITERALMENTE en el
   string. Hay ademas un caso propio, `y la fixture lleva uuids de verdad: sin esto el caso
   anterior seria un verde gratuito`, que cae si alguien la simplifica a etiquetas limpias.
3. **No cortocircuita el servicio. CUMPLE.** La cadena es `rollupFalso(CUBOS)` -> `servicioCon(...)`
   (el `AnaliticaOperativaService` REAL) -> `consultarAnaliticaOperativa` con
   `getActor: async () => TIENDA` (adminTienda) -> `filasDeSerie` -> `construirDescarga`. Solo se
   inyectan dobles de INFRAESTRUCTURA (repositorio y reloj). Un tercer caso, `y la cadena pasa por
   el SERVICIO de verdad, no por una serie fabricada a mano`, comprueba
   `rollup.llamadasAgregar.length > 0`, de modo que cortocircuitarlo se note.
4. **Mutacion ejecutada y su salida pegada. CUMPLE, y la reproduje yo.**
   Retire la llamada a `seudonimizarPuntos` en `lib/services/AnaliticaOperativaService.ts:503-505`
   (de `return dimension === "mensajero" ? seudonimizarPuntos(puntos, consulta.politicaIdentidad)
   : puntos;` a `return puntos;`). El caso `el CSV de un adminTienda no contiene ningun uuid de
   mensajero` se puso **ROJO** en `:80`, con el CSV llevando los dos uuids reales en la columna
   `Desglose`. Es **exactamente** la salida pegada en `impl_134.md` seccion 4.1, linea por linea.
   Revertido; arbol limpio.

### 2.2 La costura del refactor `8f485b03`: reverificada por mi cuenta

No di por bueno el informe del segundo agente: **apliqué las 21 mutaciones yo mismo**, contra la
disposicion de HOY, con un arnes que **aborta si el ancla no existe en disco** y que verifica que
el texto nuevo aterrizo antes de correr nada.

- **Ninguna mutacion cayo en codigo muerto ni en un simbolo inexistente**: el arnes lo habria
  abortado con ANCLA NO ENCONTRADA. Las 21 anclas existen y son codigo vivo.
- Los ocho anclajes que el segundo agente declara movidos (**R7, R9, R11, R12, R13, R15, R20** a
  `analitica-operativa-descarga-columnas.ts`, y **R14** cambiado de forma en `export-operativo.ts`)
  **coinciden con lo que yo encontre**. R10 sigue en el recorrido; las once restantes no se
  movieron.
- Comprobe que no queda codigo muerto en los modulos nuevos: `COBERTURA_*` los consumen
  `coberturaDeFila` y los tests; `filaDescargaAnaliticaOperativa` lo consume `filasDeSerie`;
  `FuenteExport` lo consumen los tres archivos.
- **Verifique tambien el motivo del refactor, que es lo que lo justifica:** la guardia perenne de
  la 170 (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) descubre las columnas por
  convencion de nombre (`app/**/*-descarga-columnas.ts`, linea 95) y **si recoge el modulo nuevo**:
  la corri aislada y pasa (4 tests). Sin ese nombre, las columnas de este export -el que mas
  vigilancia necesita- habrian quedado fuera de esa sonda.

### 2.3 El auto-chequeo del guardia y el patron muerto

**(a) El auto-chequeo funciona de verdad.** Lo mute yo: anadi
`/COLUMNAS_EXPORT_OPERATIVO_QUE_YA_NO_EXISTE/` a `EXPORT_DE_ANALITICA` y el caso `y los patrones
que nombran el export siguen casando con el export que EXISTE` se puso **ROJO** en
`export-csv-frontera.guardia.test.ts:226`, con el mensaje `el censo persigue un nombre muerto:
/COLUMNAS_EXPORT_OPERATIVO_QUE_YA_NO_EXISTE/`. Revertido.

**(b) Los demas patrones siguen vivos, uno por uno.** Replique el corpus del auto-chequeo
(subarbol del export + `lib/actions` + `lib/analytics`) en un script propio y conte coincidencias:

| Patron | Archivos que casan |
| --- | --- |
| `/consultarAnaliticaOperativa/` | 4 |
| `/consultarAgregadoOperativo/` | 1 (`lib/actions/analitica-operativa.ts`) |
| `/export-operativo/` | 2 |
| `/analitica-operativa-descarga-columnas/` | 3 |
| `/COLUMNAS_DESCARGA_ANALITICA_OPERATIVA/` | 2 |
| `/filasDeSerie/` | 2 |
| `/filaDescargaAnaliticaOperativa/` | 2 |
| `/from ["']@/lib/analytics//` | 16 |

Ninguno esta muerto. Hice el mismo censo con los otros tres bloques: los 9 patrones de
`PUERTA_TRASERA` y los 2 de `GENERADOR_DE_ARCHIVO` casan con codigo real del arbol. En
`GENERADOR_PROPIO` (bloque 4), `Content-Disposition` y el patron del BOM no casan con nada, lo
cual es **correcto y deseado**: son patrones de PROHIBICION, no nombres de cosas que existan; que
no casen es el estado sano. Solo anoto que `Content-Disposition` es el unico de los seis sin
fixture sintetico en el caso `el censo DISCRIMINA` (**menor 6**).

### 2.4 Guardias: se relajo algo?

**No.** Revise el diff completo. Los unicos tests preexistentes tocados son tres
(`TableroOperativo`, `TableroOperativoLatencia`, `FiltrosOperativos`), y el cambio es
**exclusivamente** envolver el `render()` en `ToastProvider` mas su import. **Ni una asercion
tocada, ni un mock, ni un dato de fixture, ni un expect debilitado, ni una allowlist ampliada, ni
un guardia retirado ni estrechado.** El motivo esta escrito dentro de cada uno de los tres tests.

Y el envoltorio es legitimo, no un parche para poner verde: `PanelOperativo` monta ahora
`DescargarDatasetButton`, que llama a `useToast()`, y el `ToastProvider` real vive en
`app/(app)/layout.tsx:34` (comprobado), asi que la pantalla de produccion lo tiene. Eran esos tres
tests los que renderizaban el tablero desnudo. Los tres pasan (24 tests).

### 2.5 "Esta feature no lleva codigo de servidor"

**El diff lo respeta.** Los tres archivos de produccion nuevos viven todos en
`app/(app)/analitica/_components/operativo/`. Sus imports: `@/lib/actions/analitica-operativa` (la
Server Action), `@/lib/types/{descarga,analitica-operativa}`, `@/components/shared/*` y hermanos
del subarbol. Cero servicio, cero repositorio, cero Prisma, cero `lib/analytics/*`. Cero rutas
nuevas bajo `app/api/`.

### 2.6 tasks.md: alguna casilla marcada sin trabajo detras?

Recorri las 22 tasks. **Ninguna casilla marca trabajo inexistente**, con una salvedad de
evidencia: **T5.4** esta `[x]` afirmando "./init.sh completo antes del PR. Hecho: verde, salida
pegada", pero `impl_134.md` seccion 8 **no pega ninguna salida de `./init.sh`**: lista cuatro
comandos por separado (tsc, eslint, vitest run, test:guardias). La casilla afirma mas de lo que
documenta. **Menor 2**; como el leader va a correr `./init.sh` de todos modos tras mergear `dev`,
no lo elevo a bloqueante.

---

## 3. Las 21 mutaciones, aplicadas por MI (una a una, revirtiendo entre cada una)

Procedimiento por mutacion: (1) respaldar el archivo, (2) aplicar la mutacion **abortando si el
ancla no existe**, (3) verificar que aterrizo en disco, (4) correr **solo el caso nombrado** con
`vitest run --no-file-parallelism <archivo> -t "<nombre del caso>"`, (5) restaurar y comprobar
`git status --short` vacio.

Como solo se ejecuta el caso nombrado, **cualquier rojo es por definicion ese caso**: no hay forma
de que muera un hermano y pase por bueno.

| R | Mutacion aplicada | Archivo mutado | Caso que murio | El que el mapa asigna? |
| --- | --- | --- | --- | --- |
| R1 | importar `AnaliticaOperativaService` en el subarbol | `export-operativo.ts` | `el subarbol de export no importa servicio, repositorio, Prisma ni el catalogo de servidor` | **SI** |
| R2 | `const raw = { rango: filtro.rango }` en vez de `aRaw(filtro)` | `ExportarOperativoPanel.tsx` | `el raw que envia el export es identico al que envia el panel para el mismo filtro` | **SI** |
| R2b | omitir `desagregacion` en la entrada (2a mitad de R2) | `ExportarOperativoPanel.tsx` | el mismo caso, en `:127` | **SI** |
| R3 | crear `app/api/analitica/export/route.ts` que sirve el export | ruta nueva | `ninguna ruta de app/api sirve el export de analitica` | **SI** |
| R4 | el modulo `"use server"` del borde importa `construirDescarga` | `lib/actions/analitica-operativa.ts` | `ningun modulo "use server" invoca construirDescarga` | **SI** |
| R5 | traducir `forbidden` a `{ status:"ok", filas: [] }` | `ExportarOperativoPanel.tsx` | `un forbidden no produce archivo y su mensaje no es el de sin datos` | **SI** |
| R6 | corte previo que evita llamar a la accion para `egresos` | `ExportarOperativoPanel.tsx` | `el intento de descarga denegado deja rastro en el logger antes de responder` | **SI** |
| R7 | anadir columna "Mensajero (nombre)" y su celda | `...-descarga-columnas.ts` | `toda celda del CSV procede de un campo de SerieOperativa` | **SI** |
| R8 | retirar `seudonimizarPuntos` del servicio | `AnaliticaOperativaService.ts:503-505` | `el CSV de un adminTienda no contiene ningun uuid de mensajero` | **SI** |
| R9 | columna `mensajero_ref` con `uuid.slice(0,8)` DEL UUID REAL, con la seudonimizacion intacta | servicio + `...-descarga-columnas.ts` | `el archivo no incluye ningun mapa seudonimo-id ni valor derivado del uuid` | **SI** |
| R10 | `filter((p) => p.valor !== null)` en el recorrido | `export-operativo.ts` | `las filas del CSV son punto por punto las de la serie que pinta el panel` | **SI** |
| R11 | `valor: punto.valor ?? 0` | `...-descarga-columnas.ts` | `un valor null se escribe como celda vacia y jamas como 0` | **SI** |
| R12 | eliminar la columna `unidad` y su celda | `...-descarga-columnas.ts` | `cada fila declara la unidad de su metrica` | **SI** |
| R13a | `corte_at: null` (deja de propagar el corte) | `...-descarga-columnas.ts` | `la fila del dia en curso se marca parcial y lleva su corte` | **SI** |
| R13b | quitar `if (parcial === true) return COBERTURA_PARCIAL` | `...-descarga-columnas.ts` | el mismo caso, en `:76` | **SI** |
| R14 | pasar `new Set<string>()` en vez de `cobertura.fechasNoComparables` | `export-operativo.ts` | `las fechas bajo el horizonte del historial se marcan no comparables en su fila` | **SI** |
| R15 | `limitacion_conocida: fuente.serie.puntos.length` (penumbra a numero) | `...-descarga-columnas.ts` | `el archivo declara la penumbra sin estimarla` | **SI** |
| R16 | `.slice(0, 5000)` antes del tope | `ExportarOperativoPanel.tsx` | `superar el tope no produce archivo truncado sino el mensaje accionable` | **SI** (muere por timeout del waitFor, ver nota) |
| R17 | con 0 puntos se emite igualmente una fila | `ExportarOperativoPanel.tsx` | `sin puntos no se genera archivo y se avisa sin datos` | **SI** (idem, timeout) |
| R18 | el borde audita tambien el `validation_error` | `lib/actions/analitica-operativa.ts` | `un validation_error no produce archivo y no llama al logger` | **SI** |
| R19 | nace `.../operativo/generador-propio.ts` con `buildCsvRowsAnalitica` | archivo nuevo | `el export vive en su subarbol y reusa el patron 151 sin reimplementarlo` | **SI** |
| R20 | exportar un `nombreDelArchivo()` compuesto a mano en el subarbol | `...-descarga-columnas.ts` | `el nombre del archivo lo produce nombreArchivoDescarga` | **SI**, y ademas el bloque 4 del guardia (lo comprobe por separado) |
| R21 | `FORMATOS_EXPORT_OPERATIVO = ["csv"]` | `ExportarOperativoPanel.tsx` | `el control ofrece CSV y XLSX y no declara un dialecto propio` | **SI** |

**21/21 muertas, y las 21 en el caso que el mapa les asigna. Cero anclajes silenciosos.**

Tres notas de honestidad sobre COMO mueren:

- **R16 y R17** mueren por *timeout* de `waitFor`, no por una igualdad: bajo la mutacion el control
  SI produce archivo, asi que el toast de error nunca llega. El rojo es real y por la razon
  correcta -los mismos casos afirman ademas que `buildCsvRows` y `descargarBlob` NO se invocan-,
  pero conviene saber que la forma del fallo es un timeout. La bitacora ya lo declaraba; lo
  confirmo.
- **R9**: la bitacora dice haberlo matado anadiendo `mensajero_ref` con `uuid.slice(0,8)` mutando
  **solo** el modulo de columnas. Ahi el uuid real ya no esta disponible (el servicio lo
  sustituyo), asi que esa mutacion mata el caso por la comprobacion de cabecera palabra-a-palabra
  ("ref" prohibido), no por el valor. **Yo lo mate en su forma FUERTE**: propague el uuid real
  hasta la fila y emiti su prefijo, con la seudonimizacion INTACTA. Cayo en
  `expect(contenido).not.toContain(uuid.slice(0, largo))` (`:125`), con el CSV mostrando
  `Mensajero 1,...,3f0a7c62`. R9 esta cubierto de verdad, no solo por el nombre de la columna.
- **R7** cae en la enumeracion de claves contra el contrato escrito a mano en el test (`:104`), que
  es exactamente el mecanismo que `requirements.md` describe para esa mutacion.

---

## 4. Anclaje silencioso: busqueda explicita

Ha aparecido en las features 125, 126 y 131 de este repo, asi que lo busque a proposito:

- corri **solo el caso nombrado** en cada mutacion (`-t`), de modo que un hermano verde no puede
  disfrazar un rojo ajeno ni al reves;
- para R2 y R13 aplique **las dos mitades** del requisito por separado (raw / desagregacion;
  `parcial` / `corteAt`), y las dos matan el mismo caso nombrado;
- para R20 comprobe que el caso asignado muere **y** que el bloque 4 del guardia tambien lo mata,
  es decir que hay dos anclajes independientes;
- para R9 no me conforme con la mutacion debil que mata el caso por el nombre de la columna.

**No encontre ningun anclaje silencioso.**

---

## 5. Medicion ejecutable (todo corrido por mi en `C:/w134`)

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | **verde**, 0 errores |
| `pnpm lint` | **0 errores**, 44 warnings, todos preexistentes y ajenos |
| Los 9 archivos de la feature (`--no-file-parallelism`) | **9 archivos, 43 tests, 0 rojos** |
| `tests/unit/analytics` + `tests/unit/descarga` + `tests/components/descarga` | **131 archivos, 1238 tests, 0 rojos** |
| `vitest run guard` (los 59 guardias del repo) | **59 archivos, 820 tests, 0 rojos** (2a y 3a corrida; ver flake) |
| Los 3 tests del tablero modificados | **3 archivos, 24 tests, 0 rojos** |
| `tests/unit/descarga/columnas-sensibles.guardia.test.ts` (la sonda de la 170) | **verde**, 4 tests, e incluye el modulo nuevo |

**Aviso de corrida degradada, atendido.** El primer intento de correr los 9 archivos en paralelo
salio **degradado**: `Test Files 6 passed (6)` con 3 `Unhandled Error` de workers, es decir
**omitio 3 archivos enteros y parecia verde**. Compare el numero de ARCHIVOS (6 distinto de 9), lo
detecte, y repeti con `--no-file-parallelism`: 9/9. Todas las cifras de la tabla son de corridas NO
degradadas, con el conteo de archivos comprobado.

**Flake observado (no es regresion de la 134).** En la primera corrida completa de guardias,
`tests/unit/guards/no-embalaje.test.ts` fallo (1 de 820). Ese guardia recorre el arbol entero
leyendo ficheros. Lo verifique **en aislado** (verde) y en **dos corridas completas posteriores**
de los 59 guardias (verdes las dos). No toca nada de esta feature ni aparece en el diff. Lo cuento
como flake por saturacion, no como rojo. **Menor 7.**

**No corri `./init.sh`** ni completo ni `--rapido`, por instruccion expresa del leader. Es una
**reserva declarada** de esta revision, no un verde que yo afirme.

---

## 6. Hallazgos

### Bloqueantes

**NINGUNO.**

### Menores

1. **`menor` - T0.3 sin marcar en `tasks.md`.** Unica casilla sin `[x]`, y esta asignada al leader.
   El trabajo ESTA hecho en `feature_list.json` (commit del spec `1af04e53`). Solo falta la marca.
   `CHECKPOINTS.md` exige "todas las tasks marcadas [x]".
2. **`menor` - T5.4 afirma mas evidencia de la que hay.** Dice "./init.sh completo. Hecho: verde,
   salida pegada", y en `impl_134.md` seccion 8 no hay salida de `./init.sh`: hay cuatro comandos
   sueltos. La correccion es de una linea (pegar la salida o reformular la task). El leader correra
   `./init.sh` de todas formas.
3. **`menor` - falta la entrada en `progress/history.md`.** `CHECKPOINTS.md` la exige. Cierre del
   leader.
4. **`menor` - el spec dice "dos archivos nuevos" y son tres.** `design.md` seccion 1 y el texto de
   R19 declaran dos archivos de produccion; el refactor `8f485b03` anadio
   `analitica-operativa-descarga-columnas.ts`. La desviacion **esta declarada con su motivo** en
   `impl_134.md` seccion 5 y el motivo es bueno (la convencion `*-descarga-columnas.ts` con la que
   la guardia de la 170 descubre columnas; comprobado que recoge el modulo). Lo correcto habria
   sido corregir tambien el texto del spec en vez de dejar spec y realidad discrepando.
5. **`menor` - la mitad inventarial de R19 no tiene guardia ejecutable.** El guardia cubre "no hay
   generador propio" y "no hay modulo de export fuera del subarbol", que son las dos mutaciones que
   R19 declara. Pero "cero cambios en `lib/analytics/**`, `lib/actions/**`, `lib/services/**`,
   `lib/utils/*`, `components/shared/**`" solo se comprobo a mano (T5.3). Lo verifique yo en el
   diff y **se cumple** (fuera del subarbol solo se tocan 3 tests del tablero y `feature_list.json`),
   pero conviene saber que esa mitad no la protege ningun test. `tasks.md` declara la ausencia de
   guardia de diff como deliberada, coherente con la leccion de los guardias branch-scoped que
   caducan al mergear.
6. **`menor` - `Content-Disposition` sin fixture sintetico.** En el bloque 4, el caso
   `el censo DISCRIMINA` ejercita 4 de los 6 patrones de `GENERADOR_PROPIO`; `Content-Disposition`
   y el patron del BOM no tienen fixture. Son literales triviales y son patrones de prohibicion
   (que no casen con nada hoy es lo sano), asi que el riesgo es bajo.
7. **`menor` - flake de `tests/unit/guards/no-embalaje.test.ts`** (1 rojo en 1 de 3 corridas
   completas de guardias; verde en aislado). Ajeno a esta feature; se anota para que no se cuente
   como regresion de la 134 si reaparece.
8. **`menor` - cifra de tests de la bitacora.** `impl_134.md` seccion 1 dice "+42 tests"; yo cuento
   **43** en los 9 archivos nuevos. Trivial, pero la bitacora es la fuente que se cita despues.

---

## 7. Estado del arbol al terminar

Todas las mutaciones fueron revertidas y comprobadas una a una. Al cerrar esta revision,
`git status --short` esta **vacio** salvo por este propio `progress/review_134.md`, que se deja
**sin commitear** como se pidio. Los dos archivos temporales que crea el arnes de mutacion
(`app/api/analitica/export/route.ts` y `.../operativo/generador-propio.ts`) se borraron, y tambien
sus directorios vacios.

No ejecute `git add`, `commit`, `checkout`, `switch`, `reset`, `stash`, `branch -D`, `merge`,
`pull`, `push` ni `worktree`. No toque el checkout principal ni `C:/w133`, `C:/w175`, `C:/w180`.
No corri `pnpm build`, ni `db:rollback`, ni ninguna migracion.

---

## VEREDICTO FINAL: OK - APROBADO

Los 21 requisitos estan cubiertos por un test nombrado que **muere** cuando se rompe la
implementacion, comprobado mutacion a mutacion contra la disposicion de HOY, no contra la de antes
del refactor. La task blindada T3.1 cumple los cuatro criterios, incluida la reproduccion de su
mutacion con salida identica a la de la bitacora. El auto-chequeo nuevo del guardia funciona (lo
mute y se puso rojo) y ningun patron del censo persigue un nombre muerto. No se relajo ninguna
asercion ni ningun guardia. Los ocho hallazgos son menores, y cuatro de ellos son trabajo de cierre
del leader (T0.3, `history.md`, `./init.sh`, y la nota del spec sobre "dos archivos").

**Reserva unica:** `./init.sh` completo no lo corri yo. Queda pendiente de la corrida del leader
tras mergear `dev`.
