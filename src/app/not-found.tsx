import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="text-6xl font-semibold text-muted-foreground/40">404</div>
      <h1 className="text-xl font-semibold">העמוד לא נמצא</h1>
      <Button asChild>
        <Link href="/">חזרה לסקירה הכללית</Link>
      </Button>
    </main>
  );
}
