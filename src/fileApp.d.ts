import { Express } from 'express';
import { Server } from 'node:http';

export interface InitOptions {
    app: Express;
    httpServer: Server;
    filesStorePath: string;
    publicPath: string;
}

export declare function init(options: InitOptions): void;