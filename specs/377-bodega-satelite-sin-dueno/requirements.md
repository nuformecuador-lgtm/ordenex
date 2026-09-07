# Ficha 377 — una orden en bodega satélite puede quedarse sin dueño al cambiar de zona

**Zona:** fullstack. **SDD:** sí. **Rama:** `fix/377-bodega-satelite-sin-dueno`.

## La premisa del área (no es un supuesto de esta ficha: está escrita en el árbol)

En este modelo **no existe una entidad «bodega»: la bodega satélite ES la zona**. Lo declara y lo
justifica `lib/utils/estados-bodega-satelite.ts` (líneas 39-59): `CierreBodega` se ancla en `zona_id`,
el alcance del `adminSatelite` es su `usuario.zona_id`, y **todo** productor de
`en_ruta_bodega_satelite` / `en_bodega_satelite` deriva la bodega de destino de `orden.zona_id`.

Consecuencia directa, y es el corazón del defecto: **cambiar la zona de una orden ES cambiarla de
bodega, en los datos, mientras el paquete físico no se mueve.**

## Problema (diagnosticado y verificado en el árbol el 2026-09-07 — no se re-investiga)

1. La reconciliación que introdujo la ficha 366 (`lib/repositories/ZonaRepository.ts`, el `WHERE` de
   elegibilidad en las líneas 291-305) **no filtra por estado**. Sus únicos cortes son
   `deletedAt: null`, `cierreDetalles: { none: {} }` y `gestiones: { none: { anuladaAt: null,
   resultado: { in: ["entregada","rechazada","incidente"] } } }`.
2. Una orden en `en_bodega_satelite` de la zona A cuya zona pase a B:
   - **desaparece del listado de A** — `lib/repositories/OrdenRepository.ts:1158`
     (`condicionesSatelite`: `o."zona_id" = ${filtro.zonaId}`);
   - **A no puede asignarla** — `lib/services/AsignacionSateliteService.ts:206` y `:343` la rechazan
     con motivo `zona_ajena`;
   - **B la ve** en su listado (la evidencia de custodia vive en `orden_historial_estado`, que es
     append-only) **pero no tiene el paquete**.
3. **Y no hay salida.** Desde `en_bodega_satelite`, `lib/types/order-status-transiciones.ts:170-181`
   declara exactamente tres aristas: `por_recoger` (vía `asignacion_satelite`, rol `adminSatelite`
   **de la zona**), `en_reparto` (vía `deshacer_gestion`, rol mensajero) e `incidente`. **No existe
   arista de vuelta a la central ni a otra satélite**, y ni maestro ni admin pueden mover el paquete.
4. Efecto colateral en el deshacer: `lib/services/DeshacerAsignacionService.ts:170` autoriza por
   `orden.zonaId !== zonaActor`, así que tras un cambio de zona quien tiene el paquete deja de poder
   deshacer — aunque el destino sí se derive bien (`:214`, desde el historial, «jamás desde la zona»).

**Medido en producción el 2026-09-07:** 47 órdenes en `en_bodega_satelite` (39 en FGAM Zona Sur, 8 en
FGAM San Ramón) y 215 en `en_ruta_bodega_satelite` repartidas en 6 zonas. **Deriva de zona actual: 0**
— la 366 está aguantando. Esto es **exposición latente, no un incendio**.

## Lo que esta ficha NO puede romper

El `design.md` §8 de la 366 declara como **correcto y buscado** que una orden
`en_ruta_bodega_satelite` se reconcilie: ése era el atasco medido (41 de 42 órdenes represadas el
2026-09-03), porque `OrdenRepository.recibirEnSatelite` (línea 3695) acota su guarda por `zonaId`
(`where: { id, zonaId, deletedAt: null, estatus: { value: "en_ruta_bodega_satelite" } }`) y la bodega
correcta no podía recibir el paquete.

La distinción que esta ficha hace explícita, y que el repo ya declara por su cuenta en
`lib/types/order-status-transiciones.ts:158-160` («el paquete sigue bajo custodia de la central, por
eso el destino es la central»):

| Situación | Estado | Quién tiene el paquete | Reconciliar es… |
| --- | --- | --- | --- |
| **En tránsito** | `en_ruta_bodega_satelite` | la central (aún no lo entregó) | **correcto**, y ya funciona |
| **En el estante** | `en_bodega_satelite` | la bodega satélite que lo recibió | **lo deja sin dueño y sin salida** |

## Requisitos (EARS)

### El invariante que se restituye

**R1** — CUANDO se guarde la edición de una zona, el sistema DEBE garantizar que ninguna orden cuyo
paquete ya esté recibido en el estante de una bodega satélite deje de aparecer en el listado de esa
bodega, ni deje de poder ser asignada a un mensajero por el administrador de esa misma bodega.

**R2** — MIENTRAS una orden esté en el estado `en_bodega_satelite`, el sistema NO DEBE cambiar su
zona como efecto de la re-derivación automática que dispara el guardado de una zona.

**R3** — MIENTRAS una orden esté en el estado `en_ruta_bodega_satelite`, el sistema DEBE re-derivar
su zona en el guardado de una zona con exactamente el mismo comportamiento que tenía antes de esta
ficha.

**R4** — El sistema DEBE evaluar R2 por el estado que la orden tiene EN EL INSTANTE del guardado, y
NO DEBE excluir a una orden de la re-derivación por haber estado en `en_bodega_satelite` en algún
momento anterior.

**R5** — El sistema DEBE conservar sin cambios los tres cortes de elegibilidad ya vigentes —orden no
eliminada, sin ningún detalle congelado en un cierre, y sin ninguna gestión vigente cuyo resultado sea
`entregada`, `rechazada` o `incidente`—: la exclusión de R2 se SUMA a ellos y no relaja ninguno.

**R6** — SI una orden queda excluida de la re-derivación por R2, ENTONCES el sistema DEBE dejar todos
sus campos intactos y NO DEBE registrar ninguna fila de historial de acciones por ella.

### El conteo que se informa a quien guarda la zona

**R7** — CUANDO el guardado de una zona termine con éxito, el sistema DEBE seguir informando cuántas
órdenes cambiaron de zona por la re-derivación, y ese número NO DEBE incluir ninguna orden excluida
por R2.

**R8** — CUANDO el guardado de una zona deje al menos una orden excluida por R2, el sistema DEBE
informar, en la misma respuesta del guardado, cuántas órdenes quedaron con su zona anterior por esa
causa.

**R9** — El sistema DEBE contar en R8 exactamente las órdenes que habrían cambiado de zona de no
existir R2 —las que superan todos los demás cortes de elegibilidad y cuyo distrito resuelve una zona
distinta de la que tienen estampada— y NO DEBE contar ninguna otra: ni las que ya están en la zona
correcta, ni las descartadas por otro corte, ni las de un distrito que resuelve cero o más de una zona.

**R10** — SI ninguna orden queda excluida por R2 en ese guardado, ENTONCES el número informado en R8
DEBE ser cero y el mensaje de guardado NO DEBE mencionar órdenes retenidas.

**R11** — El sistema NO DEBE bloquear el guardado de la zona, ni exigir una confirmación adicional,
ni retrasarlo, por el hecho de que existan órdenes excluidas por R2.

### Estabilidad y alcance de la acción

**R12** — El sistema DEBE ser estable ante repeticiones: repetir el mismo guardado de zona DEBE
informar cero órdenes reconciliadas, el MISMO número de órdenes retenidas que el guardado anterior, y
NO DEBE registrar ninguna fila de historial nueva.

**R13** — El sistema NO DEBE aplicar ni la exclusión de R2 ni el conteo de R8 al CREAR una zona
nueva: crear una zona sigue sin reconciliar y sin retener ninguna orden.

**R14** — El sistema NO DEBE añadir, retirar ni modificar ninguna transición de estado del catálogo:
el conjunto de salidas declaradas de `en_bodega_satelite` DEBE quedar exactamente igual que antes de
esta ficha.

## Preguntas abiertas (decisión humana — no las resuelve el spec_author)

**Q1 — ¿El paquete tiene que MOVERSE físicamente cuando su distrito cambia de zona?**
Es la pregunta de negocio de la que cuelga todo lo demás. Dos respuestas posibles, con consecuencias
opuestas:

- **«No, quien lo tiene lo despacha»** → esta ficha, tal como está escrita, es la respuesta completa:
  la orden se queda con la zona vieja mientras está en el estante, la despacha la bodega que la
  recibió y su cierre congela esa zona, que es lo que ocurrió de verdad. La deuda es que esa orden se
  factura con la tarifa de la zona vieja, exactamente la misma clase de deriva residual que la 366 ya
  declaró como riesgo aceptado en su `design.md` §8.
- **«Sí, el paquete tiene que llegar a la bodega nueva»** → hace falta además una transición de
  traspaso entre bodegas (salida (b) del `design.md` §2) y un flujo operativo para moverlo. Es una
  ficha aparte y más grande: hoy no existe ninguna arista desde `en_bodega_satelite` hacia la central
  ni hacia otra satélite, y la autorización de todo el área satélite se apoya en `orden.zonaId`, que
  es precisamente lo que deja de coincidir con quien tiene el paquete.

**Q2 — ¿Se informa el conteo de órdenes retenidas (R8-R10), o el guardado sigue callado?**
La 366 cerró su `Q2` con un **NO** a añadir «un segundo conteo de deuda residual» a la respuesta del
guardado. R8-R10 lo reabren, pero para un caso distinto y más estrecho: no es deriva contable, son
paquetes físicos de los que alguien tiene que responder. Si la respuesta es **NO**, caen R8, R9, R10 y
R11 (y con ellos T4, T6 y T7 de `tasks.md`); **R1-R7 y R12-R14 se sostienen solos** y la ficha sigue
siendo un arreglo completo del defecto evidenciado, solo que silencioso.

**Q3 — ¿La misma exclusión aplica a la corrección manual de ubicación?**
`CorregirDatosClienteService` es la **segunda puerta al mismo agujero**: `en_bodega_satelite` NO está
en `ESTADOS_SIN_CORRECCION` (`lib/types/correccion-datos-cliente.ts:92-95`), así que un maestro o un
admin puede cambiar el distrito de una orden que está en el estante y el servicio re-deriva la zona
(`CorregirDatosClienteService`, paso 6: `data.zonaId = distrito.zonaId`), con el mismo resultado:
huérfana. La diferencia es que ahí **sí hay un humano mirando** una confirmación (el gate del dinero,
`confirmacion_requerida`), aunque ese aviso hoy habla de importes y no dice nada de la bodega. Tres
salidas: (i) no tocarlo, (ii) añadir la bodega al aviso que ya se muestra, (iii) prohibir la
corrección en ese estado. Las tres son decisión de quien opera, no del spec. **Fuera del alcance de
esta ficha salvo que se decida lo contrario.**

**Q4 — ¿Entra el colateral de `por_recoger` en esta ficha o es ficha aparte?**
Una orden asignada desde la bodega satélite A (`por_recoger`) también es elegible para la
reconciliación —no tiene cierre ni gestión— y su paquete también está físicamente en el estante de A
hasta que el mensajero lo recoge. Tras un cambio de zona, A pierde el deshacer
(`DeshacerAsignacionService.ts:170`, `forbidden` del lote completo). El daño es **estrictamente
menor** que el de `en_bodega_satelite`: el mensajero asignado sí puede seguir recogiendo y entregando,
así que la orden no queda atascada. Pero el estado `por_recoger` **no dice por sí solo desde qué
bodega se asignó** (también se llega a él desde `en_bodega_central` vía `asignacion_bodega`), así que
cubrirlo exige mirar el historial de custodia, no el estado — más superficie de la que este arreglo
mínimo toca. Decisión: (i) fuera, ficha propia; (ii) dentro, ampliando el corte con la evidencia de
custodia; (iii) dentro, pero arreglando la autorización del deshacer en vez del corte.
