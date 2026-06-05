import "./globals.css";
import type { ReactNode } from "react";
import { AppProviders } from "@/providers/AppProviders";

export const metadata = {
  title: "pebble — find influencers who move the market",
  description:
    "Point pebble at your homepage. It finds the right creators and DMs them for you.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
