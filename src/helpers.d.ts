export declare function getUrlList(port: number, pathname?: string): string[];

export declare function genQRImage(text: string, options?: { type: 'png' }): Promise<string>;

export declare function getAddressesWithQR(port: number, pathname?: string): Promise<Array<{
    address: string;
    qrCode: string;
}>>;

export declare function setCorsHeaders(res: any): void;

export declare function checkIsValidFile(baseDir: string, fileFullName: string): boolean;

export declare function listFiles(targetPath: string): Promise<string[]>;

export declare function getDirPath(targetPath: string): string;