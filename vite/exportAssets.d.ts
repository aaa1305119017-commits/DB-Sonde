import type { Plugin } from "vite";
export declare const echartsParts: { charts: string[]; components: string[]; renderers: string[] };
export declare function buildEchartsBundle(root: string): Promise<string>;
export declare function minifyFile(file: string): Promise<string>;
export declare function viteExportAssets(root: string): Plugin;
export declare function esbuildExportAssets(root: string): { name: string; setup: (build: unknown) => void };
