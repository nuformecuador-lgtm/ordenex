# Ficha 335 — `/mi-wallet` adopta la presentación de `/wallet`, su filtro deja de pedir un UUID y entra al menú

> **Zona:** `fullstack` · **Complejidad:** media · **Secuencia:** backend → frontend → puerta.
> Requisitos en EARS. Cada `R<n>` termina mapeado a un test concreto (ver `tasks.md` §Trazabilidad).

---

## 0. Qué NO cambia (marco del encargo)

Lo siguiente está **verificado leyendo el código** y esta ficha lo **conserva tal cual**. Se
escribe aquí porque varios requisitos de abajo son de NO REGRESIÓN sobre estas propiedades:

- **Rol:** `app/(app)/mi-wallet/page.tsx:25-27` hace `notFound()` para todo actor cuyo rol no sea
  `adminTienda` (y para el actor ausente), resuelto server-side.
- **Alcance:** `WalletTiendaService` acota por `actor.usuarioId` escrito **al final** del objeto que
  va al repositorio (`lib/services/WalletTiendaService.ts:107,162`) y
  `WalletTiendaMovimientoRepository` lo pone en el `where` (`:91-94, :113-116, :145-148`), nunca en
  memoria.
- **Solo lectura:** las 8 Server Actions de `lib/actions/wallet-tienda.ts` son consultas. No hay
  `create`/`update`/`delete` ni en la action ni en `WalletTiendaService`.

**FUERA DE ALCANCE, explícito:** permisos, alcance por tienda, cualquier mutación, `/mis-pagos` y
`/qr` (esos dos son la ficha 336).

**Corrección a la nota de encargo (medida en el árbol):** el menú del `adminTienda` tiene **TRES**
ítems, no dos — «Analítica» (`ROLES_ACCESO_ANALITICA` incluye `adminTienda`, derivada de
`ROLES_ANALITICA` menos `mensajero`), «Órdenes» y «Novedades». Lo afirma hoy
`tests/unit/auth/menu-visibility.test.ts:186` con un `toEqual(["Analítica","Órdenes","Novedades"])`.
Cambia el número esperado, no la conclusión: `/mi-wallet` no está en `SIDEBAR_ITEMS`.

---

## A. Backend — la lectura de los cierres de la tienda

> Ninguna action del árbol lista los cierres de UNA tienda: las de `lib/actions/cierre-bodega.ts`
> son de admin/bodega. El selector necesita una lectura nueva, acotada al actor.

**R1.** El sistema DEBE ofrecer una lectura que devuelva los cierres del día que tienen **al menos
un movimiento** en el libro de la tienda del actor.

**R2.** MIENTRAS el actor autenticado tenga el rol `adminTienda`, el sistema DEBE resolver el
alcance de esa lectura con el identificador del **propio actor**, y DEBE aplicarlo en el criterio de
la consulta a la base de datos, nunca filtrando en memoria.

**R3.** SI el actor tiene un rol distinto de `adminTienda`, ENTONCES el sistema DEBE responder
`forbidden` **sin haber consultado la base de datos**.

**R4.** SI no hay sesión, ENTONCES el sistema DEBE responder `unauthenticated` **antes** de llamar al
servicio de dominio.

**R5.** La lectura NO DEBE aceptar ningún parámetro de entrada. Un intento de pasarle datos —en
particular un identificador de tienda— NO DEBE alterar el conjunto devuelto.

**R6.** Cada elemento devuelto DEBE llevar exactamente tres datos: el identificador interno del
cierre, el instante del movimiento **más reciente** de ese cierre en el libro de esa tienda, y el
**número de movimientos** de ese cierre en ese libro.

**R7.** El sistema DEBE devolver los elementos ordenados del cierre más reciente al más antiguo, con
un criterio de desempate determinista, de modo que dos lecturas seguidas del mismo conjunto
devuelvan el mismo orden.

**R8.** El sistema DEBE recortar la lista a un tope configurable y DEBE informar, junto a la lista,
si el conjunto real supera ese tope.

**R9.** La respuesta de esta lectura NO DEBE contener ningún importe.

**R10.** El sistema DEBE resolver esta lectura con **una sola** consulta a la base de datos, sea cual
sea el número de cierres devueltos.

**R11.** Esta ficha NO DEBE añadir migraciones ni modificar `db/schema.prisma`.

---

## B. Frontend — la presentación de `/mi-wallet`

> `/wallet` es la referencia (`app/(app)/wallet/_components/WalletModule.tsx`, rediseño de la ficha
> 200): tarjeta de cifras arriba, y el libro dentro de UNA tarjeta con su título, su banda de
> filtros y su paginación en el pie.

**R12.** El sistema DEBE presentar el saldo y sus tres importes en una tarjeta, y el libro de
movimientos en **otra tarjeta hermana**; ninguna de las dos DEBE estar anidada dentro de la otra.

**R13.** La tarjeta del libro DEBE llevar un **título visible**, además del nombre accesible que la
sección ya tiene.

**R14.** Los controles de filtro DEBEN renderizarse **dentro** de la tarjeta del libro y por encima
de la tabla.

**R15.** La paginación DEBE renderizarse en el **pie** de la tarjeta del libro y en flujo normal (no
flotando sobre la pantalla), conservando su nombre accesible actual.

**R16.** Ningún archivo tocado por esta ficha DEBE convertir un importe a número: los montos siguen
viajando y pintándose como texto.

**R17.** La pantalla NO DEBE ganar ningún control que escriba: ni botón, ni diálogo, ni formulario
que produzca una mutación.

**R18.** Las columnas de la tabla y las de la descarga a Excel NO DEBEN cambiar: ni su conjunto, ni
su orden, ni sus encabezados, ni el valor que emite cada celda.

**R19.** Los tres importes de la cabecera («A tu favor», «Cargos de Ordenex», «Ya pagado»), el saldo
y su aviso DEBEN seguir diciendo exactamente lo mismo que hoy.

**R20.** Todo texto nuevo visible DEBE estar en **voseo** y en lenguaje claro: sin siglas, sin jerga
contable y sin vocabulario interno del sistema (nombres de categoría, de tabla o de campo).

**R21.** Los símbolos que `/mi-wallet` exporta y que consume `/wallet/tiendas` DEBEN seguir siendo
**el mismo objeto** que hoy, no una copia: `money`, `CATEGORIA_TIENDA_LABEL`,
`CATEGORIA_TIENDA_OPTIONS`, `ORIGEN_TIENDA_LABEL`, `TIPO_TIENDA_LABEL` y `origenLabel`.

---

## C. Frontend — el filtro de cierre deja de pedir un UUID

> Hoy `MiWalletFiltros.tsx:57-67` pinta un `<Input type="text">` con `placeholder="ID del cierre"` y
> lo envía como `cierreId`. Nadie conoce ese identificador.

**R22.** CUANDO se abre `/mi-wallet`, el filtro de cierre DEBE presentarse como un **selector** de
opciones; ningún campo de esa pantalla DEBE pedir que se escriba un identificador.

**R23.** Cada opción del selector DEBE mostrarse con la **fecha** del cierre —en el mismo formato de
día que ya usa la columna «Fecha» de la tabla— y con el número de movimientos de ese cierre. Ninguna
opción DEBE mostrar el identificador interno.

**R24.** SI dos o más opciones caen el mismo día, ENTONCES sus etiquetas DEBEN distinguirse entre
ellas.

**R25.** El selector DEBE ofrecer una opción «todos los cierres», seleccionada de partida, cuyo
efecto DEBE ser el de no filtrar por cierre.

**R26.** CUANDO se elige una opción y se aplica el filtro, el sistema DEBE recargar libro, saldo y
desglose con el identificador del cierre elegido y DEBE volver a la primera página.

**R27.** CUANDO se pulsa «Limpiar», el selector DEBE volver a «todos los cierres» y el sistema DEBE
recargar sin filtro de cierre.

**R28.** SI el libro de la tienda no tiene ningún cierre, ENTONCES el selector DEBE quedar
deshabilitado y DEBE decir en pantalla que todavía no hay cierres.

**R29.** SI la lectura de cierres no responde correctamente, ENTONCES la pantalla DEBE seguir
mostrando el saldo, los tres importes y el libro, y el selector DEBE quedar deshabilitado. La caída
de esta lectura NO DEBE producir un `notFound()` ni ocultar el dinero.

**R30.** SI el conjunto de cierres supera el tope, ENTONCES la pantalla DEBE avisar de que solo se
ofrecen los cierres más recientes.

---

## D. La puerta — el ítem de menú (va AL FINAL)

**R31.** El menú DEBE ofrecer al rol `adminTienda` una entrada visible a `/mi-wallet`.

**R32.** Ningún rol distinto de `adminTienda` DEBE ver esa entrada, ni el actor ausente.

**R33.** El ítem de menú y el gate de la ruta DEBEN leer **la misma constante** de roles, y
`app/(app)/mi-wallet/page.tsx` NO DEBE contener ningún literal de rol.

**R34.** SI un actor sin sesión o con un rol distinto de `adminTienda` pide `/mi-wallet`, ENTONCES la
ruta DEBE seguir respondiendo `notFound()` sin exponer ningún dato.

**R35.** El **aterrizaje post-login** de los cinco roles NO DEBE cambiar; en particular, el
`adminTienda` DEBE seguir aterrizando en `/ordenes`.

**R36.** `middleware.ts` NO DEBE cambiar: `/mi-wallet` sigue siendo ruta privada por defecto y las
tres listas del middleware (`PUBLIC_ROUTES`, `SELF_AUTH_ROUTES`, `REDIRECT_TO_ROOT`) DEBEN quedar
idénticas, entrada por entrada y en el mismo orden.

---

## Preguntas abiertas

1. **Formato de la fecha en la opción.** R23 pide «el mismo formato de día que la columna Fecha»,
   que hoy es `2026-07-12` (ISO, día UTC — `DesgloseTiendaLedger.tsx:38` hace
   `fechaMovimiento.slice(0, 10)`, y la descarga usa `fechaDiaISO`). La opción diría entonces
   «Cierre del 2026-07-12 · 4 movimientos». ¿Preferís `12/07/2026`, aunque quede en otro formato que
   la tabla de al lado? (No hay hoy en el repo un formateador `dd/mm/aaaa` para esto; crearlo es
   trabajo extra y una segunda convención de fecha en la misma pantalla.)

2. **¿La opción debería decir el mensajero del cierre?** Sería el rótulo más informativo
   («Cierre del 2026-07-12 · Juan Pérez»), y resolvería R24 de raíz porque un `cierre_dia` es **por
   mensajero** y varios caen el mismo día. Tiene dos costes que no me corresponde decidir:
   (a) obliga a leer `cierre_dia` + `usuario`, dos consultas más y una dependencia nueva del módulo
   de la wallet sobre el dominio de cierres; (b) le muestra a la tienda **qué mensajero** movió su
   dinero, que hoy esta pantalla no dice. Mientras no haya respuesta, R24 se resuelve con la hora.

3. **Tope del selector.** Propongo 200 cierres, configurable por entorno. ¿Sirve, o preferís otro
   número? Con producción vacía desde el 2026-08-25 no hay una medida real que ofrecer: es una cota
   de seguridad, no un número medido.

4. **¿El selector debería ofrecer también los orígenes que NO son cierres?** El libro de la tienda
   tiene además movimientos con origen `pago_tienda` y `manual`. El filtro `cierreId` solo casa con
   `origen_tipo = cierre_dia` (`WalletTiendaMovimientoRepository.ts:41-44`), así que esos
   movimientos quedan fuera de cualquier opción del selector. Lo dejo como está —la ficha habla del
   filtro de **cierre**—, pero conviene que quede dicho.
