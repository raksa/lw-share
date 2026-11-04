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

export interface TextFile {
    path: string;
    content: string;
    /** Bytes on disk. */
    size: number;
    /** Last modified, in ms since the epoch; pass it back to writeText. */
    mtime: number;
}

/** Largest file the text editor opens or saves. */
export declare const MAX_TEXT_BYTES: number;

export interface FileStore {
    root: string;
    list(relPath?: string): Promise<{ path: string; entries: FileEntry[] }>;
    createFolder(parentRelPath: string, name: string): string;
    createFile(parentRelPath: string, name: string): string;
    readText(fileRelPath: string): Promise<TextFile>;
    writeText(fileRelPath: string, data: Buffer | string, expectedMtime?: number): Promise<{
        path: string;
        size: number;
        mtime: number;
    }>;
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
