---
titulo: Configuración · SINPE por bodega
modulo: configuracion
pantalla: /configuracion/sinpe
roles: [maestro, admin]
actualizado: 2026-09-16
fuentes:
  - app/(app)/configuracion/sinpe/page.tsx
  - app/(app)/configuracion/sinpe/_components/SinpeBodegasModule.tsx
  - components/shared/SinpeCampos.tsx
  - components/shared/RevisionSinpeBodega.tsx
  - components/shared/sinpe-textos.ts
  - lib/actions/sinpe-bodega.ts
  - lib/auth/revision-sinpe-pendiente.ts
  - lib/types/sinpe-bodega.ts
  - lib/utils/sinpe-cr.ts
  - lib/auth/menu-visibility.ts
---

# SINPE por bodega

El número de SINPE Móvil **de cada bodega**: el que los clientes leen cuando su pedido sale a
entrega y van a pagar. Desde acá se ven y se cambian los de todas.

Cada bodega cobra en el suyo. Lo que cambiés acá es lo que van a leer los clientes de esa bodega
cuando su pedido salga a entrega.

## Dónde está

Dentro de **Configuración**, y ese menú hoy solo lo ve el maestro. Un administrador entra igual
—la pantalla lo deja pasar— pero escribiendo la dirección: no tiene entrada en el menú.

Y no es el único sitio donde se toca este número. Mientras la bodega central esté sin revisar, al
maestro y a los administradores les aparece al iniciar sesión un aviso que deja **confirmarla o
corregirla ahí mismo**, sin pasar por esta pantalla.

## La tabla

Una fila por bodega, con **Bodega**, **Número SINPE**, **A nombre de**, **Última revisión** y una
columna de **Acciones** con el botón **Editar**.

- El distintivo **Central** marca la bodega de la central.
- El distintivo **Sin revisar** sale en lugar de la fecha mientras nadie haya tocado ese número
  dentro de la aplicación.

**«Sin revisar» no es un error.** Esas bodegas siguen con el número de la central, que es un número
perfectamente válido. Lo que hay que decidir es si ese cobro tiene que entrar a la central o a la
bodega. Y no bloquea nada: una bodega sin revisar trabaja con normalidad.

**«Última revisión» no es «último cambio».** Esa fecha se mueve también cuando alguien confirma el
número **sin cambiar nada**. Dice que alguien lo miró ese día, no que lo tocara. La fecha y la hora
van en horario de Costa Rica.

## Cómo se cambia

**Editar** abre una ventana con los dos campos de esa bodega, y el título dice de cuál. No se
escribe sobre la fila a propósito: el cambio decide a qué cuenta va el dinero de una bodega entera,
y una ventana obliga a un gesto deliberado.

- **Número SINPE** — 8 dígitos que empiecen por 6, 7 u 8. Es la numeración móvil de Costa Rica, y
  SINPE Móvil solo funciona sobre una línea móvil. Podés escribirlo con espacios, con guiones o con
  el `+506` delante: se guarda como los ocho dígitos.
- **A nombre de** — el titular, **tal como aparece en SINPE Móvil al teclear el número**. No como se
  llama la empresa en los papeles: como lo va a ver el cliente en su teléfono.

Si algo está mal, el error sale **junto al campo** y la ventana no se cierra.

## Por qué esta pantalla pide cuidado

**Un número mal escrito no da error.** Ocho dígitos cualquiera son válidos para el sistema. Los
clientes transferirían a una cuenta equivocada y nos enteraríamos días después, por los reclamos.

Por eso queda registrado **quién lo cambió y cuándo**. Eso no se consulta acá, sino en **Histórico ·
Acciones**, que hoy solo abre el maestro. Una confirmación sin cambios no deja registro,
precisamente porque no cambió nada.

**Esta pantalla no arma el mensaje del cliente ni lo enseña.** Acá se escriben el número y el
titular, y nada más. La vista previa de la frase completa existe, pero en **Mi bodega**, que es la
pantalla del administrador de una bodega satélite.

## Lo que esta pantalla NO hace

- **No mueve plata ni concilia nada.** Solo dice a qué número se paga. El dinero se ve en **Wallet**.
- **No cambia la plantilla del mensaje.** El texto que rodea al número se edita en **Configuración ·
  Plantillas**, que hoy solo abre el maestro; acá solo se llenan el número y el titular.
- **No enseña quién hizo cada cambio.** Eso está en **Histórico · Acciones**.
- **No afecta a los cobros ya hechos.** Lo que se transfirió al número anterior ya se transfirió ahí.
- **No corta el acceso de nadie.** Tener la revisión pendiente no impide entrar ni trabajar.
