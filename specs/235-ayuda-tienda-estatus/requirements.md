# Feature 235 — Ayuda a la tienda: estatus propio y el viaje completo de ida y vuelta

> **El punto de partida es inusual: parte ya existe, con otro diseño.**
>
> La solicitud de ayuda está mergeada en `dev` (merge #396, **sin ficha ni spec**) como un
> **BOOLEANO `orden.ayuda`**. Esta ficha lo migra a un **estatus propio** y completa el viaje.
>
> Fuentes medidas, no re-derivadas aquí: `progress/auditoria_ayuda_tienda.md` §2/§4 ·
> `progress/design_pila_ayuda_tienda.md` §F1 (diseño aprobado por el humano) ·
> `specs/239-devolucion-espera-cierre/` (ya mergeada; el molde de «estatus nuevo + aristas +
> migración de enum + mapa» se copia de ahí).
>
> **Base:** `origin/dev` **con la 239 ya dentro** (decisión del leader del 2026-08-19: la 239 va
> primera de la pila; las 235/236/240 se especifican asumiéndola).

---

## Por qué un estatus y no una bandera — el argumento, en una línea

**Con un booleano, cada superficie que debería excluir la orden tiene que filtrarlo A MANO, y hoy
no lo filtra ninguna:** el optimizador de ruta (`findParadasEnReparto`), el mapa, el chat,
`TrayectoVivoButton` ni el listado del servidor. El corte a «sección aparte» es **solo de cliente**
(`RepartoModule`). **Con un estatus, la guardia de transiciones rompe el build si falta un caso.**
Con un booleano no se entera nadie.

Los tres efectos de segundo orden que hoy dependen de que la orden **siga en `en_reparto`**:

| Hoy | Por qué funciona | Qué le pasa |
| --- | --- | --- |
| El bloqueo del cierre | `ESTADOS_PENDIENTES = ["por_recoger", "en_reparto"]` la cuenta | **Funciona por accidente.** Nadie escribió «una orden con ayuda bloquea el cierre» |
| La orden sigue gestionable | `cargarOrdenGestionable` exige `en_reparto` y la orden lo cumple | El apartado aparte no impide nada: es maquetación |
| El corte nocturno | Barre `en_reparto → sin_gestionar` | La barre **sin apagar la bandera** (la fuga de la auditoría §2.1) |

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **el estatus de ayuda** | Estado de orden que significa «el mensajero pidió ayuda a la tienda sobre esta orden; el paquete sigue con él, en la calle». Su `value` es decisión abierta (P1); recomendación `ayuda_tienda`. |
| **solicitud** | La transición `en_reparto → el estatus de ayuda`, con su nota obligatoria. |
| **rescate** | La transición inversa, `el estatus de ayuda → en_reparto`. La disparan **los dos lados**: el mensajero («Recuperar») y la tienda («Habilitar»). |
| **la bandera** | La columna booleana `orden.ayuda` que existe hoy en `dev`. |
| **el hilo** | El hilo de notas de la orden (`orden_nota`, feature 227), compartido por tienda y mensajero. |
| **choke point** | `appendCambioEstado`: el punto único de escritura de estado, que valida la transición contra `TRANSICIONES` con fallo cerrado. |

---

## A · El estatus, sus aristas y su registro

**R1.** El sistema DEBE disponer de un estado de orden, distinto de `en_reparto`, que represente
«hay una solicitud de ayuda viva sobre esta orden y el paquete sigue con el mensajero».

**R2.** CUANDO un mensajero solicita ayuda sobre una orden en reparto asignada a él, el sistema DEBE
dejar la orden en el estatus de ayuda.

**R3.** CUANDO un mensajero solicita ayuda, el sistema DEBE publicar el motivo como nota del hilo de
esa orden **antes** de cambiar el estado, y DEBE hacer las dos cosas de forma que no pueda quedar
una sin la otra.

**R4.** SI la nota no se acepta —motivo vacío tras recortar, motivo por encima del tope, actor sin
acceso al hilo de esa orden, o orden fuera de reparto—, ENTONCES el sistema NO DEBE cambiar el
estado de la orden.

**R5.** El sistema DEBE revalidar el tope de longitud del motivo **en el borde del servidor**, y NO
DEBE depender de la interfaz para hacerlo cumplir.

**R6.** CUANDO un mensajero solicita ayuda, el sistema NO DEBE modificar el mensajero asignado de la
orden.

**R7.** CUANDO un mensajero solicita ayuda sobre la orden que tiene abierta en gestión, el sistema
DEBE liberar su puntero de gestión en curso, y NO DEBE liberar el de ningún otro usuario ni uno que
apunte a otra orden.

**R8.** El sistema DEBE disponer de **un solo punto de escritura** para devolver una orden desde el
estatus de ayuda a `en_reparto`, y ese punto DEBE ser el que usen tanto el mensajero como la tienda.

**R9.** SI se pide el rescate de una orden que NO está en el estatus de ayuda, ENTONCES el sistema
NO DEBE cambiar su estado ni registrar ninguna transición.

**R10.** CUANDO una orden entra en el estatus de ayuda o sale de él, el sistema DEBE registrar la
transición por el mismo punto único de escritura que el resto de transiciones, con el usuario que la
provocó como actor y con una familia de origen propia por cada sentido, distinta de las existentes.

**R11.** El sistema NO DEBE contar las familias de origen de esta feature como visita real de
entrega, de modo que el número de intentos de entrega de una orden NO cambie por pedir ayuda ni por
rescatarla.

**R12.** El sistema DEBE declarar como legales exactamente las transiciones del estatus de ayuda que
tengan productor en el código, y NO DEBE declarar ninguna sin productor.

**R13.** Ninguna transición de esta feature DEBE alterar montos, emitir, modificar o suprimir
movimientos de dinero, ni convertir montos a número de coma flotante.

---

## B · El viaje que hoy falta: lo que la orden deja de alcanzar

**R14.** MIENTRAS una orden esté en el estatus de ayuda, el sistema NO DEBE ofrecerla como parada al
optimizador de ruta del mensajero.

**R15.** MIENTRAS una orden esté en el estatus de ayuda, el sistema NO DEBE pintarla como parada en
el mapa de ruta del mensajero ni contarla entre las paradas pendientes de optimizar.

**R16.** MIENTRAS una orden esté en el estatus de ayuda, el sistema NO DEBE permitir al mensajero
escogerla para gestión ni registrar sobre ella ninguna gestión.

**R17.** MIENTRAS una orden esté en el estatus de ayuda, el sistema NO DEBE ofrecerla para
asignación de mensajero, ruteo a bodega ni recolección.

**R18.** El sistema DEBE entregar al portal del mensajero las órdenes con ayuda **ya separadas desde
el servidor**, de modo que la separación NO dependa de ninguna decisión tomada en el cliente.

**R19.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE seguir mostrándola al
mensajero en su portal, en su apartado propio, con la acción de rescate disponible.

---

## C · El dinero y los indicadores del mensajero

**R20.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE seguir contándola en los
indicadores del día del mensajero: pendientes en camino, monto por cobrar y total a cobrar del día.

**R21.** El sistema DEBE mantener disjuntos los dos sumandos del total a cobrar del día, de modo que
el monto de una misma orden NO se sume dos veces en ningún estado.

---

## D · El bloqueo del cierre, explícito y no accidental

**R22.** MIENTRAS un mensajero tenga al menos una orden en el estatus de ayuda, el sistema NO DEBE
permitirle crear una solicitud de cierre, y DEBE decirle el motivo con un mensaje accionable.

**R23.** El sistema DEBE derivar ese bloqueo de una **lista explícita** de estados que cuentan como
pendientes de gestión, en la que el estatus de ayuda figure por su nombre.

**R24.** CUANDO un mensajero con un cierre `vencido` o `rechazado` pide cierre, el sistema DEBE
seguir transicionando ese cierre a `solicitado` **sin** aplicar la precondición de «sin pendientes»,
aunque tenga órdenes en el estatus de ayuda.

**R25.** MIENTRAS un mensajero esté bloqueado por un cierre sin resolver, el sistema DEBE seguir
permitiéndole solicitar ayuda y rescatar órdenes del estatus de ayuda.

---

## E · El corte de la noche

**R26.** CUANDO el corte diario cierra el día de un mensajero, el sistema DEBE transicionar a
`sin_gestionar` también las órdenes que estén en el estatus de ayuda, en la misma transacción en que
crea el cierre `vencido`.

**R27.** CUANDO el corte transiciona una orden a `sin_gestionar`, el sistema DEBE registrar como
estado de origen el estado **real** del que salía, y NO uno supuesto.

**R28.** CUANDO el corte transiciona una orden a `sin_gestionar`, el sistema NO DEBE alterar el
mensajero asignado, la prioridad ni ningún total del cierre.

**R29.** DESPUÉS del corte, el sistema NO DEBE conservar sobre esas órdenes ninguna señal de
solicitud de ayuda viva.

---

## F · La tienda y el hilo

**R30.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE listarla como novedad de su
tienda.

**R31.** CUANDO el sistema cuente las novedades de una tienda y CUANDO devuelva una página de ellas,
DEBE usar exactamente el mismo predicado.

**R32.** MIENTRAS una orden NO esté en el estatus de ayuda, el sistema NO DEBE listarla como novedad
por efecto de una solicitud de ayuda anterior.

**R33.** El sistema NO DEBE condicionar la visibilidad de una orden en `/novedades` a ninguna marca
persistida distinta del estado de la orden.

**R34.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE permitir escribir en su
hilo de notas **tanto al mensajero asignado como a la tienda dueña**.

**R35.** El sistema DEBE ofrecer a cada uno de esos dos roles al menos una superficie alcanzable,
desde su propia pantalla, para leer y escribir en el hilo de una orden en el estatus de ayuda.
> ⚠️ **ENMENDADO el 2026-08-19 — este texto ya NO se lee tal cual.** Ver
> **«RECONCILIACIÓN DE R35 TRAS LA REVISIÓN»** al final de este archivo: el original queda intacto
> a propósito (no se reescribe un documento firmado), pero lo que rige es la enmienda.

**R36.** El sistema NO DEBE hacer depender la ventana de escritura del hilo de ninguna marca
persistida distinta del estado de la orden.

---

## G · Las superficies que enumeran estados

**R37.** El sistema DEBE clasificar el estatus de ayuda de forma explícita en TODAS las superficies
que enumeran estados de orden: etiqueta y color visibles, hito del rastreo público, exclusiones del
filtro por rol, política de eventos públicos, listado de la bodega satélite y clasificación del
tablero del día.

**R38.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE mostrar al destinatario en
el rastreo público el mismo hito que muestra hoy mientras está en reparto, y NO DEBE añadirle
ninguna entrada nueva a su línea de tiempo por pedir ayuda ni por rescatarla.

**R39.** El sistema NO DEBE ampliar el vocabulario de estados que emite a los integradores externos
por causa de esta feature.

---

## H · La bandera, las migraciones y los datos en vuelo

**R40.** DESPUÉS de esta feature, ninguna decisión del sistema —visibilidad, ventana de escritura,
bloqueo, listado, ruta, KPI— DEBE depender de la marca booleana de ayuda.

**R41.** El sistema NO DEBE mover ninguna orden entre estados desde SQL de migración: toda
transición DEBE pasar por el punto único de escritura de estado.

**R42.** Toda migración de esta feature DEBE tener su reversión, y esa reversión DEBE dejar la base
en un estado que el código anterior pueda leer.

**R43.** CUANDO esta feature se despliegue, ninguna orden que tuviera una solicitud de ayuda viva
DEBE quedar invisible para su tienda ni bloqueada sin salida.

---

## I · Que el fallo no se pueda repetir

**R44.** El sistema DEBE romper la compilación si el catálogo de estados gana un valor que alguna de
las superficies exhaustivas no clasifique.

**R45.** DONDE una superficie que enumera estados NO rompa la compilación al ganar un valor nuevo,
el sistema DEBE tener una aserción que declare explícitamente la decisión tomada para el estatus de
ayuda **y su razón**, incluidos los casos negativos.

**R46.** Ningún registro producido por esta feature DEBE contener datos personales, números de guía,
identificadores de cliente ni secretos.

---

## Lo que YA funciona y NO se rehace

Medido en `progress/auditoria_ayuda_tienda.md` §4 («Cumplen: el botón de pedir ayuda; el rescate del
mensajero»). Se **reutiliza**, no se reescribe:

- El botón «Solicitar ayuda» del panel del mensajero y su modal con nota obligatoria.
- El rescate del mensajero («Recuperar») y su botón.
- `SolicitudAyudaService` con su puerta única heredada del hilo, y sus tests.
- La subida del motivo al hilo y el componente compartido del hilo (`HiloNotasOrden`).
- El contador de intentos de contacto de la tienda (`orden.intentos_contacto`): **no se toca**, es
  historial acumulativo de la tienda y no depende de la bandera.

## Fuera de alcance

- La **pestaña propia** de «Ayuda a gestionar» en `/novedades`, su card y la reposición de la
  lectura del hilo del lado tienda → **ficha 236**.
- La **gestión de la tienda que cuenta como del mensajero** (reprogramar/rechazar desde ayuda, con
  evidencia y motivo obligatorios) → **ficha 237**.
- La confirmación física por escaneo al aprobar el cierre → **ficha 238**.
- El rechazo manual de la tienda, la retirada de «Habilitar» de las cards de cierre y la guardia que
  impide reponer el botón «Notas» → **ficha 240**.
- Las guardas de bloqueo retiradas sin pedirlo en `6a0e6d36` → **ficha 241**.

---

## Preguntas abiertas

Las marcadas **[FIRMA]** cambian producto, contrato o dato persistido y **no se implementan sin
respuesta humana**. Cada una lleva recomendación y su razón.

**P1 · Nombre del estatus, su etiqueta visible y su color. [FIRMA]**
Recomendación: `value = ayuda_tienda` (el que fijó el diseño aprobado, §F1), etiqueta
**«Ayuda solicitada a la tienda»**, variante de badge `warning`. Razón: el `value` ya está escrito en
el diseño firmado y no conviene cambiarlo en el spec; la etiqueta dice **a quién se le pidió**, que
es lo que no se puede deducir de «Ayuda solicitada» a secas cuando maestro/admin la ven en `/ordenes`
junto a veinte estados más; `warning` es la variante que este repo da a los estados de **espera con
acción pendiente** (`por_devolver`, `sin_gestionar`, `devuelta`), que es exactamente lo que es.
Alternativa más corta: «Ayuda solicitada» (28 → 16 caracteres); se descarta por ambigua, pero la
longitud está dentro de lo que ya existe («Devolviendo a bodega central», 28).

**P2 · Nombres de las dos familias de origen del historial. [FIRMA ligera]**
Recomendación: `solicitud_ayuda_tienda` (ida) y `rescate_ayuda_tienda` (vuelta), los del diseño
aprobado. Es vocabulario interno del historial y no viaja a ninguna pantalla. Lo que **sí** es
requisito y no es opinable: ninguna de las dos entra en la lista de familias de visita real (R11).
**`gestion_tienda_ayuda`, el tercer valor que el diseño §F1 enumera, NO se declara aquí**: su
productor es la ficha 237 y la convención del repo es que un valor de enum nace en el commit de su
productor (precedente literal: `incidente` de la 154, declarado sin productor, «costó el tren
154+155+156»).

**P3 · Hito del rastreo público. [FIRMA]**
Recomendación: el **mismo que `en_reparto`**. Razón: para el destinatario no ha cambiado nada —el
paquete sigue con el mensajero— y quién resuelve la incidencia es asunto interno. Además el rastreo
**colapsa las rachas del mismo hito**, así que `en_reparto → ayuda → en_reparto` se ve como **una
sola** entrada «En reparto»: el destinatario no ve ningún trámite nuestro (R38). Precedente exacto:
`sin_gestionar → en_reparto`, riesgo aceptado y firmado en la 229 (G8).

**P4 · ¿El estatus es evento público de webhook? [FIRMA — toca contrato con integradores]**
Recomendación: **no**. El vocabulario público no gana un valor que ningún integrador sabe
interpretar. **Efecto colateral que hay que firmar a sabiendas, no descubrir después:** el rescate
`ayuda_tienda → en_reparto` **sí** emite un evento, porque `en_reparto` ya está en la política. Es
decir, **un integrador puede recibir `en_reparto` dos veces sobre la misma orden**. No es un fallo
nuevo: la clave de idempotencia del emisor lleva el instante **precisamente para admitir el reingreso
a un mismo estado** (patrón de la feature 47), y hoy ya ocurre con `reprogramada` liberada. Si el
humano prefiere evitarlo, la única alternativa limpia es no emitir en el rescate, y eso exige una
excepción por familia de origen que hoy no existe: es más código y más regla nueva que el problema.

**P5 · ¿Se retira la columna `ayuda` en ESTA ficha? [FIRMA]**
Recomendación: **sí, y en esta misma tanda.** Razones, en orden de peso: (i) la 239 dejó **deuda con
dueño escrita en su spec y en el código** —el tapón de `novedadWhere` y la reconciliación de su R19—
y dice literalmente «las dos mueren con la ficha 235»; (ii) mantener las dos verdades a la vez es
exactamente el fallo que esta ficha viene a cerrar: una marca persistida y un estado que pueden
divergir; (iii) los **dos apagadores** de hoy (`desmarcarAyuda` de «Recuperar» y `habilitarNovedad`
de «Habilitar») colapsan en **un solo punto de escritura** (R8), que es lo que el diseño §F1 pide.
Lo que **no** se retira: `orden.intentos_contacto`, que es historial de la tienda y no depende de la
marca.

**P6 · Las órdenes con la bandera encendida el día del despliegue. [FIRMA]**
Recomendación: **medir primero, y decidir con el número delante.** Dato de contexto: `prod`
(448d5169) **no lleva el merge #396**, así que es probable que en producción la columna ni exista y
el conjunto sea **vacío**; eso hay que **comprobarlo, no suponerlo**. Con la medición:
- **Si el conjunto es vacío** → *grandfather*: se retira la columna y no hace falta nada más.
- **Si no lo es** → un **script de una sola vez** (no una migración) que transicione por el **choke
  point** las órdenes con `ayuda = true` que sigan en `en_reparto`, y que se limite a olvidar la
  marca en las que ya salieron de reparto (ésas son la fuga de la auditoría §2.1: el tapón de la 239
  ya las tiene fuera de `/novedades`). Mover estado desde SQL está **prohibido** (R41).

**P7 · ¿Los indicadores del día del mensajero siguen contando las órdenes en ayuda? [FIRMA]**
Recomendación: **sí** (R20). Razón: el paquete sigue en la moto y su COD sigue por cobrar. Si al
pedir ayuda el «Total a cobrar» del mensajero **bajara**, el número dejaría de describir su jornada y
premiaría pedir ayuda. Es una decisión que hay que tomar explícitamente porque, al sacar la orden del
grupo «en reparto», el comportamiento **por defecto** de la implementación sería el contrario: hoy
esos KPI se derivan de ese grupo, y las órdenes en ayuda están dentro por ser `en_reparto`.

**P8 · ¿El chat del mensajero conserva a esos clientes como contacto?**
Recomendación: **sí.** Hoy el chat recibe el grupo «en reparto» entero, así que una orden con ayuda
está en la lista de contactos. Al sacarla del grupo, la pierde **en silencio** y el mensajero se
queda sin poder escribirle al cliente de un paquete que sigue llevando encima — y ese botón es la
**única entrada al chat** que queda en la app. Nadie pidió quitarlo. Contrapartida si el humano
prefiere lo contrario: la lista de contactos deja de coincidir con la lista de cards.

**P9 · ¿Quién puede pedir ayuda? [FIRMA]**
Recomendación: **solo el `mensajero` asignado.** Hoy `SolicitudAyudaService` **no comprueba el rol a
propósito** y su comentario lo justifica: «que la tienda encienda su propia bandera es inofensivo».
**Con un estatus deja de serlo**: encender la marca era cosmético, mover la orden a un estado la saca
de la ruta, del mapa y de la gestión del mensajero. La razón escrita para no duplicar la regla sigue
valiendo (no se quiere una segunda tabla de permisos), así que la vía recomendada es **estrechar la
ventana de solicitud, no añadir un `if` suelto**. Si el humano quiere que la tienda también pueda
pedir ayuda, hay que decidir además qué significa que la tienda saque una orden de la ruta.

**P10 · ¿«Habilitar» de la tienda queda como rescate en esta ficha, o espera a la 236/240?**
Recomendación: **el punto de escritura del rescate se entrega en esta ficha (R8) y «Habilitar» pasa a
llamarlo**, sin tocar dónde ni cuándo se pinta el botón — eso es de la 236 (la card) y de la 240 (que
lo retira de las cards que vienen de un cierre). Razón: si el rescate queda a medias, una orden
puede entrar en el estatus de ayuda y **solo el mensajero** podría sacarla; la tienda vería la fila
sin ninguna palanca. **Pendiente de confirmar** el orden de mergeo 235 → 236 → 240.

---

## PUERTA HUMANA PASADA — 2026-08-19

**P6 queda resuelta por MEDICIÓN, no por firma.** Medido contra producción el 2026-08-19 (MCP, solo
lectura): la columna `ayuda` **existe** —`prod` ya llevaba el merge #396— pero hay **0 órdenes con la
bandera encendida**, ni en reparto ni fuera. Autocomprobado con 141 órdenes vivas. Luego:
**grandfather sin script**. Se retira la columna y no hay nada que transicionar. Vuelve a medirse en
T0 antes de desplegar: es una foto.

### Firmadas con la recomendación del spec

- **P9** — solo el **mensajero asignado** puede pedir ayuda, estrechando la ventana de solicitud y
  sin añadir una segunda tabla de permisos.
- **P7** — los indicadores del día del mensajero **siguen contando** las órdenes en ayuda (R20). El
  paquete sigue en la moto.
- **P5** — la columna `ayuda` **se retira en esta ficha**, y con ella mueren las dos deudas que la
  239 dejó con dueño: el tapón de `novedadWhere` y su R19 reconciliado.
- **P1, P2, P3, P8, P10** — con la recomendación, por el leader: bajo riesgo y razonadas en su
  sitio. `ayuda_tienda` / «Ayuda solicitada a la tienda» / badge `warning`; las dos familias de
  origen del historial sin `gestion_tienda_ayuda` (nace con su productor, la 237); hito del rastreo
  público **igual que `en_reparto`**; el chat conserva a esos clientes; y el punto de escritura del
  rescate se entrega aquí, mientras que dónde se pinta «Habilitar» es de la 236/240.

### P4 — FIRMADA EN CONTRA DE LA RECOMENDACIÓN

El humano **no acepta** que un integrador reciba `en_reparto` dos veces sobre la misma orden. Por lo
tanto: **el rescate `ayuda_tienda → en_reparto` NO emite evento de webhook.**

**Lo que se gana:** el ciclo de ayuda entero queda **invisible desde fuera**. Ni la ida ni la vuelta
se emiten, así que ningún integrador ve un trámite interno, y no hay repetición que explicar.

**Lo que cuesta, dicho aquí y no descubierto después:** hoy la política de emisión es **por estado
destino**, y esto obliga a una **excepción por familia de origen** que no existe. Es código nuevo en
el emisor y una regla nueva en un sitio delicado. Requisitos que hay que escribir con ella:

1. La excepción se aplica **solo** a la familia del rescate, nunca al estado `en_reparto` en general
   — si se implementa por estado, se silencian los reingresos legítimos (una reprogramada liberada
   deja de avisar, y eso sí es una regresión).
2. Debe existir un test que **falle** si alguien amplía la excepción a otra familia.
3. `emitirBestEffort` y el resto del emisor no cambian de contrato: la excepción vive en la decisión
   de emitir, no en el emisor.

**Si esta excepción resulta más frágil de lo previsto al implementarla, se vuelve a P4** — no se
inventa una tercera vía.


---

## RECONCILIACIÓN DE R35 TRAS LA REVISIÓN — 2026-08-19

La revisión encontró que **R35 solo está cumplido para un rol**, y tiene razón: el mensajero tiene
su superficie de lectura del hilo (`HiloNotasAyudaModal`), pero el `adminTienda` **no tiene ninguna**
desde que el trabajo del 2026-08-18 retiró el botón «Notas» de `/novedades`.

**La contradicción era del propio spec**, no de la implementación: R35 se redactó como si cubriera
los dos roles, mientras su sección de alcance difiere la pantalla de la tienda a la ficha **236**.
Se reconcilia el texto en vez de dejarlo prometiendo algo que esta ficha no entrega — un requisito
que miente es peor que uno ausente.

**R35 se lee, desde hoy, como:** «el rol que tiene ventana de escritura sobre el estatus de ayuda
debe tener **dónde ejercerla**; para el **mensajero** eso se entrega en esta ficha, y para el
**`adminTienda`** es la pestaña de la ficha 236, que monta la card y su hilo».

### Lo que esto significa mientras la 236 no entre

**La tienda ve que hay una solicitud de ayuda y no puede leer el motivo.** Es exactamente el defecto
que la auditoría dejó anotado en su §4 («la nota se escribe y NADIE la lee»), y **esta ficha no lo
empeora**: hoy, antes de ella, tampoco se leía. Pero tampoco lo arregla, y conviene no dar por
cerrado lo que sigue abierto.

**Dueño y fecha de muerte: ficha 236**, que es la inmediatamente siguiente de la pila. Si la 236 se
retrasara, esto pasa a ser deuda visible en producción y hay que reabrir la decisión.

> ✅ **CERRADA el 2026-08-19 — la 236 entregó la superficie que faltaba.** La tienda **lee el motivo**
> desde la card de su pestaña propia («Ayuda solicitada»), y **escribe sin rescatar la orden**, que es
> lo que R34 ya le permitía y no tenía dónde ejercer. Visto en pantalla, no deducido:
> `progress/recorrido_236.md` §3 y §4.
>
> Con esto **R35 se lee otra vez tal como se redactó**: los dos roles tienen superficie alcanzable.
> La enmienda deja de ser deuda viva y queda como lo que fue — el acta de por qué la ficha 235 no
> podía cumplirlo sola.

