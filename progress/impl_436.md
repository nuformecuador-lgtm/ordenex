# Ficha 436 — el asistente. Bitácora de la ficha (las TRES pasadas)

**Rama:** `feat/436-asistente`. **Zona:** fullstack. **Fecha:** 2026-09-17.

| pasada | qué trajo | commit |
| --- | --- | --- |
| **1 — servidor** | puerto, adaptador, doble, módulos puros, configuración, migración, repositorio, servicio, borde HTTP y tres guardias | `e53bcb1c` |
| **2 — pantalla** | provider, panel, adjuntar imagen, el «?» convertido en disparador, guardia estructural | `5339bcf2` |
| **3 — cierre de la revisión** | `B1` (aviso de datos) en `15d0183e`; `B2`/`B3`/`B4` y los cinco menores, en este commit | `progress/review_436.md` |

> **Esta bitácora estuvo mintiendo por omisión** hasta la tercera pasada: era la de la pasada 1 y
> declaraba R22, R26 y R28 **sin hacer** cuando sus tests ya existían (hallazgo `B4` de la revisión).
> El mapa de §3 ahora cubre los **33** requisitos —31 del spec más R32 y R33, que nacieron de la
> revisión— y las desviaciones de las tres pasadas están en §5bis.

> **Lo primero que pasó en la pasada 1, y cambia cómo se lee todo lo demás:** la rama estaba **6
> commits por detrás de `dev`** y se mergeó antes de escribir una línea.

> Sin ese merge, `lib/ayuda/documento.ts` no tenía `puedeLeerDocumento` —el predicado de **LECTURA**
> de la 435, que es el que Q1 decidió usar— y el corazón de la ficha habría quedado colgado del
> estricto sin que nada lo dijera. Commit de merge: `51624b59`.

---

## 1. Las siete preguntas (T0), tal y como se implementaron

Vienen resueltas de `progress/decisiones_436.md` (leader, 2026-09-17). Se repiten aquí con **dónde
vive cada una en el código**, que es lo que hace falta para revisarlas.

| | Decisión | Dónde está |
| --- | --- | --- |
| **Q1** | predicado de **LECTURA** | `lib/asistente/contexto.ts` importa `documentosQuePuedeLeer`; nunca lo reimplementa |
| **Q2** | **30 consultas/persona/día**, configurable | `ASISTENTE_MAX_CONSULTAS_DIA_DEFAULT` en `lib/config/asistente.ts`; el texto, en `mensajeTopeAlcanzado` |
| **Q3** | el «?» abre el panel (opción A) | **pasada de frontend**; el servidor ya entrega `partida` en el evento `inicio` |
| **Q4** | `/configuracion/sinpe` + `adminSatelite` se queda sin «?» | nada que hacer en servidor; queda como está |
| **Q5** | la conversación NO se guarda; el «no lo sé» **sí se cuenta** | columna `no_lo_se`; `AsistenteService.conSenalDeNoLoSe` + `pareceNoLoSe` |
| **Q6** | **una** imagen por mensaje, **5 MB**, cuenta una consulta | `ASISTENTE_IMAGEN_*` y el `zod` del borde; medido en `tests/integration/asistente-imagenes.test.ts` |
| **Q7** | la credencial existe y está probada | `.env` en local; **NO en Vercel** — T25/T26 siguen abiertas |

**T1 — H1 recomprobado antes de tocar nada.** `next.config.ts:59-61` sigue declarando
`outputFileTracingIncludes: { "/**": ["./docs/ayuda/**/*.md"] }`. **No hay nada que añadir** y no se
tocó. Lo que faltaba —que nada ataba la ruta del asistente a ese catálogo— es R31, y está hecho.

---

## 2. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/interfaces/external/IAsistenteProvider.ts` | **El puerto.** Cero imports: ni `next/*`, ni Prisma, ni `process.env` |
| `lib/clients/anthropic-asistente.ts` | El adaptador (`/v1/messages`, SSE). `fetch` y credencial inyectables |
| `lib/config/asistente.ts` | Credencial, modelo, tope, timeout, topes de imagen. Nunca lanza |
| `lib/asistente/contexto.ts` | Puro: catálogo + rol → documentos del contexto (+ documento de partida) |
| `lib/asistente/instrucciones.ts` | Puro: el texto de sistema y la señal de «no lo sé» |
| `lib/asistente/citas.ts` | Puro: marcador → enlace, validando contra el conjunto entregado |
| `lib/asistente/protocolo.ts` | Puro: los eventos del stream y su NDJSON |
| `lib/interfaces/services/IAsistenteService.ts` | Contrato del servicio |
| `lib/services/AsistenteService.ts` | Orquesta: rol → tope → contexto → proveedor → trozos |
| `lib/interfaces/repositories/IAsistenteUsoRepository.ts` | Contrato del contador |
| `lib/repositories/AsistenteUsoRepository.ts` | El contador. **Único acceso a datos de la ficha** |
| `app/api/asistente/route.ts` | El borde: sesión, zod `.strict()`, NDJSON en streaming |
| `db/migrations/20260920120000_asistente_uso_diario/{migration,down}.sql` | La tabla del tope |

### Modificados

`db/schema.prisma` (modelo `AsistenteUsoDiario` + la relación en `Usuario`), `.env.example` (las
cuatro variables con su comentario), y **cinco archivos de test que son censos del árbol** — ver §5.

### Tests creados

`tests/unit/asistente/` (`_doble-proveedor.ts` + 7 archivos), `tests/integration/asistente-route.test.ts`,
`tests/integration/asistente-imagenes.test.ts`, `tests/integration/db/asistente-uso-diario.int.test.ts`,
y tres guardias nuevas en `tests/unit/guards/`.

### Pasada 2 — la pantalla (`5339bcf2`)

| Archivo | Qué es |
| --- | --- |
| `providers/AsistenteProvider.tsx` | Apertura y conversación, **sólo en el cliente**: los turnos son `useState`, y eso ES R30 |
| `components/shared/AsistentePanel.tsx` | El panel, montado UNA vez desde `app/(app)/layout.tsx` como **hermano** de `{children}` |
| `tests/components/AsistentePanel.test.tsx` | R22, R25, R27, R28, R29, R30 en pantalla |
| `tests/unit/guards/asistente-panel-hermano.guardia.test.ts` | La forma del árbol: el panel no envuelve la página |
| `components/shared/AyudaBoton.tsx`, `app/(app)/layout.tsx` | El «?» pasa de `<Link>` a disparador (T17) |

### Pasada 3 — cierre de la revisión (este commit)

| Archivo | Qué cambió |
| --- | --- |
| `lib/asistente/instrucciones.ts` | **R32**: `instruccionesDelSistema(rol)` con el bloque «QUIÉN TE PREGUNTA» y `QUIEN_PREGUNTA` |
| `lib/services/AsistenteService.ts` | Le pasa `actor.rol` a las instrucciones y **el tope al contador**; trata el `null` como rechazo |
| `lib/interfaces/repositories/IAsistenteUsoRepository.ts` | `consumirUnaConsulta(usuarioId, fecha, tope): Promise<number \| null>` |
| `lib/repositories/AsistenteUsoRepository.ts` | El tope entra en el `WHERE` del `ON CONFLICT DO UPDATE` (`m2`) |
| `lib/config/asistente.ts` | **R33**: `ASISTENTE_IMAGENES_MAX_POR_PETICION` y `mensajeDemasiadasImagenes` |
| `app/api/asistente/route.ts` | El tope de imágenes por petición, y **la mina del quitador naíf fuera** (`m6`) |
| `lib/asistente/citas.ts` | `textoSinMarcadores` se lleva el hueco de la cita (`m1`) |
| `tests/unit/guards/asistente-sin-datos.guardia.test.ts` | La guardia «sin red» cubre el módulo entero, **y ninguna invocación del handler en `tests/**` puede ir sin doble** (`m4`) |
| `tests/unit/asistente/{instrucciones,citas,tope-diario,peticion-al-proveedor}.test.ts`, `tests/integration/{asistente-route,asistente-imagenes}.test.ts`, `tests/integration/db/asistente-uso-diario.int.test.ts` | Los casos nuevos y las firmas |
| `specs/436-asistente/{requirements,design,tasks}.md` | R32/R33, la corrección de §4.2 y las tareas marcadas |

---

## 3. Mapa `R<n>` → test — **los 33, todos hechos**

**Los 31 del spec más R32 y R33**, que la revisión añadió. Ninguno queda a medias: las columnas de
«FRONTEND pendiente» que esta tabla tuvo hasta la tercera pasada ya no existen porque esos tests
existen y se corrieron uno a uno.

| # | Estado | Test |
| --- | --- | --- |
| R1 | ✅ | `tests/unit/asistente/contexto-documental.test.ts` — cada cuerpo se compara **carácter a carácter** con el `.md` del disco |
| R2 | ✅ | `tests/unit/guards/asistente-sin-frontmatter.guardia.test.ts` — y no sólo la palabra `fuentes:`: **ninguna de las 100+ rutas de código que ese campo declara** |
| R3 | ✅ | `tests/unit/guards/asistente-sin-datos.guardia.test.ts` — con canario en las dos direcciones |
| R4 | ✅ | `tests/unit/asistente/peticion-al-proveedor.test.ts` — `'tools' in cuerpo === false`, y sin `thinking` |
| R5 | ✅ | `tests/unit/asistente/instrucciones.test.ts` — por su literal |
| R6 | ✅ | `tests/unit/asistente/peticion-al-proveedor.test.ts` — exactamente un `cache_control`, en el último bloque de documentación |
| R7 | ✅ | `tests/integration/asistente-route.test.ts` — el mismo cuerpo con dos sesiones distintas da 8 y 33 documentos; **más** un caso ESTRUCTURAL que exige que `rol` se asigne una sola vez y desde `actor.rol` |
| R8 | ✅ | `tests/integration/asistente-route.test.ts` — `rol`/`slugs`/`documentos`/`consultasHoy` → **422**, y con el cuerpo limpio el contexto sigue siendo el suyo |
| R9 | ✅ | `tests/unit/asistente/acotamiento-por-rol.test.ts` — derivado del catálogo y del predicado **importado** |
| R10 | ✅ | idem — 33/33/10/8/7, **literales a mano**, los mismos que afirma `AyudaLayout.test.tsx` |
| R11 | ✅ | idem — cero slugs de oficina y **cero líneas** (≥40 caracteres) de los 18 documentos de `docs/ayuda/oficina/` |
| R12 | ✅ | `tests/integration/asistente-route.test.ts` + `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` (control ampliado a TRES rutas) |
| R13 | ✅ | `tests/unit/asistente/tope-diario.test.ts` (proveedor **y contador** sin tocar) + la ruta (403) |
| R14 | ✅ | `tests/unit/asistente/tope-diario.test.ts` — y la consulta **número 30** todavía entra |
| R15 | ✅ | idem — `expect(proveedor.llamadas).toEqual([])`, más el 409 con su mensaje en la ruta |
| R16 | ✅ | `tests/integration/db/asistente-uso-diario.int.test.ts` — contra Postgres real, con el borde de medianoche de Costa Rica |
| R17 | ✅ | idem — dos consultas retenidas en la MISMA ventana dejan `consultas = 2`, **y en el tope no se escribe nada**: tres intentos por encima dejan la fila en 3, no en 6 (revisión, `m2`) |
| R18 | ✅ | `tests/integration/asistente-route.test.ts` |
| R19 | ✅ | `tests/integration/asistente-route.test.ts` — el test lee los tres trozos **antes** de que el doble termine |
| R20 | ✅ | `tests/unit/asistente/sin-credencial.test.ts` (+ el 500 con mensaje propio en la ruta) |
| R21 | ✅ | `tests/unit/asistente/errores-no-filtran.test.ts` (6 códigos HTTP + fallo de red) y el cuerpo de la ruta |
| R22 | ✅ | `tests/components/AsistentePanel.test.tsx` + `tests/unit/guards/asistente-panel-hermano.guardia.test.ts` — con la ruta caída el panel pinta su error y la página sigue en pie; y la guardia exige que el panel sea HERMANO de `{children}`, nunca su envoltorio. El servidor hace su mitad: el fallo viaja como línea `{"tipo":"error"}`, nunca como excepción |
| R23 | ✅ | `tests/unit/asistente/citas.test.ts` — con los slugs REALES del catálogo |
| R24 | ✅ | idem — un slug de oficina en una respuesta de mensajero se descarta; uno inexistente también. **Y en pantalla**: el panel no pinta ni el enlace ni el nombre del documento ajeno |
| R25 | ✅ | `citas.test.ts` (sin marcadores no hay citas) **y** `AsistentePanel.test.tsx` (no se pinta sección de fuentes), con la contraprueba de que con marcador válido SÍ se pinta |
| R26 | ✅ | `tests/components/AyudaBoton.test.tsx` — las 8 aserciones de `href` migradas a mano, el `href` re-anclado DENTRO del panel, y cuatro casos nuevos que miden que **abre** |
| R27 | ✅ | servidor (`documentoDePartida` + `partida` del evento `inicio`) **y** panel: abierto desde `/mis-asignaciones/reparto`, la primera acción es la ayuda de esa pantalla, medida por posición en el DOM |
| R28 | ✅ | `tests/components/AsistentePanel.test.tsx` — el aviso nombra **las dos mitades** («lo que escribís» y «las imágenes que adjuntás»), afirmadas POR SEPARADO, sin `<details>` y sin condición. Cerrado en `15d0183e` (`B1`) |
| R29 | ✅ | `tests/integration/asistente-imagenes.test.ts` (lista blanca, **audio con 422**, una por mensaje, 5 MB) **y** el panel: hay control de imagen, `accept` sin audio, ningún control de grabación |
| R30 | ✅ | `tests/unit/guards/asistente-sin-persistencia.guardia.test.ts` + el censo de columnas contra la base **y** el cliente: desmontar y montar pierde la conversación, con espías de almacenamiento y cookie |
| R31 | ✅ | `tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts` — la ruta existe, su única vía es `lib/ayuda/catalogo.ts`, y la clave sigue siendo `/**` |
| **R32** | ✅ **nuevo** | `tests/unit/asistente/instrucciones.test.ts` (los cinco roles, por literal a mano) **y** `tests/integration/asistente-route.test.ts` (mismo cuerpo, dos sesiones, medido sobre lo que recibe el proveedor) |
| **R33** | ✅ **nuevo** | `tests/integration/asistente-imagenes.test.ts` — cinco imágenes en cinco mensajes → 422 con el proveedor **sin llamar** y un mensaje que dice cuántas caben; con cuatro, 200 |

---

## 4. Las mutaciones, con su rojo

Cada una se **ejecutó** y se pega el mensaje real del test que la mató. Ninguna es el veredicto de
un arnés: son corridas de `vitest` sobre el árbol mutado, y después se restauró el archivo y se
volvió a ver el verde.

### M1 — se desactiva el acotamiento por rol (los 33 a todo el mundo)

`lib/asistente/contexto.ts`: `documentosQuePuedeLeer(docs, rol)` → `[...docs]`.
**10 de 13 casos rojos** en `acotamiento-por-rol.test.ts`, más 4 en la ruta y 1 en el contexto.

```
FAIL tests/unit/asistente/acotamiento-por-rol.test.ts > R9 ... > ⭑ para los cinco roles, el
contexto es exactamente lo que ese rol PUEDE LEER en /ayuda
AssertionError: mensajero: expected [ 'compartido/analitica', …(32) ] to deeply equal
  [ 'mensajero/cierre-del-dia', …(7) ]
+   "oficina/wallet-caja",
+   "oficina/wallet-mensajeros",
    … (25 documentos más que no son suyos)
```

Y el caso que el leader pidió por su nombre —**un mensajero no recibe ni una línea de la ayuda de
Wallet**—:

```
FAIL ... > R11 — un mensajero no recibe NI UNA LÍNEA de la ayuda de la oficina >
  ⭑⭑ NI UNA LÍNEA: ninguna frase de ninguno de los 18 aparece en lo que se envía
AssertionError: expected [ …(339) ] to deeply equal []
```

**339 líneas** de la ayuda de la oficina en la petición de un mensajero. Y el caso específico de la
caja:

```
FAIL ... > ⭑⭑⭑ y en particular la CAJA: ni el título ni una sola línea de wallet-caja.md
AssertionError: expected 'Sos el asistente de ayuda de Ordenex,…' not to contain 'oficina/wallet-caja'
```

### M2 — el tope deja de contar (se comprueba DESPUÉS de llamar al proveedor)

`lib/services/AsistenteService.ts`: el `if (consultasHoy > tope)` se mueve detrás de
`proveedor.responder(...)`. **3 rojos**, y el que importa dice exactamente lo que pasó:

```
FAIL tests/unit/asistente/tope-diario.test.ts > R15 — en el tope se rechaza ANTES de llamar al
proveedor > ⭑⭑ la 31 de 30: desenlace `tope_alcanzado` Y `llamadas` VACÍO
AssertionError: expected [ { …(3) } ] to deeply equal []
```

El desenlace **seguía siendo** `tope_alcanzado` —o sea, un test que sólo mirara el desenlace habría
pasado en verde—; lo que se rompe es `proveedor.llamadas`, que es la propiedad de verdad: se pagó la
consulta y luego se dijo que no.

### M3 — una cita que NO está en el conjunto entregado deja de descartarse

`lib/asistente/citas.ts`: `if (doc === undefined) continue;` → se acepta cualquier slug. **3 rojos**:

```
FAIL tests/unit/asistente/citas.test.ts > R24 ... > ⭑⭑ un slug de OFICINA en una respuesta de
mensajero no pinta ningún enlace
AssertionError: expected [ { …(3) } ] to deeply equal []
+   {
+     "href": "/ayuda/oficina/wallet-caja",
+     "slug": "oficina/wallet-caja",
+     "titulo": "oficina/wallet-caja",
+   },
```

### M4 — `upsert` atómico → leer-y-luego-escribir

`lib/repositories/AsistenteUsoRepository.ts`: `INSERT … ON CONFLICT DO UPDATE … RETURNING` →
`SELECT` y luego escribir el valor leído + 1.

```
FAIL tests/integration/db/asistente-uso-diario.int.test.ts > ⭑⭑ R17 — DOS CONSULTAS SIMULTÁNEAS,
retenidas en la misma ventana, dejan `consultas = 2`
AssertionError: expected [ 1, 1 ] to deeply equal [ 1, 2 ]
```

> ⚠️ **Y ESTA MUTACIÓN SOBREVIVIÓ DOS VECES ANTES DE MORIR, lo cual es el hallazgo más útil del
> día.** Las dos veces el test salía VERDE con el código roto:
>
> 1. **Conexiones frías.** La primera consulta de un `PrismaClient` abre la conexión y arranca el
>    pool; uno de los dos clientes ganaba ese arranque y terminaba sus DOS sentencias mientras el
>    otro seguía conectando. Resultado `{1,2}`: verde.
> 2. **Sentencias no preparadas.** Ya con las conexiones abiertas, corriendo el archivo ENTERO
>    `clienteA` llegaba a la carrera con sus sentencias preparadas (las usó en los casos de R16) y
>    `clienteB` no: la preparación de B cuesta un viaje extra y en ese hueco A terminaba. Verde otra
>    vez — **y corriendo sólo ese caso con `-t`, rojo**. Es decir: el veredicto dependía de qué
>    OTROS casos hubieran corrido antes.
>
> La barrera en `$queryRaw` es necesaria pero **no suficiente**: retiene el código, no el pool. Lo
> que cierra el agujero es **calentar el camino entero en las dos conexiones** antes de la carrera,
> y eso está escrito dentro del test con esta medición al lado.

### M5 — se quita el `.strict()` del cuerpo

`app/api/asistente/route.ts`. **3 rojos** en la ruta:

```
FAIL tests/integration/asistente-route.test.ts > R8 ... > ⭑⭑ un mensajero que manda
`rol: "maestro"` y una lista de slugs recibe 422
AssertionError: expected 200 to be 422
```

### M6 — el rol se toma del CUERPO de la petición

Sobre M5, además: `rol: z.string().optional()` en el schema y
`rol: leido.data.rol ?? actor.rol` en el handler. **4 rojos**, y el caso estructural nombra la línea
culpable en vez de decir «esperaba 422»:

```
FAIL tests/integration/asistente-route.test.ts > R8 ... > ⭑⭑ ESTRUCTURAL — en el borde, `rol` sólo
se asigna UNA vez y desde el actor de sesión
AssertionError: expected [ 'z.string().optional()', …(1) ] to deeply equal [ 'actor.rol' ]
-   "actor.rol",
+   "z.string().optional()",
+   "(leido.data.rol ?? actor.rol) as typeof actor.rol",
```

### M7 — el streaming se junta y se suelta de golpe

`app/api/asistente/route.ts`: acumular todos los trozos y emitirlos al final. El test de R19 **no
pasa en verde: muere por timeout**, que es el rojo ruidoso que su comentario predice.

```
× ⭑⭑ el test lee los tres trozos ANTES de que el proveedor haya terminado  20011ms
Error: Test timed out in 20000ms.
```

---

### M8 — se le quita el ROL a las instrucciones del sistema (pasada 3, `B2`)

`lib/asistente/instrucciones.ts`: fuera el bloque «QUIÉN TE PREGUNTA». **5 rojos**, en los dos
niveles: la función y lo que de verdad llega al proveedor.

```
FAIL tests/integration/asistente-route.test.ts > R32 — el modelo sabe CON QUIÉN habla, y lo dice la
misma sesión que acotó los documentos > ⭑⭑ el mismo cuerpo, dos sesiones: las instrucciones que se
envían nombran a cada uno
AssertionError: expected 'Sos el asistente de ayuda de Ordenex,…' to contain 'Esta persona entra a Ordenex como Men…'

FAIL tests/unit/asistente/instrucciones.test.ts > R32 … > ⭑ le prohíbe INVENTAR un límite de cuenta,
que es el fallo que se midió
AssertionError: expected 'Sos el asistente de ayuda de Ordenex,…' to contain 'no lo puede hacer desde su cuenta'
```

Total: `Tests  5 failed | 28 passed (33)`.

### M9 — el contador vuelve a incrementar en el rechazo por tope (pasada 3, `m2`)

`lib/repositories/AsistenteUsoRepository.ts`: fuera el `WHERE "consultas" < ${tope}` del `ON
CONFLICT DO UPDATE`. **2 rojos contra Postgres real**:

```
FAIL tests/integration/db/asistente-uso-diario.int.test.ts > ⭑⭑ R17 — EN EL TOPE NO SE ESCRIBE NADA:
un rechazo no es una consulta atendida
AssertionError: expected 4 to be null
```

El 4 es el intento que no debía contar. Detrás queda la aserción de la fila (`consultas: 3`, no 6),
que es la que nombra el daño: con la mutación, la columna que T27 va a leer mide intentos.

### M10 — se quita el tope de imágenes por petición (pasada 3, `m3`/R33)

`app/api/asistente/route.ts`: fuera el `if (imagenes > ASISTENTE_IMAGENES_MAX_POR_PETICION)`.
**2 rojos**:

```
FAIL tests/integration/asistente-imagenes.test.ts > m3 — el coste de UNA consulta también está
acotado… > ⭑⭑ cinco mensajes con una imagen cada uno —cinco imágenes— se rechazan con 422
AssertionError: expected 200 to be 422 // Object.is equality
```

### M11 — la cita vuelve a dejar el espacio (pasada 3, `m1`)

`lib/asistente/citas.ts`: la costura deja de comerse el espacio de la izquierda. **4 rojos**, y el
primero es exactamente la frase sin referente que la revisión midió:

```
FAIL tests/unit/asistente/citas.test.ts > m1 — la cita se va CON SU HUECO… > ⭑⭑ A MITAD DE FRASE:
no queda un espacio delante de la coma
AssertionError: expected 'Mirá , y después confirmá.' to be 'Mirá, y después confirmá.'

× ⭑ al final de la frase: expected 'Se cierra del lado de la oficina .' to be '…oficina.'
× ⭑ dos citas seguidas:  expected 'Lo tenés en  ; y ya.' to be 'Lo tenés en; y ya.'
× ⭑ pero SÍ queda un espacio: expected 'Mirá  y después confirmá.' to be 'Mirá y después confirmá.'
```

> ⚠️ **Y un tropiezo propio, dicho porque cuesta tiempo al siguiente:** restaurar una mutación con
> `git checkout -- <archivo>` **se lleva también el arreglo sin commitear**. Pasó con cuatro
> archivos y hubo que reescribirlos. Las salidas de arriba son las de la corrida contra el árbol
> arreglado; después de rehacerlos se volvió a medir todo en verde (§9).

### La mina del quitador naíf, medida antes y después (`m6`)

No es una mutación: es la medición de que el comentario de `route.ts:57` ya no ceba la trampa. Con
el quitador de `tests/unit/guards/superficie-de-uso.guardia.test.ts` **copiado tal cual**:

```
ANTES (HEAD)  lineas vivas: 148   TRAGADO medio: z.enum(ASISTENTE_IMAGEN_MEDIOS)
                                  TRAGADO datosBase64: z.string()
                                  TRAGADO const mensajeSchema
DESPUÉS       lineas vivas: 167   VIVE los cinco testigos
```

**La guardia ajena no se tocó**: la revisión midió que su falso verde de hoy es prácticamente cero
(1 export, y es una interfaz) y que su modo dominante es el falso rojo. Arreglarla es otra ficha; no
cebarla, cuesta un comentario.

---

## 5. Lo que el árbol exigió y el spec no había previsto: **tres censos**

El primer gate completo salió **rojo (`INIT_EXIT=1`)**, con **8 casos en 3 archivos**, todos míos y
todos de la misma familia: censos que obligan a **declarar** una tabla nueva en vez de dejarla
entrar sola. Está guardado en `progress/gate_436_backend_1_rojo_censos.log`. Los tres, y lo que se
escribió en cada uno:

1. **`tests/fixtures/api-key-dependencias-usuario.ts`** (ficha 373/R17) — toda FK hacia `usuario`
   tiene que estar clasificada **con motivo**. `AsistenteUsoDiario.usuario` entra como
   **`no_alcanzable`**, y con un motivo más fuerte que el de sus vecinas: no es que el camino sea
   improbable, es que hay un **rechazo explícito por rol** (R13) antes de tocar el contador, con su
   test midiendo las dos mitades.
2. **`tests/integration/db/schema-drift-saneamiento.test.ts`** — la lista de tablas cuyo
   `CREATE TABLE` le puso `DEFAULT` a `updated_at` pasa de **diez a once**. Si el modelo no lo
   declarara, `migrate dev` propondría un `DROP DEFAULT` a la siguiente.
3. **`tests/integration/db/orden-traspaso-migration.test.ts`** — la lista de migraciones
   POSTERIORES a la de la 427 gana `20260920120000_asistente_uso_diario`, declarada como **aditiva
   pura**.

Y dos guardias existentes se ampliaron a propósito:

4. **`tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts`** — el bloque «CONTROL:
   responden 401 con JSON» pasa de dos rutas a **tres**. El comentario de cabecera decía «la ruta de
   API NÚMERO 25 no está escrita todavía»: ésta es.
5. **`tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts`** — R31, con su canario.

---

## 6. La migración

`db/migrations/20260920120000_asistente_uso_diario/` — **aditiva pura**: crea `asistente_uso_diario`
(id, usuario_id, fecha `DATE`, consultas, `no_lo_se`, created_at, updated_at), su índice único
`(usuario_id, fecha)`, la FK a `usuario` en **CASCADE**, dos `CHECK >= 0`, cuatro `COMMENT ON` y
**RLS habilitada sin policies**. Ni un `ALTER`/`DROP`/`UPDATE` sobre nada preexistente, ningún enum.

Medido en la base local (`localhost:5432`, base `ordenex`):

- `prisma validate` y `prisma generate` — verdes.
- `prisma migrate deploy` aplica; `prisma migrate status` → **«Database schema is up to date!»**, sin drift.
- `pnpm run db:rollback` revierte (y `migrate status` pasa a «not yet been applied»); vuelto a aplicar, limpio otra vez.

**El `down.sql` dice en voz alta qué se pierde:** el contador de todo el mundo y, con él, **el tope**
—porque quien lo aplica es este contador—. Revertirlo con la ruta viva no deja el asistente sin
límite: lo deja **sin responder** (cada consulta falla al contar), que es el modo de fallo seguro.

### Desviaciones declaradas — **las de las tres pasadas, en un solo sitio**

**Pasada 1 (servidor):**

1. **`fecha` es `DATE` (como pide el diseño) pero se escribe y se lee como la cadena `YYYY-MM-DD`
   con un `::date` explícito**, nunca como un `Date` de JavaScript. El diseño citaba
   `fechaCalendarioCR`, que devuelve una **cadena**; dejar que el driver serialice un `Date` mete la
   conversión de huso en medio y después de las 18:00 de Costa Rica el día cae al siguiente. Es la
   misma lección que `push_envio_dia.dia_cr`. El test del borde de medianoche lo mide.
2. **~~`consumirUnaConsulta(usuarioId, fecha)` no recibe el tope~~ — REVERTIDA en la pasada 3.** Se
   quitó el tope de la firma por capas (el repositorio sólo ejecuta queries) y el efecto medido fue
   que **un rechazo también incrementaba** (`m2`). Vuelve a la firma del diseño,
   `(usuarioId, fecha, tope)`, con el tope dentro del `WHERE`: comprobar y sumar tienen que ser la
   MISMA sentencia o hay una ventana en medio. La política no se mueve —quién decide el tope y qué
   se le dice a la persona sigue siendo del servicio, que es quien lo pasa—; lo que baja al SQL es
   la condición de escritura, que es donde se puede probar (`probar el WHERE donde vive`).
3. **Route Handler y no Server Action**, contra `docs/architecture.md`: una Server Action no puede
   devolver un stream incremental y R19 es requisito de producto. Escrito en `design.md §2.1` y en
   la cabecera de la ruta; no se extiende a nada más de la ficha.

**Pasada 2 (pantalla) — las cinco, que hasta hoy sólo vivían en el mensaje del commit:**

4. **El aviso de datos no decía lo que R28 pide.** Hablaba sólo de imágenes y encima tras un «si»,
   así que quien escribe y no adjunta —casi todo el mundo— leía un aviso que no le aplicaba. Ahora
   nombra **las dos mitades** y el test las afirma por separado. Cerrado en `15d0183e` (`B1`).
5. **El panel salía a 292,5 px en el teléfono y 384 px en la oficina**, no 390 y 420: las clases de
   la primitiva llevan prefijo de variante y `tailwind-merge` no las sustituye sin él. Corregido y
   vuelto a medir en el navegador. **Lo encontró ver la aplicación, no la suite.**
6. **La respuesta del modelo viene en Markdown y la pantalla enseñaba los `**` en crudo**, seis u
   ocho por respuesta. Se pinta sólo la negrita, con una función pura: **no** se metió un intérprete
   de Markdown para un texto que viene de fuera.
7. **Se corrigió el comentario caduco de `AyudaBoton.tsx`** (H4): decía que tres pantallas se quedan
   sin «?» para todo el mundo, falso desde la 434. Lo que queda son pares (pantalla, rol).
8. **Se quitó una barra-asterisco de un comentario del panel**: abría un comentario de bloque para
   el quitador naíf de `superficie-de-uso.guardia.test.ts`, que se tragaba treinta líneas de JSX y
   denunciaba un handler «sin referencia» que sí la tenía.

**Pasada 3 (cierre de la revisión):**

9. **El rol viaja en el texto de sistema, NO como campo de `ConsultaAsistente`.** La revisión
   nombraba el puerto entre los tres sitios donde el rol no estaba; se deja fuera a propósito: el
   puerto no conoce `roles` para que nadie acabe decidiendo el acceso en el adaptador (está escrito
   en su cabecera desde la pasada 1). El rol entra donde tiene efecto —lo que el modelo lee— y el
   acotamiento sigue ocurriendo antes, en el servicio.
10. **Los prefijos de caché pasan de cuatro a cinco.** Hoy `maestro` y `admin` reciben los mismos 33
    documentos y las mismas instrucciones, así que comparten prefijo; con el rol dentro, cada uno
    tiene el suyo. **Cinco es exactamente lo que el diseño presupuestó** («un prefijo por rol»), así
    que no hay nada que renegociar — pero el número real de hoy era cuatro y conviene decirlo.
11. **El tope de imágenes por petición se comprueba FUERA del schema zod.** Un `superRefine` —lo que
    sugería la revisión— rechazaría igual, pero su mensaje muere en `fieldErrors` y la persona vería
    el «datos inválidos» genérico. Como el requisito nuevo pide que el rechazo diga qué pasó, la
    comprobación va después del `safeParse`, en el mismo borde y con su propio mensaje.

---

## 7. Lo que queda vivo, y lo que NO se hizo a propósito

- **T25 y T26 son puertas de DESPLIEGUE y siguen abiertas.** `ANTHROPIC_API_KEY` está en `.env`
  local, **no en Vercel**. La suite entera corre contra un doble: **ningún test toca la red ni gasta
  un céntimo**, y hay guardia que lo vigila — desde la pasada 3 recorre **el módulo entero** (el
  servicio y el borde, no sólo los cuatro puros) y exige que ninguna invocación del handler en
  `tests/**` vaya sin `service:` o `fetchImpl:`.
- **T27** (medir el primer día real) no se puede hacer hasta que esté desplegado. El número que va a
  leer ya mide lo que dice medir: desde la pasada 3, **un rechazo por tope no incrementa nada**.
- **El coste aceptado del orden del tope**, escrito también en el código y en la migración: se cuenta
  **antes** de llamar al proveedor, así que una consulta que el proveedor no llegue a atender
  —caída, timeout, falta de credencial— **gasta cupo**. Con 30/día es ruido; que no sea una sorpresa
  es el punto. Lo que **ya no** gasta cupo es un rechazo por tope (`m2`).
- **Lo que un cliente sí puede hacer y no se cierra en esta ficha** (`m10` de la revisión): forjar
  turnos del asistente en el hilo, porque el servidor no guarda nada (D10). El daño está acotado
  donde importa —el conjunto de documentos lo decide el servidor y el cuerpo no lo ensancha, medido
  en R8— así que se puede empujar al modelo a especular, pero no sonsacar lo que no es suyo.
- **No se tocó `next.config.ts`** (H1) ni `middleware.ts` (§2.1 del diseño).
- **No hay E2E** y no lo habrá: este repo no tiene arnés vivo.

---

## 8. El contrato entre el servidor y la pantalla — **ya construido**

Esta sección se escribió como encargo de la pasada 2 y **se conserva como contrato**: es lo que el
panel consume hoy. Lo que era «le falta construir» está hecho (§8.2).

### 8.1 Lo que el servidor le da hecho

`POST /api/asistente`, NDJSON (`application/x-ndjson`), una línea JSON por evento:

```jsonc
{"tipo":"inicio","documentos":[{"slug":"mensajero/reparto","titulo":"Reparto","href":"/ayuda/mensajero/reparto"}],"partida":"mensajero/reparto"}
{"tipo":"texto","texto":"Para cerrar el día…"}
{"tipo":"fin"}
{"tipo":"error","code":"INTERNAL","message":"…"}   // sólo si el stream ya había empezado
```

- **Cuerpo de la petición:** `{ mensajes: [{autor, texto, imagenes?}], rutaActual? }` y **NADA MÁS**
  — el schema es `.strict()`, así que una clave de más es un **422**, no un campo ignorado.
- **Rechazos previos** (no viajan por el stream): 401 sin sesión, 403 rol no admitido, 422
  validación, **409 tope alcanzado** (con el mensaje ya redactado), 500 sin credencial / proveedor
  caído (con mensaje propio, nunca mudo).
- **Para las citas (R24/R25):** `partirNdjson`, `citasDe(respuesta, entregados)` y
  `textoSinMarcadores(respuesta)` en `lib/asistente/{protocolo,citas}.ts` son **puros y ya
  probados**. El panel **no debe reimplementar la validación**: los documentos del evento `inicio`
  son el conjunto entregado, y `citasDe` es la función que decide.
- **Para R27:** `partida` viene resuelto en el `inicio`. El panel no tiene que cruzar rutas.
- **Imágenes:** una por mensaje, `image/png|jpeg|webp`, tope de 5 MB sobre la cadena base64
  (`ASISTENTE_IMAGEN_MAX_BYTES` / `_MAX_BASE64` / `_MAX_POR_MENSAJE` / `_MEDIOS` en
  `lib/config/asistente.ts`). El cliente **debe comprimir antes de enviar**: el límite de cuerpo de
  un Route Handler en Vercel es ~4,5 MB, por debajo de los 5 MB que el schema admite.

### 8.2 Lo que la pasada 2 construyó — **todo esto está hecho**

| Tarea | Qué es | Requisitos | Estado |
| --- | --- | --- | --- |
| **T7** 🚪 | `/design` del panel (superficie nueva) | previo a todo lo demás | ✅ opción **A** cerrada por el humano (`design-asistente/`) |
| **T14** | `providers/AsistenteProvider.tsx` — apertura y conversación **sólo en cliente** | R30 (mitad cliente) | ✅ |
| **T15** | `components/shared/AsistentePanel.tsx`, montado **una vez** desde `app/(app)/layout.tsx` como **hermano** de `{children}` | R22, R25, R27, R28 | ✅ (R28 rematado en `15d0183e`) |
| **T16** | control de adjunto: imagen sí, audio no, compresión previa | R29 (mitad pantalla) | ✅ |
| **T17** | el «?» abre el panel | R26 | ✅ |

### 8.3 La red que afirmaba el «?» como enlace (T2) — **medida, y es la lista que T17 tocó**

Ningún archivo fuera de esta lista cambió en la pasada 2.

- `tests/components/AyudaBoton.test.tsx` — **8 aserciones de `href`**, en las líneas
  44, 49, 57, 62, 71, 75, 152 y 156. (El spec decía «seis»; medidas hoy son **ocho**.)
- `tests/components/PageHeader.test.tsx` — línea **107** busca el control con
  `getByRole("link", { name: "Ayuda de esta pantalla" })`, y las líneas **123** y **134** afirman su
  `href`. Cambiar el `<Link>` por un disparador rompe las tres a la vez, empezando por el selector.
- `components/shared/AyudaBoton.tsx` — el componente en sí (`<Link href={/ayuda/${slug}}>`).

### 8.4 H4 — el comentario caduco, confirmado en el archivo real

`components/shared/AyudaBoton.tsx:22-29` sigue afirmando que **«3 se quedan sin “?” para todo el
mundo»** (`/configuracion/sinpe`, `/mi-bodega`, `/ranking/historico`). **Es falso desde la 434**, y
su propio test lo dice: `tests/components/AyudaBoton.test.tsx:91-95` — *«YA NO QUEDA NINGUNA PANTALLA
DEL PORTAL EN ESTA LISTA»*, las tres pasaron a R10. Lo que sí queda son **pares (pantalla, rol)**:
`/configuracion/sinpe` no tiene «?» para `adminSatelite` (línea 137, deliberado, Q4) y `/mi-bodega`
no lo tiene para `maestro` (línea 133).

**Corregido en la pasada 2** (desviación 7 de §6): la pasada 1 no lo tocó por no meterse en un
archivo de componente, y quien leyera ese comentario para montar T17 habría creído que el asistente
nace con tres agujeros de acceso que no existen.

---

## 9. Verificación

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck
> tsc --noEmit
```

Sin salida: verde.

### `pnpm run lint`

```
✖ 202 problems (0 errors, 202 warnings)
```

**0 errores.** Los 202 avisos son `no-unused-vars` preexistentes en tests ajenos; **ninguno** en un
archivo de esta ficha (`pnpm run lint | grep -i asistente` no devuelve nada).

### `./init.sh` completo (con `.env`)

Log: `progress/gate_436_backend.log`, con `INIT_EXIT` escrito **dentro** del archivo.

```
 Test Files  2036 passed (2036)
      Tests  29637 passed | 26 skipped (29663)
   Duration  683.85s
== init OK ==
INIT_EXIT=0
```

**Los `skipped` son los 26 de siempre y NINGUNO de `integration/db`.** Se miraron uno a uno:
17 de `tests/components/AnaliticaPage.test.tsx` y 9 de `tests/components/AnaliticaShell.test.tsx`;
17 + 9 = 26, la cuenta cierra y no queda ninguno más. La lección de «gate sin `.env`: salta la
integración» no aplica aquí: los **78 archivos de `tests/integration/db/**` corrieron**, incluido el
nuevo:

```
✓ tests/integration/db/asistente-uso-diario.int.test.ts (9 tests) 777ms
```

Los **14 archivos de la ficha**, todos en verde dentro de la corrida completa (**140 casos**):

```
✓ tests/integration/db/asistente-uso-diario.int.test.ts    (9)
✓ tests/integration/asistente-route.test.ts               (18)
✓ tests/integration/asistente-imagenes.test.ts            (11)
✓ tests/unit/asistente/acotamiento-por-rol.test.ts        (13)
✓ tests/unit/asistente/tope-diario.test.ts                (12)
✓ tests/unit/asistente/contexto-documental.test.ts        (10)
✓ tests/unit/asistente/peticion-al-proveedor.test.ts      (10)
✓ tests/unit/asistente/citas.test.ts                      (10)
✓ tests/unit/asistente/errores-no-filtran.test.ts          (9)
✓ tests/unit/asistente/instrucciones.test.ts               (9)
✓ tests/unit/asistente/sin-credencial.test.ts              (6)
✓ tests/unit/guards/asistente-sin-datos.guardia.test.ts    (9)
✓ tests/unit/guards/asistente-sin-persistencia.guardia...  (7)
✓ tests/unit/guards/asistente-sin-frontmatter.guardia...   (7)
```

**Y el primer intento salió ROJO** (`INIT_EXIT=1`, 8 casos en 3 archivos), guardado sin tocar en
`progress/gate_436_backend_1_rojo_censos.log`. Los tres eran míos y son los censos de §5. Se dice
porque un gate verde a la primera y un gate verde a la segunda no significan lo mismo: **el árbol
avisó de tres sitios donde había que DECIDIR**, y esa es exactamente la función que tienen.

### Las otras dos pasadas

- **Pasada 2 (pantalla):** `progress/gate_436_frontend.log` — 2038 archivos, 29.677 pasados, 26
  saltados, `INIT_EXIT=0`. Y `B1`: `progress/gate_436_b1.log`, 29.678, `INIT_EXIT=0`.
- **Revisión:** `progress/gate_review_436.log` (del reviewer) salió `INIT_EXIT=1` por
  `ranking-snapshot-migration` con `40P01` —deadlock, flake de saturación ajeno— y verde en aislado.

### Pasada 3 — el gate de este commit

`./init.sh` **completo y con `.env`** (el modo rápido **se niega** en esta rama: el diff contra
`origin/dev` arrastra la migración del contador). Log: **`progress/gate_436_revision.log`**, con
`INIT_EXIT` escrito **dentro** del archivo.

```
✓ typecheck paso
✖ 202 problems (0 errors, 202 warnings)   → ✓ lint paso
 Test Files  2038 passed (2038)
      Tests  29702 passed | 26 skipped (29728)
   Duration  641s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2038 ejecutado(s))
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **Los 26 saltados son los de siempre**, mirados uno a uno: **17** de `AnaliticaPage.test.tsx` y
  **9** de `AnaliticaShell.test.tsx`. **Ninguno de `integration/db`**: sus **280** archivos
  corrieron, el del contador incluido.
- **Ni rastro del flake de `ranking-snapshot-migration`** que puso rojo el gate del reviewer.
- Los **17 archivos de la ficha**, verdes dentro de la corrida completa (**220 casos**):

```
✓ tests/components/AsistentePanel.test.tsx                 (25)
✓ tests/components/AyudaBoton.test.tsx                     (19)
✓ tests/integration/asistente-route.test.ts                (20)
✓ tests/integration/asistente-imagenes.test.ts             (16)
✓ tests/integration/db/asistente-uso-diario.int.test.ts    (11)
✓ tests/unit/asistente/citas.test.ts                       (15)
✓ tests/unit/asistente/tope-diario.test.ts                 (14)
✓ tests/unit/asistente/acotamiento-por-rol.test.ts         (13)
✓ tests/unit/asistente/instrucciones.test.ts               (13)
✓ tests/unit/asistente/contexto-documental.test.ts         (10)
✓ tests/unit/asistente/peticion-al-proveedor.test.ts       (10)
✓ tests/unit/asistente/errores-no-filtran.test.ts           (9)
✓ tests/unit/asistente/sin-credencial.test.ts               (6)
✓ tests/unit/guards/asistente-sin-datos.guardia.test.ts    (13)
✓ tests/unit/guards/asistente-panel-hermano.guardia.test.ts (12)
✓ tests/unit/guards/asistente-sin-frontmatter.guardia.test.ts (7)
✓ tests/unit/guards/asistente-sin-persistencia.guardia.test.ts (7)
```

> Hubo **dos corridas completas** en esta pasada, y las dos verdes: la primera
> (`progress/gate_436_revision_1.log`) antes de unificar el quitador de comentarios de las dos
> guardias propias con el compartido de la 209, y la segunda —ésta— sobre el árbol final. Se dice
> porque un gate sólo vale para el árbol que midió.

---

## 10. Veredicto

**El asistente está entero —servidor, pantalla y los cuatro bloqueantes de la revisión— y verificado
sin gastar un céntimo: el acotamiento por rol se mide contra el mismo predicado que cierra `/ayuda`,
el modelo ya SABE con quién habla y el rol sale de la sesión, el tope vive en un índice único de
Postgres y desde hoy un rechazo no cuenta como consulta; once mutaciones se pusieron rojas con su
mensaje y el gate completo cierra en `INIT_EXIT=0`. Lo único abierto son las tres puertas de
despliegue, y lo están por una razón que no es nuestra: falta la credencial en Vercel.**
