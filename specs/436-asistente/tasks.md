# Ficha 436 — desglose

Convenciones: `[P]` = puede ir en paralelo con las otras `[P]` de su fase. Cada tarea lleva su
criterio de **Hecho**. Las fases se hacen **en orden**; dentro de una fase, las dependencias están
escritas. **🚪 = puerta de despliegue**, no de merge: la ficha se puede mergear a `dev` con esas sin
marcar, pero **no sale a `prod`**.

> **Antes de empezar:** leer `progress/design_sf001_p4_asistente.md`, `requirements.md` y `design.md`
> de esta carpeta, y los hallazgos **H1–H4** de `requirements.md` (dos de ellos ahorran trabajo).
>
> **Esta ficha lleva migración → `./init.sh --rapido` se niega** (`docs/verification.md:75`). El
> veredicto sale de `./init.sh` **completo y con `.env`**, y se miran los `skipped`: sin
> `DATABASE_URL` los tests de `tests/integration/db/**` se **saltan** y la suite termina verde sin
> haber tocado la capa de datos.
>
> **Nada de esto necesita `ANTHROPIC_API_KEY`** salvo T25 y T26. Si al llegar a T25 la credencial no
> existe, la ficha se mergea y se queda en la puerta.

---

## Fase 0 — lo que hay que contestar antes de escribir código

### [x] T0 — Las preguntas al humano
Llevar **Q1–Q7** de `requirements.md` y volver con respuesta. Las que bloquean y a qué:
**Q1** (lectura vs visibilidad) → T5. **Q2** (número del tope y su texto) → T8. **Q3** (qué pasa con
el «?») → T7. **Q4** (`/configuracion/sinpe` + `adminSatelite`) → T7. **Q6** (imágenes) → T16.
**Q5** y **Q7** no bloquean el merge.
**Hecho:** las respuestas escritas en `progress/impl_436.md` con su fecha. **Bloquea:** T5, T7, T8, T16.

### [x] T1 `[P]` — Comprobar que H1 sigue siendo cierto
Volver a leer `next.config.ts` y `tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts`
antes de tocar nada: el spec afirma que la clave es `"/**"` y que **no hay nada que añadir**.
**Hecho:** confirmado con la línea, o —si alguien la acotó entre medias— dicho en
`progress/impl_436.md` y replanteada T24. **Sin dependencias.**

### [x] T2 `[P]` — La red que hoy afirma el «?» como enlace
Listar en `progress/impl_436.md` los archivos y casos que hoy afirman el `href` del «?»
(conocidos: `tests/components/AyudaBoton.test.tsx` y `tests/components/PageHeader.test.tsx:101`).
**Hecho:** la lista escrita. **Regla:** si durante la implementación cambia un test que no está en
esa lista, se tocó lo que no era. **Bloquea:** T17.

---

## Fase 1 — el proveedor, sin proveedor

### [x] T3 — El puerto `IAsistenteProvider`
`lib/interfaces/external/IAsistenteProvider.ts` con los tipos de `design.md §1.1`. **Neutral**: sin
`next/*`, sin Prisma, sin `process.env`.
**Hecho:** typecheck verde; el archivo no tiene ningún import fuera de tipos propios; cada desenlace
de la unión lleva escrito al lado **quién lo produce y quién lo decide**.

### [x] T4 `[P]` — El doble y el adaptador
`tests/unit/asistente/_doble-proveedor.ts` (captura la petición entera y emite trozos guionizados, con
pausas para poder probar R19) y `lib/clients/anthropic-asistente.ts` con `fetch` y credencial
**inyectables**, molde `lib/clients/google-routes.ts:143-155`.
**Hecho:** **R4** y **R6** verdes contra el doble (`'tools' in peticion === false`, sin `thinking`,
exactamente un `cache_control` y en el último bloque de documentación); **R20** verde (sin credencial
→ `sin_credencial`, `fetchImpl` **no llamado**); **R21** verde (credencial y URL reconocibles no
aparecen en ningún `detalle`). Ni un test toca la red. **Depende de:** T3.

### [x] T5 — `lib/config/asistente.ts`
Clon estructural de `lib/config/geocode.ts`: ausente/vacío → `null`, **nunca lanza**. Las cuatro
variables de `design.md §4.3` + entrada en `.env.example` con su comentario.
**Hecho:** test que afirma los cuatro defaults y que un valor basura cae al default sin lanzar.
**Depende de:** T0 (Q2, para el número del tope).

---

## Fase 2 — el acotamiento por rol (el corazón de la ficha)

### [x] T6 — `lib/asistente/contexto.ts` y `lib/asistente/instrucciones.ts`
Módulos **puros**. `contextoPara(docs, rol)` **importa** el predicado del módulo de ayuda, no lo
reimplementa (`design.md §3`, punto 1). Las instrucciones llevan los cuatro límites y el formato de
cita.
**Hecho:** **R1, R2, R5, R9, R10, R11** verdes:
- R9/R10 se derivan del catálogo real y del predicado importado, **nunca de slugs escritos a mano**, y
  los conteos por rol coinciden con los de `tests/components/AyudaLayout.test.tsx:144-150`;
- R11 busca los títulos de los **18** documentos de `docs/ayuda/oficina/` en el texto que se manda a
  un `mensajero` y exige **cero** (18 medidos hoy; el test los deriva de la carpeta, no de este número);
- R2 corre sobre los **33** documentos reales y exige que no aparezca `fuentes:` ni la apertura `---`.
**Depende de:** T0 (Q1), T3.

---

## Fase 3 — la pantalla, primero en papel

### [x] T7 — 🚪 de diseño: `/design` para el panel
Superficie nueva → pasa por `/design` antes de implementarse. Llevar: qué hace el panel
(R26–R29), el texto del aviso (R28), la decisión de **Q3** (qué pasa con el «?») y los **tres** puntos
medidos de `design.md §6`: el par `/configuracion/sinpe` + `adminSatelite` (**Q4**), la colisión con
`ChatFlotante.tsx` en el módulo del mensajero, y el panel a 390 px.
**Hecho:** diseño aprobado, con los tres puntos contestados por escrito. **Depende de:** T0.
**Bloquea:** T17, T18.

---

## Fase 4 — el tope, con su migración

### [x] T8 — `db/schema.prisma` + migración
Modelo `AsistenteUsoDiario` y `db/migrations/<ts>_asistente_uso_diario/` con `migration.sql` según
`design.md §4.1` —tabla, FK `ON DELETE CASCADE`, `UNIQUE (usuario_id, fecha)`, `CHECK`, `COMMENT ON`,
`ENABLE ROW LEVEL SECURITY` sin policies— y `down.sql` con su `DROP TABLE`.
**Hecho:** `prisma validate` y `prisma generate` verdes; `pnpm run db:migrate` aplica y
`pnpm run db:rollback` revierte sobre una base limpia; `prisma migrate status` limpio (sin drift);
migración **aditiva pura** (ni un `ALTER`/`DROP`/`UPDATE` sobre un objeto preexistente).
**Depende de:** T0 (Q2). **Ojo:** base local compartida entre worktrees — aplicar esta migración pone
roja la corrida de otros agentes; avisar antes.

### [x] T9 — `AsistenteUsoRepository` + su interfaz
`consumirUnaConsulta(usuarioId, fecha, tope)` con `upsert` + incremento en **una** sentencia
(`design.md §4.2`).
**Hecho:** **R16** y **R17** verdes contra **Postgres real**
(`tests/integration/db/asistente-uso-diario.int.test.ts`): el `UNIQUE` existe y muerde; dos
incrementos concurrentes dejan `consultas = 2`; el día es el de Costa Rica en el borde de medianoche.
⚠️ **Ningún `if (!x) return;`**: el test se mata primero con una mutación que cambie el `upsert` por
un `read-then-write` y **tiene que ponerse rojo**. **Depende de:** T8.

---

## Fase 5 — el servicio y el borde

### [x] T10 — `AsistenteService` + su interfaz
Orquesta: rol → contexto (T6) → tope (T9) → proveedor (T3). El rol y el tope se resuelven **antes** de
componer nada.
**Hecho:** **R14** y **R15** verdes con dobles; en el caso «tope alcanzado» se afirma
`expect(dobleProveedor.llamadas).toEqual([])` —no basta con el desenlace— y **R13** igual (`apiKey` y
rol fuera de `ROLES_AYUDA` → rechazo **sin** llamar al proveedor). **Depende de:** T6, T9.

### [x] T11 — `app/api/asistente/route.ts`
Borde HTTP de `design.md §2`: `resolveActorFromSession`, zod `.strict()`, NDJSON con `inicio` /
`texto` / `fin` / `error`, y los rechazos previos como `AppErrorShape`. **No se toca `middleware.ts`**
(§2.1).
**Hecho:** **R7, R8, R12, R18, R19** verdes en `tests/integration/asistente-route.test.ts`:
- R8 manda `{rol:"maestro", slugs:[…]}` desde un mensajero y recibe **422** (el `.strict()`), y con un
  cuerpo válido el contexto sigue siendo el suyo;
- R18 manda `{consultasHoy:0}` estando en el tope y el rechazo se mantiene;
- **R19 se mide de verdad**: el doble emite tres trozos con pausas y el test lee el tercero **antes**
  de que el doble termine. Un test que sólo junte el cuerpo entero **no cubre R19**.
**Depende de:** T10.

### [x] T12 `[P]` — El control de la guardia de API
Ampliar `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts`: `/api/asistente` entra en el
bloque «CONTROL: … responden 401 con JSON» (hoy sólo están las dos rutas conocidas, líneas 116-131).
**Hecho:** **R12** anclado; se comprueba metiendo `/api/asistente` en `PUBLIC_ROUTES` y viendo el rojo.
**Depende de:** T11.

---

## Fase 6 — las citas

### [x] T13 — `lib/asistente/citas.ts`
Función **pura** marcador → enlace, validando cada slug contra el conjunto **entregado en esa
consulta**.
**Hecho:** **R23, R24, R25** verdes en `tests/unit/asistente/citas.test.ts`, con los slugs **reales**
del catálogo: un slug de `oficina/` en una respuesta de mensajero se descarta; uno inexistente
también; sin marcadores no sale ningún enlace. **Depende de:** T6.

---

## Fase 7 — la pantalla

### [x] T14 — `providers/AsistenteProvider.tsx`
Estado de apertura y conversación, **sólo en el cliente**.
**Hecho:** **R30** (la mitad de cliente): recargar pierde la conversación; ningún `fetch` la envía a
guardar. **Depende de:** T7.

### [x] T15 — `components/shared/AsistentePanel.tsx`
El panel, montado **una vez** desde `app/(app)/layout.tsx` como **hermano** de `{children}`
(`design.md §6`).
**Hecho:** **R22, R25, R27, R28** verdes en `tests/components/AsistentePanel.test.tsx`:
- R22 — con la ruta caída, el panel pinta su error y el encabezado y el contenido de la página
  **siguen montados**;
- R27 — abierto desde `/mis-asignaciones/reparto`, el contexto de partida es `mensajero/reparto`;
- R28 — el aviso se encuentra por su **literal**, con el panel abierto y **sin abrir ningún
  desplegable**.
**Depende de:** T13, T14.

### [x] T16 `[P]` — Imágenes sí, audio no
El control de adjunto: lista blanca de formatos, tope de tamaño, compresión en el cliente.
**Hecho:** **R29** verde: hay control de imagen; `accept` **no** admite `audio/*`; no existe ningún
control de grabación en el árbol del panel. **Depende de:** T0 (Q6), T15.

### [x] T17 — El «?» abre el panel
Según lo que T7 decida sobre **Q3**. Los tests de la lista de T2 se actualizan **uno a uno**: los que
cubrían otra cosa se conservan.
**Hecho:** **R26** verde; ningún archivo fuera de la lista de T2 cambió; `AyudaProvider` intacto.
**Depende de:** T2, T7, T15.

---

## Fase 8 — las guardias

### [x] T18 `[P]` — `asistente-sin-datos.guardia.test.ts`
Recorre `lib/asistente/**`, `lib/clients/anthropic-asistente.ts` y `app/api/asistente/**` y falla si
aparece un import de Prisma, de un repositorio o de un servicio de dominio fuera de la lista blanca
(el contador y el resolutor de sesión). Comprueba además que el **puerto** no importa `next/*`,
Prisma ni `process.env`.
**Hecho:** **R3** verde, **con canario**: se añade a mano un import prohibido y la guardia se pone
roja (una guardia que no se autocomprueba queda verde por vacío).

### [x] T19 `[P]` — `asistente-sin-persistencia.guardia.test.ts`
Falla si el módulo escribe en cualquier tabla que no sea `asistente_uso_diario`, o si esa tabla gana
una columna de texto libre.
**Hecho:** **R30** verde, con canario.

### [x] T20 `[P]` — `asistente-sin-frontmatter.guardia.test.ts`
Sobre los **33** documentos reales: ninguna cadena del contexto contiene `fuentes:` ni la apertura
`---`.
**Hecho:** **R2** verde; control de no-vacuidad (si el catálogo devolviera vacío, la guardia falla en
vez de pasar).

### [x] T21 — Ampliar `ayuda-md-viajan-a-produccion.guardia.test.ts`
**No se toca `next.config.ts`** (H1). Se añade el caso que ata las dos puntas: la ruta del asistente
existe, su **única** vía de documentación es `lib/ayuda/catalogo.ts`, y la clave sigue siendo `/**`.
**Hecho:** **R31** verde; se comprueba poniendo en la ruta una fuente distinta y viendo el rojo.
**Depende de:** T1, T11.

---

## Fase 9 — verificación y cierre

### [x] T22 — Las cinco mutaciones obligatorias
Cada una se ejecuta y **se pega la salida del test que la mata** (no el veredicto de un arnés, que en
este repo ya reportó supervivientes sin haber corrido un test):
1. `contextoPara` devuelve **todos** los documentos en vez de los del rol ⇒ rojo en T6 (R9/R10/R11).
2. Quitar el `.strict()` del schema del cuerpo ⇒ rojo en T11 (R8).
3. `upsert` → `read-then-write` en el contador ⇒ rojo en T9 (R17).
4. La validación de la cita acepta cualquier slug ⇒ rojo en T13 (R24).
5. El tope se comprueba **después** de llamar al proveedor ⇒ rojo en T10 (R15).
**Hecho:** las cinco con su salida y el archivo que se puso rojo.

### [x] T23 — Gate completo
`./init.sh` **con `.env`**, `INIT_EXIT=$?` escrito **dentro** del log (un `echo` posterior tapa el
código de salida), y revisión de los `skipped`. **No en paralelo con ningún subagente que esté
mutando el árbol**: el gate leería un árbol a medias y su veredicto no valdría.
**Hecho:** gate verde, con el número de archivos y de tests, y la línea de `skipped` citada.
**Depende de:** todo lo anterior.

### [x] T24 — Informe y commit
`progress/impl_436.md` con el mapa `R<n>` → test (los **31**), las respuestas de T0, la lista de T2,
la salida de T22 y los límites que quedaron vivos. **Se commitea**: un informe sin commitear no
existe.
**Hecho:** commiteado en `feat/436-asistente` y verificado **en el blob** (`git show <sha> --stat`),
no sólo en el árbol.

---

## Fase 10 — 🚪 PUERTA DE DESPLIEGUE (no se hace en el merge)

### [ ] T25 — 🚪 La credencial, y la primera consulta real de cada rol
Requiere **Q7** resuelta. Con `ANTHROPIC_API_KEY` cargada en el entorno desplegado —en `preview` y
`production` **por separado**, nunca una variable marcada en los dos—, preguntar algo real **con cada
uno de los cinco roles** y dejar escrito, para cada uno:
1. que la respuesta **cita al menos un documento** y el enlace abre;
2. que el documento citado **es de los suyos**;
3. que una pregunta fuera de la documentación devuelve **«no lo sé»**;
4. que un mensajero preguntando por la caja **no** obtiene la explicación de la caja;
5. el coste que reportó la consulta.
**Hecho:** los cinco roles × los cinco puntos, con **lo que se vio**, no con lo que debería pasar.
**Por qué es puerta:** es la única prueba de que los `.md` viajan de verdad a la función de Vercel y
de que el modelo respeta los cuatro límites. El fallo que esto caza —«no lo sé» a todo en producción,
verde en local— **no lo ve ningún test**.

### [ ] T26 — 🚪 Ver la aplicación
Con sesión real y en el navegador: abrir el panel desde el «?» en al menos tres pantallas distintas,
adjuntar una imagen, comprobar que el **aviso está visible sin abrir nada**, agotar el tope y ver el
mensaje, y recargar para comprobar que la conversación desaparece.
**Hecho:** descrito lo que se vio, con el rol y la ruta de cada paso. En este repo ver la aplicación
encontró en minutos lo que 12.000 tests daban por bueno.

> **Las tres de esta fase siguen SIN MARCAR a propósito** (2026-09-17): no son un olvido, son la
> señal de que **falta la credencial en Vercel** (Q7). Mientras `ANTHROPIC_API_KEY` no esté en
> `preview` y en `production` —por separado— T25 y T26 no se pueden hacer, y T27 vive 24-48 h
> después del despliegue. La ficha se mergea a `dev` con las tres abiertas; **no sale a `prod`**.

### [ ] T27 — 🚪 Medir el primer día real
A las 24–48 h del despliegue: cuántas consultas hubo, de cuántas personas distintas, y cuántas
chocaron con el tope. Es el número que decide si **Q2** deja de ser una pregunta.
**Hecho:** los tres números escritos con su fecha en `progress/impl_436.md`.

---

## Fase 11 — cierre de la revisión (2026-09-17, `progress/review_436.md`)

Cuatro bloqueantes y cinco menores. `B1` se cerró en su propio commit (`15d0183e`); lo demás, aquí.

### [x] T28 — `B2`: el rol viaja en las instrucciones (R32, nuevo)
`instruccionesDelSistema(rol)` con el bloque «QUIÉN TE PREGUNTA», el rol tomado de `actor.rol` —el
mismo que acota los documentos— y la prohibición explícita de inventar un límite de cuenta.
**Hecho:** **R32** escrito en `requirements.md` y verde en `instrucciones.test.ts` (cinco roles por
literal a mano) y en `asistente-route.test.ts` (mismo cuerpo, dos sesiones, medido sobre lo que
recibe el proveedor). Mutación: se quita el bloque → **5 rojos**.

### [x] T29 — `B3` y `B4`: el papeleo que deja la ficha legible
`tasks.md` marcado —con las tres puertas de despliegue **sin marcar**— y `progress/impl_436.md` al
día con las **dos pasadas** y las desviaciones declaradas.
**Hecho:** `CHECKPOINTS.md:9` y `:13` cumplidos.

### [x] T30 — Los cuatro menores que sí viajan
`m2` (un rechazo por tope ya no incrementa: el tope entra en el `WHERE` del `ON CONFLICT`), `m3`
(**R33**, tope de imágenes por petición con mensaje propio), `m4` (la guardia «sin red» recorre el
módulo entero, y ninguna invocación del handler en `tests/**` puede ir sin doble) y `m1` (la cita se
va con su hueco, también a mitad de frase).
**Hecho:** cada uno con su mutación y su rojo real, en `progress/impl_436.md §4`.

### [x] T31 — La mina del quitador naíf, fuera de nuestra ruta
`app/api/asistente/route.ts` ya no lleva una barra-asterisco dentro de un comentario de línea.
**Hecho:** medido con el quitador de `superficie-de-uso.guardia.test.ts` copiado tal cual: antes se
tragaba el esquema de imagen y `mensajeSchema`; ahora sobreviven los cinco testigos. **La guardia
ajena NO se tocó**: su falso verde de hoy es prácticamente cero y arreglarla es otra ficha.
