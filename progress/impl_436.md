# Ficha 436 — el asistente. Bitácora de la PRIMERA MITAD (todo lo que no es pantalla)

**Rama:** `feat/436-asistente`. **Zona:** fullstack, mitad de **servidor**. **Fecha:** 2026-09-17.

Aquí está **todo lo que no es pantalla**: el puerto, el adaptador, el doble, los módulos puros
(contexto, instrucciones, citas, protocolo), la configuración, la migración del contador, el
repositorio, el servicio, el borde HTTP y las guardias. **La mitad de frontend no se ha tocado** y
va en otra pasada; lo que le queda está al final, con archivo y línea.

> **Lo primero que pasó, y cambia cómo se lee todo lo demás:** la rama estaba **6 commits por
> detrás de `dev`** y se mergeó antes de escribir una línea. Sin ese merge,
> `lib/ayuda/documento.ts` no tenía `puedeLeerDocumento` —el predicado de **LECTURA** de la 435, que
> es el que Q1 decidió usar— y el corazón de la ficha habría quedado colgado del estricto sin que
> nada lo dijera. Commit de merge: `51624b59`.

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

---

## 3. Mapa `R<n>` → test

**BACKEND = hecho y verde. FRONTEND = lo que le queda a la otra pasada.**

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
| R17 | ✅ | idem — dos consultas retenidas en la MISMA ventana dejan `consultas = 2` |
| R18 | ✅ | `tests/integration/asistente-route.test.ts` |
| R19 | ✅ | `tests/integration/asistente-route.test.ts` — el test lee los tres trozos **antes** de que el doble termine |
| R20 | ✅ | `tests/unit/asistente/sin-credencial.test.ts` (+ el 500 con mensaje propio en la ruta) |
| R21 | ✅ | `tests/unit/asistente/errores-no-filtran.test.ts` (6 códigos HTTP + fallo de red) y el cuerpo de la ruta |
| R22 | ⬜ **FRONTEND** | el panel con la ruta caída sigue dejando la página en pie. El servidor ya hace su mitad: el fallo viaja como línea `{"tipo":"error"}` y nunca como excepción |
| R23 | ✅ | `tests/unit/asistente/citas.test.ts` — con los slugs REALES del catálogo |
| R24 | ✅ | idem — un slug de oficina en una respuesta de mensajero se descarta; uno inexistente también |
| R25 | 🟡 mitad | `citas.test.ts` cubre «sin marcadores no hay citas». **Falta** la mitad de pantalla: que el panel no pinte sección de fuentes |
| R26 | ⬜ **FRONTEND** | el «?» abre el panel sin salir de la pantalla |
| R27 | 🟡 mitad | servidor hecho: `documentoDePartida` + el `partida` del evento `inicio` (`contexto-documental.test.ts`, `asistente-route.test.ts`). **Falta** que el panel arranque con él |
| R28 | ⬜ **FRONTEND** | el aviso de que lo escrito viaja a un proveedor externo, visible sin abrir nada |
| R29 | 🟡 mitad | servidor hecho y medido: `tests/integration/asistente-imagenes.test.ts` (lista blanca, **audio rechazado con 422**, una por mensaje, 5 MB). **Falta** el control en el panel |
| R30 | 🟡 mitad | `tests/unit/guards/asistente-sin-persistencia.guardia.test.ts` + el censo de columnas contra la base. **Falta** la mitad de cliente: recargar pierde la conversación |
| R31 | ✅ | `tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts` — la ruta existe, su única vía es `lib/ayuda/catalogo.ts`, y la clave sigue siendo `/**` |

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

### Dos desviaciones del `design.md`, dichas para que el reviewer no las busque

1. **`fecha` es `DATE` (como pide el diseño) pero se escribe y se lee como la cadena `YYYY-MM-DD`
   con un `::date` explícito**, nunca como un `Date` de JavaScript. El diseño citaba
   `fechaCalendarioCR`, que devuelve una **cadena**; dejar que el driver serialice un `Date` mete la
   conversión de huso en medio y después de las 18:00 de Costa Rica el día cae al siguiente. Es la
   misma lección que `push_envio_dia.dia_cr`. El test del borde de medianoche lo mide.
2. **`consumirUnaConsulta(usuarioId, fecha)` no recibe el tope** (el diseño escribía
   `(usuarioId, fecha, tope)`). Comparar con el tope es lógica de negocio y el repositorio sólo
   ejecuta queries (`docs/architecture.md`). Devuelve el valor resultante y el servicio decide.

---

## 7. Lo que queda vivo, y lo que NO se hizo a propósito

- **T25 y T26 son puertas de DESPLIEGUE y siguen abiertas.** `ANTHROPIC_API_KEY` está en `.env`
  local, **no en Vercel**. La suite entera corre contra un doble: **ningún test toca la red ni gasta
  un céntimo**, y hay guardia que lo vigila (`lib/asistente/**` no puede nombrar `fetch` ni una URL).
- **T27** (medir el primer día real) no se puede hacer hasta que esté desplegado.
- **El coste aceptado del orden del tope**, escrito también en el código y en la migración: se cuenta
  **antes** de llamar al proveedor, así que una consulta que el proveedor no llegue a atender
  —caída, timeout, falta de credencial— **gasta cupo**. Con 30/día es ruido; que no sea una sorpresa
  es el punto.
- **No se tocó `next.config.ts`** (H1) ni `middleware.ts` (§2.1 del diseño).
- **No hay E2E** y no lo habrá: este repo no tiene arnés vivo.

---

## 8. Lo que le queda a la pasada de FRONTEND

Lo más concreto posible, porque de aquí sale el encargo siguiente.

### 8.1 Lo que el servidor ya le da hecho

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

### 8.2 Lo que le falta construir

| Tarea | Qué es | Requisitos |
| --- | --- | --- |
| **T7** 🚪 | `/design` del panel (superficie nueva) | previo a todo lo demás |
| **T14** | `providers/AsistenteProvider.tsx` — apertura y conversación **sólo en cliente** | R30 (mitad cliente) |
| **T15** | `components/shared/AsistentePanel.tsx`, montado **una vez** desde `app/(app)/layout.tsx` como **hermano** de `{children}` | R22, R25, R27, R28 |
| **T16** | control de adjunto: imagen sí, audio no, compresión previa | R29 (mitad pantalla) |
| **T17** | el «?» abre el panel | R26 |

### 8.3 La red que hoy afirma el «?» como enlace (T2) — **medida, y es la lista que T17 puede tocar**

Si durante T17 cambia un test que no está en esta lista, se tocó lo que no era.

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

**No se corrigió aquí** porque es un archivo de componente y esta pasada no toca pantalla — pero
**va en la de frontend y no es cosmético**: quien lea ese comentario para montar T17 creerá que el
asistente nace con tres agujeros de acceso que no existen.

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

---

## 10. Veredicto

**La mitad de servidor del asistente está entera y verificada sin gastar un céntimo: el
acotamiento por rol —que es la ficha— se mide contra el mismo predicado que cierra `/ayuda`, el tope
vive en un índice único de Postgres y las siete mutaciones que rompen las promesas se pusieron rojas
con su mensaje; falta la pantalla, y las dos puertas de despliegue siguen abiertas.**
