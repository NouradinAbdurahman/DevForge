import type { ReactNode } from "react";

export const metadata = {
  title: "My App",
  description: "A minimal Next.js starter",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
