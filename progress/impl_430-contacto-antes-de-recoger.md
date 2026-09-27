# Ficha 430 — SF-001 punto 3: contactar al cliente antes de recoger

Rama `feat/430-contacto-antes-de-recoger`, desde `c565a34a`. Diseño de partida:
`progress/design_sf001_p3_contacto_dia_anterior.md`.

## Lo que se verificó en el código antes de escribir nada

Las dos afirmaciones del diseño se leyeron en el archivo real, no en el grafo:

| Afirmación | Dónde | Veredicto |
| --- | --- | --- |
| El chat autoriza por propiedad de la orden y nada más | `lib/repositories/OrdenEnvioReader.ts:27` — `where: { id, deletedAt: null, mensajeroAsignadoId }` | **Cierta.** Ni fecha ni estatus. Y las **cinco** acciones del chat (`enviarMensajeChat`, `enviarMediaChat`, `enviarPlantillaChat`, `listarHiloChat`, `marcarChatLeido`) pasan por ahí |
| Contactar no puede llevar a un cierre vencido | `lib/repositories/CierreDiaRepository.ts:811-849` | **Cierta, dos veces.** El barrido sólo recorre `[enRepartoEstatusId, ayudaEstatusId]`, y de esos excluye `noReservadaParaDespues`. Una `por_recoger` no entra jamás |

**Conclusión: no había ninguna puerta de permisos que abrir, y no se abrió ninguna.** El cambio es
100% de composición de cliente. Cero archivos de `lib/services/`, `lib/repositories/`,
`lib/actions/`, `db/` o `app/api/` tocados.

## Punto 1 — la decisión: las DOS pantallas, con UNA sola lista

La ficha ofrecía elegir entre sumarlas a `contactosChat` en Reparto **o** montar el chat en «Por
recoger». **Se hicieron las dos, y la lista de contactos es la MISMA en las dos.** Tres razones,
en orden de peso:

1. **Sólo en Reparto habría abierto el chat donde nadie lo iba a buscar.** El dato medido en
   producción dice que las asignaciones anticipadas ocurren entre las 14:43 y las 22:55, promedio
   20:00. A esa hora el mensajero tiene **cero** órdenes en Reparto —esa pantalla es, por
   definición, la de los paquetes que ya lleva encima, y así lo dice su propio documento de
   ayuda—. Sus paquetes nuevos están en «Por recoger». El caso de uso que motiva la ficha
   ocurre exactamente en la pantalla que no tenía chat.
2. **Dos listas distintas habrían roto el distintivo de sin leer, en silencio.** `ChatFlotante`
   filtra el resumen del servidor contra los contactos que la pantalla lista
   (`if (!enChat.has(c.ordenId)) continue`). Con listas distintas, cada pantalla habría escondido
   los pendientes de la otra sin ningún error visible — la familia de fallos que este repo tiene
   medida. Una lista, un número, dos montajes.
3. **La lista de contactos ya no coincidía con las cards desde la 235**, que metió ahí las de
   `ayuda_tienda` a sabiendas («contrapartida aceptada»). Añadir las `por_recoger` ensancha esa
   misma decisión, no estrena una.

**Y no parecen trabajables:** la fila del chat no monta ninguna acción de la card (ni «Gestionar»
ni «Gestionar más tarde»), su chip dice **«Por recoger»** y no «En reparto», y cae en un grupo
propio —«Para recoger hoy» / «Para otro día»—, los mismos dos rótulos de las pestañas de la 277,
importados y no reescritos.

## Punto 3 — cómo se distingue la de otro día

Dos señales, las dos con palabras y ninguna sólo con color:

- **`Badge variant="info"` con «Para mañana»**, el mismo componente y el mismo literal
  (`ETIQUETA_PARA_MANANA`) que ya usan las tres cards del portal.
- **La frase con SU FECHA**, de la fuente única `avisoReservaParaOtroDia` (261/R15): *«Esta orden
  es para el reparto del 16 de septiembre. Ese día podrás recogerla y gestionarla.»* Es la misma
  frase que devuelve el servidor al rechazar, así que la pantalla no puede prometer lo que el
  servidor va a negar.

Van en la **fila** de la lista y en el **encabezado de la conversación abierta**, que es donde el
mensajero está escribiendo cuando el cliente le pide que se la lleve hoy.

Cuelgan de `orden.esParaManana` y **no del grupo**, a propósito: una orden ya recogida puede quedar
marcada para un día posterior (pasó en producción el 2026-08-21), y así la marca no se le cae por
estar en «En reparto».

## Punto 2 — el detalle completo

`ChatConversacion` gana una revelación («Ver detalle», `aria-expanded` + `aria-controls`) que monta
el **mismo** `AsignacionDetalle` (Pedido / Entrega / Cobro) del panel de gestión. Antes bastaba con
salir a la card de Reparto; con una orden por recoger su card vive en otra pantalla. Arranca
plegado: lo que se abre es un chat.

## La red de la 261 — intacta

Los seis archivos siguen byte a byte como en `c565a34a` (`git diff --stat c565a34a` vacío en los
seis):

`tests/unit/services/mis-asignaciones-reserva-bloquea.test.ts` ·
`tests/integration/db/recoger-lote-dia-reserva.int.test.ts` ·
`tests/integration/db/deshacer-gestion-conserva-reserva.int.test.ts` ·
`tests/unit/services/gestion-desde-ayuda-reserva.test.ts` ·
`tests/integration/db/gestion-desde-ayuda-dia-reserva.int.test.ts` ·
`tests/unit/guards/d5-revertida.guardia.test.ts`

## Mutaciones aplicadas (las tres murieron)

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | `{orden.esParaManana ? (` → `{true ? (` en las dos marcas de la fila: **la de otro día deja de distinguirse de la de hoy** | **ROJO, 2 tests.** `expect(element).not.toHaveTextContent("Para mañana")` sobre la fila de Carlos (la de hoy) |
| 1b | Lo mismo con `{false ? (`: la marca **desaparece** | **ROJO, 3 tests.** `expect(element).toHaveTextContent()` — la fila de Diana ya no dice ni «Para mañana» ni su fecha |
| 2 | `todas: [...conElPaquete]` — las asignadas sin recoger se caen de los contactos | **ROJO, 6 tests** en los dos archivos: `expected [ 'a' ] to include 'c'`, `expected [ 'a', 'b' ] to deeply equal [ 'a', 'b', 'c', 'd' ]`, y cuatro de UI («3 asignadas», la nota, el detalle) |
| 3 | `porRecoger={result.porRecoger}` → `porRecoger={[]}` en `reparto/page.tsx` | **ROJO, 1 test.** El composition root: `expected 'import { notFound }…' to match /porRecoger=\{result\.porRecoger\}/` |

La 3 existe porque el typecheck garantiza que la prop se pasa, no que se pase la lista de verdad:
un `[]` quemado sería un fallo mudo.
