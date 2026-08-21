# Feature 236 — Ayuda a la tienda: la pestaña propia en `/novedades` y su card

> **Lo que esta ficha cierra, en una frase:** hoy el mensajero pide ayuda escribiendo una nota
> obligatoria, y **la tienda no tiene dónde leerla**. Esta ficha le da a la solicitud de ayuda su
> **pestaña propia** —con el corte hecho en el **servidor**—, su card con las acciones que le
> corresponden, y **repone la lectura del hilo** del lado de la tienda.
>
> **Es la ficha que cierra la enmienda de R35 de la 235.** Aquella dice, con esas palabras: «para el
> `adminTienda` es la pestaña de la ficha 236, que monta la card y su hilo… Dueño y fecha de muerte:
> ficha 236». Mientras no entre, la tienda ve que le piden ayuda y no puede leer el motivo.
>
> **Fuentes medidas, no re-derivadas aquí:**
> `progress/medicion_236.md` (producción, 2026-08-19, MCP solo lectura) ·
> `progress/recorrido_235.md` §6 y §9 (lo que la tienda ve **hoy en pantalla**) ·
> `progress/design_pila_ayuda_tienda.md` §F2 y §«Decisiones ya firmadas» ·
> `progress/auditoria_ayuda_tienda.md` §4 ·
> `specs/235-ayuda-tienda-estatus/` (entera; §«RECONCILIACIÓN DE R35» y `design.md` §6.4).
>
> **Base:** `origin/dev` **con la 235 ya dentro** (mergeada el 2026-08-19).

---

## Lo que ya está medido — no se vuelve a suponer

**En producción, el 2026-08-19** (`progress/medicion_236.md`, con 141 órdenes vivas en 11 estatus
como denominador): **`devuelta` = 0** y **`ayuda_tienda` = 0** órdenes vivas; **0 notas de orden
vivas** y **0 órdenes con nota**.

Tres consecuencias que esta ficha escribe en sus requisitos y no en una nota al pie:

1. **El defecto es PROSPECTIVO, no una pérdida en curso.** «La nota se escribe y nadie la lee» es
   cierto por construcción, pero **hoy no hay ninguna nota perdida**: la ayuda todavía no se puede
   pedir en producción. Esta ficha **no rescata datos, impide que se pierdan** desde el primer día en
   que la 235 salga. **No hay backfill, no hay recuperación, no hay migración de datos.**
2. **El estado vacío es el PRIMER estado que la tienda va a conocer**, y durante un tiempo el único:
   la pestaña sin órdenes (R16) y el hilo sin notas dentro de la card (R33). Un estado vacío mudo se
   lee como una pantalla rota, así que los dos llevan requisito propio.
3. **«Nadie usa el hilo, luego no hace falta» es falso, y queda escrito por qué:** hasta ahora
   **ningún flujo lo exigía**. La solicitud de ayuda de la 235 es el **primero** que hace la nota
   **obligatoria**. El primer dato real llegará con el despliegue.

⏳ **La foto caduca** en cuanto la 235 llegue a producción. Se **re-mide antes de desplegar** la 236,
no antes de mergearla (T0.1, con la consulta de `progress/medicion_236.md` §4).

**Y lo que se vio en pantalla el 2026-08-19** (`progress/recorrido_235.md` §6/§9), entrando como
`adminTienda`: la orden en ayuda aparece **bajo la pestaña «En devolución»**, bajo un subtítulo que
dice *«Tus órdenes en devolución y las que llegaron a rechazo por vencerse el plazo»* —ninguna de las
dos cosas es cierta de una orden en ayuda—, y con estas acciones y sólo estas: **Llamar, WhatsApp,
Habilitar, Registrar intento de contacto**. **Leer el hilo NO EXISTE.**

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **el estatus de ayuda** | `ayuda_tienda`: el mensajero pidió ayuda sobre esa orden y el paquete sigue con él, en la calle (feature 235). |
| **grupo de novedad** | El motivo por el que una orden está en `/novedades`. Hoy hay **dos**: la **devolución anclada** (`devuelta`, feature 239) y la **ayuda** (`ayuda_tienda`, feature 235). Cada grupo es **una pestaña**. |
| **el predicado** | La condición con la que el servidor decide si una orden pertenece a un grupo. Hoy `OrdenRepository.novedadWhere` los cubre los dos en un `OR`; esta ficha los separa **sin dejar de derivarlos de una sola declaración**. |
| **la card** | La fila de `/novedades`, que es la misma card POS del portal del mensajero (`PosOrderCard*`) con un panel de acciones propio (`NovedadAcciones`). |
| **el hilo** | El hilo de notas de la orden (`orden_nota`, feature 227), compartido por tienda y mensajero. Su ventana de escritura vive en `lib/types/ventana-hilo-notas.ts`. |
| **rescate** | La transición `ayuda_tienda → en_reparto`. La tienda la dispara con «Habilitar»; el punto único de escritura lo entregó la 235 (su R8). |
| **la tercera pestaña** | «Rechazadas por plazo vencido» (feature 102). Existe hoy, tiene su propio servicio y su propio DTO, y **esta ficha no la toca**. |

---

## A · El corte va en el SERVIDOR

> La 235 aprendió a la mala que un corte de cliente deja la orden alcanzable por otras vías: el
> apartado del portal del mensajero era un `useMemo` y la orden seguía siendo parada del optimizador,
> del mapa y del panel de gestión. Aquí el corte nace en el servidor o no nace.

**R1.** El sistema DEBE listar las órdenes en el estatus de ayuda de una tienda en una superficie
propia de `/novedades`, separada de la de las devoluciones.

**R2.** El sistema DEBE decidir **en el servidor** a qué superficie pertenece cada orden, y NO DEBE
depender de ninguna partición hecha en el cliente.

**R3.** El sistema DEBE derivar la pertenencia a cada superficie de una **igualdad con el estado
actual** de la orden, y NO de ninguna marca persistida distinta del estado.

**R4.** CUANDO el sistema cuente las órdenes de una superficie y CUANDO devuelva una página de ellas,
DEBE usar **exactamente el mismo predicado**.

**R5.** El sistema DEBE derivar los predicados de las dos superficies de **una sola declaración**, de
modo que no puedan divergir ni quedar una sin la otra.

**R6.** El sistema DEBE decidir con **esa misma declaración** qué acciones ofrece la interfaz sobre
una fila, de modo que lo que el servidor lista y lo que la pantalla ofrece no puedan describir grupos
distintos.

**R7.** El sistema NO DEBE compilar si se declara un grupo de novedad sin su estado, o un estado de
grupo que no exista en el catálogo de estados de orden.

**R8.** MIENTRAS una orden esté en el estatus de ayuda, el sistema NO DEBE listarla en la superficie
de devoluciones.

**R9.** El sistema NO DEBE listar la misma orden en las dos superficies a la vez, de modo que la suma
de sus totales no cuente ninguna orden dos veces.

**R10.** El sistema DEBE acotar cada superficie a la tienda del actor y DEBE excluir las órdenes
borradas.

**R11.** SI el actor no tiene el rol de administración de tienda, ENTONCES el sistema NO DEBE
devolver ninguna orden de ninguna de las dos superficies ni revelar sus totales.

---

## B · La pestaña, y los textos que hoy mienten

**R12.** El sistema DEBE ofrecer la superficie de ayuda como una **pestaña** de `/novedades`, con
paginación propia que sobreviva al cambio de pestaña.

**R13.** El sistema DEBE rotular esa pestaña con un texto en español, con tildes, que nombre la
solicitud de ayuda, **sin siglas y sin jerga interna**.

**R14.** El sistema DEBE describir la pantalla con un texto que nombre **las tres** superficies que
contiene, y NO DEBE describirla con uno que afirme de las órdenes que lista algo que no es cierto.

**R15.** MIENTRAS la superficie de ayuda tenga órdenes, el sistema DEBE decir cuántas hay en total y
qué tramo se está viendo, con el mismo control con que ya lo dicen las otras dos.

**R16.** MIENTRAS la superficie de ayuda no tenga ninguna orden, el sistema DEBE mostrar un **estado
vacío con texto** que diga qué aparecerá ahí y cuándo, y NO DEBE mostrar una lista sin filas.

**R17.** El sistema DEBE ordenar la superficie de ayuda por **la fecha en que se pidió la ayuda**, y
NO por una fecha que no describa esa espera.

---

## C · La card de ayuda y su juego de botones, decidido en UN SOLO SITIO

**R18.** El sistema DEBE decidir en **un único punto** qué acciones ofrece una fila de `/novedades`,
en función del **grupo** por el que esa orden está en la pantalla.

**R19.** El sistema NO DEBE decidir en ningún otro punto de esa pantalla si una acción se ofrece,
comparando el estado de la orden.

**R20.** El sistema NO DEBE compilar si se añade un grupo de novedad sin declarar su juego de
acciones, ni si se declara una acción que ese único punto no conozca.

**R21.** SI el estado de una orden no corresponde a ningún grupo declarado, ENTONCES el sistema NO
DEBE ofrecer sobre ella ninguna acción que la resuelva.

**R22.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE ofrecer sobre su fila:
llamar, WhatsApp, registrar un intento de contacto, **devolver la orden a la ruta** y **abrir la
conversación**.

**R23.** MIENTRAS una orden esté en el estatus de ayuda, el sistema NO DEBE ofrecer sobre su fila
ninguna acción que presuponga una devolución.

**R24.** CUANDO la tienda devuelve a la ruta una orden desde la superficie de ayuda, el sistema DEBE
dejar de listarla en esa superficie y DEBE reflejarlo en su total.

**R25.** SI la orden ya no está en el estatus de ayuda cuando la tienda pide devolverla a la ruta,
ENTONCES el sistema NO DEBE afirmar que la devolvió.

**R26.** El sistema NO DEBE atribuir a una orden en el estatus de ayuda una causa de devolución, ni
mostrarla, ni anunciar su ausencia.

---

## D · El hilo del lado de la tienda — la mitad de vuelta que la ficha promete

**R27.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE ofrecer a la tienda, **desde
la fila de esa orden**, una superficie para leer el hilo de notas de esa orden.

**R28.** CUANDO la tienda abre el hilo de una orden en el estatus de ayuda, el sistema DEBE mostrar
**el motivo con el que se pidió la ayuda** como parte de ese hilo.

**R29.** El sistema DEBE leer el hilo de una orden **sólo al abrirlo**, y NO DEBE leerlo al listar la
pestaña.

**R30.** El sistema DEBE tomar **del servidor** si el actor puede escribir en el hilo, y la interfaz
NO DEBE re-derivarlo del estado de la orden.

**R31.** MIENTRAS la tienda pueda escribir en el hilo de una orden en el estatus de ayuda, el sistema
DEBE permitirle publicar **sin exigirle antes devolver la orden a la ruta**.

**R32.** CUANDO la tienda publica una nota en el hilo de una orden en el estatus de ayuda, el sistema
NO DEBE cambiar el estado de la orden ni sacarla de la superficie de ayuda.

**R33.** SI el hilo de una orden no tiene ninguna nota, ENTONCES el sistema DEBE decirlo con texto y,
si el actor puede escribir, DEBE ofrecerle igualmente el campo para hacerlo.

**R34.** MIENTRAS el actor NO pueda escribir en el hilo, el sistema DEBE decírselo con texto y NO
DEBE ofrecerle el campo de escritura.

**R35.** SI el hilo no se puede leer, ENTONCES el sistema DEBE decir el motivo con un texto propio
para cada desenlace conocido, y NO DEBE quedarse en blanco.

**R36.** El sistema DEBE dejar a **los dos** roles con ventana de escritura sobre el estatus de ayuda
—mensajero y tienda— con una superficie alcanzable donde ejercerla, y NO DEBE quedar ningún rol con
la ventana abierta y sin sitio donde escribir.

---

## E · La descarga

**R37.** El sistema DEBE ofrecer la descarga del listado completo de la superficie de ayuda, con el
**mismo alcance y el mismo predicado** que su pestaña.

**R38.** El sistema NO DEBE incluir en la descarga de la superficie de devoluciones ninguna orden que
esté en el estatus de ayuda.

**R39.** El sistema NO DEBE publicar en la descarga de la superficie de ayuda una columna de causa de
devolución.

**R40.** El sistema DEBE evaluar el tope de filas de cada descarga **en el servidor** y, superado, NO
DEBE devolver ninguna fila.

---

## F · Lo que esta ficha NO puede cambiar

**R41.** El sistema NO DEBE alterar montos ni emitir, modificar o suprimir movimientos de dinero por
causa de esta feature.

**R42.** El sistema NO DEBE añadir, retirar ni modificar ningún estado de orden, ninguna transición
ni ninguna familia de origen del historial.

**R43.** El sistema NO DEBE cambiar el momento en que una orden entra o sale del estatus de ayuda ni
del de devolución, ni el reloj de plazo de ninguna devolución.

**R44.** El sistema NO DEBE cambiar lo que el mensajero ve ni puede hacer en su portal.

**R45.** El sistema NO DEBE cambiar la ventana de escritura del hilo de ningún rol.

**R46.** El sistema NO DEBE cambiar el conteo de intentos de entrega ni el de intentos de contacto de
ninguna orden.

**R47.** Ningún registro de diagnóstico producido por esta feature DEBE contener el cuerpo de una
nota, datos personales, teléfonos, direcciones ni secretos.

---

## Lo que YA funciona y NO se rehace

Se **reutiliza**, no se reescribe:

- **`HiloNotasNovedadModal.tsx`**, que existe entero en disco y **no está montado en ningún sitio**:
  el commit `55723c83` retiró el botón «Notas» y con él su montaje. La pieza está completa —lee con
  SWR bajo demanda, monta el componente compartido `HiloNotasOrden`, honra el `puedeEscribir` del
  servidor y tiene sus tres mensajes de fallo—. **Volver a darle superficie es reponer una línea en
  el módulo**, y está en la lista firmada de la guardia `orden-nota-frontera`.
- **`HiloNotasOrden`** (`components/shared/`), con su estado vacío y su aviso de solo lectura ya
  escritos.
- El **punto único de rescate** de la 235 y la Server Action `habilitarNovedad`, que ya lo llama.
- El botón «+1 intento de contacto» y su contador (`IntentoContactoAccion`).
- Las cards POS, su adaptador (`novedad-a-orden-card`) y el conmutador de vista.
- La pestaña «Rechazadas por plazo vencido» (102), con su servicio y su DTO propios.

## Fuera de alcance

- **El punto 12 del pedido** —que «Habilitar» aparezca justo en las cards que **vienen de un cierre**,
  que es donde el pedido decía que **no** debía estar— lo corrige la **ficha 240**. Está escrito así
  en `specs/235/design.md` §6.4 y en el código. Esta ficha **traslada** esa conducta a la tabla del
  punto único **sin arreglarla**, y con eso la 240 pasa a ser **el borrado de una celda**.
- **«Rechazar» de la card de devolución**, que hoy sigue siendo maqueta con su aviso por toast → 240.
- **La gestión de la tienda que cuenta como del mensajero** (reprogramar/rechazar desde ayuda, con
  evidencia y motivo obligatorios) → **ficha 237**.
- **La guardia que impide reponer el botón «Notas»** en las cards de cierre → 240.
- El **portal del mensajero** entero: su sección de ayuda, su card y su modal de hilo son de la 235 y
  no se tocan (R44).
- Cualquier cambio de estado, de transición, de reloj o de dinero (R41-R43).

### La ficha 228 queda SUPERADA por esta

La **228** («transición habilitar novedad: la tienda devuelve la orden a circulación») ya no tiene
contenido propio. La **235** entregó la transición y su punto único de escritura, y «Habilitar» la
llama; **esta ficha** le da a ese botón el sitio donde tiene sentido —la card de la pestaña de
ayuda—; y la **240** lo retira de las cards que vienen de un cierre. Con las tres, no queda nada que
la 228 aporte. El diseño de la pila ya lo daba por absorbida (§«Decisiones ya firmadas» punto 9).
**El leader estampa el cambio de estado en `feature_list.json`; este spec sólo lo declara.**

---

## Decisiones abiertas

Cada una lleva **qué se decide**, las opciones, **la recomendación con su porqué** y **qué se rompe
si se elige la otra**. Las marcadas **[FIRMA]** cambian producto o contrato y **no se implementan sin
respuesta humana**.

---

**D1 · ¿La pestaña de ayuda muestra sólo `ayuda_tienda`, o algo más? [FIRMA]**

- **(a)** Sólo las órdenes en el estatus de ayuda. **(b)** Además, alguna otra población «que la
  tienda tiene que atender» (p. ej. devoluciones con intentos de contacto registrados, o las que
  llevan más de N días sin resolver).

**Recomendación: (a), sólo `ayuda_tienda`.** Es una **igualdad de estado**, hermana exacta de la de
la devolución, y es lo que hace que R4 (count y find comparten predicado), R3 y R9 se cumplan **por
construcción** y no por una comprobación que alguien deba recordar. La 235 y la 239 gastaron dos
fichas enteras en llegar hasta aquí: cada vez que una rama de este predicado tuvo una **clave
hermana** al lado del estado, apareció una fuga (auditoría §2.1: una orden con la bandera encendida
se quedaba en `/novedades` para siempre).

**Qué se rompe con (b):** desaparece la propiedad «una orden vive en exactamente una pestaña» — hay
que decidir precedencia, la suma de los totales deja de ser el total de la pantalla, y el predicado
vuelve a tener una condición que no es el estado, que es justo la forma del fallo que la pila cerró.

---

**D2 · ¿«Habilitar» conserva su nota obligatoria? [FIRMA]**

- **(a)** Sí: para devolver la orden a la ruta hay que escribir una nota, que se publica en el hilo.
  **(b)** No: el rescate se dispara de un click.

**Recomendación: (a), la conserva.** Tres razones, en orden de peso: (i) **la nota es la puerta de
autorización**, literalmente — `HabilitarNovedadService` publica primero y sólo rescata si la nota se
aceptó; quitarla obliga a inventar un segundo camino de permisos para el rescate, que es exactamente
la «segunda tabla de permisos» que el repo evita a propósito; (ii) esa nota cae en **el mismo hilo**
que el mensajero abrió al pedir ayuda, así que es la **respuesta** a su «no puedo con esta» — un
rescate mudo le devuelve la orden sin decirle por qué; (iii) es la conducta de hoy, y esta ficha no
tiene ningún motivo para cambiarla.

**Qué se rompe con (b):** hay que escribir autorización propia para el rescate desde la tienda, el
mensajero recibe la orden de vuelta sin explicación, y el hilo pierde la mitad de su tráfico
esperado el día uno.

---

**D3 · Las órdenes en ayuda en la DESCARGA de novedades. [FIRMA]**

- **(a)** Cada pestaña tiene su descarga: la de devoluciones deja de traer las de ayuda, y la de
  ayuda tiene sus columnas (sin «Causa de devolución»). **(b)** La descarga de «En devolución» sigue
  trayéndolo todo mezclado, como hoy. **(c)** La pestaña de ayuda no tiene descarga.

**Recomendación: (a).** La regla está escrita en el propio archivo de columnas: «el archivo publica
lo que la **pantalla** enseña, ni más ni menos… publicar por el archivo un dato que la pantalla
oculta sería saltarse la decisión de la pantalla por la puerta de atrás». Si la pantalla las separa,
el archivo también. Y la columna **«Causa de devolución» no aplica** a una orden en ayuda: hoy sale
«Sin causa registrada», que **anuncia un hueco que no existe** (R26). **Coste de migración: cero** —
`devuelta` = 0 en producción, así que hoy ese archivo sale vacío.

**Qué se rompe con (b):** el total del archivo deja de coincidir con el total de la pestaña, y el
archivo sigue afirmando una causa ausente sobre órdenes que nunca se devolvieron.
**Qué se rompe con (c):** la tienda **pierde** una capacidad que hoy tiene (esas filas hoy se
descargan, aunque mezcladas). Una regresión silenciosa.

---

**D4 · ¿Puede la tienda escribir en el hilo sin rescatar la orden? [FIRMA]**

- **(a)** Sí. **(b)** No: puede leer, y para responder tiene que devolver la orden a la ruta.

**Recomendación: (a), sí.** **Ya está firmado y ya funciona en el servidor:** el R34 de la 235 puso
`ayuda_tienda` en la ventana de escritura de **los dos** roles, con la razón escrita en el código —«si
el mensajero no puede escribir, la tienda le habla a un hilo mudo»—, y `listarNotasOrden` ya devuelve
`puedeEscribir = true` para ese caso. Esta ficha **no concede** nada: **repone la superficie** donde
ejercer un permiso que ya existe. Es, palabra por palabra, lo que la enmienda de R35 le encargó.

**Qué se rompe con (b):** hay que **estrechar** `VENTANA_ESCRITURA.adminTienda` (reabrir R34/R45 de
la 235), y el hilo se vuelve unidireccional de hecho: el mensajero pregunta «¿confirmo otra
dirección?» y la única forma de contestarle es sacarle la orden de las manos.

---

**D5 · Dónde se monta el hilo «dentro de la card». [FIRMA ligera]**

§F2 dice «el hilo se monta **dentro de la card**». Hay dos lecturas:

- **(a)** Una acción en la card que abre el hilo en una ventana (lo que hace **hoy el lado
  mensajero**: `RepartoModule` pinta un botón «Conversación» que monta `HiloNotasAyudaModal` con
  `key` por orden y carga bajo demanda).
- **(b)** El hilo desplegable **dentro** de la card, en línea.

**Recomendación: (a), la misma forma que el mensajero.** (i) La pieza de la tienda ya existe hecha y
sin montar (`HiloNotasNovedadModal`) y es **el mismo montaje** que la del mensajero; (ii) el hilo es
de tamaño variable y **no puede viajar en el listado paginado** — está escrito en el contrato
(`lib/types/novedad.ts`: «costaría una consulta por orden de la página (N+1) para un dato que sólo se
mira al abrir una orden»); (iii) la card se comparte con el portal del mensajero y tiene **dos
vistas**, y en la de mosaico (tres columnas) un hilo en línea es ilegible. Las dos pantallas dicen lo
mismo con el mismo gesto (R36).

**Qué se rompe con (b):** hay que bifurcar la card compartida o envolverla, y el desplegable convive
mal con el conmutador de vista y con «Ver detalle completo», que ya es un `Collapsible`.

*(Un indicador de «hay conversación sin leer» en la fila **queda fuera**: exigiría una lectura por
fila —el N+1 que este contrato evita a propósito— o una columna nueva. No es de esta ficha.)*

---

**D6 · Los textos de la pantalla. [FIRMA]**

Todo el copy junto, para que se firme de una vez. Español con tildes, sin siglas ni jerga:

| Qué | Hoy | Recomendación | Alternativa |
| --- | --- | --- | --- |
| Rótulo de la pestaña | *(no existe)* | **«Ayuda solicitada»** | «Ayuda a gestionar» (§F2) |
| Orden de las pestañas | devolución · rechazos | **ayuda · devolución · rechazos** | ayuda en segundo lugar |
| Subtítulo de la página | «Tus órdenes en devolución **y las que llegaron a rechazo por vencerse el plazo**» | **«Las órdenes en las que tus mensajeros piden ayuda, tus órdenes en devolución y las que llegaron a rechazo por vencerse el plazo»** | «Lo que necesita tu atención: solicitudes de ayuda, devoluciones y rechazos por plazo vencido» |
| Estado vacío de la pestaña | *(no existe)* | **«Ningún mensajero te pidió ayuda»** + «Cuando un mensajero necesite que resuelvas algo de una orden que lleva encima, aparecerá acá con su mensaje.» | — |
| Chip de la card de ayuda | «Ayuda solicitada» / «Ayuda · \<causa\>» | **«Esperando tu respuesta»** | «Ayuda solicitada» |

**Por qué «Ayuda solicitada» y no «Ayuda a gestionar»:** «gestionar» es, en este repo, **el verbo del
mensajero** —gestionar una orden es registrar su desenlace— y usarlo aquí significa otra cosa. En
cambio «ayuda solicitada» es la palabra que la tienda **ya ve** en tres sitios: el chip de la card de
hoy, el encabezado del portal del mensajero («Con ayuda solicitada») y la etiqueta del estatus
(«Ayuda solicitada a la tienda»). **Esto se aparta del diseño §F2 y por eso se somete a firma.**

**Por qué la pestaña de ayuda va primera:** alguien está esperando respuesta **ahora**; una
devolución no espera a nadie con esa urgencia. El precedente está escrito en esta misma pantalla («la
ayuda va PRIMERO cuando existe porque es lo accionable», `NovedadesModule.badgeNovedad`).
**Contrapartida real, dicha aquí y no descubierta después:** con la medición delante, la pestaña de
entrada de `/novedades` **va a estar vacía** los primeros días. Por eso R16 exige que el vacío hable.

**Por qué el chip cambia:** dentro de una pestaña que ya se llama «Ayuda solicitada», repetirlo en
cada card no informa; y «Ayuda · \<causa\>» es un **arrastre**: esa causa viene de una devolución
anterior ya deshecha y no describe esta orden (R26).

**Qué se rompe si se elige lo otro:** con «Ayuda a gestionar», la tienda lee un verbo que en la app
significa otra cosa y que la 237 va a usar para lo que sí es gestionar. Con la ayuda en segundo
lugar, la señal accionable queda detrás de un click y se repite —en menor grado— el defecto que esta
ficha cierra.

---

**D7 · El orden de la lista de ayuda. [FIRMA ligera]**

- **(a)** Por la **fecha de la solicitud de ayuda**, la que lleva más esperando primero.
  **(b)** Por la fecha de creación de la orden, descendente (el fallback de hoy).

**Recomendación: (a), ascendente por fecha de solicitud.** La pregunta de la tienda al abrir esta
pestaña es «¿cuál lleva más tiempo esperándome?», y **ninguna otra fecha la responde**: la de
creación de la orden no tiene nada que ver con cuándo se pidió ayuda. El molde existe y no es N+1: la
pantalla de devoluciones ya resuelve su fecha de recencia con **una** consulta agregada por página
(`findCausasDevueltaVigentes`); ésta sería la hermana sobre el historial de estado.

**Qué se rompe con (b):** la lista se ordena por un dato que aquí no significa nada, y la orden que
lleva tres días esperando puede quedar al final de la página. Coste de (a): un método de repositorio
más y una consulta agregada por página.

---

**D8 · Qué dice la pantalla cuando «Habilitar» no mueve nada (R25). [FIRMA — toca un contrato de otra ficha]**

Hoy `habilitarNovedad` devuelve **el resultado de la nota**, no el del rescate (decisión deliberada
de la 235, que difiere a la **240** «qué debe además mover Habilitar»). Consecuencia: si el mensajero
rescató la orden un segundo antes, la tienda publica su nota, **la fila desaparece de la pantalla** y
el aviso dice «Orden habilitada» — sobre una orden que nadie movió. Al recargar, vuelve.

- **(a)** El resultado distingue «se devolvió a la ruta» de «no se movió», y la pantalla lo dice.
  **(b)** Se deja como está y lo resuelve la 240 con el resto de «Habilitar».

**Recomendación: (a).** Es una carrera poco frecuente pero **la pantalla afirma algo falso**, que es
justo lo que esta ficha viene a corregir en los otros dos sitios (el subtítulo y la pestaña). El
cambio es propagar un resultado que el punto único de rescate **ya devuelve**.

**Qué se rompe con (b):** queda una tercera afirmación falsa en la misma pantalla, y la fila que
«desaparece» por optimismo de cliente reaparece al recargar sin que nada lo explique.
**Qué cuesta (a):** se toca `IHabilitarNovedadService`/`HabilitarNovedadResult`, que la **240** va a
volver a tocar. Hay que decidirlo antes de que las dos fichas escriban sobre lo mismo.

---

**D9 · ¿Se re-mide antes de desplegar, y quién bloquea con ello? [sin firma, es operación]**

No es una opción, es una tarea: **T0.1**. La foto de `progress/medicion_236.md` se tomó **antes** de
que la 235 llegara a producción; en cuanto llegue, los dos ceros dejan de serlo. Se re-mide con la
consulta de su §4 **antes de desplegar**, no antes de mergear. Lo que la re-medición puede cambiar:
si el día del despliegue hay órdenes ya en `ayuda_tienda`, esta ficha pasa de **prospectiva** a
**correctiva** y hay solicitudes reales esperando lectura desde el primer minuto.

---

## Lo que NO es una decisión abierta, y conviene decirlo

- **No hay backfill, ni recuperación de notas, ni migración de datos.** Medido: 0 notas vivas, 0
  órdenes con nota, 0 órdenes en ayuda. No hay nada que rescatar; hay algo que **impedir que se
  pierda**.
- **No hay tabla nueva, ni columna, ni migración, ni política RLS nueva.** Esta ficha no persiste
  nada (ver `design.md` §1).
- **No hay estado, transición ni familia de origen nuevos** (R42). Si la guardia de transiciones
  exhaustivas se pone roja, alguien tocó algo que esta ficha no toca.

---

## PUERTA HUMANA PASADA — 2026-08-19

Las nueve decisiones quedan resueltas. **Tres las firmó el humano** (D6, D3, D8, que eran las que
podían salir de otra manera); las demás las firma el **leader con la recomendación del spec**, y se
dice cuál es cuál para que dentro de seis meses no haya que adivinarlo.

### Firmadas por el humano

- **D6 — los textos: «Ayuda solicitada».** La pestaña se llama así, **va primera**, el subtítulo
  nombra las tres superficies y el chip pasa a **«Esperando tu respuesta»**.
  ⚠️ **Esto se aparta a propósito del §F2 de `progress/design_pila_ayuda_tienda.md`**, que decía
  «Ayuda a gestionar». La razón, firmada: **«gestionar» es el verbo del MENSAJERO en este repo**
  («por gestionar», «Gestionar más tarde», «Gestionar esta orden»), así que usarlo en la pantalla de
  la tienda le atribuye un gesto que no es suyo — y menos aún ahora, que **gestionar desde ayuda es
  la ficha 237** y todavía no existe. Anotar el cambio en §F2.
- **D3 — una descarga por pestaña**, y la de devoluciones **deja de traer** las órdenes en ayuda. El
  archivo publica lo que la pantalla enseña. Hoy su columna «Causa de devolución» dice «Sin causa
  registrada» sobre una orden que **no es una devolución**, o sea que miente con formato de dato.
  **Coste de migración: cero**, medido — `devuelta` = 0 en producción, así que nadie tiene un archivo
  viejo que cambie de forma bajo los pies (`progress/medicion_236.md`).
- **D8 — que la pantalla lo diga** cuando «Habilitar» no movió nada. Hoy afirma «Orden habilitada»
  sobre una orden que la carrera con el mensajero pudo dejar quieta: la tienda lee una confirmación
  de algo que no hizo. **Se firma AHORA, y ese es el motivo de traerla:** toca
  `HabilitarNovedadResult`, que la **240** también va a tocar, y si las dos escriben sin acordarlo
  una sobrescribe a la otra **en silencio**.

### Firmadas por el leader, con la recomendación del spec

- **D1 — la pestaña muestra SÓLO `ayuda_tienda`.** Una igualdad de estado, hermana de la de
  devolución: es lo que hace que «`count` y `find` comparten predicado» y «una orden vive en una sola
  pestaña» se cumplan **por construcción**. Cualquier otra población reintroduce la clave hermana que
  ya causó dos fugas en esta pila.
- **D2 — «Habilitar» conserva su nota obligatoria.** La nota **es** la puerta de autorización del
  rescate, y cae en el mismo hilo que el mensajero abrió: es literalmente la respuesta a su «no puedo
  con esta».
- **D4 — la tienda escribe en el hilo sin rescatar.** No es una concesión nueva: **R34 de la 235 ya
  puso `ayuda_tienda` en la ventana de los dos roles** y el servidor ya devuelve `puedeEscribir`.
  Esta ficha **repone la superficie**, no amplía el permiso.
- **D5 — el hilo se abre desde una acción de la card**, igual que el lado mensajero. La pieza
  (`HiloNotasNovedadModal`) ya existe **sin montar**; el hilo **no puede viajar en el listado**
  paginado (N+1 prohibido por contrato) y la card tiene vista mosaico de tres columnas.
- **D7 — la lista se ordena por la fecha de la SOLICITUD**, la que lleva más esperando primero. La
  fecha de creación de la orden no responde la única pregunta que la tienda se hace ahí.
- **D9 — operación, sin firma:** ⏳ la medición **caduca**. Re-medir **antes de desplegar**, no antes
  de mergear.

### Lo que la medición mató antes de llegar a firma

`progress/medicion_236.md`: **0 notas vivas y 0 órdenes en `devuelta`/`ayuda_tienda`**, sobre 141
vivas en 11 estatus. Con eso desapareció una decisión que iba a escribirse («¿hay que recuperar las
notas huérfanas?»): **no existe**. Esta ficha es **prospectiva** — no rescata datos, impide que se
pierdan desde el primer día en que la 235 salga. Y el estado vacío deja de ser un caso marginal:
**es el primero que la tienda va a conocer.**
