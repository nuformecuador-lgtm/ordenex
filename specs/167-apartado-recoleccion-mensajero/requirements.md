# Feature 167 (Apartado propio de recolección para el mensajero) · requirements.md

> Zona: `fullstack` · Complexity: medium · `depends_on`: 157 (y por transitividad 153, 154, 155).
> Este spec ASUME mergeada la **157** (recolección en tienda por QR, ampliada el 2026-07-31 con el
> estado `recolectando`) y la **111** (bloqueo total del mensajero por cierre pendiente).

## Contexto (leer antes de los requisitos)

**El problema, tal como lo reportó el humano el 2026-07-31.** La recolección en tienda existe y
funciona (157), pero el mensajero **no encuentra cómo recolectar**. La causa está verificada en el
código:

1. el apartado vive DENTRO del módulo de Entregas
   (`MisAsignacionesModule.tsx:429` monta `RecoleccionTiendaPanel`);
2. `RecoleccionTiendaPanel.tsx:121` hace `if (porRecolectar.length === 0) return null`, así que el
   bloque de escaneo —QR + número de guía, que SÍ existe— **desaparece justo cuando la lista está
   vacía**, que es el momento en que el mensajero lo busca;
3. la rama de MODO FOCO (113) tampoco lo monta.

**Qué hace esta feature.** Saca la recolección a un apartado propio, con ruta y entrada de menú
propias, donde el bloque de escaneo se monta SIEMPRE, y añade la lista «Recolectadas hoy». Entregas
deja de montar la recolección, sin conservar ni rastro. **No cambia la lógica de confirmación de la
157**: la transición `recolectando → en_ruta_bodega_central`, sus guardias (rol, propiedad, estado,
bloqueo por cierre), su idempotencia y su rastro en el historial se conservan intactos.

**Decisiones del humano ya cerradas (2026-07-31). No se reabren.**

1. El bloque de escaneo se monta **SIEMPRE**, haya o no órdenes asignadas. Única excepción:
   mensajero BLOQUEADO por cierre pendiente (regla vigente de la 111, R24 de la 157).
2. **Corte limpio** en Entregas: deja de montar el panel y NO conserva aviso, conteo ni enlace.
3. Se añade la lista **«Recolectadas hoy»** en el apartado nuevo.

**Estados y familia usados en este spec** (post-154/157):

| Rol en este flujo | `value` |
| --- | --- |
| Órdenes que el mensajero tiene que ir a recoger a la tienda | `recolectando` |
| Destino de la confirmación (recolectado, viajando a la central) | `en_ruta_bodega_central` |
| Familia de historial que deja la confirmación | `recoleccion_tienda` |
| Estado tras la recepción en la central (feature 138) | `en_bodega_central` |

**Por qué «Recolectadas hoy» no puede leerse del estado actual.** En cuanto la bodega central recibe
el paquete (138), la orden pasa a `en_bodega_central` y desaparecería de cualquier lista derivada del
estado. La única fuente estable de "lo que YO recolecté hoy" es el **historial** de la transición.

---

## Requisitos (EARS)

### Bloque A — Apartado propio, ruta y navegación

**R1 (Ubicuo).** El sistema DEBE ofrecer el apartado de recolección en tienda en una **página propia**,
con una ruta distinta de la del módulo de Entregas.

**R2 (Por evento).** CUANDO un actor autenticado con rol `mensajero` abre la ruta del apartado de
recolección, el sistema DEBE presentar ese apartado con sus datos.

**R3 (Condicional).** SI el actor que abre la ruta del apartado no tiene rol `mensajero`, o no tiene
sesión válida, ENTONCES el sistema DEBE responder como página inexistente, resolviendo el rol en el
**servidor** y sin renderizar ningún dato de recolección.

**R4 (Ubicuo).** El sistema DEBE mostrar en la navegación principal un ítem propio hacia la ruta del
apartado, visible ÚNICAMENTE para el rol `mensajero`.

**R5 (Ubicuo).** El ítem de navegación de R4 DEBE usar una clave de icono PROPIA, no compartida con
ningún otro ítem del menú.

**R6 (Ubicuo).** El sistema DEBE entregar los datos del apartado desde el servidor a la página (el
componente de cliente los recibe por props y NO los fetchea por su cuenta).

---

### Bloque B — El escaneo siempre disponible

**R7 (Ubicuo).** El sistema DEBE montar el bloque de captura de guía —cámara de QR **y** entrada
manual del número— siempre que presenta el apartado, con independencia de cuántas órdenes por
recolectar tenga asignadas el mensajero, **incluido el caso de lista vacía**.

**R8 (Condicional).** SI el mensajero no tiene ninguna orden por recolectar asignada, ENTONCES el
sistema DEBE explicar ese vacío con un mensaje propio y DEBE conservar montado el bloque de captura
de R7.

**R9 (De estado).** MIENTRAS el mensajero esté bloqueado por un cierre pendiente
(`solicitado` / `vencido`), el sistema NO DEBE ofrecer el bloque de captura de R7 y DEBE mostrar un
aviso que diga el motivo del bloqueo y qué hacer para resolverlo.

**R10 (Por evento).** CUANDO el mensajero confirma una guía por la cámara o por el número tecleado,
el sistema DEBE ejecutar la MISMA confirmación de recolección por las dos vías, con el mismo
resultado observable.

**R11 (Condicional).** SI el texto escaneado o el número tecleado no resuelve a un entero positivo,
ENTONCES el sistema DEBE rechazarlo como código inválido en el borde del cliente, sin invocar la
confirmación de servidor.

**R12 (Ubicuo).** El sistema DEBE enviar a la confirmación de servidor toda guía bien formada, AUNQUE
no figure en la lista de órdenes por recolectar cargada en pantalla: la propiedad de la orden y su
estado los DEBE decidir el servidor.

**R13 (Por evento).** CUANDO la confirmación devuelve un resultado, el sistema DEBE informar al
mensajero con un mensaje distinto y claro por cada resultado posible (efectiva, ya recolectada, no
encontrada, estado inválido, código inválido, no autorizada, no autenticada, conflicto por bloqueo o
por carrera).

**R14 (Por evento).** CUANDO una confirmación resulta efectiva o idempotente, el sistema DEBE
actualizar el apartado de modo que esa orden deje de figurar entre las pendientes y pase a figurar
entre las recolectadas de hoy.

**R15 (De estado).** MIENTRAS no se produzca otra confirmación efectiva, el sistema DEBE mantener
visible la confirmación de la última guía recolectada.

**R16 (Ubicuo).** El sistema DEBE mantener sin cambios la lógica de confirmación ya vigente: la
transición `recolectando → en_ruta_bodega_central`, sus guardias de rol, propiedad, estado y bloqueo
por cierre, su idempotencia y su rastro en el historial con familia `recoleccion_tienda`.

---

### Bloque C — Lista «Por recolectar»

**R17 (Ubicuo).** El sistema DEBE agrupar las órdenes por recolectar por **tienda de origen**.

**R18 (Ubicuo).** El sistema DEBE mostrar por orden únicamente datos pertinentes a una recolección:
número de guía, número de remisión, producto y destinatario; y NO DEBE mostrar monto a cobrar ni
ningún otro dato de cobro.

**R19 (Ubicuo).** El sistema DEBE ofrecer un medio de contacto telefónico con la tienda de origen
cuando la tienda tenga teléfono registrado.

**R20 (Condicional).** SI la tienda de origen no tiene teléfono registrado, ENTONCES el sistema NO
DEBE pintar controles de contacto para esa tienda.

**R21 (Ubicuo).** El sistema NO DEBE mostrar en el apartado ninguna orden que no tenga al actor como
mensajero asignado y en el estado de recolección asignada.

**R22 (De estado).** MIENTRAS el mensajero opera sobre el apartado, el sistema NO DEBE ofrecer el
flujo de gestión de entrega —selección de resultado, causa de devolución, captura de evidencias,
fecha de reprogramación, método de pago— ni DEBE fijar o consultar el puntero de gestión 1-a-1.

**R23 (De estado).** MIENTRAS el mensajero esté bloqueado por un cierre pendiente, el sistema DEBE
seguir mostrando la lista de órdenes por recolectar en modo solo-lectura.

---

### Bloque D — Lista «Recolectadas hoy»

**R24 (Ubicuo).** El sistema DEBE mostrar en el apartado la lista de las órdenes que el **propio**
mensajero recolectó en tienda durante el día en curso.

**R25 (Ubicuo).** La lista de R24 DEBE derivarse del **registro histórico** de la transición de
recolección —familia de origen `recoleccion_tienda`, actuada por el actor— y NO del estado actual de
la orden.

**R26 (Ubicuo).** El sistema DEBE seguir mostrando en la lista de R24 una orden recolectada hoy
aunque la bodega central ya la haya recibido y su estado actual sea `en_bodega_central`.

**R27 (Ubicuo).** El "día en curso" de R24 DEBE ser el **día natural de Costa Rica** (de 00:00 a
24:00 hora de pared de CR), la misma convención de día operativo que usa la analítica.

**R28 (Ubicuo).** La lista de R24 DEBE mostrar por orden su número de guía, su número de remisión, su
tienda de origen y la hora de la recolección, ordenadas de la más reciente a la más antigua.

**R29 (Ubicuo).** El sistema NO DEBE incluir en la lista de R24 recolecciones actuadas por otro
mensajero, recolecciones de días anteriores, ni órdenes borradas.

**R30 (Condicional).** SI el mensajero no ha recolectado ninguna orden hoy, ENTONCES el sistema DEBE
decirlo explícitamente en lugar de omitir la lista.

**R31 (Condicional).** SI el número de recolecciones del día supera el tope de presentación,
ENTONCES el sistema DEBE mostrar las más recientes hasta ese tope e indicar que la lista está
recortada.

**R32 (Ubicuo).** El sistema DEBE resolver la consulta que sostiene R24 sobre un **índice** de la
tabla de historial por actor, familia de origen e instante.

---

### Bloque E — Corte limpio en Entregas

**R33 (Ubicuo).** El módulo de Entregas NO DEBE montar ninguna superficie de recolección: ni lista,
ni bloque de escaneo, ni aviso, ni conteo, ni enlace al apartado nuevo.

**R34 (Ubicuo).** El contrato de datos de Entregas NO DEBE transportar órdenes en estado de
recolección: su lectura DEBE pedir exclusivamente los estados de "por recoger" y "en reparto".

**R35 (Ubicuo).** El sistema DEBE mantener sin cambios el flujo, los campos y el modo foco del panel
de gestión de entrega de Entregas.

---

### Bloque F — No contaminación (aislamiento heredado de la 157)

**R36 (Ubicuo).** El sistema NO DEBE incluir las órdenes de recolección en la ruta optimizada, en el
mapa de paradas ni en los KPIs del mensajero (`pendientes`, `por cobrar`, `total a cobrar`).

**R37 (Ubicuo).** El sistema NO DEBE contar una orden de recolección como pendiente de gestión: no
DEBE bloquear el gate de "Solicitar cierre", no DEBE ser convertida a `sin_gestionar` por el corte
diario y no DEBE entrar en el ranking diario.

**R38 (Ubicuo).** El contrato de datos del apartado nuevo NO DEBE transportar datos de cobro ni de
ruta: ni monto a cobrar, ni coordenadas, ni secuencia de ruta.

**R39 (Ubicuo).** El sistema NO DEBE producir ningún registro de gestión ni ningún movimiento de
dinero como consecuencia de mostrar o confirmar una recolección.

---

## Trazabilidad (mapa requisito → prueba prevista; lo cierra el implementer)

Cada `R<n>` termina mapeado a un test concreto en `progress/impl_167-apartado-recoleccion-mensajero.md`.

| Requisito | Prueba prevista |
| --- | --- |
| R1, R2, R3, R6 | `tests/components/RecoleccionPage.test.tsx` (rol no mensajero → `notFound`; mensajero → apartado con datos por props) |
| R4, R5 | `tests/unit/auth/menu-visibility.test.ts` (el mensajero ve el ítem; ningún otro rol lo ve; clave de icono única) + `tests/components/Sidebar.test.tsx` (la clave resuelve a su icono propio) |
| R7, R8 | `tests/components/RecoleccionModule.test.tsx` → "con la lista vacía el bloque de escaneo sigue montado y se explica el vacío" |
| R9 | `tests/components/RecoleccionModule.test.tsx` → "bloqueado por cierre: sin bloque de escaneo, con aviso accionable" |
| R10, R11 | `tests/components/RecoleccionModule.test.tsx` → "las dos vías confirman igual" / "un código que no son dígitos no llega a la action" |
| R12 | `tests/components/RecoleccionModule.test.tsx` → "una guía que no está en la lista cargada SÍ llega al servidor" |
| R13 | `tests/components/RecoleccionModule.test.tsx` (efectiva / ya recolectada / no encontrada) + `tests/unit/actions/recoleccion-tienda-action.test.ts` (resto de estados) |
| R14, R15 | `tests/components/RecoleccionModule.test.tsx` → "tras confirmar, revalida" / "la confirmación de la última permanece" |
| R16 | `tests/unit/services/recoleccion-tienda-service.test.ts` **sin tocar** (los casos R26–R35 de la 157 siguen verdes) |
| R17, R18, R19, R20 | `tests/components/RecoleccionModule.test.tsx` (agrupa por tienda; sin datos de cobro; llama a la TIENDA; sin teléfono no pinta botones) |
| R21, R38 | `tests/unit/services/recoleccion-tienda-service.test.ts` → bloque `listarRecoleccion` (acotado al actor y al estado; el DTO no lleva monto/coordenadas/secuencia) |
| R22 | `tests/components/RecoleccionModule.test.tsx` → "NO ofrece ningún control de gestión" |
| R23 | `tests/components/RecoleccionModule.test.tsx` → "bloqueado: la lista se ve, la acción no" |
| R24, R25, R26, R29 | `tests/unit/services/recoleccion-tienda-service.test.ts` → "sale del historial, no del estado" / "una ya recibida en central sigue figurando" / "no trae la de otro actor, ni la de ayer, ni la borrada" |
| R27 | `tests/unit/services/recoleccion-tienda-service.test.ts` → ventana `[06:00Z, 06:00Z+24h)` con reloj inyectado (casos de borde 23:59 y 00:00 CR) |
| R28, R30, R31 | `tests/components/RecoleccionModule.test.tsx` (orden y contenido de la lista; vacío explícito; aviso de recorte) + caso de tope en el service |
| R32 | `tests/integration/db/orden-historial-actor-origen-index-migration.test.ts` (UP crea el índice, DOWN lo borra) |
| R33, R34 | `tests/unit/guards/entregas-sin-recoleccion.test.ts` + `tests/components/MisAsignacionesModule.test.tsx` → "Entregas no monta ninguna superficie de recolección" + `tests/unit/services/mis-asignaciones-service.test.ts` → "pide exactamente `por_recoger` y `en_reparto`" |
| R35 | `tests/components/MisAsignacionesModule.test.tsx` (casos de gestión y modo foco existentes, verdes sin tocar) |
| R36 | `tests/unit/services/mis-asignaciones-service.test.ts` (KPIs y paradas derivan solo de `en_reparto`) |
| R37, R39 | `tests/unit/guards/recoleccion-no-contamina.test.ts` **sin tocar** (sigue verde tal cual) |

---

## Preguntas abiertas

> No se rellenan con supuestos silenciosos. Donde el diseño necesita un valor para avanzar, está
> declarado en `design.md` como decisión revocable y se anota aquí para la puerta de aprobación.

1. **Buscador en el apartado nuevo.** Hoy Entregas aplicaba su buscador de guías (114) también a la
   lista de recolección (`MisAsignacionesModule.tsx:430`). El corte limpio se lo lleva. ¿Hace falta
   un buscador propio en el apartado nuevo, o basta con el escáner y la lista agrupada por tienda?
   *Decisión provisional del diseño:* sin buscador (la acción es escanear; la lista es referencia).

2. **Tope y profundidad de «Recolectadas hoy».** El diseño fija un tope de presentación de **100**
   recolecciones del día, las más recientes (R31). ¿Es el número correcto? ¿Hace falta un "ver más" o
   un histórico de días anteriores, o "hoy" es suficiente para el uso real?

3. **Órdenes borradas en «Recolectadas hoy».** El diseño las excluye (R29), por coherencia con el
   resto de superficies del mensajero, que filtran `deleted_at IS NULL`. ¿Se confirma, o una orden
   borrada después de recolectada debe seguir acreditando el trabajo hecho?

4. **Etiqueta y posición del ítem de menú.** El diseño propone **«Recolección»**, situado justo
   debajo de «Entregas». Es copy visible al mensajero y cambiarlo es de una línea; se confirma en la
   puerta.

5. **Sin dato del que tirar: dirección de la tienda.** Sigue abierta desde la 157 (pregunta 2 de su
   `requirements.md`): el modelo no tiene dirección de tienda, así que el mensajero llega con nombre
   y teléfono. Esta feature no lo cambia; se registra para que no se pierda.
