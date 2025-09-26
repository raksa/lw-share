export interface InitOptions {
    app: Express;
    publicPath: string;
}

export declare function init(options: InitOptions): void;