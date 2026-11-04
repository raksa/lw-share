export declare function getUrlList(port: number, pathname?: string): string[];

export declare function genQRImage(text: string, options?: { type: 'png' }): Promise<string>;

export declare function getAddressesWithQR(port: number, pathname?: string): Promise<Array<{
    address: string;
    interfaceName: string;
    internal: boolean;
    /** Host side of a VM or container network: usually unreachable from other devices. */
    virtual: boolean;
    qrCode: string;
}>>;

export declare function setCorsHeaders(res: any): void;

export declare function checkIsValidFile(baseDir: string, fileFullName: string): boolean;

export declare function listFiles(targetPath: string): Promise<string[]>;

export declare function listFilesWithStats(targetPath: string): Promise<Array<{
    name: string;
    size: number;
    mtime: number;
}>>;

export declare function getDirPath(targetPath: string): string;