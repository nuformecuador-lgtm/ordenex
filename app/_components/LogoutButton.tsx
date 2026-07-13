"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await logout();
        router.push("/login");
      } catch (error) {
        console.error("Logout failed:", error);
      }
    });
  };

  return (
    <Button onClick={handleLogout} disabled={isPending} variant="outline" className={'cursor-pointer'}>
      <LogOut />Salir
    </Button>
  );
}
