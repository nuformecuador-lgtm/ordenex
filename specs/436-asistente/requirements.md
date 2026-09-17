# Ficha 436 — el asistente que responde sobre cómo se usa la aplicación

**Zona:** fullstack. **SDD:** sí. **Rama:** `feat/436-asistente`. **Depende de:** 433 (mergeada).
**Es el PUNTO 4 de SF-001, SEGUNDA MITAD.** El diseño acordado y verificado por el humano vive en
`progress/design_sf001_p4_asistente.md`. Este documento **lo da por cierto** salvo en los tres
puntos donde el código lo desmiente, que están dichos abajo con archivo y línea.

**Lleva migración** (una tabla nueva para el tope de gasto, §C), así que **`./init.sh --rapido` se
niega** (`docs/verification.md`, fila `db/migrations/**`) y el veredicto sale de `./init.sh`
completo. También toca `.env.example` y **no** toca `next.config.ts` (ver R31 y el hallazgo H1).

---

## Lo que ya está decidido y no se reabre

| # | Decisión | Origen |
| --- | --- | --- |
| D1 | **Sólo habla de cómo se usa la aplicación.** La única fuente son los `.md` de `docs/ayuda/**`. | diseño + `docs/ayuda/README.md:10-14` |
| D2 | **No consulta datos.** No ve órdenes, cierres ni dinero. | diseño |
| D3 | **No ejecuta nada.** La petición al proveedor va **sin `tools`**. | diseño |
| D4 | **No inventa.** Sin respuesta en la documentación dice «no lo sé» y señala dónde mirar. | diseño |
| D5 | **Cada respuesta cita sus documentos**, enlazados a `/ayuda/<slug>`. | diseño |
| D6 | **El contexto se acota por rol.** Sin eso el acotamiento de la 433 queda decorativo. | diseño |
| D7 | Modelo **Sonnet 5** (`claude-sonnet-5`); **sin** pensamiento extendido. | diseño |
| D8 | Route Handler con **streaming**, runtime Node por defecto. | diseño |
| D9 | `cache_control: {type:"ephemeral"}` al final del bloque de documentación. | diseño |
| D10 | **Ninguna persistencia de la conversación** en la v1: vive en el cliente. | diseño |
| D11 | **Tope de gasto por usuario y día, en el servidor.** | diseño |
| D12 | **Audios fuera** de la v1. **Imágenes dentro**, con el aviso **visible en la pantalla**. | diseño + autorización del humano |
| D13 | Se construye contra un **doble del proveedor**: puerto en `lib/interfaces/external/`, adaptador en `lib/clients/`. Verificable **sin red y sin gastar un céntimo**. | diseño + patrón del repo |
| D14 | Vive en un **panel lateral** que se abre desde el **«?» del encabezado** que ya monta la 433, con la ayuda de esa pantalla ya cargada. | diseño |

---

## Lo que el código desmiente del documento de diseño

Tres cosas. Ninguna cambia el producto; dos ahorran trabajo y una lo añade.

**H1 — «Hay que añadir `app/api/asistente/route.ts` a `outputFileTracingIncludes`» es FALSO.**
`next.config.ts:59-61` declara la clave **`"/**"`** —todas las páginas, incluidas las rutas de
`app/api`— y no una lista de rutas. Más aún: la guardia
`tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts:83-90` **exige** que esa clave siga
siendo `/**` y se pondría roja si alguien la acotara. **No hay nada que añadir.** Lo que sí falta es
lo contrario de lo que el diseño pide: un test que ate la ruta nueva a esa garantía, porque hoy la
guardia mide la *forma* del config y nadie mide que **la ruta del asistente lea de verdad el
catálogo** (R29 + T24).

**H2 — el corpus son 33 documentos, no 32.** La ficha 434 (mergeada, `170789f3`) los llevó de 31 a
33. Contados hoy en `docs/ayuda/**`: 33 `.md` más el `README.md`, que el catálogo excluye a
propósito (`lib/ayuda/catalogo.ts:48`). El reparto por rol **medido** —`tests/components/AyudaLayout.test.tsx:144-150`—
es: maestro **23**, admin **22**, adminSatelite **10**, mensajero **8**, adminTienda **7**. El «8 del
mensajero» del diseño es correcto; el «32» no. Ninguna conclusión de coste cambia.

**H3 — el «?» de hoy es un `<Link>`, no un disparador de panel.** `components/shared/AyudaBoton.tsx:68-88`
pinta un `Link href={/ayuda/${slug}}` y `tests/components/AyudaBoton.test.tsx` afirma ese `href` en
seis casos; `tests/components/PageHeader.test.tsx:101` busca el enlace por su nombre accesible
«Ayuda de esta pantalla». Convertir ese control en un disparador de panel **rompe contratos vivos de
la 433**. Cómo se resuelve está en `design.md §6`; qué queda por decidir, en **Q3**.

**H4 (menor) — comentario caduco.** `components/shared/AyudaBoton.tsx:22-29` sigue afirmando que
«**3 se quedan sin «?»**» (`/configuracion/sinpe`, `/mi-bodega`, `/ranking/historico`). La 434 les
dio documento y su propio test lo dice (`tests/components/AyudaBoton.test.tsx:91-95`: «YA NO QUEDA
NINGUNA PANTALLA DEL PORTAL EN ESTA LISTA»). El comentario del componente no se actualizó. No es de
esta ficha arreglarlo, pero **sí importa**: quien lea ese comentario creerá que el asistente nace con
tres agujeros de acceso que ya no existen.

---

## Lo que esta ficha NO hace (límites declarados)

1. **No consulta la base de datos.** Ni una lectura de Prisma en el camino de la respuesta, salvo la
   sesión (que ya la resuelve el borde) y el contador del tope (R16-R18).
2. **No guarda la conversación.** Ni preguntas, ni respuestas, ni imágenes. Lo único que se persiste
   es un **contador de consultas** por usuario y día (R16). Consecuencia aceptada y dicha en voz
   alta: nadie va a poder leer qué se preguntó ni medir cuántas veces el asistente dijo «no lo sé».
   Ver **Q5**.
3. **No transcribe audio** (D12).
4. **No ejecuta acciones** (D3): no asigna, no gestiona, no marca, no cierra.
5. **No amplía ni recorta lo que cada rol puede leer.** Eso lo decide el módulo de ayuda; esta ficha
   **consume** ese predicado (R9) y la ficha 435 puede moverlo debajo sin que aquí se toque nada.
6. **No hay E2E.** Este repo no tiene arnés E2E vivo; la verificación es unitaria, de componente, de
   integración contra Postgres real, guardias estáticas, y una corrida manual en el navegador que es
   **puerta de despliegue**, no de merge.
7. **No toca `next.config.ts`** (H1).
8. **No sale a producción** sin estar seguros de que no daña lo que ya funciona (condición del humano
   para las cuatro de SF-001).

---

## Requisitos (EARS) — 33

> **R32 y R33 nacen de la revisión** (`progress/review_436.md`, 2026-09-17) y no del diseño. Se
> escriben aquí, y no en una ficha aparte, porque los dos son huecos **de este spec**: R32 acotó los
> *documentos* (R9-R11) y se olvidó de la *persona*, y R33 puso tope al número de preguntas sin que
> nada acotara el coste de UNA. Un hueco de requisito no lo caza la trazabilidad: por eso hace falta
> escribirlo, no sólo arreglarlo.

### A — La fuente, y sólo la fuente

**R1** — El sistema DEBE construir el contexto documental de cada consulta **exclusivamente** con los
cuerpos de los documentos que devuelve el catálogo de `docs/ayuda/**`, sin ninguna otra fuente de
texto.

**R2** — El sistema DEBE excluir del contexto el bloque de frontmatter de cada documento, y en
particular el campo `fuentes`, que `docs/ayuda/README.md:42-45` prohíbe mostrar.

**R3** — El módulo del asistente DEBE estar libre de acceso a datos: ninguno de sus archivos importa
Prisma, un repositorio de dominio ni un servicio de negocio, salvo el contador del tope (R16) y el
resolutor de sesión.

**R4** — CUANDO el sistema componga la petición al proveedor, DEBE emitirla **sin** campo `tools` y
**sin** pensamiento extendido.

**R5** — El sistema DEBE incluir en las instrucciones del sistema una orden explícita de responder
«no lo sé» —y de señalar dónde mirar— cuando la documentación entregada no cubra la pregunta.

**R6** — El sistema DEBE marcar el final del bloque de documentación con `cache_control` de tipo
`ephemeral`, y DEBE hacerlo **una sola vez** y en el último bloque de documentación.

### B — El acotamiento por rol (el corazón de la ficha)

**R7** — El sistema DEBE resolver el rol de quien pregunta **desde la sesión del servidor**.

**R8** — SI la petición del cliente incluye un rol, una lista de documentos o un slug, ENTONCES el
servidor DEBE ignorarlos por completo al construir el contexto.

**R9** — El contexto documental DEBE contener únicamente los documentos que esa persona **puede
leer** en el módulo de ayuda, resueltos con **el mismo predicado que decide el gate de
`/ayuda/<slug>`** (hoy `documentoVisiblePara`; la ficha 435 lo sustituye por el de lectura sin que
este requisito cambie de texto — ver `design.md §3` y **Q1**).

**R10** — El sistema DEBE cumplir R9 **para los cinco roles de persona**, y los conteos DEBEN
coincidir con los que mide el módulo de ayuda para ese mismo rol.

**R11** — MIENTRAS quien pregunta sea `mensajero`, la petición al proveedor NO DEBE contener ni una
línea de los documentos de la oficina (wallet, caja, cierres, configuración, histórico).

**R12** — SI no hay sesión válida, ENTONCES la ruta DEBE responder **401 con cuerpo JSON** y sin
cabecera `Location`.

**R13** — SI quien pregunta es una cuenta de máquina (`apiKey`) o un rol fuera de `ROLES_AYUDA`,
ENTONCES la ruta DEBE rechazar la consulta sin llamar al proveedor.

### C — El tope de gasto

**R14** — MIENTRAS el usuario no haya alcanzado su tope diario de consultas, el sistema DEBE atender
la consulta.

**R15** — CUANDO el usuario alcance su tope diario, el sistema DEBE rechazar la consulta **antes** de
llamar al proveedor, y la respuesta DEBE decir en lenguaje claro que se agotaron las consultas de hoy.

**R16** — El sistema DEBE contar las consultas **por usuario y por día calendario de Costa Rica**, y
ese conteo DEBE vivir en el servidor.

**R17** — El sistema DEBE incrementar el contador **una vez por consulta atendida**, y dos consultas
simultáneas del mismo usuario NO DEBEN producir un solo incremento.

> **Precisión de la revisión (`m2`), no requisito nuevo:** «atendida» se lee al pie de la letra. Una
> consulta rechazada **por el tope** no incrementa nada —quien ya lo alcanzó e insiste no mueve la
> columna—, porque `consultas` es el número que T27 va a leer. Sigue en pie el coste declarado en
> §4.2 del diseño: una consulta que el proveedor no llegue a atender (caída, timeout, falta de
> credencial) **sí** gasta cupo, porque se cuenta antes de llamarlo.

**R18** — SI el cliente envía cualquier valor relacionado con el conteo o el tope, ENTONCES el
servidor DEBE ignorarlo.

### D — Transporte, fallos y degradación

**R19** — El sistema DEBE entregar la respuesta **en trozos, a medida que llegan** del proveedor, sin
esperar a tenerla completa.

**R20** — SI la credencial del proveedor no está configurada, ENTONCES el sistema DEBE decirlo con un
mensaje propio, **sin** llamar al proveedor y **sin** responder un error 500 mudo.

**R21** — SI el proveedor falla o agota el tiempo, ENTONCES el mensaje que llega al usuario NO DEBE
contener la credencial, la URL del proveedor ni el texto crudo del error del proveedor.

**R22** — Un fallo del asistente NO DEBE impedir que la pantalla en la que está montado siga
funcionando.

### E — Las citas

**R23** — CUANDO la respuesta del proveedor señale un documento, el sistema DEBE pintar un enlace a
`/ayuda/<slug>` de ese documento.

**R24** — SI la respuesta señala un documento que **no estaba** en el contexto de esa persona,
ENTONCES el sistema DEBE descartar esa señal y NO pintar ningún enlace por ella.

**R25** — SI la respuesta no señala ningún documento, ENTONCES el sistema NO DEBE pintar ninguna
sección de fuentes ni ningún enlace.

### F — La pantalla

**R26** — El asistente DEBE ser alcanzable desde el encabezado de la pantalla en la que está el
usuario, y DEBE abrirse **sin salir de esa pantalla**.

**R27** — CUANDO el asistente se abra desde una pantalla que tiene documento para ese rol, la
conversación DEBE arrancar con ese documento señalado como contexto de partida.

**R28** — MIENTRAS el panel del asistente esté abierto, la pantalla DEBE mostrar, de forma legible y
sin necesidad de abrir nada, el aviso de que lo que se escriba y las imágenes que se adjunten viajan
a un proveedor externo.

**R29** — El panel DEBE ofrecer adjuntar imágenes y NO DEBE ofrecer adjuntar audio.

**R30** — El sistema NO DEBE guardar la conversación: ni el texto de las preguntas, ni el de las
respuestas, ni las imágenes.

### G — Producción

**R31** — Los documentos DEBEN estar disponibles para la ruta del asistente **en el servidor de
producción**, y el sistema DEBE tener una comprobación que se ponga roja si dejan de estarlo.

### H — Lo que la revisión añadió

**R32** — CUANDO el sistema componga la petición al proveedor, las instrucciones del sistema DEBEN
decir **con qué rol entra quien pregunta**, y ese rol DEBE ser el de la **sesión** —el mismo que
acota los documentos (R7/R9)— y ninguno que venga del cliente.

*Por qué, medido:* sin esto el modelo recibía los documentos correctos y **ninguna pista de con
quién hablaba**; a un `maestro` le contestó «no tenés cómo asignar… desde tu cuenta de tienda». Un
asistente que se equivoca de persona da consejo erróneo con total seguridad, que es el modo de fallo
que D4 y todo el acotamiento venían a evitar. **No cuesta caché**: las instrucciones son el primer
bloque del `system` y el `cache_control` va en el último de documentación, así que el prefijo
cacheable sigue siendo uno por rol —los cinco que el diseño presupuestó—.

**R33** — El sistema DEBE acotar **cuántas imágenes admite una sola petición**, contando las de toda
la conversación, y SI se pasan ENTONCES DEBE rechazarla con un mensaje que diga **qué pasó y cuántas
caben**.

*Por qué:* «una imagen por mensaje» (Q6) no acota el coste de una consulta. La conversación vive en
el cliente (D10) y viaja entera en cada pregunta, así que con 40 mensajes admitidos cabían **40
imágenes en una sola petición**, y van en `messages`, fuera del prefijo cacheado: se pagan enteras
cada vez. Lo único que lo frenaba era el límite de cuerpo de Vercel — plataforma, no código, y en
local ni existe.

---

## Mapa `R<n>` → test

Los archivos marcados **(nuevo)** los crea esta ficha. Los demás existen y se amplían.

| # | Test | Qué lo mata |
| --- | --- | --- |
| R1 | `tests/unit/asistente/contexto-documental.test.ts` **(nuevo)** | el contexto se compara contra los cuerpos REALES del catálogo, no contra literales |
| R2 | `tests/unit/guards/asistente-sin-frontmatter.guardia.test.ts` **(nuevo)** | ninguna cadena del contexto contiene `fuentes:` ni `---` de apertura, con los 33 documentos reales |
| R3 | `tests/unit/guards/asistente-sin-datos.guardia.test.ts` **(nuevo)** | recorre `lib/asistente/**` y `app/api/asistente/**` y falla si aparece un import de Prisma/repositorio/servicio fuera de la lista blanca |
| R4 | `tests/unit/asistente/peticion-al-proveedor.test.ts` **(nuevo)** | el doble captura la petición: `tools` ausente (`'tools' in peticion === false`) y sin `thinking` |
| R5 | `tests/unit/asistente/instrucciones.test.ts` **(nuevo)** | la instrucción de «no lo sé» está en el sistema y se afirma por su literal |
| R6 | `tests/unit/asistente/peticion-al-proveedor.test.ts` **(nuevo)** | exactamente un bloque con `cache_control`, y es el último de documentación |
| R7 | `tests/integration/asistente-route.test.ts` **(nuevo)** | el rol sale del resolutor de sesión doblado, no del cuerpo |
| R8 | `tests/integration/asistente-route.test.ts` **(nuevo)** | se envía `{rol:"maestro", slugs:[...]}` desde un mensajero y el contexto sigue siendo el suyo |
| R9 | `tests/unit/asistente/acotamiento-por-rol.test.ts` **(nuevo)** | el conjunto se deriva del catálogo y del predicado importado, nunca de slugs escritos a mano |
| R10 | `tests/unit/asistente/acotamiento-por-rol.test.ts` **(nuevo)** | rol por rol, conteos contrastados contra el mismo predicado que usa `/ayuda` |
| R11 | `tests/unit/asistente/acotamiento-por-rol.test.ts` **(nuevo)** | busca en el texto que se manda los títulos de los **18** documentos de `docs/ayuda/oficina/` y exige cero |
| R12 | `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` (existente, control ampliado) | la ruta nueva entra en el bloque «CONTROL: … responden 401 con JSON» |
| R13 | `tests/integration/asistente-route.test.ts` **(nuevo)** | `apiKey` y un rol fuera de `ROLES_AYUDA` → rechazo, y el doble del proveedor **no se llamó** |
| R14 | `tests/unit/asistente/tope-diario.test.ts` **(nuevo)** | con el contador por debajo del tope, la consulta llega al proveedor |
| R15 | `tests/unit/asistente/tope-diario.test.ts` **(nuevo)** | en el tope: rechazo **y** `expect(dobleProveedor.llamadas).toEqual([])` |
| R16 | `tests/integration/db/asistente-uso-diario.int.test.ts` **(nuevo)** | contra Postgres real: el `UNIQUE (usuario_id, fecha)` existe y el día es el de Costa Rica en el borde de medianoche |
| R17 | `tests/integration/db/asistente-uso-diario.int.test.ts` **(nuevo)** | dos incrementos concurrentes dejan `consultas = 2`; se mata antes con una mutación que cambie el `upsert` por `read-then-write` |
| R18 | `tests/integration/asistente-route.test.ts` **(nuevo)** | se envía `{consultasHoy:0}` estando en el tope y el rechazo se mantiene |
| R19 | `tests/integration/asistente-route.test.ts` **(nuevo)** | el doble emite tres trozos con pausas y el test lee tres trozos del cuerpo **antes** de que el doble termine |
| R20 | `tests/unit/asistente/sin-credencial.test.ts` **(nuevo)** | sin `ANTHROPIC_API_KEY`: desenlace `sin_credencial`, `fetch` inyectado **no** llamado, status distinto de 500 |
| R21 | `tests/unit/asistente/errores-no-filtran.test.ts` **(nuevo)** | se inyecta una credencial reconocible y un error del proveedor con la URL dentro; ninguna aparece en el cuerpo de la respuesta |
| R22 | `tests/components/AsistentePanel.test.tsx` **(nuevo)** | el panel con la ruta caída pinta su error y el encabezado y el contenido de la página siguen montados |
| R23 | `tests/unit/asistente/citas.test.ts` **(nuevo)** | función pura marcador→enlace: `href` contra los slugs REALES del catálogo |
| R24 | `tests/unit/asistente/citas.test.ts` **(nuevo)** | un slug de oficina en una respuesta de mensajero se descarta; y uno inexistente también |
| R25 | `tests/components/AsistentePanel.test.tsx` **(nuevo)** | respuesta sin marcadores: no hay `<a>` ni encabezado de fuentes |
| R26 | `tests/components/AyudaBoton.test.tsx` (existente, ampliado) | el control del encabezado abre el panel en la misma ruta; `usePathname` no cambia |
| R27 | `tests/components/AsistentePanel.test.tsx` **(nuevo)** | abierto desde `/mis-asignaciones/reparto`, el primer contexto es `mensajero/reparto` |
| R28 | `tests/components/AsistentePanel.test.tsx` **(nuevo)** | el aviso se busca por su texto visible con el panel abierto, sin abrir ningún desplegable |
| R29 | `tests/components/AsistentePanel.test.tsx` **(nuevo)** | hay un control de imagen; `accept` no admite `audio/*` y no existe control de grabación |
| R30 | `tests/unit/guards/asistente-sin-persistencia.guardia.test.ts` **(nuevo)** | recorre el módulo y falla si aparece una escritura a cualquier tabla que no sea la del contador |
| R31 | `tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts` (existente, ampliado) | se añade el caso que exige que **la ruta del asistente** esté cubierta por la clave `/**` y que el catálogo sea su única vía de lectura |
| R32 | `tests/unit/asistente/instrucciones.test.ts` y `tests/integration/asistente-route.test.ts` | los cinco roles se nombran con su etiqueta, **por literal a mano**; y el mismo cuerpo con dos sesiones produce dos textos de sistema distintos, medido sobre lo que llega al proveedor |
| R33 | `tests/integration/asistente-imagenes.test.ts` | cinco imágenes repartidas en cinco mensajes → 422, proveedor **sin llamar**, y el mensaje dice cuántas caben; con cuatro, 200 |

**Sin `R` propio, porque vigilan la forma y no una promesa concreta:**

- `tests/unit/guards/asistente-sin-datos.guardia.test.ts` — además de R3, exige que el **puerto** de
  `lib/interfaces/external/IAsistenteProvider.ts` no importe `next/*`, Prisma ni `process.env`, que
  es el contrato que hace posible construir esto sin credencial (D13).
- `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` — recorre el árbol y ya cubre la
  ruta nueva sola; el control se amplía para que su rechazo sea **exigido** y no sólo «no redirige».

---

## Preguntas abiertas

**Q1 — ¿lectura o visibilidad?** La ficha **435** está en curso y ensancha la LECTURA de maestro y
admin a los 33 documentos, con un **predicado nuevo** en `lib/ayuda/documento.ts`, dejando
`documentoVisiblePara` estricto para `mapaRutaDocumento` (`feature_list.json`, ficha 435). R9 dice
«el mismo predicado que decide el gate de `/ayuda/<slug>`» a propósito, para no nombrar una función
que puede cambiar de significado. **Propuesta, para contrastar:** el asistente sigue al de
**LECTURA** —si la oficina puede leer un documento, debería poder preguntar sobre él— y el empate de
`/ordenes` que preocupa a la 435 **aquí no existe**, porque el asistente recibe un **conjunto** de
documentos y no tiene que elegir uno. Si la respuesta es «no, el asistente va con el estricto», lo
único que cambia es qué función se importa en un sitio.

**Q2 — ¿cuántas consultas al día por usuario, y qué ve quien las agota?** El diseño fija que hay
tope (D11) pero no su número. `design.md §4` propone **30/día** por derivación del propio diseño
(«diez veces al día» × 3 de holgura), configurable por entorno. Hace falta que el humano confirme el
número y el texto que ve quien lo alcanza.

**Q3 — el «?» pasa a abrir un panel: ¿qué le pasa al enlace de hoy?** H3 mide que ese control es hoy
un `<Link>` con seis tests que afirman su `href`. `design.md §6` propone que el «?» abra el panel y
que el panel lleve dentro, como primera acción visible, «Leer la ayuda de esta pantalla» apuntando a
`/ayuda/<slug>` — así no se pierde el acceso al documento completo, pero **seis tests de la 433
cambian de aserción**. La alternativa es dejar el «?» como está y añadir un control separado. Es una
decisión de producto y **pasa por `/design`** (T7), porque es una superficie nueva.

**Q4 — `/configuracion/sinpe` para el `adminSatelite`.** Hoy ese rol abre esa pantalla
(`puedeEditarAlgunSinpe`, `lib/types/sinpe-bodega.ts`) pero **no tiene «?»** ahí, a propósito y con
su motivo escrito en `tests/components/AyudaBoton.test.tsx:136-141`. Si el asistente vive sólo en el
«?», ese rol se queda sin asistente en esa pantalla. Es el **único** par (pantalla, rol) del portal
en esa situación — medido contra las 34 páginas de `app/(app)` y los `pantalla:` de los 33
documentos. ¿Se acepta, o el «?» se monta también cuando no hay documento pero sí hay asistente?

**Q5 — ¿se quiere alguna forma de saber qué se pregunta?** D10 prohíbe persistir la conversación, y
la consecuencia es que **nadie va a poder saber qué pregunta la gente ni cuántas veces el asistente
dijo «no lo sé»** — que es justamente la señal que diría qué documento falta escribir. Lo único que
quedará es el contador de R16 (cuántas, de quién, qué día; sin texto). ¿Se acepta para la v1?

**Q6 — imágenes: tamaño, cantidad y si cuentan para el tope.** D12 las mete en alcance pero no dice
cuántas por mensaje ni de qué tamaño. `design.md §5` propone reutilizar el tope de 5 MB que ya rige
para la evidencia de gestión (`lib/config/gestion.ts`, `next.config.ts:73-75`) y contar una consulta
con imagen igual que una sin ella. Falta confirmarlo.

**Q7 — la credencial.** `ANTHROPIC_API_KEY` no existe todavía y sólo el humano puede crearla
(`progress/design_sf001_p4_asistente.md:117-134`). **No bloquea la implementación ni el merge**
(D13), pero **sí bloquea el despliegue**: T25 y T26 no se pueden hacer sin ella. Recordatorio de lo
ya escrito allí: va a `preview` y a `production` **por separado**, nunca a una variable marcada en
los dos entornos.
