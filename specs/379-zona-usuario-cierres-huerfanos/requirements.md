# Ficha 379 — cambiar la zona de un usuario puede dejar dinero sin consolidar

**Zona:** fullstack. **SDD:** sí. **Rama:** `fix/379-zona-usuario-cierres-huerfanos`.
**Migración:** NO (justificado en `design.md` §6).

---

## La premisa del área (no es un supuesto de esta ficha: está medida y escrita en el árbol)

Las dos mitades del alcance **divergen a propósito**:

- **Las órdenes** pertenecen a la bodega por `orden.zona_id` — **mutable**, se re-estampa.
- **El dinero** pertenece a la bodega por `usuario.zona_id` del mensajero **congelado** en
  `cierre_dia.destino_zona_id` — un *snapshot* que ya no se mueve.

De ahí sale el defecto, y es aritmética del `WHERE`, no una opinión: un `cierre_dia` con
`estado = aprobado`, `destino_tipo = bodega_satelite`, `destino_zona_id = Z` y
`cierre_bodega_id IS NULL` **solo lo puede consolidar un `adminSatelite` cuya zona VIVA sea Z**.
Ni el maestro ni el admin pueden.

Verificado en el árbol el 2026-09-08 (líneas confirmadas archivo a archivo, no por el índice):

| Hecho | Dónde vive hoy |
| --- | --- |
| El `WHERE` del dinero atrapado | `lib/repositories/CierreBodegaRepository.ts:147` (`consolidablesWhere`) |
| Único productor de `crearCierreBodega` | `lib/services/CierreBodegaService.ts:418` (`solicitarCierreBodega`), tras `if (actor.rol !== ROL_AUTORIZADO)` con `ROL_AUTORIZADO = "adminSatelite"` (`:21`) |
| Las 6 puertas del módulo de consolidación | `CierreBodegaService.ts:149, 248, 299, 357, 402, 419` — las seis con el mismo guard |
| La zona del actor sale del usuario, nunca de la petición | `CierreBodegaService.ts:152/404/422` (`findUsuarioZonaId`) |
| Una cuenta no `activo` no entra | `lib/services/AuthService.ts:93` (`if (usuario.estado !== "activo") → account_unavailable`) |

## El agujero tiene TRES puertas (medidas con un test desechable, no razonadas)

- **D1** — `UsuarioService.actualizar({ zonaId })` sobre un `adminSatelite` **no encuentra ninguna
  resistencia**: `resolverZona` (`lib/services/UsuarioService.ts:448-473`) solo comprueba que la zona
  **exista**.
- **D2** — cambiar el **rol** desde el formulario **omite `zonaId`**
  (`app/(app)/configuracion/_components/UsuarioForm.tsx:235`, el spread condicional
  `...(esRolConZona ? { zonaId } : {})`), así que la fila **conserva su zona con un rol que ya no
  puede consolidar**. Y doce líneas más abajo, en el MISMO método, `vehiculoId` **sí** se recalcula
  cuando cambia el rol: `UsuarioService.ts:271` mira `input.vehiculoId !== undefined || input.rolId
  !== undefined`; la zona, en `:259`, solo mira `input.zonaId !== undefined`. **Dos campos hermanos,
  dos reglas.** Contradice el invariante que el propio `resolverZona` documenta («R27: para otros
  roles se fuerza null»), que en `crear` (`:98-101`) **sí** se cumple y en `actualizar` **no**.
- **D3** — inactivar al último `adminSatelite` deja el dinero **igual de inalcanzable**: la cuenta
  existe y conserva su zona, pero `AuthService.ts:93` no la deja entrar.

## Medido en producción el 2026-09-08 — **es una foto, no un invariante**

- **D2 ya ocurrió: 0 filas.** Teórica pero abierta.
- **Dinero aprobado sin consolidar: 0.** Latente, no vivo.
- **⭑ Zonas satélite con UN SOLO `adminSatelite` activo: 5 de 7** — San Carlos, Puntarenas, Limón,
  San Ramón y El Coco. Solo Zona Sur y Guanacaste tienen dos. **Ése es el número que justifica la
  ficha: cinco puntos únicos de fallo con nombre propio.**

> Un cero de hoy no dice nada de mañana: producción se vació a propósito el 2026-08-25 (arranque
> comercial). «0 cierres sin consolidar» significa «aún no ha pasado», no «no puede pasar».

## ⛔ La decisión del humano del 2026-09-08, que NO se reabre

Sus palabras: **«no, no quiero daños»**. **NADA puede bloquear al maestro.** La guarda dura que el
implementador había encontrado queda **derogada**. Si un requisito de aquí abajo acaba impidiéndole
algo al maestro, el requisito está mal escrito — ver **R14**, que existe para que eso sea un test
rojo y no una discusión.

## Las dos cosas que hace esta ficha, y son distintas

- **BLOQUE A — D2: higiene del dato.** `actualizar` fuerza la zona a «sin zona» cuando el rol deja
  de llevarla, exactamente como ya hace `crear` y como ya hace `vehiculoId` en el mismo método.
  **No es una restricción: es quitar dato sucio.** Puede aterrizar **solo**.
- **BLOQUE B — D1 + D3: de bloqueo a AVISO.** Antes de aplicar el cambio se dice el número. El
  maestro sigue pudiendo hacerlo; lo que cambia es que lo sabe. **D3 va aquí dentro y no aparte**:
  cerrar «cambiar el rol» y no «desactivar la cuenta» cierra una de las dos puertas al mismo
  agujero, y eso ya costó una ficha hoy (377/Q3). Además el mecanismo es el mismo aviso.

---

# Requisitos (EARS)

## Bloque A — la zona sigue al rol (D2)

**R1** — CUANDO el maestro guarde la edición de un usuario y el rol resultante sea uno que no lleva
zona, el sistema DEBE dejar a ese usuario **sin zona**, aunque la petición no incluya el campo de
zona.

**R2** — CUANDO el maestro guarde la edición de un usuario y el rol resultante sea uno que sí lleva
zona, SI la petición no incluye el campo de zona, ENTONCES el sistema DEBE **conservar la zona que
el usuario ya tenía**.

**R3** — SI el rol resultante de una edición exige zona y el usuario no tiene ninguna ni la petición
aporta una, ENTONCES el sistema DEBE rechazar la edición con un error de validación **sobre el campo
de zona** y NO DEBE escribir ningún cambio.

**R4** — El sistema DEBE resolver la zona efectiva de una edición con **exactamente la misma regla**
con la que la resuelve en el alta: para el mismo par (rol resultante, zona pedida), alta y edición
DEBEN producir el mismo valor de zona.

**R5** — CUANDO una edición cambie de verdad la zona de un usuario —incluido dejarlo sin zona por
efecto del cambio de rol—, el sistema DEBE registrar en el historial de acciones una entrada de
cambio de zona con **la zona anterior** y la nueva, en el **mismo lote** que el cambio de rol.

**R6** — CUANDO una edición no cambie ni el rol ni la zona, el sistema NO DEBE registrar ninguna
entrada de historial de zona.

**R7** — MIENTRAS la petición de edición no incluya el campo de rol, el sistema DEBE tratar el campo
de zona **exactamente como antes de esta ficha**.

**R8** — El sistema NO DEBE modificar el comportamiento del alta de usuarios ni el de ningún otro
campo editable (nombre, teléfono, tipo de documento, fulfillment, vehículo) como efecto de R1-R7.

## Bloque B — el aviso (D1 + D3)

**R9** — CUANDO el maestro pida cambiar el **rol**, la **zona** o el **estado** de un usuario, el
sistema DEBE evaluar, **antes de aplicar nada**, si ese cambio deja a alguna zona satélite sin
ningún administrador de bodega activo.

**R10** — SI el usuario afectado es hoy administrador de bodega **activo** de una zona, y el cambio
pedido lo deja de serlo en esa zona, y **no queda ningún otro** administrador de bodega activo en
ella, ENTONCES el sistema DEBE mostrar al maestro un aviso —antes de aplicar el cambio— que nombre
**la zona**, diga **cuántos cierres aprobados** siguen sin consolidar en ella y **por qué importe**,
y advierta de que **solo un administrador de bodega de esa zona puede consolidarlos**.

**R11** — MIENTRAS ese aviso esté en pantalla, el sistema NO DEBE haber aplicado ningún cambio sobre
el usuario.

**R12** — CUANDO el maestro confirme el aviso, el sistema DEBE aplicar el cambio pedido **con el
mismo resultado que tendría si el aviso no existiera**.

**R13** — CUANDO el maestro descarte el aviso (cancelar, Escape o clic fuera), el sistema NO DEBE
aplicar el cambio y NO DEBE dejar ningún rastro de él.

**R14** — El sistema NUNCA DEBE impedir al maestro cambiar el rol, la zona o el estado de un
usuario por causa de dinero sin consolidar, de cierres pendientes o de la ausencia de
administradores de bodega en una zona. *(Requisito negativo, y es la decisión del humano del
2026-09-08 escrita como test.)*

**R15** — SI el cambio deja en la zona **al menos un** administrador de bodega activo, ENTONCES el
sistema DEBE aplicarlo **sin ninguna confirmación adicional**: los mismos clics que hoy.

**R16** — MIENTRAS el usuario afectado no sea administrador de bodega activo con zona asignada, el
sistema NO DEBE mostrar el aviso. *(Un mensajero que cambia de zona no atrapa dinero: sus cierres
ya congelaron `destino_zona_id` y los consolida la zona de origen.)*

**R17** — El sistema DEBE contar como administradores de bodega restantes **solo** los que estén en
estado activo y en esa zona, y DEBE **excluir del recuento al usuario cuyo cambio se está
evaluando**.

**R18** — El importe y el recuento del aviso DEBEN calcularse con **el mismo criterio de selección**
con el que la consolidación elige los cierres que puede consolidar: un solo criterio, no una copia
parecida.

**R19** — El sistema DEBE transportar y pintar el importe del aviso **sin convertirlo a coma
flotante** en ningún punto del camino.

**R20** — SI la consulta previa del aviso no se puede resolver (error, sesión caída o dato
inalcanzable), ENTONCES el sistema DEBE decirlo **en el mismo punto en el que diría el aviso** y
DEBE permitir al maestro continuar de todas formas. *(Ni silencio ni bloqueo: las dos alternativas
están prohibidas, la primera por R21 y la segunda por R14.)*

**R21** — El sistema NO DEBE aplicar un cambio de los de R9 **sin haber evaluado antes** su impacto:
un cambio aplicado sin evaluación es un fallo, aunque el resultado visible sea correcto.

**R22** — La consulta previa DEBE estar reservada al **mismo rol** que ya administra usuarios y NO
DEBE devolver ningún dato personal del usuario evaluado ni de ningún otro.

**R23** — El aviso DEBE nombrar el rol con la **misma etiqueta** que el resto de la aplicación usa
para ese rol, y NO DEBE usar el identificador técnico del rol ni jerga interna.

---

## Fuera de alcance (declarado, para que nadie lo persiga)

1. **Abrir la consolidación al maestro o al admin.** Está medido y descartado: `repartirEfectivo`
   (`CierreBodegaService.ts:96`) paga a los mensajeros **con el efectivo que hay físicamente en esa
   bodega**; consolidar desde un escritorio produce un pago registrado sin efectivo detrás. No es una
   guarda: es cambiar de quién es el dinero.
2. **Mover el dinero ya atrapado.** No hay ninguno hoy (0 filas medidas) y esta ficha no crea vía de
   rescate: crea la vía de **no llegar ahí sin saberlo**.
3. **Avisar por notificación.** Exigiría migración de enum (`NotificacionEvento` es inventario
   cerrado y el schema lo dice literalmente) y el destinatario natural es el maestro que está
   mirando la pantalla en ese instante. Ver `design.md` §7, alternativa A3.
4. **Retroactivo / backfill.** D2 ya ocurrió en **0 filas**: no hay nada que reparar.
5. **El otro `destino_tipo`.** Los cierres con destino a la central no dependen de ningún
   `adminSatelite`; el criterio de R18 los deja fuera solo, sin caso especial.

---

## Decisiones del leader — **asunciones NO firmadas por el humano**

Cada una con su vuelta atrás medida en líneas.

**AS1 — El aviso se dispara por «la zona se queda sin administrador de bodega», NO por «hay dinero
pendiente».** Con el umbral en el dinero, hoy el aviso **no aparecería nunca** (0 pendiente en las 7
zonas) y la ficha entregaría una función invisible; y el daño real no es el dinero de hoy, es que la
zona se queda **sin nadie que pueda cerrarla**, así que todo lo que entre después queda retenido.
El importe se dice **siempre**, incluido cuando es cero (con la frase que corresponde a cero).
**Vuelta atrás:** añadir `&& cierresSinConsolidar > 0` a la condición del aviso. Una línea, un test.

**AS2 — Con al menos un administrador de bodega restante NO se avisa, aunque haya dinero
pendiente.** Ese dinero es alcanzable: alguien puede consolidarlo. Avisar ahí sería ruido, y el ruido
mata avisos. **Vuelta atrás:** una segunda rama en el mismo predicado.

**AS3 — El importe que se dice es el TOTAL GENERAL de los cierres consolidables** (no solo el
efectivo). Es lo que la consolidación arrastra y lo que el maestro reconoce como «el dinero de esa
bodega». **Vuelta atrás:** cambiar el campo agregado; el contrato ya viaja como `string` de escala 2.

**AS4 — R3 (rechazar la edición cuando el rol nuevo exige zona y no hay ninguna) es la contrapartida
simétrica de R1** y replica lo que `crear` y `vehiculoId` ya hacen. **Hoy es inalcanzable desde la
pantalla** —`UsuarioForm.tsx:199-207` ya exige la zona en cliente antes de enviar— así que no añade
fricción a nadie por la vía real; solo cierra la puerta de una llamada directa a la acción.
**Vuelta atrás:** dejar la zona intacta en ese caso concreto (un `if` extra), a costa de admitir un
administrador de bodega **sin zona**, que es otra forma del mismo dato sucio.

**AS5 — La evaluación previa se pide SIEMPRE antes de un cambio de rol/zona/estado, y es el servidor
quien decide si hay algo que avisar.** La alternativa (que la pantalla decida a quién preguntar) mete
literales de rol en un componente y reabre el modo de fallo de esta ficha: quien olvide una rama
produce un cambio silencioso. Coste: **una lectura extra** en una pantalla de administración de uso
esporádico. **Vuelta atrás:** filtrar en el cliente por `rolValue`/`estado` de la fila.

---

## Preguntas abiertas (necesitan al humano)

**Q1 — ¿El aviso debe aparecer también cuando la zona se queda sin administrador de bodega y NO hay
un céntimo pendiente?** Es AS1, y es la diferencia entre «hoy se ve en 5 zonas» y «hoy no se ve
nunca». El leader recomienda **sí**. Si el humano dice no, cae AS1 y con ella el único caso
observable en producción hoy.

**Q2 — ¿Debe el aviso decir QUIÉN queda (o quién era el otro) en la zona?** Hoy solo se dice
*cuántos*. Decirlo por nombre convierte el aviso en accionable («nombra a un sustituto») pero mete
identidad de terceros en un diálogo que hoy no la lleva. El leader **no lo incluye** por defecto.

**Q3 — La cuenta que deja de ser administrador de bodega se queda sin zona (R1). ¿Importa perder esa
pista?** El leader midió que **no se pierde**: `UserRepository.update` (`:457-465`) escribe
`usuario_zona_cambiada` con `valorAnterior = <nombre de la zona>` en cuanto `data.zonaId` difiere del
previo, y hoy —al no enviarse el campo— **no se escribe absolutamente nada**. O sea: el arreglo
**crea** el rastro donde hoy no hay ninguno, en el mismo lote que el cambio de rol. Lo que sí
desaparece es la posibilidad de *deducir* la zona vieja leyendo la fila viva. Se pregunta por si el
humano quiere además una vía de **deshacer** en un clic (hoy no existe para ningún campo del
formulario, así que sería una función nueva, no una reparación).

**Q4 — ¿Debe existir el aviso simétrico al ENTRAR?** Es decir, cuando el maestro asigna un
administrador de bodega a una zona que tenía dinero retenido, decirle «esta zona tenía ₡X esperando y
ahora ya se puede consolidar». No lo pidió nadie y no está en el alcance; se anota porque es la mitad
que cierra el círculo y cuesta poco sobre lo mismo que esta ficha construye.

**Q5 — ¿Hay algún consumidor de `actualizarUsuario` / `cambiarEstadoUsuario` fuera de la pantalla de
Configuración > Usuarios?** El leader **no encontró ninguno** (la guardia de superficie de uso
obliga a que toda acción sea alcanzable desde una pantalla, y la única que las monta es
`UsuariosModule`), pero un script operativo o una sesión de soporte que las llame directamente
recibiría el comportamiento de R3 sin haber visto nunca el aviso. Si existe alguno, hay que decirlo
antes de implementar.
