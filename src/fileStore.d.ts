import { Readable } from 'node:stream';

export declare class FileStoreError extends Error {
    status: number;
    constructor(status: number, message: string);
}

export interface FileEntry {
    name: string;
    type: 'file' | 'folder';
    /** Bytes for files, null for folders. */
    size: number | null;
    /** Last modified, in ms since the epoch. */
    mtime: number;
}

export interface BatchFailure {
    path: string;
    error: string;
}

export interface FileStore {
    root: string;
    list(relPath?: string): Promise<{ path: string; entries: FileEntry[] }>;
    createFolder(parentRelPath: string, name: string): string;
    rename(itemRelPath: string, newName: string): string;
    move(itemRelPaths: string[], destinationRelPath: string): {
        moved: Array<{ from: string; to: string }>;
        failed: BatchFailure[];
    };
    remove(itemRelPaths: string[]): Promise<{ removed: string[]; failed: BatchFailure[] }>;
    saveUpload(folderRelPath: string, relName: string, source: Readable): Promise<string>;
}

export declare function createFileStore(rootPath: string): FileStore;

export declare function toStoreError(error: unknown): FileStoreError;

export declare function validateName(name: unknown): string;

export declare function sanitizeName(name: unknown): string;
