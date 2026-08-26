import type { ResolvedLibrary } from "@/core/launch-analyzer";

export interface CachedResolvedLibrary {
  url: string;
  library: ResolvedLibrary;
}

export class ResolvedLibraryMemoryCache {
  private readonly libraries = new Map<string, ResolvedLibrary>();

  getComplete(url: string): ResolvedLibrary | undefined {
    const library = this.libraries.get(url);

    return library?.completeness.state === "complete" ? library : undefined;
  }

  setIfComplete(url: string, library: ResolvedLibrary): void {
    if (library.completeness.state === "complete") {
      this.libraries.set(url, library);
    }
  }

  delete(url: string): void {
    this.libraries.delete(url);
  }

  clear(): void {
    this.libraries.clear();
  }

  entries(): CachedResolvedLibrary[] {
    return [...this.libraries.entries()].map(([url, library]) => ({
      url,
      library
    }));
  }
}
