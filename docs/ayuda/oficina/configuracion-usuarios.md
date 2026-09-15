---
titulo: Configuración · Usuarios
modulo: configuracion
pantalla: /configuracion
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/configuracion/_components/UsuariosModule.tsx
  - app/(app)/configuracion/_components/usuarios-filtros-def.ts
  - app/(app)/configuracion/_components/seleccion-a-filtro-usuarios.ts
---

# Configuración · Usuarios

Las **cuentas de todo el mundo**: mensajeros, administradores de bodega, tiendas y oficina. Acá se
crean, se les cambia el rol, se bloquean y se les restablece la contraseña.

## Los estados de una cuenta

| Estado | Qué significa |
| --- | --- |
| **Activo** | Entra y trabaja normalmente |
| **Inactivo** | No entra. Se conserva todo su historial |
| **Bloqueado** | No entra. Se usa cuando hay que cortar el acceso ya |

**Inactivo y bloqueado no borran nada.** Sus órdenes, cierres y conversaciones siguen ahí — y tienen
que seguir, porque son el registro de lo que pasó. Una cuenta no se borra: se apaga.

## Contraseñas

Al crear una cuenta o restablecerla se **genera una contraseña** y se muestra una sola vez, con un botón
para copiarla. **Copiala y pasásela a la persona en ese momento**: después no se vuelve a ver.

Si se pierde, no pasa nada grave — se restablece otra vez.

## Buscar

Por **nombre o correo**, y se puede filtrar por rol y por estado para encontrar rápido.

## Antes de cambiar un rol

El rol decide qué pantallas ve la persona y qué puede hacer. Cambiarlo tiene efecto de inmediato:
alguien que estaba trabajando puede quedarse sin la pantalla que tenía abierta.

Y al asignar a un mensajero, **la zona importa tanto como el rol**: un mensajero sin zona no aparece en
las listas de asignación de ninguna bodega. Si alguien reporta que «no le puedo asignar a Fulano», la
zona es lo primero que hay que mirar.

## Lo que esta pantalla NO hace

- **No borra cuentas.** Se desactivan o se bloquean, para no perder el historial.
- **No crea llaves de integración.** Las cuentas por API se manejan en **Configuración · API keys**.
