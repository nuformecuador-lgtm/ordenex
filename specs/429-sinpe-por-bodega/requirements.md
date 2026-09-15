# Ficha 429 — un SINPE por bodega, editable desde la app

**Zona:** fullstack. **SDD:** sí. **Rama:** `feat/429-sinpe-por-bodega`.
**Lleva migración** (dos columnas nuevas en `zona`, una tercera de control, un valor nuevo de
`historial_accion_tipo` y una siembra de datos), así que **se implementa SOLA** y **el gate rápido se
niega**: el veredicto sale de `./init.sh` completo.

**Es el PUNTO 2 de SF-001.** El diseño acordado y verificado contra el código vive en
`progress/design_sf001_p2_sinpe_por_bodega.md`. Este documento lo da por cierto y no lo re-verifica.

---

## Lo que ya está decidido y firmado (no se reabre)

| # | Decisión del humano (2026-09-15) |
| --- | --- |
| D1 | **Son DOS campos**: número y titular. El documento firmado dice «solo el SINPE» en singular y se equivoca: la plantilla real `listo_para_entrega_mensajero` empareja «al número {{sinpe}} a nombre de {{sinpe_nombre}}». Separarlos le daría al cliente el número de una persona bajo el nombre de otra. |
| D2 | **El campo cuelga de la BODEGA (zona)**, no de la persona. Dos accesos de la misma bodega ven y editan el mismo valor. |
| D3 | **Tres capas para que no haya hueco**: (a) siembra de las 8 zonas con el SINPE global de hoy, en la migración; (b) obligatorio al crear una bodega nueva; (c) revisión obligatoria al primer inicio de sesión del admin de esa bodega, una sola vez. |
| D4 | **La central (GAM) también se configura desde la app**, por `admin` y `maestro` — allí no hay `adminSatelite`. La variable de entorno queda solo como semilla. |
| D5 | **Validación real**: móvil de Costa Rica, 8 dígitos, que empieza por 6, 7 u 8. No un «no vacío». |
| D6 | **Rastro de quién lo cambió y cuándo** en `historial_accion`, que ya existe. |
| D7 | La pantalla nueva **pasa por `/design`** antes de implementarse. Aquí se especifica QUÉ tiene que hacer, no cómo se ve. |
| D8 | **No sale a producción** sin estar seguros de que no daña lo que ya funciona (condición para las cuatro fichas de SF-001). |

## El riesgo que manda sobre todo lo demás

Un SINPE mal escrito **no produce ningún error visible**. El mensaje sale, el cliente transfiere, y se
sabe días después por los reclamos. Por eso los requisitos de abajo están escritos para que el estado
malo **no sea representable**, y no para que alguien se acuerde de comprobarlo:
una bodega sin SINPE no puede existir (R6), un número con formato imposible no se puede guardar por
**ningún** camino —ni desde la app, ni desde un script, ni desde SQL a mano— (R7/R8), y una pantalla
que pinte plantillas sin tener el SINPE en la mano **no compila** (R14).

## Lo que esta ficha NO hace (límites declarados)

1. **No toca las plantillas ni su aprobación por Meta.** Meta aprueba la FORMA; `{{sinpe}}` y
   `{{sinpe_nombre}}` ya existen y no cambian de nombre. No se crea ninguna plantilla nueva.
2. **No añade el SINPE a las otras tres plantillas vivas.** Solo una de las cuatro lo usa.
3. **No hay SINPE por tienda, por mensajero ni por orden.** Uno por bodega, y punto (D2).
4. **No concilia nada contra el banco.** El sistema no comprueba que una transferencia llegó, ni que
   el número existe en SINPE Móvil, ni que pertenece al titular escrito. No hay API externa.
5. **No cambia cómo se registra un pago** (`gestion_orden_pago`, `metodo_pago = simpe`), ni los
   cierres, ni los totales, ni una sola línea de dinero.
6. **No cambia el CRUD de zonas**, que sigue siendo `maestro`-only. Esta ficha abre UNA superficie
   nueva y estrecha —dos campos— con su propio permiso.
7. **No toca `NEXT_PUBLIC_SITE_URL` ni `{{url_guia}}`.** El `urlBase` del bloque `negocio` se queda
   donde está y como está.
8. **No guarda el histórico de titulares.** El historial registra el número de antes y el de después;
   el nombre del titular no entra (ver R20 y su límite declarado).
9. **No borra la cuenta «prueba BORRAR»** de Puntarenas, hallazgo incidental del documento previo.
10. **No hay E2E.** Este repo no tiene arné E2E vivo; la verificación es unitaria, de integración
    contra Postgres real, guardias estáticas y una medición en producción (ver `tasks.md`).

---

## Requisitos (EARS) — 31

### A — Dónde vive el dato y qué estados son posibles

**R1** — El sistema DEBE guardar, para CADA bodega, un número SINPE y un nombre de titular.

**R2** — El sistema DEBE tratar esos dos valores como un dato de la BODEGA: dos personas que
administren la misma bodega DEBEN ver y editar exactamente el mismo par de valores.

**R3** — CUANDO se dé de alta un segundo acceso administrativo a una bodega que ya tiene SINPE, el
sistema NO DEBE volver a pedirlo.

**R4** — El sistema DEBE guardar además, por bodega, la marca de que alguien ya revisó ese SINPE
dentro de la aplicación, y la fecha de esa revisión.

**R5** — MIENTRAS nadie haya revisado el SINPE de una bodega dentro de la aplicación, el sistema DEBE
poder distinguir esa bodega de una cuyo SINPE sí se revisó. La ausencia de revisión NO DEBE poder
confundirse con una revisión.

**R6** — El sistema NO DEBE poder representar una bodega sin número SINPE o sin titular. Un intento
de crear o dejar una bodega con cualquiera de los dos campos vacío DEBE fallar en la capa de datos,
no solo en el formulario.

**R7** — El sistema NO DEBE poder almacenar un número SINPE que no sea un móvil de Costa Rica: ocho
dígitos exactos, el primero 6, 7 u 8. Esta restricción DEBE cumplirse aunque la escritura no venga de
la aplicación.

**R8** — El sistema NO DEBE poder almacenar un titular vacío o compuesto solo de espacios.

**R9** — CUANDO se guarde un número SINPE escrito con espacios, guiones o el prefijo del país, el
sistema DEBE normalizarlo a los ocho dígitos antes de guardarlo, o DEBE rechazarlo diciendo qué
formato espera. En ningún caso DEBE guardarlo tal cual.

### B — La siembra y la creación de bodegas

**R10** — CUANDO se aplique la migración de esta ficha, el sistema DEBE dejar las ocho bodegas
existentes con el mismo número y el mismo titular que la operación usa hoy, y DEBE dejarlas todas
marcadas como **no revisadas**.

**R11** — CUANDO se cree una bodega nueva, el sistema DEBE exigir el número y el titular en el mismo
acto de creación, y DEBE rechazar la creación si falta cualquiera de los dos o si el número no cumple
R7.

**R12** — CUANDO se cree una bodega nueva con un SINPE tecleado por una persona, el sistema DEBE
darla por revisada, sin volver a pedir una confirmación.

### C — Cómo llega el valor a quien escribe el mensaje

**R13** — El sistema DEBE resolver el SINPE que aparece en un mensaje a partir de la bodega del
MENSAJERO asignado a esa orden.

**R14** — SI una superficie de la aplicación renderiza una plantilla que puede contener `{{sinpe}}` o
`{{sinpe_nombre}}`, ENTONCES el sistema DEBE exigirle que aporte el par de valores. Una superficie que
no lo aporte NO DEBE poder construirse.

**R15** — SI la orden no tiene mensajero asignado, O SI el mensajero asignado no tiene bodega,
ENTONCES el sistema DEBE usar el SINPE de la bodega de la ORDEN. El mensaje NO DEBE salir nunca con el
campo vacío.

**R16** — El sistema DEBE resolver el SINPE con la MISMA regla en el envío que hace el servidor y en
el texto que se compone en el dispositivo de quien contacta al cliente. Las dos superficies NO DEBEN
poder dar resultados distintos para la misma orden.

**R17** — El sistema NO DEBE leer el número ni el titular de la configuración del entorno en ningún
punto, y NO DEBE horneárselos al paquete que se descarga el navegador.

**R18** — El sistema NO DEBE aceptar el número ni el titular desde el dispositivo de quien envía el
mensaje: los dos valores DEBEN venir resueltos por el servidor junto con los datos de la orden.

### D — Quién puede cambiarlo, y el rastro

**R19** — El sistema DEBE permitir editar el SINPE de una bodega a `maestro`, a `admin` y al
`adminSatelite` de ESA bodega. A cualquier otro rol DEBE negárselo.

**R20** — SI un `adminSatelite` pide editar una bodega que no es la suya, ENTONCES el sistema DEBE
negarlo sin escribir nada, y DEBE decidirlo con la bodega que la base le asigna a esa persona, nunca
con un dato que venga en la petición.

**R21** — CUANDO el número o el titular de una bodega queden distintos tras un guardado, el sistema
DEBE registrar en el historial de acciones exactamente UNA fila referida a esa bodega, que diga quién
—usuario, nombre y rol congelados en ese instante—, cuándo, sobre qué bodega, y el número de antes y
el número de después.

**R22** — El sistema DEBE clasificar esa acción como una acción que MUEVE DINERO.

**R23** — Ninguna fila de R21 DEBE contener el nombre del titular, ni ningún dato del destinatario de
una orden, ni texto libre tecleado por una persona.

**R24** — El sistema DEBE escribir la fila de R21 en la MISMA transacción que el cambio que documenta,
de modo que no pueda quedar un cambio sin fila ni una fila sin cambio.

**R25** — CUANDO alguien confirme un SINPE sin cambiar ninguno de los dos valores, el sistema DEBE
marcar la bodega como revisada y NO DEBE registrar ninguna fila en el historial.

### E — La revisión obligatoria al primer inicio de sesión

**R26** — CUANDO inicie sesión una persona que puede editar el SINPE de una bodega no revisada, el
sistema DEBE ponerle delante el número y el titular de esa bodega y pedirle que los confirme o los
corrija, sin que tenga que ir a buscarlos.

**R27** — El aviso de R26 DEBE permitir corregir el valor en el sitio, sin abandonar la pantalla en la
que la persona estaba.

**R28** — El aviso de R26 NO DEBE impedir el acceso a ninguna pantalla ni bloquear ninguna acción. SI
la persona lo cierra sin confirmar, ENTONCES DEBE poder seguir trabajando con normalidad.

**R29** — SI la persona cierra el aviso sin confirmar, ENTONCES el sistema NO DEBE volver a mostrárselo
durante esa sesión, y DEBE volver a mostrárselo la próxima vez que inicie sesión.

**R30** — MIENTRAS la bodega esté marcada como revisada, el sistema NO DEBE volver a mostrar el aviso
a nadie de esa bodega.

**R31** — El sistema NO DEBE mostrar el aviso a quien no puede editar ninguna bodega.

---

## Trazabilidad R → test

Cada requisito tiene un test concreto. El mapa definitivo lo escribe el implementer en
`progress/impl_429.md`; esta tabla es el contrato que ese mapa tiene que cumplir.

| R | Cómo se prueba | Dónde vive |
| --- | --- | --- |
| R1 | tras la migración, las dos columnas existen, son `NOT NULL` y tienen el tipo esperado | `tests/integration/db/zona-sinpe-migration.test.ts` (Postgres real) |
| R2 | dos usuarios distintos de la misma bodega leen el mismo par; el guardado de uno lo ve el otro | `tests/integration/db/zona-sinpe-permisos.test.ts` |
| R3 | crear un segundo `adminSatelite` en una bodega con SINPE no exige el campo ni lo pisa | `tests/unit/services/usuario-*.test.ts` (aserción añadida) |
| R4 | la columna de revisión existe, es nullable, y se rellena solo por el camino de escritura | `tests/integration/db/zona-sinpe-migration.test.ts` |
| R5 | una bodega sembrada tiene la marca vacía; tras confirmar, tiene fecha | `tests/integration/db/zona-sinpe-revision.test.ts` |
| R6 | `INSERT`/`UPDATE` directo con `NULL` en cualquiera de las dos → Postgres lo rechaza | `tests/integration/db/zona-sinpe-migration.test.ts` |
| R7 | tabla de casos contra Postgres real: `12345678`, `9123456`, `812345678`, `8123456a`, `""` → rechazados; `61234567`, `71234567`, `81234567` → aceptados. **La misma tabla** se corre contra el validador de la aplicación | `tests/integration/db/zona-sinpe-migration.test.ts` + `tests/unit/utils/sinpe-cr.test.ts` |
| R8 | `UPDATE` directo a `''` y a `'   '` → rechazado por la base | `tests/integration/db/zona-sinpe-migration.test.ts` |
| R9 | `"8888 1111"`, `"8888-1111"`, `"+506 88881111"` → o normalizan a `88881111`, o se rechazan; nunca se guardan con separadores | `tests/unit/utils/sinpe-cr.test.ts` + integración |
| R10 | se levanta el estado previo con las migraciones reales, se aplica el `up`, y se afirma: 0 filas de `zona` con SINPE distinto del sembrado y 0 con marca de revisión | `tests/integration/db/zona-sinpe-migration.test.ts` |
| R11 | `crearZona` sin los campos → `validation_error`; con número inválido → `validation_error` en el campo del número | `tests/unit/services/zona-service.test.ts` + `tests/integration/actions/zonas-action.test.ts` |
| R12 | crear una zona → la marca de revisión queda con fecha, no vacía | `tests/integration/db/zona-sinpe-revision.test.ts` |
| R13 | orden con mensajero de la bodega B → el par resuelto es el de B, no el de la bodega de la orden (fixture con B ≠ zona de la orden) | `tests/unit/utils/resolver-sinpe.test.ts` + `tests/unit/repositories/orden-envio-reader.test.ts` |
| R14 | guardia estática: todo montaje de `EnviarPlantillaWhatsappButton` y todo constructor de `DatosPlantilla` aporta el par; contraprueba que quita el campo de un DTO y verifica que el typecheck cae | `tests/unit/guards/sinpe-en-toda-superficie.guardia.test.ts` + `pnpm run typecheck` |
| R15 | tres casos: sin mensajero, mensajero sin zona, mensajero con zona → el par nunca es `""` y en los dos primeros es el de la zona de la orden | `tests/unit/utils/resolver-sinpe.test.ts` |
| R16 | el mismo fixture de orden pasa por el camino del servidor y por el del DTO y produce **el mismo texto renderizado**, carácter a carácter | `tests/unit/plantillas/preview-mismo-motor.test.ts` (caso añadido) |
| R17 | guardia estática: la cadena `NEXT_PUBLIC_SINPE` no aparece en `lib/`, `app/`, `components/`, `hooks/`, `scripts/` ni `.env.example`; con contraprueba que la inyecta y comprueba que la guardia se pone roja | `tests/unit/guards/sinpe-sin-variables-de-entorno.guardia.test.ts` |
| R18 | la acción de envío ignora un par inyectado en el payload: se afirma que el texto enviado lleva el de la base | `tests/unit/services/chat-whatsapp-*.test.ts` |
| R19 | matriz de roles × bodegas contra la acción: `maestro` ok en las 8, `admin` ok en las 8, `adminSatelite` ok en la suya, `mensajero`/`adminTienda` `forbidden` en todas | `tests/integration/actions/sinpe-bodega-action.test.ts` |
| R20 | `adminSatelite` de A pide guardar B → `forbidden` **y** B sigue con su valor anterior; además, un payload con `zonaId` ajeno no cambia la zona que el servicio usa | mismo archivo |
| R21 | guardar un número distinto → 1 fila del tipo nuevo, con actor congelado, etiqueta de la zona, `valor_anterior`/`valor_nuevo` = los dos números | `tests/integration/db/zona-sinpe-rastro.test.ts` |
| R22 | `CATEGORIA_POR_ACCION` del tipo nuevo es `mueve_dinero`; el reparto del catálogo sigue siendo exhaustivo y los conteos cuadran | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| R23 | `monto` en `NULL`, el titular NO aparece en ninguna columna de la fila, y la guardia de vocabulario prohibido barre el repositorio nuevo | `tests/integration/db/zona-sinpe-rastro.test.ts` + `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts` |
| R24 | censo de la guardia con entrada propia (mutación exigida sobre el `update` de las columnas) + caso de integración: guardado que revienta después de escribir → 0 filas y valor anterior intacto | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` + integración |
| R25 | confirmar con los MISMOS dos valores → 0 filas de historial y marca de revisión con fecha | `tests/integration/db/zona-sinpe-revision.test.ts` |
| R26 | resolver el aviso para cada rol: `adminSatelite` de bodega no revisada → lo recibe con el par de SU bodega; `admin`/`maestro` → lo reciben con el de la central | `tests/unit/auth/revision-sinpe-pendiente.test.ts` |
| R27 | el componente ofrece corregir sin navegar: el guardado se hace desde el propio aviso | `tests/components/RevisionSinpeBodega.test.tsx` |
| R28 | ninguna ruta redirige ni devuelve 403 por tener la revisión pendiente; el layout monta el aviso como hermano del contenido, no como envoltorio | `tests/unit/guards/revision-sinpe-no-bloquea.guardia.test.ts` |
| R29 | cerrar sin confirmar → no reaparece con la marca de sesión puesta; sin esa marca → reaparece | `tests/components/RevisionSinpeBodega.test.tsx` |
| R30 | bodega con fecha de revisión → el resolvedor devuelve «nada que pedir» para todos sus administradores | `tests/unit/auth/revision-sinpe-pendiente.test.ts` |
| R31 | `mensajero` y `adminTienda` → el resolvedor devuelve «nada que pedir» y el layout no hace ninguna consulta extra por ellos | mismo archivo |

---

## Preguntas abiertas

**Q1 (BLOQUEANTE para escribir la migración) — los dos valores literales de la siembra.**
La siembra de R10 necesita el número y el titular que la operación usa HOY, y una migración no puede
leerlos del entorno. Hacen falta dos cosas del humano:

1. **Los dos valores tal cual están en Vercel.** No los tengo y no los invento.
2. **La confirmación de que el número actual cumple R7** (8 dígitos, empieza por 6, 7 u 8). Si no lo
   cumpliera, la migración fallaría al aplicar el `CHECK`, y habría que decidir antes cuál es el
   número correcto — que es exactamente la clase de dato que esta ficha existe para dejar de adivinar.
3. **Permiso para escribirlos como literales en `db/migrations/.../migration.sql`**, que es un archivo
   versionado. Recomendación: sí. El número se le manda a cada cliente en cada mensaje —no es una
   credencial— y una migración cuyo resultado dependa del entorno donde corra produce bases distintas
   a partir del mismo código, que es peor. Si el humano prefiere que el TITULAR no quede en el repo,
   la alternativa es sembrarlo con un texto neutro y que la revisión de R26 lo corrija — con el coste
   declarado de que entre el despliegue y esa corrección el cliente lee un titular que no es el real.

**Q2 — ¿`admin` edita CUALQUIER bodega, o solo la central?**
El diseño propone **cualquiera** (R19), y el argumento está en `design.md §5`. Es una decisión
vetable: si el humano prefiere acotar `admin` a la central, se cambia una línea del servicio y su
test, y el resto del diseño no se mueve. Lo que se pierde con el veto: cuando el `adminSatelite` de
una bodega no esté disponible, corregir un número equivocado vuelve a depender del `maestro`.

**Q3 — ¿la pantalla vive en su propia entrada de menú?**
El diseño propone UNA entrada nueva de primer nivel visible a los tres roles, **al final** de la
barra. La etiqueta y la ruta son decisión de `/design` (D7); lo que no es negociable es la posición,
por el motivo de `design.md §6.3`.

**Q4 — el momento de retirar las variables de entorno de Vercel.**
El diseño las retira del código y de `.env.example` en este mismo PR (R17). Borrarlas del panel de
Vercel es un paso manual que no puede hacer el implementer: queda en `tasks.md` como paso posterior
al despliegue verde. Se necesita que el humano confirme que lo hará él, o que acepta que se queden
ahí sin que nadie las lea.
