import { Express } from "express";
import { Server } from "node:http";
import * as qrCode from "qrcode-terminal";

// Express app instance
export declare const app: Express;

// HTTP server instance
export declare const httpServer: Server;

// Main initialization function
export declare function init(filesStorePath: string, port: number): () => void;

// Re-exported from helpers.mjs
export declare function getUrlList(port: number, pathname?: string): string[];
export declare function genQRImage(
  text: string,
  options?: { type: "png" }
): Promise<string>;
export declare type AddressWithQR = {
  address: string;
  qrCode: string;
};
export declare function getAddressesWithQR(
  port: number,
  pathname?: string
): Promise<Array<AddressWithQR>>;
export declare function setCorsHeaders(res: any): void;
export declare function checkIsValidFile(
  baseDir: string,
  fileFullName: string
): boolean;
export declare function listFiles(targetPath: string): Promise<string[]>;
export declare function getDirPath(targetPath: string): string;
export declare function getRandomPort(): Promise<number>;

// Re-exported from consoleHelpers.mjs
export declare const myConsole: {
  cs: Console;
  log(...args: any[]): void;
  error(...args: any[]): void;
};

// Re-exported qrCode module
export { qrCode };
