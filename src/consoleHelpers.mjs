"Use strict";

export const myConsole = {
    cs: console,
    log(...args) {
        this.cs.log(...args);
    },
    error(...args) {
        this.cs.error(...args);
    }
}