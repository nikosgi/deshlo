import type { Metadata } from "next";

import OverlayGate from "./OverlayGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Source Inspector Test App",
  description: "App Router playground for @fdb/nextjs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OverlayGate />
        {children}
      </body>
    </html>
  );
}
