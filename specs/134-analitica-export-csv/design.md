# 134 — analitica: export CSV · design

> Todo hecho de inventario de este documento esta verificado leyendo el arbol de
> `C:/w134` (rama `feature/134-analitica-export-csv`, nacida de `origin/dev` en `64957dca`).
> No se cita ninguna otra sesion.

---

## 1. Frontera: que archivos toca la 134 (y cuales NO)

Hay cuatro sesiones vivas sobre la misma zona. La frontera es parte del diseno, no una nota.

**Archivos NUEVOS (propiedad exclusiva de la 134):**

| Archivo | Que es |
| --- | --- |
| `app/(app)/analitica/_components/operativo/export-operativo.ts` | Modulo **puro**: `SerieOperativa[] → { columnas, filas }` del contrato `lib/types/descarga`. Sin React, sin DOM, sin dominio de servidor. |
| `app/(app)/analitica/_components/operativo/ExportarOperativoPanel.tsx` | Componente cliente delgado que envuelve `DescargarDatasetButton` (151) y cierra sobre el panel + el filtro. |
| `tests/unit/analytics/export-csv-*.test.ts` (7 archivos, ver `tasks.md`) | Los tests de R1–R20. |
| `tests/unit/analytics/export-csv-frontera.guardia.test.ts` | El guardia. |
| `tests/components/descarga/AnaliticaExportCsv.test.tsx` | El control montado (mensajes, ausencia de archivo). |

**Archivo MODIFICADO (uno solo, y minimo):**

- `app/(app)/analitica/_components/operativo/PanelOperativo.tsx` — **una insercion**: montar
  `<ExportarOperativoPanel …/>` cuando el estado del panel es `ok`. Nada mas: no se toca
  `reducirResultados`, ni la clave SWR, ni el contrato de `EstadoPanel`.

**Archivos que la 134 NO TOCA — verificados uno a uno:**

- `lib/analytics/metrics.ts` → la **175** lo esta corrigiendo.
- `lib/analytics/consulta.ts`, `alcance.ts`, `identidad.ts`, `auditoria.ts` → punto blindado de
  la **122**. La 134 los **consume por su borde**, no los edita.
- `lib/actions/analitica-operativa.ts`, `lib/services/AnaliticaOperativaService.ts` → la 134 no
  necesita ni una linea ahi (ver §3): el borde ya devuelve todo lo que el CSV necesita.
- `lib/actions/analitica-financiera.ts`, `lib/services/AnaliticaFinancieraService.ts`,
  `app/(app)/analitica/_components/financiero/**` → la **180** y la ficha **183** estan encima.
  Alcance fuera (§2).
- `lib/utils/descarga-dataset.ts`, `lib/utils/csv-template.ts`, `lib/types/descarga.ts`,
  `components/shared/DescargarDatasetButton.tsx`, `descargar-blob.ts`, `descarga-resultado.ts`
  → patron de la **151/170**. Se **reusa tal cual**; tocarlo afectaria a ~25 tablas.
- `app/(app)/analitica/_components/AnaliticaShell.tsx`, `page.tsx`, `FiltrosOperativos.tsx` →
  territorio de la **129/132/133**.

**Riesgo de merge declarado:** la **133** (recortes por rol) toca la ruta de analitica y el
rotulo de alcance. Si la 133 modifica `PanelOperativo.tsx`, el conflicto sera **textual y
trivial** (una insercion de JSX en el bloque de render, no un cambio semantico): el export no
altera ninguna decision de rol. No se entra en su subarbol ni se toca ningun otro archivo suyo.

### 1.1 El guardia de frontera, y por que **no caduca**

`tests/unit/analytics/export-csv-frontera.guardia.test.ts` **censa el arbol, no el diff**. Es
100% permanente y por tanto **no lleva cabecera de caducidad**: no hay ninguna afirmacion sobre
«lo que esta rama cambio», que es justo lo que caduca en el merge y produce verdes vacios (la
leccion de `frontera.guardia.test.ts`, retirado en el PR #232, y del bloque branch-scoped que la
**131** retiro en su propio PR — su cabecera lo documenta en
`tablero-operativo-frontera.guardia.test.ts:13-25`).

**Comprobacion exigida (leccion de la 128):** ningun guardia que deba sobrevivir cuelga de otro
que caduque. Los cuatro bloques de este guardia son censos de arbol independientes entre si:

1. el subarbol operativo no importa servicio/repositorio/Prisma/catalogo de servidor **para el
   export** (R1/R19);
2. ninguna ruta de `app/api` menciona export de analitica (R3);
3. ningun modulo con `"use server"` invoca `construirDescarga` (R4);
4. no existe un generador CSV propio dentro de `app/(app)/analitica/**` (R19).

Cada bloque incluye su **autocomprobacion con fixture sintetico** (patron de
`modulo-puro.guardia.test.ts` y de los guardias de 122/126/131): un fragmento infractor en
memoria debe dar positivo, y una mencion en prosa debe dar negativo. Sin eso el guardia seria
verde por vacio.

---

## 2. El aviso de la 122 §7, con mis palabras, tras leerlo

Verificado en `specs/122-analitica-alcance-por-rol/design.md:469-477`. Traducido a lo que
significa para esta feature:

**Un CSV no es una pantalla.** Una pantalla se cierra; un archivo se guarda, se reenvia por
WhatsApp, se sube a un Drive compartido y se abre seis meses despues, cuando el filtro que lo
genero ya no existe y nadie recuerda con que rol se descargo. Por eso aqui **un fallo de alcance
no es un bug visual: es un archivo circulando**, y no hay parche que lo retire.

De ahi las tres consecuencias que gobiernan este diseno:

1. **Una sola puerta.** El export **no reconstruye el filtro** ni forja una consulta. Si tuviera
   su propio camino a los datos, tendria su propio gating, su propio parseo y su propia forma de
   olvidarse de auditar — que es exactamente el agujero que la 176 evito al reusar
   `denegar()` y `sondeaIdentidadDeMensajero` en su Server Action agregada, en vez de
   duplicarlos (`lib/actions/analitica-operativa.ts:142-154`).
2. **La seudonimizacion viaja al archivo.** Una columna `mensajero_id` con uuids reales en un
   `.csv` descargable es **la fuga mas dificil de retirar** de todas las que esta app puede
   producir. R39 de la 122 la prohibe; aqui se prueba **sobre el texto del archivo**, no sobre
   el objeto en memoria (R8).
3. **Los tres pasos del borde son obligatorios**: auditar → 403 → seudonimizar (R40, R41, R39 de
   la 122). La 134 **no los reimplementa**: los hereda intactos por reusar el borde (§3).

**Alcance: solo OPERATIVA.** La financiera queda fuera y es una decision, no un olvido:
`AnaliticaFinancieraService` va a cambiar bajo nuestros pies (la **180** introduce serie
temporal; la ficha **183** retira la distincion neto/bruto de las metricas de caja). Exportar
hoy `RespuestaFinanciera` significaria escribir una proyeccion a filas que hay que reescribir en
dos semanas — y en un export, una proyeccion reescrita a las prisas es como se cuelan columnas
que no debian salir. **Decision D1 de la puerta T0 (cerrada el 2026-08-04): fuera de alcance
POR DECISION, NO POR OLVIDO.** Ver `requirements.md > D1` y la ficha propuesta en §9.

---

## 3. Inventario verificado (lo que hace que este diseno sea barato)

Seis hechos leidos en el arbol. Los tres primeros son la razon de que la 134 **no necesite
codigo de servidor**.

1. **El punto de entrada unico existe y es infalsificable.** `prepararConsultaAnalitica`
   (`lib/analytics/consulta.ts:79`) devuelve una `ConsultaAnalitica` marcada con un
   `unique symbol` **no exportado** (`:40-47`): un literal `{metrica, filtro, rango, alcance}`
   no es asignable desde ningun otro modulo. **El export no puede forjar su consulta aunque
   quisiera: no compilaria.**
2. **La seudonimizacion ocurre en el SERVICIO, no en el borde.**
   `AnaliticaOperativaService` llama a `seudonimizarPuntos` / `seudonimizarCubos` antes de
   devolver (`:504`, `:290`), y su comentario lo declara desviacion deliberada respecto del
   design de la 126: *«Hacerla en el servicio es ESTRICTAMENTE mas fuerte: el id real no llega
   siquiera a cruzar la frontera servicio→borde, asi que ningun borde futuro (la 134, por
   ejemplo) puede olvidarla»* (`:812-819`). **Verificado: el uuid real NO llega al borde ni al
   navegador cuando la politica es `seudonima`.** El campo que el CSV va a escribir es
   `PuntoSerie.dimension`, documentado como «mensajero YA seudonimizado si la politica lo exige»
   (`lib/types/analitica-operativa.ts:87`).
3. **La auditoria del denegado ya esta implementada en el borde.**
   `lib/actions/analitica-operativa.ts:203-218` (`denegar`) llama **explicitamente** a
   `logger.logError(describirDenegado(...))` y **despues** devuelve `{status:"forbidden"}` sin
   motivo y sin datos. La trampa esta documentada en `lib/analytics/auditoria.ts:10-16`: delegar
   en `withErrorHandler` produce un **403 mudo**. La 134 hereda el comportamiento correcto por
   no escribir borde propio.
4. **El patron de export existente es el de la feature 151 (+148 +170), y se reusa entero:**
   - `lib/types/descarga.ts` — contrato `{tipo, titulo, columnas, filas}`, celda `string|number|null`.
   - `lib/utils/csv-template.ts` › `buildCsvRows` — cabecera + filas, escapado CSV, `null` ⇒ celda vacia.
   - `lib/utils/descarga-dataset.ts` › `construirDescarga`, `nombreArchivoDescarga` — despachador
     csv/xlsx, MIME, nombre `<slug>-YYYY-MM-DD.<ext>`. **Import dinamico**, fuera del bundle inicial.
   - `components/shared/DescargarDatasetButton.tsx` — control con guard de carrera, menu de
     formato, toasts de «sin datos» / «fallo», `aria-label`.
   - `components/shared/descargar-blob.ts` — el unico side effect DOM. **El archivo nace y muere
     en el navegador: sin subida, sin almacenamiento** (comentario R15/R32).
   - `components/shared/descarga-resultado.ts` › `filasLocales` — aplica
     `descargaConfig.MAX_FILAS` y produce el mensaje accionable del tope. **No trunca nunca.**
   La 134 aporta **solo** la proyeccion `SerieOperativa → DescargaFila[]`. Cero generador nuevo.
5. **Server Action vs route handler: resuelto, no inventado.** El patron 151 **no usa route
   handler**: el archivo se arma en el navegador con datos que llegan por Server Action
   (`obtenerFilas: () => Promise<DescargaFilasResult>`). Ademas hay dos guardias vivos que lo
   prohiben: `operativa-frontera.guardia.test.ts:44-57` (ninguna ruta de `app/api` consulta
   analitica operativa) y `tablero-operativo-frontera.guardia.test.ts:136-142` (`la ruta no
   define ningun handler de app/api para analitica`). **Una descarga NO necesita otra cosa aqui.**
6. **El filtro de la pantalla ya es serializable y reusable.**
   `app/(app)/analitica/_components/operativo/filtro-tablero.ts` exporta `aRaw(filtro)` y
   `serializarFiltro(filtro)`; `PanelOperativo` usa exactamente ese `raw`
   (`PanelOperativo.tsx:87`). El export **importa esas mismas funciones** — no escribe una
   segunda traduccion filtro→raw.

---

## 4. Arquitectura de la solucion

```
FiltroTablero (URL)  ──aRaw()──┐
                               ├─► consultarAnaliticaOperativa(metricaId, raw, desagregacion)
PanelTablero (catalogo) ───────┘        │  (borde 126: actor → prepararConsultaAnalitica →
                                        │   auditar denegado → servicio → seudonimizar)
                                        ▼
                                 ResultadoOperativo
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
             PanelOperativo (grafica)            export-operativo.ts  (PURO)
                                                            │  filasDeSerie()
                                                            ▼
                                                 filasLocales() (tope 151)
                                                            ▼
                                        DescargarDatasetButton → construirDescarga → descargarBlob
```

**Una sola puerta, literalmente:** la flecha que alimenta al CSV **sale del mismo nodo** que
alimenta la grafica. No hay segunda flecha hacia el servicio ni hacia la base.

### 4.1 Cuando se leen los datos

`obtenerFilas` **re-invoca `consultarAnaliticaOperativa`** con el mismo `raw` en el momento del
click (patron `filasDelConjuntoCompleto` de la 170). No se reusa el objeto que SWR tiene en
memoria. Razon: si el permiso caduco entre el render y el click, el 403 tiene que ocurrir **y
auditarse** en ese momento (R5/R6) — un export servido desde memoria no dejaria rastro de nada,
y un intento de descarga fallido es precisamente lo que interesa auditar.

Consecuencia aceptada: el archivo puede diferir de la grafica en el punto del **dia en curso**
si pasan minutos entre el render y la descarga. Por eso la fila parcial lleva su propio
`corte_at` (R13): el archivo dice a que hora se corto, y no promete ser la foto de la pantalla,
sino **el mismo dato para el mismo alcance y el mismo filtro** (R2/R10).

### 4.2 Contrato de la proyeccion (modulo puro) — **D3, D4, D6**

**D6:** un archivo **por panel**. El grano del archivo es el de la grafica que el usuario mira;
un archivo unico del tablero mezclaria `conteo`, `porcentaje` y `segundos` en una hoja.

**D3:** la cobertura y el dia parcial viajan en **columnas por fila**, no en una cabecera de
metadatos. La fila es lo unico de un fichero plano que sobrevive a **filtrar, ordenar y copiar a
otra hoja**; un bloque de cabecera rompe `read_csv` y desaparece en cuanto alguien reguarda desde
Excel — justo el momento en que el archivo empieza a circular.

**D4:** el archivo NO lleva cabecera de metadatos (alcance / filtro / fecha). La fecha ya va en
el nombre. **Y el motivo importa mas que la decision:** escribir ahi el `tiendaId`/`zonaId` del
actor como «alcance» meteria en un archivo que circula **justo la clase de identificador que
R8/R9 quieren fuera de el**.


```ts
// app/(app)/analitica/_components/operativo/export-operativo.ts
export const COLUMNAS_EXPORT_OPERATIVO: DescargaColumna[] = [
  { clave: "fecha",               encabezado: "Fecha" },
  { clave: "metrica",             encabezado: "Metrica" },
  { clave: "dimension",           encabezado: "Desglose" },     // vacio si no hay desagregacion
  { clave: "valor",               encabezado: "Valor" },        // null ⇒ CELDA VACIA (R11)
  { clave: "unidad",              encabezado: "Unidad" },       // conteo|porcentaje|segundos (R12)
  { clave: "cobertura",           encabezado: "Cobertura" },    // completo|parcial|no_comparable (R13/R14)
  { clave: "corte_at",            encabezado: "Corte" },        // solo si parcial (R13)
  { clave: "limitacion_conocida", encabezado: "Limitacion conocida" }, // PENUMBRA (R15)
];

export function filasDeSerie(
  fuentes: readonly { etiqueta: string; serie: SerieOperativa }[],
): DescargaFila[];
```

Reglas de la proyeccion:
- una fila **por punto de la serie**, en el orden recibido; ni se filtra ni se rellena (R10/R11);
- `valor: null` ⇒ `null` (celda vacia). **Nunca `0`, nunca `"null"`, nunca `"-"`**;
- `cobertura` = `parcial` si `punto.parcial`, si no `no_comparable` si
  `serie.cobertura.fechasNoComparables.includes(punto.fecha)`, si no `completo`;
- `limitacion_conocida` = `serie.cobertura.penumbra` (la constante `PENUMBRA`, jamas un numero);
- `dimension` = `punto.dimension ?? null` — **tal cual llega**, ya seudonimizado por el servicio.

### 4.3 Estados que NO producen archivo

| Resultado | Archivo | Mensaje | Auditoria |
| --- | --- | --- | --- |
| `forbidden` | ninguno | «no tienes permiso…» (texto propio, ≠ sin datos) | **si**, en el borde 126 |
| `validation_error` | ninguno | errores de campo | **no** (R18) |
| `unauthenticated` | ninguno | «sesion no valida» | no |
| `ok` con 0 puntos | ninguno | «no hay datos que descargar…» (151) | no |
| filas > `MAX_FILAS` | ninguno | mensaje accionable con total y tope (151) | no |

Los cinco textos son distintos entre si. Fundirlos es la mutacion de R5.

---

## 5. Modelo de datos, migraciones, RLS, endpoints

- **Migraciones: NINGUNA.** La 134 no crea ni altera tablas ni columnas. No hay `down.sql`
  porque no hay `migration.sql`.
- **RLS: sin cambios.** El aislamiento de analitica es el de la 122
  (`prepararConsultaAnalitica`), y su design ya declara que no hay policies de Postgres para
  esto (alternativa 10 de la 122, deuda de defensa en profundidad declarada).
- **Endpoints: NINGUNO.** Cero rutas nuevas bajo `app/api/` — prohibido por R3 y por dos
  guardias vivos.
- **Server Actions: NINGUNA nueva.** Se consume `consultarAnaliticaOperativa` (126).
- **Contratos I/O:** entrada = `{ panel: PanelTablero, filtro: FiltroTablero }` (ya en el
  cliente); salida = `DescargaArchivo` de `lib/types/descarga.ts`.
- **Config:** `DESCARGA_MAX_FILAS` (`lib/config/descarga.ts`, default 5000). No se introduce un
  segundo tope.

---

## 6. Alternativas descartadas

1. **Un route handler `app/api/analitica/export/route.ts` que devuelva el CSV como
   `Content-Disposition: attachment`.** Es la forma «natural» de descargar un archivo grande y
   es la que mas nos costo descartar. **Descartada por D2 (decision del humano en la puerta T0,
   2026-08-04)**, por tres razones verificadas, no por gusto:
   (a) `docs/architecture.md` reserva los route handlers para webhooks, API publica y crons;
   (b) hay **dos guardias vivos** que lo prohiben explicitamente, con su ruta:
   - `tests/unit/analytics/operativa-frontera.guardia.test.ts:44` — *«ninguna ruta de app/api
     consulta analitica operativa»*;
   - `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts:136` — *«la ruta no define
     ningun handler de `app/api` para analitica»*;

   (c) seria **una segunda superficie de gating**, con su propio parseo y su propia forma de
   olvidarse de auditar el denegado — el pecado exacto contra el que advierte la 122 §7, y la
   razon por la que la **176** reuso `denegar()` en vez de duplicar el borde
   (`lib/actions/analitica-operativa.ts:142-154`). Si algun dia el volumen lo exige, es otra
   ficha, con su propia puerta.

2. **Una Server Action nueva `exportarAnaliticaOperativa` que devuelva ya el CSV armado.**
   Descartada: obligaria a tocar `lib/actions/analitica-operativa.ts` (frontera con otras
   sesiones), duplicaria los cuatro pasos del borde —incluido `denegar()`, que es justo lo que
   la 176 se cuido de no duplicar— y pondria a una feature de UI a escribir en el archivo donde
   la 128 colgo su cache. Y no compra nada: el navegador ya sabe armar CSV.

3. **Seudonimizar en el export.** Descartada por redundante y **peligrosa**: el servicio ya lo
   hizo (§3.2) y el uuid no llega. Un `seudonimizarMensajeros` en el subarbol de analitica
   ademas pondria **rojo el guardia R10 de la 131** (`ALCANCE_E_IDENTIDAD` prohibe
   `/\bseudonimizar\w*/` en toda la ruta). Que la defensa este aguas arriba no es un descuido:
   es que ahi no se puede olvidar.

4. **Exportar desde el objeto que SWR ya tiene en memoria** (`filasLocales` a secas, familia B
   de la 170). Mas barato y produce equivalencia byte a byte con la pantalla. Descartada por
   R5/R6: sin llamada nueva no hay 403 nuevo y **no hay nada que auditar**; un permiso revocado
   entre el render y el click produciria un archivo perfectamente valido de datos que el usuario
   ya no tiene derecho a descargar.

5. **Un unico archivo con los seis paneles.** **Descartada por D6:** mezclaria `conteo`,
   `porcentaje` y `segundos` en una hoja y obligaria a seis llamadas encadenadas antes de
   producir nada. Un archivo por panel, con el grano de la grafica que el usuario mira.

6. **Un dialecto CSV propio (`;` + BOM) para que Excel es-EC lo abra en columnas.**
   **Descartada por D5.** El dato concreto, escrito para que el siguiente no lo «arregle»
   cambiando el dialecto global: `buildCsvRows` emite hoy **coma, decimales con punto y UTF-8
   SIN BOM** (`lib/utils/csv-template.ts:20-21`, `descarga-dataset.ts:24`), y eso en Windows con
   locale **es-EC** abre en **una sola columna** y rompe las tildes. Un dialecto propio crearia
   **dos CSV distintos** en la misma app (25 tablas usan el otro). La salida es **ofrecer
   tambien XLSX** en el mismo control (R21): `DescargarDatasetButton` ya lo soporta con
   `formatos: ["csv","xlsx"]` y abre perfecto.

7. **Cabecera de metadatos con el alcance del actor.** Descartada por D4, y el motivo es de
   seguridad, no de formato: escribir el `tiendaId`/`zonaId` del actor en el archivo meteria en
   un fichero que circula justo la clase de identificador que R8/R9 quieren fuera.

---

## 7. Riesgos

- **Riesgo vivo — la financiera cambia bajo nuestros pies.** **Cerrado por D1:** excluida del
  alcance (§2). El riesgo pasa a la ficha propuesta en §9, que no debe arrancar hasta que 180 y
  183 esten `done`: este diseno **no sirve tal cual** para la financiera, porque
  `RespuestaFinanciera` no tiene forma de serie y §4.2 habria que rehacerlo entero.
- **La 133 puede tocar `PanelOperativo.tsx`.** Conflicto textual esperado y trivial (§1).
- **La equivalencia pantalla-archivo es «mismo dato», no «misma foto»** (§4.1). Si el humano
  espera identidad byte a byte con lo pintado, la respuesta correcta es la alternativa 4 y hay
  que renegociar R5/R6.
- **El guardia podria nacer verde por vacio.** Mitigado con autocomprobacion por fixtures
  sinteticos en los cuatro bloques (§1.1), obligatoria en T4.2.
- **`export-operativo.ts` vive bajo `app/(app)/analitica/`**, asi que queda sujeto a los censos
  de la 131. Es deliberado: cualquier atajo hacia el servicio o hacia la identidad desde el
  export pone rojo un guardia que ya existe, ademas del nuestro.

---

## 8. Verificacion

- `pnpm exec vitest related --run` sobre los archivos nuevos + `pnpm run test:guardias`
  (los guardias no se seleccionan por grafo de imports).
- `./init.sh --rapido` al cerrar cada tanda; `./init.sh` completo antes del PR.
- E2E (`e2e/analitica-export.spec.ts`): **opcional**. El flujo de descarga no es
  auth/pagos/recaudo/ingesta/webhook, asi que `CHECKPOINTS.md` no lo exige; se propone uno
  minimo que verifique que el click produce un `download` con nombre esperado.

### 8.1 El test de fuga (T3.1) esta BLINDADO — criterio de «NO hecho»

Igual que la 176 blindo su aritmetica, aqui se blinda el unico test que separa un archivo
correcto de una fuga que ya no se puede retirar. **T3.1 NO esta hecha si:**

1. **la asercion se hace sobre el objeto en memoria** (`filas`, `puntos`, `datos`) **y no sobre
   el STRING que devuelve `construirDescarga`**. El fallo que importa es una columna de uuids
   **dentro del fichero**, no un objeto bien formado antes de serializar. Un objeto correcto que
   se serializa mal sigue siendo una fuga, y ese test no la ve;
2. **el repositorio falso devuelve etiquetas ya limpias** (`"Mensajero 1"`, `"m-1"`, nombres).
   Con datos ya inocuos el test pasa **aunque la seudonimizacion no ocurra**: es un verde
   gratuito. La fixture DEBE devolver **uuids de verdad**, y el mismo uuid debe poder buscarse
   literalmente en el string del archivo;
3. **no se ejecuta la cadena completa** (repositorio → `AnaliticaOperativaService` →
   `consultarAnaliticaOperativa` con actor `adminTienda` → proyeccion → `construirDescarga`).
   Cortocircuitar el servicio salta justo la capa que aplica la seudonimizacion;
4. **no se comprobo su mutacion**: retirar `seudonimizarPuntos` del servicio debe poner el test
   **rojo**, y la salida de esa corrida se pega en `progress/impl_134.md` (el servicio se
   restaura acto seguido; la mutacion NO se commitea).

---

## 9. Ficha propuesta para la financiera (la da de alta el leader, no este spec)

D1 dejo fuera la financiera. Para que no se pierda:

| Campo | Valor propuesto |
| --- | --- |
| `name` | `analitica financiera: export de la serie` |
| `description` | Export (CSV/XLSX) de las metricas financieras por el MISMO borde `consultarMetricaFinanciera`, con el patron de descarga 151/148 y las mismas garantias de la 134: puerta unica, denegado auditado, sin cabecera de metadatos con el alcance del actor. Requiere que `AnaliticaFinancieraService` publique una forma de serie estable. |
| `zone` | `frontend` |
| `complexity` | `medium` |
| `depends_on` | **180** (serie temporal financiera) y la ficha **183**; ambas deben estar `done`. |
| `sdd` | `true` |

Motivo de la dependencia, para el dia que alguien la quiera adelantar: hoy
`RespuestaFinanciera` (`lib/types/analitica-financiera.ts`) no expone una serie que proyectar a
filas, y 183 va a cambiar que significan las cifras de caja. Exportar antes de eso es escribir
dos veces la proyeccion, y la segunda con prisa.
