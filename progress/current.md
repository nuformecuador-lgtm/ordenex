# Estado — madrugada del 2026-09-08

**La cola está vacía.** Las siete fichas que traíamos están cerradas y **en producción**.

## Dos releases, las dos verificadas

| | commit | qué llevó |
|---|---|---|
| **#748** | `8a68b5db` | 379, 386, 392, 393, 394 — sin migraciones |
| **#752** | `7381b54c` | 380, 381 — **con tres migraciones** |

Las dos con despliegue en verde y **cero errores de runtime**.

## Las migraciones, comprobadas contra la base de producción

Medido **antes** y **después**, no supuesto:

| | antes | después | esperado |
|---|---|---|---|
| tipos de historial | 49 | **51** | 51 |
| entidades de historial | 20 | **21** | 21 |
| categorías de wallet de tienda | 10 | **11** | 11 |

Los cuatro valores nuevos son los correctos, las tres migraciones figuran aplicadas
y ninguna revertida, y el CHECK admite `cobro_manual` **solo en la rama de débito**.

## Lo que queda abierto, y es de verdad

- **La Q1 de la 381 sigue SIN FIRMAR**: los tres textos que ve el usuario en el
  diálogo de cobro. Se implementó la propuesta del diseño para no bloquear.
  Cambiarlos cuesta una línea cada uno; el valor interno del enum costaría otra
  migración.
- **La A2 de la 383 sigue sin firmar**: la corrección manual de datos *rechaza* el
  carácter en vez de repararlo, al revés que la carga masiva. La 392 eligió
  rechazar por coherencia con el formulario más cercano, **no por firma**.
- **De la 393 no se pudo ver el caso de línea puente distinta de cero**: la base
  local no tiene gestiones entregadas ni tarifa congelada. Dicho como falta, no
  como aprobado.
- **Cinco fichas (394, 386, 392, 380, 381) no pasaron por reviewer.** Pasaron su
  gate completo y sus mutaciones. Queda dicho.

## Dos hallazgos que valen más que sus fichas

1. **La guardia del historial NO caza que una escritura desaparezca.** Mide por
   *método*: si el método conserva sus otras llamadas a `appendAccion`, borrar una
   entera deja el censo **verde**. Medido dos veces, en la 380 y en la 381. Quien
   protege esos requisitos es Postgres, no el censo.
2. **El deadlock `40P01` que ensució gates toda la noche es contención entre tests
   de migración** que aplican DDL sin tomar un bloqueo de aviso compartido. Se
   reproduce corriendo `tests/integration/db/` **sin el archivo de nadie**. Es
   arreglable y no está arreglado.

## Deuda menor, con dueño

- El error **bajo el campo** de la validación de cliente sigue en inglés en el
  formulario de usuarios (anterior a la 392).
- El select de Rol pinta los valores crudos del enum (`adminSatelite`…).
- `MontoDerivadoCard` y `GANANCIA_NOTA_BODEGA` quedan **muertos y declarados**, no
  borrados: borrarlos se llevaría cobertura ajena.
- El campo `intentosContactoTienda` del DTO de cierres queda **sin consumidor** y
  no se borra, por lo mismo.
