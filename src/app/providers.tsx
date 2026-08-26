"use client";

import { BaseStyles, ThemeProvider } from "@primer/react";

export function AppProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles>{children}</BaseStyles>
    </ThemeProvider>
  );
}
