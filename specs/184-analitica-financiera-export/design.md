# 184 — analitica financiera: export de la serie · design

> Lee primero `requirements.md`. Todo hecho de inventario de este documento esta verificado
> leyendo el arbol de `C:/w184` (rama `feature/184-analitica-financiera-export`, nacida de
> `origin/dev` @ `80aa3721`). No se cita ninguna otra sesion, y donde un dato no esta en el
> codigo se dice que no esta.

---

## 1. Frontera: que archivos toca la 184 (y cuales NO)

**Archivos NUEVOS (propiedad exclusiva de la 184):**

| Archivo | Que es |
|---|---|
| `app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas.ts` | Modulo **puro**: los DOS juegos de columnas y la proyeccion de UNA fila. El nombre NO es decorativo: la guardia perenne de la 170 descubre los modulos de columnas **por convencion de nombre** (`*-descarga-columnas.ts`, `tests/unit/descarga/columnas-sensibles.guardia.test.ts:29`) y prohibe que exista ninguna declaracion fuera de ella (`:227-234`). |
| `app/(app)/analitica/_components/export-financiero/export-financiero.ts` | Modulo **puro**: el RECORRIDO `VistaFinanciera → DescargaFila[]` y la seleccion de la vista dentro del `ResultadoFinanciero`. Sin React, sin DOM, sin dominio de servidor. |
| `app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera.tsx` | Componente **cliente** delgado que envuelve `DescargarDatasetButton` (151) y encierra en `obtenerFilas` lo unico que el control no sabe: que metrica y que vista. |
| `tests/unit/analytics/export-financiero-*.test.ts` (5) + `-frontera.guardia.test.ts` + `-alcance.guardia.test.ts` | Los tests y los dos guardias. |
| `tests/unit/descarga/analitica-financiera-descarga-columnas.test.ts` | Clave, encabezado y ORDEN, escritos a mano (molde de la 189). |
| `tests/components/descarga/AnaliticaFinancieraExport.test.tsx` | El control montado. |

**Archivo MODIFICADO (uno solo, y minimo):**

- `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx` — **una insercion**: montar
  `<ExportarVistaFinanciera …/>` dentro de `SeccionVista`, con props **planas** (`string`), cuando
  la vista es temporal. Nada mas: no se toca `ContenidoDeVista`, ni `TEXTOS`, ni ninguna rama de
  decision. **Aceptado por D6** (humano, 2026-08-08) **con su condicion integra**: sin
  `"use client"`, sin prop-funcion, sin nombrar granularidades ni ids de metrica, y con
  `tests/unit/guards/tablero-financiero.guardia.test.ts` verde **sin tocarlo** (R28).

**Archivos que la 184 NO TOCA — verificados uno a uno:**

- `lib/services/AnaliticaFinancieraService.ts`, `lib/repositories/**`, `lib/analytics/**` → la
  **180** ya publica la serie estable (§2.1). **Cero lineas de servidor.**
- `lib/actions/analitica-financiera.ts` → se **consume por su borde**, no se edita. Ahi viven los
  tres pasos (validar sin auditar → auditar → 403 generico) que esta feature hereda intactos.
- `lib/types/analitica-financiera.ts` → contrato de la 127/180/183. No cambia.
- `app/(app)/analitica/_components/financiero/adaptar.ts` → se **importan** `esVistaConNeto` y
  `esVistaTemporal` (§4.2). No se edita: son puros y estan bajo el censo (g) del guardia del tablero.
- `app/(app)/analitica/_components/financiero/rango.ts` → se **importa** el filtro. No se edita.
- `lib/utils/descarga-dataset.ts`, `lib/utils/csv-template.ts`, `lib/types/descarga.ts`,
  `components/shared/DescargarDatasetButton.tsx`, `descargar-blob.ts`, `descarga-resultado.ts`
  → patron 151/170. Se reusa tal cual; tocarlo afectaria a ~25 tablas.
- `app/(app)/analitica/_components/operativo/**` → territorio de la 131/134/176.

### 1.1 Por que el control NO puede vivir en `_components/financiero/`

No es preferencia de reparto: es una **restriccion verificada**. El guardia
`tests/unit/guards/tablero-financiero.guardia.test.ts` **recorre la carpeta entera** (`:116-125`,
`:368-377`: «un archivo nuevo entra en el censo solo») y su censo (a) exige que **ningun** archivo
de ahi declare `"use client"` (`:391-398`). Un control de descarga es por fuerza un componente de
cliente. Meterlo ahi pondria rojo un guardia vivo, y ese guardia tiene razon: la directiva
arrastraria el borde financiero —y con el Prisma— al bundle del navegador.

De ahi el subarbol **hermano** `_components/export-financiero/`. Consecuencia buscada: el censo del
tablero sigue cubriendo la region financiera **sin exenciones**, y el subarbol nuevo trae su propio
guardia (§6).

### 1.2 Los dos guardias nuevos **no caducan**

Los dos **censan el arbol, no el diff**, asi que no llevan cabecera de caducidad: no afirman nada
sobre «lo que esta rama cambio», que es justo lo que se vuelve verde vacio al mergear (leccion de
`frontera.guardia.test.ts`, retirado en el PR #232, y del bloque branch-scoped que la 131 retiro en
el suyo). Cada bloque incluye su **autocomprobacion con fixture sintetico**: un fragmento infractor
en memoria debe dar positivo y una mencion en prosa debe dar negativo. Sin eso serian verdes por vacio.

---

## 2. Inventario verificado (lo que hace barato este diseno)

### 2.1 La serie de la 180 es estable y proyectable a filas TAL CUAL — no hay que estabilizarla

La `status_note` de la ficha decia «requiere que `AnaliticaFinancieraService` publique una forma de
serie estable». **Ya la publica.** Verificado por simbolo, no por linea:

- `AnaliticaFinancieraService.ts:182` — `serieDensa(...)`: **una fila por cubo del rango**,
  incluidos los cubos sin movimiento (⟨D3⟩ de la 180).
- `:360-361`, `:421-422`, `:598` — las vistas temporales declaran
  `granularidad: granularidadDe(consulta.rango)` y sus `filas`.
- `:456`, `:480`, `:510` — las no temporales declaran `"no_temporal"` **explicitamente**.
- `lib/types/analitica-financiera.ts:144-180` — `VistaFinanciera` publica
  `{ id, grano, fuente, sumableCon, filas, granularidad, total }`, y `FilaFinanciera` es
  `{ cubo, importe }` (`:134-138`).
- `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` (`:361-369`) son **siete**: las seis de caja mas
  `cuenta_por_pagar_mensajero`.

**Consecuencia para la ficha: `zone: frontend` se sostiene.** Esta feature no anade ni una linea en
`lib/`, no crea endpoints y no anade migraciones. Si la 180 no hubiera aterrizado, este diseno no
existiria: habria que estabilizar el servicio primero y la ficha seria `fullstack`. **No es el caso.**

### 2.2 La 183 cambio que significan las cifras, y el archivo tiene que reflejarlo

`ImporteAnalitico` es una **union discriminada** por `forma` (`:73-101`):
`ImporteConNeto {bruto, neto, moneda}` vs `ImporteSoloBruto {bruto, moneda}` — y el segundo **no
lleva `neto` ni siquiera en `null`, a proposito: leerlo NO COMPILA**. R18 de la 183 garantiza
ademas que **una vista no mezcla formas** (`:173-179`), lo que hace legitimo elegir el juego de
columnas **por archivo** (§4.2).

Por eso el export **no** puede tener una sola tabla de columnas con `bruto` y `neto`: una columna
de neto vacia significaria «no se sabe» (R15 de la 132) donde la verdad es **«no aplica»** (R19/R23
de la 183). Es exactamente el mismo error que el tablero evito con `columnasDeVista`
(`adaptar.ts:394-396`), y aqui se repite el criterio en vez de inventar otro.

### 2.3 El tablero financiero es 100 % SERVIDOR y el filtro es una constante

- `app/(app)/analitica/page.tsx:103` hace `await cargarTableroFinanciero()` y baja los paneles por
  props; `TableroFinanciero.tsx` no tiene `"use client"` y no fetchea.
- `cargar.ts:93-101` pide las diez metricas con `consultarMetricaFinanciera(id, FILTRO_FINANCIERO_POR_DEFECTO)`.
- `rango.ts:29` — `FILTRO_FINANCIERO_POR_DEFECTO = Object.freeze({ rango: "mes" })`. **No hay barra
  de filtros en la region financiera:** el filtro es una constante congelada y unica.

Dos consecuencias de diseno, y las dos importan:

1. **La «puerta unica» aqui se puede probar por IDENTIDAD REFERENCIAL** (`toBe`), no solo por
   igualdad estructural. El export importa **el mismo objeto** que la pantalla. Es una asercion mas
   fuerte que la de la 134 (que comparaba `aRaw(filtro)`), y la hace posible que el filtro sea
   constante. R2.
2. **Hoy el DTO financiero NO cruza al navegador.** Es la razon principal de §3, alternativa 1.

### 2.4 El patron de descarga da los DOS formatos: no hay que proponer nada

`DescargarDatasetButton` acepta `formatos: DescargaTipo[]` y ofrece menu cuando hay mas de uno
(`:71-72`, `:154-172`), y `construirDescarga` despacha `csv`/`xlsx`. La pregunta «¿el patron 151/148
da los dos?» queda respondida: **si**, y se reusa con `["csv","xlsx"]` (R25). El motivo de ofrecer
XLSX y **no** cambiar el dialecto CSV es D5 de la 134, y el dato concreto se conserva para que
nadie lo «arregle»: `buildCsvRows` emite coma, decimales con punto y UTF-8 **sin BOM**, y eso en
Windows con locale es-EC abre en **una sola columna** y rompe las tildes; ~25 tablas dependen de ese
dialecto.

### 2.5 La guardia de columnas de la 170 ya vigila lo que declaremos, si el archivo se llama bien

`columnas-sensibles.guardia.test.ts` descubre por nombre, revisa clave y encabezado contra una
lista negra (credenciales, tokens, rutas, URL, `*Id`) y **ejecuta la proyeccion con una SONDA** que
delata **que campo lee cada celda** (`:123-136`, `:278-297`). Se hereda sin reimplementar nada (R26).

**Limite conocido, y es la razon de ser de D1:** la sonda mira el **nombre del campo de origen**, no el
valor real. Una celda que lea `fila.cubo` pasa el censo aunque en produccion ese `cubo` sea un
`tiendaId` con forma de uuid. **La sonda no protege de la vista por tienda; R12 si.**

---

## 3. Arquitectura de la solucion

```
page.tsx (Server)                      TableroFinanciero.tsx (Server)
  └─ cargarTableroFinanciero() ──► consultarMetricaFinanciera(id, FILTRO_FINANCIERO_POR_DEFECTO)
        (pinta la pantalla)                     │ borde 127: actor → prepararConsultaAnalitica
                                                │ → AUDITAR denegado → 403 generico → servicio
                                                ▼
                                         SeccionVista  ──props planas (metricaId, vistaId, titulo)──►
                                                                       ExportarVistaFinanciera (Cliente)
                                                                          │ al CLICK
                                                                          ▼
                              ┌── consultarMetricaFinanciera(metricaId, FILTRO_FINANCIERO_POR_DEFECTO)
                              │        (EL MISMO borde, EL MISMO objeto de filtro)
                              ▼
                       filasDeVista()  (PURO)
                              ▼
                       filasLocales()  (tope unico, 170)
                              ▼
             DescargarDatasetButton → construirDescarga → descargarBlob
```

**Una sola puerta, literalmente:** la flecha que alimenta al archivo entra por el **mismo borde**
que la que pinta la pantalla, con el **mismo objeto** de filtro. No hay segunda flecha hacia el
servicio ni hacia la base, y no hay una segunda traduccion del filtro.

### 3.1 Cuando se leen los datos, y por que NO se exportan las props

El control **re-invoca el borde en el momento del click**. No se pasa el DTO ya cargado por props.
Dos razones, y la segunda es especifica de esta region:

1. **Sin llamada nueva no hay 403 nuevo y no hay nada que auditar** (R6/R7). Si el permiso caduca
   entre el render y el click, exportar desde memoria produciria un archivo perfectamente valido de
   datos que el usuario **ya no tiene derecho a descargar**, y sin rastro. Es el mismo motivo por
   el que la 134 descarto su alternativa 4.
2. **Pasar el DTO por props cruzaria el dinero a la frontera RSC.** Hoy no cruza: la region es
   entera de servidor (§2.3). Serializar `ResultadoFinancieroVistas` hacia un componente cliente
   pondria las cifras financieras —y en las vistas por tienda, los `tiendaId`— en el **payload RSC
   del navegador** de todo el que abra la pagina, tenga o no intencion de descargar. **Eso es
   exposicion nueva a cambio de nada.**

Consecuencia aceptada y declarada: el archivo puede diferir de la pantalla en el ultimo cubo si
pasan minutos entre el render y la descarga. El archivo no promete ser la foto de la pantalla, sino
**el mismo dato para el mismo alcance y el mismo filtro**.

---

## 4. Contratos

### 4.1 Contrato I/O

- **Entrada del control (props planas, R28):** `{ metricaId: string; vistaId: string; titulo: string }`.
  Ninguna es una funcion. `metricaId` y `titulo` salen de la cabecera del DTO que la seccion ya
  pinta (`datos.metricaId`, `datos.etiqueta`); `vistaId` es `vista.id` — **id de VISTA, no de
  METRICA**, que es la distincion que el censo (f) del guardia del tablero declara legitima
  (`tablero-financiero.guardia.test.ts:217-249`).
- **Entrada del borde:** `(metricaId, FILTRO_FINANCIERO_POR_DEFECTO)` — **dos** argumentos. Nunca
  `deps` (R5).
- **Salida:** `DescargaArchivo` de `lib/types/descarga.ts`, entregado por `descargarBlob`.
- **Seleccion de la vista:** `datos.vistas.find(v => v.id === vistaId)`, y ademas
  `esVistaTemporal(vista)` (R12). Si no hay vista, o no es temporal, **no hay archivo** y se dice.
  Se selecciona por id explicito y no «la primera temporal» para que el resultado sea determinista
  aunque una metrica gane vistas.

### 4.2 Las columnas — DOS juegos, elegidos por la FORMA del importe

Un archivo por vista (**D5**), asi que el juego de columnas se elige **por archivo**, que es legitimo
porque R18 de la 183 garantiza que una vista no mezcla formas. Es el mismo criterio que
`columnasDeVista` (`adaptar.ts:394-396`), repetido en vez de reinventado.

```ts
// app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas.ts

/** Vista cuyos importes publican los dos campos (R13). */
export const COLUMNAS_DESCARGA_ANALITICA_FINANCIERA: DescargaColumna[] = [
  { clave: "periodo",              encabezado: "Periodo" },              // fila.cubo, LITERAL
  { clave: "grano",                encabezado: "Grano" },                // R15: dia | semana
  { clave: "metrica",              encabezado: "Metrica" },              // datos.etiqueta
  { clave: "bruto",                encabezado: "Bruto" },                // string escala 2 (R18)
  { clave: "neto",                 encabezado: "Neto" },                 // string escala 2 (R18)
  { clave: "moneda",               encabezado: "Moneda" },               // R17, del propio importe
  { clave: "cifra",                encabezado: "Tipo de cifra" },        // R16: flujo | saldo al corte
  { clave: "limitacion_conocida",  encabezado: "Limitacion conocida" },  // D3 / R30
];

/** Vista `solo_bruto` (R13): la columna de neto NO EXISTE, en vez de existir vacia. */
export const COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO: DescargaColumna[] = [
  /* las mismas, SIN `neto` */
];

export function filaDescargaAnaliticaFinanciera(
  contexto: { etiqueta: string; granularidad: string; esAcumulado: boolean },
): (fila: FilaFinanciera) => DescargaFila;
```

Reglas de la proyeccion:

- **una fila por `vista.filas[]`, en el orden recibido**; ni se filtra, ni se rellena, ni se
  reordena, ni se agrupa la cola (R19/R20). La serie de la 180 es **densa a proposito**: los cubos
  sin movimiento valen cero (⟨D3⟩) y ese cero **es un dato**, no un hueco que limpiar;
- `periodo` = `fila.cubo` **literal**. No se traduce, no se acorta y **no se calcula el fin del
  cubo**: el DTO no lo publica, y el primero y el ultimo estan truncados al rango, asi que un rango
  calculado seria falso justo en los dos extremos (⟨D4⟩ de la 186, `adaptar.ts:252-275`);
- `grano` = `vista.granularidad`, copiada **tal cual del DTO**. El subarbol de export **no escribe
  los valores** `"dia"`/`"semana"` en ningun sitio, para no crear un segundo hablante del
  vocabulario que el censo (g) del guardia del tablero centraliza en `adaptar.ts`;
- `bruto`/`neto` = **la cadena del DTO, literal** (R18). Sin `Number`, sin `toFixed`, sin separador;
- `moneda` = `importe.moneda` (R17). Ni un codigo ISO ni un simbolo escritos a mano;
- `cifra` = derivada de `datos.esAcumulado` (R16), **del DTO y no de una lista de ids**, igual que
  el rotulo «saldo al corte» de `CabeceraPanel` (`TableroFinanciero.tsx:178-181`);
- `limitacion_conocida` = una **constante exportada** del modulo, identica en todas las filas
  (**D3**, R30). Declara que el ultimo cubo del rango **puede estar en curso**, porque el DTO no lo
  dice: Q2 de la 180 decidio no marcarlo para no meterle un reloj al servicio y no romper su
  determinismo.

  > **AVISO PARA QUIEN PASE POR AQUI: esta es la UNICA celda del archivo cuyo texto no sale del
  > DTO, y esta puesta a proposito. No la borres creyendola un descuido.** Roza R11, y por eso R11
  > la nombra como **excepcion unica** y su test comprueba que no aparezca una segunda. La cabecera
  > del modulo de columnas repite este aviso, que es donde de verdad lo va a leer el siguiente.

**Lo que NO hay en el archivo, y no es un olvido:**

- **cabecera de metadatos** (R10 / D4 de la 134). La fecha ya viaja en el nombre
  (`nombreArchivoDescarga`). Y el motivo importa mas que la decision: escribir ahi el
  `tiendaId`/`zonaId` del actor como «alcance» meteria en un archivo que circula **justo la clase
  de identificador que todo lo demas mantiene fuera**;
- **ninguna columna de identidad**: ni tienda, ni mensajero, ni cierre. Con **D1** no hay ninguna a
  la que dar nombre, porque la clave del cubo es una fecha por construccion;
- **ninguna columna `desde`/`hasta`** con el rango consultado (**D4**);
- **ninguna marca de cubo parcial calculada en el cliente** (**D3**, alternativa descartada).

### 4.3 Estados que NO producen archivo

| Resultado del borde | Archivo | Mensaje | Auditoria |
|---|---|---|---|
| `forbidden` | ninguno | «no tienes acceso…» (texto propio, ≠ sin datos) | **si**, en el borde, ANTES de responder |
| `validation_error` | ninguno | cabecera + claves de campo | **no** (R8) |
| `error` | ninguno | el mensaje ya saneado del borde | no |
| `ok` sin la vista pedida / vista no temporal | ninguno | texto propio (R12) | no |
| `ok` con 0 filas | ninguno | «no hay datos…» (lo pone el control comun, 151) | no |
| filas > `MAX_FILAS` | ninguno | mensaje accionable con total y tope (`filasLocales`) | no |

Los textos son **distintos entre si**. Fundir los dos primeros es la mutacion de R6. El texto de
«sin datos» **no se replica** en este subarbol: lo pone `DescargarDatasetButton` (`:50-51`), y
copiarlo aqui seria la forma de que un dia dejen de ser distintos.

---

## 5. Modelo de datos, migraciones, RLS, endpoints

- **Migraciones: NINGUNA.** No se crean ni alteran tablas ni columnas. No hay `down.sql` porque no
  hay `migration.sql`.
- **RLS: sin cambios.** El aislamiento de analitica es el de la 122 (`prepararConsultaAnalitica`,
  tipo opaco con `unique symbol` **no exportado**: el export no podria forjar una consulta aunque
  quisiera, no compilaria). Su design ya declara que no hay policies de Postgres para esto, y esa
  deuda de defensa en profundidad **no se abre ni se cierra aqui**.
- **Endpoints: NINGUNO.** Cero rutas bajo `app/api/` (R3).
- **Server Actions: NINGUNA nueva.** Se consume `consultarMetricaFinanciera` (127).
- **Config:** `descargaConfig.MAX_FILAS` (default 5000). No se introduce un segundo tope. Nota: con
  la serie de la 180 el maximo real son **62 filas** (`MAX_PUNTOS_SERIE`), asi que el tope no se
  alcanzara; se aplica igual, porque tener **un** tope y no dos es el punto.

---

## 6. Los dos guardias, bloque a bloque

**`export-financiero-frontera.guardia.test.ts`** (censo de arbol, con autocomprobacion en cada bloque):

1. el subarbol de export no importa servicio, repositorio, Prisma, `next/headers` ni
   `resolve-actor` (R1);
2. ninguna ruta de `app/api` menciona el export de analitica financiera (R3);
3. ningun modulo con `"use server"` invoca `construirDescarga` (R4);
4. produccion invoca el borde con **dos** argumentos (R5);
5. el subarbol no escribe presets de rango ni fechas (R2);
6. el subarbol no decide por el id de ninguna metrica financiera — mismo mecanismo y mismos ids
   importados que el censo (f) del guardia del tablero (R14);
7. el subarbol no escribe listas de roles ni condiciones de permiso (R27);
8. no existe generador CSV ni conversion de dinero a `number` dentro de `app/(app)/analitica/**`
   (R18, R23);
9. el modulo de columnas sigue la convencion de nombre **y** la guardia de la 170 lo carga (R26).

**`export-financiero-alcance.guardia.test.ts`** (§4.2 de `requirements.md`, R10 y R12): censo del
vocabulario del alcance, contrato de columnas contra lista escrita a mano, asercion sobre el
**TEXTO** del archivo, y el caso de la vista no temporal con cubos con forma de uuid.

**Guardias vivos que deben seguir VERDES sin tocarlos:**
`tests/unit/guards/tablero-financiero.guardia.test.ts` (los siete censos, R28) y
`tests/unit/descarga/columnas-sensibles.guardia.test.ts` (la sonda, R26).

---

## 7. Alternativas descartadas

1. **Exportar el DTO que la pantalla ya tiene, pasandolo por props al control.** Es lo mas barato y
   produce equivalencia exacta con lo pintado. **Descartada por dos motivos independientes:**
   (a) sin llamada nueva no hay 403 nuevo y **no hay nada que auditar** (R6/R7), que es el agujero
   que la 134 declaro en su alternativa 4; (b) **aqui es ademas exposicion nueva**: la region
   financiera es hoy 100 % servidor (§2.3) y el dinero **no cruza** al navegador; pasarlo por props
   lo pondria en el payload RSC de todo el que abra la pagina. Un export no deberia empeorar la
   exposicion de quien **no** exporta.

2. **Un route handler `app/api/analitica/financiera/export/route.ts` con `Content-Disposition`.**
   Es la forma «natural» de descargar y la que mas cuesta descartar. Descartada por tres razones
   verificadas: (a) `docs/architecture.md` reserva los route handlers para webhooks, API publica y
   crons; (b) el patron 151 **no usa route handler** en ninguna de sus ~25 tablas; (c) seria una
   **segunda superficie de gating**, con su propio parseo y su propia forma de olvidarse de auditar
   el denegado — el pecado exacto contra el que advierte §7 de la 122, y la razon por la que la 176
   reuso `denegar()` en vez de duplicarlo. Si algun dia el volumen lo exige, es otra ficha con su
   propia puerta.

3. **Una Server Action nueva `exportarAnaliticaFinanciera` que devuelva el archivo armado.**
   Descartada: obligaria a tocar `lib/actions/analitica-financiera.ts`, duplicaria los tres pasos
   del borde —incluida la auditoria previa al 403, que es justo lo que no se debe reescribir— y no
   compra nada: el navegador ya sabe armar CSV y XLSX.

4. **Un archivo unico con las siete metricas de la serie.** Descartada (**D5**): mezclaria **flujos** y
   **saldos al corte** en una hoja —la peor confusion posible en un archivo de dinero— y obligaria
   a siete llamadas encadenadas antes de producir nada.

5. **Un unico juego de columnas con `bruto` y `neto`, dejando el neto vacio donde no aplica.** Es
   lo primero que apetece porque simplifica el modulo. Descartada por R19/R23 de la 183: la celda
   ausente significa «no se sabe» (R15 de la 132) y aqui la verdad es **«no aplica»**. Un archivo
   que circula con una columna «Neto» vacia se lee como un dato que se perdio.

6. **Convertir los importes a `number` para que Excel los sume solo.** Descartada (**D2**): crearia una
   **segunda frontera string→number** —hoy hay exactamente una, `aNumero`, declarada «solo para
   pintar, nunca para calcular»— y su `null` en el no finito se leeria en el archivo como «no se
   sabe». Coste declarado: en Excel es-EC la columna puede llegar como texto.

7. **Un dialecto CSV propio (`;` + BOM) para que Excel es-EC abra en columnas.** Descartada por D5
   de la 134: crearia **dos CSV distintos** en la misma app (~25 tablas usan el otro). La salida es
   ofrecer tambien XLSX en el mismo control, que abre perfecto.

8. **Meter el control en `_components/financiero/` y relajar el guardia.** Descartada: §1.1. El
   guardia tiene razon —la directiva de cliente ahi arrastraria el borde financiero al navegador—,
   y relajar un censo para caber en el es como se pierden los censos.

9. **Resolver el nombre de la tienda dentro del export para poder exportar los cubos por tienda.**
   Descartada: es la ficha **181** (`pending`), es `fullstack` y toca el DTO de los servicios. Un
   export que resolviera ids a nombres violaria R11 y meteria acceso a datos en una feature de
   presentacion. La 184 **no la resuelve y no la hereda**: la excluye por R12, con su motivo escrito.

10. **Exportar tambien los cubos por tienda con el `tiendaId` crudo.** Descartada por **D1**: un
    identificador que sale a un archivo que circula no se puede retirar despues. Y la sonda de la
    guardia de la 170 **no lo veria**, porque la celda leeria `fila.cubo` (§2.5).

11. **Declarar el rango consultado en dos columnas constantes.** Descartada por **D4**: no filtra
    nada por si misma, pero es la primera piedra de una cabecera de metadatos en un archivo cuya
    unica constante admitida es la limitacion de D3.

---

## 8. Riesgos

- **R12 es lo unico que mantiene el `tiendaId` crudo fuera del archivo.** Cerrado por **D1**, pero
  el riesgo no desaparece: es el unico que puede acabar en un archivo circulando con
  identificadores, y su unica defensa es un requisito **ejecutable** (el caso de la vista no
  temporal con cubos uuid, T6.2). Ampliar el alcance del export sin reabrir D1 lo reabre de hecho.
- **`TableroFinanciero.tsx` es de la 132/186.** Conflicto de merge esperado y trivial (una
  insercion de JSX). El riesgo real no es textual sino de guardia: la insercion debe pasar los
  siete censos de `tablero-financiero.guardia.test.ts` sin tocarlo (R28).
- **El subarbol de export queda bajo el censo de la 170** y bajo el suyo propio. Es deliberado:
  cualquier atajo hacia el servicio, hacia la identidad o hacia un id de metrica pone rojo un
  guardia que ya existe, ademas del nuestro.
- **Los guardias pueden nacer verdes por vacio.** Mitigado con autocomprobacion por fixtures en
  **todos** los bloques (§1.2), obligatoria en T6.
- **La numeracion «184» esta ocupada en el codigo por la 188.** Ver el aviso de `requirements.md`
  §0: los comentarios de esta feature se rotulan con nombre, no solo con numero.
- **Ninguna de estas siete metricas tiene barra de filtros.** El archivo siempre sale del preset
  `mes`. Si un dia la region gana filtros, R2 sigue siendo cierto por construccion (se importa lo
  que la pantalla use), pero el test de identidad referencial habra que reescribirlo contra el
  filtro del usuario. Declarado para que quien lo toque sepa que no es una regresion.

---

## 9. Verificacion

- `pnpm exec vitest related --run` sobre los archivos nuevos **mas** `pnpm run test:guardias`: los
  guardias **no** se seleccionan por grafo de imports, asi que `related` solo no los corre.
- `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del PR, sin excepcion.**
- E2E: **opcional**. El flujo de descarga no es auth/pagos/recaudo/ingesta/webhook, asi que
  `CHECKPOINTS.md` no lo exige.

### 9.1 Los dos tests BLINDADOS — criterio de «NO hecho»

Igual que la 134 blindo su test de fuga, aqui se blindan los dos que separan un archivo correcto de
un problema que no se puede retirar.

**T-A (R7, el orden de la auditoria) NO esta hecha si:**

1. **solo cuenta llamadas al espia** en vez de afirmar la **secuencia** `["auditoria","respuesta"]`.
   Contar llamadas pasa igual si el registro ocurre despues del 403, que es exactamente el defecto;
2. **no atraviesa el borde real**: mockear `consultarMetricaFinanciera` y devolver `forbidden` a
   mano prueba el mensaje, no el orden. La cadena tiene que ser
   `deps.getActor` (rol prohibido) → borde real → `describirDenegado` → espia;
3. **no se comprobo su mutacion**: invertir las dos sentencias del borde debe poner el test
   **rojo**, y la salida de esa corrida se pega en `progress/impl_184.md` (el borde se restaura
   acto seguido; la mutacion NO se commitea).

**T-B (R10/R12, nada del alcance ni ningun identificador en el archivo) NO esta hecha si:**

1. **la asercion se hace sobre el objeto en memoria** y no sobre el **STRING** que devuelve
   `construirDescarga`. Un objeto correcto que se serializa mal sigue siendo una fuga, y ese test
   no la ve;
2. **la fixture trae cubos ya inocuos** (fechas en todos los casos). El caso de la vista no
   temporal DEBE traer **uuids de verdad**, y el mismo uuid debe poder buscarse literalmente en el
   string —o comprobarse que **no hay archivo**—;
3. **el censo de columnas se compara contra la propia constante** (`COLUMNAS.map(...)` a los dos
   lados). Es la tautologia que el repo lleva semanas cazando y que `progress/impl_189.md` §4
   documenta con un caso real (`COLUMNAS_DESCARGA_RANKING`).
